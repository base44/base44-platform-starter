/**
 * The build-session push channel: how the browser watches a build.
 *
 * The mechanism this replaces had the browser ask "are we there yet?" every 2.5
 * seconds, each time re-reading the entire builder transcript — which grows all
 * build long, because it carries every tool call's arguments and results. This
 * holds one connection open instead and is told.
 *
 * Two credentials, and only one of them is a principal. The Base44 token that
 * mints stays on the server (`src/lib/base44Link.ts`); what reaches the browser
 * is a **session token** — read-only, ~15 minutes, scoped to this one session
 * and useless for anything else. That distinction is the whole reason it is
 * safe to ship, and it is the one place this repo hands the client anything
 * Base44 issued. See the boundary note in CLAUDE.md.
 *
 * The stream is browser-to-Base44 **directly**, not proxied through this app.
 * That is deliberate on two counts: Base44 serves it with wildcard CORS and no
 * credentials, so nothing needs relaying; and a serverless function is the worst
 * possible place to sit in the middle of a long-lived stream, where response
 * buffering and execution ceilings both work against you.
 */

import {
  mintBuildSessionToken,
  revokeBuildSessionGrant,
  type MintedSessionToken,
} from "@/lib/base44Platform";

/**
 * The events this client understands. Anything else on the wire is ignored by
 * construction — an `EventSource` only sees the types it subscribes to — which
 * is exactly the contract Base44 publishes, so that it can add events later
 * without a coordinated release on this side.
 *
 * That ignoring is safe only for events a UI can afford to miss, so the last two
 * are here deliberately. They fire for things done to the app from *outside* the
 * turn being watched — a checkpoint restore or branch sync rewriting the
 * conversation, files changing with no turn to attribute them to — and neither
 * is followed by anything else. Drop them and a stale transcript stays on screen
 * with nothing ever arriving to correct it.
 */
export const SESSION_EVENT_TYPES = [
  "turn.started",
  "turn.finished",
  "message.updated",
  "state.changed",
  "error",
  "conversation.reset",
  "files.changed",
] as const;

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export type SessionStatus = "idle" | "running" | "waiting" | "blocked" | "error";

/**
 * Why the agent stopped, separate from the fact that it stopped — a UI cannot
 * act on "waiting" alone. `choice` is a picker, `input` a form, `approval` an
 * approve/reject. Every one of them is answerable; running out of credits is
 * NOT one, and arrives as `status: "blocked"` with `reason: "quota"`.
 */
export type WaitingKind = "input" | "choice" | "approval";

export type WaitingOn = {
  kind: WaitingKind;
  waitpoint_id: string;
  tool_name?: string;
};

export type SessionState = {
  status: SessionStatus;
  waiting_on?: WaitingOn;
  /** Why a `blocked` turn is blocked — `quota` today. Nothing failed. */
  reason?: string;
  turn_id?: string;
  error_source?: string;
  /** Present on `error` events raised by a turn that died outside a request. */
  detail?: string;
};

/** A tool call as partners see it: arguments yes, results never. */
export type SessionToolCall = {
  id: string;
  name: string;
  status: string;
  requires_user_input: boolean;
  waiting_on_kind: WaitingKind | null;
  arguments: string;
  display: Record<string, unknown> | null;
};

export type SessionMessage = {
  message_id: string;
  role: string;
  content: string;
  tool_calls: SessionToolCall[];
};

export type SessionEvent = {
  type: SessionEventType;
  seq: string;
  /** The turn every event belongs to, so a resumed stream stays attributable. */
  turn_id?: string;
  data: Record<string, unknown>;
};

export type SessionHandlers = {
  onEvent: (event: SessionEvent) => void;
  /** Stream-level trouble, already described. Never fatal — a reconnect follows. */
  onError?: (message: string) => void;
};

/**
 * Re-mint at 80% of the token's life, floored so a hypothetical very short TTL
 * cannot turn into a mint loop. A build routinely outlives one token — the
 * default is 15 minutes — so refreshing is the steady state, not an edge case.
 */
function refreshDelayMs(expiresInSeconds: number): number {
  const life = Number(expiresInSeconds) > 0 ? Number(expiresInSeconds) : 900;
  return Math.max(30, Math.floor(life * 0.8)) * 1000;
}


/**
 * Trade a grant for the one-shot ticket the stream URL carries.
 *
 * Browser-to-Base44 directly, like the stream itself: Base44 answers the
 * preflight for `Authorization` with wildcard CORS and no credentials, so
 * relaying it through this app would add a hop and a place for the grant to be
 * logged, for nothing.
 */
async function fetchStreamTicket(minted: MintedSessionToken): Promise<string> {
  const url = minted.events_url.replace(/\/events$/, "/tickets");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${minted.token}` },
  });
  if (!response.ok) {
    throw new Error(`Could not open the build stream (${response.status}).`);
  }
  const body = await response.json();
  if (!body?.ticket) throw new Error("Build stream ticket was missing.");
  return String(body.ticket);
}

/** Backoff before re-minting after a stream error, so a hard failure can't spin. */
const RECONNECT_DELAY_MS = 2000;

function parseFrame(raw: string): SessionEvent | null {
  try {
    const frame = JSON.parse(raw);
    if (!frame || typeof frame !== "object" || typeof frame.type !== "string") return null;
    return frame as SessionEvent;
  } catch {
    return null;
  }
}

/**
 * Watch one build session. Returns the unsubscribe.
 *
 * Reconnects carry the last seq we saw, so a resume replays only the gap.
 * Without that every token refresh would replay the whole retained window —
 * harmless, since message snapshots are last-write-wins per id, but wasteful
 * every fifteen minutes for the length of a build.
 */
export function subscribeToSession(appId: string, handlers: SessionHandlers): () => void {
  if (typeof EventSource === "undefined") {
    // Server-rendered pass: nothing to subscribe to, and constructing one here
    // would throw rather than degrade.
    return () => {};
  }

  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSeq: string | null = null;
  let stopped = false;
  let grant: MintedSessionToken | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  // The grant we are done with, handed back rather than left to lapse. Every
  // teardown reaches here — a token refresh, a reconnect after an error, the
  // caller unsubscribing — so a long build does not leave one live credential
  // per refresh behind it. Best-effort: it expires on its own within the hour,
  // so a failed revoke is not worth telling anyone about.
  const releaseGrant = () => {
    const spent = grant;
    grant = null;
    if (!spent?.grant_id) return;
    void revokeBuildSessionGrant(appId, spent.grant_id).catch(() => {});
  };

  const teardown = () => {
    clearTimer();
    source?.close();
    source = null;
    releaseGrant();
  };

  const reconnect = (delayMs: number) => {
    teardown();
    if (stopped) return;
    timer = setTimeout(() => {
      void connect();
    }, delayMs);
  };

  const connect = async () => {
    if (stopped) return;
    let minted;
    try {
      minted = await mintBuildSessionToken(appId);
    } catch (err) {
      handlers.onError?.((err as Error).message);
      reconnect(RECONNECT_DELAY_MS);
      return;
    }
    // Held from here on, so every exit below hands it back: the error paths go
    // through `reconnect`, which tears down first, and the `stopped` checks tear
    // down explicitly — the caller may well have unsubscribed *during* the mint,
    // and its own teardown ran before this grant existed.
    grant = minted;
    if (stopped) return teardown();

    // The grant never goes in a URL. `EventSource` cannot set headers, so it is
    // exchanged — in a header, where it belongs — for a single-use ticket good
    // for a minute. What ends up in an access log is then already spent.
    let ticket: string;
    try {
      ticket = await fetchStreamTicket(minted);
    } catch (err) {
      handlers.onError?.((err as Error).message);
      reconnect(RECONNECT_DELAY_MS);
      return;
    }
    if (stopped) return teardown();

    const url = new URL(minted.events_url);
    url.searchParams.set("ticket", ticket);
    // The resume point does ride the query string: it is a sequence number, not
    // a credential, and the browser has nowhere else to put it.
    if (lastSeq) url.searchParams.set("last_event_id", lastSeq);

    const stream = new EventSource(url.toString());
    source = stream;

    for (const type of SESSION_EVENT_TYPES) {
      stream.addEventListener(type, (event) => {
        const frame = parseFrame((event as MessageEvent).data);
        if (!frame) return;
        if (frame.seq) lastSeq = frame.seq;
        handlers.onEvent(frame);
      });
    }

    // Re-mint before the token dies rather than after: waiting for the 403 would
    // show up as a stream that silently stops mid-build.
    timer = setTimeout(() => reconnect(0), refreshDelayMs(minted.expires_in));

    stream.onerror = () => {
      // `EventSource` would retry this itself, but a retry with a dead token
      // just 403s forever — and an expired token is the likeliest reason we are
      // here at all. Take the connection back and mint a fresh one.
      if (stopped) return;
      handlers.onError?.("Lost the build stream — reconnecting.");
      reconnect(RECONNECT_DELAY_MS);
    };
  };

  void connect();

  return () => {
    stopped = true;
    teardown();
  };
}

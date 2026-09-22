/**
 * Signing a viewer into an embedded app.
 *
 * A built app is a separate Base44 app on its own subdomain, so a frame of it has
 * always been anonymous: `User.me()` empty inside the app, everything it writes
 * attributed to nobody. The install token this shell already hands over
 * `postMessage` fixes the *other* half — whose Sunny data the app may read — and
 * leaves this one alone.
 *
 * Base44's embed token closes it. Two calls, in this order, both server-side:
 *
 *   1. provision the viewer as an app user of that app (idempotent — an already
 *      provisioned email comes back unchanged), because minting refuses an email
 *      the app has never seen;
 *   2. mint a one-time token, which comes back as `embed_url`: the app's own live
 *      URL carrying `?ott=`.
 *
 * Loading that URL in the frame is the whole client-side story. The app's server
 * redeems the token on the document request and answers with a redirect carrying
 * a session, so the app is signed in before its HTML is parsed — no SDK version,
 * no app code, nothing an app author has to know about.
 *
 * Three properties of the token dictate how callers may use it, and all three are
 * why this returns a URL rather than something cacheable: it is **single-use**,
 * it lives **60 seconds**, and it is a **credential** — so it is minted per frame
 * load, never stored, never logged, and never put in a link or a listing.
 */

import { embedKey, orgId, platformHost } from "@/lib/base44Config";

/** What the browser is told. `embedUrl` null means "load the app signed out". */
export type EmbedSession = {
  embedUrl: string | null;
  expiresIn: number | null;
  /** Why there is no session, when there is none. Informational, never a secret. */
  reason: EmbedRefusal | null;
};

export type EmbedRefusal =
  /** The app has never been deployed: redemption runs on the live host only. */
  | "not_deployed"
  /** The platform never mints for an app's owner, editors or service identities. */
  | "privileged_user"
  /** Anything else upstream refused. The frame still renders, signed out. */
  | "refused";

const CLEAN_ID = /^[A-Za-z0-9_-]+$/;

export class EmbedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "EmbedError";
  }
}

/** Both calls carry the workspace key and the workspace id, and nothing caller-supplied. */
function headers() {
  return {
    api_key: embedKey(),
    "X-Active-Workspace-Id": orgId(),
    "Content-Type": "application/json",
  };
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${platformHost()}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, text: await res.text() };
}

/**
 * Provision, mint, and hand back the URL to frame.
 *
 * `appId` is validated rather than trusted: it reaches a path. `email` is the
 * signed-in viewer's, taken from the session by the route above — never from the
 * request body, which would make this an impersonation endpoint.
 */
export async function embedSessionFor(appId: string, email: string): Promise<EmbedSession> {
  if (!CLEAN_ID.test(appId)) throw new EmbedError("invalid app id", "invalid_request", 400);

  // Idempotent by design upstream, so it runs on every frame load rather than
  // only on the mint's 404. One extra call buys not having to cache who is
  // provisioned where, which would be a second source of truth to go stale.
  const provisioned = await post(`/api/apps/${appId}/users/provisions`, {
    email,
    role: "user",
  });
  if (provisioned.status >= 400) {
    // A viewer we cannot provision cannot be minted for either, and the reason
    // is worth seeing: a missing scope on the key reports itself here first.
    console.warn(`[embed] provision ${appId} → ${provisioned.status} ${provisioned.text.slice(0, 200)}`);
    return { embedUrl: null, expiresIn: null, reason: refusalFrom(provisioned) };
  }

  const minted = await post(`/api/apps/${appId}/embed-tokens`, { email });
  if (minted.status >= 400) {
    console.warn(`[embed] mint ${appId} → ${minted.status} ${minted.text.slice(0, 200)}`);
    return { embedUrl: null, expiresIn: null, reason: refusalFrom(minted) };
  }

  try {
    const body = JSON.parse(minted.text || "{}") as { embed_url?: string | null; expires_in?: number };
    // Null for an app that has never been deployed — the mint succeeded, there is
    // just no live host to redeem the token on.
    return {
      embedUrl: body.embed_url ?? null,
      expiresIn: body.expires_in ?? null,
      reason: body.embed_url ? null : "not_deployed",
    };
  } catch {
    throw new EmbedError("upstream returned a body that is not JSON", "bad_upstream");
  }
}

function refusalFrom({ status, text }: { status: number; text: string }): EmbedRefusal {
  if (status === 403 && text.includes("privileged_user")) return "privileged_user";
  return "refused";
}

/**
 * POST /api/base44/platform — the server-side proxy for Base44's *platform* REST
 * API: the endpoints that create and build OTHER apps.
 *
 * Authentication is **per shell user** — each user links once via
 * `/api/base44/link` and gets their own minted token, so the apps they create are
 * owned by their own Base44 identity. A single shared API key would instead make
 * every app ever built belong to whoever's key it was.
 *
 * Governance stays intact: the token is pinned to the shared enterprise workspace
 * via `X-Active-Workspace-Id` (and `createApp`'s `organization_id`), and apps are
 * filed into the `sunny_widgets` folder.
 *
 * `OPS` below is an **allow-list, and it is the only limit** on what a compromised
 * frontend could reach: Base44 enforces OAuth scopes in its MCP tool layer, not on
 * this REST surface, so `apps:read apps:write` does not constrain these calls.
 * Keep it tight — never add a passthrough action, and never let the caller supply
 * a path, host or workspace id, nor a credential *value* (see `APP_SECRETS`).
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireSessionUser } from "@/lib/auth";
import { errorResponse, jsonError } from "@/lib/apiResponse";
import {
  APP_SECRETS,
  MissingConfigError,
  REFRESH_SKEW_MS,
  appsFolderId,
  orgId,
  platformHost,
  resolveAppSecrets,
} from "@/lib/base44Config";
import { type Base44Link, getLink, remint } from "@/lib/base44Link";

type Params = Record<string, unknown>;

type Op = {
  method: string;
  path: (p: Params) => string;
  body?: (p: Params) => unknown;
  /** Per-call headers derived from params — used to forward X-Request-ID. */
  headers?: (p: Params) => Record<string, string>;
  /** Override `DEFAULT_TIMEOUT_MS` for actions that wait on a builder turn. */
  timeoutMs?: number;
  /**
   * Rewrite the upstream body before it reaches the browser. Only `mintBuildSessionToken`
   * needs it, to absolutize the stream URL — see the note there.
   */
  transform?: (body: unknown) => unknown;
};

/** Plenty for a CRUD call against the platform REST API. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * For the actions that block on Base44's builder rather than a database.
 *
 * A build turn is an LLM call and has no reason to fit in 30s — `sendMessage`
 * measures at ~28s against a live app, so the 30s default aborted it
 * intermittently and reported it as an upstream fault.
 *
 * Kept well under Vercel's 300s function ceiling so a genuinely hung upstream
 * still fails rather than holding the function open to the platform limit.
 */
const BUILDER_TIMEOUT_MS = 120_000;

/**
 * The full builder transcript, and it is polled every few seconds while a build
 * runs. Every tool call's `arguments_string` and `results` come back with it —
 * file contents included — so the body grows all build long and a late-build read
 * does not reliably fit in 30s. A slow read is not an upstream fault; timing it
 * out at the default just turns a working build into an error banner.
 */
const CONVERSATION_TIMEOUT_MS = 60_000;

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown, fallback: number) => String(Number(v) > 0 ? Number(v) : fallback);

function createSecretsPayload(names: readonly string[] | undefined) {
  if (!names?.length) return undefined;
  const values = resolveAppSecrets(names);
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, { type: "value", value }]),
  );
}

const OPS: Record<string, Op> = {
  listApps: {
    method: "GET",
    path: (p) =>
      `/api/apps?${new URLSearchParams({
        q: JSON.stringify({ app_type: { $nin: ["user_agent"] } }),
        sort: "-updated_date",
        limit: num(p.limit, 20),
        skip: String(Number(p.skip) || 0),
        filter_mode: "all_apps_workspace",
        // Only apps this builder filed in — the workspace holds others.
        folder_id: appsFolderId(),
      })}`,
  },
  createApp: {
    method: "POST",
    path: () => "/api/apps",
    body: (p) => ({
      name: p.name || undefined,
      user_description: p.prompt,
      organization_id: orgId(),
      public_settings: "public_without_login",
      // Persisted on the app and applied by the builder on every turn. Set here
      // rather than after create because initial_message starts the first build
      // in this same call — a later update would miss it.
      custom_instructions: p.customInstructions || undefined,
      // Written before the first build turn is scheduled.
      secrets: createSecretsPayload(p.secrets as string[] | undefined),
      // Create-only: kicks off the first build, never persisted on the app.
      initial_message: { content: p.prompt },
      // Required for the preview to be embeddable in an iframe.
      prevent_iframe_embedding: false,
    }),
    // `initial_message` starts the first build inside this same call.
    timeoutMs: BUILDER_TIMEOUT_MS,
  },
  getApp: {
    method: "GET",
    path: (p) => `/api/apps/${str(p.appId)}`,
  },
  /** Moves apps into the folder. Returns an empty body on success. */
  fileAppsInFolder: {
    method: "POST",
    path: () => `/api/app-folders/${appsFolderId()}/items`,
    body: (p) => ({ app_ids: p.appIds }),
  },
  getConversation: {
    method: "GET",
    timeoutMs: CONVERSATION_TIMEOUT_MS,
    path: (p) =>
      `/api/apps/${str(p.appId)}/chat/full-conversation?${new URLSearchParams({
        limit: num(p.limit, 100),
        skip: String(Number(p.skip) || 0),
      })}`,
  },
  sendMessage: {
    method: "POST",
    path: (p) => `/api/apps/${str(p.appId)}/chat/message`,
    body: (p) => ({ content: p.content }),
    // Blocks on a builder turn — see BUILDER_TIMEOUT_MS.
    timeoutMs: BUILDER_TIMEOUT_MS,
  },
  getPreviewUrl: {
    method: "GET",
    path: (p) => `/api/apps/${str(p.appId)}/sandbox/preview-url`,
  },
  deployApp: {
    method: "POST",
    path: (p) => `/api/apps/${str(p.appId)}/deploy`,
    body: () => ({}),
    // Precautionary: deploy answers well inside 30s for a small app, but it
    // bundles, so a large one could exceed it. The cost of a too-long timeout is
    // a slow failure; of a too-short one, a spurious error on a working deploy.
    timeoutMs: BUILDER_TIMEOUT_MS,
  },
  /**
   * Resume a builder turn paused on a `requires_user_input` tool call. `approve`
   * false → the platform records the call `stopped` and the tool never runs; true
   * → the tool runs with `extraUserInput` injected as its `user_input` argument.
   */
  submitToolCallInput: {
    method: "POST",
    path: (p) => `/api/apps/${str(p.appId)}/chat/submit-tool-call-input`,
    body: (p) => ({
      tool_call_id: p.toolCallId,
      action: p.approve ? "approved" : "rejected",
      extra_user_input: p.extraUserInput ?? {},
      message_id: p.messageId || undefined,
    }),
    // Resumes the paused builder turn, so it waits on the same LLM work.
    timeoutMs: BUILDER_TIMEOUT_MS,
    // Stable per logical submit so a network-retried POST dedups instead of
    // resuming (and charging) the turn twice.
    headers: (p): Record<string, string> =>
      p.requestId ? { "X-Request-ID": String(p.requestId) } : {},
  },

  // --- build sessions: the push channel -------------------------------------
  //
  // The two above that drive a build (`sendMessage`, `submitToolCallInput`)
  // answer only when the whole builder turn is done, which is why they carry
  // BUILDER_TIMEOUT_MS. These five replace them: each returns as soon as the
  // work is *accepted*, and progress arrives on a stream the browser holds open
  // itself.
  // Both sets are kept so `NEXT_PUBLIC_BASE44_BUILD_SESSIONS` can select
  // between them — see `buildSessionsEnabled` in src/lib/base44Config.ts.

  /**
   * Mints the short-lived, read-only token the browser streams with.
   *
   * The only one of the five that must be server-side on principle rather than
   * convention: minting is the privilege-granting step, so it is the one that
   * has to present this user's Base44 credential.
   */
  mintBuildSessionToken: {
    method: "POST",
    path: (p) => `/api/v1/apps/${str(p.appId)}/build/grants`,
    body: (p) => ({
      subject: p.subject || undefined,
      token_ttl_seconds: Number(p.ttlSeconds) > 0 ? Number(p.ttlSeconds) : undefined,
    }),
    /**
     * Upstream returns `events_url` as a path. Joining it onto the host here —
     * rather than shipping the host to the browser as another `NEXT_PUBLIC_`
     * var — keeps one source of truth for it and keeps it server-authoritative:
     * a request-controlled Base44 host on a path that carries credentials is
     * the SSRF this file's header warns about, and a second copy of the value
     * is a footgun the moment the two disagree.
     */
    transform: (body) => {
      if (!body || typeof body !== "object") return body;
      const { events_url: eventsUrl, ...rest } = body as Record<string, unknown>;
      if (typeof eventsUrl !== "string" || !eventsUrl) return body;
      return { ...rest, events_url: `${platformHost()}${eventsUrl}` };
    },
  },

  /** Starts a build turn. 202 — watch the stream for turn.started/turn.finished. */
  sendBuildSessionMessage: {
    method: "POST",
    path: (p) => `/api/v1/apps/${str(p.appId)}/build/messages`,
    body: (p) => ({ content: p.content, file_urls: p.fileUrls ?? undefined }),
    // A turn costs credits, and a 202 that never arrives invites a retry, so the
    // caller names the turn and the platform dedupes on the name.
    headers: (p): Record<string, string> =>
      p.requestId ? { "Idempotency-Key": String(p.requestId) } : {},
    // No BUILDER_TIMEOUT_MS on purpose: this returns before the turn runs, so
    // the default CRUD timeout is the honest one. A slow answer here means the
    // platform is unwell, not that a build is long.
  },

  /** Answers the waitpoint holding the turn open, and resumes it. 202. */
  respondToBuildSession: {
    method: "POST",
    path: (p) => `/api/v1/apps/${str(p.appId)}/build/responses`,
    /**
     * Shaped by the waitpoint kind, which is what upstream discriminates on. An
     * approval is a decision; a question's answer *is* the payload, and omitting
     * it declines — so there is no separate reject field to keep consistent.
     */
    body: (p) => {
      const kind = str(p.kind);
      const approved = p.decision === "approved";
      if (kind === "approval") {
        return { kind, waitpoint_id: p.waitpointId, approved };
      }
      return {
        kind,
        waitpoint_id: p.waitpointId,
        value: approved ? (p.input ?? {}) : undefined,
      };
    },
    // Same contract as the message send: a network-retried POST must not resume
    // — and charge — the turn twice.
    headers: (p): Record<string, string> =>
      p.requestId ? { "Idempotency-Key": String(p.requestId) } : {},
  },

  /** Stops the running turn. Answers inline, unlike the two above. */
  cancelBuildSessionTurn: {
    method: "POST",
    path: (p) => `/api/v1/apps/${str(p.appId)}/build/cancel`,
    body: () => ({}),
  },

  /**
   * Withdraws a grant before it expires. 204, and idempotent — it says nothing
   * about whether the id was real, so a stale one is not a way to enumerate.
   */
  revokeBuildSessionGrant: {
    method: "DELETE",
    path: (p) => `/api/v1/apps/${str(p.appId)}/build/grants/${str(p.grantId)}`,
  },
};

/**
 * Actions addressing a specific app must be given a clean id — anything with a
 * slash or query character could escape the allow-listed path shape.
 */
const APP_SCOPED = [
  "getApp",
  "getConversation",
  "sendMessage",
  "getPreviewUrl",
  "deployApp",
  "submitToolCallInput",
  "mintBuildSessionToken",
  "sendBuildSessionMessage",
  "respondToBuildSession",
  "cancelBuildSessionTurn",
  "revokeBuildSessionGrant",
];

/** The two answers `/build/responses` accepts; anything else is a 422 upstream. */
const RESPOND_ACTIONS = ["approved", "rejected"];
// The three answerable waitpoint kinds. `quota` is deliberately absent: it is
// a blocked status upstream, not something /responses can resolve.
const RESPOND_KINDS = ["approval", "input", "choice"];

const CLEAN_ID = /^[A-Za-z0-9_-]+$/;

/**
 * The Bearer token says *who*; `X-Active-Workspace-Id` says *where* — pinning it
 * keeps a multi-workspace token's reads and writes in the governed workspace.
 */
function send(path: string, op: Op, body: string | undefined, accessToken: string, params: Params) {
  const url = `${platformHost()}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Active-Workspace-Id": orgId(),
    ...(op.headers?.(params) ?? {}),
  };

  return fetch(url, {
    method: op.method,
    headers,
    body,
    signal: AbortSignal.timeout(op.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}

const reauthorize = () =>
  NextResponse.json(
    { error: "Your Base44 connection expired. Connect again.", code: "reauthorize_required" },
    { status: 428 },
  );

function validate(action: string, params: Params): string | null {
  if (APP_SCOPED.includes(action) && !CLEAN_ID.test(str(params.appId))) {
    return `Action "${action}" needs a valid appId.`;
  }
  if (action === "fileAppsInFolder") {
    const ids = params.appIds;
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => CLEAN_ID.test(str(id)))) {
      return 'Action "fileAppsInFolder" needs a non-empty "appIds" array of app ids.';
    }
  }
  if (action === "createApp" && !params.prompt)
    return 'Action "createApp" needs a "prompt" string.';
  if (action === "createApp" && params.secrets !== undefined) {
    // Names only — a caller-supplied value would mean "write anything into this app".
    const names = params.secrets;
    if (!Array.isArray(names) || !names.every((n) => typeof n === "string")) {
      return 'Action "createApp" needs "secrets" to be an array of secret names.';
    }
    const unknown = names.filter((n) => !Object.hasOwn(APP_SECRETS, n));
    if (unknown.length) {
      return `Unknown app secret(s): ${unknown.join(", ")}. Allowed: ${Object.keys(APP_SECRETS).join(", ")}`;
    }
  }
  if (action === "sendMessage" && !params.content) {
    return 'Action "sendMessage" needs a "content" string.';
  }
  // The tool call id lands in the body, not the path, but keep it to the same
  // clean shape: it is caller-supplied and provider-assigned (`toolu_…`/`call_…`).
  if (action === "submitToolCallInput" && !CLEAN_ID.test(str(params.toolCallId))) {
    return 'Action "submitToolCallInput" needs a valid "toolCallId".';
  }
  if (action === "sendBuildSessionMessage" && !params.content) {
    return 'Action "sendBuildSessionMessage" needs a "content" string.';
  }
  if (action === "respondToBuildSession") {
    // Same clean shape as toolCallId: it is the tool call id, caller-supplied
    // and provider-assigned (`toolu_…`/`call_…`).
    if (!CLEAN_ID.test(str(params.waitpointId))) {
      return 'Action "respondToBuildSession" needs a valid "waitpointId".';
    }
    if (!RESPOND_KINDS.includes(str(params.kind))) {
      return `Action "respondToBuildSession" needs "kind" to be one of ${RESPOND_KINDS.join(", ")}.`;
    }
    if (!RESPOND_ACTIONS.includes(str(params.decision))) {
      return `Action "respondToBuildSession" needs "decision" to be one of ${RESPOND_ACTIONS.join(", ")}.`;
    }
  }
  // The grant id lands in the path, so it gets the same treatment as an app id.
  // Upstream mints it with `token_urlsafe`, which is exactly this alphabet.
  if (action === "revokeBuildSessionGrant" && !CLEAN_ID.test(str(params.grantId))) {
    return 'Action "revokeBuildSessionGrant" needs a valid "grantId".';
  }
  return null;
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const actor = await requireSessionUser();

    let payload: Params;
    try {
      payload = await req.json();
    } catch {
      return jsonError(400, "invalid_request", 'Body must be JSON, e.g. {"action":"listApps"}');
    }

    const { action: rawAction, ...params } = payload;
    const action = str(rawAction);
    console.log(`[base44/platform] START action=${action} appId=${str(params.appId) || "-"}`);

    const op = OPS[action];
    if (!op) {
      return jsonError(
        400,
        "invalid_request",
        `Unknown action "${action}". Allowed: ${Object.keys(OPS).join(", ")}`,
      );
    }

    const invalid = validate(action, params);
    if (invalid) return jsonError(400, "invalid_request", invalid);

    let link: Base44Link | null = await getLink(actor.email);
    if (link?.status !== "linked" || !link.accessToken) {
      console.warn(
        `[base44/platform] END action=${action} status=428 not_linked user=${actor.email}`,
      );
      return NextResponse.json(
        { error: "Connect your Base44 account first.", code: "not_linked" },
        { status: 428 },
      );
    }

    // Proactive re-mint. A mid-call 401 is still handled below; this just avoids
    // the common case of a token that expired while nobody was looking.
    if (link.expiresAt && link.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS) {
      link = await remint(link);
      if (!link?.accessToken) return reauthorize();
    }

    let path: string;
    let body: string | undefined;
    try {
      path = op.path(params);
      body = op.body ? JSON.stringify(op.body(params)) : undefined;
    } catch (err) {
      // A missing env var surfaces here, because the path builders read config
      // (folder id, org id). That is a deployment problem, not bad input — let it
      // reach the outer handler, which answers 501 bridge_misconfigured. Without
      // this re-throw it would masquerade as a 400 and send you hunting a caller
      // bug that does not exist.
      if (err instanceof MissingConfigError) throw err;
      console.error(`[base44/platform] failed to build request for ${action}`, err);
      return jsonError(400, "invalid_request", `Invalid parameters for "${action}"`);
    }

    let upstream: Response;
    try {
      upstream = await send(path, op, body, link.accessToken, params);

      // A 401 means the token died early — most often because the user's
      // workspace membership changed, which Base44 re-validates per request.
      // One re-mint, one retry, then ask for consent again.
      if (upstream.status === 401) {
        console.warn(`[base44/platform] ${action} got 401; re-minting once`);
        link = await remint(link);
        if (!link?.accessToken) return reauthorize();
        upstream = await send(path, op, body, link.accessToken, params);
      }
    } catch (err) {
      // `remint()` reads config, so a missing key surfaces here too. Let it reach
      // the outer handler for a 501: reporting it as a 502 would both misdiagnose
      // it and echo the env var names into the response body.
      if (err instanceof MissingConfigError) throw err;
      console.error(`[base44/platform] ${action} ${op.method} ${path} never completed`, err);
      return NextResponse.json(
        { error: `Upstream request failed: ${(err as Error).message}` },
        { status: 502 },
      );
    }

    const text = await upstream.text();
    console.log(`[base44/platform] UPSTREAM ${action} → ${upstream.status} (${Date.now() - t0}ms)`);

    if (upstream.status === 403 && text.includes("scoped to MCP")) {
      // The minted token's client_id must not start with an MCP prefix
      // (chatgpt_/claude_/cursor_/oauth_), or it is rejected everywhere except
      // /mcp. The mint endpoint stamps a non-MCP first-party id precisely to stay
      // REST-capable — a 403 here means that wiring regressed upstream.
      console.error("[base44/platform] token is MCP-scoped — mint stamped an MCP client_id");
      return NextResponse.json(
        {
          error: "This Base44 token is only valid for MCP, not the REST API.",
          detail:
            "The minted token's client_id must be a non-MCP first-party prefix (svc_delegate).",
        },
        { status: 500 },
      );
    }

    if (!upstream.ok) {
      // Surface the upstream detail: the caller is this repo's own UI.
      return NextResponse.json(
        { error: `Upstream ${upstream.status}`, detail: text.slice(0, 500) },
        { status: upstream.status },
      );
    }

    if (!text) return NextResponse.json({ ok: true });

    try {
      const parsed = JSON.parse(text);
      return NextResponse.json(op.transform ? op.transform(parsed) : parsed);
    } catch {
      console.error(`[base44/platform] END action=${action} non-JSON response`);
      return NextResponse.json(
        { error: "Upstream returned a body that is not JSON." },
        { status: 502 },
      );
    }
  } catch (err) {
    if (err instanceof MissingConfigError) {
      console.error("[base44/platform]", err.message);
      return NextResponse.json(
        { error: "The Base44 bridge is not configured on this deployment.", code: err.code },
        { status: 501 },
      );
    }
    return errorResponse(err);
  }
}

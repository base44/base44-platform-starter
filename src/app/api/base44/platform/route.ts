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
  /** `name` only. PUT, not PATCH — see docs/base44-platform-api.md. */
  renameApp: {
    method: "PUT",
    path: (p) => `/api/apps/${str(p.appId)}`,
    body: (p) => ({ name: str(p.name).trim() }),
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
};

/**
 * Actions addressing a specific app must be given a clean id — anything with a
 * slash or query character could escape the allow-listed path shape.
 */
const APP_SCOPED = [
  "getApp",
  "renameApp",
  "getConversation",
  "sendMessage",
  "getPreviewUrl",
  "deployApp",
  "submitToolCallInput",
];

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
  if (action === "renameApp") {
    const name = str(params.name).trim();
    if (!name) return 'Action "renameApp" needs a non-empty "name".';
    if (name.length > 60) return 'Action "renameApp" needs a "name" of 60 characters or fewer.';
  }
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
      return NextResponse.json(JSON.parse(text));
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

/**
 * Browser client for the Base44 app-factory bridge.
 *
 * A thin layer over one server route, `/api/base44/platform` — the allow-listed
 * REST proxy. No credential is ever present here: the integration account's
 * access token lives server-side only (see `src/lib/base44Config.ts`), which is
 * the whole point of routing through the server rather than calling Base44 from
 * the browser.
 *
 * Errors carry `code` so the UI can branch: `bridge_misconfigured` (a deployment
 * with no `BASE44_ACCESS_TOKEN`, or one Base44 has stopped accepting) means "the
 * builder is unavailable here", and `not_found` means the caller does not own the
 * app they named.
 */

export class Base44CallError extends Error {
  code: string | null;
  status: number | null;

  constructor(message: string, code: string | null, status: number | null) {
    super(message);
    this.name = "Base44CallError";
    this.code = code;
    this.status = status;
  }
}

type Json = Record<string, unknown>;

async function post(path: string, action: string, params: Json = {}): Promise<unknown> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });

  const body = (await res.json().catch(() => null)) as Json | null;
  if (!res.ok) {
    // Keep every field the server bothered to send — message, upstream detail —
    // plus the machine-readable code the connect flow branches on.
    const detail = [body?.error, body?.detail].filter(Boolean).join(" · ");
    throw new Base44CallError(
      `${action} failed: ${detail || res.statusText}`,
      (body?.code as string) ?? null,
      res.status,
    );
  }
  return body;
}

const call = (action: string, params?: Json) => post("/api/base44/platform", action, params);

/**
 * True when an error means "no builder on this deployment": the bridge is not
 * configured, or Base44 refused the integration account's token. The UI shows its
 * unavailable state for either.
 */
export function isBuilderUnavailable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "bridge_misconfigured";
}

// --- availability ----------------------------------------------------------

/**
 * Resolves when the bridge is configured; rejects with `bridge_misconfigured`
 * when it is not. Config presence only — it costs no platform call.
 */
export const builderStatus = () => call("status") as Promise<{ configured: true }>;

// --- apps ------------------------------------------------------------------

type App = { id: string; name?: string; slug?: string } & Json;

/**
 * The apps this user built, newest first. Bare array — no total count.
 *
 * Upstream every app in the workspace belongs to the one integration account, so
 * the server intersects the workspace's apps with the caller's `AppOwnership`
 * rows before answering. No role sees another user's apps, and an
 * app with no row — built before ownership was tracked — is visible to nobody.
 * Recover one by inserting its row.
 */
export const listApps = ({ limit = 20, skip = 0 } = {}) =>
  call("listApps", { limit, skip }) as Promise<App[]>;

/**
 * Installed on every app built here; the value is resolved server-side. Empty since
 * viewer tokens replaced the shared API token — apps no longer hold a credential.
 */
export const DEFAULT_APP_SECRETS: readonly string[] = Object.freeze([]);

/**
 * Creates an app and queues its first builder message, in one request.
 *
 * Everything that must exist before the first build turn goes in it:
 * `initial_message` starts that turn, while `customInstructions` and `secrets`
 * must already be on the app when it runs. The server records this user's
 * `AppOwnership` in the same request — never from here, since a client-written
 * row could claim any app.
 */
export async function createApp({
  prompt,
  name,
  customInstructions,
  secrets = DEFAULT_APP_SECRETS,
}: {
  prompt: string;
  name?: string;
  customInstructions?: string;
  /** Names from `APP_SECRETS`; pass the same list to `buildCustomInstructions`. */
  secrets?: readonly string[];
}): Promise<App> {
  const app = (await call("createApp", { prompt, name, customInstructions, secrets })) as App;

  // The platform silently drops fields it does not accept on create, and this one
  // failing is invisible — the build just ignores the instructions.
  if (customInstructions && !app?.custom_instructions) {
    console.error("[base44Platform] custom_instructions did not stick on the created app", app.id);
  }

  return app;
}

/** Renames an app. The only field the bridge will change. */
export const renameApp = (appId: string, name: string) =>
  call("renameApp", { appId, name }) as Promise<App>;

export const getApp = (appId: string) => call("getApp", { appId }) as Promise<App>;

/** The builder conversation, chronological, newest last. */
export const getConversation = (appId: string, { limit = 100, skip = 0 } = {}) =>
  call("getConversation", { appId, limit, skip });

/**
 * Sends a builder message. Fire-and-forget: the response reflects the message
 * being queued, not the build finishing. Poll the app + conversation after.
 */
export const sendMessage = (appId: string, content: string) =>
  call("sendMessage", { appId, content });

/** Boots or reuses a dev sandbox. `preview_token` has a 300s TTL — never cache. */
export const getPreviewUrl = (appId: string) => call("getPreviewUrl", { appId });

export const deployApp = (appId: string) => call("deployApp", { appId });

/**
 * The request id a submit travels under. Derived, never passed in: it must be
 * *stable per logical submit*, so a network-retried POST dedupes on
 * (request id, tool call id) instead of resuming the turn — and charging for it —
 * a second time. A tool call is resolved once, so its id is exactly that identity.
 *
 * A deliberate retry — resuming the same turn again on purpose, which must NOT
 * dedupe — would need a fresh id. Nothing offers that today, so it isn't here.
 */
export function submitRequestId(toolCallId: string): string {
  return `submit-${toolCallId}`;
}

export const submitToolCallInput = (
  appId: string,
  toolCallId: string,
  approve: boolean,
  extraUserInput: Json = {},
  { messageId }: { messageId?: string } = {},
) =>
  call("submitToolCallInput", {
    appId,
    toolCallId,
    approve,
    extraUserInput,
    messageId,
    requestId: submitRequestId(toolCallId),
  });

// --- pure helpers ----------------------------------------------------------

/**
 * Built apps are served by Base44 on its own host, not by this shell — so the
 * host is configuration, not something to derive from `location`.
 *
 * `NEXT_PUBLIC_BASE44_APP_HOST` is the apex your workspace's apps are served
 * from; a published app is a subdomain of it and a preview is a `preview--`
 * subdomain. It is `NEXT_PUBLIC_` because these URLs are built in the browser,
 * to be put in an iframe or a link — nothing secret, unlike every other
 * `BASE44_*` variable, which is server-only.
 *
 * Set it to a bare apex — `apps.example.com`. A scheme or a trailing slash is
 * tolerated and stripped, so it is one less thing to get wrong.
 *
 * Unset, both helpers return null and callers hide the preview rather than
 * linking somewhere wrong.
 */
const APP_HOST = process.env.NEXT_PUBLIC_BASE44_APP_HOST?.replace(
  /^[a-z]+:\/\/|\/+$/gi,
  "",
);

export function publishedUrl(slug?: string | null): string | null {
  if (!slug || !APP_HOST) return null;
  return `https://${slug}.${APP_HOST}/`;
}

export function previewUrl(slug?: string | null): string | null {
  if (!slug || !APP_HOST) return null;
  return `https://preview--${slug}.${APP_HOST}/`;
}

/**
 * Message `content` arrives as a string, a dict, or provider content blocks
 * depending on the message. Flatten all of it to display text.
 */
export function messageText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : (b as { text?: string })?.text || ""))
      .filter(Boolean)
      .join("\n\n");
  }
  const text = (content as { text?: string })?.text;
  return typeof text === "string" ? text : "";
}

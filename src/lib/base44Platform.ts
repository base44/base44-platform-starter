/**
 * Browser client for the Base44 app-factory bridge.
 *
 * A thin layer over the two server routes: `/api/base44/link` (provision + mint)
 * and `/api/base44/platform` (the allow-listed REST proxy). No credential is ever
 * present here — the workspace key and the per-user token live server-side only
 * (see `src/lib/base44Link.ts`), which is the whole point of routing through the
 * server rather than calling Base44 from the browser.
 *
 * Errors carry `code` so the UI can branch: `not_linked` and
 * `reauthorize_required` mean "show the Connect button", and
 * `bridge_misconfigured` (a deployment with no `BASE44_SVC_KEY`) is folded into
 * the same bucket by `isNotLinkedError()`.
 */

/** The workspace folder every app this builder creates lives in. Display text only. */
export const APPS_FOLDER_NAME = "sunny_widgets";

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
const link = (action: string, params?: Json) => post("/api/base44/link", action, params);

/**
 * True when an error means "no live Base44 link" — never connected, grant
 * expired, or the deployment has no workspace key. The UI turns all three into a
 * Connect button.
 */
export function isNotLinkedError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return (
    code === "not_linked" || code === "reauthorize_required" || code === "bridge_misconfigured"
  );
}

// --- linking ---------------------------------------------------------------

export type LinkStatus = {
  linked: boolean;
  base44_user_email: string | null;
  organization_id: string | null;
};

/** Whether this Sunny user has a live Base44 link. */
export const base44LinkStatus = () => link("status") as Promise<LinkStatus>;

/** Provision the service principal + mint. Takes 5–15s; do not retry blindly. */
export const connectBase44 = () => link("connect") as Promise<LinkStatus>;

export const disconnectBase44 = () => link("disconnect") as Promise<LinkStatus>;

// --- apps ------------------------------------------------------------------

type App = { id: string; name?: string; slug?: string } & Json;

export const fileAppsInFolder = (appIds: string[]) => call("fileAppsInFolder", { appIds });

/**
 * Apps in the `sunny_widgets` folder, newest first. Bare array upstream — no
 * total count. **Workspace-global**: every app in the folder regardless of who
 * built it, so UI surfaces should prefer `listAppsForUser`.
 */
export const listApps = ({ limit = 20, skip = 0 } = {}) =>
  call("listApps", { limit, skip }) as Promise<App[]>;

/**
 * The apps the current user may see, newest first.
 *
 * Platform apps carry no per-Sunny-user owner — they live under one workspace —
 * so ownership lives in the local `AppOwnership` entity, whose RLS scopes a list
 * to rows the caller created. Read the folder from the platform, keep the ids the
 * user owns. Admins skip the filter and see everything in the folder, including
 * legacy apps built before ownership was tracked.
 */
export async function listAppsForUser({ limit = 20, skip = 0 } = {}): Promise<App[]> {
  const apps = await listApps({ limit, skip });

  // Imported lazily so this module stays usable from server code that has no
  // business importing the browser entity client.
  const [{ AppOwnership, me }] = await Promise.all([import("@/lib/entityClient")]);

  let user: { role?: string } | null = null;
  try {
    user = (await me()) as { role?: string };
  } catch {
    // Unauthenticated — fall through to the owner filter, which returns nothing
    // for an unknown user rather than leaking the folder.
  }
  if (user?.role === "admin") return apps;

  const owned = await AppOwnership.list();
  const ownedIds = new Set(owned.map((o) => o.app_id as string));
  return apps.filter((a) => ownedIds.has(a.id));
}

/**
 * Installed on every app built here; the value is resolved server-side. Empty since
 * viewer tokens replaced the shared API token — apps no longer hold a credential.
 */
export const DEFAULT_APP_SECRETS: readonly string[] = Object.freeze([]);

/**
 * Creates an app and queues its first builder message, then files it and records
 * ownership.
 *
 * Three calls, not one, and the order matters:
 *   1. `createApp` — everything that must exist before the first build turn goes
 *      in this one request: `initial_message` starts that turn, while
 *      `customInstructions` and `secrets` must already be on the app when it runs.
 *   2. `fileAppsInFolder` — `/api/apps` has no folder field on create, so a fresh
 *      app is briefly unfiled, and `listApps` reads out of the folder. An unfiled
 *      app is invisible in My apps, so this failing is loud.
 *   3. `AppOwnership` — without it only admins would see the app.
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

  try {
    await fileAppsInFolder([app.id]);
  } catch (err) {
    throw new Error(
      `App ${app.id} was created but could not be filed into ${APPS_FOLDER_NAME}: ` +
        `${(err as Error).message}`,
    );
  }

  // The platform silently drops fields it does not accept on create, and this one
  // failing is invisible — the build just ignores the instructions.
  if (customInstructions && !app?.custom_instructions) {
    console.error("[base44Platform] custom_instructions did not stick on the created app", app.id);
  }

  try {
    const { AppOwnership } = await import("@/lib/entityClient");
    await AppOwnership.create({ app_id: app.id, app_name: app.name || name || "Untitled" });
  } catch (err) {
    console.error(
      `[base44Platform] app ${app.id} was built but ownership was not recorded — ` +
        `only admins will see it`,
      err,
    );
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

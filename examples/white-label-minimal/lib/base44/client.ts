import "server-only";
import type { App, ToolInput } from "../types";
import { getBase44Config } from "./config";
import { customInstructions } from "./custom-instructions";
import { Base44Error } from "./error";

// Writes return nothing to the browser; live updates bring the new state.
const post = (path: string, body: object, headers?: Record<string, string>) =>
  request(path, { body, headers, timeout: 120_000 }).then(() => ({}));
const app = (id: string) => `/api/apps/${encodeURIComponent(id)}`;

// The Base44 calls Tiny makes, in the order of "The build turn":
// https://docs.base44.com/developers/white-label/the-build-turn
// Every app belongs to the integration account, so the caller must check which
// builder owns an app before calling these (see lib/server/api-handler.ts).
export const base44 = {
  // 1. Create the app from a prompt. The build starts inside this call.
  createApp: async (prompt: string) =>
    toApp(await request("/api/apps", {
      body: {
        // Without it the app lands in the account's personal workspace.
        organization_id: getBase44Config().workspaceId,
        name: prompt.trim().slice(0, 80),
        user_description: prompt,
        initial_message: { content: prompt },
        custom_instructions: customInstructions,
        prevent_iframe_embedding: false,
      },
      timeout: 120_000,
    })),

  // Each later prompt goes through Send chat message.
  sendMessage: (id: string, content: string) => post(`${app(id)}/chat/message`, { content }),

  // 2. Watch it build. Tiny reads status.state here, and receives the chat over
  //    the live-updates socket (openLiveUpdates below).
  getApp: async (id: string) => toApp(await request(app(id))),

  // 3. Answer the agent's questions: the UI for each waiting_on.kind is
  //    components/Question.tsx. 4. Send the answer back. A request ID that stays
  //    the same across retries lets Base44 deduplicate them.
  submitToolCallInput: (p: ToolInput) =>
    post(`${app(p.appId)}/chat/submit-tool-call-input`, {
      tool_call_id: p.toolCallId,
      message_id: p.messageId,
      action: p.approve ? "approved" : "rejected",
      extra_user_input: p.extraUserInput,
    }, { "X-Request-ID": `submit-${p.toolCallId}` }),

  // 5. Show the preview: Tiny signs the builder into it with getEmbedUrl below,
  //    so private apps open without their own sign-in page.

  // 6. Publish the app. A 404 from Get published URL means "nothing to link to yet".
  deployApp: (id: string) => post(`${app(id)}/deploy`, {}),

  async getPublishedUrl(id: string) {
    try {
      const data = await request(`/api/apps/platform/${encodeURIComponent(id)}/published-url`);
      return { url: httpsUrl(data?.url).href };
    } catch (error) {
      if (error instanceof Base44Error && error.status === 404) return { url: null };
      throw error;
    }
  },
};

// "Embed the app": https://docs.base44.com/developers/white-label/embed-the-app
// Signs a viewer into one version of an app with a URL that works once and
// expires in 60 seconds. The email must come from your session, never the browser.
// The workspace key needs the Provision app users and Mint embed sign-in tokens permissions.
export async function getEmbedUrl(
  appId: string,
  email: string,
  target: "live_site" | "latest_preview" | "live_preview",
): Promise<{ url: string | null }> {
  const auth = { api_key: workspaceKey() };
  try {
    // Idempotent, so it is safe before every mint.
    await request(`${app(appId)}/users/provisions`, { body: { email, role: "user" }, auth, timeout: 15_000 });
    const minted = await request(`${app(appId)}/embed-tokens`, { body: { email, target }, auth, timeout: 15_000 });
    return { url: typeof minted?.embed_url === "string" ? minted.embed_url : null };
  } catch (error) {
    // For example app_has_no_slug before the first build: there is nothing to show yet.
    if (error instanceof Base44Error && error.status >= 400 && error.status < 500) {
      console.warn(`[embed] ${appId} ${target}: ${error.status} ${error.code ?? ""}`);
      return { url: null };
    }
    throw error;
  }
}

// Live updates: a read-only socket session for one app. The browser gets only
// the session token. The workspace key needs the apps:watch scope.
export async function openLiveUpdates(appId: string) {
  try {
    const data = await request("/api/service/socket-sessions", {
      body: { app_ids: [appId] },
      auth: { Authorization: `Bearer ${workspaceKey()}` },
    });
    return { serverUrl: new URL(data.socket_url).origin, sessionToken: String(data.session_token) };
  } catch (error) {
    if (!(error instanceof Base44Error) || error.status === 504) throw error;
    // Base44's reason, as a setup step for whoever runs the server.
    const problem = error.status === 401 ? "Base44 rejected BASE44_SVC_KEY."
      : error.code === "scope_required" ? "Live updates need a workspace key with the apps:watch scope."
      : error.code === "whitelabel_sockets_disabled" ? "Live updates are not enabled for this Base44 workspace yet."
      : error.code === "app_not_allowed" ? "The workspace key cannot watch this app. Use a key from the app's workspace."
      : `Live updates unavailable: Base44 returned ${error.status}.`;
    throw new Base44Error(problem, 503);
  }
}

function workspaceKey() {
  const key = getBase44Config().workspaceKey;
  if (!key) throw new Base44Error("Previews and live updates need BASE44_SVC_KEY on the server.", 503);
  return key;
}

// Copy only the fields the browser needs; never pass a raw Base44 object through.
function toApp(app: App): App {
  if (typeof app?.id !== "string") throw new Base44Error("Base44 returned an app without an ID.");
  const { id, name, slug, preview_screenshot_url, logo_url, user_description, status } = app;
  return {
    id, name, slug, preview_screenshot_url, logo_url, user_description,
    status: status && { state: status.state, error_source: status.error_source },
  };
}

// Accept only HTTPS URLs without embedded credentials.
function httpsUrl(raw: unknown) {
  if (typeof raw !== "string" || !raw) throw new Base44Error("Base44 has not returned a URL yet. Try again shortly.");
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Base44Error("Base44 returned an invalid URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Base44Error("Base44 returned an unsafe URL.");
  return url;
}

// What a Base44 status means for the person using the app.
const hints: Record<number, string> = {
  401: "Check the server's Base44 access token.",
  403: "Check the access token's workspace permissions.",
  409: "The app is not ready for this yet. Ask the agent to fix it.",
  429: "Rate limit reached. Wait before trying again.",
};

type Options = {
  body?: object;
  headers?: Record<string, string>;
  timeout?: number;
  // How to authenticate. Defaults to the integration account's token.
  auth?: Record<string, string>;
};

// Calls Base44, by default as the integration account. POST when there is a
// body, GET otherwise. Every failure is a Base44Error that is safe to show.
async function request(path: string, { body, headers, timeout = 30_000, auth }: Options = {}) {
  const { host, token, workspaceId } = getBase44Config();
  let response: Response;
  try {
    response = await fetch(`${host}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(auth ?? { Authorization: `Bearer ${token}` }),
        // Capability checks read the active workspace, not the request body.
        "X-Active-Workspace-Id": workspaceId,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body && JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    // Never include fetch errors: they can contain a URL or upstream credentials.
    throw new Base44Error("Base44 did not return a response. The operation may still be running.", 504);
  }
  if (!response.ok) {
    const { status } = response;
    const code = await response.json().then((b) => b?.error?.code, () => undefined);
    const hint = hints[status] ?? "Refresh the app state before repeating an operation.";
    throw new Base44Error(`Base44 returned ${status}. ${hint}`, status, typeof code === "string" ? code : undefined);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Base44Error("Base44 returned an unreadable response. The outcome is uncertain.");
  }
}

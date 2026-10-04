import "server-only";
import type { App, ToolInput } from "../types";
import { getBase44Config } from "./config";
import { customInstructions } from "./custom-instructions";
import { Base44Error } from "./error";

// Every Base44 call Tiny makes, in the order of "The build turn":
// https://docs.base44.com/developers/white-label/the-build-turn
//
// Every app belongs to the integration account, so Base44 cannot tell builders
// apart. Before calling these, the caller checks that the builder owns the app
// and that its ID is a plain ID (lib/server/api-handler.ts).

// Create app, Send chat message, Submit tool-call input and Deploy an app wait
// on a whole build turn, which can take minutes.
const BUILD_TURN_TIMEOUT = 120_000;

// 1. Create the app from a prompt. The build starts inside this call.
export async function createApp(prompt: string): Promise<App> {
  const { workspaceId } = getBase44Config();
  const app = await base44("/api/apps", {
    method: "POST",
    body: {
      // Without it, the app lands in the account's personal workspace.
      organization_id: workspaceId,
      name: prompt.slice(0, 80),
      user_description: prompt,
      initial_message: { content: prompt },
      custom_instructions: customInstructions,
      prevent_iframe_embedding: false,
    },
    timeout: BUILD_TURN_TIMEOUT,
  });
  return toApp(app);
}

// Every later prompt goes through Send chat message.
export async function sendMessage(appId: string, content: string) {
  await base44(`/api/apps/${appId}/chat/message`, {
    method: "POST",
    body: { content },
    timeout: BUILD_TURN_TIMEOUT,
  });
  return {};
}

// 2. Watch it build: status.state is processing, ready or error.
//    The chat itself arrives over live updates (openLiveUpdates below).
export async function getApp(appId: string): Promise<App> {
  const app = await base44(`/api/apps/${appId}`);
  return toApp(app);
}

// 3. Answer the agent's questions: the UI is components/Question.tsx.
// 4. Send the answer back. The request ID must stay the same when you retry,
//    so Base44 resumes the turn only once.
export async function submitToolCallInput(input: ToolInput) {
  await base44(`/api/apps/${input.appId}/chat/submit-tool-call-input`, {
    method: "POST",
    headers: { "X-Request-ID": `submit-${input.toolCallId}` },
    body: {
      tool_call_id: input.toolCallId,
      message_id: input.messageId,
      action: input.approve ? "approved" : "rejected",
      extra_user_input: input.extraUserInput,
    },
    timeout: BUILD_TURN_TIMEOUT,
  });
  return {};
}

// 5. Show the preview: see getEmbedUrl below, which signs the builder in.

// 6. Publish the app.
export async function deployApp(appId: string) {
  await base44(`/api/apps/${appId}/deploy`, { method: "POST", body: {}, timeout: BUILD_TURN_TIMEOUT });
  return {};
}

// A 404 means there is nothing to link to yet.
export async function getPublishedUrl(appId: string) {
  try {
    const data = await base44(`/api/apps/platform/${appId}/published-url`);
    return { url: httpsUrl(data.url) };
  } catch (error) {
    if (error instanceof Base44Error && error.status === 404) {
      return { url: null };
    }
    throw error;
  }
}

// "Embed the app": https://docs.base44.com/developers/white-label/embed-the-app
// Signs a viewer into one version of an app. The URL works once and expires in
// 60 seconds. The email must come from your session, never from the browser.
export async function getEmbedUrl(
  appId: string,
  email: string,
  target: "live_site" | "latest_preview" | "live_preview",
) {
  const auth = { api_key: workspaceKey() };
  try {
    // Provisioning is idempotent, so it is safe before every mint.
    await base44(`/api/apps/${appId}/users/provisions`, {
      method: "POST",
      auth,
      body: { email, role: "user" },
    });
    const token = await base44(`/api/apps/${appId}/embed-tokens`, {
      method: "POST",
      auth,
      body: { email, target },
    });
    return { url: token.embed_url as string };
  } catch (error) {
    // For example app_has_no_slug before the first build: nothing to show yet.
    if (error instanceof Base44Error && error.status < 500) {
      console.warn(`[embed] ${appId} ${target}: ${error.status} ${error.code ?? ""}`);
      return { url: null };
    }
    throw error;
  }
}

// Live updates: a read-only socket session for one app. The browser receives
// only the session token, never the workspace key.
export async function openLiveUpdates(appId: string) {
  try {
    const session = await base44("/api/service/socket-sessions", {
      method: "POST",
      auth: { Authorization: `Bearer ${workspaceKey()}` },
      body: { app_ids: [appId] },
    });
    return { serverUrl: new URL(session.socket_url).origin, sessionToken: session.session_token as string };
  } catch (error) {
    if (!(error instanceof Base44Error) || error.status === 504) throw error;
    throw new Base44Error(liveUpdatesProblem(error), 503);
  }
}

// Why Base44 refused a live-updates session, as a setup step for whoever runs the server.
function liveUpdatesProblem(error: Base44Error) {
  if (error.status === 401) return "Base44 rejected BASE44_SVC_KEY.";
  if (error.code === "scope_required") return "Live updates need a workspace key with the apps:watch scope.";
  if (error.code === "whitelabel_sockets_disabled") return "Live updates are not enabled for this Base44 workspace yet.";
  if (error.code === "app_not_allowed") return "The workspace key cannot watch this app. Use a key from the app's workspace.";
  return `Live updates unavailable: Base44 returned ${error.status}.`;
}

// The workspace key is for embedding and live updates. Everything else uses the
// integration account's personal access token.
function workspaceKey() {
  const { workspaceKey } = getBase44Config();
  if (!workspaceKey) {
    throw new Base44Error("Previews and live updates need BASE44_SVC_KEY on the server.", 503);
  }
  return workspaceKey;
}

// Send the browser only the fields it uses, never the raw Base44 app.
function toApp(app: App): App {
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    preview_screenshot_url: app.preview_screenshot_url,
    logo_url: app.logo_url,
    user_description: app.user_description,
    status: app.status && { state: app.status.state, error_source: app.status.error_source },
  };
}

function httpsUrl(url: string) {
  if (!url.startsWith("https://")) {
    throw new Base44Error("Base44 returned an unsafe URL.");
  }
  return url;
}

type Request = {
  method?: "GET" | "POST";
  body?: object;
  headers?: Record<string, string>;
  // Defaults to the integration account's personal access token.
  auth?: Record<string, string>;
  timeout?: number;
};

// Calls Base44 from the server. Errors are Base44Errors that are safe to show.
async function base44(path: string, { method = "GET", body, headers, auth, timeout = 30_000 }: Request = {}) {
  const { host, token, workspaceId } = getBase44Config();

  let response: Response;
  try {
    response = await fetch(`${host}${path}`, {
      method,
      headers: {
        ...(auth ?? { Authorization: `Bearer ${token}` }),
        // Base44 checks permissions against the active workspace, not the body.
        "X-Active-Workspace-Id": workspaceId,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    // Not the fetch error itself: it can contain the URL or a credential.
    throw new Base44Error("Base44 did not return a response. The operation may still be running.", 504);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Base44Error(`Base44 returned ${response.status}.`, response.status, data?.error?.code);
  }
  return data;
}

"use server";
// Tiny's calls to Base44. They run on the server, so the credentials never reach the browser.
// Docs: https://docs.base44.com/developers/white-label/the-build-turn

export type App = { id: string; name: string };
export type ToolCallAnswer = { toolCallId: string; messageId: string; approve: boolean; extraUserInput?: object };
type Options = { body?: object; headers?: Record<string, string> };

const host = process.env.BASE44_PLATFORM_HOST!;
const workspaceId = process.env.BASE44_WORKSPACE_ID!;
const accessToken = { Authorization: `Bearer ${process.env.BASE44_ACCESS_TOKEN}` };
const serviceKey = { Authorization: `Bearer ${process.env.BASE44_SVC_KEY}` };
const embedKey = { api_key: process.env.BASE44_SVC_KEY! };

// Base44 won't sign the app's owner into an embed, so previews sign in as this app user.
const PREVIEW_USER = "viewer@example.com";

const customInstructions = `The user talks to you only through Tiny Sunny's chat. They have no Base44 editor,
dashboard, code view or Publish button, so never point them to one. Publishing isn't available yet:
if they ask, say so.`;

export async function createApp(prompt: string): Promise<App> {
  const app = await call("/api/apps", {
    body: { organization_id: workspaceId, user_description: prompt, initial_message: { content: prompt }, custom_instructions: customInstructions },
  });
  // Base44 names the app a few seconds later; the prompt stands in until then.
  return { id: app.id, name: prompt.slice(0, 80) };
}

// With BASE44_ACCOUNT_EMAIL set, only the integration account's apps: previews of other accounts' apps fail.
export async function listApps(): Promise<App[]> {
  const apps: (App & { created_by: string })[] = await call("/api/apps?sort=-created_date");
  const account = process.env.BASE44_ACCOUNT_EMAIL;
  return apps.filter((app) => !account || app.created_by === account).map(({ id, name }) => ({ id, name }));
}

// The browser gets only a short-lived token for watching this one app.
export async function openLiveSession(appId: string) {
  const session = await call("/api/service/socket-sessions", { body: { app_ids: [appId] }, headers: serviceKey });
  return { serverUrl: new URL(session.socket_url).origin, sessionToken: session.session_token as string };
}

export async function sendMessage(appId: string, content: string) {
  await start(`/api/apps/${appId}/chat/message`, { body: { content } });
}

// The same request id on a retry, so Base44 resumes the turn only once.
export async function submitToolCallInput(appId: string, answer: ToolCallAnswer) {
  await start(`/api/apps/${appId}/chat/submit-tool-call-input`, {
    body: {
      tool_call_id: answer.toolCallId,
      message_id: answer.messageId,
      action: answer.approve ? "approved" : "rejected",
      extra_user_input: answer.extraUserInput ?? {},
    },
    headers: { ...accessToken, "X-Request-ID": `submit-${answer.toolCallId}` },
  });
}

// A one-time URL, valid for 60 seconds. Null when the app has no build yet.
export async function getPreviewUrl(appId: string, target: "latest_preview" | "live_preview") {
  await request(`/api/apps/${appId}/users/provisions`, { body: { email: PREVIEW_USER, role: "user" }, headers: embedKey });
  // Before the first build the latest preview is a 404 page. A URL works once, so check one and return another.
  if (target === "latest_preview" && (await fetch(await embedUrl(appId, target))).status === 404) return null;
  return embedUrl(appId, target);
}

// Booting the sandbox can outlast a hosted function, so wait a few seconds and let the caller ask again.
export async function bootLivePreview(appId: string) {
  const response = await within(5000, request(`/api/apps/${appId}/sandbox/preview-url`));
  return !!response?.ok;
}

async function embedUrl(appId: string, target: string) {
  const data = await call(`/api/apps/${appId}/embed-url`, { body: { email: PREVIEW_USER, target }, headers: embedKey });
  return data.embed_url as string;
}

function request(path: string, { body, headers = accessToken }: Options = {}) {
  return fetch(`${host}${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...headers, "X-Active-Workspace-Id": workspaceId, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
}

async function call(path: string, options?: Options) {
  const response = await request(path, options);
  if (!response.ok) throw new Error(`Base44 ${path} failed: ${response.status}`);
  return response.json();
}

// Send and submit stay open for the whole build turn, and Next.js runs a page's server calls one at
// a time. Wait only long enough to catch a refusal; the live updates show the rest.
async function start(path: string, options: Options) {
  const response = await within(3000, request(path, options));
  if (response && !response.ok) throw new Error(`Base44 ${path} failed: ${response.status}`);
}

function within(ms: number, response: Promise<Response>) {
  response.catch(() => {});
  return Promise.race([response, new Promise<null>((resolve) => setTimeout(resolve, ms, null))]);
}

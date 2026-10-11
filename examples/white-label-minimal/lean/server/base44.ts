"use server";
// Tiny's server functions: Base44's REST calls, one function each. They run only on
// the server, with Tiny's credentials, so the browser never sees them.
// Docs: https://docs.base44.com/developers/white-label/the-build-turn
import type { App, ToolCallAnswer } from "../types";

const host = process.env.BASE44_PLATFORM_HOST!;
const workspaceId = process.env.BASE44_WORKSPACE_ID!;

// The Apps API takes the integration account's personal access token.
function headers(json = true) {
  return {
    Authorization: `Bearer ${process.env.BASE44_ACCESS_TOKEN}`,
    "X-Active-Workspace-Id": workspaceId,
    ...(json && { "Content-Type": "application/json" }),
  };
}

// Custom instructions: what the builder should know about Tiny, sent with every new app.
const customInstructions = `The user talks to you only through Tiny Sunny's chat. They have no Base44 editor,
dashboard, code view or Publish button, so never point them to one. Publishing isn't available yet:
if they ask, say so.`;

// Create app. The build starts inside this call.
export async function createApp(prompt: string): Promise<App> {
  const response = await fetch(`${host}/api/apps`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ organization_id: workspaceId, name: prompt.slice(0, 80), initial_message: { content: prompt }, custom_instructions: customInstructions }),
  });
  if (!response.ok) throw new Error(`Create app failed: ${response.status}`);
  const app = await response.json();
  return { id: app.id, name: app.name };
}

// List apps, newest first. With BASE44_ACCOUNT_EMAIL set, only the ones the integration
// account created: the workspace can hold apps by other accounts, whose previews this
// token cannot open.
export async function listApps(): Promise<App[]> {
  const response = await fetch(`${host}/api/apps?sort=-created_date`, { headers: headers(false) });
  if (!response.ok) throw new Error(`List apps failed: ${response.status}`);
  const apps: { id: string; name: string; created_by: string }[] = await response.json();
  const account = process.env.BASE44_ACCOUNT_EMAIL;
  return apps.filter((app) => !account || app.created_by === account).map((app) => ({ id: app.id, name: app.name }));
}

// Create socket session: a read-only live-updates session for one app. It takes the
// workspace key; the browser gets only the session token.
export async function openLiveSession(appId: string) {
  const response = await fetch(`${host}/api/service/socket-sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.BASE44_SVC_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ app_ids: [appId] }),
  });
  if (!response.ok) throw new Error(`Socket session failed: ${response.status}`);
  const session = await response.json();
  return { serverUrl: new URL(session.socket_url).origin, sessionToken: session.session_token as string };
}

// Send chat message: every prompt after the first.
export async function sendMessage(appId: string, content: string) {
  const request = fetch(`${host}/api/apps/${appId}/chat/message`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ content }),
  });
  await acceptedOrRunning(request, "Send message");
}

// Submit tool-call input: answer a question the builder waits on, or decline it.
// The request id stays the same on a retry, so Base44 resumes the turn only once.
export async function submitToolCallInput(appId: string, answer: ToolCallAnswer) {
  const request = fetch(`${host}/api/apps/${appId}/chat/submit-tool-call-input`, {
    method: "POST",
    headers: { ...headers(), "X-Request-ID": `submit-${answer.toolCallId}` },
    body: JSON.stringify({
      tool_call_id: answer.toolCallId,
      message_id: answer.messageId,
      action: answer.approve ? "approved" : "rejected",
      extra_user_input: answer.extraUserInput ?? {},
    }),
  });
  await acceptedOrRunning(request, "Submit answer");
}

// Until Tiny has sign-in, everyone views the preview as this one app user. Base44 will
// not sign in the app's owner, editors or service accounts through an embed.
const PREVIEW_VIEWER = "viewer@example.com";

// Embed the app, signed in as the viewer: the latest build, or the live sandbox that
// shows a build as it runs (boot it first). Provision the viewer, then mint a one-time
// URL (valid 60 seconds). A new app has no build yet and its latest preview answers 404,
// so check with one URL and hand out a fresh one; null means there is nothing to show yet.
export async function getPreviewUrl(appId: string, target: "latest_preview" | "live_preview") {
  await fetch(`${host}/api/apps/${appId}/users/provisions`, {
    method: "POST",
    headers: embedHeaders(),
    body: JSON.stringify({ email: PREVIEW_VIEWER, role: "user" }),
  });
  if (target === "latest_preview" && (await fetch(await embedUrl(appId, target))).status === 404) return null;
  return embedUrl(appId, target);
}

function embedHeaders() {
  return { api_key: process.env.BASE44_SVC_KEY!, "X-Active-Workspace-Id": workspaceId, "Content-Type": "application/json" };
}

async function embedUrl(appId: string, target: string) {
  const response = await fetch(`${host}/api/apps/${appId}/embed-url`, {
    method: "POST",
    headers: embedHeaders(),
    body: JSON.stringify({ email: PREVIEW_VIEWER, target }),
  });
  if (!response.ok) throw new Error(`Embed URL failed: ${response.status}`);
  return (await response.json()).embed_url as string;
}

// The live sandbox is off until something boots it, and booting can take half a minute:
// longer than a hosted server function may run. Ask it to boot, wait a few seconds, and
// let the caller ask again until it is up.
export async function bootLivePreview(appId: string) {
  const request = fetch(`${host}/api/apps/${appId}/sandbox/preview-url`, { headers: headers(false) });
  request.catch(() => {});
  const response = await Promise.race([request, new Promise<null>((resolve) => setTimeout(resolve, 5000, null))]);
  return !!response?.ok;
}

// Send and Submit stay open for the whole turn, and Next.js runs a page's server
// calls one at a time. Wait only long enough to catch a refusal; live updates show the rest.
async function acceptedOrRunning(request: Promise<Response>, call: string) {
  const response = await Promise.race([request, new Promise<null>((resolve) => setTimeout(resolve, 3000, null))]);
  if (response && !response.ok) throw new Error(`${call} failed: ${response.status}`);
}

"use server";
import type { SocketSession } from "@base44/platform/react";

export type App = { id: string; name: string };
export type ToolCallAnswer = { toolCallId: string; messageId: string; approve: boolean; extraUserInput?: object };
type Options = { body?: object; headers?: Record<string, string> };

const host = process.env.BASE44_PLATFORM_HOST!;
const workspaceId = process.env.BASE44_WORKSPACE_ID!;
const accessToken = { Authorization: `Bearer ${process.env.BASE44_ACCESS_TOKEN}` };

const PREVIEW_USER = "viewer@example.com";

const customInstructions = `The user talks to you only through Tiny Sunny's chat. They have no Base44 editor,
dashboard, code view or Publish button, so never point them to one. Publishing isn't available yet:
if they ask, say so.`;

export async function createApp(prompt: string): Promise<App> {
  const app = await call("/api/apps", {
    body: { organization_id: workspaceId, user_description: prompt, initial_message: { content: prompt }, custom_instructions: customInstructions },
  });
  return { id: app.id, name: prompt.slice(0, 80) };
}

export async function listApps(): Promise<App[]> {
  const apps: (App & { app_type: string; created_by: string })[] = await call("/api/apps?sort=-created_date");
  const account = process.env.BASE44_ACCOUNT_EMAIL;
  return apps
    .filter((app) => app.app_type === "user_app" && (!account || app.created_by === account))
    .map(({ id, name }) => ({ id, name }));
}

// The body holds only a session token, never the access token, so it goes to the browser unchanged.
export async function openLiveSession(appId: string): Promise<SocketSession> {
  return call("/api/v1/socket-sessions", { body: { app_ids: [appId] } });
}

export async function sendMessage(appId: string, content: string) {
  const sent = request(`/api/apps/${appId}/chat/message`, { body: { content } });
  await waitForRefusal("/chat/message", sent);
}

export async function submitToolCallInput(appId: string, answer: ToolCallAnswer) {
  const sent = request(`/api/apps/${appId}/chat/submit-tool-call-input`, {
    body: {
      tool_call_id: answer.toolCallId,
      message_id: answer.messageId,
      action: answer.approve ? "approved" : "rejected",
      extra_user_input: answer.extraUserInput ?? {},
    },
    headers: { ...accessToken, "X-Request-ID": `submit-${answer.toolCallId}` },
  });
  await waitForRefusal("/chat/submit-tool-call-input", sent);
}

// A new app has no latest preview until its first build gives it a slug: Base44 answers 400
// app_has_no_slug, so there is no URL yet rather than an error.
export async function getPreviewUrl(appId: string, target: "latest_preview" | "live_preview"): Promise<string | null> {
  await request(`/api/apps/${appId}/users/provisions`, { body: { email: PREVIEW_USER, role: "user" } });
  const response = await request(`/api/apps/${appId}/embed-url`, { body: { email: PREVIEW_USER, target } });
  if (response.status === 400) {
    const { error } = await response.json().catch(() => ({}));
    if (error?.code === "app_has_no_slug") return null;
  }
  if (!response.ok) throw new Error(`Base44 /api/apps/${appId}/embed-url failed: ${response.status}`);
  const data = await response.json();
  return data.embed_url as string;
}

// Base44 holds a chat request open for the whole turn, and Next.js runs one server action at a time,
// so waiting for it would hold every later call. Wait only long enough to catch a refusal.
async function waitForRefusal(name: string, sent: Promise<Response>) {
  const timeout = new Promise<null>((resolve) => setTimeout(resolve, 3000, null));
  const response = await Promise.race([sent, timeout]);
  if (response === null) {
    // The caller has moved on, so a later failure can only be logged.
    sent.then(
      (late) => {
        if (!late.ok) console.error(`Base44 ${name} failed: ${late.status}`);
      },
      (error) => console.error(`Base44 ${name} failed:`, error),
    );
    return;
  }
  if (!response.ok) throw new Error(`Base44 ${name} failed: ${response.status}`);
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

import "server-only";
import type { App, ToolInput } from "../../types";
import { getBase44Config } from "./config";
import { customInstructions } from "./custom-instructions";
import { Base44Error } from "./error";
import { base44 } from "./request";

// "The build turn": https://docs.base44.com/developers/white-label/the-build-turn
// The calls a builder's turn is made of, in order.
//
// Every app belongs to the integration account, so Base44 cannot tell builders
// apart. Before calling these, the caller checks that the builder owns the app
// and that its ID is a plain ID (server/actions.ts).

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
//    The chat itself arrives over live updates (live-updates.ts).
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

// 5. Show the preview: see embed.ts, which signs the builder in.

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

// Send the browser only the fields it uses, never the raw Base44 app.
function toApp(app: App): App {
  return {
    id: app.id,
    name: app.name,
    preview_screenshot_url: app.preview_screenshot_url,
    status: app.status && { state: app.status.state, error_source: app.status.error_source },
  };
}

function httpsUrl(url: string) {
  if (!url.startsWith("https://")) {
    throw new Base44Error("Base44 returned an unsafe URL.");
  }
  return url;
}

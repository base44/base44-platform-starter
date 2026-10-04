import "server-only";
import type { App, ToolInput } from "../types";
import { getBase44Config } from "./config";
import { customInstructions } from "./custom-instructions";
import { Base44Error } from "./error";
import { base44Fetch as request } from "./http";

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
  //    the live-updates socket (lib/base44/socket-session.ts).
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

  // 5. Show the preview. The preview_token is short-lived: never cache or log it.
  async getPreviewUrl(id: string) {
    const data = await request(`${app(id)}/sandbox/preview-url`, { timeout: 120_000 });
    const url = httpsUrl(data?.preview_url);
    if (data.preview_token) url.searchParams.set("_preview_token", data.preview_token);
    url.searchParams.set("server_url", url.origin);
    url.searchParams.set("hide_badge", "true");
    url.searchParams.set("analytics-enable", "false");
    return { url: url.href };
  },

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

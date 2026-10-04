import "server-only";
import { CONVERSATION_PAGE_SIZE } from "../chat/conversation";
import type { App, Message, ToolInput } from "../types";
import { customInstructions } from "./custom-instructions";
import { Base44Error } from "./error";
import { base44Fetch } from "./http";

// The Base44 endpoints Tiny uses, called as one builder's service user.
// Full reference: https://app.base44.com/api/openapi.json
export function createBase44Client(accessToken: string) {
  const request = (path: string, options: Parameters<typeof base44Fetch>[1] = {}) =>
    base44Fetch(path, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...options.headers } });
  // Writes return nothing to the browser; Tiny re-reads state by polling instead.
  const post = (path: string, body: object, headers?: Record<string, string>) =>
    request(path, { body, headers, timeout: 120_000 }).then(() => ({}));
  const app = (id: string) => `/api/apps/${encodeURIComponent(id)}`;

  return {
    createApp: async (prompt: string) =>
      toApp(await request("/api/apps", {
        body: {
          name: prompt.trim().slice(0, 80),
          user_description: prompt,
          initial_message: { content: prompt },
          custom_instructions: customInstructions,
          prevent_iframe_embedding: false,
        },
        timeout: 120_000,
      })),

    getApp: async (id: string) => toApp(await request(app(id))),

    // skip counts backward from the newest message.
    async getConversation(id: string, skip: number) {
      const data = await request(`${app(id)}/chat/full-conversation?limit=${CONVERSATION_PAGE_SIZE}&skip=${skip}`, {
        timeout: 60_000,
      });
      const messages = data?.messages ?? [];
      if (!Array.isArray(messages)) throw new Base44Error("Unexpected conversation response.");
      return { messages: messages.map(toMessage) };
    },

    sendMessage: (id: string, content: string) => post(`${app(id)}/chat/message`, { content }),

    // A fixed request ID lets Base44 deduplicate retries of the same answer.
    submitToolCallInput: (p: ToolInput) =>
      post(`${app(p.appId)}/chat/submit-tool-call-input`, {
        tool_call_id: p.toolCallId,
        message_id: p.messageId,
        action: p.approve ? "approved" : "rejected",
        extra_user_input: p.extraUserInput,
      }, { "X-Request-ID": `submit-${p.toolCallId}` }),

    deployApp: (id: string) => post(`${app(id)}/deploy`, {}),

    async getPreviewUrl(id: string) {
      const data = await request(`${app(id)}/sandbox/preview-url`, { timeout: 120_000 });
      const url = httpsUrl(data?.preview_url);
      if (data.preview_token) url.searchParams.set("_preview_token", data.preview_token);
      url.searchParams.set("server_url", url.origin);
      url.searchParams.set("hide_badge", "true");
      url.searchParams.set("analytics-enable", "false");
      return { url: url.href };
    },

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

function toMessage(m: Message): Message {
  if (typeof m?.id !== "string" || !m.id) throw new Base44Error("A conversation message has no stable ID.");
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    hidden: m.hidden,
    tool_calls: m.tool_calls?.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      waiting_on: t.waiting_on,
      arguments_string: t.arguments_string,
      results: typeof t.results === "string" ? t.results : undefined,
    })),
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

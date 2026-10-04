import "server-only";
import type { App, Message, ToolInput } from "../types";
import { customInstructions } from "./custom-instructions";
import { Base44Error } from "./error";
import { base44Fetch } from "./http";
import { staticPreviewUrl } from "./static-preview";

const hints: Record<number, string> = {
  401: "Reconnect your workspace.",
  403: "Check the account’s workspace access.",
  409: "The app may not build yet. Ask the agent to fix it.",
  429: "Rate limit reached. Wait before trying again.",
};

export function createBase44Client(accessToken: string) {
  const request = (path: string, options: Parameters<typeof base44Fetch>[1] = {}) =>
    base44Fetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, ...options.headers },
      errorFor: (status) => new Base44Error(
        `Base44 returned ${status}. ${hints[status] ?? "Refresh the app state before repeating an operation."}`,
        status,
      ),
    });
  const post = (path: string, body: object, headers?: Record<string, string>) =>
    request(path, { body, headers, timeout: 120_000 }).then(() => ({}));

  // Return only the fields the browser needs; never pass the raw Base44 app through.
  async function toApp(app: App): Promise<App> {
    if (typeof app?.id !== "string") throw new Base44Error("Base44 returned an app without an ID.");
    const { id, name, slug, preview_screenshot_url, logo_url, user_description, status } = app;
    return {
      id, name, slug, preview_screenshot_url, logo_url, user_description,
      static_preview_url: await staticPreviewUrl(slug),
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

    getApp: async (id: string) => toApp(await request(`/api/apps/${id}`)),

    // skip counts backward from the newest message.
    async getConversation(id: string, skip: number) {
      const data = await request(`/api/apps/${id}/chat/full-conversation?limit=20&skip=${skip}`, { timeout: 60_000 });
      const messages = data?.messages ?? [];
      if (!Array.isArray(messages)) throw new Base44Error("Unexpected conversation response.");
      return { messages: messages.map(toMessage) };
    },

    sendMessage: (id: string, content: string) => post(`/api/apps/${id}/chat/message`, { content }),

    // A fixed request ID lets Base44 deduplicate retries of the same answer.
    submitToolCallInput: (p: ToolInput) =>
      post(`/api/apps/${p.appId}/chat/submit-tool-call-input`, {
        tool_call_id: p.toolCallId,
        message_id: p.messageId,
        action: p.approve ? "approved" : "rejected",
        extra_user_input: p.extraUserInput,
      }, { "X-Request-ID": `submit-${p.toolCallId}` }),

    deployApp: (id: string) => post(`/api/apps/${id}/deploy`, {}),

    async getPreviewUrl(id: string) {
      const data = await request(`/api/apps/${id}/sandbox/preview-url`, { timeout: 120_000 });
      const url = httpsUrl(data?.preview_url);
      if (data.preview_token) url.searchParams.set("_preview_token", data.preview_token);
      url.searchParams.set("server_url", url.origin);
      url.searchParams.set("hide_badge", "true");
      url.searchParams.set("analytics-enable", "false");
      return { url: url.href };
    },

    async getPublishedUrl(id: string) {
      try {
        const data = await request(`/api/apps/platform/${id}/published-url`);
        return { url: httpsUrl(data?.url).href };
      } catch (error) {
        if (error instanceof Base44Error && error.status === 404) return { url: null };
        throw error;
      }
    },
  };
}

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

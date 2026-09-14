import "server-only";
import { customInstructions } from "./custom-instructions";
import type { App, Message, ToolInput } from "../types";
import { Base44Error } from "./error";
import { getBase44Config } from "./config";

export function createBase44Client(accessToken: string) {
  async function request(
    path: string,
    {
      body,
      timeout = 30_000,
      headers,
    }: {
      body?: object;
      timeout?: number;
      headers?: Record<string, string>;
    } = {},
  ) {
    const { host } = getBase44Config();
    let response: Response;
    try {
      response = await fetch(`${host}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      // Never include fetch errors: they can contain a URL or upstream credentials.
      throw new Base44Error(
        "Base44 did not return a response. The operation may still be running.",
        504,
      );
    }
    if (!response.ok) {
      const hint =
        response.status === 401
          ? "Reconnect your workspace."
          : response.status === 403
            ? "Check the account’s workspace access."
            : response.status === 429
              ? "Rate limit reached. Wait before trying again."
              : response.status === 409
                ? "The app may not build yet. Ask the agent to fix it."
                : "Refresh the app state before repeating an operation.";
      throw new Base44Error(`Base44 returned ${response.status}. ${hint}`, response.status);
    }
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Base44Error("Base44 returned an unreadable response. The outcome is uncertain.");
    }
  }

  function appSummary(value: App): App {
    if (!value || typeof value.id !== "string")
      throw new Base44Error("Base44 returned an app without an ID.");
    return {
      id: value.id,
      name: value.name,
      preview_screenshot_url: value.preview_screenshot_url,
      logo_url: value.logo_url,
      user_description: value.user_description,
      status: value.status
        ? { state: value.status.state, error_source: value.status.error_source }
        : undefined,
    };
  }

  async function createApp(prompt: string) {
    const app = await request("/api/apps", {
      body: {
        name: prompt.trim().slice(0, 80),
        user_description: prompt,
        initial_message: { content: prompt },
        custom_instructions: customInstructions,
        prevent_iframe_embedding: false,
      },
      timeout: 120_000,
    });
    return appSummary(app);
  }

  const getApp = async (id: string) => appSummary(await request(`/api/apps/${id}`));
  async function getConversation(id: string, skip: number) {
    const data = await request(`/api/apps/${id}/chat/full-conversation?limit=20&skip=${skip}`, {
      timeout: 60_000,
    });
    if (!data || typeof data !== "object")
      throw new Base44Error("Unexpected conversation response.");
    if (data.messages != null && !Array.isArray(data.messages))
      throw new Base44Error("Unexpected conversation response.");
    const messages: Message[] = (data.messages ?? []).map((m: Message) => {
      if (!m || typeof m.id !== "string" || !m.id)
        throw new Base44Error("A conversation message has no stable ID.");
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
    });
    return { messages };
  }
  const sendMessage = (id: string, content: string) =>
    request(`/api/apps/${id}/chat/message`, { body: { content }, timeout: 120_000 }).then(
      () => ({}),
    );
  const submitToolCallInput = (p: ToolInput) =>
    request(`/api/apps/${p.appId}/chat/submit-tool-call-input`, {
      body: {
        tool_call_id: p.toolCallId,
        message_id: p.messageId,
        action: p.approve ? "approved" : "rejected",
        extra_user_input: p.extraUserInput,
      },
      timeout: 120_000,
      headers: { "X-Request-ID": `submit-${p.toolCallId}` },
    }).then(() => ({}));
  const deployApp = (id: string) =>
    request(`/api/apps/${id}/deploy`, { body: {}, timeout: 120_000 }).then(() => ({}));

  function httpsUrl(raw: unknown) {
    if (typeof raw !== "string" || !raw)
      throw new Base44Error("Base44 has not returned a URL yet. Try again shortly.");
    let url: URL;
    try {
      url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch {
      throw new Base44Error("Base44 returned an invalid URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Base44Error("Base44 returned an unsafe URL.");
    return url;
  }
  async function getPreviewUrl(id: string) {
    const data = await request(`/api/apps/${id}/sandbox/preview-url`, { timeout: 120_000 });
    const url = httpsUrl(data?.preview_url);
    if (data.preview_token) url.searchParams.set("_preview_token", data.preview_token);
    return { url: url.href };
  }
  async function getPublishedUrl(id: string) {
    try {
      const data = await request(`/api/apps/platform/${id}/published-url`);
      return { url: httpsUrl(data?.url).href };
    } catch (error) {
      if (error instanceof Base44Error && error.status === 404) return { url: null };
      throw error;
    }
  }

  return {
    createApp,
    getApp,
    getConversation,
    sendMessage,
    submitToolCallInput,
    getPreviewUrl,
    deployApp,
    getPublishedUrl,
  };
}

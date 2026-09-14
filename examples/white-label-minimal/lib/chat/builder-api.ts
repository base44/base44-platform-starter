import type { App, AppPage, Message, ToolInput } from "../types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public notStarted = false,
  ) {
    super(message);
  }
}

async function call<T>(action: string, params: object, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/base44", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("Connection lost. The operation may still be running.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "The server returned an unreadable response. The outcome is uncertain.",
      502,
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.error || "The request failed.",
      response.status,
      data.outcome === "not_started",
    );
  return data as T;
}

export const createApp = (prompt: string) => call<App>("createApp", { prompt });
export const getApp = (appId: string, signal?: AbortSignal) =>
  call<App>("getApp", { appId }, signal);
export const getConversation = (appId: string, skip = 0, signal?: AbortSignal) =>
  call<{ messages: Message[] }>("getConversation", { appId, skip }, signal);
export const sendMessage = (appId: string, content: string) =>
  call("sendMessage", { appId, content });
export const submitToolCallInput = (input: ToolInput) => call("submitToolCallInput", input);
export const getPreviewUrl = (appId: string) => call<{ url: string }>("getPreviewUrl", { appId });
export const deployApp = (appId: string) => call("deployApp", { appId });
export const getPublishedUrl = (appId: string) =>
  call<{ url: string | null }>("getPublishedUrl", { appId });

export const listApps = (skip = 0) => call<AppPage>("listApps", { skip });

export const removeApp = (appId: string) => call("removeApp", { appId });

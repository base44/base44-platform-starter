import type { App, AppPage, ToolInput } from "../types";

// status lets callers tell an authorization failure from the rest.
export class ApiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

// Every Base44 operation goes through Tiny's own server, never to Base44 directly.
async function call<T>(action: string, params: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/base44", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Connection lost. The operation may still be running.");
  }
  const data = await response.json().catch(() => {
    throw new ApiError("The server returned an unreadable response. The outcome is uncertain.", 502);
  });
  if (!response.ok) throw new ApiError(data.error || "The request failed.", response.status);
  return data as T;
}

export const createApp = (prompt: string) => call<App>("createApp", { prompt });
export const getApp = (appId: string) => call<App>("getApp", { appId });
export const sendMessage = (appId: string, content: string) =>
  call("sendMessage", { appId, content });
export const submitToolCallInput = (input: ToolInput) => call("submitToolCallInput", input);
export const getPreviewUrl = (appId: string) => call<{ url: string }>("getPreviewUrl", { appId });
export const getLatestBuildUrl = (appId: string) =>
  call<{ url: string | null }>("getLatestBuildUrl", { appId });
export const deployApp = (appId: string) => call("deployApp", { appId });
export const getPublishedUrl = (appId: string) =>
  call<{ url: string | null }>("getPublishedUrl", { appId });
export const listApps = (skip = 0) => call<AppPage>("listApps", { skip });
export const removeApp = (appId: string) => call("removeApp", { appId });

export const openLiveUpdates = (appId: string) =>
  call<{ serverUrl: string; sessionToken: string }>("openLiveUpdates", { appId });

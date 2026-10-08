import type { ActionResult, ToolInput } from "../../types";

// Stands in for server/actions.ts in the browser tests (see next.config.ts). Each
// action goes to /api/base44, which the tests answer with page.route.
async function call<T>(action: string, params: object): Promise<ActionResult<T>> {
  const response = await fetch("/api/base44", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { error: body.error || "The request failed.", status: response.status };
  return { data: body };
}

export const listApps = (skip: number) => call("listApps", { skip });
export const createApp = (prompt: string) => call("createApp", { prompt });
export const removeApp = (appId: string) => call("removeApp", { appId });
export const getApp = (appId: string) => call("getApp", { appId });
export const sendMessage = (appId: string, content: string) => call("sendMessage", { appId, content });
export const submitToolCallInput = (input: ToolInput) => call("submitToolCallInput", input);
export const deployApp = (appId: string) => call("deployApp", { appId });
export const getPublishedUrl = (appId: string) => call("getPublishedUrl", { appId });
export const getLatestBuildUrl = (appId: string) => call("getLatestBuildUrl", { appId });
export const getPreviewUrl = (appId: string) => call("getPreviewUrl", { appId });
export const openLiveUpdates = (appId: string) => call("openLiveUpdates", { appId });
export const closeLiveUpdates = (appId: string, sessionId: string) => call("closeLiveUpdates", { appId, sessionId });

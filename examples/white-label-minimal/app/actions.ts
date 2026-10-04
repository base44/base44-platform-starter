"use server";
import * as buildTurn from "../lib/base44/build-turn";
import { getEmbedUrl } from "../lib/base44/embed";
import { Base44Error } from "../lib/base44/error";
import * as liveUpdates from "../lib/base44/live-updates";
import { requireUser } from "../lib/server/auth";
import { resolveAppPage } from "../lib/storage/app-list";
import { listOwnedApps, removeOwner, requireOwner, saveOwner } from "../lib/storage/ownership";
import type { ActionResult, ToolInput } from "../lib/types";

// Server actions: functions Tiny's pages call that run on the server, where the
// Base44 credentials are. Next.js exposes each one to the browser, so each one
// checks who is signed in and, for an app, that they own it, before calling Base44.

export async function listApps(skip: number) {
  return returnErrors(async () => {
    const user = await requireUser();
    const rows = await listOwnedApps(user.email, skip);
    return resolveAppPage(rows, skip, buildTurn.getApp);
  });
}

export async function createApp(prompt: string) {
  return returnErrors(async () => {
    const user = await requireUser();
    const app = await buildTurn.createApp(prompt);
    await saveOwner(user.email, app);
    return app;
  });
}

// Removes the app from Tiny only. It stays in Base44.
export async function removeApp(appId: string) {
  return returnErrors(async () => {
    const user = await requireUser();
    await requireOwner(user.email, appId);
    return removeOwner(user.email, appId);
  });
}

export async function getApp(appId: string) {
  return returnErrors(async () => {
    const user = await requireUser();
    await requireOwner(user.email, appId);
    return buildTurn.getApp(appId);
  });
}

export async function sendMessage(appId: string, content: string) {
  return returnErrors(async () => {
    const user = await requireUser();
    await requireOwner(user.email, appId);
    return buildTurn.sendMessage(appId, content);
  });
}

export async function submitToolCallInput(input: ToolInput) {
  return returnErrors(async () => {
    const user = await requireUser();
    await requireOwner(user.email, input.appId);
    return buildTurn.submitToolCallInput(input);
  });
}

export async function deployApp(appId: string) {
  return returnErrors(async () => {
    const user = await requireUser();
    await requireOwner(user.email, appId);
    return buildTurn.deployApp(appId);
  });
}

export async function getPublishedUrl(appId: string) {
  return returnErrors(async () => {
    const user = await requireUser();
    await requireOwner(user.email, appId);
    return buildTurn.getPublishedUrl(appId);
  });
}

// The app's latest build, signed in as the builder.
export async function getLatestBuildUrl(appId: string) {
  return returnErrors(async () => {
    const user = await requireUser();
    await requireOwner(user.email, appId);
    return getEmbedUrl(appId, user.email, "latest_preview");
  });
}

// The app's running sandbox, signed in as the builder.
export async function getPreviewUrl(appId: string) {
  return returnErrors(async () => {
    const user = await requireUser();
    await requireOwner(user.email, appId);
    const { url } = await getEmbedUrl(appId, user.email, "live_preview");
    if (!url) throw new Base44Error("The live preview is not available yet. Try refreshing.", 502);
    return { url };
  });
}

export async function openLiveUpdates(appId: string) {
  return returnErrors(async () => {
    const user = await requireUser();
    await requireOwner(user.email, appId);
    return liveUpdates.openLiveUpdates(appId);
  });
}

// Next.js hides thrown error messages from the browser in production, so an
// action returns its error instead of throwing it.
async function returnErrors<T>(action: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { data: await action() };
  } catch (error) {
    if (error instanceof Base44Error) return { error: error.message, status: error.status };
    console.error("[actions]", error);
    return { error: "The request failed. Check the server configuration.", status: 500 };
  }
}

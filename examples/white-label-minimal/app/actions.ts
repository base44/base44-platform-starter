"use server";
import * as buildTurn from "../lib/base44/build-turn";
import { getEmbedUrl } from "../lib/base44/embed";
import { Base44Error } from "../lib/base44/error";
import * as liveUpdates from "../lib/base44/live-updates";
import { requireUser } from "../lib/server/auth";
import { resolveAppPage } from "../lib/storage/app-list";
import { createAppRepository } from "../lib/storage/app-repository";
import type { ActionResult, ToolInput } from "../lib/types";

// What Tiny's pages can ask its server to do. Base44 sees one account behind
// every builder, so each action checks who is signed in and, for an app, that
// they own it. Only then does it call Base44, with credentials that never
// leave the server.

export async function listApps(skip: number) {
  return signedIn(async (user) => {
    const rows = await createAppRepository(user).list(skip);
    return resolveAppPage(rows, skip, buildTurn.getApp);
  });
}

export async function createApp(prompt: string) {
  return signedIn(async (user) => {
    const app = await buildTurn.createApp(prompt);
    await createAppRepository(user).save(app);
    return app;
  });
}

export async function removeApp(appId: string) {
  // Removes the app from Tiny only. It stays in Base44.
  return ownApp(appId, (user) => createAppRepository(user).remove(appId));
}

export async function getApp(appId: string) {
  return ownApp(appId, () => buildTurn.getApp(appId));
}

export async function sendMessage(appId: string, content: string) {
  return ownApp(appId, () => buildTurn.sendMessage(appId, content));
}

export async function submitToolCallInput(input: ToolInput) {
  return ownApp(input.appId, () => buildTurn.submitToolCallInput(input));
}

export async function deployApp(appId: string) {
  return ownApp(appId, () => buildTurn.deployApp(appId));
}

export async function getPublishedUrl(appId: string) {
  return ownApp(appId, () => buildTurn.getPublishedUrl(appId));
}

// Every preview is the app signed in as the builder.
export async function getLatestBuildUrl(appId: string) {
  return ownApp(appId, (user) => getEmbedUrl(appId, user.email, "latest_preview"));
}

export async function getPreviewUrl(appId: string) {
  return ownApp(appId, async (user) => {
    const { url } = await getEmbedUrl(appId, user.email, "live_preview");
    if (!url) throw new Base44Error("The live preview is not available yet. Try refreshing.", 502);
    return { url };
  });
}

export async function openLiveUpdates(appId: string) {
  return ownApp(appId, () => liveUpdates.openLiveUpdates(appId));
}

type User = { email: string };

// Runs an action for the signed-in user. Next.js hides thrown error messages
// from the browser in production, so errors come back as a result instead.
async function signedIn<T>(action: (user: User) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const user = await requireUser();
    return { data: await action(user) };
  } catch (error) {
    if (error instanceof Base44Error) return { error: error.message, status: error.status };
    console.error("[actions]", error);
    return { error: "The request failed. Check the server configuration.", status: 500 };
  }
}

// Like signedIn, for an app the user must own. The ID also goes into Base44
// URLs, so it must be a plain ID.
async function ownApp<T>(appId: string, action: (user: User) => Promise<T>) {
  return signedIn(async (user) => {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(appId)) throw new Base44Error("Invalid app ID.", 400);
    await createAppRepository(user).authorize(appId);
    return action(user);
  });
}

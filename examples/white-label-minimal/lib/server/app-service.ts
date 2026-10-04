import "server-only";
import { requireUser } from "./auth";
import { getEmbedUrl } from "../base44/embed";
import { openSocketSession } from "../base44/socket-session";
import { base44 } from "../base44/client";
import { createAppRepository } from "../storage/app-repository";
import { resolveAppPage } from "../storage/app-list";
import type { AppClient } from "../types";

// Where Tiny plugs into Base44. Base44 sees one account behind every builder,
// so this is where builders are kept apart: every app call is checked against
// the signed-in user's ownership rows (see api-handler.ts).
export async function getAppClient(): Promise<AppClient> {
  const user = await requireUser();
  const apps = createAppRepository(user);
  return {
    ...base44,
    authorize: apps.authorize,
    openBuilderSession: openSocketSession,
    // The builder sees the latest build signed in as themselves.
    getLatestBuildUrl: (id) => getEmbedUrl(id, user.email, "latest_preview"),
    removeApp: apps.remove,
    async createApp(prompt) {
      const app = await base44.createApp(prompt);
      await apps.save(app);
      return app;
    },
    listApps: async (skip) => resolveAppPage(await apps.list(skip), skip, base44.getApp),
  };
}

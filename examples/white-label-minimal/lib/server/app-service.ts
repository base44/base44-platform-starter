import "server-only";
import { requireUser } from "./auth";
import * as buildTurn from "../base44/build-turn";
import { getEmbedUrl } from "../base44/embed";
import { openLiveUpdates } from "../base44/live-updates";
import { Base44Error } from "../base44/error";
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
    ...buildTurn,
    openLiveUpdates,
    authorize: apps.authorize,
    // Every preview is the app signed in as the builder: the latest build in
    // cards, the running sandbox while editing.
    getLatestBuildUrl: (id) => getEmbedUrl(id, user.email, "latest_preview"),
    async getPreviewUrl(id) {
      const { url } = await getEmbedUrl(id, user.email, "live_preview");
      if (!url) throw new Base44Error("The live preview is not available yet. Try refreshing.", 502);
      return { url };
    },
    removeApp: apps.remove,
    async createApp(prompt) {
      const app = await buildTurn.createApp(prompt);
      await apps.save(app);
      return app;
    },
    listApps: async (skip) => resolveAppPage(await apps.list(skip), skip, buildTurn.getApp),
  };
}

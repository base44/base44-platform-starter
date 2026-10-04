import "server-only";
import { requireUser } from "./auth";
import { withStaticPreview } from "./static-preview";
import { openSocketSession } from "../base44/socket-session";
import { base44 } from "../base44/client";
import { createAppRepository } from "../storage/app-repository";
import { resolveAppPage } from "../storage/app-list";
import type { AppClient } from "../types";

// Where Tiny plugs into Base44. Base44 sees one account behind every builder,
// so this is where builders are kept apart: every app call is checked against
// the signed-in user's ownership rows (see api-handler.ts).
export async function getAppClient(): Promise<AppClient> {
  const apps = createAppRepository(await requireUser());
  const getApp = async (id: string) => withStaticPreview(await base44.getApp(id));
  return {
    ...base44,
    getApp,
    authorize: apps.authorize,
    openBuilderSession: openSocketSession,
    removeApp: apps.remove,
    async createApp(prompt) {
      const app = await base44.createApp(prompt);
      await apps.save(app);
      return withStaticPreview(app);
    },
    listApps: async (skip) => resolveAppPage(await apps.list(skip), skip, getApp),
  };
}

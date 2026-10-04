import "server-only";
import { requireUser } from "./auth";
import { withStaticPreview } from "./static-preview";
import { getBase44AccessToken } from "../base44/identity";
import { createBase44Client } from "../base44/client";
import { createAppRepository } from "../storage/app-repository";
import { resolveAppPage } from "../storage/app-list";
import type { AppClient } from "../types";

// Where Tiny plugs into Base44: the signed-in user, their Base44 token, and
// the apps they own.
export async function getAppClient(): Promise<AppClient> {
  const actor = await requireUser();
  const client = createBase44Client(await getBase44AccessToken(actor.email));
  const apps = createAppRepository(actor);
  const getApp = async (id: string) => withStaticPreview(await client.getApp(id));
  return {
    ...client,
    getApp,
    authorize: apps.authorize,
    removeApp: apps.remove,
    async createApp(prompt) {
      const app = await client.createApp(prompt);
      await apps.save(app);
      return withStaticPreview(app);
    },
    listApps: async (skip) => resolveAppPage(await apps.list(skip), skip, getApp),
  };
}

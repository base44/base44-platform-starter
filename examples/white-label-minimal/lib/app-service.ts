import "server-only";
import { requireUser } from "./auth";
import { getBase44AccessToken } from "./base44-identity";
import { createAppRepository } from "./app-repository";
import { resolveAppPage } from "./app-list";
import { createBase44Client } from "./base44-server";
import type { AppClient } from "./types";

export async function getAppClient(): Promise<AppClient> {
  const actor = await requireUser();
  const token = await getBase44AccessToken(actor.email);
  const client = createBase44Client(token);
  const apps = createAppRepository(actor);
  return {
    ...client,
    authorize: apps.authorize,
    async createApp(prompt) {
      const app = await client.createApp(prompt);
      await apps.save(app);
      return app;
    },
    async listApps(skip) {
      return resolveAppPage(await apps.list(skip), skip, client.getApp);
    },
  };
}

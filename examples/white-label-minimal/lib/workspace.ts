import "server-only";
import { getSessionUser } from "@/lib/auth";
import { getLink, remint } from "@/lib/base44Link";
import { prisma } from "@/lib/prisma";
import { scopedWhere } from "@/lib/rls";
import { resolveAppPage } from "./app-list";
import { Base44Error, createBase44Client } from "./base44-server";

export type WorkspaceClient = ReturnType<typeof createBase44Client> & {
  authorize(appId: string): Promise<void>;
  listApps(skip: number): Promise<Awaited<ReturnType<typeof resolveAppPage>>>;
};

export async function getWorkspaceClient(): Promise<WorkspaceClient> {
  const actor = await getSessionUser();
  if (!actor) throw new Base44Error("Sign in to continue.", 401);
  let link = await getLink(actor.email);
  if (link?.status !== "linked" || !link.accessToken)
    throw new Base44Error("Connect your workspace to start building.", 428);
  if (!link.expiresAt || link.expiresAt.getTime() < Date.now() + 60_000) link = await remint(link);
  if (!link?.accessToken) throw new Base44Error("Reconnect your workspace to continue.", 428);
  const client = createBase44Client(link.accessToken);
  const owner = scopedWhere(actor);
  return {
    ...client,
    async authorize(appId) {
      const owned = await prisma.appOwnership.findFirst({
        where: { ...owner, appId },
        select: { id: true },
      });
      if (!owned) throw new Base44Error("App not found.", 404);
    },
    async createApp(prompt) {
      const app = await client.createApp(prompt);
      await prisma.appOwnership.upsert({
        where: { appId_createdBy: { appId: app.id, createdBy: owner.createdBy } },
        create: { ...owner, appId: app.id, appName: app.name },
        update: { appName: app.name },
      });
      return app;
    },
    async listApps(skip) {
      const rows = await prisma.appOwnership.findMany({
        where: owner,
        orderBy: { createdAt: "desc" },
        skip,
        take: 13,
      });
      return resolveAppPage(rows, skip, client.getApp);
    },
  };
}

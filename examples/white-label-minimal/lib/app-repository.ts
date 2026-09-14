import "server-only";
import { prisma } from "./db";
import type { App } from "./types";
import { Base44Error } from "./base44-error";

export function createAppRepository(actor: { email: string }) {
  const owner = { createdBy: actor.email };
  return {
    async authorize(appId: string) {
      const owned = await prisma.appOwnership.findFirst({
        where: { ...owner, appId },
        select: { id: true },
      });
      if (!owned) throw new Base44Error("App not found.", 404);
    },
    async save(app: App) {
      await prisma.appOwnership.upsert({
        where: { appId_createdBy: { appId: app.id, createdBy: owner.createdBy } },
        create: { ...owner, appId: app.id, appName: app.name },
        update: { appName: app.name },
      });
    },
    list(skip: number) {
      return prisma.appOwnership.findMany({
        where: owner,
        orderBy: { createdAt: "desc" },
        skip,
        take: 13,
        select: { appId: true },
      });
    },
  };
}

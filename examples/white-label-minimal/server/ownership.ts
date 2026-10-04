import "server-only";
import type { App } from "../types";
import { Base44Error } from "./base44/error";
import { PAGE_SIZE } from "./app-list";
import { prisma } from "./db";

// Base44 sees one account behind every app, so Tiny records which builder
// created which app, and checks it before every call about an app.

export async function saveOwner(email: string, app: App) {
  await prisma.appOwnership.upsert({
    where: { appId_createdBy: { appId: app.id, createdBy: email } },
    create: { appId: app.id, appName: app.name, createdBy: email },
    update: { appName: app.name },
  });
}

export async function requireOwner(email: string, appId: string) {
  // The ID also goes into Base44 URLs, so it must be a plain ID.
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(appId)) {
    throw new Base44Error("Invalid app ID.", 400);
  }
  const owned = await prisma.appOwnership.findFirst({ where: { createdBy: email, appId } });
  if (!owned) {
    throw new Base44Error("App not found.", 404);
  }
}

// One extra row tells the caller whether another page exists.
export function listOwnedApps(email: string, skip: number) {
  return prisma.appOwnership.findMany({
    where: { createdBy: email },
    orderBy: { createdAt: "desc" },
    skip,
    take: PAGE_SIZE + 1,
  });
}

export async function removeOwner(email: string, appId: string) {
  await prisma.appOwnership.deleteMany({ where: { createdBy: email, appId } });
  return {};
}

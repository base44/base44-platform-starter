/**
 * The only module that reads or writes `AppInstall`. Server-only.
 *
 * An install is the grant: `/api/sunny/token` mints for an app you installed or
 * authored, so a row here is what lets an app read your boards, and deleting it
 * revokes. It used to be the `Widget` row, which welded "I want this app" to "I want
 * it on my home page"; the migration backfills one row per already-pinned pair.
 *
 * **No admin bypass.** Reading another user's rows through an admin session is one
 * thing; minting a token bound to their install and handing it to third-party code is
 * another. Everything here matches on the caller's own email.
 */

import type { AppInstall } from "@prisma/client";

import { isPublished } from "@/lib/marketplace";
import { prisma } from "@/lib/prisma";
import { ownerFields, type RlsActor } from "@/lib/rls";

export type { AppInstall };

export class InstallError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "InstallError";
  }
}

export type InstallSummary = {
  app_id: string;
  app_name: string | null;
  installed_date: string;
};

export const toSummary = (i: AppInstall): InstallSummary => ({
  app_id: i.appId,
  app_name: i.appName,
  installed_date: i.createdAt.toISOString(),
});

/** Whether `actor` may act as themselves through `appId`. The token route's gate. */
export async function hasInstall(actor: RlsActor, appId: string): Promise<boolean> {
  const row = await prisma.appInstall.findUnique({
    where: { appId_createdBy: { appId, createdBy: ownerFields(actor).createdBy } },
    select: { id: true },
  });
  return Boolean(row);
}

export async function listInstalls(actor: RlsActor): Promise<AppInstall[]> {
  return prisma.appInstall.findMany({
    where: ownerFields(actor),
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Idempotent. Only an app on offer, or one you built: the id arrives from the request,
 * so without this any string would create a grant.
 */
export async function install(
  actor: RlsActor,
  appId: string,
  appName?: string | null,
): Promise<AppInstall> {
  const owner = ownerFields(actor);

  const [offered, authored] = await Promise.all([
    isPublished(appId),
    prisma.appOwnership.findFirst({ where: { appId, ...owner }, select: { id: true } }),
  ]);
  if (!offered && !authored) {
    throw new InstallError("That app is not available to install.", "not_available", 404);
  }

  return prisma.appInstall.upsert({
    where: { appId_createdBy: { appId, createdBy: owner.createdBy } },
    create: { appId, appName: appName ?? null, ...owner },
    update: { appName: appName ?? undefined },
  });
}

/**
 * Unpinning is not uninstalling, but the reverse holds: a widget with no grant behind
 * it renders as a frame that cannot read anything, which looks broken rather than
 * revoked. So this removes the widgets too.
 */
export async function uninstall(actor: RlsActor, appId: string): Promise<void> {
  const owner = ownerFields(actor);

  const { count } = await prisma.appInstall.deleteMany({ where: { appId, ...owner } });
  if (count === 0) throw new InstallError("You have not installed that app.", "not_installed", 404);

  await prisma.widget.deleteMany({ where: { appId, ...owner } });
}

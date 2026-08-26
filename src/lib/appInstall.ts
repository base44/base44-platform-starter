/**
 * The **only** module that reads or writes `AppInstall`, and it is server-only.
 *
 * An install is the grant: `/api/sunny/token` mints a viewer token for an app you have
 * installed or authored, so a row here is what lets an app read your boards as you, and
 * deleting it revokes on the next call.
 *
 * ## Why this is not the `Widget` row any more
 *
 * It used to be. That held while every app was one you built — pinning it to Home was
 * the only reason to have it — and broke once apps come from a market. "I want this
 * app" and "I want it on my home page" are different intents, and welding them meant
 * an app you open monthly had to sit on Home to work at all. Now `Widget` means only
 * what its name says, and this model carries permission.
 *
 * The migration backfills one row per already-pinned `(app, user)`, because otherwise
 * moving the predicate would revoke everyone at once.
 *
 * ## No admin bypass
 *
 * Everywhere else in the shell an admin reads across owners and `scopedWhere()` returns
 * `{}`. Not here. Reading another user's rows through an admin session is one thing;
 * minting a token bound to *their* install and handing it to third-party app code is
 * another. Every function below matches on the caller's own email via `ownerFields()`.
 */

import type { AppInstall } from "@prisma/client";

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

/** Idempotent: re-installing an app you already have is not an error. */
export async function install(
  actor: RlsActor,
  appId: string,
  appName?: string | null,
): Promise<AppInstall> {
  const owner = ownerFields(actor);
  return prisma.appInstall.upsert({
    where: { appId_createdBy: { appId, createdBy: owner.createdBy } },
    create: { appId, appName: appName ?? null, ...owner },
    update: { appName: appName ?? undefined },
  });
}

/**
 * Cut an app off, and take it off Home with it.
 *
 * Unpinning is *not* uninstalling — that separation is the whole point of this model —
 * but the reverse does hold: an app with no access left would render on Home as a frame
 * that cannot read anything, which reads as broken rather than as revoked. So removing
 * the grant removes the widgets that depended on it.
 */
export async function uninstall(actor: RlsActor, appId: string): Promise<void> {
  const owner = ownerFields(actor);

  const { count } = await prisma.appInstall.deleteMany({ where: { appId, ...owner } });
  if (count === 0) throw new InstallError("You have not installed that app.", "not_installed", 404);

  await prisma.widget.deleteMany({ where: { appId, ...owner } });
}

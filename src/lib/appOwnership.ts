/**
 * Who built which app — the shell's answer, because Base44 has none.
 *
 * Every app lives in the one Base44 account the integration authenticates with,
 * so upstream every app has the same owner. Which *shell user* may list, edit,
 * deploy or preview an app is therefore decided here, from `AppOwnership`, and
 * nowhere else: the platform proxy asks `ownsApp()` before it forwards an
 * app-scoped call, and the embed and token routes ask it before they act for an
 * author.
 *
 * Server-only. Rows are written by the proxy when it creates an app
 * (`recordOwnership`), never by a client — a client that could insert one could
 * claim any app in the folder. The generic entity API lets a user read and delete
 * their own rows ("forget this app"), and refuses to create or update one
 * (src/lib/entities.ts).
 *
 * Reads here match on the caller's own email with no admin bypass, like
 * src/lib/appInstall.ts: an admin's dashboard shows their own apps, not everyone's.
 */

import { prisma } from "@/lib/prisma";
import { ownerFields, type RlsActor } from "@/lib/rls";

/** Whether `actor` built `appId`. The proxy's gate for every app-scoped action. */
export async function ownsApp(actor: RlsActor, appId: string): Promise<boolean> {
  const row = await prisma.appOwnership.findFirst({
    where: { appId, ...ownerFields(actor) },
    select: { id: true },
  });
  return Boolean(row);
}

/** The ids of every app `actor` built. `listApps` intersects the folder with this. */
export async function ownedAppIds(actor: RlsActor): Promise<Set<string>> {
  const rows = await prisma.appOwnership.findMany({
    where: ownerFields(actor),
    select: { appId: true },
  });
  return new Set(rows.map((r) => r.appId));
}

/**
 * Records that `actor` built `appId`. Idempotent on (app, owner), so a retried
 * create does not fail on the unique index. `appName` is a display snapshot and
 * may go stale; nothing reads it for authorization.
 */
export async function recordOwnership(
  actor: RlsActor,
  appId: string,
  appName?: string | null,
): Promise<void> {
  const owner = ownerFields(actor);
  await prisma.appOwnership.upsert({
    where: { appId_createdBy: { appId, createdBy: owner.createdBy } },
    create: { appId, appName: appName ?? null, ...owner },
    update: { appName: appName ?? undefined },
  });
}

/**
 * Everyone who built `appId` — usually one person, but the index allows several.
 * For the webhook receiver: an `app.deleted.v1` event names the app, and this is
 * how it finds whose pins to remove. Emails only; a caller reconciling an event has
 * no business with anything else about these users.
 */
export async function ownersOf(appId: string): Promise<string[]> {
  const rows = await prisma.appOwnership.findMany({
    where: { appId },
    select: { createdBy: true },
  });
  return rows.map((r) => r.createdBy);
}

/** Apps per upstream folder request while collecting a user's apps. */
export const FOLDER_PAGE_SIZE = 50;
/** Upstream requests one listing may make, so a huge folder cannot hold a request open. */
export const MAX_FOLDER_PAGES = 40;

/**
 * One page of `owned`'s apps, in folder order (newest first), out of a folder
 * that every builder shares.
 *
 * Base44 cannot be asked for "this user's apps" — upstream they all belong to the
 * one account — so the folder is read page by page and filtered here until the
 * caller's page is full, every owned app has turned up, or the folder runs out.
 * Filtering one upstream page instead would hide a user's older apps behind
 * everyone else's newer ones.
 *
 * The folder stays the source rather than fetching each owned id: it is what
 * drops a trashed app and brings a restored one back, which the webhook receiver
 * relies on. Pure over `fetchPage`, so it is testable without a platform.
 */
export async function pageOwnedApps(
  owned: ReadonlySet<string>,
  fetchPage: (skip: number, size: number) => Promise<unknown[]>,
  { limit, skip }: { limit: number; skip: number },
): Promise<unknown[]> {
  const want = skip + limit;
  const found: unknown[] = [];
  // An app can move up the folder between two requests and be seen twice.
  const seen = new Set<string>();

  for (let page = 0; page < MAX_FOLDER_PAGES; page++) {
    const rows = await fetchPage(page * FOLDER_PAGE_SIZE, FOLDER_PAGE_SIZE);
    for (const app of rows) {
      const id = (app as { id?: unknown } | null)?.id;
      if (typeof id === "string" && owned.has(id) && !seen.has(id)) {
        seen.add(id);
        found.push(app);
      }
    }
    if (found.length >= want || seen.size >= owned.size || rows.length < FOLDER_PAGE_SIZE) {
      return found.slice(skip, want);
    }
  }

  console.warn(
    `[appOwnership] stopped after ${MAX_FOLDER_PAGES} folder pages with ` +
      `${seen.size} of ${owned.size} owned apps found`,
  );
  return found.slice(skip, want);
}

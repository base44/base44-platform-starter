/**
 * What the *shell* has to change about itself when Base44 says an app came or
 * went, and how its owner finds out.
 *
 * `projectEvent` in src/lib/base44WebhookEvents.ts records what Base44 said.
 * This is the other half: the shell holds rows of its own that point at a Base44
 * app, and an event that nothing acts on is just a row in a table.
 *
 * ## Deleted
 *
 * Two kinds of row point at an app: a `Widget` — a pin on somebody's dashboard —
 * and an `AppOwnership`, the register `listAppsForUser` intersects the workspace
 * folder against. Left in place after a delete the first renders an iframe of an
 * app that is not there, and the second keeps claiming it. Both go.
 *
 * This is the part polling cannot do. `listApps` stops returning a trashed app,
 * so the intersection empties on its own *eventually* — but a `Widget` row is
 * not in that intersection at all. It renders from its own stored url, so it
 * would sit on the dashboard indefinitely with nothing to tell it otherwise.
 *
 * ## Restored
 *
 * `AppOwnership` comes back, because without it the app is invisible in the
 * shell for ever and no later event will fix that. The dashboard pin does not: a
 * pin is a placement its owner chose — a slot, a height, a width — and inventing
 * one back is worse than letting them re-add it. The notice says so.
 *
 * ## Owner-scoped, through the same door as everything else
 *
 * Every row this removes is an owner-scoped model, so every removal goes through
 * `src/lib/entityCrud.ts` with an actor built from the event's resolved owner.
 * Nothing here queries `Widget` or `AppOwnership` directly and the read and
 * write paths in that file are untouched — the RLS predicate does the scoping,
 * which is exactly what keeps a webhook from reaching another user's rows.
 *
 * `Base44AppState` is the exception and a deliberate one: it is not a
 * `USER_OWNED_MODELS` entry, never reaches `/api/entities`, and its owner column
 * is `ownerEmail` rather than `createdBy`, so this module scopes it by hand —
 * the same carve-out `appInstall.ts` and `marketplace.ts` hold. Every query
 * below carries `ownerEmail`.
 */

import type { Base44AppNotice, Prisma } from "@prisma/client";

import type { RlsActor } from "@/lib/rls";
import { createEntity, deleteEntity, listEntities } from "@/lib/entityCrud";
import { prisma } from "@/lib/prisma";

/** One transition the owner has not seen, as the browser receives it. */
export type AppNotice = {
  app_id: string;
  /** Null when the shell never held a row naming it — see the module note. */
  app_name: string | null;
  kind: Base44AppNotice;
  at: string;
};

/**
 * More than a handful means something is wrong upstream, not that the user needs
 * eleven toasts. The rest stay pending and arrive on the next poll.
 */
const MAX_PER_CLAIM = 5;

/** The fields a mirrored transition contributes to the app's state row. */
type MirrorPatch = Pick<Prisma.Base44AppStateUpdateInput, "appName" | "pendingNotice" | "noticeAt">;

/**
 * The event names an owner, not a session, so the actor is built from that
 * email. `role` is "user" because no role widens the owner predicate — admin
 * included — so there is no privileged variant of this to get wrong.
 */
const actorFor = (ownerEmail: string): RlsActor => ({ email: ownerEmail, role: "user" });

/** The shell's own name for an app, off whichever row still carries one. */
async function lastKnownName(actor: RlsActor, appId: string): Promise<string | null> {
  for (const model of ["Widget", "AppOwnership"] as const) {
    const [row] = await listEntities(model, actor, { where: { appId }, take: 1 });
    const name = row?.app_name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return null;
}

/**
 * Deletes every row of `model` this owner has pointing at `appId`.
 *
 * List-then-delete rather than one predicate delete, so it composes the
 * functions `entityCrud.ts` already exports instead of adding a write shape to
 * the file the whole RLS argument rests on. A user has one or two widgets for a
 * given app, so the extra round trips are not worth a new chokepoint.
 */
async function removeRowsFor(
  model: "Widget" | "AppOwnership",
  actor: RlsActor,
  appId: string,
): Promise<number> {
  const rows = await listEntities(model, actor, { where: { appId } });
  let removed = 0;
  for (const row of rows) {
    if (typeof row.id === "string" && (await deleteEntity(model, actor, row.id))) removed += 1;
  }
  return removed;
}

/**
 * Brings the shell into line with one verified transition and returns the state
 * fields that record it. Call only for an owner that resolved, and only after
 * the staleness gate: a late `app.deleted` must not tear down an app a newer
 * `app.restored` already brought back.
 *
 * Throwing is the right failure. The route turns it into a 500, Base44 retries,
 * and the alternative — a 2xx for an app the shell still shows — is a lie that
 * nothing later corrects.
 */
export async function mirrorTransition(args: {
  eventType: string;
  appId: string;
  ownerEmail: string;
  occurredAt: Date;
  knownName: string | null;
}): Promise<MirrorPatch> {
  const { eventType, appId, ownerEmail, occurredAt, knownName } = args;
  const actor = actorFor(ownerEmail);

  if (eventType === "app.deleted.v1") {
    // Read the name before the rows carrying it are deleted.
    const appName = (await lastKnownName(actor, appId)) ?? knownName;
    const widgets = await removeRowsFor("Widget", actor, appId);
    const ownerships = await removeRowsFor("AppOwnership", actor, appId);
    console.log(
      `[base44-mirror] ${appId} trashed: removed ${widgets} widget(s), ${ownerships} ownership row(s)`,
    );
    return { appName, pendingNotice: "deleted", noticeAt: occurredAt };
  }

  if (eventType === "app.restored.v1") {
    // The register only, and only if absent. Restoring is idempotent because a
    // redelivered event must not create a second row — which the unique
    // (appId, createdBy) index would refuse anyway.
    const [existing] = await listEntities("AppOwnership", actor, { where: { appId }, take: 1 });
    if (!existing) await createEntity("AppOwnership", actor, { appId, appName: knownName });
    console.log(`[base44-mirror] ${appId} restored${existing ? "" : ": ownership row recreated"}`);
    return { pendingNotice: "restored", noticeAt: occurredAt };
  }

  return {};
}

/**
 * Hands `actor` the transitions they have not been told about, and marks them
 * told in the same call.
 *
 * The clear is a compare-and-swap on the value just read, so a notice belongs to
 * exactly one caller: two open tabs divide the notices between them instead of
 * each announcing all of them. Losing one to a tab that closes mid-flight is
 * acceptable by design — a notice is a courtesy, and the removal it describes
 * already happened and is durable.
 */
export async function claimNotices(actor: RlsActor): Promise<AppNotice[]> {
  const ownerEmail = actor.email;
  const pending = await prisma.base44AppState.findMany({
    where: { ownerEmail, pendingNotice: { not: null } },
    select: { appId: true, appName: true, pendingNotice: true, noticeAt: true },
    orderBy: { noticeAt: "asc" },
    take: MAX_PER_CLAIM,
  });

  const claimed: AppNotice[] = [];
  for (const row of pending) {
    const { count } = await prisma.base44AppState.updateMany({
      where: { appId: row.appId, ownerEmail, pendingNotice: row.pendingNotice },
      data: { pendingNotice: null, noticeAt: null },
    });
    if (count !== 1 || !row.pendingNotice) continue;
    claimed.push({
      app_id: row.appId,
      app_name: row.appName,
      kind: row.pendingNotice,
      at: (row.noticeAt ?? new Date()).toISOString(),
    });
  }
  return claimed;
}

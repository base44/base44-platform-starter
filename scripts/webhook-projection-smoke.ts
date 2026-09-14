/**
 * Boundary 5, the other half: what the shell *does* with a verified event.
 *
 *   npm run webhook:projection:smoke
 *
 * `webhook:smoke` proves a request is from Base44. This proves what happens
 * next, which is where the consequences are: `app.deleted.v1` removes rows.
 *
 * Five properties, each of which is a way to get this wrong:
 *
 *   1. a deletion removes the pins and the ownership register, and captures the
 *      app's name off them *before* they go — the event carries no name
 *   2. a notice is claimed exactly once, so two open tabs do not double-announce
 *   3. a restore puts the register back (or the app is invisible for ever) and
 *      deliberately does not put the dashboard pin back
 *   4. a late `app.deleted` is dropped, and does not tear down an app that a
 *      newer `app.restored` already brought back
 *   5. an event whose owning principal is not one of ours touches no rows at all
 *
 * Unlike `webhook:smoke` this needs a database. It writes throwaway rows to
 * DATABASE_URL and cleans up after itself — scratch databases only.
 */

import { claimNotices } from "../src/lib/base44AppMirror";
import { projectEvent, type CloudEvent } from "../src/lib/base44WebhookEvents";
import { prisma } from "../src/lib/prisma";
import type { RlsActor } from "../src/lib/rls";

const TAG = "webhook-projection-smoke";
const OWNER = "projection-smoke@example.com";
const PRINCIPAL = `sunny-${TAG}`;
const APP_ID = `app-${TAG}`;
const ACTOR: RlsActor = { email: OWNER, role: "user" };

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✔ ${name}`);
  else {
    failures += 1;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function event(type: string, time: Date, principal: string | null = PRINCIPAL): CloudEvent {
  return {
    id: `evt-${TAG}-${type}-${time.getTime()}`,
    type,
    source: "https://base44.com/workspaces/smoke",
    time: time.toISOString(),
    data: {
      app_id: APP_ID,
      workspace_id: "smoke",
      owner_id: "owner",
      ...(principal ? { owner_service_external_id: principal } : {}),
    },
  };
}

async function cleanup() {
  await prisma.widget.deleteMany({ where: { createdBy: OWNER } });
  await prisma.appOwnership.deleteMany({ where: { createdBy: OWNER } });
  await prisma.base44AppState.deleteMany({ where: { appId: APP_ID } });
  await prisma.base44Link.deleteMany({ where: { appUserEmail: OWNER } });
}

/** The rows a user who built an app and pinned it would have. */
async function seedFootprint() {
  await prisma.widget.create({
    data: { appId: APP_ID, appName: `${TAG} notes`, createdBy: OWNER, orderIndex: 1 },
  });
  await prisma.appOwnership.create({
    data: { appId: APP_ID, appName: `${TAG} notes`, createdBy: OWNER },
  });
}

const widgets = () => prisma.widget.count({ where: { appId: APP_ID, createdBy: OWNER } });
const owned = () => prisma.appOwnership.count({ where: { appId: APP_ID, createdBy: OWNER } });
const state = () => prisma.base44AppState.findUnique({ where: { appId: APP_ID } });

async function main() {
  await cleanup();

  // The join that makes an event nameable: owner_service_external_id -> email.
  await prisma.base44Link.create({
    data: {
      appUserEmail: OWNER,
      serviceExternalId: PRINCIPAL,
      status: "linked",
      createdBy: OWNER,
    },
  });

  const t0 = new Date("2026-09-14T10:00:00.000Z");
  const t1 = new Date("2026-09-14T11:00:00.000Z");

  // --- 1. deletion removes the footprint and keeps the name ------------------
  console.log("\ndeletion");
  await seedFootprint();
  check("app.deleted.v1 applied", (await projectEvent(event("app.deleted.v1", t0))) === "applied");
  check("the dashboard pin is gone", (await widgets()) === 0);
  check("the ownership register row is gone", (await owned()) === 0);

  const trashed = await state();
  check("lifecycle is trashed, not purged", trashed?.lifecycle === "trashed");
  check(
    "the app's name was captured off the rows before they went",
    trashed?.appName === `${TAG} notes`,
    `got ${trashed?.appName}`,
  );
  check("a notice is pending", trashed?.pendingNotice === "deleted");

  // --- 2. a notice is claimed exactly once -----------------------------------
  console.log("\nnotice");
  const first = await claimNotices(ACTOR);
  check("the owner is handed one notice", first.length === 1, `got ${first.length}`);
  check("it names the app", first[0]?.app_name === `${TAG} notes`);
  check("it says what happened", first[0]?.kind === "deleted");
  check("a second claim gets nothing", (await claimNotices(ACTOR)).length === 0);

  // --- 3. restore puts back the register, not the pin ------------------------
  console.log("\nrestore");
  check("app.restored.v1 applied", (await projectEvent(event("app.restored.v1", t1))) === "applied");
  check("the ownership register row is back", (await owned()) === 1);
  check("the dashboard pin is NOT resurrected", (await widgets()) === 0);
  const restored = await state();
  check("lifecycle is active again", restored?.lifecycle === "active");
  check("the restore is announced too", restored?.pendingNotice === "restored");
  check("the recreated row carries the name we knew", (await prisma.appOwnership.findFirst({
    where: { appId: APP_ID, createdBy: OWNER },
  }))?.appName === `${TAG} notes`);

  // --- 4. a superseded deletion must not tear the app down again ------------
  console.log("\nout-of-order delivery");
  check(
    "a deletion older than the restore is ignored",
    (await projectEvent(event("app.deleted.v1", t0))) === "ignored_stale",
  );
  check("and it removed nothing", (await owned()) === 1);

  // --- 5. an unknown principal touches nothing -----------------------------
  console.log("\nunresolvable owner");
  await claimNotices(ACTOR);
  const t2 = new Date("2026-09-14T12:00:00.000Z");
  check(
    "an event for a principal we never provisioned still records state",
    (await projectEvent(event("app.deleted.v1", t2, "sunny-someone-elses-tool"))) === "applied",
  );
  check("but removes no rows", (await owned()) === 1);
  check("and raises no notice, because there is nobody to tell", (await state())?.pendingNotice === null);

  await cleanup();
  console.log(
    failures === 0 ? "\nall projection checks passed." : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error("\nsmoke test errored:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());

/**
 * Smoke test for the hand-enforced RLS in src/lib/rls.ts.
 *
 * RLS is no longer enforced by the platform, so the only thing standing between
 * one user and another's boards is scopedWhere() being spread into every query.
 * This asserts the properties that matter, against real rows:
 *
 *   1. a read sees only its own rows
 *   2. no role, admin included, widens that
 *   3. a cross-user write through updateMany/deleteMany affects 0 rows
 *   4. the by-id update/delete trap really is a trap (documents why *Many)
 *   5. deleting a board cascades to its items
 *   6. an unauthenticated actor throws rather than returning everything
 *   7. schema defaults and enums round-trip
 *   8. readWhere() adds shared boards (and their items) to a read, and only to a
 *      read — the write predicate does not move
 *
 * Writes to whatever DATABASE_URL points at, then cleans up after itself.
 * Run against a scratch database only:  npx tsx scripts/rls-smoke.ts
 */

import { prisma } from "../src/lib/prisma";
import {
  scopedWhere,
  readWhere,
  ownerFields,
  canAccess,
  UnauthenticatedError,
  type RlsActor,
} from "../src/lib/rls";

const ALICE: RlsActor = { email: "alice@example.com", role: "user" };
const BOB: RlsActor = { email: "bob@example.com", role: "user" };
const ADMIN: RlsActor = { email: "admin@example.com", role: "admin" };

const TAG = "rls-smoke";
let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function cleanup() {
  // items cascade from boards; delete boards last so the cascade does the work.
  await prisma.item.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.board.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.widget.deleteMany({ where: { appName: { startsWith: TAG } } });
}

async function main() {
  await cleanup();

  // --- fixtures: one board each, an item each ---------------------------------
  const aliceBoard = await prisma.board.create({
    data: { title: `${TAG} alice board`, ...ownerFields(ALICE) },
  });
  const bobBoard = await prisma.board.create({
    data: { title: `${TAG} bob board`, ...ownerFields(BOB) },
  });
  await prisma.item.create({
    data: { title: `${TAG} alice item`, boardId: aliceBoard.id, ...ownerFields(ALICE) },
  });
  await prisma.item.create({
    data: { title: `${TAG} bob item`, boardId: bobBoard.id, ...ownerFields(BOB) },
  });

  console.log("\n1. reads are scoped");
  const aliceBoards = await prisma.board.findMany({
    where: { ...scopedWhere(ALICE), title: { startsWith: TAG } },
  });
  check("alice sees exactly 1 board", aliceBoards.length === 1, `saw ${aliceBoards.length}`);
  check("and it is hers", aliceBoards[0]?.id === aliceBoard.id);
  check("bob's board is not visible to alice", !aliceBoards.some((b) => b.id === bobBoard.id));

  console.log("\n2. the admin role is not a bypass");
  const adminBoards = await prisma.board.findMany({
    where: { ...scopedWhere(ADMIN), title: { startsWith: TAG } },
  });
  check(
    "admin sees neither of the other two boards",
    adminBoards.length === 0,
    `saw ${adminBoards.length}`,
  );
  check(
    "scopedWhere(admin) still scopes to the email",
    scopedWhere(ADMIN).createdBy === ADMIN.email,
  );

  console.log("\n3. cross-user writes through *Many affect nothing");
  const stolenUpdate = await prisma.board.updateMany({
    where: { ...scopedWhere(ALICE), id: bobBoard.id },
    data: { title: `${TAG} PWNED` },
  });
  check(
    "alice updating bob's board touches 0 rows",
    stolenUpdate.count === 0,
    `count=${stolenUpdate.count}`,
  );

  const stolenDelete = await prisma.board.deleteMany({
    where: { ...scopedWhere(ALICE), id: bobBoard.id },
  });
  check(
    "alice deleting bob's board touches 0 rows",
    stolenDelete.count === 0,
    `count=${stolenDelete.count}`,
  );

  const bobStillThere = await prisma.board.findUnique({ where: { id: bobBoard.id } });
  check("bob's board survived untouched", bobStillThere?.title === `${TAG} bob board`);

  const ownUpdate = await prisma.board.updateMany({
    where: { ...scopedWhere(ALICE), id: aliceBoard.id },
    data: { color: "#FF0000" },
  });
  check(
    "alice updating her own board touches 1 row",
    ownUpdate.count === 1,
    `count=${ownUpdate.count}`,
  );

  console.log("\n4. the by-id trap (why writes must use *Many)");
  // prisma.board.update({where:{id}}) takes a UNIQUE where — createdBy cannot be
  // added to it, so it would happily rewrite bob's row. Proven, then reverted.
  const trap = await prisma.board.update({
    where: { id: bobBoard.id },
    data: { title: `${TAG} bob board TRAPPED` },
  });
  check(
    "update-by-id ignores ownership entirely",
    trap.createdBy === BOB.email && trap.title.endsWith("TRAPPED"),
  );
  await prisma.board.update({ where: { id: bobBoard.id }, data: { title: `${TAG} bob board` } });

  console.log("\n5. board delete cascades to items");
  const doomed = await prisma.board.create({
    data: { title: `${TAG} doomed board`, ...ownerFields(ALICE) },
  });
  await prisma.item.create({
    data: { title: `${TAG} doomed item`, boardId: doomed.id, ...ownerFields(ALICE) },
  });
  await prisma.board.deleteMany({ where: { ...scopedWhere(ALICE), id: doomed.id } });
  const orphans = await prisma.item.count({ where: { boardId: doomed.id } });
  check("items went with the board", orphans === 0, `${orphans} orphan(s) left`);

  console.log("\n6. no session fails closed");
  let threw = false;
  try {
    scopedWhere(null);
  } catch (e) {
    threw = e instanceof UnauthenticatedError;
  }
  check("scopedWhere(null) throws UnauthenticatedError", threw);
  check(
    "ownerFields(null) throws",
    (() => {
      try {
        ownerFields(undefined);
        return false;
      } catch {
        return true;
      }
    })(),
  );
  check("canAccess(null, row) is false", canAccess(null, { createdBy: ALICE.email }) === false);
  check("canAccess denies a non-owner", canAccess(BOB, { createdBy: ALICE.email }) === false);
  check("canAccess allows the owner", canAccess(ALICE, { createdBy: ALICE.email }) === true);
  check(
    "canAccess denies an admin someone else's row",
    canAccess(ADMIN, { createdBy: ALICE.email }) === false,
  );
  check(
    "canAccess allows an admin their own row",
    canAccess(ADMIN, { createdBy: ADMIN.email }) === true,
  );

  console.log("\n7. defaults and enums round-trip");
  const fresh = await prisma.board.findUniqueOrThrow({ where: { id: bobBoard.id } });
  check("visibility defaults to private", fresh.visibility === "private");
  check("view_type defaults to table", fresh.viewType === "table");
  check("color defaults to Sunny blue", fresh.color === "#0073EA");
  check(
    "columns/groups default to []",
    Array.isArray(fresh.columns) && Array.isArray(fresh.groups),
  );
  const item = await prisma.item.findFirstOrThrow({ where: { title: `${TAG} bob item` } });
  check("priority defaults to medium", item.priority === "medium");
  check("data defaults to {}", JSON.stringify(item.data) === "{}");

  console.log("\n8. readWhere widens reads to shared boards, and nothing else");

  // Bob shares his board. Nothing else about it changes.
  await prisma.board.update({ where: { id: bobBoard.id }, data: { visibility: "shared" } });

  const aliceReads = await prisma.board.findMany({
    where: { AND: [{ title: { startsWith: TAG } }, readWhere(ALICE, "Board")] },
  });
  check("alice now reads 2 boards", aliceReads.length === 2, `saw ${aliceReads.length}`);
  check("bob's shared board is one of them", aliceReads.some((b) => b.id === bobBoard.id));

  const aliceItems = await prisma.item.findMany({
    where: { AND: [{ title: { startsWith: TAG } }, readWhere(ALICE, "Item")] },
  });
  check(
    "and its items come with it — a board of invisible rows is not shared",
    aliceItems.some((i) => i.boardId === bobBoard.id),
    `saw ${aliceItems.length} items`,
  );

  // The widening is a property of the row, not of the caller: alice's own board is
  // still private, so bob does not get a reciprocal view.
  const bobReads = await prisma.board.findMany({
    where: { AND: [{ title: { startsWith: TAG } }, readWhere(BOB, "Board")] },
  });
  check("sharing is not mutual", !bobReads.some((b) => b.id === aliceBoard.id));

  // Shared means readable. It does not mean writable.
  const stolenShared = await prisma.board.updateMany({
    where: { id: bobBoard.id, ...scopedWhere(ALICE) },
    data: { title: `${TAG} alice took bob's shared board` },
  });
  check("alice cannot write to the board she can read", stolenShared.count === 0);
  const stolenSharedItem = await prisma.item.deleteMany({
    where: { boardId: bobBoard.id, ...scopedWhere(ALICE) },
  });
  check("nor delete an item on it", stolenSharedItem.count === 0);

  // Widgets and app ownership stay personal whatever any board says.
  check(
    "readWhere(Widget) is the plain owner predicate",
    JSON.stringify(readWhere(ALICE, "Widget")) === JSON.stringify(scopedWhere(ALICE)),
  );
  check(
    "readWhere(AppOwnership) is the plain owner predicate",
    JSON.stringify(readWhere(ALICE, "AppOwnership")) === JSON.stringify(scopedWhere(ALICE)),
  );
  check(
    "readWhere throws unauthenticated, like scopedWhere",
    (() => {
      try {
        readWhere(null, "Board");
        return false;
      } catch (err) {
        return err instanceof UnauthenticatedError;
      }
    })(),
  );

  await cleanup();

  console.log(failures === 0 ? "\nall RLS checks passed." : `\n${failures} CHECK(S) FAILED.`);
  if (failures) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error("\nsmoke test errored:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());

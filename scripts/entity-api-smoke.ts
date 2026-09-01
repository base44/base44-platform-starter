/**
 * Smoke test for the entity API — the security-critical half of the data layer.
 *
 * Runs over HTTP against `npm run dev`, with session cookies minted from
 * NEXTAUTH_SECRET (same trick as scripts/auth-smoke.ts), so it exercises the real
 * route handlers, the real session decode and the real Prisma queries. What it is
 * actually protecting:
 *
 *   1. no route reachable without a session; Base44Link/User not reachable at all
 *   2. reads are scoped — including on AppOwnership, the one genuinely multi-owner
 *      table, and including the cross-owner item of gotcha 2
 *   3. **writes cannot touch another user's row** — the gotcha 1 trap, over HTTP
 *   4. `created_by` comes from the session and nowhere else (gotcha 6)
 *   5. the q/sort/body whitelists reject anything undeclared, so nothing reaches a
 *      Prisma `where` that could subvert the RLS predicate
 *
 * Writes throwaway rows to DATABASE_URL and cleans up. Scratch database only:
 *   npm run dev            # in another shell
 *   npm run entities:smoke
 */

import { encode } from "next-auth/jwt";

import { prisma } from "../src/lib/prisma";

const TAG = "entity-smoke";
const OWNER = `${TAG}-owner@example.com`;
const OTHER = `${TAG}-other@example.com`;
const ADMIN = `${TAG}-admin@example.com`;

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const SECRET = process.env.NEXTAUTH_SECRET!;

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Rec = Record<string, unknown>;
type Res = { status: number; body: unknown };

const cookies: Record<string, string> = {};

async function mintCookie(email: string, role: "user" | "admin") {
  const jwt = await encode({
    token: { email, role, roleCheckedAt: Date.now() },
    secret: SECRET,
  });
  cookies[email] = `next-auth.session-token=${jwt}`;
}

async function api(
  method: string,
  path: string,
  opts: { as?: string; body?: unknown } = {},
): Promise<Res> {
  const res = await fetch(`${BASE_URL}/api/entities${path}`, {
    method,
    headers: {
      ...(opts.as ? { cookie: cookies[opts.as] } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const rows = (r: Res) => (Array.isArray(r.body) ? (r.body as Rec[]) : []);
const ids = (r: Res) => rows(r).map((x) => x.id);

async function cleanup() {
  await prisma.item.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.board.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.widget.deleteMany({ where: { appName: { startsWith: TAG } } });
  await prisma.appOwnership.deleteMany({ where: { appId: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function main() {
  try {
    const ping = await fetch(`${BASE_URL}/api/auth/providers`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!ping.ok) throw new Error(String(ping.status));
  } catch {
    console.error(`\nNo dev server at ${BASE_URL}. Start it with \`npm run dev\` and re-run.`);
    process.exitCode = 1;
    return;
  }

  await cleanup();

  await prisma.user.createMany({
    data: [
      { email: OWNER, role: "user" },
      { email: OTHER, role: "user" },
      { email: ADMIN, role: "admin" },
    ],
  });
  await Promise.all([
    mintCookie(OWNER, "user"),
    mintCookie(OTHER, "user"),
    mintCookie(ADMIN, "admin"),
  ]);

  // --- fixtures, written straight to Postgres so the API is only ever the reader --
  const ownerBoard = await prisma.board.create({
    data: {
      title: `${TAG} owner board`,
      createdBy: OWNER,
      columns: [{ id: "task", title: "Task" }],
    },
  });
  const otherBoard = await prisma.board.create({
    data: { title: `${TAG} other board`, createdBy: OTHER },
  });
  const ownerItem = await prisma.item.create({
    data: { title: `${TAG} owner item`, boardId: ownerBoard.id, createdBy: OWNER, orderIndex: 2 },
  });
  const otherItem = await prisma.item.create({
    data: { title: `${TAG} other item`, boardId: otherBoard.id, createdBy: OTHER, orderIndex: 1 },
  });
  // Gotcha 2 in the flesh: OWNER owns an item sitting on OTHER's board.
  const crossItem = await prisma.item.create({
    data: { title: `${TAG} cross item`, boardId: otherBoard.id, createdBy: OWNER, orderIndex: 3 },
  });
  // AppOwnership is the genuinely multi-owner table.
  await prisma.appOwnership.createMany({
    data: [
      { appId: `${TAG}-app-1`, appName: `${TAG} 1`, createdBy: OWNER },
      { appId: `${TAG}-app-2`, appName: `${TAG} 2`, createdBy: OWNER },
      { appId: `${TAG}-app-3`, appName: `${TAG} 3`, createdBy: OTHER },
    ],
  });

  console.log("\n1. the boundary: session required, allowlist enforced");

  check("anonymous list is 401", (await api("GET", "/Board")).status === 401);
  check(
    "anonymous create is 401",
    (await api("POST", "/Board", { body: { title: "x" } })).status === 401,
  );
  check("anonymous get-by-id is 401", (await api("GET", `/Board/${ownerBoard.id}`)).status === 401);
  check(
    "anonymous update is 401",
    (await api("PUT", `/Board/${ownerBoard.id}`, { body: { title: "x" } })).status === 401,
  );
  check("anonymous delete is 401", (await api("DELETE", `/Board/${ownerBoard.id}`)).status === 401);
  check("anonymous bulk is 401", (await api("POST", "/Board/bulk", { body: [] })).status === 401);
  check(
    "an unsignable cookie is 401",
    (
      await fetch(`${BASE_URL}/api/entities/Board`, {
        headers: { cookie: "next-auth.session-token=nope" },
      })
    ).status === 401,
  );

  check(
    "Base44Link is not reachable",
    (await api("GET", "/Base44Link", { as: ADMIN })).status === 404,
  );
  check("...not even lowercased", (await api("GET", "/base44link", { as: ADMIN })).status === 404);
  check(
    "User is not reachable (that is /api/me)",
    (await api("GET", "/User", { as: ADMIN })).status === 404,
  );
  check("an unknown entity is 404", (await api("GET", "/Nope", { as: OWNER })).status === 404);
  check(
    "lowercase entity names resolve",
    (await api("GET", "/board", { as: OWNER })).status === 200,
  );

  console.log("\n2. reads are scoped");

  const ownerBoards = await api("GET", `/Board?q=${encodeURIComponent(JSON.stringify({}))}`, {
    as: OWNER,
  });
  check(
    "owner sees only their board",
    ids(ownerBoards).includes(ownerBoard.id) && !ids(ownerBoards).includes(otherBoard.id),
  );
  const otherBoards = await api("GET", "/Board", { as: OTHER });
  check(
    "other sees only theirs",
    ids(otherBoards).includes(otherBoard.id) && !ids(otherBoards).includes(ownerBoard.id),
  );
  const adminBoards = await api("GET", "/Board", { as: ADMIN });
  check(
    "admin sees both",
    ids(adminBoards).includes(ownerBoard.id) && ids(adminBoards).includes(otherBoard.id),
  );

  check(
    "get-by-id on someone else's row is 404",
    (await api("GET", `/Board/${otherBoard.id}`, { as: OWNER })).status === 404,
  );
  check(
    "get-by-id on your own row is 200",
    (await api("GET", `/Board/${ownerBoard.id}`, { as: OWNER })).status === 200,
  );
  check(
    "admin get-by-id crosses owners",
    (await api("GET", `/Board/${otherBoard.id}`, { as: ADMIN })).status === 200,
  );

  const ownerApps = await api("GET", `/AppOwnership?q=${encodeURIComponent(JSON.stringify({}))}`, {
    as: OWNER,
  });
  const smokeApps = rows(ownerApps).filter((r) => String(r.app_id).startsWith(TAG));
  check(
    "multi-owner table scopes correctly (2 of 3)",
    smokeApps.length === 2,
    `saw ${smokeApps.length}`,
  );
  check(
    "...and none of them belong to other",
    smokeApps.every((r) => r.created_by === OWNER),
  );

  const ownerItems = rows(await api("GET", "/Item", { as: OWNER })).filter((r) =>
    String(r.title).startsWith(TAG),
  );
  check(
    "gotcha 2: the cross-owner item IS visible to its owner",
    ownerItems.some((r) => r.id === crossItem.id),
  );
  check("...its board is not", !ids(ownerBoards).includes(otherBoard.id));
  check(
    "...and items are not scoped through their board",
    ownerItems.length === 2,
    `saw ${ownerItems.length}`,
  );
  check("other's item is invisible", !ownerItems.some((r) => r.id === otherItem.id));

  console.log("\n3. the wire contract");

  const one = (await api("GET", `/Board/${ownerBoard.id}`, { as: OWNER })).body as Rec;
  check("snake_case field names", "view_type" in one && "created_by" in one);
  check(
    "created_date / updated_date, not createdAt",
    "created_date" in one && !("createdAt" in one),
  );
  check(
    "dates are ISO strings",
    typeof one.created_date === "string" && (one.created_date as string).endsWith("Z"),
  );
  check(
    "Json columns round-trip",
    Array.isArray(one.columns) && (one.columns as Rec[])[0]?.id === "task",
  );
  check(
    "enums come back as their string values",
    one.visibility === "private" && one.view_type === "table",
  );
  check(
    "no camelCase leaks",
    !Object.keys(one).some((k) => /[A-Z]/.test(k)),
    Object.keys(one).join(),
  );

  console.log("\n4. filter / sort / limit");

  const byBoard = await api(
    "GET",
    `/Item?q=${encodeURIComponent(JSON.stringify({ board_id: otherBoard.id }))}`,
    { as: OWNER },
  );
  check(
    "filter by board_id works and stays scoped",
    ids(byBoard).length === 1 && ids(byBoard)[0] === crossItem.id,
  );

  const sorted = rows(await api("GET", "/Item?sort_by=-order_index", { as: OWNER })).filter((r) =>
    String(r.title).startsWith(TAG),
  );
  check(
    "sort_by=-order_index is descending",
    sorted[0]?.id === crossItem.id && sorted[1]?.id === ownerItem.id,
  );
  const asc = rows(await api("GET", "/Item?sort_by=order_index", { as: OWNER })).filter((r) =>
    String(r.title).startsWith(TAG),
  );
  check("sort_by=order_index is ascending", asc[0]?.id === ownerItem.id);
  check("limit truncates", rows(await api("GET", "/Item?limit=1", { as: OWNER })).length === 1);
  check(
    "skip offsets",
    (await api("GET", "/Item?sort_by=order_index&skip=1&limit=1", { as: OWNER })).status === 200,
  );

  console.log("\n5. the whitelists (an injection here defeats RLS)");

  const inject = async (q: unknown) =>
    (await api("GET", `/Board?q=${encodeURIComponent(JSON.stringify(q))}`, { as: OWNER })).status;
  check("an operator object is rejected", (await inject({ created_by: { not: OWNER } })) === 400);
  check("a relation traversal is rejected", (await inject({ items: { some: {} } })) === 400);
  check("an undeclared field is rejected", (await inject({ createdBy: OTHER })) === 400);
  check(
    "a non-filterable field is rejected",
    (await inject({ created_date: "2026-01-01" })) === 400,
  );
  check("a Json column is not filterable", (await inject({ columns: [] })) === 400);
  check(
    "malformed q is rejected",
    (await api("GET", "/Board?q=%7Bnope", { as: OWNER })).status === 400,
  );
  check(
    "an unknown sort field is rejected",
    (await api("GET", "/Board?sort_by=secret", { as: OWNER })).status === 400,
  );
  check(
    "a negative limit is rejected",
    (await api("GET", "/Board?limit=-1", { as: OWNER })).status === 400,
  );

  // created_by IS a legal filter key — the point is that it cannot widen the scope.
  const spoof = await api(
    "GET",
    `/Board?q=${encodeURIComponent(JSON.stringify({ created_by: OTHER }))}`,
    { as: OWNER },
  );
  check(
    "filtering by another user's created_by returns nothing",
    rows(spoof).length === 0,
    `saw ${rows(spoof).length}`,
  );

  console.log("\n6. create stamps the owner from the session");

  const created = await api("POST", "/Board", {
    as: OWNER,
    body: { title: `${TAG} created`, color: "#123456" },
  });
  check("create returns 201", created.status === 201, `got ${created.status}`);
  const createdBoard = created.body as Rec;
  check("created_by is the session user", createdBoard.created_by === OWNER);
  check(
    "defaults are applied",
    createdBoard.visibility === "private" && createdBoard.view_type === "table",
  );
  check(
    "created_by in the body is rejected, not honoured",
    (await api("POST", "/Board", { as: OWNER, body: { title: `${TAG} spoof`, created_by: OTHER } }))
      .status === 400,
  );
  check(
    "id in the body is rejected",
    (await api("POST", "/Board", { as: OWNER, body: { title: `${TAG} spoof`, id: "forced" } }))
      .status === 400,
  );
  check(
    "created_date in the body is rejected",
    (
      await api("POST", "/Board", {
        as: OWNER,
        body: { title: `${TAG} spoof`, created_date: "2020-01-01" },
      })
    ).status === 400,
  );
  check(
    "a missing required field is rejected",
    (await api("POST", "/Board", { as: OWNER, body: { color: "#fff" } })).status === 400,
  );
  check(
    "an unknown field is rejected",
    (await api("POST", "/Board", { as: OWNER, body: { title: `${TAG} x`, nope: 1 } })).status ===
      400,
  );
  check(
    "a bad enum value is rejected",
    (await api("POST", "/Board", { as: OWNER, body: { title: `${TAG} x`, visibility: "public" } }))
      .status === 400,
  );
  check(
    "a bad scalar type is rejected",
    (
      await api("POST", "/Item", {
        as: OWNER,
        body: { title: `${TAG} x`, board_id: ownerBoard.id, data: 5 },
      })
    ).status === 400,
  );
  check(
    "no spoofed board was created",
    (await prisma.board.count({ where: { title: { startsWith: `${TAG} spoof` } } })) === 0,
  );

  console.log("\n7. bulkCreate");

  const bulk = await api("POST", "/Item/bulk", {
    as: OWNER,
    body: [
      { title: `${TAG} bulk 1`, board_id: ownerBoard.id, order_index: 10 },
      { title: `${TAG} bulk 2`, board_id: ownerBoard.id, order_index: 11 },
    ],
  });
  check("bulk returns 201 with the rows", bulk.status === 201 && rows(bulk).length === 2);
  check(
    "every row is owned by the session user",
    rows(bulk).every((r) => r.created_by === OWNER),
  );
  check(
    "a non-array body is rejected",
    (await api("POST", "/Item/bulk", { as: OWNER, body: {} })).status === 400,
  );
  check(
    "an empty array is rejected",
    (await api("POST", "/Item/bulk", { as: OWNER, body: [] })).status === 400,
  );
  const partial = await api("POST", "/Item/bulk", {
    as: OWNER,
    body: [{ title: `${TAG} good`, board_id: ownerBoard.id }, { board_id: ownerBoard.id }],
  });
  check("one bad record rejects the whole batch", partial.status === 400);
  check(
    "...and nothing was inserted",
    (await prisma.item.count({ where: { title: `${TAG} good` } })) === 0,
  );

  console.log("\n8. writes cannot cross owners (gotcha 1, over HTTP)");

  const okUpdate = await api("PUT", `/Board/${ownerBoard.id}`, {
    as: OWNER,
    body: { title: `${TAG} renamed` },
  });
  check("updating your own row is 200", okUpdate.status === 200);
  check("...and returns the updated record", (okUpdate.body as Rec).title === `${TAG} renamed`);
  check(
    "...and persisted",
    (await prisma.board.findUnique({ where: { id: ownerBoard.id } }))?.title === `${TAG} renamed`,
  );

  const crossUpdate = await api("PUT", `/Board/${otherBoard.id}`, {
    as: OWNER,
    body: { title: "HIJACKED" },
  });
  check(
    "updating someone else's row is 404",
    crossUpdate.status === 404,
    `got ${crossUpdate.status}`,
  );
  check(
    "...and left the row untouched",
    (await prisma.board.findUnique({ where: { id: otherBoard.id } }))?.title ===
      `${TAG} other board`,
  );

  const crossDelete = await api("DELETE", `/Item/${otherItem.id}`, { as: OWNER });
  check(
    "deleting someone else's row is 404",
    crossDelete.status === 404,
    `got ${crossDelete.status}`,
  );
  check(
    "...and the row survives",
    (await prisma.item.findUnique({ where: { id: otherItem.id } })) !== null,
  );

  check(
    "a read-only field cannot be updated",
    (await api("PUT", `/Board/${ownerBoard.id}`, { as: OWNER, body: { created_by: OTHER } }))
      .status === 400,
  );
  check(
    "the owner did not change",
    (await prisma.board.findUnique({ where: { id: ownerBoard.id } }))?.createdBy === OWNER,
  );
  check(
    "an empty update body is rejected",
    (await api("PUT", `/Board/${ownerBoard.id}`, { as: OWNER, body: {} })).status === 400,
  );
  check(
    "updating a missing id is 404",
    (await api("PUT", "/Board/nope", { as: OWNER, body: { title: "x" } })).status === 404,
  );

  const ownDelete = await api("DELETE", `/Item/${ownerItem.id}`, { as: OWNER });
  check("deleting your own row is 200", ownDelete.status === 200);
  check(
    "...and it is gone",
    (await prisma.item.findUnique({ where: { id: ownerItem.id } })) === null,
  );
  check(
    "deleting it again is 404",
    (await api("DELETE", `/Item/${ownerItem.id}`, { as: OWNER })).status === 404,
  );

  const adminDelete = await api("DELETE", `/Board/${createdBoard.id as string}`, { as: ADMIN });
  check("an admin write crosses owners", adminDelete.status === 200, `got ${adminDelete.status}`);

  // Cascade still applies through the API path.
  await api("DELETE", `/Board/${otherBoard.id}`, { as: OTHER });
  check(
    "deleting a board cascades to its items",
    (await prisma.item.count({ where: { boardId: otherBoard.id } })) === 0,
  );

  await cleanup();

  console.log(
    failures === 0 ? "\nall entity API checks passed." : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error("\nentity API smoke test errored:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());

/**
 * Contract test for /api/sunny — the public data API that externally-hosted built
 * apps call. Getting this *nearly* right silently breaks deployed apps, so every
 * assertion here is a statement about the wire contract in
 * the `sunny-platform` skill (docs/sunny-platform-skill.md), not about this
 * implementation.
 *
 * What it pins down:
 *   1. the boundary — CORS + preflight, POST-only, and the shared-token gate
 *      (this route has no session; the token is the whole gate, gotcha 4)
 *   2. all six actions, their required-param error strings verbatim, and the
 *      response keys built apps destructure (`{boards}`/`{board}`/`{items}`/`{item}`/`{ok}`)
 *   3. service-role semantics: results span ALL owners, deliberately unscoped
 *   4. `listItems` on an unknown board is an empty list, NOT an error — apps rely on it
 *   5. unknown payload fields are dropped silently, as documented
 *   6. the record shape is byte-identical to /api/entities for the same row
 *   7. items created here are invisible to a non-admin through /api/entities, which is
 *      the RLS consequence of the SERVICE_OWNER sentinel
 *
 * Needs `npm run dev`. Writes throwaway rows to DATABASE_URL and cleans up:
 *   npm run sunny:smoke
 */

import { encode } from "next-auth/jwt";

import { prisma } from "../src/lib/prisma";

const TAG = "sunny-smoke";
const OWNER_A = `${TAG}-a@example.com`;
const OWNER_B = `${TAG}-b@example.com`;
const ADMIN = `${TAG}-admin@example.com`;
const SERVICE_OWNER = "sunny-api@service.local";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const URL = `${BASE_URL}/api/sunny`;
const TOKEN = process.env.SUNNY_API_TOKEN;

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
type Res = { status: number; body: Rec; headers: Headers };

/** A built app's call: POST, JSON, shared token, nothing else. */
async function call(payload: unknown, opts: { token?: string | null } = {}): Promise<Res> {
  const token = opts.token === undefined ? TOKEN : opts.token;
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-sunny-api-token": token } : {}),
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Rec,
    headers: res.headers,
  };
}

const list = (r: Res, key: string) => (Array.isArray(r.body[key]) ? (r.body[key] as Rec[]) : []);

async function cleanup() {
  await prisma.item.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.board.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.item.deleteMany({ where: { createdBy: SERVICE_OWNER, title: { startsWith: TAG } } });
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
      { email: OWNER_A, role: "user" },
      { email: OWNER_B, role: "user" },
      { email: ADMIN, role: "admin" },
    ],
  });

  // Two owners, so "service role returns everyone's rows" is actually testable.
  const boardA = await prisma.board.create({
    data: {
      title: `${TAG} board A`,
      createdBy: OWNER_A,
      columns: [{ id: "c1", title: "Status", type: "status" }],
      groups: [{ id: "g1", title: "Group 1" }],
      updatedAt: new Date("2026-08-01T00:00:00Z"),
    },
  });
  const boardB = await prisma.board.create({
    data: {
      title: `${TAG} board B`,
      createdBy: OWNER_B,
      updatedAt: new Date("2026-08-02T00:00:00Z"),
    },
  });
  await prisma.item.createMany({
    data: [
      { title: `${TAG} item 2`, boardId: boardA.id, createdBy: OWNER_A, orderIndex: 2 },
      { title: `${TAG} item 1`, boardId: boardA.id, createdBy: OWNER_A, orderIndex: 1 },
      { title: `${TAG} item B`, boardId: boardB.id, createdBy: OWNER_B, orderIndex: 1 },
    ],
  });

  console.log("\n1. the boundary: CORS, preflight, POST-only");

  const pre = await fetch(URL, { method: "OPTIONS" });
  check("OPTIONS is 204", pre.status === 204, `got ${pre.status}`);
  check("...with no body", (await pre.text()) === "");
  check("Access-Control-Allow-Origin is *", pre.headers.get("access-control-allow-origin") === "*");
  check(
    "...Allow-Methods is POST, OPTIONS",
    pre.headers.get("access-control-allow-methods") === "POST, OPTIONS",
  );
  check(
    "...Allow-Headers covers the token header",
    pre.headers.get("access-control-allow-headers") === "Content-Type, X-Sunny-Api-Token",
  );
  check("...Max-Age is 86400", pre.headers.get("access-control-max-age") === "86400");

  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const res = await fetch(URL, { method });
    const body = (await res.json().catch(() => ({}))) as Rec;
    check(
      `${method} is 405 "Use POST."`,
      res.status === 405 && body.error === "Use POST.",
      `${res.status}`,
    );
  }

  console.log("\n2. the shared-token gate");

  if (!TOKEN) {
    check(
      "SUNNY_API_TOKEN is set (otherwise the endpoint is OPEN)",
      false,
      "set it in .env and restart dev",
    );
  } else {
    const noToken = await call({ action: "listBoards" }, { token: null });
    check("no token is 401", noToken.status === 401, `got ${noToken.status}`);
    check(
      "...with the documented message",
      noToken.body.error === "Missing or invalid X-Sunny-Api-Token.",
      String(noToken.body.error),
    );
    check("...and still carries CORS", noToken.headers.get("access-control-allow-origin") === "*");
    check(
      "a wrong token of equal length is 401",
      (await call({ action: "listBoards" }, { token: "x".repeat(TOKEN.length) })).status === 401,
    );
    check(
      "a wrong token of different length is 401",
      (await call({ action: "listBoards" }, { token: "short" })).status === 401,
    );
    check("the right token is accepted", (await call({ action: "listBoards" })).status === 200);
  }

  console.log("\n3. malformed requests");

  const notJson = await call("not json at all");
  check("a non-JSON body is 400", notJson.status === 400);
  check(
    "...with the documented message",
    notJson.body.error === 'Body must be JSON, e.g. {"action":"listBoards"}',
    String(notJson.body.error),
  );

  const unknown = await call({ action: "nope" });
  check("an unknown action is 400", unknown.status === 400);
  check(
    "...naming the action",
    unknown.body.error === 'Unknown action "nope".',
    String(unknown.body.error),
  );
  check(
    "...and listing all six actions",
    JSON.stringify(unknown.body.actions) ===
      JSON.stringify([
        "listBoards",
        "getBoard",
        "listItems",
        "createItem",
        "updateItem",
        "deleteItem",
      ]),
  );
  check("a missing action is 400", (await call({})).status === 400);

  console.log("\n4. listBoards");

  const boards = await call({ action: "listBoards" });
  check("returns { boards }", boards.status === 200 && Array.isArray(boards.body.boards));
  const smokeBoards = list(boards, "boards").filter((b) => String(b.title).startsWith(TAG));
  check(
    "service role spans owners (both boards)",
    smokeBoards.length === 2,
    `saw ${smokeBoards.length}`,
  );
  // Owners are checked by id, since the endpoint deliberately withholds created_by.
  check(
    "...one from each owner",
    smokeBoards.some((b) => b.id === boardA.id) && smokeBoards.some((b) => b.id === boardB.id),
  );
  check(
    "...and no board leaks its owner's email",
    smokeBoards.every((b) => !("created_by" in b)),
  );
  check("newest-updated first", smokeBoards[0]?.id === boardB.id, String(smokeBoards[0]?.title));
  check(
    "limit=1 truncates",
    list(await call({ action: "listBoards", limit: 1 }), "boards").length === 1,
  );
  check(
    "limit=1000 clamps to 500",
    list(await call({ action: "listBoards", limit: 1000 }), "boards").length <= 500,
  );
  check(
    "limit=0 falls back to the default",
    (await call({ action: "listBoards", limit: 0 })).status === 200,
  );
  check(
    "limit=-5 falls back to the default",
    (await call({ action: "listBoards", limit: -5 })).status === 200,
  );
  check(
    "a non-numeric limit falls back to the default",
    (await call({ action: "listBoards", limit: "abc" })).status === 200,
  );
  check(
    "a fractional limit does not error",
    (await call({ action: "listBoards", limit: 2.7 })).status === 200,
  );

  console.log("\n5. getBoard");

  check(
    "missing board_id is 400",
    (await call({ action: "getBoard" })).body.error === "getBoard needs board_id.",
  );
  const got = await call({ action: "getBoard", board_id: boardA.id });
  check("returns { board }", got.status === 200 && typeof got.body.board === "object");
  const board = got.body.board as Rec;
  check(
    "columns come back (the documented reason to call it)",
    Array.isArray(board.columns) && (board.columns as Rec[])[0]?.id === "c1",
  );
  check("groups come back", Array.isArray(board.groups) && (board.groups as Rec[])[0]?.id === "g1");
  check(
    "snake_case + created_date",
    "view_type" in board && "created_date" in board && !("createdAt" in board),
  );
  check("created_by is withheld from this endpoint", !("created_by" in board));
  const missing = await call({ action: "getBoard", board_id: "nope" });
  check(
    "an unknown board is an { error } 4xx",
    missing.status === 404 && typeof missing.body.error === "string",
    `got ${missing.status}`,
  );

  console.log("\n6. listItems");

  const allItems = await call({ action: "listItems" });
  check("returns { items }", allItems.status === 200 && Array.isArray(allItems.body.items));
  const smokeItems = list(allItems, "items").filter((i) => String(i.title).startsWith(TAG));
  check("unscoped: spans owners", smokeItems.length === 3, `saw ${smokeItems.length}`);

  const scoped = await call({ action: "listItems", board_id: boardA.id });
  const scopedItems = list(scoped, "items");
  check("board-scoped returns only that board's items", scopedItems.length === 2);
  check(
    "...ordered by order_index ascending",
    scopedItems[0]?.title === `${TAG} item 1`,
    String(scopedItems[0]?.title),
  );
  check(
    "...with board_id echoed",
    scopedItems.every((i) => i.board_id === boardA.id),
  );

  const emptyBoard = await call({ action: "listItems", board_id: "does-not-exist" });
  check("an unknown board_id is 200 with an EMPTY LIST, not an error", emptyBoard.status === 200);
  check(
    "...and the list really is empty",
    JSON.stringify(emptyBoard.body) === '{"items":[]}',
    JSON.stringify(emptyBoard.body),
  );

  console.log("\n7. createItem");

  check(
    "missing board_id/title is 400",
    (await call({ action: "createItem", board_id: boardA.id })).body.error ===
      "createItem needs board_id and title.",
  );
  check(
    "...also when only title is given",
    (await call({ action: "createItem", title: "x" })).body.error ===
      "createItem needs board_id and title.",
  );

  const created = await call({
    action: "createItem",
    board_id: boardA.id,
    title: `${TAG} created`,
    group_id: "g1",
    priority: "high",
    order_index: 9,
    data: { c1: "Working on it" },
    // Undeclared and platform-owned keys: documented as dropped silently.
    nope: "ignored",
    created_by: "attacker@example.com",
    id: "forced-id",
  });
  check("returns { item }", created.status === 200 && typeof created.body.item === "object");
  const item = created.body.item as Rec;
  check(
    "the writable fields landed",
    item.title === `${TAG} created` && item.priority === "high" && item.group_id === "g1",
  );
  check("data is keyed by column id", JSON.stringify(item.data) === '{"c1":"Working on it"}');
  check("an undeclared field was dropped, not an error", !("nope" in item));
  check("created_by is not exposed (matches the live old endpoint)", !("created_by" in item));
  check(
    "...and the stored owner is the service sentinel, not the spoofed value",
    (await prisma.item.findUnique({ where: { id: item.id as string } }))?.createdBy ===
      SERVICE_OWNER,
  );
  check("id cannot be forced", item.id !== "forced-id");
  check(
    "a bogus board_id is a 400, not an orphan row",
    (await call({ action: "createItem", board_id: "nope", title: `${TAG} orphan` })).status === 400,
  );
  check(
    "...and nothing was written",
    (await prisma.item.count({ where: { title: `${TAG} orphan` } })) === 0,
  );
  check(
    "a bad field type is a 400",
    (await call({ action: "createItem", board_id: boardA.id, title: `${TAG} bad`, data: 5 }))
      .status === 400,
  );

  console.log("\n8. updateItem");

  const itemId = item.id as string;
  check(
    "missing item_id is 400",
    (await call({ action: "updateItem" })).body.error === "updateItem needs item_id.",
  );
  const patched = await call({
    action: "updateItem",
    item_id: itemId,
    patch: { title: `${TAG} patched` },
  });
  check(
    "the { patch } shape works",
    patched.status === 200 && (patched.body.item as Rec).title === `${TAG} patched`,
  );
  const flat = await call({ action: "updateItem", item_id: itemId, title: `${TAG} flat` });
  check(
    "the flat shape works too",
    flat.status === 200 && (flat.body.item as Rec).title === `${TAG} flat`,
  );
  check(
    "...and persisted",
    (await prisma.item.findUnique({ where: { id: itemId } }))?.title === `${TAG} flat`,
  );
  check(
    "an empty patch is 400",
    (await call({ action: "updateItem", item_id: itemId, patch: {} })).body.error ===
      "updateItem needs at least one writable field.",
  );
  check(
    "a patch of only undeclared fields is 400",
    (await call({ action: "updateItem", item_id: itemId, patch: { nope: 1 } })).body.error ===
      "updateItem needs at least one writable field.",
  );
  check(
    "an unknown item_id is 404",
    (await call({ action: "updateItem", item_id: "nope", title: "x" })).status === 404,
  );
  check(
    "moving an item to a bogus board is 400",
    (await call({ action: "updateItem", item_id: itemId, patch: { board_id: "nope" } })).status ===
      400,
  );

  console.log("\n9. deleteItem");

  check(
    "missing item_id is 400",
    (await call({ action: "deleteItem" })).body.error === "deleteItem needs item_id.",
  );
  const deleted = await call({ action: "deleteItem", item_id: itemId });
  check(
    "returns { ok: true }",
    deleted.status === 200 && JSON.stringify(deleted.body) === '{"ok":true}',
  );
  check(
    "...and the row is gone",
    (await prisma.item.findUnique({ where: { id: itemId } })) === null,
  );
  check(
    "deleting it again is 404",
    (await call({ action: "deleteItem", item_id: itemId })).status === 404,
  );

  console.log("\n10. one record shape across both APIs");

  const adminCookie = `next-auth.session-token=${await encode({
    token: { email: ADMIN, role: "admin", roleCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
  })}`;
  const viaEntities = await fetch(`${BASE_URL}/api/entities/Board/${boardA.id}`, {
    headers: { cookie: adminCookie },
  }).then((r) => r.json());
  const viaSunny = (await call({ action: "getBoard", board_id: boardA.id })).body.board as Rec;
  const entitiesRecord = viaEntities as Rec;
  check("/api/entities does expose created_by", "created_by" in entitiesRecord);
  delete entitiesRecord.created_by;
  check(
    "the two APIs agree field for field once created_by is set aside",
    JSON.stringify(viaSunny) === JSON.stringify(entitiesRecord),
    `sunny=${JSON.stringify(viaSunny)?.slice(0, 140)}`,
  );

  console.log("\n11. RLS consequence of the service owner");

  const serviceItem = await call({
    action: "createItem",
    board_id: boardA.id,
    title: `${TAG} service item`,
  });
  const serviceItemId = (serviceItem.body.item as Rec).id as string;
  const userCookie = `next-auth.session-token=${await encode({
    token: { email: OWNER_A, role: "user", roleCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
  })}`;
  const asUser = (await fetch(`${BASE_URL}/api/entities/Item?limit=5000`, {
    headers: { cookie: userCookie },
  }).then((r) => r.json())) as Rec[];
  const asAdmin = (await fetch(`${BASE_URL}/api/entities/Item?limit=5000`, {
    headers: { cookie: adminCookie },
  }).then((r) => r.json())) as Rec[];
  check(
    "an item created here is hidden from a non-admin",
    !asUser.some((i) => i.id === serviceItemId),
  );
  check(
    "...but visible to an admin",
    asAdmin.some((i) => i.id === serviceItemId),
  );
  check(
    "...and readable back through /api/sunny",
    list(await call({ action: "listItems", board_id: boardA.id }), "items").some(
      (i) => i.id === serviceItemId,
    ),
  );

  await cleanup();

  console.log(
    failures === 0 ? "\nall /api/sunny contract checks passed." : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error("\nsunny API smoke test errored:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());

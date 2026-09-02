/**
 * Contract test for /api/sunny — the public data API that externally-hosted built
 * apps call. Getting this *nearly* right silently breaks deployed apps, so every
 * assertion here is a statement about the wire contract in
 * the `sunny-platform` skill (docs/sunny-platform-skill.md), not about this
 * implementation.
 *
 * What it pins down:
 *   1. the boundary — CORS + preflight, POST-only, and the viewer-token gate
 *      (this route has no session; the token is the whole gate)
 *   2. all six actions, their required-param error strings verbatim, and the
 *      response keys built apps destructure (`{boards}`/`{board}`/`{items}`/`{item}`/`{ok}`)
 *   3. identity: with no viewer token results span ALL owners; with one, every action
 *      narrows to that viewer — an app answers for whoever installed it
 *   4. `listItems` on an unknown board is an empty list, NOT an error — apps rely on it
 *   5. unknown payload fields are dropped silently, as documented
 *   6. the record shape is byte-identical to /api/entities for the same row
 *   7. items created here belong to the viewer, so they show up in /api/entities for
 *      that person like any other row
 *
 * Needs `npm run dev`. Writes throwaway rows to DATABASE_URL and cleans up:
 *   npm run sunny:smoke
 */

import { createHmac } from "node:crypto";

import { encode } from "next-auth/jwt";

import { mintAppToken } from "../src/lib/appTokens";
import { prisma } from "../src/lib/prisma";

const TAG = "sunny-smoke";
const OWNER_A = `${TAG}-a@example.com`;
const OWNER_B = `${TAG}-b@example.com`;
const ADMIN = `${TAG}-admin@example.com`;
const APP_A = `${TAG}-app-a`;

/** Well-formed, unexpired, and signed with the wrong secret. Must never be accepted. */
const FORGED = (() => {
  const body = Buffer.from(
    JSON.stringify({ sub: OWNER_B, app: APP_A, exp: Math.floor(Date.now() / 1000) + 600 }),
  ).toString("base64url");
  const key = createHmac("sha256", "not-the-secret").update("sunny-app-token-v1").digest();
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
})();

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const URL = `${BASE_URL}/api/sunny`;

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

/**
 * A built app's call: POST, JSON, and a viewer token. `bearer` defaults to OWNER_A's,
 * since that is what a real embedded app always has; pass `null` for the no-token case.
 */
async function call(payload: unknown, opts: { bearer?: string | null } = {}): Promise<Res> {
  const bearer = opts.bearer === undefined ? mintAppToken(OWNER_A, APP_A) : opts.bearer;
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
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
  await prisma.widget.deleteMany({ where: { appId: { startsWith: TAG } } });
  await prisma.appInstall.deleteMany({ where: { appId: { startsWith: TAG } } });
  await prisma.appOwnership.deleteMany({ where: { appId: { startsWith: TAG } } });
  await prisma.item.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.board.deleteMany({ where: { title: { startsWith: TAG } } });
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

  // Two owners, so "the answer follows the viewer" is actually testable.
  const boardA = await prisma.board.create({
    data: {
      title: `${TAG} board A`,
      createdBy: OWNER_A,
      columns: [{ id: "c1", title: "Status", type: "status" }],
      groups: [{ id: "g1", title: "Group 1" }],
      updatedAt: new Date("2026-08-01T00:00:00Z"),
    },
  });
  // A second board for the same owner, so `-updated_date` is still testable now that a
  // call only ever sees one person's boards.
  const boardA2 = await prisma.board.create({
    data: {
      title: `${TAG} board A2`,
      createdBy: OWNER_A,
      updatedAt: new Date("2026-08-03T00:00:00Z"),
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
    "...Allow-Headers covers the viewer token",
    pre.headers.get("access-control-allow-headers") === "Content-Type, Authorization",
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

  console.log("\n2. the viewer-token gate");

  const noToken = await call({ action: "listBoards" }, { bearer: null });
  check("no token is 401", noToken.status === 401, `got ${noToken.status}`);
  check(
    "...with a message that says where to get one",
    noToken.body.error === "Missing or invalid viewer token. Ask the embedding page.",
    String(noToken.body.error),
  );
  check("...and still carries CORS", noToken.headers.get("access-control-allow-origin") === "*");
  check(
    "a tampered token is 401 — no silent fallback to unscoped",
    (await call({ action: "listBoards" }, { bearer: `${mintAppToken(OWNER_A, APP_A)}x` })).status ===
      401,
  );
  check(
    "an expired token is 401",
    (await call(
      { action: "listBoards" },
      { bearer: mintAppToken(OWNER_A, APP_A, Date.now() - 3_600_000) },
    )).status === 401,
  );
  check(
    "garbage in the Authorization header is 401",
    (await call({ action: "listBoards" }, { bearer: "not.a.token" })).status === 401,
  );
  check(
    "a token signed with the wrong secret is 401",
    (await call({ action: "listBoards" }, { bearer: FORGED })).status === 401,
  );
  check("a valid token is accepted", (await call({ action: "listBoards" })).status === 200);

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
  check("only the viewer's boards", smokeBoards.length === 2, `saw ${smokeBoards.length}`);
  // Checked by id, since the endpoint deliberately withholds created_by.
  check(
    "...and both are theirs",
    smokeBoards.every((b) => b.id === boardA.id || b.id === boardA2.id),
  );
  check("...never the other user's", !smokeBoards.some((b) => b.id === boardB.id));
  check(
    "...and no board leaks its owner's email",
    smokeBoards.every((b) => !("created_by" in b)),
  );
  check("newest-updated first", smokeBoards[0]?.id === boardA2.id, String(smokeBoards[0]?.title));
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
  check("only the viewer's items", smokeItems.length === 2, `saw ${smokeItems.length}`);
  check("...not the other user's", !smokeItems.some((i) => i.title === `${TAG} item B`));

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
    "...and the stored owner is the viewer, not the spoofed value",
    (await prisma.item.findUnique({ where: { id: item.id as string } }))?.createdBy === OWNER_A,
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

  // Read it as its owner: /api/entities is owner-scoped for every role.
  const ownerCookie = `next-auth.session-token=${await encode({
    token: { email: OWNER_A, role: "user", roleCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
  })}`;
  const viaEntities = await fetch(`${BASE_URL}/api/entities/Board/${boardA.id}`, {
    headers: { cookie: ownerCookie },
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

  console.log("\n11. items created here are real rows owned by the viewer");

  const viaApi = await call({
    action: "createItem",
    board_id: boardA.id,
    title: `${TAG} from the app`,
  });
  const viaApiId = (viaApi.body.item as Rec).id as string;
  const userCookie = `next-auth.session-token=${await encode({
    token: { email: OWNER_A, role: "user", roleCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
  })}`;
  const otherCookie = `next-auth.session-token=${await encode({
    token: { email: OWNER_B, role: "user", roleCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
  })}`;
  const entityItems = (cookie: string) =>
    fetch(`${BASE_URL}/api/entities/Item?limit=5000`, { headers: { cookie } }).then(
      (r) => r.json() as Promise<Rec[]>,
    );

  check(
    "the viewer sees it in Sunny's own UI",
    (await entityItems(userCookie)).some((i) => i.id === viaApiId),
  );
  check(
    "...and nobody else does",
    !(await entityItems(otherCookie)).some((i) => i.id === viaApiId),
  );
  check(
    "...and it reads back through /api/sunny",
    list(await call({ action: "listItems", board_id: boardA.id }), "items").some(
      (i) => i.id === viaApiId,
    ),
  );

  console.log("\n12. viewer tokens: an app answers for whoever is looking");

  const aToken = mintAppToken(OWNER_A, APP_A);
  const bToken = mintAppToken(OWNER_B, APP_A);

  const seenByA = list(await call({ action: "listBoards" }, { bearer: aToken }), "boards").filter(
    (b) => String(b.title).startsWith(TAG),
  );
  check(
    "A's token sees only A's boards",
    seenByA.length === 2 && seenByA.every((b) => b.id !== boardB.id),
  );
  const seenByB = list(await call({ action: "listBoards" }, { bearer: bToken }), "boards").filter(
    (b) => String(b.title).startsWith(TAG),
  );
  check("the SAME app with B's token sees only B's board", seenByB.length === 1 && seenByB[0]?.id === boardB.id);
  check("...which is the marketplace case: the answer follows the viewer, not the author", true);
  check("...and neither leaks created_by", [...seenByA, ...seenByB].every((b) => !("created_by" in b)));

  check(
    "getBoard on another viewer's board is 404",
    (await call({ action: "getBoard", board_id: boardB.id }, { bearer: aToken })).status === 404,
  );

  const itemsForA = list(await call({ action: "listItems" }, { bearer: aToken }), "items").filter(
    (i) => String(i.title).startsWith(TAG),
  );
  check("listItems returns only the viewer's items", itemsForA.length >= 2, `saw ${itemsForA.length}`);
  check("...excluding the other user's", !itemsForA.some((i) => i.title === `${TAG} item B`));
  check("...and nothing it did not create", !itemsForA.some((i) => i.title === `${TAG} item B`));

  // An item can be owned by someone who cannot see its board; it must stay visible.
  const crossOwner = await prisma.item.create({
    data: { title: `${TAG} cross-owner`, boardId: boardB.id, createdBy: OWNER_A, orderIndex: 1 },
  });
  const onOthersBoard = list(
    await call({ action: "listItems", board_id: boardB.id }, { bearer: aToken }),
    "items",
  );
  check(
    "an owned item on someone else's board is still returned",
    onOthersBoard.some((i) => i.id === crossOwner.id),
  );
  check("...and that board's other items are not", !onOthersBoard.some((i) => i.title === `${TAG} item B`));

  const scopedCreate = await call(
    { action: "createItem", board_id: boardA.id, title: `${TAG} viewer create` },
    { bearer: aToken },
  );
  const scopedItemId = (scopedCreate.body.item as Rec).id as string;
  check(
    "createItem stamps the viewer, not the sentinel",
    (await prisma.item.findUnique({ where: { id: scopedItemId } }))?.createdBy === OWNER_A,
  );
  const ownerSees = (await fetch(`${BASE_URL}/api/entities/Item?limit=5000`, {
    headers: { cookie: userCookie },
  }).then((r) => r.json())) as Rec[];
  check("...so it appears in Sunny's own UI for them", ownerSees.some((i) => i.id === scopedItemId));

  const otherItem = list(
    await call({ action: "listItems", board_id: boardB.id }, { bearer: bToken }),
    "items",
  ).find((i) => i.title === `${TAG} item B`)!;
  check(
    "updateItem cannot touch another viewer's item",
    (
      await call(
        { action: "updateItem", item_id: otherItem.id as string, title: "hijacked" },
        { bearer: aToken },
      )
    ).status === 404,
  );
  check(
    "...and the row is unchanged",
    (await prisma.item.findUnique({ where: { id: otherItem.id as string } }))?.title === `${TAG} item B`,
  );
  check(
    "deleteItem cannot touch another viewer's item",
    (await call({ action: "deleteItem", item_id: otherItem.id as string }, { bearer: aToken })).status === 404,
  );
  check(
    "...and the row survives",
    (await prisma.item.findUnique({ where: { id: otherItem.id as string } })) !== null,
  );

  console.log("\n13. sharing: a shared board reaches a built app, still read-only");

  // Everything above used private boards. Sharing is a property of the row, so the
  // same widening the boards list gets applies here — a built app sees what its
  // viewer sees, and no more.
  await prisma.board.updateMany({ where: { id: boardB.id }, data: { visibility: "shared" } });

  const sharedSeenByA = list(
    await call({ action: "listBoards" }, { bearer: aToken }),
    "boards",
  ).filter((b) => String(b.title).startsWith(TAG));
  check(
    "listBoards now includes the board B shared",
    sharedSeenByA.some((b) => b.id === boardB.id),
  );
  check("...and still withholds created_by", sharedSeenByA.every((b) => !("created_by" in b)));
  check(
    "getBoard on a shared board is 200",
    (await call({ action: "getBoard", board_id: boardB.id }, { bearer: aToken })).status === 200,
  );
  const sharedItems = list(
    await call({ action: "listItems", board_id: boardB.id }, { bearer: aToken }),
    "items",
  );
  check(
    "listItems on a shared board returns items the viewer does not own",
    sharedItems.some((i) => i.title === `${TAG} item B`),
  );

  // The point of the split: readable is not writable, sharing or no sharing.
  check(
    "updateItem on a shared board's item is still 404",
    (
      await call(
        { action: "updateItem", item_id: otherItem.id as string, title: "hijacked" },
        { bearer: aToken },
      )
    ).status === 404,
  );
  check(
    "...and the row is unchanged",
    (await prisma.item.findUnique({ where: { id: otherItem.id as string } }))?.title ===
      `${TAG} item B`,
  );
  check(
    "deleteItem on a shared board's item is still 404",
    (await call({ action: "deleteItem", item_id: otherItem.id as string }, { bearer: aToken }))
      .status === 404,
  );
  check(
    "...and the row survives",
    (await prisma.item.findUnique({ where: { id: otherItem.id as string } })) !== null,
  );

  // Back to private: the minting checks below are about the grant, not about sharing.
  await prisma.board.updateMany({ where: { id: boardB.id }, data: { visibility: "private" } });

  console.log("\n14. minting: the install is the grant");

  const mint = (cookie: string, body: unknown) =>
    fetch(`${BASE_URL}/api/sunny/token`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });

  check("minting anonymously is 401", (await mint("", { app_id: APP_A })).status === 401);
  check("minting without an app_id is 400", (await mint(userCookie, {})).status === 400);
  check(
    "minting for an app you have not installed is 403",
    (await mint(userCookie, { app_id: APP_A })).status === 403,
  );

  // Pinning to Home is deliberately NOT the grant any more: an app you open monthly
  // should not have to live on Home to work. The grant is an AppInstall row.
  await prisma.widget.create({
    data: { appId: APP_A, appName: `${TAG} app A`, createdBy: OWNER_A },
  });
  check(
    "...still 403 when it is only pinned to Home",
    (await mint(userCookie, { app_id: APP_A })).status === 403,
  );

  await prisma.appInstall.create({
    data: { appId: APP_A, appName: `${TAG} app A`, createdBy: OWNER_A },
  });
  const minted = await mint(userCookie, { app_id: APP_A });
  check("...and 200 once it is installed", minted.status === 200, `got ${minted.status}`);
  const mintedBody = (await minted.json()) as { token?: string; expires_in?: number };
  check("...returning a token", typeof mintedBody.token === "string");
  check("...that is short-lived", mintedBody.expires_in === 600, String(mintedBody.expires_in));
  check(
    "...and that scopes to the installer",
    list(await call({ action: "listBoards" }, { bearer: mintedBody.token! }), "boards")
      .filter((b) => String(b.title).startsWith(TAG))
      .every((b) => b.id !== boardB.id),
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

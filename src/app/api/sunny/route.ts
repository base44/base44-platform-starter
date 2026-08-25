/**
 * POST /api/sunny — the public data API for the apps this shell's users build.
 *
 * The spec is the `sunny-platform` skill the builder reads (see
 * docs/sunny-platform-skill.md), not this file: built apps are written against
 * that contract, so the actions, params, response keys and error strings all have
 * to match it. `npm run sunny:smoke` asserts that contract action by action.
 *
 * Two facts shape the whole file:
 *
 *   1. **Every call is cross-origin** — built apps are separate Base44 apps on their
 *      own subdomains. Nothing works without the CORS headers, preflight included.
 *   2. **The caller has no Sunny session.** A cross-site fetch carries no cookie, so
 *      the request has to bring its own identity.
 *
 * That identity is a **viewer token** (src/lib/appTokens.ts): the Sunny page embedding
 * the app mints one for whoever is signed in and posts it to the frame, and the app
 * sends it as `Authorization: Bearer`. Its subject drives `scopedWhere()`, so an app
 * installed by B answers with B's rows — never its author's.
 *
 * It is the **only** way in: there is no unscoped mode and no shared secret. Every
 * request here is attributable to one person, which is what makes this endpoint no
 * more powerful than the session-scoped API beside it.
 *
 * Consequently this route must not use src/lib/entityCrud.ts — every function there
 * requires an actor. It queries Prisma directly, and `toWire()` is shared with
 * /api/entities only because the field-for-field shapes agree (verified in
 * scripts/sunny-api-smoke.ts).
 */

import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { bearerToken, verifyAppToken } from "@/lib/appTokens";
import { parsePicked, toWire, ValidationError } from "@/lib/entities";
import { prisma } from "@/lib/prisma";
import { scopedWhere } from "@/lib/rls";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/**
 * Item fields a caller may set. Anything else in the payload is dropped, so a client
 * cannot write platform-owned fields.
 */
const ITEM_WRITABLE = [
  "board_id",
  "group_id",
  "title",
  "description",
  "order_index",
  "data",
  "priority",
  "color",
] as const;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;


/**
 * Records here omit `created_by`, unlike /api/entities. Two reasons, and the live old
 * endpoint was diffed to confirm the first:
 *
 *   * **Fidelity.** Base44's service-role reads never returned it — a real board from
 *     the live `sunny_api` has `created_by_id` and `is_sample` and no `created_by`,
 *     and SKILL.md's documented Board/Item schemas do not list it either. No built app
 *     can be depending on it.
 *   * **It would leak.** This endpoint is unscoped and third-party built apps call it,
 *     so shipping `created_by` would hand every caller the email address of every user
 *     with a board.
 */
function publicWire(model: "Board" | "Item", row: Record<string, unknown>) {
  const record = toWire(model, row);
  delete record.created_by;
  return record;
}

const ACTIONS = [
  "listBoards",
  "getBoard",
  "listItems",
  "createItem",
  "updateItem",
  "deleteItem",
] as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

const clampLimit = (limit: unknown) =>
  Math.floor(Math.min(Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT, MAX_LIMIT));

type Payload = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  // The token is minted by this server, expires in minutes and names one app, so it
  // both authenticates the call and says who it speaks for. No token, no answer.
  const viewer = verifyAppToken(bearerToken(req.headers.get("authorization")));
  if (!viewer) {
    return json({ error: "Missing or invalid viewer token. Ask the embedding page." }, 401);
  }
  const scope = scopedWhere({ email: viewer.sub, role: "user" });

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body must be JSON, e.g. {"action":"listBoards"}' }, 400);
  }

  const { action, ...p } = payload as { action?: unknown } & Payload;
  const t0 = Date.now();
  console.log(`[sunny_api] START action=${String(action)}`);

  try {
    switch (action) {
      case "listBoards": {
        const rows = await prisma.board.findMany({
          where: scope,
          orderBy: { updatedAt: "desc" },
          take: clampLimit(p.limit),
        });
        const boards = rows.map((r) => publicWire("Board", r));
        console.log(
          `[sunny_api] END action=listBoards count=${boards.length} (${Date.now() - t0}ms)`,
        );
        return json({ boards });
      }

      case "getBoard": {
        const boardId = str(p.board_id);
        if (!boardId) return json({ error: "getBoard needs board_id." }, 400);

        const row = await prisma.board.findFirst({ where: { id: boardId, ...scope } });
        // A missing item answers 404, not the 500 a bare throw would produce.
        // Same {error} shape, honest status.
        if (!row) return json({ error: `No board with id "${boardId}".` }, 404);

        console.log(`[sunny_api] END action=getBoard board_id=${boardId} (${Date.now() - t0}ms)`);
        return json({ board: publicWire("Board", row) });
      }

      case "listItems": {
        const boardId = str(p.board_id);

        if (boardId) {
          // Board-scoped: an unknown board is an empty list, not an error. Built apps
          // depend on this — do not turn it into a 404.
          //
          // Existence only, deliberately NOT `...scope`: an item can be owned by
          // someone who cannot see its board, so scoping this would hide it.
          const board = await prisma.board.findUnique({
            where: { id: boardId },
            select: { id: true },
          });
          if (!board) {
            console.warn(
              `[sunny_api] listItems: board_id=${boardId} not found, returning empty list`,
            );
            return json({ items: [] });
          }
        }

        const rows = await prisma.item.findMany({
          where: { ...(boardId ? { boardId } : {}), ...scope },
          orderBy: boardId ? { orderIndex: "asc" } : { updatedAt: "desc" },
          take: clampLimit(p.limit),
        });
        const items = rows.map((r) => publicWire("Item", r));
        console.log(
          `[sunny_api] END action=listItems count=${items.length} (${Date.now() - t0}ms)`,
        );
        return json({ items });
      }

      case "createItem": {
        if (!str(p.board_id) || !str(p.title)) {
          return json({ error: "createItem needs board_id and title." }, 400);
        }

        const data = parsePicked("Item", p, ITEM_WRITABLE);
        // Base44 had no FK, so a bogus board_id silently produced an orphan item
        // Postgres does have one, so check it and answer 400
        // rather than letting a constraint violation surface as a 500.
        const boardExists = await prisma.board.findUnique({
          where: { id: data.boardId as string },
          select: { id: true },
        });
        if (!boardExists)
          return json({ error: `No board with id "${String(data.boardId)}".` }, 400);

        const row = await prisma.item.create({
          data: { ...data, createdBy: viewer.sub } as Prisma.ItemUncheckedCreateInput,
        });
        console.log(`[sunny_api] END action=createItem item_id=${row.id} (${Date.now() - t0}ms)`);
        return json({ item: publicWire("Item", row) });
      }

      case "updateItem": {
        const itemId = str(p.item_id);
        if (!itemId) return json({ error: "updateItem needs item_id." }, 400);

        // Both shapes are supported: {item_id, patch:{…}} and {item_id, …}.
        const patch = parsePicked("Item", (p.patch as Payload) ?? p, ITEM_WRITABLE);
        if (!Object.keys(patch).length) {
          return json({ error: "updateItem needs at least one writable field." }, 400);
        }

        if (patch.boardId !== undefined) {
          const boardExists = await prisma.board.findUnique({
            where: { id: patch.boardId as string },
            select: { id: true },
          });
          if (!boardExists)
            return json({ error: `No board with id "${String(patch.boardId)}".` }, 400);
        }

        const { count } = await prisma.item.updateMany({
          where: { id: itemId, ...scope },
          data: patch as Prisma.ItemUpdateManyMutationInput,
        });
        if (count === 0) return json({ error: `No item with id "${itemId}".` }, 404);

        const row = await prisma.item.findFirst({ where: { id: itemId, ...scope } });
        console.log(`[sunny_api] END action=updateItem item_id=${itemId} (${Date.now() - t0}ms)`);
        return json({ item: row ? publicWire("Item", row) : null });
      }

      case "deleteItem": {
        const itemId = str(p.item_id);
        if (!itemId) return json({ error: "deleteItem needs item_id." }, 400);

        const { count } = await prisma.item.deleteMany({ where: { id: itemId, ...scope } });
        if (count === 0) return json({ error: `No item with id "${itemId}".` }, 404);

        console.log(`[sunny_api] END action=deleteItem item_id=${itemId} (${Date.now() - t0}ms)`);
        return json({ ok: true });
      }

      default:
        console.warn(`[sunny_api] END unknown action="${String(action)}" status=400`);
        return json({ error: `Unknown action "${String(action)}".`, actions: [...ACTIONS] }, 400);
    }
  } catch (err) {
    console.error(`[sunny_api] END action=${String(action)} FAILED (${Date.now() - t0}ms)`, err);
    // A validation failure is the caller's fault; keep the {error} shape either way.
    if (err instanceof ValidationError) return json({ error: err.message }, 400);
    return json({ error: "Internal error." }, 500);
  }
}

/** Anything other than POST/OPTIONS, exactly as before: 405 "Use POST." */
function usePost() {
  return json({ error: "Use POST." }, 405);
}

export const GET = usePost;
export const PUT = usePost;
export const PATCH = usePost;
export const DELETE = usePost;
export const HEAD = usePost;

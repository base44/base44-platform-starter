/**
 * Prisma + RLS for /api/entities. The only module that touches the user-owned
 * models, and it never sees a raw request: `src/lib/entities.ts` has already
 * whitelisted every field by the time anything gets here.
 *
 * Two invariants:
 *   * `scopedWhere(actor)` is **AND-ed** with the caller's filter, so the owner
 *     predicate can only narrow the result and a filter key cannot overwrite it.
 *   * writes go through `updateMany`/`deleteMany` and check `count` — the by-id
 *     forms take a unique `where` that cannot carry `createdBy` and would silently
 *     edit other users' rows.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { toWire } from "@/lib/entities";
import { ownerFields, scopedWhere, type RlsActor, type UserOwnedModel } from "@/lib/rls";

type Row = Record<string, unknown>;

export type ListArgs = {
  where: Row;
  orderBy?: Row;
  take?: number;
  skip?: number;
};

/**
 * Per-model closures over the real delegates. Prisma's delegate methods are
 * generic over `SelectSubset`, so a single structurally-typed delegate does not
 * compile — hence one closure set per model.
 *
 * The casts are where the whitelist pays for itself: `where`/`orderBy` are plain
 * records built exclusively from declared fields in src/lib/entities.ts, so they
 * cannot contain an operator object or a relation traversal.
 */
type Ops = {
  findMany(args: ListArgs): Promise<Row[]>;
  findFirst(where: Row): Promise<Row | null>;
  create(data: Row): Promise<Row>;
  createManyAndReturn(data: Row[]): Promise<Row[]>;
  updateMany(where: Row, data: Row): Promise<number>;
  deleteMany(where: Row): Promise<number>;
};

const OPS: Record<UserOwnedModel, Ops> = {
  Team: {
    findMany: (a) => prisma.team.findMany(a as Prisma.TeamFindManyArgs),
    findFirst: (w) => prisma.team.findFirst({ where: w as Prisma.TeamWhereInput }),
    create: (d) => prisma.team.create({ data: d as Prisma.TeamCreateInput }),
    createManyAndReturn: (d) =>
      prisma.team.createManyAndReturn({ data: d as Prisma.TeamCreateManyInput[] }),
    updateMany: (w, d) =>
      prisma.team
        .updateMany({
          where: w as Prisma.TeamWhereInput,
          data: d as Prisma.TeamUpdateManyMutationInput,
        })
        .then((r) => r.count),
    deleteMany: (w) =>
      prisma.team.deleteMany({ where: w as Prisma.TeamWhereInput }).then((r) => r.count),
  },
  Board: {
    findMany: (a) => prisma.board.findMany(a as Prisma.BoardFindManyArgs),
    findFirst: (w) => prisma.board.findFirst({ where: w as Prisma.BoardWhereInput }),
    create: (d) => prisma.board.create({ data: d as Prisma.BoardCreateInput }),
    createManyAndReturn: (d) =>
      prisma.board.createManyAndReturn({ data: d as Prisma.BoardCreateManyInput[] }),
    updateMany: (w, d) =>
      prisma.board
        .updateMany({
          where: w as Prisma.BoardWhereInput,
          data: d as Prisma.BoardUpdateManyMutationInput,
        })
        .then((r) => r.count),
    deleteMany: (w) =>
      prisma.board.deleteMany({ where: w as Prisma.BoardWhereInput }).then((r) => r.count),
  },
  Item: {
    findMany: (a) => prisma.item.findMany(a as Prisma.ItemFindManyArgs),
    findFirst: (w) => prisma.item.findFirst({ where: w as Prisma.ItemWhereInput }),
    create: (d) => prisma.item.create({ data: d as Prisma.ItemCreateInput }),
    createManyAndReturn: (d) =>
      prisma.item.createManyAndReturn({ data: d as Prisma.ItemCreateManyInput[] }),
    updateMany: (w, d) =>
      prisma.item
        .updateMany({
          where: w as Prisma.ItemWhereInput,
          data: d as Prisma.ItemUpdateManyMutationInput,
        })
        .then((r) => r.count),
    deleteMany: (w) =>
      prisma.item.deleteMany({ where: w as Prisma.ItemWhereInput }).then((r) => r.count),
  },
  Widget: {
    findMany: (a) => prisma.widget.findMany(a as Prisma.WidgetFindManyArgs),
    findFirst: (w) => prisma.widget.findFirst({ where: w as Prisma.WidgetWhereInput }),
    create: (d) => prisma.widget.create({ data: d as Prisma.WidgetCreateInput }),
    createManyAndReturn: (d) =>
      prisma.widget.createManyAndReturn({ data: d as Prisma.WidgetCreateManyInput[] }),
    updateMany: (w, d) =>
      prisma.widget
        .updateMany({
          where: w as Prisma.WidgetWhereInput,
          data: d as Prisma.WidgetUpdateManyMutationInput,
        })
        .then((r) => r.count),
    deleteMany: (w) =>
      prisma.widget.deleteMany({ where: w as Prisma.WidgetWhereInput }).then((r) => r.count),
  },
  AppOwnership: {
    findMany: (a) => prisma.appOwnership.findMany(a as Prisma.AppOwnershipFindManyArgs),
    findFirst: (w) => prisma.appOwnership.findFirst({ where: w as Prisma.AppOwnershipWhereInput }),
    create: (d) => prisma.appOwnership.create({ data: d as Prisma.AppOwnershipCreateInput }),
    createManyAndReturn: (d) =>
      prisma.appOwnership.createManyAndReturn({ data: d as Prisma.AppOwnershipCreateManyInput[] }),
    updateMany: (w, d) =>
      prisma.appOwnership
        .updateMany({
          where: w as Prisma.AppOwnershipWhereInput,
          data: d as Prisma.AppOwnershipUpdateManyMutationInput,
        })
        .then((r) => r.count),
    deleteMany: (w) =>
      prisma.appOwnership
        .deleteMany({ where: w as Prisma.AppOwnershipWhereInput })
        .then((r) => r.count),
  },
};

/** How many rows a single bulkCreate may insert. Base44 had no documented cap. */
export const MAX_BULK = 1000;

export async function listEntities(
  model: UserOwnedModel,
  actor: RlsActor,
  args: ListArgs,
): Promise<Row[]> {
  const rows = await OPS[model].findMany({
    ...args,
    // AND, not a spread: `created_by` is a legal filter key, and spreading would let
    // the owner predicate silently *overwrite* it — returning rows that do not match
    // what the caller asked for. AND-ing keeps both, so the predicate can only ever
    // narrow the result.
    where: { AND: [args.where, scopedWhere(actor)] },
  });
  return rows.map((row) => toWire(model, row));
}

export async function getEntity(
  model: UserOwnedModel,
  actor: RlsActor,
  id: string,
): Promise<Row | null> {
  const row = await OPS[model].findFirst({ id, ...scopedWhere(actor) });
  return row ? toWire(model, row) : null;
}

export async function createEntity(
  model: UserOwnedModel,
  actor: RlsActor,
  data: Row,
): Promise<Row> {
  const row = await OPS[model].create({ ...data, ...ownerFields(actor) });
  return toWire(model, row);
}

export async function bulkCreateEntities(
  model: UserOwnedModel,
  actor: RlsActor,
  records: Row[],
): Promise<Row[]> {
  const owner = ownerFields(actor);
  const rows = await OPS[model].createManyAndReturn(records.map((r) => ({ ...r, ...owner })));
  return rows.map((row) => toWire(model, row));
}

/**
 * Returns null when nothing matched — either the row is gone or it belongs to
 * someone else. The two are deliberately indistinguishable to the caller.
 *
 * `updateMany` cannot return the row, so the write and the re-read run in one
 * transaction; without it a concurrent delete would turn a successful update into
 * a spurious 404.
 */
export async function updateEntity(
  model: UserOwnedModel,
  actor: RlsActor,
  id: string,
  data: Row,
): Promise<Row | null> {
  const where = { id, ...scopedWhere(actor) };
  const row = await prisma.$transaction(async () => {
    const count = await OPS[model].updateMany(where, data);
    if (count === 0) return null;
    return OPS[model].findFirst(where);
  });
  return row ? toWire(model, row) : null;
}

/** False when nothing matched (missing, or owned by someone else). */
export async function deleteEntity(
  model: UserOwnedModel,
  actor: RlsActor,
  id: string,
): Promise<boolean> {
  const count = await OPS[model].deleteMany({ id, ...scopedWhere(actor) });
  return count > 0;
}

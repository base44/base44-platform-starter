/**
 * Hand-enforced RLS.
 *
 * Base44 enforced `created_by == user.email` in the platform. Postgres does not,
 * so this file is the replacement — and the single biggest correctness risk in the
 * design. Every read or write of a user-owned model goes through a predicate from
 * this file; nothing queries those models raw.
 *
 * The owner predicate has no *role* exceptions: `role: "admin"` is a plain user
 * attribute here, not a visibility bypass, so an admin's dashboard shows their own
 * rows and no one else's. Cross-user access is a property of the data, never of the
 * caller — see `readWhere()`, the one widening, which turns on `Board.visibility`.
 *
 * Reads and writes therefore use different predicates:
 *
 *   reads  -> readWhere(actor, model)   own rows, plus anything shared
 *   writes -> scopedWhere(actor)        own rows only, always
 *
 *
 * Deliberately NOT covered here:
 *   - Base44Link — secret-bearing, admin-only under Base44 RLS. Server-only
 *     access keyed by email, never through generic CRUD.
 *   - /api/sunny — its own boundary (CORS + a viewer token, no session cookie). It
 *     queries Prisma directly, but with the predicates from this file and the same
 *     split: readWhere() for its reads, scopedWhere() for its writes, both keyed to
 *     the token's subject. So a built app sees the boards its viewer sees — their own
 *     plus anything shared — and can write only their own.
 */

/** The subset of a NextAuth session this module needs — see src/lib/auth.ts. */
export type RlsActor = {
  email: string;
  role: "user" | "admin";
};

/** Models whose rows are owned by a user and must always be scoped. */
export const USER_OWNED_MODELS = ["Board", "Item", "Widget", "AppOwnership"] as const;

export type UserOwnedModel = (typeof USER_OWNED_MODELS)[number];

export class UnauthenticatedError extends Error {
  constructor() {
    super("No session: user-owned models cannot be queried unauthenticated.");
    this.name = "UnauthenticatedError";
  }
}

/**
 * The owner predicate to spread into every Prisma `where` for a user-owned model.
 * Always the owner's email — no role, including `admin`, widens it.
 *
 *   prisma.board.findMany({ where: { ...scopedWhere(actor), visibility } })
 *   prisma.item.updateMany({ where: { ...scopedWhere(actor), id }, data })
 *
 * Note `updateMany`/`deleteMany` over `update`/`delete` for writes: the by-id
 * variants take a unique `where` and cannot carry the owner predicate, so they
 * would silently edit other users' rows. Use the *Many forms and check `count`.
 */
export function scopedWhere(actor: RlsActor | null | undefined): { createdBy: string } {
  if (!actor?.email) throw new UnauthenticatedError();
  return { createdBy: actor.email };
}

/**
 * The **read** predicate: `scopedWhere()`, widened by the one thing in this schema
 * that means "not just mine" — `Board.visibility = "shared"`.
 *
 * A shared board is readable by every signed-in user of the workspace. There is no
 * per-person grant and no invite list: sharing here is a property of the row, so the
 * predicate stays a plain `where` that Postgres can index, and the visibility pill
 * the UI has always rendered finally means something.
 *
 * `Item` follows its board rather than its own `createdBy`, because a board whose
 * rows are invisible is not shared in any useful sense. That traversal is the only
 * relation filter in the RLS layer; it is written here, never taken from a caller.
 *
 * Writes do NOT use this. Shared means readable, not writable: `createEntity`,
 * `updateEntity` and `deleteEntity` all stay on `scopedWhere()`, so a reader of
 * someone else's board cannot touch it and the *Many + `count` discipline still
 * decides who owns what.
 */
export function readWhere(actor: RlsActor | null | undefined, model: UserOwnedModel): ReadWhere {
  const owner = scopedWhere(actor);
  switch (model) {
    case "Board":
      return { OR: [owner, { visibility: "shared" }] };
    case "Item":
      return { OR: [owner, { board: { visibility: "shared" } }] };
    // Widgets and app ownership are personal: a dashboard is one user's, and an
    // AppOwnership row is the answer to "is this app mine".
    default:
      return owner;
  }
}

/** What `readWhere()` produces: the owner predicate, or an OR that contains it. */
export type ReadWhere =
  | { createdBy: string }
  | { OR: [{ createdBy: string }, Record<string, unknown>] };

/**
 * Owner stamp for creates. Callers must never take `createdBy` from request input.
 */
export function ownerFields(actor: RlsActor | null | undefined): { createdBy: string } {
  if (!actor?.email) throw new UnauthenticatedError();
  return { createdBy: actor.email };
}

/**
 * True if `actor` **owns** an already-loaded row — the write test, not the read one.
 * For the rare case where a row was fetched by a path that could not carry the
 * predicate (e.g. a nested include); prefer scopedWhere at the query.
 *
 * A row the actor can only read, because its board is shared, answers false here.
 */
export function canAccess(actor: RlsActor | null | undefined, row: { createdBy: string }): boolean {
  if (!actor?.email) return false;
  return row.createdBy === actor.email;
}

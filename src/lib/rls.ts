/**
 * Hand-enforced RLS.
 *
 * Base44 enforced `created_by == user.email` in the platform. Postgres does not,
 * so this file is the replacement — and the single biggest correctness risk in the
 * design. Every read or write of a user-owned model goes through `scopedWhere()`;
 * nothing queries those models raw.
 *
 * The predicate has no exceptions: `role: "admin"` is a plain user attribute here,
 * not a visibility bypass, so an admin's dashboard shows their own rows and no one
 * else's. Cross-user access is a job for direct database work, not for a session.
 *
 *
 * Deliberately NOT covered here:
 *   - Base44Link — secret-bearing, admin-only under Base44 RLS. Server-only
 *     access keyed by email, never through generic CRUD.
 *   - /api/sunny — service-role by design (external built apps have no session).
 *     It is its own security boundary: shared token + CORS, not scopedWhere.
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
 * Owner stamp for creates. Callers must never take `createdBy` from request input.
 */
export function ownerFields(actor: RlsActor | null | undefined): { createdBy: string } {
  if (!actor?.email) throw new UnauthenticatedError();
  return { createdBy: actor.email };
}

/**
 * True if `actor` may act on an already-loaded row. For the rare case where a
 * row was fetched by a path that could not carry the predicate (e.g. a nested
 * include); prefer scopedWhere at the query.
 */
export function canAccess(actor: RlsActor | null | undefined, row: { createdBy: string }): boolean {
  if (!actor?.email) return false;
  return row.createdBy === actor.email;
}

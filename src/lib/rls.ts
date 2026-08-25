/**
 * Hand-enforced RLS.
 *
 * Base44 enforced `created_by == user.email` (admins exempt) in the platform.
 * Postgres does not, so this file is the replacement — and the single biggest
 * correctness risk in the design. Every read or write of a user-owned model goes
 * through `scopedWhere()`; nothing queries those models raw.
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
export const USER_OWNED_MODELS = ["Board", "Item", "Widget", "Team", "AppOwnership"] as const;

export type UserOwnedModel = (typeof USER_OWNED_MODELS)[number];

export class UnauthenticatedError extends Error {
  constructor() {
    super("No session: user-owned models cannot be queried unauthenticated.");
    this.name = "UnauthenticatedError";
  }
}

/**
 * The owner predicate to spread into every Prisma `where` for a user-owned model.
 * Admins get `{}` — full visibility, matching the old `user_condition.role == admin`.
 *
 *   prisma.board.findMany({ where: { ...scopedWhere(actor), teamId } })
 *   prisma.item.updateMany({ where: { ...scopedWhere(actor), id }, data })
 *
 * Note `updateMany`/`deleteMany` over `update`/`delete` for writes: the by-id
 * variants take a unique `where` and cannot carry the owner predicate, so they
 * would silently edit other users' rows. Use the *Many forms and check `count`.
 */
export function scopedWhere(actor: RlsActor | null | undefined): { createdBy?: string } {
  if (!actor?.email) throw new UnauthenticatedError();
  if (actor.role === "admin") return {};
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
  return actor.role === "admin" || row.createdBy === actor.email;
}

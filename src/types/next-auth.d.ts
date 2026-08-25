/**
 * Module augmentation so `session.user.role` / `token.role` are typed as the
 * Prisma `Role` enum rather than `any`. Without this, `getSessionUser()` cannot
 * return the `RlsActor` shape that src/lib/rls.ts requires.
 */
import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;
      role?: Role;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    /** Epoch ms of the last DB read of `role`; drives the refresh TTL. */
    roleCheckedAt?: number;
  }
}

/**
 * NextAuth (Auth.js v5) configuration.
 *
 * Google OAuth only, **JWT session strategy** (no adapter, no adapter tables): the
 * `User` model is the whole user store and users match by email.
 *
 * This module is the bridge between NextAuth and src/lib/rls.ts: `getSessionUser()`
 * returns the `RlsActor` shape that `scopedWhere()` expects. Nothing else should
 * read the session directly for authorization.
 *
 * Note this is the shell's *own* auth — it has nothing to do with Base44's. The
 * per-user Base44 identity is minted separately, in src/lib/base44Link.ts.
 */

import NextAuth, { type NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { prisma } from "@/lib/prisma";
import { UnauthenticatedError, type RlsActor } from "@/lib/rls";

/**
 * How long a JWT may serve a cached `role` before it is re-read from Postgres.
 *
 * `role` is a manual DB flag (flipped by hand), so a long-lived JWT would keep
 * granting the `scopedWhere()` admin bypass long after a demotion. Re-reading on
 * a short TTL bounds that to one minute at a cost of at most one indexed query
 * per user per minute.
 */
const ROLE_TTL_MS = 60_000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see .env.example).`);
  }
  return value;
}

export const authConfig: NextAuthConfig = {
  secret: requiredEnv("NEXTAUTH_SECRET"),

  /**
   * Take the deployment's origin from the request's host rather than from env.
   *
   * Netlify is not one of the platforms Auth.js trusts by default, and a preview
   * deploy has no origin of its own to put in env — there is a new URL per pull
   * request. That host is what the redirect proxy below hands back to, so it has to
   * be the live one, not a build-time constant.
   */
  trustHost: true,

  /**
   * Google matches redirect URIs exactly and allows no wildcard, so a preview
   * deployment's own URL can never be registered — there is a new one per pull
   * request. Instead every deployment sends Google the *same* registered callback
   * (production's) and encodes its own origin in the OAuth `state`; production
   * recognises a state that belongs elsewhere and forwards the callback there.
   *
   * Set it to `https://<production-host>/api/auth` on **every** context, production
   * included: the deployment whose own origin matches this URL is the one that does
   * the forwarding. Unset — local dev — the flow is the ordinary direct one.
   *
   * `state` is encrypted with `NEXTAUTH_SECRET`, so only a deployment holding that
   * secret can name a forwarding target, and previews must share production's copy
   * of it for the handshake to verify at all.
   */
  redirectProxyUrl: process.env.AUTH_REDIRECT_PROXY_URL || undefined,

  providers: [
    GoogleProvider({
      clientId: requiredEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    /**
     * Upsert the shell `User` row. Emails are lowercased everywhere, which is
     * what makes the email-keyed AppOwnership / Base44Link rows match at first
     * sign-in.
     *
     * `role` is deliberately absent from both `create` and `update`: the column
     * defaults to `user` on insert and must never be overwritten on sign-in, so
     * an admin promoted by hand in the database stays promoted.
     */
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      await prisma.user.upsert({
        where: { email },
        create: {
          email,
          fullName: user.name ?? null,
          imageUrl: user.image ?? null,
        },
        update: {
          // `?? undefined` = leave the stored value alone when Google omits it.
          fullName: user.name ?? undefined,
          imageUrl: user.image ?? undefined,
        },
      });

      return true;
    },

    async jwt({ token, user, trigger }) {
      const email = (user?.email ?? token.email)?.toLowerCase();
      if (!email) return token;
      token.email = email;

      const stale = Date.now() - (token.roleCheckedAt ?? 0) > ROLE_TTL_MS;
      if (user || trigger === "update" || token.role === undefined || stale) {
        const row = await prisma.user.findUnique({
          where: { email },
          select: { id: true, role: true },
        });
        token.uid = row?.id;
        // Absent row (deleted mid-session) degrades to the least privilege.
        token.role = row?.role ?? "user";
        token.roleCheckedAt = Date.now();
      }

      return token;
    },

    session({ session, token }) {
      if (session.user) {
        // Guarded because `uid` is absent until the jwt callback has read the row.
        if (token.uid) session.user.id = token.uid;
        session.user.email = token.email ?? session.user.email;
        session.user.role = token.role ?? "user";
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** The session shape the app consumes — a superset of `RlsActor`. */
export type SessionUser = RlsActor & {
  id?: string;
  name?: string | null;
  image?: string | null;
};

/**
 * The one way server code learns who the caller is. Returns null when
 * unauthenticated; pass the result straight to `scopedWhere()`/`ownerFields()`.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;

  return {
    email,
    role: session!.user!.role ?? "user",
    id: session!.user!.id,
    name: session!.user!.name ?? null,
    image: session!.user!.image ?? null,
  };
}

/** `getSessionUser()` for paths that cannot proceed anonymously. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

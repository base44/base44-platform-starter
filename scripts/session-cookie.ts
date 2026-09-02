/**
 * The one place the smoke suites forge a session cookie.
 *
 * They cannot click through Google, so they mint the JWT NextAuth would have set.
 * Two things have to match the real thing exactly or the server reads the cookie
 * as anonymous: the cookie **name**, and the **salt** the JWT is encrypted under —
 * Auth.js derives its key from `NEXTAUTH_SECRET` *and* that salt, and uses the
 * cookie name as the salt. Both are the v5 names (`authjs.*`, not `next-auth.*`).
 *
 * Kept out of src/ deliberately: importing src/lib/auth.ts would construct the real
 * NextAuth handler, which demands the Google client env a smoke run has no use for.
 */

import { encode } from "next-auth/jwt";

/** Over HTTPS NextAuth prefixes this with `__Secure-`; the suites run on http. */
export const SESSION_COOKIE_NAME = "authjs.session-token";

/** A `Cookie:` header value carrying a session for `token`. */
export async function sessionCookie(
  token: Record<string, unknown>,
  secret = process.env.NEXTAUTH_SECRET!,
): Promise<string> {
  const jwt = await encode({ token, secret, salt: SESSION_COOKIE_NAME });
  return `${SESSION_COOKIE_NAME}=${jwt}`;
}

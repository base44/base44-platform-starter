/**
 * Prints a signed session cookie so you can sign in locally without Google.
 *
 * Google OAuth only accepts the redirect URIs registered on the client, so
 * `http://localhost:3000/api/auth/callback/google` is a dead end on a machine
 * whose origin was never registered. This mints the cookie NextAuth would have
 * set at the end of that flow — same secret, same JWE, same cookie name — so
 * the rest of the app cannot tell the difference.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/dev-session-cookie.ts <email> [--admin]
 *
 * Then paste the printed one-liner into the browser console on
 * http://localhost:3000 and reload.
 *
 * The printed value is a full credential for that account, valid for 30 days
 * against any host that shares NEXTAUTH_SECRET. That is fine for a local
 * secret and a local origin; do not run this with a deployed environment's
 * secret, and do not paste the output anywhere it will be kept.
 */

import { encode } from "next-auth/jwt";

import { prisma } from "../src/lib/prisma";

const MAX_AGE_S = 30 * 24 * 60 * 60;

const email = process.argv[2]?.toLowerCase();
const admin = process.argv.includes("--admin");

if (!email?.includes("@")) {
  console.error("usage: dev-session-cookie.ts <email> [--admin]");
  process.exit(2);
}

async function main() {
  // The row Google's `signIn` callback would have upserted. Without it the jwt
  // callback resolves `uid` to undefined and clamps `role` to `user`, so the
  // session works but owns nothing.
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, fullName: email.split("@")[0] },
    update: {},
    select: { id: true, role: true },
  });

  if (admin && user.role !== "admin") {
    await prisma.user.update({ where: { email }, data: { role: "admin" } });
    user.role = "admin";
  }

  const jwt = await encode({
    token: { email, uid: user.id, role: user.role, roleCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: MAX_AGE_S,
  });

  console.log(`\n${email} — role ${user.role}, id ${user.id}\n`);
  console.log("Paste into the browser console on http://localhost:3000, then reload:\n");
  console.log(
    `document.cookie = 'next-auth.session-token=${jwt}; path=/; max-age=${MAX_AGE_S}'`,
  );
  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

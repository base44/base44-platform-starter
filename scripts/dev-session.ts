/**
 * Mint a local session cookie, so you can use the shell without a Google client.
 *
 * NextAuth here is JWT-strategy with no adapter (`src/lib/auth.ts`): the session
 * IS the signed cookie, and Google is only the thing that issues one. So a
 * cookie signed with NEXTAUTH_SECRET is indistinguishable from a real sign-in,
 * and no OAuth client is needed to reach the builder. `GOOGLE_CLIENT_ID` /
 * `GOOGLE_CLIENT_SECRET` still have to be *set* — `requiredEnv` reads them when
 * the module loads — but they can be any non-empty string.
 *
 * Refuses to run against anything but localhost. This mints a session as an
 * arbitrary user with no proof of identity, which is a development convenience
 * and would be an authentication bypass anywhere else.
 *
 * The token is copied to the clipboard rather than printed, so it does not land
 * in your scrollback or shell history.
 *
 *   npm run dev:session -- you@example.com
 */

import { execFileSync } from "node:child_process";

import { encode } from "next-auth/jwt";

import { prisma } from "../src/lib/prisma";

const email = (process.argv[2] || "").trim().toLowerCase();
const url = process.env.NEXTAUTH_URL ?? "";

async function main() {
  if (!email || !email.includes("@")) {
    console.error("Usage: npm run dev:session -- you@example.com");
    process.exitCode = 1;
    return;
  }
  // The guard is on the URL rather than NODE_ENV because `tsx` leaves NODE_ENV
  // unset, so a NODE_ENV check would pass by default — exactly backwards.
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.replace(/\/+$/, ""))) {
    console.error(
      `Refusing to mint a session for NEXTAUTH_URL=${url || "(unset)"}.\n` +
        "This bypasses authentication entirely; localhost only.",
    );
    process.exitCode = 1;
    return;
  }
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error("NEXTAUTH_SECRET is not set — the cookie could not be verified.");
    process.exitCode = 1;
    return;
  }

  // The same upsert the real `signIn` callback does, so the row the rest of the
  // app reads is identical to a Google sign-in's. `role` is deliberately not set:
  // it defaults to `user`, and an admin promoted by hand must stay promoted.
  await prisma.user.upsert({
    where: { email },
    create: { email, fullName: email.split("@")[0] },
    update: {},
  });

  // Mirrors the jwt callback's claims (see src/lib/auth.ts): `roleCheckedAt` is
  // what bounds how long a cached `role` is trusted, so stamping it now means
  // the first request re-reads from Postgres within the minute.
  const token = await encode({
    token: { email, role: "user", roleCheckedAt: Date.now() },
    secret,
  });

  const snippet = `document.cookie = "next-auth.session-token=${token}; path=/"`;
  try {
    execFileSync("pbcopy", { input: snippet });
    console.log(`✔ session minted for ${email} and copied to your clipboard.`);
  } catch {
    // No pbcopy (non-macOS): fall back to a file rather than printing the token.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(".dev-session-cookie.js", snippet + "\n", { mode: 0o600 });
    console.log(`✔ session minted for ${email} → .dev-session-cookie.js (gitignored as .dev-*)`);
  }
  console.log("\nPaste it into the browser console on http://localhost:3000, then reload.");
  console.log("Cookies set from JS are not httpOnly, but NextAuth reads them the same way.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

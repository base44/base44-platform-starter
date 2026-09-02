/**
 * Smoke test for auth (src/lib/auth.ts).
 *
 * The Google click-through cannot be scripted, but everything after it can: this
 * asserts the properties that decide whether the RLS layer gets a correct actor:
 *
 *   1. signIn upserts the User by lowercased email and NEVER touches `role`
 *   2. the jwt callback resolves `role` from Postgres, not from the OAuth profile
 *   3. the session callback surfaces email/role/id, and getSessionUser's shape
 *      is a usable RlsActor (scoped to its email, whatever its role)
 *   4. /api/me is 401 anonymous, and returns the signed-in actor with a cookie
 *      minted from NEXTAUTH_SECRET
 *
 * (4) needs `npm run dev` up; it is reported as SKIPPED, not passed, if not.
 * Writes throwaway rows to DATABASE_URL and cleans up. Scratch database only:
 *   npm run auth:smoke
 */

import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

import { authConfig } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import { scopedWhere, type RlsActor } from "../src/lib/rls";
import { SESSION_COOKIE_NAME, sessionCookie as mintCookie } from "./session-cookie";

const TAG = "auth-smoke";
const ADMIN_EMAIL = `${TAG}-admin@example.com`;
const USER_EMAIL = `${TAG}-user@example.com`;
const OTHER_EMAIL = `${TAG}-other@example.com`;

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const SECRET = process.env.NEXTAUTH_SECRET!;

let failures = 0;
let skipped = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function skip(name: string, why: string) {
  skipped++;
  console.log(`  ⊘ ${name} — SKIPPED: ${why}`);
}

/**
 * The callbacks, narrowed to just what this script calls. NextAuth's own param
 * types are wide unions over session strategies and adapters; a structural view
 * keeps the calls readable without reconstructing objects we never use.
 */
const callbacks = authConfig.callbacks as unknown as {
  signIn: (p: {
    user: { email?: string | null; name?: string | null; image?: string | null };
  }) => Promise<boolean>;
  jwt: (p: { token: JWT; user?: { email?: string | null }; trigger?: string }) => Promise<JWT>;
  session: (p: { session: Session; token: JWT }) => Session;
};

const googleProfile = (email: string, name: string) => ({
  email,
  name,
  image: `https://example.test/${encodeURIComponent(email)}.png`,
});

async function cleanup() {
  await prisma.item.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.board.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

/** A session cookie exactly as NextAuth would set it (JWT strategy, no adapter). */
const sessionCookie = (token: JWT) => mintCookie(token as Record<string, unknown>, SECRET);

async function main() {
  await cleanup();

  console.log("\n1. signIn upserts by email and never overwrites role");

  const created = await callbacks.signIn({
    user: googleProfile(USER_EMAIL, "Smoke User"),
  });
  check("signIn returns true", created === true);
  const userRow = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  check("the User row exists", !!userRow);
  check("role defaults to user", userRow?.role === "user");
  check("full_name comes from the Google profile", userRow?.fullName === "Smoke User");
  check("image_url is stored", !!userRow?.imageUrl);

  // Promote by hand, as an operator would, then sign in again.
  await prisma.user.update({ where: { email: USER_EMAIL }, data: { role: "admin" } });
  await callbacks.signIn({ user: googleProfile(USER_EMAIL, "Renamed User") });
  const afterResignin = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  check("a second sign-in preserves an admin role", afterResignin?.role === "admin");
  check("but still refreshes the profile name", afterResignin?.fullName === "Renamed User");

  // Google occasionally omits name/picture; a sign-in must not blank them out.
  await callbacks.signIn({ user: { email: USER_EMAIL } });
  const afterSparse = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  check(
    "a profile-less sign-in does not blank full_name",
    afterSparse?.fullName === "Renamed User",
  );
  check("...nor image_url", !!afterSparse?.imageUrl);

  const mixedCase = await callbacks.signIn({
    user: googleProfile(ADMIN_EMAIL.toUpperCase(), "Smoke Admin"),
  });
  check("signIn accepts a mixed-case address", mixedCase === true);
  const lowered = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  check("the email is stored lowercased", !!lowered, "AppOwnership/Base44Link match on lowercase");
  check(
    "no duplicate row was created",
    (await prisma.user.count({ where: { email: { startsWith: TAG } } })) === 2,
  );

  check(
    "signIn refuses a profile with no email",
    (await callbacks.signIn({ user: { email: null } })) === false,
  );

  // Reset the fixtures to their intended roles for the rest of the run.
  await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { role: "admin" } });
  await prisma.user.update({ where: { email: USER_EMAIL }, data: { role: "user" } });

  console.log("\n2. the jwt callback reads role from Postgres");

  const userToken = await callbacks.jwt({
    token: {},
    user: { email: USER_EMAIL.toUpperCase() },
  });
  check("email is lowercased onto the token", userToken.email === USER_EMAIL);
  check("role is user", userToken.role === "user");
  check(
    "the DB id is carried as uid",
    userToken.uid === (await prisma.user.findUnique({ where: { email: USER_EMAIL } }))!.id,
  );
  check("roleCheckedAt is stamped", typeof userToken.roleCheckedAt === "number");

  const adminToken = await callbacks.jwt({ token: {}, user: { email: ADMIN_EMAIL } });
  check("an admin resolves to role admin", adminToken.role === "admin");

  // A token whose OAuth profile claims admin must not be believed.
  const forged = await callbacks.jwt({
    token: { email: USER_EMAIL, role: "admin", roleCheckedAt: 0 },
  });
  check("a stale/forged admin claim is re-read and demoted", forged.role === "user");

  // Fresh tokens are trusted for ROLE_TTL_MS — no query per request.
  const fresh = await callbacks.jwt({
    token: { email: USER_EMAIL, role: "admin", uid: "cached", roleCheckedAt: Date.now() },
  });
  check("a fresh token is served from cache", fresh.role === "admin" && fresh.uid === "cached");

  const deleted = await callbacks.jwt({
    token: { email: OTHER_EMAIL, role: "admin", roleCheckedAt: 0 },
  });
  check("a token for a deleted user degrades to role user", deleted.role === "user");

  console.log("\n3. the session callback yields a usable RlsActor");

  const shaped = callbacks.session({
    session: { user: { email: "STALE@example.com", name: "n" }, expires: "" },
    token: adminToken,
  });
  check("session.user.email comes from the token", shaped.user?.email === ADMIN_EMAIL);
  check("session.user.role is surfaced", shaped.user?.role === "admin");
  check("session.user.id is surfaced", shaped.user?.id === adminToken.uid);

  const roleless = callbacks.session({
    session: { user: { email: USER_EMAIL }, expires: "" },
    token: { email: USER_EMAIL },
  });
  check("a role-less token falls back to user, not admin", roleless.user?.role === "user");

  // The actor shape must satisfy scopedWhere() — the whole point of the module.
  const userActor: RlsActor = { email: USER_EMAIL, role: "user" };
  const adminActor: RlsActor = { email: ADMIN_EMAIL, role: "admin" };
  check(
    "scopedWhere(user actor) scopes to the email",
    scopedWhere(userActor).createdBy === USER_EMAIL,
  );
  check(
    "scopedWhere(admin actor) is scoped just the same",
    scopedWhere(adminActor).createdBy === ADMIN_EMAIL,
  );

  await prisma.board.create({ data: { title: `${TAG} user board`, createdBy: USER_EMAIL } });
  await prisma.board.create({ data: { title: `${TAG} other board`, createdBy: OTHER_EMAIL } });
  const userBoards = await prisma.board.count({
    where: { ...scopedWhere(userActor), title: { startsWith: TAG } },
  });
  const adminBoards = await prisma.board.count({
    where: { ...scopedWhere(adminActor), title: { startsWith: TAG } },
  });
  check("the signed-in user sees only their own board", userBoards === 1, `saw ${userBoards}`);
  check("the admin actor sees neither, owning neither", adminBoards === 0, `saw ${adminBoards}`);

  console.log("\n4. /api/me over HTTP");

  let serverUp = false;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/providers`, {
      signal: AbortSignal.timeout(2000),
    });
    serverUp = res.ok;
    if (serverUp) {
      const providers = (await res.json()) as Record<string, { callbackUrl?: string }>;
      check("google is the only provider", Object.keys(providers).join() === "google");
      check(
        "the callback URL matches NEXTAUTH_URL",
        providers.google?.callbackUrl === `${BASE_URL}/api/auth/callback/google`,
        providers.google?.callbackUrl,
      );
    }
  } catch {
    serverUp = false;
  }

  if (!serverUp) {
    skip("/api/me checks", `no dev server at ${BASE_URL} — run \`npm run dev\``);
  } else {
    const anon = await fetch(`${BASE_URL}/api/me`);
    check("anonymous /api/me is 401", anon.status === 401, `got ${anon.status}`);
    const anonBody = (await anon.json()) as { error?: string };
    check("...with an unauthenticated error", anonBody.error === "unauthenticated");

    const cookie = await sessionCookie({ email: ADMIN_EMAIL, role: "admin", uid: adminToken.uid });
    const me = await fetch(`${BASE_URL}/api/me`, { headers: { cookie } });
    check("a session cookie authenticates /api/me", me.status === 200, `got ${me.status}`);
    const body = (await me.json()) as Record<string, unknown>;
    check("the actor email round-trips", body.email === ADMIN_EMAIL);
    check("the role round-trips", body.role === "admin");
    check("the payload is snake_case (wire contract)", "full_name" in body && "image_url" in body);
    check(
      "no token or secret leaks into the payload",
      !JSON.stringify(body).includes("access_token"),
    );

    const badCookie = `${SESSION_COOKIE_NAME}=not.a.valid.jwt`;
    const rejected = await fetch(`${BASE_URL}/api/me`, { headers: { cookie: badCookie } });
    check("an unsignable cookie is rejected", rejected.status === 401, `got ${rejected.status}`);
  }

  await cleanup();

  const summary = [
    failures === 0 ? "all auth checks passed." : `${failures} CHECK(S) FAILED.`,
    skipped ? `${skipped} skipped.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(`\n${summary}`);
  if (failures) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error("\nauth smoke test errored:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());

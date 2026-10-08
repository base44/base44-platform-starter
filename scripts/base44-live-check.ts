/**
 * Manual live checklist for the Base44 bridge (docs/base44-identity.md).
 *
 * This is NOT part of `npm test` and never will be: it **calls a live Base44
 * workspace** with the integration account's real access token. It exists
 * because `scripts/base44-smoke.ts` deliberately never reaches upstream.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/base44-live-check.ts <email> [--app <app id>]
 *
 * `<email>` is the shell user to act as; a cookie is forged for them the same way
 * the smoke suite does. `listApps` answers with the apps *that user* built, so a
 * throwaway address sees an empty list and that is a pass. To exercise an
 * app-scoped call, name an app in the workspace with `--app`: the script records a
 * temporary `AppOwnership` row for the email, reads the app, and removes the row
 * again. Nothing here creates, changes or deploys an app.
 *
 * Needs `npm run dev` on :3000 and NEXTAUTH_SECRET in .env.
 */

import { prisma } from "../src/lib/prisma";
import { sessionCookie } from "./session-cookie";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

const email = process.argv[2]?.toLowerCase();
const appFlag = process.argv.indexOf("--app");
const APP_ID = appFlag > -1 ? process.argv[appFlag + 1] : null;

if (!email || !email.includes("@")) {
  console.error("usage: base44-live-check.ts <email> [--app <app id>]");
  process.exit(2);
}

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✔ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Redact anything token-shaped before it can reach a log or a terminal scroll. */
function safe(value: unknown): string {
  return JSON.stringify(value)
    .replace(/(ey[A-Za-z0-9_-]{6})[A-Za-z0-9_.-]+/g, "$1…<jwt>")
    .replace(/(b44k_[0-9a-f]{4})[0-9a-f]+/g, "$1…<key>")
    .slice(0, 600);
}

async function main() {
  const cookie = await sessionCookie({ email, role: "user", roleCheckedAt: Date.now() });

  async function post(body: unknown) {
    const res = await fetch(`${BASE_URL}/api/base44/platform`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      /* leave null */
    }
    return { status: res.status, body: parsed as Record<string, unknown> | unknown[] | null };
  }

  console.log(`\nLive Base44 bridge check as ${email}`);
  console.log(`(calls a live workspace with the integration account's token)\n`);

  console.log("1. status — is the bridge configured here?");
  const status = await post({ action: "status" });
  console.log(`   → ${status.status} ${safe(status.body)}`);
  check("status is 200", status.status === 200, `got ${status.status}`);
  check(
    "no token in the body",
    !/ey[A-Za-z0-9_-]{10}/.test(JSON.stringify(status.body)) && !/b44k_/.test(JSON.stringify(status.body)),
  );

  console.log("\n2. the money test — does the access token work on REST?");
  const apps = await post({ action: "listApps", limit: 5 });
  console.log(`   → ${apps.status} ${safe(apps.body)}`);
  check("listApps is 200", apps.status === 200, `got ${apps.status} ${safe(apps.body)}`);
  check("...not 501, which would mean Base44 refused the token", apps.status !== 501);
  const arr = Array.isArray(apps.body) ? apps.body : [];
  check("...and answers with an array", Array.isArray(apps.body));
  console.log(`   apps this user built: ${arr.length}`);

  if (!APP_ID) {
    console.log("\n3. getApp — SKIPPED, pass --app <id> to read one app");
  } else {
    console.log(`\n3. getApp on ${APP_ID}, as its temporary owner`);
    const before = await post({ action: "getApp", appId: APP_ID });
    check("without an AppOwnership row the proxy answers 404", before.status === 404, `got ${before.status}`);

    await prisma.appOwnership.upsert({
      where: { appId_createdBy: { appId: APP_ID, createdBy: email } },
      create: { appId: APP_ID, appName: "live-check", createdBy: email },
      update: {},
    });
    try {
      const one = await post({ action: "getApp", appId: APP_ID });
      console.log(`   → ${one.status} ${safe(one.body)}`);
      check("with the row, getApp is 200", one.status === 200, `got ${one.status}`);
      const listedNow = await post({ action: "listApps", limit: 50 });
      const ids = (Array.isArray(listedNow.body) ? listedNow.body : []).map(
        (a) => (a as { id?: string }).id,
      );
      check("...and listApps now includes it", ids.includes(APP_ID), `saw ${ids.length} apps`);
    } finally {
      await prisma.appOwnership.deleteMany({ where: { appId: APP_ID, createdBy: email, appName: "live-check" } });
    }
  }

  console.log(`\n${failures === 0 ? "all live checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((err) => {
    console.error("live check threw:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

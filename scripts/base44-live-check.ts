/**
 * Manual live checklist for the Base44 bridge (docs/base44-identity.md).
 *
 * This is NOT part of `npm test` and never will be: it **writes to a live Base44
 * tenant**, provisioning a real service principal and minting real tokens. It
 * exists because `scripts/base44-smoke.ts` deliberately skips `connect` when a
 * key is present.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/base44-live-check.ts <email> [--deprovision]
 *
 * Run it against a throwaway email FIRST. A throwaway principal owns no apps, so
 * `--deprovision` can clean it up safely — whereas deprovisioning a real user's
 * principal transfers their built apps to the workspace owner.
 *
 * Needs `npm run dev` on :3000 and NEXTAUTH_SECRET in .env (it forges a session
 * cookie the same way the smoke suite does).
 */

import { encode } from "next-auth/jwt";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

const email = process.argv[2]?.toLowerCase();
const DEPROVISION = process.argv.includes("--deprovision");

if (!email || !email.includes("@")) {
  console.error("usage: base44-live-check.ts <email> [--deprovision]");
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
  const jwt = await encode({
    token: { email, role: "user", roleCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
  });
  const cookie = `next-auth.session-token=${jwt}`;

  async function post(path: string, body: unknown) {
    const res = await fetch(`${BASE_URL}${path}`, {
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
    return { status: res.status, body: (parsed ?? {}) as Record<string, unknown> };
  }

  console.log(`\nLive Base44 bridge check as ${email}`);
  console.log(`(writes to a live tenant — see docs/base44-identity.md)\n`);

  console.log("1. status before connect");
  const before = await post("/api/base44/link", { action: "status" });
  console.log(`   → ${before.status} ${safe(before.body)}`);
  check("status is 200", before.status === 200);
  check("no token in the body", !/ey[A-Za-z0-9_-]{10}/.test(JSON.stringify(before.body)));

  console.log("\n2. connect — provision a principal, then mint");
  const connected = await post("/api/base44/link", { action: "connect" });
  console.log(`   → ${connected.status} ${safe(connected.body)}`);
  check("connect is 200", connected.status === 200, `got ${connected.status}`);
  check("linked:true", connected.body.linked === true);
  check("no token in the body", !/ey[A-Za-z0-9_-]{10}/.test(JSON.stringify(connected.body)));
  check("no b44k_ key in the body", !/b44k_/.test(JSON.stringify(connected.body)));

  console.log("\n3. status after connect");
  const after = await post("/api/base44/link", { action: "status" });
  console.log(`   → ${after.status} ${safe(after.body)}`);
  check("linked:true", after.body.linked === true);

  console.log("\n4. the money test — does the minted token work on REST?");
  const apps = await post("/api/base44/platform", { action: "listApps", params: { limit: 5 } });
  console.log(`   → ${apps.status} ${safe(apps.body)}`);
  check("listApps is 200", apps.status === 200, `got ${apps.status} ${safe(apps.body)}`);
  check(
    'not the 403 "scoped to MCP" branch',
    apps.status !== 403,
    "the minted token's client_id looks like an MCP prefix",
  );

  const list = (apps.body.data ?? apps.body.items ?? apps.body) as unknown;
  const arr = Array.isArray(list) ? list : [];
  console.log(`   apps returned: ${arr.length}`);

  if (arr.length > 0) {
    const first = arr[0] as Record<string, unknown>;
    const appId = String(first.id ?? first._id ?? "");
    console.log(`\n5. getApp on ${appId}`);
    const one = await post("/api/base44/platform", { action: "getApp", params: { appId } });
    console.log(`   → ${one.status} ${safe(one.body)}`);
    check("getApp is 200", one.status === 200, `got ${one.status}`);
  } else {
    console.log("\n5. getApp — SKIPPED, listApps returned nothing");
  }

  if (DEPROVISION) {
    console.log("\n6. disconnect (does NOT deprovision — by design)");
    const off = await post("/api/base44/link", { action: "disconnect" });
    console.log(`   → ${off.status} ${safe(off.body)}`);
    check("disconnect is 200", off.status === 200);
    console.log(
      "\n   NOTE: the service principal still exists upstream. deprovisionPrincipal()\n" +
        "   is not wired to a route on purpose — call it from a REPL if you truly want\n" +
        "   it gone, and only for a principal that owns no apps.",
    );
  }

  console.log(`\n${failures === 0 ? "all live checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("live check threw:", err);
  process.exit(1);
});

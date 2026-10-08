/**
 * Smoke test for the Base44 bridge (`/api/base44/platform`).
 *
 * This route is the only code holding the integration account's access token —
 * one credential that owns every app the shell has ever built. So this asserts
 * the boundary rather than the happy path, which needs a real token and builds
 * real apps in a real workspace (see scripts/base44-live-check.ts).
 *
 * What it pins down:
 *   1. the route is not reachable without a session
 *   2. the platform route is a strict allow-list: unknown actions, dirty app ids
 *      and missing required params are all 400, before any upstream call
 *   3. **keeping builders apart is the shell's job**, and it does it: an app-scoped
 *      action on an app the caller did not build is 404 before anything reaches
 *      upstream, for every such action
 *   4. `AppOwnership` — the only record of who built what — cannot be created or
 *      edited through the generic entity API, so nobody can claim an app by
 *      inserting a row. Reading and deleting your own rows still works.
 *   5. with no `BASE44_ACCESS_TOKEN`, the route answers 501 `bridge_misconfigured`
 *      rather than 500 — and says nothing about the environment
 *   6. a submit's request id is stable per tool call, so a retried POST dedupes
 *      instead of resuming and charging the turn twice
 *   7. `listApps` finds a user's apps however deep in the shared workspace they
 *      sit, and is not fooled by an upstream that caps or refuses a large page
 *
 * Needs `npm run dev`. Writes throwaway rows to DATABASE_URL and cleans up:
 *   npm run base44:smoke
 */

import {
  LIST_PAGE_SIZE,
  MAX_LIST_PAGES,
  SAFE_LIST_PAGE_SIZE,
  pageOwnedApps,
} from "../src/lib/appOwnership";
import { submitRequestId } from "../src/lib/base44Platform";
import { prisma } from "../src/lib/prisma";
import { SESSION_COOKIE_NAME, sessionCookie } from "./session-cookie";

const TAG = "b44-smoke";
const USER = `${TAG}-user@example.com`;
const OTHER = `${TAG}-other@example.com`;
/** Built by USER. Clean-shaped, so the only thing standing between OTHER and it is ownership. */
const APP = `${TAG}-app-1`;
/** Never built by anyone. */
const NOBODYS_APP = `${TAG}-app-nobody`;

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const CONFIGURED = Boolean(process.env.BASE44_ACCESS_TOKEN);

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Res = { status: number; body: Record<string, unknown> };

const cookies: Record<string, string> = {};

async function mintCookie(email: string) {
  cookies[email] = await sessionCookie({ email, role: "user", roleCheckedAt: Date.now() });
}

async function api(method: string, path: string, body: unknown, as?: string): Promise<Res> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(as ? { cookie: cookies[as] } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

const platform = (body: unknown, as?: string) => api("POST", "/api/base44/platform", body, as);

async function cleanup() {
  await prisma.appOwnership.deleteMany({ where: { appId: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function main() {
  try {
    const ping = await fetch(`${BASE_URL}/api/auth/providers`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!ping.ok) throw new Error(String(ping.status));
  } catch {
    console.error(`\nNo dev server at ${BASE_URL}. Start it with \`npm run dev\` and re-run.`);
    process.exitCode = 1;
    return;
  }

  await cleanup();
  await prisma.user.createMany({ data: [{ email: USER }, { email: OTHER }] });
  await prisma.appOwnership.create({ data: { appId: APP, appName: "USER's app", createdBy: USER } });
  await Promise.all([mintCookie(USER), mintCookie(OTHER)]);

  console.log("\n1. the boundary: a session is required");

  check("anonymous platform call is 401", (await platform({ action: "listApps" })).status === 401);
  check("anonymous status is 401", (await platform({ action: "status" })).status === 401);
  check(
    "an unsignable cookie is 401",
    (
      await fetch(`${BASE_URL}/api/base44/platform`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE_NAME}=nope` },
        body: JSON.stringify({ action: "listApps" }),
      })
    ).status === 401,
  );

  console.log("\n2. the platform route is a strict allow-list");

  const bad = async (body: unknown) => (await platform(body, USER)).status;
  check("an unknown action is 400", (await bad({ action: "deleteEverything" })) === 400);
  check("a missing action is 400", (await bad({})) === 400);

  // renameApp is the one action that writes to an app record, so its input is
  // checked before anything reaches upstream — these run without a live platform.
  check("renameApp needs an appId", (await bad({ action: "renameApp", name: "x" })) === 400);
  check("renameApp needs a name", (await bad({ action: "renameApp", appId: APP })) === 400);
  check(
    "...a blank one does not count",
    (await bad({ action: "renameApp", appId: APP, name: "   " })) === 400,
  );
  check(
    "...and it is length-capped",
    (await bad({ action: "renameApp", appId: APP, name: "x".repeat(61) })) === 400,
  );
  check(
    "renameApp rejects a path-shaped appId",
    (await bad({ action: "renameApp", appId: "../../apps", name: "x" })) === 400,
  );
  check(
    "a path-traversing appId is 400",
    (await bad({ action: "getApp", appId: "../../admin" })) === 400,
  );
  check("an appId with a slash is 400", (await bad({ action: "getApp", appId: "a/b" })) === 400);
  check(
    "an appId with a query char is 400",
    (await bad({ action: "getApp", appId: "a?b=1" })) === 400,
  );
  check("a missing appId is 400", (await bad({ action: "getApp" })) === 400);
  check("createApp without a prompt is 400", (await bad({ action: "createApp" })) === 400);
  check(
    "sendMessage without content is 400",
    (await bad({ action: "sendMessage", appId: APP })) === 400,
  );
  check(
    "submitToolCallInput with a dirty toolCallId is 400",
    (await bad({ action: "submitToolCallInput", appId: APP, toolCallId: "x/y" })) === 400,
  );
  check(
    "there is no action that files apps into a folder",
    (await bad({ action: "fileAppsInFolder", appIds: [APP] })) === 400,
  );

  // The only limit on which credential `createApp` can install is APP_SECRETS.
  const withSecrets = (secrets: unknown) => ({ action: "createApp", prompt: "hi", secrets });
  check(
    "createApp with an unregistered secret name is 400",
    (await bad(withSecrets(["OPENAI_API_KEY"]))) === 400,
  );
  check(
    "...including the access token, which must never reach an app",
    (await bad(withSecrets(["BASE44_ACCESS_TOKEN"]))) === 400,
  );
  check(
    "...and the workspace key",
    (await bad(withSecrets(["BASE44_SVC_KEY"]))) === 400,
  );
  check(
    "...and inherited keys are not registry hits",
    (await bad(withSecrets(["constructor"]))) === 400,
  );
  check(
    "createApp cannot be handed a secret value to install",
    (await bad(withSecrets([{ SUNNY_API_TOKEN: "attacker-controlled" }]))) === 400,
  );
  check("...nor a bare object of them", (await bad(withSecrets({ X: "y" }))) === 400);
  const rejectedSecret = await platform(withSecrets(["BASE44_ACCESS_TOKEN"]), USER);
  check(
    "...and the rejection names no value, only names",
    !JSON.stringify(rejectedSecret.body).includes(process.env.BASE44_ACCESS_TOKEN ?? "\0") &&
      !JSON.stringify(rejectedSecret.body).includes("b44k_"),
    JSON.stringify(rejectedSecret.body).slice(0, 140),
  );
  const listed = await platform({ action: "deleteEverything" }, USER);
  check(
    "the rejection lists the allowed actions",
    String(listed.body.detail ?? "").includes("listApps") &&
      String(listed.body.detail ?? "").includes("createApp"),
  );
  check(
    "...and does not leak the platform host",
    !JSON.stringify(listed.body).includes("http"),
    JSON.stringify(listed.body).slice(0, 140),
  );

  console.log("\n3. keeping builders apart is the shell's job — and it does it");

  // Every app upstream belongs to the one integration account, so if the shell
  // did not check, OTHER could drive USER's app with a clean-shaped id. These are
  // all 404 *before* upstream: they pass whether or not a token is configured,
  // and a configured deployment spends no platform call on them.
  const foreign: Record<string, unknown>[] = [
    { action: "getApp", appId: APP },
    { action: "renameApp", appId: APP, name: "mine now" },
    { action: "getConversation", appId: APP },
    { action: "sendMessage", appId: APP, content: "add a delete-all button" },
    { action: "getPreviewUrl", appId: APP },
    { action: "deployApp", appId: APP },
    { action: "submitToolCallInput", appId: APP, toolCallId: "toolu_x", approve: true },
  ];
  for (const body of foreign) {
    const res = await platform(body, OTHER);
    check(
      `${body.action} on another builder's app is 404`,
      res.status === 404 && res.body.code === "not_found",
      `got ${res.status} ${JSON.stringify(res.body).slice(0, 100)}`,
    );
  }
  const nobodys = await platform({ action: "getApp", appId: NOBODYS_APP }, USER);
  check(
    "...and an app nobody built is the same 404, so existence is not revealed",
    nobodys.status === 404 && nobodys.body.code === "not_found",
    `got ${nobodys.status}`,
  );
  const refused = await platform({ action: "getApp", appId: APP }, OTHER);
  check(
    "the refusal names no other user",
    !JSON.stringify(refused.body).includes(USER),
    JSON.stringify(refused.body).slice(0, 140),
  );

  console.log("\n4. ownership cannot be claimed through the entity API");

  const claim = await api(
    "POST",
    "/api/entities/AppOwnership",
    { app_id: APP, app_name: "mine now" },
    OTHER,
  );
  check("creating an AppOwnership row is 400", claim.status === 400, `got ${claim.status}`);
  check(
    "...and no row appeared",
    (await prisma.appOwnership.count({ where: { appId: APP, createdBy: OTHER } })) === 0,
  );
  const ownRows = await api("GET", `/api/entities/AppOwnership`, undefined, USER);
  const ownIds = (Array.isArray(ownRows.body) ? ownRows.body : []) as { id?: string; app_id?: string }[];
  const mine = ownIds.find((r) => r.app_id === APP);
  check("the owner can still read their own rows", ownRows.status === 200 && Boolean(mine));
  check(
    "...but not edit one",
    mine ? (await api("PUT", `/api/entities/AppOwnership/${mine.id}`, { app_name: "x" }, USER)).status === 400 : false,
  );
  check(
    "...and after a delete, the proxy no longer answers for the app",
    mine
      ? (await api("DELETE", `/api/entities/AppOwnership/${mine.id}`, undefined, USER)).status === 200 &&
          (await platform({ action: "getApp", appId: APP }, USER)).status === 404
      : false,
  );
  // Put it back for the sections below.
  await prisma.appOwnership.create({ data: { appId: APP, appName: "USER's app", createdBy: USER } });

  console.log("\n5. an unconfigured deployment degrades, it does not crash");

  if (CONFIGURED) {
    // A real token is present: `status` must say so, and the misconfiguration
    // branch cannot be exercised without unsetting it. Nothing here builds an
    // app — that costs real money in a real workspace.
    const status = await platform({ action: "status" }, USER);
    check("status is 200 configured:true", status.status === 200 && status.body.configured === true);
    check(
      "...and says nothing about the environment",
      !JSON.stringify(status.body).includes("BASE44_") && !JSON.stringify(status.body).includes("http"),
    );
    console.log("  ⊘ BASE44_ACCESS_TOKEN is set — skipping the misconfiguration checks");
  } else {
    // A missing variable can surface inside a path builder (createApp reads
    // BASE44_ORG_ID) or inside send(), reading the token. Wherever it fires, the
    // answer must be 501 — not a 400 that blames the caller.
    const noConfig = await platform({ action: "listApps" }, USER);
    check(
      "a missing token on a platform call is 501, not 400 or 500",
      noConfig.status === 501,
      `got ${noConfig.status}: ${JSON.stringify(noConfig.body).slice(0, 140)}`,
    );
    check("...with code bridge_misconfigured", noConfig.body.code === "bridge_misconfigured");
    check(
      "...and the body never names an env var",
      !JSON.stringify(noConfig.body).includes("BASE44_"),
      JSON.stringify(noConfig.body).slice(0, 140),
    );
    const status = await platform({ action: "status" }, USER);
    check("status is 501 too", status.status === 501, `got ${status.status}`);
    check("...with code bridge_misconfigured", status.body.code === "bridge_misconfigured");
    check(
      "...and says nothing about which var is missing",
      !JSON.stringify(status.body).includes("BASE44_"),
      JSON.stringify(status.body).slice(0, 140),
    );
    // The ownership gate runs before config is read: a foreign app is a 404 even
    // on a deployment with no token, so the two kinds of failure never blur.
    check(
      "a foreign app is still 404, not 501",
      (await platform({ action: "getApp", appId: APP }, OTHER)).status === 404,
    );
  }

  console.log("\n6. malformed input");

  const notJson = await fetch(`${BASE_URL}/api/base44/platform`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[USER] },
    body: "not json",
  });
  check("a non-JSON body is 400", notJson.status === 400, `got ${notJson.status}`);

  {
    console.log("\n7. the submit request id");
    const a = submitRequestId("toolu_abc");
    check("it is stable for a tool call", a === submitRequestId("toolu_abc"), a);
    check("...distinct tool calls get distinct ids", a !== submitRequestId("toolu_xyz"));
    check("...and carries the tool call id", a.includes("toolu_abc"), a);
    check(
      "...and does not change on a resubmit, so a retry dedupes",
      a === submitRequestId("toolu_abc"),
    );
  }

  {
    console.log("\n8. listApps finds a user's apps in the shared workspace");
    // A fake workspace, newest first: 1,200 apps by other builders, with this
    // user's three spread through it — one near the top, two far below.
    const workspace = Array.from({ length: 1200 }, (_, i) => ({ id: `app-${i}` }));
    const owned = new Set(["app-3", "app-700", "app-1150"]);
    let calls = 0;
    const listing = (cap = Infinity) => async (skip: number, size: number) => {
      calls++;
      return workspace.slice(skip, skip + Math.min(size, cap));
    };
    const ids = (rows: unknown[]) => rows.map((r) => (r as { id: string }).id);

    calls = 0;
    const all = await pageOwnedApps(owned, listing(), { limit: 50, skip: 0 });
    check(
      "apps far down the listing are found",
      ids(all).join() === "app-3,app-700,app-1150",
      ids(all).join(),
    );
    check(
      "...in pages of the large size",
      calls === Math.ceil(1150 / LIST_PAGE_SIZE),
      `${calls} calls`,
    );

    calls = 0;
    const small = await pageOwnedApps(new Set(["app-3", "app-90"]), async (skip, size) => {
      calls++;
      return workspace.slice(0, 300).slice(skip, skip + size);
    }, { limit: 50, skip: 0 });
    check(
      "a workspace that fits one page costs one request",
      ids(small).join() === "app-3,app-90" && calls === 1,
      `${calls} calls`,
    );

    calls = 0;
    const capped = await pageOwnedApps(owned, listing(100), { limit: 50, skip: 0 });
    check(
      "an upstream that silently caps the page size still yields every app",
      ids(capped).join() === "app-3,app-700,app-1150",
      `${calls} calls, ${ids(capped).join()}`,
    );

    calls = 0;
    const first = await pageOwnedApps(owned, listing(), { limit: 1, skip: 0 });
    check("a full page stops the walk early", ids(first).join() === "app-3" && calls === 1, `${calls} calls`);

    const second = await pageOwnedApps(owned, listing(), { limit: 1, skip: 1 });
    check("skip counts the user's apps, not the workspace's", ids(second).join() === "app-700", ids(second).join());

    calls = 0;
    const trashed = await pageOwnedApps(new Set(["app-3", "gone"]), listing(), { limit: 50, skip: 0 });
    check(
      "an owned app missing from the listing is left out, and the walk ends with it",
      // Every page, plus the one empty request that proves the end.
      ids(trashed).join() === "app-3" && calls === Math.ceil(workspace.length / LIST_PAGE_SIZE) + 1,
      `${calls} calls, ${ids(trashed).join()}`,
    );

    const safe = await pageOwnedApps(owned, listing(), { limit: 50, skip: 0, pageSize: SAFE_LIST_PAGE_SIZE });
    check(
      "the known-good page size finds the same apps",
      ids(safe).join() === "app-3,app-700,app-1150",
      ids(safe).join(),
    );

    // An app that moves up between two requests shows up on two pages.
    const shifting = async (skip: number, size: number) =>
      skip === 0 ? [{ id: "app-1" }, ...workspace.slice(1, size)] : skip < 1000 ? [{ id: "app-1" }] : [];
    const deduped = await pageOwnedApps(new Set(["app-1", "never"]), shifting, { limit: 50, skip: 0 });
    check("an app seen twice is listed once", ids(deduped).join() === "app-1", ids(deduped).join());

    calls = 0;
    const endless = async () => {
      calls++;
      return workspace.slice(0, SAFE_LIST_PAGE_SIZE);
    };
    await pageOwnedApps(new Set(["never"]), endless, { limit: 50, skip: 0 });
    check("the walk is capped", calls === MAX_LIST_PAGES, `${calls} calls`);
  }
  await cleanup();

  console.log(
    failures === 0 ? "\nall Base44 bridge checks passed." : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error("\nbase44 smoke test errored:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());

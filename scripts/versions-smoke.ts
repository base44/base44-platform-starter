/**
 * Smoke test for version history: the four checkpoint actions on
 * `/api/base44/platform`, and the pure helpers the panel labels rows with.
 *
 * Like base44-smoke.ts this asserts the boundary, not the happy path — a real
 * restore rolls a real app back in a real workspace. What it pins down:
 *   1. the new actions are allow-listed by name, and nothing else is
 *   2. a checkpoint id travels only in the clean shape a path id does, whether
 *      it lands in the path (restore, retry) or in the body (publish a version)
 *   3. an unlinked user is a clean 428 on every new action
 *   4. `versionState` labels a row from commit hashes, never from timestamps
 *   5. `versionActionError` turns the upstream 409s into the right sentence
 *
 * Needs `npm run dev`. Writes throwaway rows to DATABASE_URL and cleans up:
 *   npm run versions:smoke
 */

import {
  previewState,
  restoreBlocked,
  versionActionError,
  versionState,
  versionTitle,
} from "../src/lib/appVersions";
import { prisma } from "../src/lib/prisma";
import { sessionCookie } from "./session-cookie";

const TAG = "versions-smoke";
const USER = `${TAG}-user@example.com`;
const OTHER = `${TAG}-other@example.com`;
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const cookies: Record<string, string> = {};

async function platform(body: unknown, as?: string) {
  const res = await fetch(`${BASE_URL}/api/base44/platform`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(as ? { cookie: cookies[as] } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function cleanup() {
  await prisma.base44Link.deleteMany({ where: { appUserEmail: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

function pureChecks() {
  console.log("\n4. a version is labelled by commit hash, not by date");

  const app = {
    last_git_commit_hash: "cur",
    last_deployed_git_commit_hash: "live",
    status: { state: "ready" },
  };
  const row = (hash: string | null, extra = {}) => ({ id: "c1", git_commit_hash: hash, ...extra });

  check("the editor's build is current", versionState(app, row("cur")).current);
  check("...and not live", !versionState(app, row("cur")).live);
  check("production's build is live", versionState(app, row("live")).live);
  check("...and not current", !versionState(app, row("live")).current);
  check("an older build is neither", (() => {
    const s = versionState(app, row("old", { last_deployed_at: "2026-01-01T00:00:00Z" }));
    return !s.current && !s.live;
  })(), "last_deployed_at must not make a row read as live");
  check("a version with no commit is neither", (() => {
    const s = versionState({ ...app, last_git_commit_hash: null }, row(null));
    return !s.current && !s.live;
  })(), "null must not match null");
  check("one build can be both current and live", (() => {
    const s = versionState({ ...app, last_deployed_git_commit_hash: "cur" }, row("cur"));
    return s.current && s.live;
  })());

  check("a ready preview with a url is ready", previewState({ preview_status: "ready", preview_url: "https://x" }) === "ready");
  check("...a ready preview without a url is none", previewState({ preview_status: "ready", preview_url: null }) === "none");
  check("pending reads as building", previewState({ preview_status: "pending" }) === "building");
  check("building reads as building", previewState({ preview_status: "building" }) === "building");
  check("failed reads as failed", previewState({ preview_status: "failed" }) === "failed");
  check("no status reads as none", previewState({ preview_status: null }) === "none");

  check("a named version keeps its name", versionTitle({ name: "Add filters" }) === "Add filters");
  check("'untitled' falls back to the change summary", versionTitle({ name: "untitled", changes: "Fixed the header" }) === "Fixed the header");
  check("...and to a placeholder", versionTitle({ name: "", changes: null }) === "Untitled version");

  check("restore is blocked while a turn runs", restoreBlocked({ status: { state: "processing" } }));
  check("...and allowed when the app is ready", !restoreBlocked({ status: { state: "ready" } }));
  check("...and when there is no app", !restoreBlocked(null));

  console.log("\n5. upstream refusals become one sentence each");

  check(
    "409 'working' means wait for the turn",
    /still building/.test(versionActionError("restore", 409, "This app is working. Wait for it to finish, then restore.")),
  );
  check(
    "409 'generating' on publish means wait too",
    /still building/.test(versionActionError("publish", 409, "App is still generating code.")),
  );
  check(
    "409 branch mismatch on restore names the branch",
    /different branch/.test(versionActionError("restore", 409, "Checkpoint belongs to a different branch")),
  );
  check(
    "409 branch checkpoint on publish says to merge",
    /Merge the branch/.test(versionActionError("publish", 409, "Cannot publish a branch checkpoint.")),
  );
  check("404 says the version is gone", /no longer exists/.test(versionActionError("restore", 404, "")));
  check(
    "400 compile failure on publish is explained",
    /no longer compile/.test(versionActionError("publish", 400, "checkpoint_source_no_longer_compiles")),
  );
  check("anything else is a plain retry", /Try again/.test(versionActionError("restore", 500, "")));
  check("...and names the action", /published/.test(versionActionError("publish", 502, "")));
}

async function main() {
  try {
    const ping = await fetch(`${BASE_URL}/api/auth/providers`, { signal: AbortSignal.timeout(2000) });
    if (!ping.ok) throw new Error(String(ping.status));
  } catch {
    console.error(`\nNo dev server at ${BASE_URL}. Start it with \`npm run dev\` and re-run.`);
    process.exitCode = 1;
    return;
  }

  await cleanup();
  await prisma.user.createMany({ data: [{ email: USER }, { email: OTHER }] });
  cookies[USER] = await sessionCookie({ email: USER, role: "user", roleCheckedAt: Date.now() });
  cookies[OTHER] = await sessionCookie({ email: OTHER, role: "user", roleCheckedAt: Date.now() });
  await prisma.base44Link.create({
    data: {
      appUserEmail: USER,
      status: "linked",
      accessToken: `${TAG}-token`,
      organizationId: "org-under-test",
      base44UserEmail: `sunny-abc@org-under-test.svc.base44.invalid`,
      serviceExternalId: `${TAG}-principal`,
      principalProvisioned: true,
      createdBy: USER,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  console.log("\n1. the four actions are on the allow-list by name");

  const rejected = await platform({ action: "nope" }, USER);
  const allowed = String(rejected.body.detail ?? "");
  for (const action of ["listCheckpoints", "restoreCheckpoint", "retryCheckpointBuild", "deployApp"]) {
    check(`${action} is listed`, allowed.includes(action), allowed.slice(0, 200));
  }
  check("no passthrough crept in", !/passthrough|proxy|raw/i.test(allowed), allowed.slice(0, 200));

  console.log("\n2. ids are held to the path shape, wherever they land");

  const bad = async (body: unknown) => (await platform(body, USER)).status;
  check("listCheckpoints needs an appId", (await bad({ action: "listCheckpoints" })) === 400);
  check("...a path-shaped one is 400", (await bad({ action: "listCheckpoints", appId: "../admin" })) === 400);
  check("restoreCheckpoint needs a checkpointId", (await bad({ action: "restoreCheckpoint", appId: "abc" })) === 400);
  check(
    "...a slash in it is 400",
    (await bad({ action: "restoreCheckpoint", appId: "abc", checkpointId: "x/load" })) === 400,
  );
  check(
    "...a query char in it is 400",
    (await bad({ action: "restoreCheckpoint", appId: "abc", checkpointId: "x?y=1" })) === 400,
  );
  check(
    "retryCheckpointBuild needs a checkpointId",
    (await bad({ action: "retryCheckpointBuild", appId: "abc" })) === 400,
  );
  check(
    "...a dotted one is 400",
    (await bad({ action: "retryCheckpointBuild", appId: "abc", checkpointId: "../x" })) === 400,
  );
  check(
    "deployApp with a dirty checkpointId is 400",
    (await bad({ action: "deployApp", appId: "abc", checkpointId: "a b" })) === 400,
  );
  check(
    "...an empty string does not pass as 'omitted'",
    (await bad({ action: "deployApp", appId: "abc", checkpointId: "" })) === 400,
  );
  const explained = await platform({ action: "restoreCheckpoint", appId: "abc", checkpointId: "x/y" }, USER);
  check(
    "the rejection names the parameter and no host",
    String(explained.body.detail ?? "").includes("checkpointId") && !JSON.stringify(explained.body).includes("http"),
    JSON.stringify(explained.body).slice(0, 140),
  );

  console.log("\n3. an unlinked user is a clean 428 on every new action");

  for (const body of [
    { action: "listCheckpoints", appId: "abc" },
    { action: "restoreCheckpoint", appId: "abc", checkpointId: "c1" },
    { action: "retryCheckpointBuild", appId: "abc", checkpointId: "c1" },
    { action: "deployApp", appId: "abc", checkpointId: "c1" },
  ]) {
    const res = await platform(body, OTHER);
    check(
      `${body.action} is 428 not_linked`,
      res.status === 428 && res.body.code === "not_linked",
      `got ${res.status} ${JSON.stringify(res.body).slice(0, 100)}`,
    );
  }

  pureChecks();

  await cleanup();

  console.log(failures === 0 ? "\nall version-history checks passed." : `\n${failures} CHECK(S) FAILED.`);
  if (failures) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error("\nversions smoke test errored:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());

/**
 * Smoke test for the Base44 bridge (`/api/base44/link` and
 * `/api/base44/platform`).
 *
 * These two routes are the only code holding credentials: the `b44k_` workspace
 * key, which can act as any member of the workspace, and each user's minted
 * platform token. So this asserts the boundary rather than the happy path — the
 * happy path needs a real key and provisions real users in a real Base44
 * workspace, which is a manual step (see scripts/base44-live-check.ts).
 *
 * What it pins down:
 *   1. neither route is reachable without a session
 *   2. `Base44Link` is still unreachable through the generic entity API, and no
 *      response from either route ever contains a token
 *   3. the link is keyed by the *session* email — the body cannot name another user
 *   4. the platform route is a strict allow-list: unknown actions, dirty app ids
 *      and missing required params are all 400, before any upstream call
 *   5. an unlinked user gets 428 `not_linked`, never a crash or a leaked config
 *   6. with no `BASE44_SVC_KEY`, both routes answer 501 `bridge_misconfigured`
 *      rather than 500 — and still say nothing about the environment
 *   7. the `service_external_id` the bridge sends to Base44 is opaque and stable
 *      and is never the user's email — Base44 derives the principal's address
 *      from it, so an email here would recreate the impersonable identity that
 *      service principals exist to avoid
 *   8. a submit's request id is stable per tool call, so a retried POST dedupes
 *      instead of resuming and charging the turn twice
 *
 * Needs `npm run dev`. Writes throwaway rows to DATABASE_URL and cleans up:
 *   npm run base44:smoke
 */

import { principalId } from "../src/lib/base44Link";
import { submitRequestId } from "../src/lib/base44Platform";
import { prisma } from "../src/lib/prisma";
import { SESSION_COOKIE_NAME, sessionCookie } from "./session-cookie";

const TAG = "b44-smoke";
const USER = `${TAG}-user@example.com`;
const OTHER = `${TAG}-other@example.com`;

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const CONFIGURED = Boolean(process.env.BASE44_SVC_KEY);

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

async function api(path: string, body: unknown, as?: string): Promise<Res> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(as ? { cookie: cookies[as] } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

const link = (body: unknown, as?: string) => api("/api/base44/link", body, as);
const platform = (body: unknown, as?: string) => api("/api/base44/platform", body, as);

async function cleanup() {
  await prisma.base44Link.deleteMany({ where: { appUserEmail: { startsWith: TAG } } });
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
  await Promise.all([mintCookie(USER), mintCookie(OTHER)]);

  console.log("\n1. the boundary: a session is required");

  check("anonymous link status is 401", (await link({ action: "status" })).status === 401);
  check("anonymous link connect is 401", (await link({ action: "connect" })).status === 401);
  check("anonymous platform call is 401", (await platform({ action: "listApps" })).status === 401);
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

  console.log("\n2. tokens never leave the server");

  check(
    "Base44Link is still unreachable through /api/entities",
    (await fetch(`${BASE_URL}/api/entities/Base44Link`, { headers: { cookie: cookies[USER] } }))
      .status === 404,
  );

  // A linked row with a recognisable secret, to prove no route echoes it back.
  const SECRET = `${TAG}-SECRET-TOKEN-VALUE`;
  await prisma.base44Link.create({
    data: {
      appUserEmail: USER,
      status: "linked",
      accessToken: SECRET,
      refreshToken: `${SECRET}-refresh`,
      organizationId: "org-under-test",
      // The Base44 identity is the *principal's* synthetic address, never the
      // user's real one — the whole point of a service principal.
      base44UserEmail: `sunny-abc@org-under-test.svc.base44.invalid`,
      serviceExternalId: `${TAG}-principal`,
      principalProvisioned: true,
      createdBy: USER,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  const status = await link({ action: "status" }, USER);
  check("status reports linked", status.status === 200 && status.body.linked === true);
  check(
    "...and exposes the display fields",
    String(status.body.base44_user_email ?? "").endsWith(".svc.base44.invalid"),
    String(status.body.base44_user_email),
  );
  check(
    "...which is the synthetic principal, not the user's real address",
    !JSON.stringify(status.body).includes(USER),
    JSON.stringify(status.body).slice(0, 140),
  );
  check(
    "...and NO token appears in the response",
    !JSON.stringify(status.body).includes(SECRET),
    JSON.stringify(status.body).slice(0, 120),
  );
  check(
    "...nor any token-shaped key",
    !("access_token" in status.body) && !("accessToken" in status.body),
  );

  console.log("\n3. the link is keyed by the session, not the body");

  const spoof = await link({ action: "status", email: USER, app_user_email: USER }, OTHER);
  check(
    "another user cannot read this link by naming it",
    spoof.body.linked === false,
    JSON.stringify(spoof.body),
  );
  const spoofDisconnect = await link({ action: "disconnect", email: USER }, OTHER);
  check(
    "...nor disconnect it",
    spoofDisconnect.status === 200 && spoofDisconnect.body.linked === false,
  );
  check(
    "...and the victim's link survives",
    (await prisma.base44Link.findUnique({ where: { appUserEmail: USER } }))?.accessToken === SECRET,
  );

  console.log("\n4. the platform route is a strict allow-list");

  const bad = async (body: unknown) => (await platform(body, USER)).status;
  check("an unknown action is 400", (await bad({ action: "deleteEverything" })) === 400);
  check("a missing action is 400", (await bad({})) === 400);

  // renameApp is the one action that writes to an app record, so its input is
  // checked before anything reaches upstream — these run without a live platform.
  check("renameApp needs an appId", (await bad({ action: "renameApp", name: "x" })) === 400);
  check(
    "renameApp needs a name",
    (await bad({ action: "renameApp", appId: "abc123" })) === 400,
  );
  check(
    "...a blank one does not count",
    (await bad({ action: "renameApp", appId: "abc123", name: "   " })) === 400,
  );
  check(
    "...and it is length-capped",
    (await bad({ action: "renameApp", appId: "abc123", name: "x".repeat(61) })) === 400,
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
    (await bad({ action: "sendMessage", appId: "abc" })) === 400,
  );
  check(
    "submitToolCallInput with a dirty toolCallId is 400",
    (await bad({ action: "submitToolCallInput", appId: "abc", toolCallId: "x/y" })) === 400,
  );
  check(
    "fileAppsInFolder with an empty list is 400",
    (await bad({ action: "fileAppsInFolder", appIds: [] })) === 400,
  );
  check(
    "fileAppsInFolder with a dirty id is 400",
    (await bad({ action: "fileAppsInFolder", appIds: ["ok", "../nope"] })) === 400,
  );

  // The only limit on which credential `createApp` can install is APP_SECRETS.
  const withSecrets = (secrets: unknown) => ({ action: "createApp", prompt: "hi", secrets });
  check(
    "createApp with an unregistered secret name is 400",
    (await bad(withSecrets(["OPENAI_API_KEY"]))) === 400,
  );
  check(
    "...including the workspace key, which must never reach an app",
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
  const rejectedSecret = await platform(withSecrets(["BASE44_SVC_KEY"]), USER);
  check(
    "...and the rejection names no value, only names",
    !JSON.stringify(rejectedSecret.body).includes(process.env.SUNNY_API_TOKEN ?? "\0") &&
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

  console.log("\n5. an unlinked user is a clean 428");

  const unlinked = await platform({ action: "listApps" }, OTHER);
  check("unlinked platform call is 428", unlinked.status === 428, `got ${unlinked.status}`);
  check("...with code not_linked", unlinked.body.code === "not_linked");
  check("...and no config in the body", !JSON.stringify(unlinked.body).includes("b44k_"));

  const unlinkedStatus = await link({ action: "status" }, OTHER);
  check(
    "status for an unlinked user is 200 linked:false",
    unlinkedStatus.status === 200 && unlinkedStatus.body.linked === false,
  );

  console.log("\n6. an unconfigured deployment degrades, it does not crash");

  if (CONFIGURED) {
    // A real key is present, so `connect` would create a live service principal
    // in the real workspace. Not something a smoke test should do — and unlike
    // the old SCIM path, cleaning up after it means a deprovision, which
    // transfers any apps the principal owned to the workspace owner.
    console.log("  ⊘ BASE44_SVC_KEY is set — skipping the misconfiguration checks");
    console.log("  ⊘ (and skipping `connect`, which would provision a real principal)");
  } else {
    // Two ways a missing key surfaces on the platform route, both of which used
    // to be reported as something else entirely:
    //   * inside a path builder (listApps reads BASE44_APPS_FOLDER_ID) — was a
    //     400 "invalid parameters", blaming the caller;
    //   * inside remint(), after upstream rejects the stored token — was a 428
    //     "your connection expired, connect again", which is a lie and a loop.
    // Whichever fires first for this env, the answer must be 501.
    const noConfig = await platform({ action: "listApps" }, USER);
    check(
      "a missing key on a platform call is 501, not 400 or 428",
      noConfig.status === 501,
      `got ${noConfig.status}: ${JSON.stringify(noConfig.body).slice(0, 140)}`,
    );
    check("...with code bridge_misconfigured", noConfig.body.code === "bridge_misconfigured");
    check(
      "...and the body never names an env var",
      !JSON.stringify(noConfig.body).includes("BASE44_SVC_KEY") &&
        !JSON.stringify(noConfig.body).includes("BASE44_"),
      JSON.stringify(noConfig.body).slice(0, 140),
    );

    const noKey = await link({ action: "connect" }, OTHER);
    check("connect without a key is 501", noKey.status === 501, `got ${noKey.status}`);
    check("...with code bridge_misconfigured", noKey.body.code === "bridge_misconfigured");
    check(
      "...and says nothing about which var is missing",
      !JSON.stringify(noKey.body).includes("BASE44_SVC_KEY"),
      JSON.stringify(noKey.body).slice(0, 140),
    );
  }

  console.log("\n7. malformed input");

  const notJson = await fetch(`${BASE_URL}/api/base44/link`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[USER] },
    body: "not json",
  });
  check("a non-JSON body is 400", notJson.status === 400, `got ${notJson.status}`);
  check("an unknown link action is 400", (await link({ action: "nope" }, USER)).status === 400);

  console.log("\n8. the service-principal id is opaque, stable, and not an email");

  if (!process.env.BASE44_ORG_ID) {
    console.log("  ⊘ BASE44_ORG_ID is unset — skipping the principal-id checks");
  } else {
    // Base44 builds the principal's address out of this value, so anything
    // email-shaped here would put a real, impersonable address in the workspace.
    const id = principalId(USER);
    check("it is stable across calls", id === principalId(USER));
    check("...and case-insensitive on the email", id === principalId(USER.toUpperCase()));
    check("...distinct users get distinct ids", id !== principalId(OTHER));
    check("...shaped sunny-<32 hex>", /^sunny-[0-9a-f]{32}$/.test(id), id);
    check("...contains no @", !id.includes("@"), id);
    check(
      "...and does not embed the email or its local part",
      !id.includes(USER) && !id.includes(USER.split("@")[0]),
      id,
    );
  }

  {
    console.log("\n9. the submit request id");
    const a = submitRequestId("toolu_abc");
    check("it is stable for a tool call", a === submitRequestId("toolu_abc"), a);
    check("...distinct tool calls get distinct ids", a !== submitRequestId("toolu_xyz"));
    check("...and carries the tool call id", a.includes("toolu_abc"), a);
    check(
      "...and does not change on a resubmit, so a retry dedupes",
      a === submitRequestId("toolu_abc"),
    );
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

/**
 * Contract test for `/api/embed`.
 *
 * The route hands out a URL that signs its holder into an app, so the gate is the
 * whole subject: the credential behind it is workspace-scoped, and without the
 * authored-or-installed check it would mint into any app in the folder. Sections
 * 1–2 fence that. Section 3 covers the shape the frame depends on — a refusal is
 * a 200 with `embed_url: null`, never an error, because a frame that cannot be
 * signed in still has to render.
 *
 * With `EMBED_SMOKE_APP_ID` set to a real, deployed app the last section also
 * asserts a live mint against Base44. Without it that section skips.
 *
 * Needs `npm run dev`. Writes throwaway rows and cleans up:  npm run embed:smoke
 */

import { prisma } from "../src/lib/prisma";
import { sessionCookie } from "./session-cookie";

const TAG = "embed-smoke";
const AUTHOR = `${TAG}-author@example.com`;
const OTHER = `${TAG}-other@example.com`;
const INSTALLER = `${TAG}-installer@example.com`;
const APP = `${TAG}-app`;
const FOREIGN_APP = `${TAG}-foreignapp`;
const LIVE_APP = process.env.EMBED_SMOKE_APP_ID ?? "";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

let failures = 0;
let skipped = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✔ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function skip(name: string, why: string) {
  skipped++;
  console.log(`  ⊘ ${name} — ${why}`);
}

type Rec = Record<string, unknown>;
const cookies: Record<string, string> = {};

async function mintCookie(email: string) {
  cookies[email] = await sessionCookie({ email, role: "user", roleCheckedAt: Date.now() });
}

async function embed(body: unknown, as?: string) {
  const res = await fetch(`${BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(as ? { cookie: cookies[as] } : {}) },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    cacheControl: res.headers.get("cache-control") ?? "",
    body: (await res.json().catch(() => ({}))) as Rec,
  };
}

async function cleanup() {
  await prisma.appInstall.deleteMany({ where: { appId: { startsWith: TAG } } });
  await prisma.appOwnership.deleteMany({ where: { appId: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function main() {
  if (!process.env.NEXTAUTH_SECRET) {
    console.error("NEXTAUTH_SECRET is unset.");
    process.exitCode = 1;
    return;
  }
  await cleanup();

  await prisma.user.createMany({ data: [{ email: AUTHOR }, { email: OTHER }, { email: INSTALLER }] });
  await prisma.appOwnership.createMany({
    data: [
      { appId: APP, appName: "Weekly report", createdBy: AUTHOR },
      { appId: FOREIGN_APP, appName: "Someone else's", createdBy: OTHER },
    ],
  });
  await prisma.appInstall.create({
    data: { appId: FOREIGN_APP, appName: "Someone else's", createdBy: INSTALLER, scopes: ["boards:read"] },
  });
  await Promise.all([mintCookie(AUTHOR), mintCookie(OTHER), mintCookie(INSTALLER)]);

  try {
    await fetch(`${BASE_URL}/api/embed`, { method: "POST" });
  } catch {
    console.log(`  ⊘ SKIPPED: no dev server at ${BASE_URL}`);
    skipped++;
    await cleanup();
    return;
  }

  // === 1. only a signed-in caller, only a named app =========================
  console.log("\n1. the caller and the request");
  check("anonymous is 401", (await embed({ app_id: APP })).status === 401);
  check("a missing app_id is 400", (await embed({}, AUTHOR)).status === 400);
  check("a non-string app_id is 400", (await embed({ app_id: 42 }, AUTHOR)).status === 400);

  // === 2. the gate =========================================================
  console.log("\n2. authored or installed, nothing else");
  const stranger = await embed({ app_id: FOREIGN_APP }, AUTHOR);
  check("an app you neither built nor installed is 403", stranger.status === 403, JSON.stringify(stranger.body));
  check("...and it names the reason", stranger.body.error === "app_not_installed");

  const authored = await embed({ app_id: APP }, AUTHOR);
  const installed = await embed({ app_id: FOREIGN_APP }, INSTALLER);
  const bridgeOff = [authored.status, installed.status].includes(501);
  if (bridgeOff) {
    skip("the author is let through", "the Base44 bridge is not configured");
    skip("the installer is let through", "the Base44 bridge is not configured");
  } else {
    check("the author is let through", authored.status === 200, JSON.stringify(authored.body));
    check("the installer is let through", installed.status === 200, JSON.stringify(installed.body));
  }

  // === 3. the shape a frame depends on =====================================
  console.log("\n3. a refusal is an answer, not an error");
  if (bridgeOff) {
    skip("an app Base44 does not know still answers 200", "the Base44 bridge is not configured");
    skip("...with a null url and a reason", "the Base44 bridge is not configured");
    skip("the url is never cached", "the Base44 bridge is not configured");
  } else {
    check("an app Base44 does not know still answers 200", authored.status === 200);
    check(
      "...with a null url and a reason",
      authored.body.embed_url === null && typeof authored.body.reason === "string",
      JSON.stringify(authored.body),
    );
    check("the url is never cached", authored.cacheControl.includes("no-store"), authored.cacheControl);
  }

  // === 4. a real app, if one was named =====================================
  console.log("\n4. a live mint");
  if (!LIVE_APP) {
    skip("a deployed app mints a live-host url", "set EMBED_SMOKE_APP_ID to a deployed app id");
  } else {
    await prisma.appOwnership.create({
      data: { appId: LIVE_APP, appName: `${TAG} live`, createdBy: AUTHOR },
    });
    const live = await embed({ app_id: LIVE_APP }, AUTHOR);
    const url = String(live.body.embed_url ?? "");
    check("a deployed app mints a live-host url", live.status === 200 && url.includes("ott="), JSON.stringify(live.body));
    check("...on the app's own host, not the sandbox preview", url !== "" && !url.includes("preview--"), url);
    check("...and it is single-use, so a second call differs", url !== String((await embed({ app_id: LIVE_APP }, AUTHOR)).body.embed_url ?? ""));
    await prisma.appOwnership.deleteMany({ where: { appId: LIVE_APP, createdBy: AUTHOR } });
  }

  await cleanup();
  console.log(
    failures === 0
      ? `\nall embed checks passed${skipped ? ` (${skipped} skipped)` : ""}.`
      : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error("\nembed smoke test errored:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());

/**
 * Contract test for the app market (`/api/marketplace`, `src/lib/marketplace.ts`).
 *
 * The reason this file exists is one line in `listPublished()`: a Prisma query with
 * **no owner predicate**, the first in the codebase. CLAUDE.md calls hand-enforced RLS
 * the biggest correctness risk here, so the carve-out gets assertions rather than a
 * comment promising it is fine.
 *
 * What it pins down:
 *   1. writes are owner-only — publishing needs ownership of the app, delisting needs
 *      authorship of the listing
 *   2. the exception is exactly as wide as intended: `published` rows cross owners,
 *      `draft` and `delisted` ones do not, and a card carries no extra field
 *   3. a listing is metadata, not access — it grants nothing until someone installs
 *   4. installing and pinning to Home are separate: pinning grants nothing, and
 *      uninstalling revokes *and* takes the widget with it
 *   5. delisting is about discovery: an existing installer keeps working
 *
 * Needs `npm run dev`. Writes throwaway rows and cleans up:
 *   npm run market:smoke
 */

import { encode } from "next-auth/jwt";

import { prisma } from "../src/lib/prisma";

const TAG = "market-smoke";
const AUTHOR = `${TAG}-author@example.com`;
const OTHER = `${TAG}-other@example.com`;
const THIRD = `${TAG}-third@example.com`;
// A second owner of APP, kept apart from OTHER: /api/sunny/token grants on
// authorship, so giving OTHER an ownership row would quietly satisfy the
// "a pin alone grants nothing" checks for the wrong reason.
const COOWNER = `${TAG}-coowner@example.com`;
const APP = `${TAG}-app`;
const DRAFT_APP = `${TAG}-draftapp`;
const FOREIGN_APP = `${TAG}-foreignapp`;

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

type Rec = Record<string, unknown>;
const cookies: Record<string, string> = {};

async function mintCookie(email: string) {
  cookies[email] = `next-auth.session-token=${await encode({
    token: { email, role: "user", roleCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
  })}`;
}

async function api(path: string, body: unknown, as?: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(as ? { cookie: cookies[as] } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Rec };
}

const market = (body: unknown, as?: string) => api("/api/marketplace", body, as);
const installs = (body: unknown, as?: string) => api("/api/installs", body, as);
const token = (appId: string, as: string) => api("/api/sunny/token", { app_id: appId }, as);

const cards = (r: { body: Rec }) => (r.body.listings ?? []) as Rec[];
const ids = (r: { body: Rec }) => cards(r).map((l) => l.app_id);

const PUBLISH = {
  action: "publish",
  app_id: APP,
  title: "Weekly report",
  tagline: "sums the week",
  app_url: "https://example.invalid/app",
};

/** Pinning to Home, which is deliberately not the grant. */
const pin = (appId: string, email: string) =>
  prisma.widget.create({
    data: { appId, appName: "pinned", appSlug: null, previewUrl: "https://example.invalid/app", createdBy: email },
  });

async function cleanup() {
  await prisma.marketplaceListing.deleteMany({ where: { appId: { startsWith: TAG } } });
  await prisma.appInstall.deleteMany({ where: { appId: { startsWith: TAG } } });
  await prisma.widget.deleteMany({ where: { appId: { startsWith: TAG } } });
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

  await prisma.user.createMany({
    data: [{ email: AUTHOR }, { email: OTHER }, { email: THIRD }, { email: COOWNER }],
  });
  await prisma.appOwnership.createMany({
    data: [
      { appId: APP, appName: "Weekly report", createdBy: AUTHOR },
      { appId: DRAFT_APP, appName: "Unfinished", createdBy: AUTHOR },
      { appId: FOREIGN_APP, appName: "Someone else's", createdBy: OTHER },
    ],
  });
  await Promise.all([mintCookie(AUTHOR), mintCookie(OTHER), mintCookie(THIRD), mintCookie(COOWNER)]);

  try {
    await fetch(`${BASE_URL}/api/marketplace`, { method: "POST" });
  } catch {
    console.log(`  ⊘ SKIPPED: no dev server at ${BASE_URL}`);
    skipped++;
    await cleanup();
    return;
  }

  // === 1. writes are owner-only ============================================
  console.log("\n1. publishing is owner-only");
  check("anonymous is 401", (await market({ action: "browse" })).status === 401);
  check("an unknown action is 400", (await market({ action: "delist" }, AUTHOR)).status === 400);

  const notMine = await market({ ...PUBLISH, app_id: FOREIGN_APP }, AUTHOR);
  check("you cannot publish an app you did not build", notMine.status === 403, JSON.stringify(notMine.body));
  check("...with code not_the_author", notMine.body.code === "not_the_author");

  const noUrl = await market({ ...PUBLISH, app_url: undefined }, AUTHOR);
  check("a listing with no embed URL is refused", noUrl.status === 400);
  check("...with code not_deployed", noUrl.body.code === "not_deployed");
  check("a blank title is refused", (await market({ ...PUBLISH, title: "  " }, AUTHOR)).status === 400);

  /**
   * An app can have several AppOwnership rows, so owning the app is not the same as
   * owning its listing — and the upsert keys on app_id alone. Without a guard a
   * co-owner overwrites someone else's listing, embed URL included, while createdBy
   * keeps crediting the original author.
   */
  await prisma.appOwnership.create({ data: { appId: APP, appName: "co-owned", createdBy: COOWNER } });

  const ok = await market(PUBLISH, AUTHOR);
  check("the author publishes", ok.status === 200, JSON.stringify(ok.body));
  check("...as published", (ok.body.listing as Rec)?.status === "published");
  check("...and is flagged as the author to themselves", (ok.body.listing as Rec)?.is_author === true);

  const hijack = await market(
    { ...PUBLISH, title: "Hijacked", app_url: "https://evil.invalid/app" },
    COOWNER,
  );
  check("a co-owner of the app cannot overwrite its listing", hijack.status === 409, JSON.stringify(hijack.body));
  check("...with code listed_by_another", hijack.body.code === "listed_by_another");
  check(
    "...and the listing is untouched",
    (await prisma.marketplaceListing.findUnique({ where: { appId: APP } }))?.appUrl ===
      "https://example.invalid/app",
  );
  check("...while the real author can still re-publish", (await market(PUBLISH, AUTHOR)).status === 200);

  // === 2. the non-scoped read ==============================================
  console.log("\n2. the non-scoped read");
  const stranger = await market({ action: "browse" }, THIRD);
  check("a stranger sees the published listing", ids(stranger).includes(APP), JSON.stringify(ids(stranger)));
  check("...and is not marked its author", cards(stranger).find((l) => l.app_id === APP)?.is_author === false);
  check(
    "...and it carries no field beyond the card shape",
    cards(stranger).every((l) =>
      Object.keys(l).every((k) =>
        ["app_id", "title", "tagline", "category", "author", "app_slug", "app_url",
         "screenshot_url", "status", "published_date", "install_count", "installed",
         "pinned", "is_author"].includes(k))),
    JSON.stringify(Object.keys(cards(stranger)[0] ?? {})),
  );

  await prisma.marketplaceListing.create({
    data: { appId: DRAFT_APP, title: "Unfinished", appUrl: "https://example.invalid/draft",
            status: "draft", createdBy: AUTHOR },
  });
  check("a draft is invisible to everyone else", !ids(await market({ action: "browse" }, THIRD)).includes(DRAFT_APP));
  check("...but visible to its author under `mine`", ids(await market({ action: "mine" }, AUTHOR)).includes(DRAFT_APP));
  check("...and `mine` shows nobody else's", !ids(await market({ action: "mine" }, THIRD)).includes(APP));

  // === 3. a listing grants nothing =========================================
  console.log("\n3. a listing is metadata, not access");
  check("browsing does not grant a token", (await token(APP, THIRD)).status === 403);
  check("anonymous cannot install", (await installs({ action: "install", app_id: APP })).status === 401);
  // The id comes from the request, so an unlisted one must not create a grant.
  const unlisted = await installs({ action: "install", app_id: `${TAG}-never-listed` }, THIRD);
  check("an app that was never listed cannot be installed", unlisted.status === 404, JSON.stringify(unlisted.body));
  check("...with code not_available", unlisted.body.code === "not_available");
  check(
    "...but your own unlisted app can be",
    (await installs({ action: "install", app_id: DRAFT_APP }, AUTHOR)).status === 200,
  );

  check("installing does", (await installs({ action: "install", app_id: APP }, THIRD)).status === 200);
  check("...the token is now minted", (await token(APP, THIRD)).status === 200);
  const afterInstall = cards(await market({ action: "browse" }, THIRD)).find((l) => l.app_id === APP);
  check("...and the card says installed", afterInstall?.installed === true);
  check("...it appears under `installed`", ids(await market({ action: "installed" }, THIRD)).includes(APP));
  check("...but not under someone else's", !ids(await market({ action: "installed" }, OTHER)).includes(APP));
  check("installing twice is not an error", (await installs({ action: "install", app_id: APP }, THIRD)).status === 200);

  // === 4. installing is not pinning ========================================
  console.log("\n4. installing and pinning are separate");
  check("an install is not on Home", afterInstall?.pinned === false);

  await pin(APP, THIRD);
  const afterPin = cards(await market({ action: "browse" }, THIRD)).find((l) => l.app_id === APP);
  check("...pinning shows on the card", afterPin?.pinned === true);
  check("...and does not change the install count", afterPin?.install_count === 1, String(afterPin?.install_count));

  // Pinning must not be a way to grant access without installing.
  await pin(APP, OTHER);
  check("a pin alone grants nothing", (await token(APP, OTHER)).status === 403);
  await prisma.widget.deleteMany({ where: { appId: APP, createdBy: OTHER } });

  await installs({ action: "install", app_id: APP }, OTHER);
  check(
    "a second installer makes it two",
    cards(await market({ action: "browse" }, AUTHOR)).find((l) => l.app_id === APP)?.install_count === 2,
  );

  check("uninstalling revokes", (await installs({ action: "uninstall", app_id: APP }, OTHER)).status === 200);
  check("...the token is refused again", (await token(APP, OTHER)).status === 403);
  check(
    "...and the count drops",
    cards(await market({ action: "browse" }, AUTHOR)).find((l) => l.app_id === APP)?.install_count === 1,
  );
  check(
    "uninstalling takes the widget with it",
    (await installs({ action: "uninstall", app_id: APP }, THIRD)).status === 200 &&
      (await prisma.widget.count({ where: { appId: APP, createdBy: THIRD } })) === 0,
  );
  check("uninstalling what you do not have is 404", (await installs({ action: "uninstall", app_id: APP }, THIRD)).status === 404);

  // Put THIRD back for the delisting checks below.
  await installs({ action: "install", app_id: APP }, THIRD);

  // === 5. delisting ========================================================
  console.log("\n5. delisting is about discovery, not access");
  check("a non-author cannot delist", (await market({ action: "unpublish", app_id: APP }, THIRD)).status === 404);
  check("the author delists", (await market({ action: "unpublish", app_id: APP }, AUTHOR)).status === 200);
  check("...it leaves the catalogue", !ids(await market({ action: "browse" }, THIRD)).includes(APP));
  check("...an existing installer keeps it under `installed`", ids(await market({ action: "installed" }, THIRD)).includes(APP));
  check("...and their access still works", (await token(APP, THIRD)).status === 200);
  check(
    "re-publishing puts it back",
    (await market(PUBLISH, AUTHOR)).status === 200 && ids(await market({ action: "browse" }, THIRD)).includes(APP),
  );

  await cleanup();
  console.log(
    failures === 0
      ? `\nall marketplace checks passed${skipped ? ` (${skipped} skipped)` : ""}.`
      : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error("\nmarketplace smoke test errored:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());

/**
 * The **only** module that reads or writes `MarketplaceListing`, and it is
 * server-only.
 *
 * ## The carve-out
 *
 * CLAUDE.md's first convention is that every user-owned entity goes through
 * `scopedWhere()`. This module breaks that in one direction, on purpose:
 * `listPublished()` reads across owners, because a market whose listings are visible
 * only to their author is not a market.
 *
 * The exception is contained to rows whose `status` is `published` — a state the
 * author put them in deliberately — and to the fields in `ListingCard`. Every write
 * is still owner-only. Nothing else should copy this without the same justification.
 *
 * ## An install is a Widget row
 *
 * There is no separate install record, because this shell already has one. Pinning an
 * app to My Widgets is what lets it mint a viewer token (`/api/sunny/token` gates on
 * exactly that), and unpinning revokes. So the market installs by pinning and counts
 * installs by counting rows. Adding a second grant concept beside it would mean two
 * places to look when someone asks "why can this app read my boards".
 *
 * ## Publishing snapshots the app
 *
 * `appSlug` / `appUrl` / `screenshotUrl` are captured at publish time rather than
 * resolved when someone views the listing. That is forced: an installer's Base44
 * service principal cannot see another user's app in the shared workspace, so at
 * install and render time there is no way to ask the platform where the app lives.
 *
 * The cost is staleness — an author who redeploys leaves installers on the snapshot
 * until they re-publish. The alternative is a lookup the identity model cannot
 * currently perform at all.
 */

import type { MarketplaceListing } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ownerFields, type RlsActor } from "@/lib/rls";

export type { MarketplaceListing };

export class ListingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ListingError";
  }
}

/** What anyone browsing the market may see. Deliberately not the whole row. */
export type ListingCard = {
  app_id: string;
  title: string;
  tagline: string | null;
  category: string | null;
  author: string;
  app_slug: string | null;
  app_url: string | null;
  screenshot_url: string | null;
  status: string;
  published_date: string | null;
  install_count: number;
  /** Whether the *caller* has it pinned, which on this shell is what installed means. */
  installed: boolean;
  is_author: boolean;
};

const MAX_TITLE = 60;
const MAX_TAGLINE = 140;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max) || null;
}

/**
 * Rows → cards, with the caller's own install folded in.
 *
 * Two batched queries rather than one per listing: a market page renders every card
 * at once, so N+1 here would be N+1 on the hot path.
 */
async function toCards(actor: RlsActor, listings: MarketplaceListing[]): Promise<ListingCard[]> {
  const appIds = listings.map((l) => l.appId);
  if (!appIds.length) return [];

  const [counts, mine] = await Promise.all([
    prisma.widget.groupBy({
      by: ["appId"],
      where: { appId: { in: appIds } },
      _count: { _all: true },
    }),
    prisma.widget.findMany({
      where: { appId: { in: appIds }, ...ownerFields(actor) },
      select: { appId: true },
    }),
  ]);

  const countBy = new Map(counts.map((c) => [c.appId, c._count._all]));
  const mineIds = new Set(mine.map((m) => m.appId));

  return listings.map((l) => ({
    app_id: l.appId,
    title: l.title,
    tagline: l.tagline,
    category: l.category,
    author: l.createdBy,
    app_slug: l.appSlug,
    app_url: l.appUrl,
    screenshot_url: l.screenshotUrl,
    status: l.status,
    published_date: l.publishedAt?.toISOString() ?? null,
    install_count: countBy.get(l.appId) ?? 0,
    installed: mineIds.has(l.appId),
    is_author: l.createdBy === actor.email,
  }));
}

/**
 * The public catalogue. The one query here with no owner predicate — see the note at
 * the top of this file.
 */
export async function listPublished(actor: RlsActor): Promise<ListingCard[]> {
  const rows = await prisma.marketplaceListing.findMany({
    where: { status: "published" },
    orderBy: { publishedAt: "desc" },
  });
  return toCards(actor, rows);
}

/** The caller's own listings, published or not. */
export async function listMine(actor: RlsActor): Promise<ListingCard[]> {
  const rows = await prisma.marketplaceListing.findMany({
    where: ownerFields(actor),
    orderBy: { updatedAt: "desc" },
  });
  return toCards(actor, rows);
}

/** Listings for apps the caller has pinned — including ones since delisted. */
export async function listInstalled(actor: RlsActor): Promise<ListingCard[]> {
  const pinned = await prisma.widget.findMany({
    where: ownerFields(actor),
    select: { appId: true },
  });
  if (!pinned.length) return [];

  const rows = await prisma.marketplaceListing.findMany({
    where: { appId: { in: pinned.map((w) => w.appId) } },
    orderBy: { title: "asc" },
  });
  return toCards(actor, rows);
}

async function ownsApp(actor: RlsActor, appId: string): Promise<boolean> {
  const row = await prisma.appOwnership.findFirst({
    where: { appId, ...ownerFields(actor) },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Offer an app to everyone else. Requires ownership of the app — the author is never
 * taken from input — and an embed URL, because a listing nobody can render is worse
 * than no listing.
 */
export async function publish(
  actor: RlsActor,
  input: {
    appId: string;
    title?: unknown;
    tagline?: unknown;
    category?: unknown;
    appSlug?: unknown;
    appUrl?: unknown;
    screenshotUrl?: unknown;
  },
): Promise<ListingCard> {
  const { appId } = input;

  if (!(await ownsApp(actor, appId))) {
    throw new ListingError("You can only publish an app you built.", "not_the_author", 403);
  }

  const title = text(input.title, MAX_TITLE);
  if (!title) throw new ListingError("A listing needs a title.", "invalid_listing", 400);

  const appUrl = text(input.appUrl, 500);
  if (!appUrl) {
    throw new ListingError(
      "Deploy the app first — a listing needs a URL other people can load.",
      "not_deployed",
      400,
    );
  }

  const snapshot = {
    title,
    tagline: text(input.tagline, MAX_TAGLINE),
    category: text(input.category, 40),
    appSlug: text(input.appSlug, 200),
    appUrl,
    screenshotUrl: text(input.screenshotUrl, 500),
    status: "published" as const,
    publishedAt: new Date(),
  };

  const row = await prisma.marketplaceListing.upsert({
    where: { appId },
    create: { appId, ...snapshot, ...ownerFields(actor) },
    update: snapshot,
  });

  const [card] = await toCards(actor, [row]);
  return card;
}

/**
 * Take a listing out of the market. Anyone already running it keeps working: the row
 * stays, so their snapshot URL still resolves and their Widget row still mints a
 * token. Pulling a listing is about discovery. Cutting an app off is the installer's
 * call, made by unpinning it.
 */
export async function unpublish(actor: RlsActor, appId: string): Promise<ListingCard> {
  const { count } = await prisma.marketplaceListing.updateMany({
    where: { appId, ...ownerFields(actor) },
    data: { status: "delisted" },
  });
  if (count === 0) throw new ListingError("You have no listing for that app.", "no_listing", 404);

  const row = await prisma.marketplaceListing.findUnique({ where: { appId } });
  const [card] = await toCards(actor, [row!]);
  return card;
}

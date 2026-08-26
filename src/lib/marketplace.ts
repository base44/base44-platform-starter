/**
 * The only module that reads or writes `MarketplaceListing`. Server-only.
 *
 * `listPublished()` is the one query in this codebase with no owner predicate — a
 * published listing is public by intent. Every write stays owner-only. Do not copy
 * the exception without the same justification.
 *
 * The `app*` fields are snapshotted at publish time because an installer's Base44
 * principal cannot see another user's app, so nothing can resolve the URL later. The
 * cost is staleness until the author re-publishes.
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
  /** Whether the caller has installed it — i.e. whether it may read their data. */
  installed: boolean;
  /** Whether it is also on their home page. A separate, later choice. */
  pinned: boolean;
  is_author: boolean;
};

const MAX_TITLE = 60;
const MAX_TAGLINE = 140;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max) || null;
}

/** Batched, not per-listing: the market renders every card at once. */
async function toCards(actor: RlsActor, listings: MarketplaceListing[]): Promise<ListingCard[]> {
  const appIds = listings.map((l) => l.appId);
  if (!appIds.length) return [];

  const [counts, mine, pinned] = await Promise.all([
    prisma.appInstall.groupBy({
      by: ["appId"],
      where: { appId: { in: appIds } },
      _count: { _all: true },
    }),
    prisma.appInstall.findMany({
      where: { appId: { in: appIds }, ...ownerFields(actor) },
      select: { appId: true },
    }),
    prisma.widget.findMany({
      where: { appId: { in: appIds }, ...ownerFields(actor) },
      select: { appId: true },
    }),
  ]);

  const countBy = new Map(counts.map((c) => [c.appId, c._count._all]));
  const mineIds = new Set(mine.map((m) => m.appId));
  const pinnedIds = new Set(pinned.map((w) => w.appId));

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
    pinned: pinnedIds.has(l.appId),
    is_author: l.createdBy === actor.email,
  }));
}

/** The public catalogue. The one query with no owner predicate. */
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

/** Listings for apps the caller has installed — including ones since delisted. */
export async function listInstalled(actor: RlsActor): Promise<ListingCard[]> {
  const installs = await prisma.appInstall.findMany({
    where: ownerFields(actor),
    select: { appId: true },
  });
  if (!installs.length) return [];

  const rows = await prisma.marketplaceListing.findMany({
    where: { appId: { in: installs.map((i) => i.appId) } },
    orderBy: { title: "asc" },
  });
  return toCards(actor, rows);
}

/** Asked by `appInstall.install()`, which must not accept an arbitrary app id. */
export async function isPublished(appId: string): Promise<boolean> {
  const row = await prisma.marketplaceListing.findFirst({
    where: { appId, status: "published" },
    select: { id: true },
  });
  return Boolean(row);
}

async function ownsApp(actor: RlsActor, appId: string): Promise<boolean> {
  const row = await prisma.appOwnership.findFirst({
    where: { appId, ...ownerFields(actor) },
    select: { id: true },
  });
  return Boolean(row);
}

/** Requires ownership of the app and a deployed URL; the author is never from input. */
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

  // Owning the app is not owning its listing: AppOwnership is unique on
  // (appId, createdBy), so an app can have several owners while the upsert below keys
  // on appId alone. Without this a co-owner overwrites another author's embed URL.
  const existing = await prisma.marketplaceListing.findUnique({
    where: { appId },
    select: { createdBy: true },
  });
  if (existing && existing.createdBy !== ownerFields(actor).createdBy) {
    throw new ListingError(
      "Someone else already listed this app.",
      "listed_by_another",
      409,
    );
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
 * Discovery only. The row stays, so anyone already running it keeps working — cutting
 * an app off is the installer's call.
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

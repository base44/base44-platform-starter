/**
 * POST /api/marketplace — the catalogue.
 *
 * Session-authenticated throughout: the market is for signed-in Sunny users, not the
 * open internet. That is why browsing lives here rather than on `/api/sunny`.
 *
 * Installing is deliberately **not** an action here. On this shell a `Widget` row is
 * the grant, so the market installs by pinning through the existing entity API — a
 * listing is only how you found the app.
 *
 *   browse                       → published listings, with your install folded in
 *   installed                    → listings for apps you have pinned
 *   mine                         → your own listings, published or not
 *   publish   {app_id, title, …} → offer an app you built
 *   unpublish {app_id}           → take it out of the catalogue; installs survive
 */

import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, jsonError } from "@/lib/apiResponse";
import { requireSessionUser } from "@/lib/auth";
import { ListingError, listInstalled, listMine, listPublished, publish, unpublish } from "@/lib/marketplace";

const ACTIONS = ["browse", "installed", "mine", "publish", "unpublish"] as const;

/** Ids reach a `where`, so keep them to a clean shape. */
const CLEAN_ID = /^[A-Za-z0-9_-]+$/;

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSessionUser();

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonError(400, "invalid_request", 'Body must be JSON, e.g. {"action":"browse"}');
    }

    const action = str(payload.action);
    const appId = str(payload.app_id);

    if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
      return jsonError(400, "invalid_request", `Unknown action "${action}". Allowed: ${ACTIONS.join(", ")}`);
    }
    if ((action === "publish" || action === "unpublish") && !CLEAN_ID.test(appId)) {
      return jsonError(400, "invalid_request", `Action "${action}" needs a valid app_id.`);
    }

    switch (action) {
      case "browse":
        return NextResponse.json({ listings: await listPublished(actor) });

      case "installed":
        return NextResponse.json({ listings: await listInstalled(actor) });

      case "mine":
        return NextResponse.json({ listings: await listMine(actor) });

      case "publish":
        return NextResponse.json({
          listing: await publish(actor, {
            appId,
            title: payload.title,
            tagline: payload.tagline,
            category: payload.category,
            appSlug: payload.app_slug,
            appUrl: payload.app_url,
            screenshotUrl: payload.screenshot_url,
          }),
        });

      case "unpublish":
        return NextResponse.json({ listing: await unpublish(actor, appId) });
    }
  } catch (err) {
    if (err instanceof ListingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return errorResponse(err);
  }
}

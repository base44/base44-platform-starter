/**
 * POST /api/sunny/token — mints a viewer-scoped token for one embedded app.
 *
 * Same-origin and session-authenticated, unlike /api/sunny itself: only a Sunny page
 * can call this, and it can only ever mint for the person already signed in. The page
 * then hands the token to the app's iframe over `postMessage`.
 *
 * The install *is* the grant. An `AppInstall` row is per `(app, user)`, so installing
 * an app is the act that lets it read your data, and uninstalling revokes. An app's
 * author can mint for an app they never installed — otherwise previewing an app you
 * just built would show you nothing.
 *
 * This used to gate on the `Widget` row, which made pinning to Home the grant. That
 * conflated two intents: an app you open monthly should not have to live on Home to
 * work. The migration backfills an install for everything already pinned.
 */

import { NextResponse, type NextRequest } from "next/server";

import { hasInstall } from "@/lib/appInstall";
import { APP_TOKEN_TTL_SECONDS, mintAppToken } from "@/lib/appTokens";
import { errorResponse, jsonError } from "@/lib/apiResponse";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSessionUser();

    const body = (await req.json().catch(() => ({}))) as { app_id?: unknown };
    const appId = typeof body.app_id === "string" ? body.app_id : "";
    if (!appId) return jsonError(400, "invalid_request", "app_id is required.");

    const [installed, authored] = await Promise.all([
      hasInstall(actor, appId),
      prisma.appOwnership.findFirst({
        where: { appId, createdBy: actor.email },
        select: { id: true },
      }),
    ]);
    if (!installed && !authored) return jsonError(403, "app_not_installed");

    return NextResponse.json({
      token: mintAppToken(actor.email, appId),
      expires_in: APP_TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

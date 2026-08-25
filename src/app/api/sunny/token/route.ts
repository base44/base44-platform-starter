/**
 * POST /api/sunny/token — mints a viewer-scoped token for one embedded app.
 *
 * Same-origin and session-authenticated, unlike /api/sunny itself: only a Sunny page
 * can call this, and it can only ever mint for the person already signed in. The page
 * then hands the token to the app's iframe over `postMessage`.
 *
 * The install *is* the grant. A `Widget` row is per `(app, user)`, so pinning an app
 * to your dashboard is the act that lets it read your data, and removing it revokes.
 * An app's author can mint for an app they have not pinned — otherwise previewing an
 * app you just built would show you nothing.
 */

import { NextResponse, type NextRequest } from "next/server";

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
      prisma.widget.findFirst({
        where: { appId, createdBy: actor.email },
        select: { id: true },
      }),
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

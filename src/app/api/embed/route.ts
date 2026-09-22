/**
 * POST /api/embed — the URL to load an app's iframe from, with the viewer signed in.
 *
 * Session-authenticated and same-origin, like `/api/sunny/token`, and gated the same
 * way: an app you authored or installed, nothing else. The gate is the point — the
 * credential behind this route is workspace-scoped and could otherwise mint a session
 * into any app in the folder, including apps belonging to other users.
 *
 * The response is a URL and never the token itself. The browser has no use for the
 * raw token, and a token that never reaches JavaScript cannot be stored, logged or
 * forwarded by accident.
 *
 * `embed_url: null` is a normal answer, not an error: the app may never have been
 * deployed, or the viewer may be an identity the platform refuses to mint for. The
 * caller loads the app signed out in that case, which is what every frame did before
 * this route existed.
 */

import { NextResponse, type NextRequest } from "next/server";

import { hasInstall } from "@/lib/appInstall";
import { errorResponse, jsonError } from "@/lib/apiResponse";
import { requireSessionUser } from "@/lib/auth";
import { MissingConfigError } from "@/lib/base44Config";
import { EmbedError, embedSessionFor } from "@/lib/embedSession";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSessionUser();

    const body = (await req.json().catch(() => ({}))) as { app_id?: unknown };
    const appId = typeof body.app_id === "string" ? body.app_id : "";
    if (!appId) return jsonError(400, "invalid_request", "app_id is required.");

    // Authored *or* installed: the same pair the install-token route uses, so one
    // app cannot be embeddable for data and unembeddable for identity.
    const [installed, authored] = await Promise.all([
      hasInstall(actor, appId),
      prisma.appOwnership.findFirst({
        where: { appId, createdBy: actor.email },
        select: { id: true },
      }),
    ]);
    if (!installed && !authored) return jsonError(403, "app_not_installed");

    const session = await embedSessionFor(appId, actor.email);
    return NextResponse.json(
      {
        embed_url: session.embedUrl,
        expires_in: session.expiresIn,
        reason: session.reason,
      },
      // The URL carries a live one-time token; no cache may ever hold it.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof MissingConfigError) return jsonError(500, err.code, err.message);
    if (err instanceof EmbedError) return jsonError(err.status, err.code, err.message);
    return errorResponse(err);
  }
}

/**
 * POST /api/embed — the URL to load an app's iframe from, with the viewer signed in.
 *
 * Gated on authored-or-installed, like `/api/sunny/token`: the credential behind
 * this route is workspace-scoped and could otherwise mint a session into any app
 * in the folder. Returns a URL, never the token. `embed_url: null` is a normal
 * answer — load the app signed out.
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
      // The URL carries a live one-time token.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof MissingConfigError) return jsonError(500, err.code, err.message);
    if (err instanceof EmbedError) return jsonError(err.status, err.code, err.message);
    return errorResponse(err);
  }
}

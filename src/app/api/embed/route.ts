/**
 * POST /api/embed — the URL to load an app's iframe from, with the viewer signed in.
 *
 * Any signed-in member may open any app this shell built, and opening it is what
 * creates their app user. That is looser than `/api/sunny/token`, deliberately:
 * that token decides whose *boards* an app may read, where the install is the
 * grant. This one decides who the app thinks is looking at it, and a member of
 * Sunny looking at a Sunny app is answer enough.
 *
 * What it is not is a way into any app in the workspace. The credential behind
 * this route is workspace-scoped, so the gate is an `AppOwnership` row: an app
 * somebody built here. An app that exists in Base44 but not in this shell is
 * refused.
 *
 * Returns a URL, never the token. `embed_url: null` is a normal answer — load
 * the app signed out.
 */

import { NextResponse, type NextRequest } from "next/server";

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

    const built = await prisma.appOwnership.findFirst({ where: { appId }, select: { id: true } });
    if (!built) return jsonError(403, "unknown_app");

    const session = await embedSessionFor(appId, actor.email);
    return NextResponse.json(
      {
        embed_url: session.embedUrl,
        expires_in: session.expiresIn,
        reason: session.reason,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof MissingConfigError) return jsonError(500, err.code, err.message);
    if (err instanceof EmbedError) return jsonError(err.status, err.code, err.message);
    return errorResponse(err);
  }
}

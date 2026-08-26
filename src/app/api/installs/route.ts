/**
 * POST /api/installs — the grant surface.
 *
 * Kept separate from `/api/marketplace` on purpose: a listing is how you *found* an
 * app, an install is permission for it to read your data. Putting them on one route
 * would make the catalogue look like it hands out access, which it never does.
 *
 *   list                     → the apps you have installed
 *   install   {app_id, name} → grant. Idempotent
 *   uninstall {app_id}       → revoke, and take it off Home with it
 */

import { NextResponse, type NextRequest } from "next/server";

import { InstallError, install, listInstalls, toSummary, uninstall } from "@/lib/appInstall";
import { errorResponse, jsonError } from "@/lib/apiResponse";
import { requireSessionUser } from "@/lib/auth";

const ACTIONS = ["list", "install", "uninstall"] as const;

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
      return jsonError(400, "invalid_request", 'Body must be JSON, e.g. {"action":"list"}');
    }

    const action = str(payload.action);
    const appId = str(payload.app_id);

    if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
      return jsonError(400, "invalid_request", `Unknown action "${action}". Allowed: ${ACTIONS.join(", ")}`);
    }
    if (action !== "list" && !CLEAN_ID.test(appId)) {
      return jsonError(400, "invalid_request", `Action "${action}" needs a valid app_id.`);
    }

    switch (action) {
      case "list":
        return NextResponse.json({ installs: (await listInstalls(actor)).map(toSummary) });

      case "install": {
        const name = typeof payload.app_name === "string" ? payload.app_name : null;
        return NextResponse.json({ install: toSummary(await install(actor, appId, name)) });
      }

      case "uninstall":
        await uninstall(actor, appId);
        return NextResponse.json({ ok: true });
    }
  } catch (err) {
    if (err instanceof InstallError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return errorResponse(err);
  }
}

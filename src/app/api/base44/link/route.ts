/**
 * POST /api/base44/link — gives each shell user their own Base44 identity.
 *
 * Three actions:
 *   status     → is this user linked?
 *   connect    → provision this user's Base44 service principal, mint a token
 *                that acts as it, store it
 *   disconnect → revoke the refresh token and forget the user
 *
 * `connect` provisions a *synthetic service principal* — see
 * `src/lib/base44Link.ts` for what that is and why. It is idempotent, so pressing
 * Connect twice is harmless. `disconnect` deliberately leaves the principal in
 * place: it owns the user's built apps, and unlinking an account should not hand
 * them to the workspace owner.
 *
 * Session-scoped: the link is keyed by the caller's own email, taken from the
 * NextAuth session and never from the body — a user cannot connect, inspect or
 * disconnect anybody else's link. The response is token-free by construction
 * (`linkStatus()` returns booleans and display fields).
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireSessionUser } from "@/lib/auth";
import { Base44Error, connect, disconnect, getLink, linkStatus } from "@/lib/base44Link";
import { MissingConfigError } from "@/lib/base44Config";
import { errorResponse, jsonError } from "@/lib/apiResponse";

const ACTIONS = ["status", "connect", "disconnect"] as const;

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSessionUser();

    let payload: { action?: unknown };
    try {
      payload = await req.json();
    } catch {
      return jsonError(400, "invalid_request", 'Body must be JSON, e.g. {"action":"status"}');
    }

    const action = payload.action;
    const t0 = Date.now();
    console.log(`[base44/link] START action=${String(action)} user=${actor.email}`);

    switch (action) {
      case "status": {
        const status = linkStatus(await getLink(actor.email));
        console.log(
          `[base44/link] END action=status linked=${status.linked} (${Date.now() - t0}ms)`,
        );
        return NextResponse.json(status);
      }

      case "connect": {
        const status = await connect(actor.email);
        console.log(
          `[base44/link] END action=connect linked=${status.linked} (${Date.now() - t0}ms)`,
        );
        return NextResponse.json(status);
      }

      case "disconnect": {
        const status = await disconnect(actor.email);
        console.log(`[base44/link] END action=disconnect (${Date.now() - t0}ms)`);
        return NextResponse.json(status);
      }

      default:
        return jsonError(
          400,
          "invalid_request",
          `Unknown action "${String(action)}". Allowed: ${ACTIONS.join(", ")}`,
        );
    }
  } catch (err) {
    if (err instanceof MissingConfigError) {
      console.error("[base44/link]", err.message);
      // 501, not 500: the code is fine, the deployment is not configured. The
      // client treats `bridge_misconfigured` like "not linked" (see
      // isNotLinkedError) so the UI shows its Connect gate rather than breaking.
      return NextResponse.json(
        { error: "The Base44 bridge is not configured on this deployment.", code: err.code },
        { status: 501 },
      );
    }
    if (err instanceof Base44Error) {
      console.error(`[base44/link] ${err.code}:`, err.detail ?? err.message);
      return NextResponse.json(
        { error: err.message, code: err.code, detail: err.detail },
        { status: err.status },
      );
    }
    return errorResponse(err);
  }
}

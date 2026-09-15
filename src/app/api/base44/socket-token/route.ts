/**
 * POST /api/base44/socket-token — POC. Hands the browser this user's vended
 * Base44 token plus where to point a socket at, so build progress arrives by
 * push instead of by polling `getConversation`.
 *
 * **This deliberately breaks the rule in CLAUDE.md that vended tokens stay
 * server-side**, and that is the whole cost of the approach. What the browser
 * can do with it, once it holds it:
 *
 *   - watch its own builds, which is the point;
 *   - and also call Base44's REST API as its principal, which means creating
 *     apps and sending builder messages. A build costs credits, so an
 *     exfiltrated token spends the workspace's money until it expires.
 *
 * The socket itself grants none of that: Base44 admits this token only to a
 * read-only namespace with no write handlers (see `partner_namespace.py` in
 * apper#22642). The exposure is the token's REST capability, not the socket's.
 *
 * A shipped version does not do this. It asks Base44 for a *read-only, one-app,
 * short-lived* grant and hands the browser that instead, which is what the
 * build-session API adds. This endpoint exists because that grant is not on
 * Base44's main branch yet, and a vended token is the strongest credential the
 * socket currently accepts.
 *
 * The host is not caller-supplied and is returned rather than exposed as a
 * `NEXT_PUBLIC_` var, for the same reason the proxy never takes one: a
 * request-controlled Base44 host on code holding user credentials is an SSRF.
 */

import { NextResponse } from "next/server";

import { requireSessionUser } from "@/lib/auth";
import { errorResponse, jsonError } from "@/lib/apiResponse";
import { MissingConfigError, REFRESH_SKEW_MS, platformHost } from "@/lib/base44Config";
import { type Base44Link, getLink, remint } from "@/lib/base44Link";

/** Base44's read-only namespace for vended principals, and its socket path. */
const NAMESPACE = "/partner";
const SOCKET_PATH = "/ws/socket.io";

export async function POST() {
  try {
    const user = await requireSessionUser();

    let link: Base44Link | null = await getLink(user.email);
    if (link?.status !== "linked" || !link.accessToken) {
      return NextResponse.json(
        { error: "Connect your Base44 account first.", code: "not_linked" },
        { status: 428 },
      );
    }

    // The browser reconnects on its own and re-reads this endpoint each time, so
    // handing it a token about to expire would work and then quietly stop. Same
    // skew as the proxy.
    if (link.expiresAt && link.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS) {
      link = await remint(link);
      if (!link?.accessToken) {
        return jsonError(401, "reauthorize", "Reconnect your Base44 account.");
      }
    }

    return NextResponse.json(
      {
        token: link.accessToken,
        url: platformHost(),
        path: SOCKET_PATH,
        namespace: NAMESPACE,
        expiresAt: link.expiresAt?.toISOString() ?? null,
      },
      // Never cached, anywhere: it is a credential.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof MissingConfigError) {
      return jsonError(501, "bridge_misconfigured", err.message);
    }
    return errorResponse(err);
  }
}

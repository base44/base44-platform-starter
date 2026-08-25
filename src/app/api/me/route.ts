/**
 * GET /api/me — the replacement for Base44's `base44.auth.me()`
 * (`checkUserAuth`).
 *
 * Session-scoped, never service-role: 401 when unauthenticated, exactly as the
 * Base44 SDK behaved, so the client can fall back to sign-in. Returns only the
 * fields the UI needs — no tokens, and nothing from Base44Link.
 */

import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id ?? null,
    email: user.email,
    role: user.role,
    full_name: user.name ?? null,
    image_url: user.image ?? null,
  });
}

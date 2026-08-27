/**
 * Carries the requested path into the server components that render it.
 *
 * The authenticated layout has to redirect a signed-out visitor somewhere, and to
 * send them *back* afterwards it needs to know where they were going. A server
 * component cannot read its own URL, so the only place that knows is here.
 *
 * This is not the auth check — that stays in the layout (and, independently, in
 * every API route). The proxy only labels the request.
 */

import { NextResponse, type NextRequest } from "next/server";

export const PATHNAME_HEADER = "x-sunny-pathname";

export default function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Page routes only: API routes authenticate themselves and static assets have
  // no business paying for this.
  matcher: ["/((?!api|_next/static|_next/image|icon.svg).*)"],
};

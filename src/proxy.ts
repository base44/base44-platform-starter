/**
 * Redirects the routes this app used to serve, and carries the requested path
 * into the server components that render it.
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

/**
 * Where the old routes went, when pages were renamed after themselves and home
 * after nothing. Matched exactly, case included — which is why this is here and
 * not a `redirects()` list in next.config: Next compiles those sources with
 * `sensitive: false`, so `/Board` would match `/board` as well and send the route
 * that still works to itself.
 *
 * Worth keeping rather than letting the old paths 404. `/Board?id=` is pasted
 * between people, and `/MyTools?app=` is what the builder and the widgets minted
 * for months; both carry a query, which rides along on the clone below.
 */
const RENAMED_ROUTES: Record<string, string> = {
  "/Dashboard": "/",
  "/MyTools": "/apps",
  "/Board": "/board",
  "/Boards": "/boards",
  "/Marketplace": "/market",
  "/Analytics": "/analytics",
};

export default function proxy(request: NextRequest) {
  const renamed = RENAMED_ROUTES[request.nextUrl.pathname];
  if (renamed) {
    const url = request.nextUrl.clone();
    url.pathname = renamed;
    // 308, not 307: the old name is not coming back, and a permanent redirect is
    // what tells a browser to stop asking.
    return NextResponse.redirect(url, 308);
  }

  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Page routes only: API routes authenticate themselves and static assets have
  // no business paying for this.
  matcher: ["/((?!api|_next/static|_next/image|icon.svg).*)"],
};

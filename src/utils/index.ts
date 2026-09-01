/**
 * Routes are the page's name, lowercased (`/boards`, `/board?id=…`), produced by
 * this helper and consumed by every `<Link>`. See src/app/(app)/ for the matching
 * route folders. Home is the exception: it has no name in its URL, just `/`.
 *
 * Only the name is lowercased. Anything after `?` is data — board ids among it —
 * and is passed through untouched.
 */
export function createPageUrl(pageName: string) {
  const cut = pageName.indexOf("?");
  const name = cut === -1 ? pageName : pageName.slice(0, cut);
  const query = cut === -1 ? "" : pageName.slice(cut);
  return "/" + name.toLowerCase().replace(/ /g, "-") + query;
}

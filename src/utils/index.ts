/**
 * Routes are page names (`/Boards`, `/Board?id=…`), produced by this helper and
 * consumed by every `<Link>`. See src/app/(app)/ for the matching route folders.
 *
 * Home (`/`) and My apps (`/apps`) are written out literally at their call sites —
 * neither is its page name.
 */
export function createPageUrl(pageName: string) {
  return "/" + pageName.replace(/ /g, "-");
}

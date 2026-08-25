/**
 * Routes are page names (`/Dashboard`, `/Board?id=…`), produced by this helper and
 * consumed by every `<Link>`. See src/app/(app)/ for the matching route folders.
 */
export function createPageUrl(pageName: string) {
  return "/" + pageName.replace(/ /g, "-");
}

/**
 * Every app this user can open: built and installed.
 *
 * Two sources that cannot be merged upstream — built apps come live from the Base44
 * folder, installed ones from the listing snapshot, because an installer's principal
 * cannot see another user's app. Hence `slug`: it means "addressable by convention",
 * which an installed app is not, and `DashboardWidgets` reads its absence as "use the
 * URL you were given". The Apps page and the Add-widget picker both read through here.
 */

import * as platform from "@/lib/base44Platform";

export type UsableApp = {
  id: string;
  name: string;
  /** null for market apps — see the note above. */
  slug: string | null;
  url: string | null;
  screenshot: string | null;
  /** One line under the name: the build prompt, or the author. */
  subtitle: string;
  source: "built" | "market";
  /** The raw Base44 app, for callers that need more (the builder, publishing). */
  app?: Record<string, unknown>;
};

type Base44App = {
  id: string;
  name?: string | null;
  slug?: string | null;
  last_deployed_at?: string | null;
  preview_screenshot_url?: string | null;
  logo_url?: string | null;
  user_description?: string | null;
  description?: string | null;
} & Record<string, unknown>;

/**
 * The deployed build is static and always up; the sandbox preview boots on demand and
 * answers with an error payload while it starts, which a frame renders as raw JSON. So
 * the sandbox is the never-deployed fallback, matching the My apps page and the widgets.
 */
function builtUrl(app: Base44App): string | null {
  if (!app.slug) return null;
  return app.last_deployed_at
    ? platform.publishedUrl(app.slug) || platform.previewUrl(app.slug)
    : platform.previewUrl(app.slug);
}

async function marketInstalls(): Promise<UsableApp[]> {
  const res = await fetch("/api/marketplace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "installed" }),
  });
  if (!res.ok) return [];
  const { listings = [] } = (await res.json()) as { listings?: Record<string, string>[] };

  return listings
    .filter((l) => l.app_url)
    .map((l) => ({
      id: l.app_id,
      name: l.title,
      slug: null,
      url: l.app_url,
      screenshot: l.screenshot_url ?? null,
      subtitle: `by ${l.author}`,
      source: "market" as const,
    }));
}

async function builtApps(): Promise<UsableApp[]> {
  const apps = (await platform.listAppsForUser({ limit: 50 })) as Base44App[];
  return apps.map((app) => ({
    id: app.id,
    name: app.name || "Untitled",
    slug: app.slug ?? null,
    url: builtUrl(app),
    screenshot: app.preview_screenshot_url || app.logo_url || null,
    subtitle: app.user_description || app.description || "Built by you",
    source: "built" as const,
    app,
  }));
}

/**
 * Both sources, installed first. Neither failing takes the other down: a Base44 outage
 * should not hide the market apps, and vice versa.
 */
export async function listUsableApps(): Promise<UsableApp[]> {
  const [market, built] = await Promise.all([
    marketInstalls().catch(() => [] as UsableApp[]),
    builtApps().catch(() => [] as UsableApp[]),
  ]);
  return [...market, ...built];
}

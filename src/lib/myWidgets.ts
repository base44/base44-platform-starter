/**
 * Pins a built Base44 app to My Widgets. My Tools lists the Base44 app folder
 * directly; My Widgets renders `Widget` rows, so an app shows up there only once
 * a row exists. Shared by the Add-widget picker, the builder, and the market.
 *
 * Two ways a row learns its URL: an app you built is addressed by slug and resolved
 * live; an installed one has no slug you can address, so the caller passes the
 * listing's snapshot URL and leaves `slug` null. `DashboardWidgets` reads that absence
 * as "use the stored URL".
 */
import * as platform from "./base44Platform";
import { Widget, type WireRecord } from "./entityClient";

type PinnableApp = {
  id: string;
  name?: string | null;
  slug?: string | null;
  preview_screenshot_url?: string | null;
};

export async function addAppToMyWidgets(app: PinnableApp, url?: string | null): Promise<WireRecord> {
  let preview_url: string | null = url ?? null;
  if (!preview_url) {
    try {
      const urlData = (await platform.getPreviewUrl(app.id)) as { preview_url?: string } | null;
      if (urlData?.preview_url) preview_url = `https://${urlData.preview_url}/`;
    } catch {
      // The preview host can lag a fresh deploy; a null url still renders.
    }
  }

  const widget = await Widget.create({
    app_id: app.id,
    app_name: app.name || "Untitled",
    app_slug: app.slug || null,
    preview_url,
    preview_screenshot_url: app.preview_screenshot_url || null,
    order_index: Date.now(),
  });

  window.dispatchEvent(new CustomEvent("widgets-updated"));
  return widget;
}

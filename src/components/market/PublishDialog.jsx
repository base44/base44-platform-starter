"use client";

import React, { useState } from "react";
import { Loader2, Rocket } from "lucide-react";
import * as platform from "@/lib/base44Platform";
import { announceAppRebuilt } from "@/lib/appRefresh";
import { announceMarketChanged } from "@/lib/marketEvents";

/**
 * Offer an app to everyone else. The embed URL is snapshotted here because the
 * platform proxy answers only to the app's author, so an installer cannot resolve it
 * later — which is also why the app has to be deployed, not just previewed. Each market publish deploys the current
 * build before updating the listing snapshot.
 */
export default function PublishDialog({ app, onClose, onDone }) {
  const [title, setTitle] = useState(app.name || "Untitled");
  const [tagline, setTagline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await platform.deployApp(app.id);
      const fresh = await platform.getApp(app.id);
      announceAppRebuilt(app.id);
      const slug = fresh.slug || app.slug;
      if (!slug) throw new Error("The deployed app has no URL yet. Try again in a moment.");
      const res = await fetch("/api/marketplace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          app_id: app.id,
          title,
          tagline,
          app_slug: slug,
          app_url: platform.publishedUrl(slug),
          screenshot_url: fresh.preview_screenshot_url || fresh.social_image_url || app.preview_screenshot_url || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Publish failed (${res.status})`);
      announceMarketChanged();
      onDone(fresh);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shell = (children) => (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/50 backdrop-blur-sm p-4" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );

  return shell(
    <>
      <h2 className="font-display text-lg text-foreground">Publish to the market</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        This publishes your latest changes, then makes the app available in Sunny Market.
        Anyone in Sunny can install it. They run the same deployment you do, on
        their own boards — you never see their data and they never see yours.
      </p>

      <label className="mt-4 block text-xs font-medium text-foreground">Name</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60}
        className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground" />

      <label className="mt-3 block text-xs font-medium text-foreground">One line about it</label>
      <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={140}
        placeholder="Sums this week's tasks and emails a report"
        className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground" />

      <p className="mt-3 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
        Installing pins it to the person&apos;s home page, and that pin is what lets it read
        their boards as them. Removing it revokes.
      </p>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40">Cancel</button>
        <button disabled={busy || !title.trim()} onClick={submit}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          {busy ? "Publishing…" : "Publish to market"}
        </button>
      </div>
    </>,
  );
}

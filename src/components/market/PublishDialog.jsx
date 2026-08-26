"use client";

import React, { useState } from "react";
import * as platform from "@/lib/base44Platform";
import { announceMarketChanged } from "@/lib/marketEvents";

/**
 * Offer an app to everyone else in Sunny.
 *
 * The embed URL is snapshotted here rather than resolved when someone views the
 * listing: an installer's Base44 principal cannot see this app at all, so nothing on
 * their side can ask the platform where it lives. That is also why publishing needs a
 * deployed app — `publishedUrl` off the slug, not a preview sandbox, which is
 * per-owner and boots on demand.
 */
export default function PublishDialog({ app, onClose, onDone }) {
  const [title, setTitle] = useState(app.name || "Untitled");
  const [tagline, setTagline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const deployed = Boolean(app.last_deployed_at);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/marketplace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          app_id: app.id,
          title,
          tagline,
          app_slug: app.slug || null,
          app_url: platform.publishedUrl(app.slug),
          screenshot_url: app.preview_screenshot_url || app.social_image_url || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Publish failed (${res.status})`);
      // Announced here rather than in each caller: the builder publishes from a panel
      // over the market, so the surface that needs to know is one nobody is thinking
      // about at the call site.
      announceMarketChanged();
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-foreground">Publish to the market</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Anyone in Sunny will be able to install it. They run the same deployment you do, on
          their own boards — you never see their data and they never see yours.
        </p>

        {!deployed && (
          <p className="mt-3 rounded-md border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
            This app has not been deployed. Installers load the deployed build, not your preview
            sandbox, so deploy it from the Assistant first — otherwise their frame shows nothing.
          </p>
        )}

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
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
          <button disabled={busy || !title.trim()} onClick={submit}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40">
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "My Tools" — the apps this user built, each embedded full-height in an iframe.
 *
 * Reads the list through `listAppsForUser()`: Base44 apps live under one shared
 * workspace and carry no per-shell-user owner, so the folder listing is filtered
 * against the local `AppOwnership` rows. The frames need no token because built
 * apps are created `public_without_login`.
 */
import React, { useState, useEffect, useRef } from "react";
import * as platform from "@/lib/base44Platform";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { useAppRebuildNonce, withNonce } from "@/lib/appRefresh";
import { Loader2, ArrowLeft, ExternalLink, Pencil } from "lucide-react";

export default function MyTools() {
  const [apps, setApps] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedApp, setSelectedApp] = useState(null);
  const frameRef = useRef(null);

  // Same handshake the dashboard widgets use: the frame has no session, so it asks
  // this page for a token scoped to whoever is signed in.
  // Deployed build is static and always up; the sandbox is the never-deployed
  // fallback. See DashboardWidgets.
  const baseUrl = !selectedApp
    ? null
    : selectedApp.last_deployed_at
      ? platform.publishedUrl(selectedApp.slug) || platform.previewUrl(selectedApp.slug)
      : platform.previewUrl(selectedApp.slug);

  const rebuildNonce = useAppRebuildNonce(selectedApp?.id ?? null);
  const selectedUrl = withNonce(baseUrl, rebuildNonce);
  useAppFrameAuth(frameRef, selectedApp?.id ?? null, selectedUrl);

  useEffect(() => {
    (async () => {
      try {
        const list = await platform.listAppsForUser({ limit: 50 });
        setApps(list);
        // Auto-select app from ?app= query param
        const appId = new URLSearchParams(window.location.search).get("app");
        if (appId) {
          const match = list.find((a) => a.id === appId);
          if (match) setSelectedApp(match);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  if (selectedApp) {
    const url = selectedUrl;
    return (
      <div className="flex flex-col h-[calc(100vh-56px)]">
        <div className="bg-card border-b border-border px-6 py-3 flex items-center gap-4 flex-shrink-0">
          <button
            onClick={() => setSelectedApp(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <span className="text-sm font-medium text-foreground truncate">
            {selectedApp.name || "Untitled"}
          </span>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Open <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        {url ? (
          <iframe
            key={rebuildNonce}
            ref={frameRef}
            src={url}
            className="flex-1 w-full border-0"
            title={selectedApp.name}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No preview URL yet — deploy it first.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-8 md:py-10">
          <p className="text-xs font-medium text-muted-foreground mb-1">Workspace</p>
          <h1 className="font-display text-3xl md:text-4xl text-foreground">My Tools</h1>
          <p className="text-muted-foreground text-sm mt-2">
            Apps you've built — click any to open it.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-24 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : apps.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-sm text-muted-foreground">
              No apps found. Build one in App Builder.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {apps.map((app) => (
              <div
                key={app.id}
                className="group text-left rounded-lg border border-border bg-card overflow-hidden shadow-sm hover:border-primary/40 hover:shadow-md transition-all"
              >
                <button onClick={() => setSelectedApp(app)} className="w-full block">
                  <div className="aspect-[4/3] bg-muted overflow-hidden relative flex items-center justify-center">
                    {app.preview_screenshot_url || app.social_image_url || app.logo_url ? (
                      <img
                        src={app.preview_screenshot_url || app.social_image_url || app.logo_url}
                        alt={app.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-5xl font-display text-muted-foreground/20 select-none">
                        {(app.name || "?")[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                </button>
                <div className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {app.name || "Untitled"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {app.status?.state === "processing"
                        ? "Building…"
                        : new Date(app.updated_date).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedApp(app);
                      window.dispatchEvent(
                        new CustomEvent("open-assistant", {
                          detail: { mode: "build", appId: app.id },
                        }),
                      );
                    }}
                    className="flex-shrink-0 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    title="Edit in builder"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

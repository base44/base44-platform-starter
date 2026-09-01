/**
 * "My apps" — the apps this user built, embedded full-height.
 *
 * Authorship is the line: everything here is the user's own code, so everything here
 * can be renamed, edited in the builder and published. Apps installed from the market
 * are somebody else's code the user was granted the right to run, and they live in the
 * market under Installed. The route stays `/apps`: `?app=` deep links point at it.
 *
 * The source is the Base44 folder, filtered against local `AppOwnership` rows. The
 * frames load without a token — built apps are `public_without_login` — and then ask
 * for one to read data.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { useAppRebuildNonce, withNonce } from "@/lib/appRefresh";
import { listUsableApps } from "@/lib/usableApps";
import PublishDialog from "@/components/market/PublishDialog";
import AppNameField from "@/components/AppNameField";
import { useMarketChanges } from "@/lib/marketEvents";
import { Loader2, ArrowLeft, ExternalLink, Pencil, Store } from "lucide-react";

export default function MyTools() {
  const [apps, setApps] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedApp, setSelectedApp] = useState(null);
  const [publishing, setPublishing] = useState(null);

  /** Which of these are already listed, so a card can say "In market". */
  const refreshPublished = useCallback(async () => {
    try {
      const res = await fetch("/api/marketplace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mine" }),
      });
      if (!res.ok) return;
      const { listings = [] } = await res.json();
      setPublished(new Set(listings.filter((l) => l.status === "published").map((l) => l.app_id)));
    } catch {
      // A card that does not know it is listed still works; it just offers Publish.
    }
  }, []);

  // Publishing can happen from the builder panel or the market page, not only here.
  useMarketChanges(refreshPublished);

  const [published, setPublished] = useState(new Set());
  const frameRef = useRef(null);

  // Same handshake the dashboard widgets use: the frame has no session, so it asks
  // this page for a token scoped to whoever is signed in.
  const baseUrl = selectedApp?.url ?? null;

  const rebuildNonce = useAppRebuildNonce(selectedApp?.id ?? null);
  const selectedUrl = withNonce(baseUrl, rebuildNonce);
  useAppFrameAuth(frameRef, selectedApp?.id ?? null, selectedUrl);

  useEffect(() => {
    (async () => {
      try {
        // Built only. `listUsableApps()` also carries installed apps, for Home's
        // widget picker — this page is the authoring view, not the launcher.
        const list = (await listUsableApps()).filter((a) => a.source === "built");
        setApps(list);

        void refreshPublished();
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
    // refreshPublished is a stable useCallback, so this still runs once.
  }, [refreshPublished]);

  const handleRenamed = useCallback((id, name) => {
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)));
    setSelectedApp((prev) => (prev?.id === id ? { ...prev, name } : prev));
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
          <AppNameField app={selectedApp} onRenamed={handleRenamed} className="max-w-xs" />
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
      {publishing && (
        <PublishDialog
          app={publishing}
          onClose={() => setPublishing(null)}
          onDone={() => {
            setPublished((p) => new Set(p).add(publishing.id));
            setPublishing(null);
          }}
        />
      )}
      <div className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-8 md:py-10">
          <p className="text-xs font-medium text-muted-foreground mb-1">Workspace</p>
          <h1 className="font-display text-3xl md:text-4xl text-foreground">My apps</h1>
          <p className="text-muted-foreground text-sm mt-2">
            Apps you built. Open one to use it, or publish it so anyone in Sunny can install it.
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
              You have not built an app yet. Build one with the Assistant — or install
              somebody else&apos;s from the market.
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
                    {app.screenshot ? (
                      <img src={app.screenshot} alt={app.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-5xl font-display text-muted-foreground/20 select-none">
                        {(app.name || "?")[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                </button>
                <div className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{app.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{app.subtitle}</p>
                  </div>
                  {/* Labelled: a storefront glyph does not say "offer this to people". */}
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      onClick={() => setPublishing(app.app)}
                      className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors hover:bg-secondary ${
                        published.has(app.id)
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title={
                        published.has(app.id)
                          ? "In the market — republish to update it"
                          : "Offer this app to everyone in Sunny"
                      }
                    >
                      <Store className="w-3.5 h-3.5" />
                      {published.has(app.id) ? "In market" : "Publish"}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedApp(app);
                        window.dispatchEvent(
                          new CustomEvent("open-assistant", {
                            detail: { mode: "build", appId: app.id },
                          }),
                        );
                      }}
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      title="Edit in builder"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

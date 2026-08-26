/**
 * "Apps" — every app this user can open, embedded full-height.
 *
 * Called Apps because half of what is here is not the user's. The route stays
 * `/MyTools`: `?app=` deep links point at it. Sources are filtered rather than tabbed,
 * because opening an app is the common action and "All" has to be the default.
 *
 * Two sources, merged in `listUsableApps()`: apps they built (the Base44 folder,
 * filtered against local `AppOwnership` rows) and apps they installed from the market
 * (the listing snapshot, because an installer's principal cannot see another user's
 * app). The frames load without a token — built apps are `public_without_login` — and
 * then ask for one to read data.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { useAppRebuildNonce, withNonce } from "@/lib/appRefresh";
import { listUsableApps } from "@/lib/usableApps";
import PublishDialog from "@/components/market/PublishDialog";
import { announceMarketChanged, useMarketChanges } from "@/lib/marketEvents";
import { Loader2, ArrowLeft, ExternalLink, Pencil, Store, Hammer, Trash2 } from "lucide-react";

export default function MyTools() {
  const [apps, setApps] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedApp, setSelectedApp] = useState(null);
  const [publishing, setPublishing] = useState(null);
  const [source, setSource] = useState("all");
  const [busyId, setBusyId] = useState(null);

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

  /** Lives here, not the market: a storefront is for getting things, not managing them. */
  const uninstall = async (app) => {
    if (busyId) return;
    setBusyId(app.id);
    try {
      const res = await fetch("/api/installs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "uninstall", app_id: app.id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Uninstall failed");
      setApps((prev) => prev.filter((a) => a.id !== app.id));
      if (selectedApp?.id === app.id) setSelectedApp(null);
      window.dispatchEvent(new CustomEvent("widgets-updated"));
      announceMarketChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };
  const [published, setPublished] = useState(new Set());
  const frameRef = useRef(null);

  // Same handshake the dashboard widgets use: the frame has no session, so it asks
  // this page for a token scoped to whoever is signed in. The URL is already resolved
  // per source in listUsableApps() — a built app by slug, an installed one from its
  // listing snapshot.
  const baseUrl = selectedApp?.url ?? null;

  const rebuildNonce = useAppRebuildNonce(selectedApp?.id ?? null);
  const selectedUrl = withNonce(baseUrl, rebuildNonce);
  useAppFrameAuth(frameRef, selectedApp?.id ?? null, selectedUrl);

  useEffect(() => {
    (async () => {
      try {
        const list = await listUsableApps();
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

  const builtCount = apps.filter((a) => a.source === "built").length;
  const marketCount = apps.length - builtCount;
  const shown = source === "all" ? apps : apps.filter((a) => a.source === source);

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
          <h1 className="font-display text-3xl md:text-4xl text-foreground">Apps</h1>
          <p className="text-muted-foreground text-sm mt-2">
            Apps you built and apps you installed from the market — click any to open it.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {!isLoading && !error && apps.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {[
              ["all", "All", apps.length],
              ["built", "Built by me", builtCount],
              ["market", "From the market", marketCount],
            ]
              // A filter with nothing behind it is noise, not a choice.
              .filter(([key, , n]) => key === "all" || n > 0)
              .map(([key, label, n]) => (
                <button
                  key={key}
                  onClick={() => setSource(key)}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    source === key
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {label} <span className="text-xs opacity-60">{n}</span>
                </button>
              ))}
          </div>
        )}
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
              Nothing here yet. Build an app with the Assistant, or install one from the market.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {shown.map((app) => (
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
                    <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm">
                      {app.source === "market" ? (
                        <>
                          <Store className="w-2.5 h-2.5" /> From the market
                        </>
                      ) : (
                        <>
                          <Hammer className="w-2.5 h-2.5" /> Built by me
                        </>
                      )}
                    </span>
                  </div>
                </button>
                <div className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{app.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{app.subtitle}</p>
                  </div>
                  {/* Author-only affordances; an installed app is somebody else's code. */}
                  {/* Labelled: a storefront glyph does not say "offer this to people". */}
                  {app.source === "market" && (
                    <button
                      onClick={() => uninstall(app)}
                      disabled={busyId === app.id}
                      title="Remove it and revoke its access to your data"
                      className="flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive disabled:opacity-40"
                    >
                      {busyId === app.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      Uninstall
                    </button>
                  )}
                  {app.source === "built" && (
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
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

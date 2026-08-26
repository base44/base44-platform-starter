/**
 * "My Tools" — every app this user can open, each embedded full-height in an iframe.
 *
 * Two sources, merged in `listUsableApps()`: apps they built (the Base44 folder,
 * filtered against local `AppOwnership` rows) and apps they installed from the market
 * (the listing snapshot, because an installer's principal cannot see another user's
 * app). The frames load without a token — built apps are `public_without_login` — and
 * then ask for one to read data.
 */
import React, { useState, useEffect, useRef } from "react";
import * as platform from "@/lib/base44Platform";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { useAppRebuildNonce, withNonce } from "@/lib/appRefresh";
import { listUsableApps } from "@/lib/usableApps";
import PublishDialog from "@/components/market/PublishDialog";
import { Loader2, ArrowLeft, ExternalLink, Pencil, Store } from "lucide-react";

export default function MyTools() {
  const [apps, setApps] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedApp, setSelectedApp] = useState(null);
  const [publishing, setPublishing] = useState(null);
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

        // Which of these are already in the market, so the card can say so.
        fetch("/api/marketplace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mine" }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) =>
            setPublished(
              new Set((j?.listings ?? []).filter((l) => l.status === "published").map((l) => l.app_id)),
            ),
          )
          .catch(() => {});
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
          <h1 className="font-display text-3xl md:text-4xl text-foreground">My Tools</h1>
          <p className="text-muted-foreground text-sm mt-2">
            Apps you built and apps you installed — click any to open it.
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
              Nothing here yet. Build an app with the Assistant, or install one from the market.
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
                    {app.source === "market" && (
                      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm">
                        <Store className="w-2.5 h-2.5" /> Installed
                      </span>
                    )}
                  </div>
                </button>
                <div className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{app.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{app.subtitle}</p>
                  </div>
                  {/* Publishing and editing are the author's affordances; an installed
                      app is somebody else's code and neither applies to it. */}
                  {/* Labelled, not a bare glyph: "publish this to other people" is not
                      something a storefront icon says on its own, and nobody hovers a
                      button they have not already guessed the meaning of. */}
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

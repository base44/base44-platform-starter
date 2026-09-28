/**
 * Picks a built app to pin as a widget. The pin lives in `addAppToMyWidgets`,
 * shared with the builder so a hand-built app lands there the same way.
 *
 * Rows describe the app rather than the build system: the slug under each name
 * was a generated id (`recent-5-tasks-3072e6d1`) that told the user nothing they
 * could choose on. What they can choose on is the prompt they built it from,
 * which Base44 keeps as `user_description` — and which is the *only* thing
 * separating two apps both called "Weekly Status Report Emailer".
 */
import React, { useMemo, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Plus, Check, Search, Sparkles } from "lucide-react";
import { listUsableApps } from "@/lib/usableApps";
import { addAppToMyWidgets } from "@/lib/myWidgets";

/** Both sources; `listUsableApps()` has already resolved each one's URL. */
function subtitleFor(app) {
  if (app.subtitle) return app.subtitle;
  const stamp = app.app?.last_deployed_at || app.app?.updated_date || app.app?.created_date;
  if (!stamp) return "Not built yet";
  const when = new Date(stamp);
  if (Number.isNaN(when.getTime())) return "Not built yet";
  return `Updated ${formatDistanceToNow(when, { addSuffix: true })}`;
}

export default function AddWidgetModal({
  open,
  onClose,
  existingAppIds = [],
  onAdded,
  onBuildNew,
}) {
  const [apps, setApps] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [adding, setAdding] = useState(null);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("built");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveTab("built");
    setIsLoading(true);
    listUsableApps()
      .then(setApps)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [open]);

  const tabs = useMemo(() => [
    { key: "built", label: "My apps", items: apps.filter((app) => app.source !== "market") },
    { key: "market", label: "Market apps", items: apps.filter((app) => app.source === "market") },
  ], [apps]);

  const selectedApps = tabs.find((tab) => tab.key === activeTab).items;
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return selectedApps;
    return selectedApps.filter((app) =>
      `${app.name || ""} ${app.subtitle || ""}`.toLowerCase().includes(needle),
    );
  }, [selectedApps, query]);

  const selectTab = (key) => {
    setActiveTab(key);
    setQuery("");
  };

  const handleAdd = async (app) => {
    setAdding(app.id);
    try {
      // Market apps carry their URL and no slug; built apps resolve theirs live.
      const widget = await addAppToMyWidgets(app, app.source === "market" ? app.url : null);
      onAdded(widget);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Choose an app to add to your home page.
        </p>

        <div role="tablist" aria-label="App source" className="flex border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`add-widget-tab-${tab.key}`}
              aria-controls="add-widget-panel"
              aria-selected={activeTab === tab.key}
              tabIndex={activeTab === tab.key ? 0 : -1}
              onClick={() => selectTab(tab.key)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const next = tab.key === "built" ? "market" : "built";
                selectTab(next);
                document.getElementById(`add-widget-tab-${next}`)?.focus();
              }}
              className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                activeTab === tab.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label} <span className="ml-1 text-xs text-muted-foreground">{tab.items.length}</span>
            </button>
          ))}
        </div>

        <div id="add-widget-panel" role="tabpanel" aria-labelledby={`add-widget-tab-${activeTab}`} className="space-y-3">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${activeTab === "built" ? "my apps" : "market apps"}…`}
              aria-label={`Search ${activeTab === "built" ? "my apps" : "market apps"}`}
              className="w-full pl-9 pr-3 py-2 min-h-[40px] text-sm rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading apps" />
            </div>
          ) : selectedApps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {activeTab === "built" ? "You haven’t built any apps yet." : "You haven’t installed any market apps yet."}
            </p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No apps match “{query}”.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded border border-border">
              <div className="divide-y divide-border">
                {matches.map((app) => {
                  const already = existingAppIds.includes(app.id);
                  const busy = adding === app.id;
                  const thumb = app.screenshot;
                  return (
                    <button
                      key={app.id}
                      onClick={() => !already && handleAdd(app)}
                      disabled={already || busy}
                      aria-label={
                        already ? `${app.name || "Untitled"} is already on your home page` : undefined
                      }
                      className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[56px] hover:bg-secondary/50 transition-colors disabled:opacity-60 text-left"
                    >
                      {/* 16:10 rather than a square: a screenshot of a widget is wide,
                          and a 36px square crops it into an unreadable smear. */}
                      <div className="w-16 h-10 rounded bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center border border-border">
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-base font-semibold text-muted-foreground">
                            {(app.name || "?")[0].toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {app.name || "Untitled"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{subtitleFor(app)}</p>
                      </div>
                      {already ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                          <Check className="w-3.5 h-3.5" aria-hidden="true" /> Added
                        </span>
                      ) : busy ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Adding…
                        </span>
                      ) : (
                        <Plus
                          className="w-4 h-4 text-muted-foreground flex-shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            onClose();
            onBuildNew?.();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 min-h-[44px] text-sm font-medium text-foreground hover:bg-secondary/50 hover:border-foreground/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          Build an app
        </button>
      </DialogContent>
    </Dialog>
  );
}

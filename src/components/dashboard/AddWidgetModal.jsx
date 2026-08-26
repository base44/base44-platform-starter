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
import Link from "next/link";
import { Loader2, Plus, Check, Search, Sparkles, Store } from "lucide-react";
import { listUsableApps } from "@/lib/usableApps";
import { addAppToMyWidgets } from "@/lib/myWidgets";

/** Above this many apps the list stops being scannable and needs a filter. */
const SEARCH_THRESHOLD = 5;

/**
 * Everything pinnable, from both sources — apps you built and apps you installed from
 * the market. `listUsableApps()` has already resolved each one's URL and subtitle,
 * because a built app is addressed by slug and an installed one only by the snapshot
 * its author published.
 */
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

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIsLoading(true);
    listUsableApps()
      .then(setApps)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return apps;
    return apps.filter((app) =>
      `${app.name || ""} ${app.subtitle || ""}`.toLowerCase().includes(needle),
    );
  }, [apps, query]);

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
        <p className="text-sm text-muted-foreground -mt-2 mb-3">
          Pin an app to the home page — one you built, or one you installed from the market.
        </p>
        {/*
          Two ways to get an app that is not in the list below. Installing from the
          market pins it on the spot — the pin *is* the install — so there is nothing
          to come back here for afterwards.
        */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            onClick={() => {
              onClose();
              onBuildNew?.();
            }}
            className="flex items-center gap-2 px-3 py-2.5 min-h-[44px] border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            Build one
          </button>
          <Link
            href="/Marketplace"
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-2.5 min-h-[44px] border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <Store className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            Browse the market
          </Link>
        </div>

        {apps.length > SEARCH_THRESHOLD && (
          <div className="relative mb-3">
            <Search
              className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your apps…"
              aria-label="Search your apps"
              className="w-full pl-9 pr-3 py-2 min-h-[40px] text-sm rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : apps.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No apps found. Build one using the Assistant first.
          </p>
        ) : matches.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No app matches “{query}”.
          </p>
        ) : (
          <div className="divide-y divide-border max-h-80 overflow-y-auto rounded border border-border">
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
        )}
      </DialogContent>
    </Dialog>
  );
}

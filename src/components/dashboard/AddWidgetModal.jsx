/**
 * Picks one of the user's built Base44 apps to pin to the dashboard as a widget.
 *
 * Resolving a preview URL boots a sandbox, so it is done once here, at pin time,
 * rather than on every dashboard render.
 */
import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Check, Sparkles } from "lucide-react";
import * as platform from "@/lib/base44Platform";
import { Widget } from "@/lib/entityClient";

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

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    platform
      .listAppsForUser({ limit: 50 })
      .then(setApps)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [open]);

  const handleAdd = async (app) => {
    setAdding(app.id);
    try {
      let preview_url = null;
      try {
        const urlData = await platform.getPreviewUrl(app.id);
        if (urlData?.preview_url) {
          preview_url = `https://${urlData.preview_url}/`;
        }
      } catch {}
      const widget = await Widget.create({
        app_id: app.id,
        app_name: app.name || "Untitled",
        app_slug: app.slug || null,
        preview_url,
        preview_screenshot_url: app.preview_screenshot_url || null,
        order_index: Date.now(),
      });
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
          Pick one of your built apps to embed as a widget on the home page.
        </p>
        <button
          onClick={() => {
            onClose();
            onBuildNew?.();
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors mb-3"
        >
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          Build a new app with the Assistant
        </button>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : apps.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No apps found. Build one using the Assistant first.
          </p>
        ) : (
          <div className="divide-y divide-border max-h-80 overflow-y-auto rounded border border-border">
            {apps.map((app) => {
              const already = existingAppIds.includes(app.id);
              return (
                <button
                  key={app.id}
                  onClick={() => !already && handleAdd(app)}
                  disabled={already || adding === app.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/50 transition-colors disabled:opacity-60 text-left"
                >
                  <div className="w-9 h-9 rounded bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
                    {app.preview_screenshot_url || app.logo_url ? (
                      <img
                        src={app.preview_screenshot_url || app.logo_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
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
                    <p className="text-xs text-muted-foreground">{app.slug || "draft"}</p>
                  </div>
                  {already ? (
                    <Check className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  ) : adding === app.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
                  ) : (
                    <Plus className="w-4 h-4 text-muted-foreground flex-shrink-0" />
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

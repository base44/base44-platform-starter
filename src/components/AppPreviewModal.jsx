import React, { useState, useEffect, useRef } from "react";
import { X, AlertTriangle, Loader2 } from "lucide-react";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { useAppRebuildNonce, withNonce } from "@/lib/appRefresh";

/**
 * A built app opened larger, in a centred panel — never a new tab or a route, so
 * it stays inside the shell. Used by the builder and by widget cards.
 *
 * Presentational: callers own how they reach a URL, because they differ. A widget
 * knows its host; the builder polls while the sandbox boots (hence error/onRetry).
 * Runs the viewer-token handshake like every other frame, or the app would load
 * and then fail to read the viewer's data.
 */
function PreviewStage({ label, hint, error, onRetry }) {
  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <AlertTriangle className="w-6 h-6 text-destructive" />
        <p className="text-sm text-foreground max-w-sm">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-background overflow-hidden">
      <div className="p-6 md:p-10 max-w-5xl w-full mx-auto space-y-6 animate-pulse opacity-60">
        <div className="h-7 w-1/3 rounded bg-muted" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded bg-muted" />
          ))}
        </div>
        <div className="h-64 rounded bg-muted" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 pb-10">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border shadow-sm">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          <p className="text-xs font-medium text-foreground">{label}</p>
        </div>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export default function AppPreviewModal({
  open,
  title,
  url,
  appId = null,
  error = null,
  onClose,
  onRetry,
  stageLabel,
  stageHint,
}) {
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef(null);
  const rebuildNonce = useAppRebuildNonce(appId);
  const framedUrl = withNonce(url, rebuildNonce);

  useAppFrameAuth(frameRef, appId, framedUrl);

  useEffect(() => {
    setLoaded(false);
  }, [open, framedUrl]);

  // Reveal even if `onLoad` never fires: a skeleton that never resolves is worse
  // than a frame that errored.
  useEffect(() => {
    if (!open || !framedUrl || loaded) return;
    const t = setTimeout(() => setLoaded(true), 15000);
    return () => clearTimeout(t);
  }, [open, framedUrl, loaded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/50 backdrop-blur-sm p-4 sm:p-8"
      // The backdrop itself, not a press that began inside the panel.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="relative flex flex-col w-full max-w-4xl h-[80vh] max-h-[820px] bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{title || "App Preview"}</p>
            {!loaded && !error && (
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground flex-shrink-0" />
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative flex-1 bg-background">
          {framedUrl && (
            <iframe
              key={rebuildNonce}
              ref={frameRef}
              src={framedUrl}
              onLoad={() => setLoaded(true)}
              className={`absolute inset-0 w-full h-full border-0 transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
              title={title || "App Preview"}
              allow="fullscreen"
            />
          )}
          {(!loaded || error) && (
            <PreviewStage
              label={stageLabel || (framedUrl ? "Loading your tool…" : "Waking up your tool…")}
              hint={framedUrl ? null : stageHint}
              error={error}
              onRetry={onRetry}
            />
          )}
        </div>
      </div>
    </div>
  );
}

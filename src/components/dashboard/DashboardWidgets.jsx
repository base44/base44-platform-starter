/**
 * Renders pinned Base44 apps as resizable dashboard widgets.
 *
 * Each widget is an iframe on the app's preview host — the builder creates apps
 * `public_without_login`, and `prevent_iframe_embedding` is set false at create time
 * so the frame is allowed at all.
 *
 * The frame has no session of its own, so `useAppFrameAuth` answers its token request
 * with one scoped to the current viewer. That is what makes an installed app read the
 * installer's data rather than its author's.
 */
import React, { useState, useRef, useCallback } from "react";
import { Widget } from "@/lib/entityClient";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { X, SquareArrowOutUpRight, Loader2, LayoutGrid, Maximize2, Minimize2 } from "lucide-react";
import * as platform from "@/lib/base44Platform";

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 800;
const DEFAULT_HEIGHT = 320;

function WidgetFrame({ widget, onRemove, onUpdate }) {
  const [loading, setLoading] = useState(true);
  const [height, setHeight] = useState(widget.height || DEFAULT_HEIGHT);
  const [colSpan, setColSpan] = useState(widget.col_span || 1);
  const dragRef = useRef(null);
  const frameRef = useRef(null);
  // Embed the sandbox preview — renders whether or not the app is deployed, no
  // token needed (apps are public_without_login). "Open" link still uses publishedUrl.
  const url = widget.app_slug ? platform.previewUrl(widget.app_slug) : null;
  useAppFrameAuth(frameRef, widget.app_id, url);

  const handleResizeStart = useCallback(
    (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = height;

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientY - startY;
        const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta));
        setHeight(newHeight);
      };

      const onUp = (upEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const finalHeight = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, startHeight + (upEvent.clientY - startY)),
        );
        setHeight(finalHeight);
        onUpdate(widget.id, { height: finalHeight });
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height, widget.id, onUpdate],
  );

  const toggleColSpan = () => {
    const next = colSpan === 1 ? 2 : 1;
    setColSpan(next);
    onUpdate(widget.id, { col_span: next });
  };

  return (
    <div
      className={`bg-card border border-border rounded-lg overflow-hidden flex flex-col${colSpan === 2 ? " sm:col-span-2 xl:col-span-2" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <div className="w-5 h-5 rounded bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
          {widget.preview_screenshot_url ? (
            <img
              src={widget.preview_screenshot_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-[10px] font-semibold text-muted-foreground">
              {(widget.app_name || "?")[0].toUpperCase()}
            </span>
          )}
        </div>
        <p className="text-xs font-medium text-foreground flex-1 truncate">{widget.app_name}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={toggleColSpan}
            title={colSpan === 1 ? "Expand to full width" : "Shrink to half width"}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            {colSpan === 1 ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
          </button>
          {widget.app_id && (
            <a
              href={`/MyTools?app=${widget.app_id}`}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Open in My Tools"
            >
              <SquareArrowOutUpRight className="w-3 h-3" />
            </a>
          )}
          <button
            onClick={() => onRemove(widget.id)}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="relative" style={{ height }}>
        {!url ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-4">
            <p className="text-xs text-muted-foreground">This app hasn't been deployed yet.</p>
            <p className="text-xs text-muted-foreground">
              Deploy it from the Assistant to embed it here.
            </p>
          </div>
        ) : (
          <>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-card">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
            <iframe
              ref={frameRef}
              src={url}
              title={widget.app_name}
              className="w-full h-full border-0"
              onLoad={() => setLoading(false)}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </>
        )}
      </div>

      {/* Resize handle */}
      <div
        ref={dragRef}
        onMouseDown={handleResizeStart}
        className="h-2 flex items-center justify-center cursor-ns-resize bg-transparent hover:bg-border/60 transition-colors group flex-shrink-0"
        title="Drag to resize"
      >
        <div className="w-8 h-0.5 rounded-full bg-border group-hover:bg-muted-foreground transition-colors" />
      </div>
    </div>
  );
}

export default function DashboardWidgets({ widgets, onRemove, onAddClick }) {
  const handleUpdate = async (widgetId, changes) => {
    await Widget.update(widgetId, changes);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-muted-foreground" />
          My Widgets
        </h2>
        <button
          onClick={onAddClick}
          className="text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded hover:border-foreground/30 transition-colors"
        >
          + Add widget
        </button>
      </div>
      {widgets.length === 0 ? (
        <button
          onClick={onAddClick}
          className="w-full border border-dashed border-border rounded-lg py-8 text-center text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          + Add a widget from your built tools
        </button>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-2 gap-4">
          {widgets.map((w) => (
            <WidgetFrame key={w.id} widget={w} onRemove={onRemove} onUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}

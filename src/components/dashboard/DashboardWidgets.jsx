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
 *
 * When that handshake is refused the header says so, since an app denied its token
 * may otherwise fail quietly. Nothing is claimed in the other direction: see
 * `AccessDenied` for why "not reading your data" is not a thing this page knows.
 */
import React, { useState, useRef, useCallback, useEffect } from "react";
import { Widget } from "@/lib/entityClient";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { X, Loader2, LayoutGrid, Maximize, Pencil, PlugZap } from "lucide-react";
import * as platform from "@/lib/base44Platform";
import AppPreviewModal from "@/components/AppPreviewModal";
import { useAppRebuildNonce, withNonce, APP_REBUILT } from "@/lib/appRefresh";
import { clampFrameHeight, useReportedFrameHeight } from "@/lib/appFrameSize";

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 800;
const DEFAULT_HEIGHT = 320;
/**
 * Which widgets the user has sized by hand, so a self-reporting app never
 * overrides a deliberate drag. `Widget.height` is a non-null column with a
 * default, so "the user chose 320" and "nobody ever chose" are the same row —
 * the distinction lives here rather than behind a migration.
 */
const PINNED_KEY = "sunny:widget-height-pinned";

function readPinned() {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(window.localStorage.getItem(PINNED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function pinHeight(widgetId) {
  try {
    const pinned = readPinned();
    pinned.add(widgetId);
    window.localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned]));
  } catch {
    // Private mode, or storage full: auto-sizing stays on. Harmless.
  }
}
/** Horizontal drag needed to flip between half and full width. */
const WIDTH_SNAP_PX = 140;

/**
 * Shown only when the app asked Sunny for a viewer token and Sunny refused —
 * an observed failure, not a guess about what the frame is rendering.
 *
 * There is deliberately no counterpart for "this widget is not reading your
 * data". Whether an app has asked yet is not evidence that it never will: one
 * that fetches on a click, or on a tab switch, has asked nothing at load. And
 * plenty of useful widgets — a calculator, a scratchpad, a chart of something
 * external — read no Sunny data by design and are not mislabelled lightly.
 */
function AccessDenied() {
  return (
    <span
      title="This widget asked for your Sunny data and was refused."
      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 bg-destructive/10 text-destructive"
    >
      <PlugZap className="w-3 h-3" aria-hidden="true" />
      No access
    </span>
  );
}

/**
 * Why there is no frame. These are different failures and the old copy — "This
 * app hasn't been built yet. Build it from the Assistant" — claimed the first
 * for both. An app with a slug *is* built; if there is still no url, the shell
 * has no app host to put it on, and telling the user to rebuild a working app
 * sends them to do work that cannot help. A missing env var after a deploy would
 * otherwise look, to every user at once, like their apps had un-built themselves.
 */
function NoFrame({ reason }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-4">
      {reason === "unbuilt" ? (
        <>
          <p className="text-xs text-muted-foreground">This app hasn't been built yet.</p>
          <p className="text-xs text-muted-foreground">
            Build it from the Assistant to embed it here.
          </p>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">App previews aren't configured here.</p>
          <p className="text-xs text-muted-foreground">
            The app is fine — this Sunny has no <code>NEXT_PUBLIC_BASE44_APP_HOST</code> set.
          </p>
        </>
      )}
    </div>
  );
}

function WidgetFrame({ widget, onRemove, onUpdate, onExpand, deployedAt, metaReady, highlight }) {
  const [loading, setLoading] = useState(true);
  const [height, setHeight] = useState(widget.height || DEFAULT_HEIGHT);
  const [colSpan, setColSpan] = useState(widget.col_span || 1);
  // Also gates the shield below: a drag crossing the iframe would otherwise hand
  // the mouse to the frame and stop the resize dead.
  const [resizing, setResizing] = useState(null);
  // Set only if the app asked for a viewer token and was refused.
  const [authDenied, setAuthDenied] = useState(false);
  const dragRef = useRef(null);
  const frameRef = useRef(null);
  const cardRef = useRef(null);
  const dragHandlersRef = useRef(null);

  // Unmounting mid-drag would leave the listeners bound to window.
  useEffect(() => {
    return () => {
      const h = dragHandlersRef.current;
      if (!h) return;
      window.removeEventListener("mousemove", h.onMove);
      window.removeEventListener("mouseup", h.onUp);
    };
  }, []);
  // Embed the sandbox preview — it renders whether or not the app is deployed and
  // loads without a token (apps are public_without_login); the viewer token is what
  // lets it read data. A widget stays inside the shell: "open larger" is a modal
  // over this same URL, never a tab or a route.
  // Points at the deployed build: served statically, never asleep. The sandbox
  // preview boots on demand and answers with an error payload while it starts —
  // which a frame renders as raw JSON — so it is only the never-deployed fallback.
  // A slug means "addressable by convention", which an installed app is not: it is
  // pinned with no slug and carries its listing's snapshot URL. Deriving a host from an
  // app id here is how you get Base44 answering "App not found" inside the frame.
  const baseUrl = !widget.app_slug
    ? widget.preview_url || null
    : deployedAt
      ? platform.publishedUrl(widget.app_slug)
      : platform.previewUrl(widget.app_slug);
  const rebuildNonce = useAppRebuildNonce(widget.app_id);
  const url = withNonce(baseUrl, rebuildNonce);
  useAppFrameAuth(frameRef, widget.app_id, url, (state) => setAuthDenied(state === "denied"));

  // Grow to fit whatever the app says it needs, unless this widget was sized by
  // hand. Persisted so the height survives a reload instead of snapping back to
  // 320 and then jumping again once the frame boots.
  const reportedHeight = useReportedFrameHeight(frameRef, url);
  useEffect(() => {
    if (reportedHeight === null) return;
    if (readPinned().has(widget.id)) return;
    const next = clampFrameHeight(reportedHeight);
    setHeight((current) => {
      if (current === next) return current;
      onUpdate(widget.id, { height: next });
      return next;
    });
  }, [reportedHeight, widget.id, onUpdate]);

  // Land the eye on a widget that was just added or restored.
  useEffect(() => {
    if (!highlight) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);

  /** Bottom edge is height only, right edge width only, corner both. */
  const handleResizeStart = useCallback(
    (e, axis = "both") => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startHeight = height;
      const startColSpan = colSpan;
      setResizing(axis);

      const resolve = (ev) => ({
        height:
          axis === "x"
            ? startHeight
            : Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + (ev.clientY - startY))),
        // Two grid positions, so width snaps rather than being continuous.
        colSpan:
          axis === "y"
            ? startColSpan
            : ev.clientX - startX > WIDTH_SNAP_PX
              ? 2
              : ev.clientX - startX < -WIDTH_SNAP_PX
                ? 1
                : startColSpan,
      });

      const onMove = (moveEvent) => {
        const next = resolve(moveEvent);
        setHeight(next.height);
        setColSpan(next.colSpan);
      };

      const onUp = (upEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        dragHandlersRef.current = null;
        setResizing(null);
        const next = resolve(upEvent);
        setHeight(next.height);
        setColSpan(next.colSpan);
        if (axis !== "x") pinHeight(widget.id);
        onUpdate(widget.id, { height: next.height, col_span: next.colSpan });
      };

      dragHandlersRef.current = { onMove, onUp };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height, colSpan, widget.id, onUpdate],
  );

  return (
    <div
      ref={cardRef}
      // `self-start`: a grid item stretches to the tallest card in its row by
      // default, which pads the card below the frame with dead space and leaves
      // the resize grip sitting on that padding rather than on the widget's own
      // edge — the drag then looks like it resizes the app but not the box.
      className={`relative self-start bg-card border rounded-lg overflow-hidden flex flex-col transition-colors duration-500${
        colSpan === 2 ? " sm:col-span-2 xl:col-span-2" : ""
      } ${highlight ? "border-primary ring-2 ring-primary/40" : "border-border"}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-shrink-0">
        <p className="text-xs font-medium text-foreground truncate">{widget.app_name}</p>
        {authDenied && <AccessDenied />}
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-auto">
          {widget.app_id && (
            <button
              // An event, not a link: the panel opens over the dashboard.
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("open-assistant", {
                    detail: { mode: "build", appId: widget.app_id },
                  }),
                )
              }
              title="Edit with the Assistant"
              aria-label={`Edit ${widget.app_name} with the Assistant`}
              className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {url && (
            <button
              onClick={() => onExpand({ title: widget.app_name, url, appId: widget.app_id })}
              title="Open in a bigger view"
              aria-label={`Open ${widget.app_name} in a bigger view`}
              className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Maximize className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            onClick={() => onRemove(widget.id)}
            aria-label={`Remove ${widget.app_name} from My Widgets`}
            className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="relative flex-shrink-0" style={{ height }}>
        {/* Waiting on deploy state: mounting now would load one url then the other. */}
        {!metaReady ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : !url ? (
          <NoFrame reason={widget.app_slug ? "unconfigured" : "unbuilt"} />
        ) : (
          <>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-card">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
            <iframe
              key={rebuildNonce}
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

      {/* Above the frame, or the embedded app owns the card's last few pixels. */}
      <div
        ref={dragRef}
        onMouseDown={(e) => handleResizeStart(e, "y")}
        title="Drag to change height"
        className="absolute left-0 right-3 bottom-0 h-2 z-10 cursor-ns-resize hover:bg-primary/30 transition-colors"
      />
      <div
        onMouseDown={(e) => handleResizeStart(e, "x")}
        title="Drag to change width"
        className="absolute top-0 bottom-3 right-0 w-2 z-10 cursor-ew-resize hover:bg-primary/30 transition-colors"
      />
      <div
        onMouseDown={(e) => handleResizeStart(e, "both")}
        title="Drag to resize"
        aria-label="Drag to resize this widget"
        role="button"
        className="absolute right-0 bottom-0 w-4 h-4 z-20 cursor-nwse-resize flex items-end justify-end p-0.5 text-muted-foreground hover:text-foreground"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
          <path
            d="M8 1 1 8M8 5 5 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </div>

      {/* Keeps the pointer out of the iframe while dragging. */}
      {resizing && (
        <div
          className={`absolute inset-0 z-30 ${
            resizing === "y"
              ? "cursor-ns-resize"
              : resizing === "x"
                ? "cursor-ew-resize"
                : "cursor-nwse-resize"
          }`}
        />
      )}
    </div>
  );
}

export default function DashboardWidgets({
  widgets,
  onRemove,
  onAddClick,
  highlightId,
  onHighlightDone,
}) {
  // One modal for the list rather than one per card: only ever one is open.
  const [expanded, setExpanded] = useState(null);
  // app id -> last_deployed_at, one list call for every card. Null = not yet known.
  const [appMeta, setAppMeta] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      platform
        .listAppsForUser({ limit: 50 })
        .then((apps) => {
          if (cancelled) return;
          const map = {};
          for (const a of apps || []) map[a.id] = a.last_deployed_at ?? null;
          setAppMeta(map);
        })
        // Never spin forever: an empty map falls back to the sandbox preview.
        .catch(() => {
          if (!cancelled) setAppMeta({});
        });

    load();
    // A deploy flips an app from sandbox-only to deployed, so re-read.
    const onRebuilt = () => load();
    window.addEventListener(APP_REBUILT, onRebuilt);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_REBUILT, onRebuilt);
    };
  }, []);

  // The ring is a pointer, not a state: drop it once it has done its job.
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => onHighlightDone?.(), 2500);
    return () => clearTimeout(timer);
  }, [highlightId, onHighlightDone]);

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
          className="text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 min-h-[36px] rounded hover:border-foreground/30 transition-colors"
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
            <WidgetFrame
              key={w.id}
              widget={w}
              onRemove={onRemove}
              onUpdate={handleUpdate}
              onExpand={setExpanded}
              deployedAt={appMeta ? (appMeta[w.app_id] ?? null) : null}
              metaReady={appMeta !== null}
              highlight={w.id === highlightId}
            />
          ))}
        </div>
      )}

      <AppPreviewModal
        open={Boolean(expanded)}
        title={expanded?.title}
        url={expanded?.url}
        appId={expanded?.appId}
        onClose={() => setExpanded(null)}
      />
    </div>
  );
}

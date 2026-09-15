"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, getPreviewUrl } from "../lib/chat/builder-api";
import type { App } from "../lib/types";

export default function PreviewFrame({ app, live = false, title }: { app: App; live?: boolean; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    let activeUrl = "";
    let pending = false;
    let recoveryAttempts = 0;
    let blocked = false;
    const timeout = loadTimeout.current = setTimeout(() => {
      if (!cancelled) setError("Live preview is taking longer than expected. You can retry.");
    }, 130_000);
    async function connect(recovering = false) {
      if (pending || blocked || cancelled) return;
      if (recovering && recoveryAttempts >= 3) {
        setError("Live preview could not recover. Try refreshing.");
        return;
      }
      pending = true;
      if (recovering) recoveryAttempts++;
      try {
        const result = await getPreviewUrl(app.id);
        if (cancelled) return;
        const next = new URL(result.url);
        if (activeUrl) {
          const previous = new URL(activeUrl);
          next.pathname = previous.pathname;
          next.hash = previous.hash;
          previous.searchParams.forEach((value, key) => {
            if (key !== "_preview_token" && key !== "server_url" && !next.searchParams.has(key))
              next.searchParams.set(key, value);
          });
        }
        activeUrl = next.href;
        setUrl(activeUrl);
        setError("");
      } catch (err) {
        if (cancelled) return;
        blocked = err instanceof ApiError && (err.status === 401 || err.status === 403);
        setError(err instanceof Error ? err.message : "Live preview unavailable.");
        if (recovering && !blocked && recoveryAttempts < 3)
          retryTimer = setTimeout(() => { void connect(true); }, 1000 * 2 ** recoveryAttempts);
      } finally {
        pending = false;
      }
    }
    function recover(event: MessageEvent) {
      if (!activeUrl || event.source !== frame.current?.contentWindow ||
        event.origin !== new URL(activeUrl).origin || event.data?.type !== "preview:requestRefresh") return;
      clearTimeout(retryTimer);
      void connect(true);
    }
    window.addEventListener("message", recover);
    void connect();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      clearTimeout(retryTimer);
      window.removeEventListener("message", recover);
    };
  }, [app.id, live, attempt]);
  const retry = () => { setUrl(""); setLoaded(false); setError(""); setAttempt(value => value + 1); };
  const frameProps = { referrerPolicy: "no-referrer" as const, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups" };
  return <div className="preview-frame">
    {!loaded && (app.static_preview_url ? <iframe key={`static-${attempt}`} title={title} src={app.static_preview_url} loading="lazy" {...frameProps} />
      : app.preview_screenshot_url ? <img className="preview-fallback" src={app.preview_screenshot_url} alt={`${app.name || "App"} screenshot`} />
      : <div className="widget-placeholder">No built preview is available yet. Open the assistant to build this app.</div>)}
    {url && <iframe ref={frame} title={loaded ? title : `${title} (starting live)`} src={url} className={loaded ? "" : "preview-loading-frame"} aria-hidden={!loaded} tabIndex={loaded ? 0 : -1} {...frameProps}
      onLoad={() => { clearTimeout(loadTimeout.current); setLoaded(true); setError(""); }} onError={() => setError("Live preview could not load. Try refreshing.")} />}
    <div className="preview-controls">
      {error ? <span role="alert">{error}</span> : live && !loaded ? <span role="status">Starting live preview…</span> : <span>{live ? "Live preview" : "Last available build"}</span>}
      <button className="secondary" onClick={retry}>Refresh preview</button>
    </div>
  </div>;
}

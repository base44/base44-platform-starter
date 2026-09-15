"use client";

import { useEffect, useRef, useState } from "react";
import { getPreviewUrl } from "../lib/chat/builder-api";
import type { App } from "../lib/types";

export default function PreviewFrame({ app, live = false, title }: { app: App; live?: boolean; title: string }) {
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [url, setUrl] = useState("");
  const [expired, setExpired] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let expiry: ReturnType<typeof setTimeout>;
    const timeout = loadTimeout.current = setTimeout(() => {
      if (!cancelled) setError("Live preview is taking longer than expected. You can retry.");
    }, 130_000);
    void getPreviewUrl(app.id).then(result => {
      if (cancelled) return;
      setUrl(result.url);
      expiry = setTimeout(() => {
        setUrl("");
        setLoaded(false);
        setExpired(true);
        setError("Live preview expired. Refresh to continue.");
      }, 240_000);
    }).catch(err => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Live preview unavailable.");
    });
    return () => { cancelled = true; clearTimeout(timeout); clearTimeout(expiry); };
  }, [app.id, live, attempt]);
  const retry = () => { setExpired(false); setUrl(""); setLoaded(false); setError(""); setAttempt(value => value + 1); };
  const frameProps = { referrerPolicy: "no-referrer" as const, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups" };
  return <div className="preview-frame">
    {expired && <div className="widget-placeholder">Refresh the live preview to continue editing.</div>}
    {!loaded && !expired && (app.static_preview_url ? <iframe key={`static-${attempt}`} title={title} src={app.static_preview_url} loading="lazy" {...frameProps} />
      : app.preview_screenshot_url ? <img className="preview-fallback" src={app.preview_screenshot_url} alt={`${app.name || "App"} screenshot`} />
      : <div className="widget-placeholder">No built preview is available yet. Open the assistant to build this app.</div>)}
    {url && <iframe title={loaded ? title : `${title} (starting live)`} src={url} className={loaded ? "" : "preview-loading-frame"} aria-hidden={!loaded} tabIndex={loaded ? 0 : -1} {...frameProps}
      onLoad={() => { clearTimeout(loadTimeout.current); setLoaded(true); setError(""); }} onError={() => setError("Live preview could not load. Try refreshing.")} />}
    <div className="preview-controls">
      {error ? <span role="alert">{error}</span> : live && !loaded ? <span role="status">Starting live preview…</span> : <span>{live ? "Live preview" : "Last available build"}</span>}
      <button className="secondary" onClick={retry}>Refresh preview</button>
    </div>
  </div>;
}

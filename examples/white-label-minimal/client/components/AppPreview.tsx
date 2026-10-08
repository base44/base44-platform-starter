"use client";
import { useEffect, useState } from "react";
import * as actions from "../../server/actions";
import type { App } from "../../types";
import { unwrap } from "../unwrap";

const frameProps = {
  referrerPolicy: "no-referrer",
  sandbox: "allow-scripts allow-same-origin allow-forms allow-popups",
} as const;

// An app shown inside Tiny, signed in as the builder ("Embed the app").
// It shows the latest build. While editing (live), the running sandbox loads
// behind it and takes over once loaded. Each URL works once, so every load and
// every refresh asks the server for a new one.
export default function AppPreview({ app, title, live = false, showControls = true }: {
  app: App;
  title: string;
  live?: boolean;
  showControls?: boolean;
}) {
  const building = app.status?.state === "processing";
  const [latestUrl, setLatestUrl] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  // The latest build. It needs no sandbox; before the first build there is none.
  useEffect(() => {
    if (building) return;
    let current = true;
    unwrap(actions.getLatestBuildUrl(app.id)).then(
      (result) => current && setLatestUrl(result.url),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [app.id, building, attempt]);

  // The live sandbox, only while editing.
  useEffect(() => {
    if (!live) return;
    let current = true;
    unwrap(actions.getPreviewUrl(app.id)).then(
      (result) => current && setLiveUrl(result.url),
      (err) => current && setError(err.message),
    );
    return () => {
      current = false;
    };
  }, [app.id, live, attempt]);

  function refresh() {
    setLiveUrl(null);
    setLiveLoaded(false);
    setError("");
    setAttempt((n) => n + 1);
  }

  let underneath;
  if (latestUrl) {
    underneath = <iframe key={latestUrl} title={title} src={latestUrl} {...frameProps} />;
  } else if (app.preview_screenshot_url) {
    underneath = <img className="preview-fallback" src={app.preview_screenshot_url} alt={`${title} screenshot`} />;
  } else if (live && !error) {
    underneath = <div className="widget-placeholder" role="status">Starting your preview…</div>;
  } else {
    underneath = <div className="widget-placeholder">No built preview is available yet. Open the assistant to build this app.</div>;
  }

  let status = live ? "Starting live preview…" : "Last available build";
  if (liveLoaded) status = "Live preview";

  return (
    <div className="preview-frame">
      {!liveLoaded && underneath}
      {liveUrl && (
        <iframe
          title={liveLoaded ? title : `${title} (starting live)`}
          src={liveUrl}
          className={liveLoaded ? "" : "preview-loading-frame"}
          aria-hidden={!liveLoaded}
          tabIndex={liveLoaded ? 0 : -1}
          onLoad={() => setLiveLoaded(true)}
          {...frameProps}
        />
      )}
      {showControls && (
        <div className="preview-controls">
          {error ? <span role="alert">{error}</span> : <span>{status}</span>}
          <button className="secondary" onClick={refresh}>Refresh preview</button>
        </div>
      )}
    </div>
  );
}

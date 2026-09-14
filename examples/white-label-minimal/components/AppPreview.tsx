"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getPreviewUrl } from "../lib/builder-api";
import type { App } from "../lib/types";

export default function AppPreview({ app, onClose }: { app: App; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { dialog.current?.showModal(); }, []);

  useEffect(() => {
    let cancelled = false;
    setUrl("");
    setError("");
    // Fetch on open: preview URLs contain short-lived tokens; never persist them.
    void getPreviewUrl(app.id).then(
      ({ url }) => { if (!cancelled) setUrl(url); },
      (err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Preview failed."); },
    );
    return () => { cancelled = true; };
  }, [app.id, attempt]);

  useEffect(() => {
    if (!url) return;
    // Remove the credential before its five-minute expiry, just like the builder did.
    const timer = setTimeout(() => {
      setUrl("");
      setError("Preview expired. Open a fresh preview to continue.");
    }, 240_000);
    return () => clearTimeout(timer);
  }, [url]);


  return (
    <dialog ref={dialog} className="app-preview" aria-labelledby="preview-title" onClose={onClose}>
      <header>
        <h2 id="preview-title">{app.name || "Untitled"}</h2>
        <div className="actions">
          <button className="secondary" disabled={!url && !error} onClick={() => setAttempt(attempt + 1)}>Refresh preview</button>
          <button className="icon-button" aria-label="Close app preview" onClick={() => dialog.current?.close()}>
            <X size={20} />
          </button>
        </div>
      </header>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button className="secondary" onClick={() => setAttempt(attempt + 1)}>Try again</button>
        </div>
      ) : url ? (
        <iframe
          title={`${app.name || "Untitled"} preview`}
          src={url}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : <p role="status">Starting preview…</p>}
    </dialog>
  );
}

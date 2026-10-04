"use client";
import { useState } from "react";
import { ArrowRight, Check, ExternalLink } from "lucide-react";
import * as actions from "../app/actions";
import { unwrap } from "../lib/chat/unwrap";

// Shown when a build is done. Step 6 of the build turn: deploy the app, then
// read back its address to link to.
export default function ReadyCard({ appId, name, onGoHome }: {
  appId: string;
  name?: string;
  onGoHome?: () => void;
}) {
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  async function publish() {
    setPublishing(true);
    setError("");
    try {
      await unwrap(actions.deployApp(appId));
      const { url } = await unwrap(actions.getPublishedUrl(appId));
      setPublishedUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish the app.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="delivery" aria-label="App ready">
      <p className="ready-badge">
        <Check size={13} aria-hidden="true" /> Ready
      </p>
      <strong>{name || "Your app"}</strong>
      {publishedUrl ? (
        <a className="button" href={publishedUrl} target="_blank" rel="noopener noreferrer">
          Open the published app <ExternalLink size={14} />
        </a>
      ) : (
        <button disabled={publishing} onClick={publish}>{publishing ? "Publishing…" : "Publish"}</button>
      )}
      {error && <p role="alert">{error}</p>}
      {onGoHome && (
        <button onClick={onGoHome}>
          See it in the home page <ArrowRight size={14} />
        </button>
      )}
    </section>
  );
}

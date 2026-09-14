"use client";
import type { App, ToolInput } from "../lib/types";
import { useEffect, useRef, useState } from "react";
import * as api from "../lib/builder-api";
import { Loader2, Eye, Upload, ExternalLink } from "lucide-react";
import BuilderChat from "./BuilderChat";
import { useBuildPolling } from "./useBuildPolling";

export default function Builder({
  initialAppId,
  onCreated,
  onUpdated,
}: {
  initialAppId?: string;
  onCreated?: (app: App) => void;
  onUpdated?: (app: App) => void;
}) {
  const [appId, setAppId] = useState<string | null>(initialAppId || null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [resumeId, setResumeId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const lock = useRef(false);
  const previewVersion = useRef(0);
  const { app, messages, error: pollingError, refresh, resume } = useBuildPolling(appId);
  useEffect(() => { if (app) onUpdated?.(app); }, [app, onUpdated]);
  const waiting = messages.some((m) =>
    m.tool_calls?.some((t) => t.status === "waiting_for_user_input"),
  );
  const processing = app?.status?.state === "processing";

  useEffect(() => {
    if (!preview) return;
    // Tokens last five minutes. Drop the credential before expiry, not into storage.
    const timer = setTimeout(() => setPreview(null), 240_000);
    return () => clearTimeout(timer);
  }, [preview]);

  async function send(prompt: string) {
    if (lock.current || !prompt.trim() || waiting || processing || pollingError || creationUncertain) return false;
    lock.current = true;
    setBusy(appId ? "Sending prompt…" : "Creating app…");
    setError("");
    try {
      if (appId) {
        await api.sendMessage(appId, prompt);
        await refresh();
      } else {
        const created = await api.createApp(prompt);
        setAppId(created.id);
        onCreated?.(created);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      if (!appId) setCreationUncertain(!(err instanceof api.ApiError && err.notStarted));
      else await refresh();
      return false;
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function answer(input: ToolInput) {
    if (lock.current) throw new Error("Another action is still running.");
    lock.current = true;
    setBusy("Answering question…");
    try {
      await api.submitToolCallInput(input);
    } finally {
      await refresh();
      lock.current = false;
      setBusy("");
    }
  }
  async function openPreview() {
    if (!appId || lock.current) return;
    const version = ++previewVersion.current;
    lock.current = true;
    setBusy("Starting preview…");
    setError("");
    setPreview(null);
    try {
      const result = await api.getPreviewUrl(appId);
      if (version === previewVersion.current) setPreview(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function publishedLink() {
    if (!appId) return;
    const result = await api.getPublishedUrl(appId);
    setPublished(result.url);
    if (!result.url) setError("No published URL is available yet.");
  }
  async function deploy() {
    if (!appId || lock.current) return;
    lock.current = true;
    setBusy("Deploying…");
    setError("");
    try {
      await api.deployApp(appId);
      await publishedLink();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed.");
      // Deployment is synchronous, but a disconnected response is inconclusive.
      try {
        await publishedLink();
      } catch {
        /* Keep the original operation error. */
      }
    } finally {
      await refresh();
      lock.current = false;
      setBusy("");
    }
  }
  return (
    <div className="builder">
      {app?.status?.state === "error" && (
        <p role="alert">
          The build failed{app.status.error_source ? ` (${app.status.error_source})` : ""}. Review
          the conversation and send a follow-up prompt.
        </p>
      )}
      {(error || pollingError) && (
        <aside role="alert">
          <p>{error || pollingError}</p>
          {appId && (
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => {
                setError("");
                resume();
              }}
            >
              Resume polling
            </button>
          )}
        </aside>
      )}
      {!appId && creationUncertain && (
        <details open={creationUncertain}>
          <summary>Resume an existing app</summary>
          {creationUncertain && (
            <p>
              Creation may have succeeded. Check your Base44 workspace before creating another app.
            </p>
          )}
          <label>
            Existing app ID
            <input value={resumeId} onChange={(e) => setResumeId(e.target.value)} />
          </label>
          <div className="actions">
            <button
              disabled={!/^[A-Za-z0-9_-]{1,200}$/.test(resumeId)}
              onClick={() => {
                setAppId(resumeId);
                setCreationUncertain(false);
                setError("");
              }}
            >
              Resume this app
            </button>
            {creationUncertain && (
              <button
                className="secondary"
                onClick={() => {
                  setCreationUncertain(false);
                  setError("");
                }}
              >
                I checked — allow a new creation
              </button>
            )}
          </div>
        </details>
      )}
      <BuilderChat
        key={appId || 'new'}
        appId={appId}
        messages={messages}
        busy={!!busy}
        processing={processing}
        waiting={waiting}
        disabled={!!busy || waiting || processing || !!pollingError || creationUncertain}
        questionsDisabled={!!busy || !!pollingError}
        onSend={send}
        onAnswer={answer}
      >
      {appId && (
        <section className="delivery" aria-label="Preview and publish">
          <div className="ready-heading"><strong>{app?.name || "Your app"}</strong></div>
          <div className="actions">
            <button className="secondary" aria-label={preview ? "Refresh preview" : "Open preview"} disabled={!!busy} onClick={() => void openPreview()}>
              <Eye size={14} /> {preview ? "Refresh preview" : "Preview"}
            </button>
            <button
              disabled={!!busy || waiting || !!pollingError || app?.status?.state !== "ready"}
              aria-label="Deploy app" onClick={() => void deploy()}
            >
              <Upload size={14} /> Publish
            </button>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                void publishedLink().catch(() => setError("Could not read the published URL."))
              }
            >
              <ExternalLink size={13} /> Check published URL
            </button>
            {published && (
              <a href={published} target="_blank" rel="noreferrer">
                Open published app ↗
              </a>
            )}
          </div>

          {preview && (
            <>
              <button
                className="secondary"
                onClick={() => {
                  previewVersion.current++;
                  setPreview(null);
                }}
              >
                Close preview
              </button>
              <iframe
                title="Generated app preview"
                src={preview}
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </>
          )}
        </section>
      )}
        {(busy || waiting || processing || pollingError) && <div className="build-progress" role="status">
          {(busy || processing) && <Loader2 size={12} className="spin" />}
          {busy || (pollingError ? "Connection paused" : waiting ? "Waiting for your answer" : "Building…")}
        </div>}
      </BuilderChat>

    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import * as api from "../lib/base44-client";
import Question from "./Question";
import { useBuildPolling } from "./useBuildPolling";

export default function Builder({
  initialAppId,
  onCreated,
}: {
  initialAppId?: string;
  onCreated?: (app: api.App) => void;
}) {
  const [appId, setAppId] = useState<string | null>(initialAppId || null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [resumeId, setResumeId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const lock = useRef(false);
  const previewVersion = useRef(0);
  const { app, messages, error: pollingError, refresh, resume } = useBuildPolling(appId);
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

  async function send() {
    if (lock.current || !prompt.trim() || waiting || creationUncertain) return;
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
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      if (!appId) setCreationUncertain(!(err instanceof api.ApiError && err.notStarted));
      else await refresh();
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function answer(input: api.ToolInput) {
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
      <div className="status" role="status">
        {busy ||
          (pollingError
            ? "Polling paused"
            : waiting
              ? "Waiting for your answer"
              : app?.status?.state || "Ready to begin")}
      </div>
      {appId && (
        <p>
          <small>
            App ID: <code>{appId}</code>
          </small>
        </p>
      )}
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
      {!appId && (
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
                setPrompt("");
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
      <section aria-label="Conversation" className="conversation">
        {!messages.length && <p className="empty">Your build conversation will appear here.</p>}
        {messages
          .filter((m) => !m.hidden)
          .map((m) => (
            <article key={m.id}>
              <small className="role">{m.role || "Agent"}</small>
              {m.content && <p className="message">{m.content}</p>}
              {m.tool_calls?.map((tool, index) => (
                <Question
                  key={`${tool.id || index}:${tool.status}`}
                  tool={tool}
                  messageId={m.id}
                  appId={appId!}
                  disabled={!!busy || !!pollingError}
                  onSubmit={answer}
                />
              ))}
            </article>
          ))}
      </section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="prompt">
          {appId ? "What should change?" : "What would you like to build?"}
        </label>
        <textarea
          id="prompt"
          rows={3}
          maxLength={16000}
          value={prompt}
          placeholder="A reading list with ratings and a search field"
          disabled={!!busy || waiting || processing || !!pollingError || creationUncertain}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          disabled={
            !!busy || waiting || processing || !!pollingError || creationUncertain || !prompt.trim()
          }
        >
          {appId ? "Send prompt" : "Create app"}
        </button>
        {waiting && <small>Answer or reject the waiting question to continue.</small>}
      </form>
      {appId && (
        <section className="delivery" aria-label="Preview and publish">
          <div className="actions">
            <button className="secondary" disabled={!!busy} onClick={() => void openPreview()}>
              {preview ? "Refresh preview" : "Open preview"}
            </button>
            <button
              disabled={!!busy || waiting || !!pollingError || app?.status?.state !== "ready"}
              onClick={() => void deploy()}
            >
              Deploy app
            </button>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                void publishedLink().catch(() => setError("Could not read the published URL."))
              }
            >
              Check published URL
            </button>
            {published && (
              <a href={published} target="_blank" rel="noreferrer">
                Open published app ↗
              </a>
            )}
          </div>
          <small>Deploy publishes the current version immediately.</small>
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
    </div>
  );
}

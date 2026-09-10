"use client";
import { useEffect, useRef, useState } from "react";
import * as api from "../lib/base44-client";
import Question from "./Question";
import ReactMarkdown from "react-markdown";
import { Bot, User, Hammer, Send, Loader2, Eye, Upload, ExternalLink } from "lucide-react";
import ToolActivity from "./ToolActivity";
import { useBuildPolling } from "./useBuildPolling";

export default function Builder({
  initialAppId,
  onCreated,
  onUpdated,
}: {
  initialAppId?: string;
  onCreated?: (app: api.App) => void;
  onUpdated?: (app: api.App) => void;
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
  const conversationRef = useRef<HTMLElement>(null);
  const followConversation = useRef(true);
  useEffect(() => { if (app) onUpdated?.(app); }, [app, onUpdated]);
  useEffect(() => {
    const element = conversationRef.current;
    if (element && followConversation.current) element.scrollTop = element.scrollHeight;
  }, [messages]);
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
      <section aria-label="Conversation" className="conversation" ref={conversationRef} onScroll={e => {
        const node = e.currentTarget;
        followConversation.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}>
        {!messages.length && (appId ? <p className="empty">Your build conversation will appear here.</p> : <div className="chat-welcome">
          <Hammer size={32} strokeWidth={1.5} />
          <h2>Build an app</h2>
          <p>Describe what you want and I’ll create it.</p>
          <div className="chat-suggestions">
            {["A reading list with ratings", "A habit tracker for my daily routine", "A place to save my favorite recipes"].map(idea => <button className="secondary" key={idea} onClick={() => setPrompt(idea)}>{idea}</button>)}
          </div>
        </div>)}
        {messages
          .filter((m) => !m.hidden)
          .map((m) => (
            <article key={m.id} className={`chat-message ${m.role === "user" ? "from-user" : "from-assistant"}`}>
              <span className="message-avatar" aria-label={m.role === "user" ? "You" : "Assistant"}>{m.role === "user" ? <User size={14} /> : <Bot size={14} />}</span>
              <div className="message-body">
              {m.content && <div className="message-bubble">{m.role === "user" ? <p>{m.content}</p> : <ReactMarkdown>{m.content}</ReactMarkdown>}</div>}
              {m.tool_calls?.map((tool, index) => (
                tool.status === "waiting_for_user_input" || tool.waiting_on?.kind ? <Question
                  key={`${tool.id || index}:${tool.status}`}
                  tool={tool}
                  messageId={m.id}
                  appId={appId!}
                  disabled={!!busy || !!pollingError}
                  onSubmit={answer}
                /> : <ToolActivity key={tool.id || index} tool={tool} />
              ))}
              </div>
            </article>
          ))}
      {appId && (
        <section className="delivery" aria-label="Preview and publish">
          <div className="ready-heading"><strong>{app?.name || "Your app"}</strong><p>{app?.status?.state === "ready" ? "Ready for a look?" : "Preview your progress"}</p></div>
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
      </section>
      <form className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="prompt">
          {appId ? "What should change?" : "What would you like to build?"}
        </label>
        <textarea
          id="prompt"
          rows={1}
          maxLength={16000}
          value={prompt}
          placeholder={waiting ? "Answer the question above…" : appId ? "Describe a change…" : "Describe the app you want…"}
          disabled={!!busy || waiting || processing || !!pollingError || creationUncertain}
          onChange={(e) => {
            setPrompt(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`;
          }}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !busy && !processing && !pollingError) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="send-button" aria-label={appId ? "Send prompt" : "Create app"}
          disabled={
            !!busy || waiting || processing || !!pollingError || creationUncertain || !prompt.trim()
          }
        >
          {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        </button>
        {waiting && <small>Answer or reject the waiting question to continue.</small>}
      </form>

    </div>
  );
}

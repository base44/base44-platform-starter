"use client";
import { hasCompletedBuild } from "../lib/chat/build-readiness";
import type { App, ToolInput } from "../lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../lib/chat/builder-api";
import { Loader2 } from "lucide-react";
import { mergeOptimisticMessages, type OptimisticMessage } from "../lib/chat/optimistic-messages";
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
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const lock = useRef(false);
  const { app, messages, error: pollingError, loading, refresh, resume } = useBuildPolling(appId);
  const displayedMessages = useMemo(
    () => mergeOptimisticMessages(messages, optimistic), [messages, optimistic],
  );
  useEffect(() => {
    if (app) onUpdated?.(app);
  }, [app, onUpdated]);
  const waiting = messages.some((m) =>
    m.tool_calls?.some((t) => t.status === "waiting_for_user_input"),
  );
  const processing = app?.status?.state === "processing";
  // A prompt/answer invalidates the previous ready state before polling catches up.
  // Preview and deploy operations themselves should keep the card mounted.
  const submittingBuild = busy === "Sending prompt…" || busy === "Answering question…";
  const canDeliver = app?.id === appId && app?.status?.state === "ready" &&
    !waiting && !pollingError && !submittingBuild && hasCompletedBuild(messages);

  async function send(prompt: string) {
    if (
      lock.current ||
      loading ||
      !prompt.trim() ||
      waiting ||
      processing ||
      pollingError ||
      creationUncertain
    )
      return false;
    lock.current = true;
    const optimisticId = `local:${crypto.randomUUID()}`;
    setOptimistic((current) => [...current, {
      message: { id: optimisticId, role: "user", content: prompt },
      knownIds: messages.map((message) => message.id),
    }]);
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
      setOptimistic((current) => current.filter(({ message }) => message.id !== optimisticId));
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
        <details open>
          <summary>Resume an existing app</summary>
          <p>
            Creation may have succeeded. Check your Base44 workspace before creating another app.
            Only apps already saved to your account can be resumed here.
          </p>
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
            <button
              className="secondary"
              onClick={() => {
                setCreationUncertain(false);
                setError("");
              }}
            >
              I checked — allow a new creation
            </button>
          </div>
        </details>
      )}
      <BuilderChat
        appId={appId}
        messages={displayedMessages}
        loading={loading}
        busy={!!busy}
        processing={processing}
        waiting={waiting}
        disabled={loading || !!busy || waiting || processing || !!pollingError || creationUncertain}
        questionsDisabled={!!busy || !!pollingError}
        onSend={send}
        onAnswer={answer}
      >
        {canDeliver && (
          <section className="delivery" aria-label="App ready">
            <strong>{app?.name || "Your app"}</strong>
            <p>Ready — see it in the home page.</p>
          </section>
        )}
        {(busy || waiting || processing || pollingError) && (
          <div className="build-progress" role="status">
            {(busy || processing) && <Loader2 size={12} className="spin" />}
            {busy ||
              (pollingError
                ? "Connection paused"
                : waiting
                  ? "Waiting for your answer"
                  : "Building…")}
          </div>
        )}
      </BuilderChat>
    </div>
  );
}

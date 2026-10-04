"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import * as api from "../lib/chat/builder-api";
import { hasCompletedBuild } from "../lib/chat/build-readiness";
import { mergeOptimisticMessages, type OptimisticMessage } from "../lib/chat/optimistic-messages";
import type { App, ToolInput } from "../lib/types";
import BuilderChat from "./BuilderChat";
import ReadyCard from "./ReadyCard";
import { useLiveUpdates } from "./useLiveUpdates";

const busyLabels = { create: "Creating app…", send: "Sending prompt…", answer: "Answering question…" };
type Busy = keyof typeof busyLabels | null;

// One build turn: create the app or send a prompt, watch it build, answer the
// agent's questions, and offer to publish when it is ready.
export default function Builder({ initialAppId, onCreated, onUpdated, onGoHome }: {
  initialAppId?: string;
  onCreated?: (app: App) => void;
  onUpdated?: (app: App) => void;
  onGoHome?: () => void;
}) {
  const [appId, setAppId] = useState<string | null>(initialAppId || null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  // The builder's prompt, shown until Base44 sends it back.
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const lock = useRef(false);
  const { app, messages, error: liveError, loading, refresh, reconnect } = useLiveUpdates(appId);
  const displayedMessages = useMemo(() => mergeOptimisticMessages(messages, optimistic), [messages, optimistic]);
  useEffect(() => {
    if (app) onUpdated?.(app);
  }, [app, onUpdated]);

  const waiting = messages.some((m) => m.tool_calls?.some((t) => t.status === "waiting_for_user_input"));
  const processing = app?.status?.state === "processing";
  // Base44 ignores new prompts while a question is open or a build runs.
  const composerDisabled = loading || !!busy || waiting || processing || !!liveError;
  const ready = app?.id === appId && app?.status?.state === "ready" &&
    !busy && !waiting && !liveError && hasCompletedBuild(messages);

  async function send(prompt: string) {
    if (lock.current || composerDisabled || !prompt.trim()) return false;
    lock.current = true;
    const optimisticId = `local:${crypto.randomUUID()}`;
    setOptimistic((current) => [...current, {
      message: { id: optimisticId, role: "user", content: prompt },
      knownIds: messages.map((message) => message.id),
    }]);
    setBusy(appId ? "send" : "create");
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
      if (appId) await refresh();
      return false;
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  async function answer(input: ToolInput) {
    if (lock.current) throw new Error("Another action is still running.");
    lock.current = true;
    setBusy("answer");
    try {
      await api.submitToolCallInput(input);
    } finally {
      await refresh();
      lock.current = false;
      setBusy(null);
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
      {(error || liveError) && (
        <aside role="alert">
          <p>{error || liveError}</p>
          {appId && (
            <button className="secondary" disabled={!!busy} onClick={() => { setError(""); reconnect(); }}>
              Reconnect live updates
            </button>
          )}
        </aside>
      )}
      <BuilderChat
        appId={appId}
        messages={displayedMessages}
        loading={loading}
        busy={!!busy}
        processing={processing}
        waiting={waiting}
        disabled={composerDisabled}
        questionsDisabled={!!busy || !!liveError}
        onSend={send}
        onAnswer={answer}
      >
        {ready && appId && <ReadyCard appId={appId} name={app?.name} onGoHome={onGoHome} />}
        {(busy || waiting || processing || liveError) && (
          <div className="build-progress" role="status">
            {(busy || processing) && <Loader2 size={12} className="spin" />}
            {busy ? busyLabels[busy] : liveError ? "Connection paused" : waiting ? "Waiting for your answer" : "Building…"}
          </div>
        )}
      </BuilderChat>
    </div>
  );
}

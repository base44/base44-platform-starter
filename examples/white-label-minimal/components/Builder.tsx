"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import * as api from "../lib/chat/builder-api";
import { getChatState, type ChatState } from "../lib/chat/chat-state";
import { mergeOptimisticMessages, type OptimisticMessage } from "../lib/chat/optimistic-messages";
import type { App, ToolInput } from "../lib/types";
import BuilderChat from "./BuilderChat";
import ReadyCard from "./ReadyCard";
import { useLiveUpdates } from "./useLiveUpdates";

type Busy = "create" | "send" | "answer" | null;

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
  const state = getChatState(app, messages, loading, liveError);
  const displayedMessages = useMemo(() => mergeOptimisticMessages(messages, optimistic), [messages, optimistic]);

  useEffect(() => {
    if (app) onUpdated?.(app);
  }, [app, onUpdated]);

  // Base44 ignores new prompts while a question is open or a build runs.
  const canSend = !busy && (state === "idle" || state === "ready" || state === "failed");

  async function send(prompt: string) {
    if (lock.current || !canSend || !prompt.trim()) return false;
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
      {state === "failed" && (
        <p role="alert">
          The build failed{app?.status?.error_source ? ` (${app.status.error_source})` : ""}. Review
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
        state={state}
        busy={!!busy}
        canSend={canSend}
        questionsDisabled={!!busy || state === "paused"}
        onSend={send}
        onAnswer={answer}
      >
        {state === "ready" && !busy && appId && <ReadyCard appId={appId} name={app?.name} onGoHome={onGoHome} />}
        <Progress state={state} busy={busy} />
      </BuilderChat>
    </div>
  );
}

// The status line under the chat.
function Progress({ state, busy }: { state: ChatState; busy: Busy }) {
  let text = "";
  if (busy === "create") text = "Creating app…";
  else if (busy === "send") text = "Sending prompt…";
  else if (busy === "answer") text = "Answering question…";
  else if (state === "paused") text = "Connection paused";
  else if (state === "question") text = "Waiting for your answer";
  else if (state === "building") text = "Building…";
  if (!text) return null;

  const spinning = !!busy || state === "building";
  return (
    <div className="build-progress" role="status">
      {spinning && <Loader2 size={12} className="spin" />}
      {text}
    </div>
  );
}

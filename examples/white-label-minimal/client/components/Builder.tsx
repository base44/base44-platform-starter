"use client";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { App } from "../../types";
import type { ChatState } from "../chat-state";
import { useBuildTurn, type Busy } from "../useBuildTurn";
import BuilderChat from "./BuilderChat";
import ReadyCard from "./ReadyCard";

// The builder's chat for one app. The logic is in useBuildTurn; this only shows it.
export default function Builder({ initialAppId, autoFocus, onCreated, onUpdated, onGoHome }: {
  initialAppId?: string;
  autoFocus?: boolean;
  onCreated?: (app: App) => void;
  onUpdated?: (app: App) => void;
  onGoHome?: () => void;
}) {
  const { app, appId, messages, state, busy, canSend, error, send, answer, reconnect } =
    useBuildTurn(initialAppId ?? null, onCreated);

  useEffect(() => {
    if (app) onUpdated?.(app);
  }, [app, onUpdated]);

  return (
    <div className="builder">
      {state === "failed" && (
        <p role="alert">
          The build failed{app?.status?.error_source ? ` (${app.status.error_source})` : ""}. Review
          the conversation and send a follow-up prompt.
        </p>
      )}
      {error && (
        <aside role="alert">
          <p>{error}</p>
          {appId && (
            <button className="secondary" disabled={!!busy} onClick={reconnect}>
              Reconnect live updates
            </button>
          )}
        </aside>
      )}
      <BuilderChat
        appId={appId}
        autoFocus={autoFocus}
        messages={messages}
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

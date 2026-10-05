"use client";
import { createContext, useContext, useEffect } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { Loader2 } from "lucide-react";
import type { App, ToolCall } from "../../types";
import { toAssistantMessage } from "../messages";
import { useBuildTurn } from "../useBuildTurn";
import Question from "./Question";
import ReadyCard from "./ReadyCard";
import ToolActivity from "./ToolActivity";
import { Thread } from "./assistant-ui/thread";

type BuildTurn = ReturnType<typeof useBuildTurn>;

// Hands the build turn to ToolPart, which assistant-ui renders itself.
const TurnContext = createContext<BuildTurn | null>(null);

// The builder's chat for one app. The logic is in useBuildTurn; assistant-ui's
// Thread renders the conversation.
export default function Builder({ initialAppId, autoFocus, onCreated, onUpdated, onGoHome }: {
  initialAppId?: string;
  autoFocus?: boolean;
  onCreated?: (app: App) => void;
  onUpdated?: (app: App) => void;
  onGoHome?: () => void;
}) {
  const turn = useBuildTurn(initialAppId ?? null, onCreated);
  const { app, appId, state, busy } = turn;

  useEffect(() => {
    if (app) onUpdated?.(app);
  }, [app, onUpdated]);

  // assistant-ui shows Tiny's messages. They come from Base44's live updates, so
  // the chat state stays in useBuildTurn.
  const runtime = useExternalStoreRuntime({
    messages: turn.messages,
    convertMessage: toAssistantMessage,
    isRunning: !!busy || state === "building",
    isDisabled: !turn.canSend,
    onNew: async (message) => {
      const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
      // assistant-ui clears the draft on send; put it back if sending failed.
      if (!(await turn.send(text))) runtime.thread.composer.setText(text);
    },
  });

  return (
    <div className="builder">
      {turn.error && (
        <p role="alert">
          {turn.error}{" "}
          {state === "paused" && <button className="secondary" onClick={turn.reconnect}>Reconnect live updates</button>}
        </p>
      )}

      <TurnContext.Provider value={turn}>
        <AssistantRuntimeProvider runtime={runtime}>
          <Thread
            inputLabel={appId ? "What should change?" : "What would you like to build?"}
            placeholder={appId ? "Describe a change…" : "Describe the app you want…"}
            sendLabel={appId ? "Send prompt" : "Create app"}
            autoFocus={autoFocus}
            ToolFallback={ToolPart}
            footer={
              <>
                {state === "ready" && !busy && appId && <ReadyCard appId={appId} name={app?.name} onGoHome={onGoHome} />}
                <Status state={state} busy={busy} />
              </>
            }
          />
        </AssistantRuntimeProvider>
      </TurnContext.Provider>
    </div>
  );
}

// assistant-ui renders each tool call itself and asks for this component: a
// question while Base44 waits for the builder, the agent's activity otherwise.
const ToolPart: ToolCallMessagePartComponent = ({ toolCallId, artifact }) => {
  const turn = useContext(TurnContext)!;
  const { tool, messageId } = artifact as { tool: ToolCall; messageId: string };
  const asking = tool.status === "waiting_for_user_input" || tool.waiting_on?.kind;
  if (!asking || !turn.appId) return <ToolActivity tool={tool} />;
  return (
    <Question
      key={`${toolCallId}:${tool.status}`}
      tool={tool}
      messageId={messageId}
      appId={turn.appId}
      disabled={!!turn.busy || turn.state === "paused"}
      onSubmit={turn.answer}
    />
  );
};

// The line under the chat that says where the build turn stands.
function Status({ state, busy }: Pick<BuildTurn, "state" | "busy">) {
  let text = "";
  if (busy === "create") text = "Creating app…";
  else if (busy === "send") text = "Sending prompt…";
  else if (busy === "answer") text = "Answering question…";
  else if (state === "loading") text = "Loading conversation…";
  else if (state === "paused") text = "Connection paused";
  else if (state === "question") text = "Waiting for your answer";
  else if (state === "building") text = "Building…";
  else if (state === "failed") text = "The build failed. Send a follow-up prompt to try again.";
  if (!text) return null;
  return (
    <div className="build-progress" role="status">
      {(busy || state === "loading" || state === "building") && <Loader2 size={12} className="spin" />}
      {text}
    </div>
  );
}

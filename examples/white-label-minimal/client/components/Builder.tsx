"use client";
import { createContext, useContext, useEffect } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { Bot, Loader2, Send, User } from "lucide-react";
import type { App, ToolCall } from "../../types";
import { toAssistantMessage } from "../messages";
import { useBuildTurn } from "../useBuildTurn";
import Question from "./Question";
import ReadyCard from "./ReadyCard";
import ToolActivity from "./ToolActivity";

// The build turn, for the parts assistant-ui renders itself.
const TurnContext = createContext<ReturnType<typeof useBuildTurn> | null>(null);

// The builder's chat for one app. The logic is in useBuildTurn; assistant-ui
// renders the conversation.
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
    <TurnContext.Provider value={turn}>
      <div className="builder">
        {state === "failed" && <p role="alert">The build failed. Review the conversation and send a follow-up prompt.</p>}
        {turn.error && (
          <aside role="alert">
            <p>{turn.error}</p>
            {appId && <button className="secondary" disabled={!!busy} onClick={turn.reconnect}>Reconnect live updates</button>}
          </aside>
        )}

        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root className="builder-chat">
            <ThreadPrimitive.Viewport aria-label="Conversation" role="region" aria-busy={state === "loading"} className="conversation">
              {state === "loading" && (
                <div className="conversation-loading" role="status">
                  <Loader2 size={20} className="spin" aria-hidden="true" /> Loading conversation…
                </div>
              )}
              {!appId && turn.messages.length === 0 && <div className="chat-welcome"><h2>Build an app</h2></div>}
              <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
              {state === "ready" && !busy && appId && <ReadyCard appId={appId} name={app?.name} onGoHome={onGoHome} />}
              <Progress />
            </ThreadPrimitive.Viewport>

            <ComposerPrimitive.Root className="composer">
              <ComposerPrimitive.Input
                aria-label={appId ? "What should change?" : "What would you like to build?"}
                placeholder={appId ? "Describe a change…" : "Describe the app you want…"}
                autoFocus={autoFocus}
                rows={1}
                maxRows={4}
              />
              <ComposerPrimitive.Send className="send-button" aria-label={appId ? "Send prompt" : "Create app"}>
                {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              </ComposerPrimitive.Send>
              {state === "question" && <small>Answer or reject the waiting question to continue.</small>}
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
      </div>
    </TurnContext.Provider>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="chat-message from-user">
      <span className="message-avatar" aria-label="You"><User size={14} /></span>
      <div className="message-body">
        <MessagePrimitive.Parts components={{ Text: PlainText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  // assistant-ui adds an empty assistant message while a run is in progress.
  const empty = useAuiState((s) => s.message.content.length === 0);
  if (empty) return null;
  return (
    <MessagePrimitive.Root className="chat-message from-assistant">
      <span className="message-avatar" aria-label="Assistant"><Bot size={14} /></span>
      <div className="message-body">
        <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolPart } }} />
      </div>
    </MessagePrimitive.Root>
  );
}

const PlainText: TextMessagePartComponent = ({ text }) => <div className="message-bubble"><p>{text}</p></div>;
const MarkdownText: TextMessagePartComponent = () => <div className="message-bubble"><MarkdownTextPrimitive /></div>;

// A Base44 tool call: a question while it waits for the builder, activity otherwise.
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

// The status line under the chat.
function Progress() {
  const { state, busy } = useContext(TurnContext)!;
  let text = "";
  if (busy === "create") text = "Creating app…";
  else if (busy === "send") text = "Sending prompt…";
  else if (busy === "answer") text = "Answering question…";
  else if (state === "paused") text = "Connection paused";
  else if (state === "question") text = "Waiting for your answer";
  else if (state === "building") text = "Building…";
  if (!text) return null;
  return (
    <div className="build-progress" role="status">
      {(busy || state === "building") && <Loader2 size={12} className="spin" />}
      {text}
    </div>
  );
}

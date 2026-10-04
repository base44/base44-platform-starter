"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
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
import { toAssistantMessage } from "../assistant-messages";
import type { ChatState } from "../chat-state";
import type { Message, ToolCall, ToolInput } from "../../types";
import Question from "./Question";
import ToolActivity from "./ToolActivity";

type Props = {
  appId: string | null;
  autoFocus?: boolean;
  messages: Message[];
  state: ChatState;
  busy: boolean;
  canSend: boolean;
  questionsDisabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  onAnswer: (input: ToolInput) => Promise<void>;
  children: ReactNode;
};

// What tool parts need from the chat. A context rather than props, because
// assistant-ui renders part components itself.
const ChatContext = createContext<Pick<Props, "appId" | "questionsDisabled" | "onAnswer"> | null>(null);

export default function BuilderChat({ appId, autoFocus, messages, state, busy, canSend, questionsDisabled, onSend, onAnswer, children }: Props) {
  const loading = state === "loading";
  const waiting = state === "question";
  const visibleMessages = useMemo(() => messages.filter((m) => !m.hidden), [messages]);
  const runtime = useExternalStoreRuntime({
    messages: visibleMessages,
    convertMessage: toAssistantMessage,
    isRunning: busy || state === "building",
    isDisabled: !canSend,
    isSendDisabled: !canSend,
    onNew: async (message) => {
      const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
      // Restore the draft that assistant-ui cleared before sending.
      if (!(await onSend(text))) runtime.thread.composer.setText(text);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatContext.Provider value={{ appId, questionsDisabled, onAnswer }}>
        <ThreadPrimitive.Root className="builder-chat">
          <ThreadPrimitive.Viewport aria-label="Conversation" role="region" aria-busy={loading} className="conversation">
            {loading && (
              <div className="conversation-loading" role="status">
                <Loader2 size={20} className="spin" aria-hidden="true" />
                <span>Loading conversation…</span>
              </div>
            )}
            {!loading && !visibleMessages.length &&
              (appId ? <p className="empty">No messages yet.</p> : <div className="chat-welcome"><h2>Build an app</h2></div>)}
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            {children}
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input
              aria-label={appId ? "What should change?" : "What would you like to build?"}
              placeholder={waiting ? "Answer the question above…" : appId ? "Describe a change…" : "Describe the app you want…"}
              maxLength={16000}
              autoFocus={autoFocus}
              rows={1}
              maxRows={4}
            />
            <ComposerPrimitive.Send className="send-button" aria-label={appId ? "Send prompt" : "Create app"}>
              {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            </ComposerPrimitive.Send>
            {waiting && <small>Answer or reject the waiting question to continue.</small>}
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </ChatContext.Provider>
    </AssistantRuntimeProvider>
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
  // Hide the empty placeholder assistant-ui adds while a run is in progress.
  const hasContent = useAuiState((s) => s.message.content.length > 0);
  if (!hasContent) return null;
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

// Every Base44 tool call: a question while it waits for the builder, activity otherwise.
const ToolPart: ToolCallMessagePartComponent = ({ toolCallId, artifact }) => {
  const chat = useContext(ChatContext)!;
  const { tool, messageId } = artifact as { tool: ToolCall; messageId: string };
  const asking = tool.status === "waiting_for_user_input" || tool.waiting_on?.kind;
  if (!asking || !chat.appId) return <ToolActivity tool={tool} />;
  return (
    <Question
      key={`${toolCallId}:${tool.status}`}
      tool={tool}
      messageId={messageId}
      appId={chat.appId}
      disabled={chat.questionsDisabled}
      onSubmit={chat.onAnswer}
    />
  );
};

"use client";

import { useMemo, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { Bot, Loader2, Send, User } from "lucide-react";
import { toAssistantMessage } from "../lib/assistant-messages";
import type { Message, ToolCall, ToolInput } from "../lib/types";
import Question from "./Question";
import ToolActivity from "./ToolActivity";

export default function BuilderChat({
  appId,
  messages,
  busy,
  processing,
  waiting,
  disabled,
  questionsDisabled,
  onSend,
  onAnswer,
  children,
}: {
  appId: string | null;
  messages: Message[];
  busy: boolean;
  processing: boolean;
  waiting: boolean;
  disabled: boolean;
  questionsDisabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  onAnswer: (input: ToolInput) => Promise<void>;
  children: ReactNode;
}) {
  const visibleMessages = useMemo(() => messages.filter((m) => !m.hidden), [messages]);
  const runtime = useExternalStoreRuntime({
    messages: visibleMessages,
    convertMessage: toAssistantMessage,
    isRunning: busy || processing,
    isDisabled: disabled,
    isSendDisabled: disabled,
    onNew: async (message) => {
      const text = message.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
      // Restore the draft that assistant-ui cleared before sending.
      if (!(await onSend(text))) runtime.thread.composer.setText(text);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="builder-chat">
        <ThreadPrimitive.Viewport aria-label="Conversation" role="region" className="conversation">
          {!visibleMessages.length &&
            (appId ? (
              <p className="empty">No messages yet.</p>
            ) : (
              <div className="chat-welcome">
                <h2>Build an app</h2>
              </div>
            ))}
          <ThreadPrimitive.Messages>
            {({ message }) => message.content.length === 0 ? null : (
              <MessagePrimitive.Root
                className={`chat-message ${message.role === "user" ? "from-user" : "from-assistant"}`}
              >
                <span
                  className="message-avatar"
                  aria-label={message.role === "user" ? "You" : "Assistant"}
                >
                  {message.role === "user" ? <User size={14} /> : <Bot size={14} />}
                </span>
                <div className="message-body">
                  <MessagePrimitive.Parts>
                    {({ part }) => {
                      if (part.type === "text")
                        return (
                          <div className="message-bubble">
                            {message.role === "user" ? (
                              <p>{part.text}</p>
                            ) : (
                              <MarkdownTextPrimitive />
                            )}
                          </div>
                        );
                      if (part.type !== "tool-call") return null;
                      const { tool, messageId } = part.artifact as {
                        tool: ToolCall;
                        messageId: string;
                      };
                      return (tool.status === "waiting_for_user_input" || tool.waiting_on?.kind) &&
                        appId ? (
                        <Question
                          key={`${part.toolCallId}:${tool.status}`}
                          tool={tool}
                          messageId={messageId}
                          appId={appId}
                          disabled={questionsDisabled}
                          onSubmit={onAnswer}
                        />
                      ) : (
                        <ToolActivity tool={tool} />
                      );
                    }}
                  </MessagePrimitive.Parts>
                </div>
              </MessagePrimitive.Root>
            )}
          </ThreadPrimitive.Messages>
          {children}
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="composer">
          <ComposerPrimitive.Input
            aria-label={appId ? "What should change?" : "What would you like to build?"}
            placeholder={
              waiting
                ? "Answer the question above…"
                : appId
                  ? "Describe a change…"
                  : "Describe the app you want…"
            }
            maxLength={16000}
            rows={1}
            maxRows={4}
          />
          <ComposerPrimitive.Send
            className="send-button"
            aria-label={appId ? "Send prompt" : "Create app"}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          </ComposerPrimitive.Send>
          {waiting && <small>Answer or reject the waiting question to continue.</small>}
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

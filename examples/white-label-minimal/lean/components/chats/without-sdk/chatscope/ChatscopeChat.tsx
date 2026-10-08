"use client";
import { ChatContainer, Message, MessageInput, MessageList, TypingIndicator } from "@chatscope/chat-ui-kit-react";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import type { ChatProps } from "../../Chat";
import { useLiveChat } from "../useLiveChat";
import { toolLine } from "../toolLine";
import ToolQuestion from "../ToolQuestion";

// chatscope: a ready-made chat. We only map messages to its bubbles.
export default function ChatscopeChat({ app, onAppCreated }: ChatProps) {
  const chat = useLiveChat({ app, onAppCreated });
  const { messages, status, canSend, send } = chat;

  const lines = messages.flatMap((m) => [
    ...(m.content ? [{ id: m.id, text: m.content, mine: m.role === "user" }] : []),
    ...(m.tool_calls ?? []).map((tool) => ({
      id: tool.id,
      text: toolLine(tool),
      mine: false,
      question: tool.status === "waiting_for_user_input" && app && <ToolQuestion appId={app.id} messageId={m.id!} tool={tool} />,
    })),
  ]);

  return (
    <ChatContainer>
      <MessageList typingIndicator={status && <TypingIndicator content={status} />}>
        {lines.map((line) =>
          "question" in line && line.question ? (
            <Message key={line.id} model={{ type: "custom", direction: "incoming", position: "single" }}>
              <Message.CustomContent>{line.question}</Message.CustomContent>
            </Message>
          ) : (
            <Message key={line.id} model={{ message: line.text, direction: line.mine ? "outgoing" : "incoming", position: "single" }} />
          ),
        )}
      </MessageList>
      <MessageInput placeholder={app ? "Ask for a change…" : "Describe your app…"} onSend={(_html, text) => send(text)} attachButton={false} disabled={!canSend} />
    </ChatContainer>
  );
}

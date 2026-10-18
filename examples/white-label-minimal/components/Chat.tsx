"use client";
import { useState } from "react";
import { Message, useChatActions, useChatState, type ChatStep, type ChatState, type StepProps, type TextProps } from "@base44/platform/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StickToBottom } from "use-stick-to-bottom";

// The chat reads the chat that Workspace's <Base44ChatProvider> runs. <Message> draws each item with
// Tiny's parts: the text and step parts below, and the question parts from QuestionParts.
export default function Chat({ hasApp }: { hasApp: boolean }) {
  const { items, status } = useChatState();
  const { send, create } = useChatActions();
  const [prompt, setPrompt] = useState("");
  // Send only when the builder can take a prompt now. After a failed build, a prompt can ask for the fix.
  const canSend = status === "ready" || status === "error";

  // The first prompt creates the app; every later one goes to it.
  function submit() {
    if (!canSend || !prompt.trim()) return;
    if (hasApp) send(prompt);
    else create(prompt);
    setPrompt("");
  }

  return (
    <div className="chat">
      <StickToBottom className="chat-scroll" initial="instant">
        <StickToBottom.Content className="chat-messages">
          {items.map((item) => (
            <div key={item.id} className="chat-message">
              <Message item={item} />
            </div>
          ))}
          <StatusLine hasApp={hasApp} />
        </StickToBottom.Content>
      </StickToBottom>
      <div className="chat-composer">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            submit();
          }}
          placeholder={hasApp ? "Ask for a change…" : "Describe your app…"}
          className="chat-input"
          rows={1}
        />
        <Button onClick={submit} disabled={!canSend || !prompt.trim()}>Send</Button>
      </div>
    </div>
  );
}

// A prompt Base44 hasn't confirmed yet shows faded.
export function Text({ text, role, pending }: TextProps) {
  let className = "chat-user-text";
  if (role === "assistant") className = "chat-assistant-text";
  else if (pending) className = "chat-user-text chat-pending";
  return <p className={className}>{text}</p>;
}

export function Step(step: StepProps) {
  return <p className="chat-tool-line">{stepIcon(step)} {step.label}</p>;
}

function stepIcon(step: ChatStep) {
  if (step.status === "running") return "…";
  if (step.status === "waiting") return "?";
  if (step.status === "error") return "✗";
  if (step.status === "stopped") return "–";
  return "✓";
}

// Tiny's wording for what the chat reports.
function StatusLine({ hasApp }: { hasApp: boolean }) {
  const chat: ChatState = useChatState();
  const { clearError } = useChatActions();
  let text = "";
  if (chat.error) text = chat.error.message;
  else if (chat.status === "submitted") text = hasApp ? "Sending…" : "Creating app…";
  else if (chat.status === "waiting") text = "Waiting for your answer";
  else if (chat.status === "building") text = "Building…";
  else if (hasApp && chat.connection === "connecting") text = "Loading the conversation…";
  if (!text) return null;
  return (
    <p className="chat-status">
      {text}
      {chat.error && <Button size="sm" variant="ghost" onClick={clearError}>Dismiss</Button>}
    </p>
  );
}

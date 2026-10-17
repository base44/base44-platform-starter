"use client";
import { useEffect, useState } from "react";
import { useBase44Chat, type Base44Chat, type Base44ChatBackend, type ChatItem, type ChatStep } from "@base44/platform/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StickToBottom } from "use-stick-to-bottom";
import { createApp, openLiveSession, sendMessage, submitToolCallInput, type App } from "../server/base44";
import ToolQuestion from "./ToolQuestion";

// The four Base44 calls, run on the server. The hook calls them, so the browser never holds a key.
const backend: Base44ChatBackend = { createApp, openLiveSession, sendMessage, submitToolCallInput };

export default function Chat({ app, onAppCreated, onBuildingChange }: {
  app: App | null;
  onAppCreated: (app: App) => void;
  onBuildingChange: (building: boolean) => void;
}) {
  const chat = useBase44Chat({ appId: app?.id ?? null, backend, onAppCreated });
  const [prompt, setPrompt] = useState("");
  const building = chat.status === "building";
  // Send only when the builder can take a prompt now. After a failed build, a prompt can ask for the fix.
  const canSend = chat.status === "ready" || chat.status === "error";

  useEffect(() => {
    onBuildingChange(building);
  }, [building, onBuildingChange]);

  // The first prompt creates the app; every later one goes to it.
  function submit() {
    if (!canSend || !prompt.trim()) return;
    if (app) chat.send(prompt);
    else chat.create(prompt);
    setPrompt("");
  }

  return (
    <div className="chat">
      <StickToBottom className="chat-scroll" initial="instant">
        <StickToBottom.Content className="chat-messages">
          {chat.items.map((item) => (
            <div key={item.id} className="chat-message">
              {item.text && <p className={textClass(item)}>{item.text}</p>}
              {item.steps.map((step) =>
                step.question ? (
                  <ToolQuestion key={step.id} question={step.question} />
                ) : (
                  <p key={step.id} className="chat-tool-line">{stepIcon(step)} {step.label}</p>
                ),
              )}
            </div>
          ))}
          <StatusLine chat={chat} hasApp={!!app} />
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
          placeholder={app ? "Ask for a change…" : "Describe your app…"}
          className="chat-input"
          rows={1}
        />
        <Button onClick={submit} disabled={!canSend || !prompt.trim()}>Send</Button>
      </div>
    </div>
  );
}

// A prompt Base44 hasn't confirmed yet shows faded.
function textClass(item: ChatItem) {
  if (item.role === "assistant") return "chat-assistant-text";
  if (item.pending) return "chat-user-text chat-pending";
  return "chat-user-text";
}

function stepIcon(step: ChatStep) {
  if (step.status === "running") return "…";
  if (step.status === "waiting") return "?";
  if (step.status === "error") return "✗";
  if (step.status === "stopped") return "–";
  return "✓";
}

// Tiny's wording for what the hook reports.
function StatusLine({ chat, hasApp }: { chat: Base44Chat; hasApp: boolean }) {
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
      {chat.error && <Button size="sm" variant="ghost" onClick={chat.clearError}>Dismiss</Button>}
    </p>
  );
}

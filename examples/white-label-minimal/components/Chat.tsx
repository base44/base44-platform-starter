"use client";
import { useEffect, useState } from "react";
import type { ToolCall } from "@base44/platform";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StickToBottom } from "use-stick-to-bottom";
import type { App } from "../server/base44";
import ToolQuestion from "./ToolQuestion";
import { useLiveChat } from "./useLiveChat";

export default function Chat({ app, onAppCreated, onBuildingChange }: {
  app: App | null;
  onAppCreated: (app: App) => void;
  onBuildingChange: (building: boolean) => void;
}) {
  const { messages, status, building, canSend, send } = useLiveChat({ app, onAppCreated });
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    onBuildingChange(building);
  }, [building, onBuildingChange]);

  function submit() {
    if (!prompt.trim() || !canSend) return;
    send(prompt);
    setPrompt("");
  }

  return (
    <div className="chat">
      <StickToBottom className="chat-scroll" initial="instant">
        <StickToBottom.Content className="chat-messages">
          {messages.map((m) => (
            <div key={m.id} className="chat-message">
              {m.content && (
                <p className={m.role === "user" ? "chat-user-text" : "chat-assistant-text"}>{m.content}</p>
              )}
              {m.tool_calls?.map((tool) =>
                tool.status === "waiting_for_user_input" && app ? (
                  <ToolQuestion key={tool.id} appId={app.id} messageId={m.id!} tool={tool} />
                ) : (
                  <p key={tool.id} className="chat-tool-line">{toolLine(tool)}</p>
                ),
              )}
            </div>
          ))}
          {status && <p className="chat-status">{status}</p>}
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
        <Button onClick={submit} disabled={!canSend}>Send</Button>
      </div>
    </div>
  );
}

// One tool step as a short line, e.g. "✓ write_file src/pages/Home.jsx".
function toolLine(tool: ToolCall) {
  const icon = tool.status === "running" ? "…" : tool.status === "error" ? "✗" : "✓";
  return `${icon} ${tool.name} ${tool.display?.file_paths?.join(", ") ?? ""}`;
}

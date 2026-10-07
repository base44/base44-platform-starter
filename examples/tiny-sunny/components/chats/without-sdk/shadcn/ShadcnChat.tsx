"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { ChatProps } from "../../Chat";
import { useLiveChat } from "../useLiveChat";
import { toolLine } from "../toolLine";
import ToolQuestion from "../ToolQuestion";

// shadcn: no chat component, so we build one from its Button, Textarea and ScrollArea.
export default function ShadcnChat({ app, onAppCreated }: ChatProps) {
  const chat = useLiveChat({ app, onAppCreated });
  const { messages, status, canSend, send } = chat;
  const [prompt, setPrompt] = useState("");

  function submit() {
    if (!prompt.trim() || !canSend) return;
    send(prompt);
    setPrompt("");
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-4 text-sm">
          {messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-1">
              {m.content && (
                <p className={m.role === "user" ? "ml-auto max-w-[85%] rounded-lg bg-secondary px-3 py-2" : "whitespace-pre-wrap"}>{m.content}</p>
              )}
              {m.tool_calls?.map((tool) =>
                tool.status === "waiting_for_user_input" && app ? (
                  <ToolQuestion key={tool.id} appId={app.id} messageId={m.id!} tool={tool} />
                ) : (
                  <p key={tool.id} className="text-xs text-muted-foreground">{toolLine(tool)}</p>
                ),
              )}
            </div>
          ))}
          {status && <p className="text-muted-foreground">{status}</p>}
        </div>
      </ScrollArea>
      <div className="flex gap-2 border-t p-3">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submit())}
          placeholder={app ? "Ask for a change…" : "Describe your app…"}
          className="min-h-9 resize-none"
          rows={1}
        />
        <Button onClick={submit} disabled={!canSend}>Send</Button>
      </div>
    </div>
  );
}

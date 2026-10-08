"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message, useBase44Chat } from "../../../sdk";
import { server } from "./base44Server";
import { chatParts } from "./chatParts";
import type { ChatProps } from "../Chat";

// Only markup: the hook holds all the Base44 logic, and chatParts gives it Tiny's look.
export default function HeadlessChat({ app, onAppCreated }: ChatProps) {
  const chat = useBase44Chat({ appId: app?.id ?? null, server });
  const [prompt, setPrompt] = useState("");

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {chat.items.map((item) => (
          <Message key={item.id} item={item} chat={chat} components={chatParts} />
        ))}
        {chat.status && <p className="text-xs text-muted-foreground">{chat.status}</p>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          chat.send(prompt).then((created) => created && onAppCreated(created));
          setPrompt("");
        }}
        className="m-3 flex gap-2 rounded-2xl border p-2"
      >
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Message…" className="flex-1 bg-transparent px-2 outline-none" />
        <Button size="sm" disabled={!chat.canSend || !prompt.trim()}>Send</Button>
      </form>
    </div>
  );
}

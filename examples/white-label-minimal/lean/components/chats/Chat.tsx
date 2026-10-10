"use client";
import { useState } from "react";
import type { Base44App } from "../../sdk";
import type { App } from "../../types";
import AssistantUiChat from "./without-sdk/assistant-ui/AssistantUiChat";
import ChatscopeChat from "./without-sdk/chatscope/ChatscopeChat";
import HeadlessChat from "./headless/HeadlessChat";
import ShadcnChat from "./without-sdk/shadcn/ShadcnChat";

export type ChatProps = {
  app: App | null;
  onAppCreated: (app: Base44App) => void;
};

const versions = { chatscope: ChatscopeChat, shadcn: ShadcnChat, "assistant-ui": AssistantUiChat, headless: HeadlessChat };

// For comparing: three chats that talk to Base44 by hand (without-sdk/), and one on the
// headless library (sdk/). Pick one with the tabs.
export default function Chat(props: ChatProps) {
  const [version, setVersion] = useState<keyof typeof versions>("headless");
  const Version = versions[version];

  return (
    <div className="flex h-full flex-col border-l">
      <div className="flex gap-1 border-b p-2 text-xs">
        {Object.keys(versions).map((name) => (
          <button
            key={name}
            onClick={() => setVersion(name as keyof typeof versions)}
            className={`rounded px-2 py-1 ${name === version ? "bg-secondary font-medium" : "text-muted-foreground"}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Version {...props} />
      </div>
    </div>
  );
}

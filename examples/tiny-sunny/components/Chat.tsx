"use client";
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useLocalRuntime } from "@assistant-ui/react";
import { Button } from "@/components/ui/button";
import type { App } from "../types";

// Local stand-in for the Base44 builder.
const mockBuilder = { run: async () => ({ content: [{ type: "text" as const, text: "Got it — working on it." }] }) };

export default function Chat({ app }: { app: App | null }) {
  const runtime = useLocalRuntime(mockBuilder);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full flex-col border-l">
        <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="flex gap-2 p-4">
          <ComposerPrimitive.Input
            placeholder={app ? `Change ${app.name}…` : "Describe your app…"}
            className="flex-1 resize-none rounded-md border px-3 py-2 text-sm outline-none"
          />
          <ComposerPrimitive.Send asChild>
            <Button>Send</Button>
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

const UserMessage = () => (
  <MessagePrimitive.Root className="ml-auto rounded-lg bg-secondary px-3 py-2">
    <MessagePrimitive.Parts />
  </MessagePrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root>
    <MessagePrimitive.Parts />
  </MessagePrimitive.Root>
);

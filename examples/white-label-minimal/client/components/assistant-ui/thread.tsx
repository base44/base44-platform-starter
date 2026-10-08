"use client";
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { ArrowUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MarkdownText } from "./markdown-text";

// assistant-ui's Thread (templates/minimal), cut down to what Base44's chat
// supports: messages, tool calls and a composer.
export function Thread({ footer, inputLabel, placeholder, sendLabel, autoFocus, ToolFallback }: {
  footer?: ReactNode;
  inputLabel: string;
  placeholder: string;
  sendLabel: string;
  autoFocus?: boolean;
  ToolFallback: ToolCallMessagePartComponent;
}) {
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport role="region" aria-label="Conversation" className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
        <ThreadPrimitive.Messages>{() => <Message ToolFallback={ToolFallback} />}</ThreadPrimitive.Messages>
        {footer}
      </ThreadPrimitive.Viewport>

      <ComposerPrimitive.Root className="m-4 mt-0 flex items-end gap-2 rounded-3xl border border-border bg-card p-2">
        <ComposerPrimitive.Input
          aria-label={inputLabel}
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={1}
          className="m-0 max-h-48 flex-1 resize-none border-0 bg-transparent px-2.5 py-1 text-sm outline-none"
        />
        <ComposerPrimitive.Send aria-label={sendLabel} className="size-7 rounded-full p-0">
          <ArrowUpIcon className="size-4" />
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}

function Message({ ToolFallback }: { ToolFallback: ToolCallMessagePartComponent }) {
  const role = useAuiState((s) => s.message.role);
  // assistant-ui adds an empty assistant message while a run is in progress.
  const empty = useAuiState((s) => s.message.parts.length === 0);
  if (empty) return null;

  if (role === "user") {
    return (
      <MessagePrimitive.Root data-role="user" className="ml-auto max-w-[85%] rounded-xl bg-muted px-4 py-2 whitespace-pre-wrap">
        <MessagePrimitive.Parts />
      </MessagePrimitive.Root>
    );
  }
  return (
    <MessagePrimitive.Root data-role="assistant" className="flex flex-col gap-2">
      <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolFallback } }} />
    </MessagePrimitive.Root>
  );
}

"use client";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { ChatMessage, ToolCall } from "@base44/platform";
import { ArrowUp, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatProps } from "../../Chat";
import { useLiveChat } from "../useLiveChat";
import ToolQuestion from "../ToolQuestion";

// A Base44 message in assistant-ui's shape: its text, then each tool step as a tool-call part.
function convertMessage(m: ChatMessage): ThreadMessageLike {
  return {
    id: m.id,
    role: m.role ?? "assistant",
    content: [
      ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
      ...(m.tool_calls ?? []).map((tool) => ({
        type: "tool-call" as const,
        toolCallId: tool.id ?? "",
        toolName: tool.name ?? "step",
        artifact: { tool, messageId: m.id },
      })),
    ],
  };
}


// assistant-ui: its runtime holds Base44's messages; its primitives render them.
export default function AssistantUiChat({ app, onAppCreated }: ChatProps) {
  const chat = useLiveChat({ app, onAppCreated });
  const { messages, status, canSend, send } = chat;

  // How a tool step renders: a question when the builder waits on one, else a line.
  const ToolStep: ToolCallMessagePartComponent = ({ artifact }) => {
    const { tool, messageId } = artifact as { tool: ToolCall; messageId: string };
    if (tool.status === "waiting_for_user_input" && app) return <ToolQuestion appId={app.id} messageId={messageId} tool={tool} />;
    const Icon = tool.status === "running" ? Loader2 : tool.status === "error" ? X : Check;
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`size-3.5 ${tool.status === "running" ? "animate-spin" : ""}`} />
        <span className="font-medium">{tool.name}</span>
        <span className="truncate">{tool.display?.file_paths?.join(", ")}</span>
      </p>
    );
  };

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    // Base44 queues prompts during a build, so the composer stays open; the status line shows the build.
    onNew: async (message) => send(message.content.map((part) => (part.type === "text" ? part.text : "")).join("")),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full flex-col">
        <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-6 text-sm leading-relaxed">
          <ThreadPrimitive.Messages
            components={{
              UserMessage: () => (
                <MessagePrimitive.Root className="ml-auto max-w-[80%] rounded-3xl bg-muted px-4 py-2.5 whitespace-pre-wrap">
                  <MessagePrimitive.Parts />
                </MessagePrimitive.Root>
              ),
              AssistantMessage: () => (
                <MessagePrimitive.Root className="flex flex-col gap-1.5">
                  <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolStep } }} />
                </MessagePrimitive.Root>
              ),
            }}
          />
          {status && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {status}
            </p>
          )}
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="m-3 flex items-end gap-2 rounded-3xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/20">
          <ComposerPrimitive.Input
            disabled={!canSend}
            rows={1}
            placeholder={app ? "Ask for a change…" : "Describe your app…"}
            className="max-h-40 flex-1 resize-none bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <ComposerPrimitive.Send asChild>
            <Button size="icon" className="rounded-full" aria-label="Send">
              <ArrowUp />
            </Button>
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

// Replies are markdown: headings, lists, bold, code.
function MarkdownText() {
  return (
    <MarkdownTextPrimitive className="[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1,&_h2,&_h3]:mt-3 [&_h1,&_h2,&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol,&_ul]:my-2 [&_ol,&_ul]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:list-disc" />
  );
}

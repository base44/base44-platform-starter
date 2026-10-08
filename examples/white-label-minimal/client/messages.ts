import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ChatMessage } from "@base44/platform";
import type { Message } from "../types";

// Converts a live-updates message to the shape this example's chat UI renders.
export function toMessage(message: ChatMessage): Message {
  return {
    id: message.id ?? "",
    role: message.role,
    content: message.content,
    tool_calls: message.tool_calls?.map((tool) => ({
      id: tool.id,
      name: tool.name,
      status: tool.status,
      waiting_on: tool.waiting_on,
      arguments_string: tool.arguments ? JSON.stringify(tool.arguments, null, 2) : null,
      results: typeof tool.results === "string" ? tool.results : undefined,
    })),
  };
}

// Replaces the message with the same id, or appends it.
export function upsertMessage(messages: Message[], message: Message): Message[] {
  return messages.some((m) => m.id === message.id)
    ? messages.map((m) => (m.id === message.id ? message : m))
    : [...messages, message];
}

// Converts a message to assistant-ui's shape. Each tool call carries the original
// call, which ToolPart shows as a question or as activity.
export function toAssistantMessage(message: Message): ThreadMessageLike {
  if (message.role === "user") return { id: message.id, role: "user", content: message.content ?? "" };
  return {
    id: message.id,
    role: "assistant",
    content: [
      ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
      ...(message.tool_calls ?? []).map((tool, index) => ({
        type: "tool-call" as const,
        toolCallId: tool.id || `${message.id}:tool:${index}`,
        toolName: tool.name || "Agent action",
        artifact: { tool, messageId: message.id },
      })),
    ],
  };
}

import type { ChatMessage } from "@base44/platform";
import type { Message } from "../types";

// Converts a socket message to the shape this example's chat UI renders.
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
      arguments_string: tool.arguments ? JSON.stringify(tool.arguments) : null,
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

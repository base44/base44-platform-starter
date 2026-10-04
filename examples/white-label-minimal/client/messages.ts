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

// The builder's prompt, shown from the moment they send it until Base44 sends it back.
export type OptimisticMessage = {
  message: Message;
  knownIds: string[];
};

/** Match only new server messages, once each, so repeated prompts stay distinct. */
export function mergeOptimisticMessages(
  messages: Message[],
  optimistic: OptimisticMessage[],
): Message[] {
  const result = [...messages];
  const matched = new Set<string>();
  const localIds = new Set<string>();
  for (const { message, knownIds } of optimistic) {
    const known = new Set(knownIds);
    const server = messages.find((candidate) =>
      !candidate.hidden && candidate.role === "user" &&
      !known.has(candidate.id) && !matched.has(candidate.id) &&
      candidate.content?.trim() === message.content?.trim(),
    );
    if (server) {
      matched.add(server.id);
      // Keep React's identity stable when the server copy arrives.
      result[result.findIndex((candidate) => candidate.id === server.id)] = {
        ...server, id: message.id,
      };
    } else {
      // Place the prompt before responses that arrived since it was submitted.
      let after = -1;
      result.forEach((candidate, index) => {
        if (known.has(candidate.id) || localIds.has(candidate.id)) after = index;
      });
      result.splice(after + 1, 0, message);
    }
    localIds.add(message.id);
  }
  return result;
}

import type { AppUpdate, ChatMessage, ImageReady } from "@base44/sdk/platform/client";
import type { Message } from "../types";

export function applyMessageUpdate(messages: Message[], update: AppUpdate): Message[] {
  const message = update._last_msg;
  if (!message) return messages;
  if ("is_deleted" in message) return messages.filter(current => current.id !== message.id);
  return mergeMessages(messages, [message]);
}

// Replaces by id and appends the rest, so a snapshot can land before or after live updates.
export function mergeMessages(messages: Message[], incoming: ChatMessage[]): Message[] {
  let merged = messages;
  for (const message of incoming) {
    if (!message.id) throw new Error("A socket message has no stable ID.");
    const replacement: Message = { ...message, id: message.id };
    merged = merged.some(current => current.id === message.id)
      ? merged.map(current => current.id === message.id ? replacement : current)
      : [...merged, replacement];
  }
  return merged;
}

export function resolveImage(messages: Message[], image: ImageReady): Message[] {
  const resolvedUrl = image.status === "completed" ? image.image_url : null;
  const replace = (text: string | null | undefined) =>
    resolvedUrl ? text?.split(image.placeholder_url).join(resolvedUrl) ?? text : text;
  return messages.map(message => ({
    ...message,
    content: replace(message.content),
    tool_calls: message.tool_calls?.map(tool => ({
      ...tool,
      arguments_string: replace(tool.arguments_string),
      results: typeof tool.results === "string"
        ? replace(tool.results)
        : tool.results && "placeholder_url" in tool.results && tool.results.placeholder_url === image.placeholder_url
          ? { ...tool.results, status: image.status, image_url: image.image_url ?? null }
          : tool.results,
    })),
  }));
}

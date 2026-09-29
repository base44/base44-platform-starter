import type { ChatMessage, ImageResolved } from "@base44/sdk/platform/client";
import type { Message } from "../types";

export function removeMessage(messages: Message[], id: string): Message[] {
  return messages.filter(current => current.id !== id);
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

export function resolveImage(messages: Message[], image: ImageResolved): Message[] {
  const placeholder = image.placeholder_url;
  if (!placeholder) return messages;
  const resolvedUrl = image.status === "completed" ? image.image_url : null;
  const replace = (text: string | null | undefined) =>
    resolvedUrl ? text?.split(placeholder).join(resolvedUrl) ?? text : text;
  return messages.map(message => ({
    ...message,
    content: replace(message.content),
    tool_calls: message.tool_calls?.map(tool => tool.results?.placeholder_url === placeholder
      ? { ...tool, results: { ...tool.results, status: image.status, image_url: image.image_url ?? null } }
      : tool),
  }));
}

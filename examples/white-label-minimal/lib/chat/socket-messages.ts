import type { AppUpdate, ImageReady } from "@base44/sdk/platform/client";
import type { Message } from "../types";

export function applyMessageUpdate(messages: Message[], update: AppUpdate): Message[] {
  const message = update._last_msg;
  if (!message) return messages;
  if (!message.id) throw new Error("A socket message has no stable ID.");
  const replacement: Message = { ...message, id: message.id };
  return messages.some(current => current.id === message.id)
    ? messages.map(current => current.id === message.id ? replacement : current)
    : [...messages, replacement];
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
        : tool.results?.placeholder_url === image.placeholder_url
          ? { ...tool.results, status: image.status, image_url: image.image_url ?? null }
          : tool.results,
    })),
  }));
}

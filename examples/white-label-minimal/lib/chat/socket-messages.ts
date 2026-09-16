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
  if (image.status !== "completed" || !image.image_url) return messages;
  const replace = (text: string | null | undefined) =>
    text?.split(image.placeholder_url).join(image.image_url!) ?? text;
  return messages.map(message => ({
    ...message,
    content: replace(message.content),
    tool_calls: message.tool_calls?.map(tool => ({
      ...tool,
      arguments_string: replace(tool.arguments_string),
      results: replace(tool.results),
    })),
  }));
}

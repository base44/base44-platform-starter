import type { Message } from "../types";

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

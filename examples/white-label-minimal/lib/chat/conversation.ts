import type { Message } from "../types";

export const isPending = (m: Message) =>
  m.tool_calls?.some((t) => t.status === "running" || t.status === "waiting_for_user_input");

// skip counts backward from the newest message, not forward from the oldest.
export async function refreshConversation(
  previous: Message[],
  read: (skip: number) => Promise<{ messages: Message[] }>,
): Promise<Message[]> {
  const known = new Set(previous.map((m) => m.id));
  const oldestPending = previous.find(isPending)?.id;
  let fetched: Message[] = [];
  for (let skip = 0; skip <= 100_000; skip += 20) {
    const { messages } = await read(skip);
    if (messages.some((m) => !m.id)) throw new Error("Conversation messages need stable IDs.");
    // Keep the fresher copy when concurrent appends shift page boundaries.
    const newer = new Set(fetched.map((m) => m.id));
    fetched = [...messages.filter((m) => !newer.has(m.id)), ...fetched];
    const reachedHistory = oldestPending
      ? fetched.some((m) => m.id === oldestPending)
      : messages.some((m) => known.has(m.id));
    if (messages.length < 20 || reachedHistory) {
      const updates = new Map(fetched.map((m) => [m.id, m]));
      return [
        ...previous.map((m) => updates.get(m.id) ?? m),
        ...fetched.filter((m) => !known.has(m.id)),
      ];
    }
  }
  throw new Error("Conversation is too large for this learning example.");
}

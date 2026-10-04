import { Base44PlatformClient, type AppStatus, type ChatMessage } from "@base44/platform";
import type { Message } from "../types";
import { openLiveUpdates } from "./builder-api";

export type LiveUpdateHandlers = {
  onMessages: (update: (messages: Message[]) => Message[]) => void;
  onStatus: (status: AppStatus | null) => void;
  onError: () => void;
};

// Watches one app's chat and status over Base44's live-updates socket.
// Resolves to a function that stops watching.
export async function watchLiveUpdates(appId: string, handlers: LiveUpdateHandlers) {
  const session = await openLiveUpdates(appId);
  let firstToken: string | undefined = session.sessionToken;
  const client = new Base44PlatformClient({
    serverUrl: session.serverUrl,
    // The first connection uses the session opened above. The SDK calls this
    // again only when that session has ended, and our server opens a new one.
    async getSessionToken() {
      const token = firstToken ?? (await openLiveUpdates(appId)).sessionToken;
      firstToken = undefined;
      return token;
    },
  });

  const builder = client.builder.init({ onError: handlers.onError });
  builder.subscribe(appId, {
    // Arrives on every connect and reconnect, with the last 50 messages.
    onSnapshot(snapshot) {
      handlers.onMessages(() => snapshot.messages.map(toMessage));
      handlers.onStatus(snapshot.status);
    },
    onEvent(event) {
      if (event.type === "message.updated") {
        const message = toMessage(event.data.message);
        handlers.onMessages((messages) => upsertMessage(messages, message));
      }
      if (event.type === "message.removed") {
        const id = event.data.message_id;
        handlers.onMessages((messages) => messages.filter((m) => m.id !== id));
      }
      if (event.type === "app.status_changed") handlers.onStatus(event.data.status);
    },
    onError: handlers.onError,
  });
  await builder.connect();
  return () => builder.close();
}

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

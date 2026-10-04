import { Base44PlatformClient, type AppStatus } from "@base44/platform";
import type { Message } from "../types";
import { openBuilderSession } from "./builder-api";
import { toMessage, upsertMessage } from "./live-messages";

export type LiveUpdateHandlers = {
  onMessages: (update: (messages: Message[]) => Message[]) => void;
  onStatus: (status: AppStatus | null) => void;
  onError: () => void;
};

// Watches one app's builder chat over the Base44 socket. Resolves to a function
// that stops watching.
export async function watchApp(appId: string, handlers: LiveUpdateHandlers) {
  const session = await openBuilderSession(appId);
  let firstToken: string | undefined = session.sessionToken;
  const client = new Base44PlatformClient({
    serverUrl: session.serverUrl,
    // The first connection uses the session opened above. The SDK calls this
    // again only when that session has ended, and our server opens a new one.
    async getSessionToken() {
      const token = firstToken ?? (await openBuilderSession(appId)).sessionToken;
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

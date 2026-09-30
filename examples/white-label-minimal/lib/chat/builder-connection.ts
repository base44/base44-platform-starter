import { Base44PlatformClient, type BuilderSession, type PlatformSocketError } from "@base44/sdk/platform/client";
import { closeBuilderSession, openBuilderSession } from "./builder-api";

export async function createBuilderConnection(
  appId: string,
  onError: (error: PlatformSocketError) => void,
  signal: AbortSignal,
): Promise<BuilderSession> {
  const initial = await openBuilderSession(appId, signal);
  let first: string | undefined = initial.sessionToken;
  let handle = initial.sessionHandle;
  let closed = false;
  const end = (ended: string) => void closeBuilderSession(appId, ended).catch(() => {});
  const client = new Base44PlatformClient({
    serverUrl: initial.serverUrl,
    // The SDK reuses the token across reconnects and asks again only once the session has ended.
    async getSessionToken() {
      if (first) {
        const token = first;
        first = undefined;
        return token;
      }
      const next = await openBuilderSession(appId, signal);
      if (closed) end(next.sessionHandle);
      else handle = next.sessionHandle;
      return next.sessionToken;
    },
  });
  const session = client.builder.init({ onError });
  return {
    connect: () => session.connect(),
    subscribe: (id, options) => session.subscribe(id, options),
    close() {
      if (closed) return;
      closed = true;
      session.close();
      // Ending it frees the key's live-session limit instead of waiting out the hour.
      end(handle);
    },
  };
}

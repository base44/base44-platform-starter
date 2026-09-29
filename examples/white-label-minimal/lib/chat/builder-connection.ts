import { Base44PlatformClient, type PlatformSocketError } from "@base44/sdk/platform/client";
import { openBuilderSession } from "./builder-api";

export async function createBuilderConnection(
  appId: string,
  onError: (error: PlatformSocketError) => void,
  signal: AbortSignal,
) {
  const initial = await openBuilderSession(appId, signal);
  let first: string | undefined = initial.sessionToken;
  const client = new Base44PlatformClient({
    serverUrl: initial.serverUrl,
    // The SDK reuses the token across reconnects and asks again only once the session has ended.
    async getSessionToken() {
      const token = first ?? (await openBuilderSession(appId, signal)).sessionToken;
      first = undefined;
      return token;
    },
  });
  return client.builder.init({ onError });
}

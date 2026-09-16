import { Base44PlatformClient, type PlatformSocketError } from "@base44/sdk/platform/client";
import { getBuilderConnection } from "./builder-api";

export async function createBuilderConnection(
  appId: string,
  onError: (error: PlatformSocketError) => void,
  signal: AbortSignal,
) {
  const initial = await getBuilderConnection(appId, signal);
  let firstToken: string | undefined = initial.token;
  const client = new Base44PlatformClient({
    serverUrl: initial.serverUrl,
    async refreshToken() {
      const token = firstToken ?? (await getBuilderConnection(appId, signal)).token;
      firstToken = undefined;
      return token;
    },
  });
  return client.builder.init({ onError });
}

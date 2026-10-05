import "server-only";
import { getBase44Config } from "./config";
import { Base44Error } from "./error";

type Options = {
  method?: "GET" | "POST" | "DELETE";
  body?: object;
  headers?: Record<string, string>;
  // Defaults to the integration account's personal access token.
  auth?: Record<string, string>;
  timeout?: number;
};

// Calls Base44 from the server. Errors are Base44Errors that are safe to show.
export async function base44(path: string, { method = "GET", body, headers, auth, timeout = 30_000 }: Options = {}) {
  const { host, token, workspaceId } = getBase44Config();

  let response: Response;
  try {
    response = await fetch(`${host}${path}`, {
      method,
      headers: {
        ...(auth ?? { Authorization: `Bearer ${token}` }),
        // Base44 checks permissions against the active workspace, not the body.
        "X-Active-Workspace-Id": workspaceId,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    // Not the fetch error itself: it can contain the URL or a credential.
    throw new Base44Error("Base44 did not return a response. The operation may still be running.", 504);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Base44Error(`Base44 returned ${response.status}.`, response.status, data?.error?.code);
  }
  return data;
}

// The workspace key is for embedding and live updates. Everything else uses the
// integration account's personal access token.
export function workspaceKey() {
  const { workspaceKey } = getBase44Config();
  if (!workspaceKey) {
    throw new Base44Error("Previews and live updates need BASE44_SVC_KEY on the server.", 503);
  }
  return workspaceKey;
}

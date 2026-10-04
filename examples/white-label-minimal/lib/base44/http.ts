import "server-only";
import { Base44Error } from "./error";
import { getBase44Config } from "./config";

// What a Base44 status means for the person using the app.
const hints: Record<number, string> = {
  401: "Check the server's Base44 access token.",
  403: "Check the access token's workspace permissions.",
  409: "The app is not ready for this yet. Ask the agent to fix it.",
  429: "Rate limit reached. Wait before trying again.",
};

type Options = {
  body?: object;
  headers?: Record<string, string>;
  timeout?: number;
};

/**
 * Calls Base44 as the integration account. POST when there is a body, GET otherwise.
 * Every failure is a Base44Error that is safe to show.
 */
export async function base44Fetch(path: string, { body, headers, timeout = 30_000 }: Options = {}) {
  const { host, token, workspaceId } = getBase44Config();
  let response: Response;
  try {
    response = await fetch(`${host}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        // Capability checks read the active workspace, not the request body.
        "X-Active-Workspace-Id": workspaceId,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body && JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    // Never include fetch errors: they can contain a URL or upstream credentials.
    throw new Base44Error("Base44 did not return a response. The operation may still be running.", 504);
  }
  if (!response.ok) {
    const { status } = response;
    const hint = hints[status] ?? "Refresh the app state before repeating an operation.";
    throw new Base44Error(`Base44 returned ${status}. ${hint}`, status);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Base44Error("Base44 returned an unreadable response. The outcome is uncertain.");
  }
}

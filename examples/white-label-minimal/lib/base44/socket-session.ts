import "server-only";
import { Base44Error } from "./error";
import { getBase44Config } from "./config";

// Base44's reasons for refusing a session, as setup steps for the operator.
const problems: Record<string, string> = {
  scope_required: "Live updates need a workspace key with the apps:watch scope.",
  whitelabel_sockets_disabled: "Live updates are not enabled for this Base44 workspace yet.",
  app_not_allowed: "The workspace key cannot watch this app. Use a key from the app's workspace.",
};

// Opens a read-only live-updates session for one app. The browser gets only the
// session token; the workspace key stays here. It must belong to the same
// workspace as the apps and hold the apps:watch scope.
export async function openSocketSession(appId: string) {
  const { host } = getBase44Config();
  const key = process.env.BASE44_SVC_KEY?.trim();
  if (!key) throw new Base44Error("Live updates need BASE44_SVC_KEY on the server.", 503);
  const response = await fetch(`${host}/api/service/socket-sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ app_ids: [appId] }),
    cache: "no-store",
  });
  if (!response.ok) {
    const code = await response.json().then((body) => body?.error?.code, () => undefined);
    if (response.status === 401) throw new Base44Error("Live updates: Base44 rejected BASE44_SVC_KEY.", 503);
    throw new Base44Error(problems[code] ?? `Live updates unavailable: Base44 returned ${response.status}.`, 503);
  }
  const { socket_url, session_token } = await response.json();
  return { serverUrl: new URL(socket_url).origin, sessionToken: String(session_token) };
}

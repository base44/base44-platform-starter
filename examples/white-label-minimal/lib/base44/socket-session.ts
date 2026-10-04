import "server-only";
import { Base44Error } from "./error";
import { getBase44Config } from "./config";

// Opens a read-only live-updates session for one app. The browser gets only the
// session token; the workspace key (it needs the apps:watch scope) stays here.
export async function openSocketSession(appId: string) {
  const { host } = getBase44Config();
  const response = await fetch(`${host}/api/service/socket-sessions`, {
    method: "POST",
    headers: { Authorization: process.env.BASE44_SVC_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ app_ids: [appId] }),
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403)
    throw new Base44Error("Live updates need a workspace key with the apps:watch scope.", 503);
  if (!response.ok) throw new Base44Error(`Base44 returned ${response.status} opening live updates.`);
  const { socket_url, session_token } = await response.json();
  return { serverUrl: new URL(socket_url).origin, sessionToken: String(session_token) };
}

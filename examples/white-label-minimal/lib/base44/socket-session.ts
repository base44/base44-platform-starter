import "server-only";
import { Base44Error } from "./error";
import { getBase44Config } from "./config";

// The browser receives only the session token: it can watch this one app for an
// hour and nothing else. The workspace key never leaves the server.
export async function openSocketSession(appId: string) {
  const key = process.env.BASE44_WATCH_KEY?.trim() || process.env.BASE44_SVC_KEY?.trim();
  if (!key) throw new Base44Error("Configure BASE44_WATCH_KEY on the server.", 503);
  const { host } = getBase44Config();
  let response: Response;
  try {
    response = await fetch(`${host}/api/service/socket-sessions`, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ app_ids: [appId] }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Base44Error("Could not reach Base44 for live updates.", 504);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Base44Error("Live updates need a workspace key with the apps:watch scope.", 503);
    throw new Base44Error(`Base44 returned ${response.status} opening live updates.`,
      response.status === 409 || response.status === 429 ? 429 : 502);
  }
  const data = await response.json().catch(() => null);
  let socket: URL | undefined;
  try {
    socket = new URL(data?.socket_url);
  } catch {}
  if (typeof data?.session_token !== "string" || !data.session_token ||
      socket?.protocol !== "https:" || socket.username || socket.password)
    throw new Base44Error("Base44 returned an invalid live-update session.");
  return { serverUrl: socket.origin, sessionToken: data.session_token as string };
}

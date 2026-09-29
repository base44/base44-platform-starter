import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Base44Error } from "./error";
import { getBase44Config } from "./config";

function watchKey() {
  const key = process.env.BASE44_WATCH_KEY?.trim() || process.env.BASE44_SVC_KEY?.trim();
  if (!key) throw new Base44Error("Configure BASE44_WATCH_KEY on the server.", 503);
  return key;
}

// The handle lets the browser end its own session, and only that: it is bound to
// the user and the app, so one user cannot end another's.
function signature(email: string, appId: string, sessionId: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Base44Error("Configure NEXTAUTH_SECRET on the server.", 503);
  return createHmac("sha256", secret).update(`socket-session\n${email.toLowerCase()}\n${appId}\n${sessionId}`).digest("base64url");
}

// The browser receives only the session token: it can watch this one app for an
// hour and nothing else. The workspace key never leaves the server.
export async function openSocketSession(email: string, appId: string) {
  const key = watchKey();
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
      typeof data.session_id !== "string" || !/^[a-f0-9]{32}$/.test(data.session_id) ||
      socket?.protocol !== "https:" || socket.username || socket.password)
    throw new Base44Error("Base44 returned an invalid live-update session.");
  return {
    serverUrl: socket.origin,
    sessionToken: data.session_token as string,
    sessionHandle: `${data.session_id}.${signature(email, appId, data.session_id)}`,
  };
}

// Frees the session for the key's live-session limit instead of leaving it to expire.
export async function closeSocketSession(email: string, appId: string, handle: string) {
  const [sessionId, given] = handle.split(".");
  const expected = Buffer.from(signature(email, appId, sessionId ?? ""));
  if (!/^[a-f0-9]{32}$/.test(sessionId ?? "") || !given || Buffer.byteLength(given) !== expected.length ||
      !timingSafeEqual(Buffer.from(given), expected))
    throw new Base44Error("Invalid live-update session.", 400);
  const { host } = getBase44Config();
  let response: Response;
  try {
    response = await fetch(`${host}/api/service/socket-sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: watchKey() },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Base44Error("Could not reach Base44 to end live updates.", 504);
  }
  // Already expired or ended elsewhere: nothing left to free.
  if (!response.ok && response.status !== 404)
    throw new Base44Error(`Base44 returned ${response.status} ending live updates.`, 502);
  return {};
}

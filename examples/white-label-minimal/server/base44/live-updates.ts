import "server-only";
import { Base44Error } from "./error";
import { base44, workspaceKey } from "./request";

// Live updates: a read-only socket session for one app. The browser receives
// the session token and session id, never the workspace key. The id cannot open a socket.
export async function openLiveUpdates(appId: string) {
  try {
    const session = await base44("/api/service/socket-sessions", {
      method: "POST",
      auth: { Authorization: `Bearer ${workspaceKey()}` },
      body: { app_ids: [appId] },
    });
    return {
      serverUrl: new URL(session.socket_url).origin,
      sessionId: session.session_id as string,
      sessionToken: session.session_token as string,
    };
  } catch (error) {
    if (!(error instanceof Base44Error) || error.status === 504) throw error;
    throw new Base44Error(liveUpdatesProblem(error), 503);
  }
}

// Ends a session when the builder leaves, so it does not count toward the key's
// open-session limit until it expires.
export async function closeLiveUpdates(sessionId: string) {
  try {
    await base44(`/api/service/socket-sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      auth: { Authorization: `Bearer ${workspaceKey()}` },
    });
  } catch (error) {
    // Already ended or expired.
    if (!(error instanceof Base44Error) || error.status !== 404) throw error;
  }
}

// Why Base44 refused a live-updates session, as a setup step for whoever runs the server.
function liveUpdatesProblem(error: Base44Error) {
  if (error.status === 401) return "Base44 rejected BASE44_SVC_KEY.";
  if (error.code === "scope_required") return "Live updates need a workspace key with the apps:watch scope.";
  if (error.code === "whitelabel_sockets_disabled") return "Live updates are not enabled for this Base44 workspace yet.";
  if (error.code === "app_not_allowed") return "The workspace key cannot watch this app. Use a key from the app's workspace.";
  return `Live updates unavailable: Base44 returned ${error.status}.`;
}

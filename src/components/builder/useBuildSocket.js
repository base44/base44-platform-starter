/**
 * POC — watches a build over Base44's socket, straight from the browser.
 *
 * No server in the path. The browser fetches this user's vended token from
 * `/api/base44/socket-token`, connects to Base44's read-only `/partner`
 * namespace, joins the app's room and receives the builder's pushes. Base44
 * decides what it may see: that namespace registers no write handlers, and the
 * vended token is contained to its granted workspace and to apps its principal
 * owns, so a user cannot watch someone else's build.
 *
 * Two things here are consequences of the socket, not choices:
 *
 * **The projection is done here, and awkwardly, because the wire format is
 * internal.** `update_model` is Base44's own `UserApp` field diff, arriving as
 * `{ room, data }` with `data` a JSON *string*, and an absent key meaning
 * "unchanged" rather than "empty". We read the two fields the build UI needs and
 * ignore the rest. A partner-facing event contract is what removes this.
 *
 * **The poll stays.** The socket replays nothing missed while disconnected, so
 * every reconnect is a hole that only a re-read closes. Push for liveness, poll
 * for truth. Resume by sequence number is what would let the poll go.
 */

import { useEffect } from "react";
import { io } from "socket.io-client";

/** Base44 broadcasts an app's pushes to its instance room. */
const roomFor = (appId) => `/apps/${appId}`;

/** `{ room, data }` where `data` is a JSON string. A malformed push is dropped. */
function parsePush(payload) {
  if (typeof payload?.data !== "string") return null;
  try {
    const parsed = JSON.parse(payload.data);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const fetchCredential = () =>
  fetch("/api/base44/socket-token", { method: "POST" }).then((r) => (r.ok ? r.json() : null));

/**
 * @param appId      the app to watch, or null/undefined to watch nothing
 * @param onMessage  ({ appId, messageId, role, content }) — a whole message, not a delta
 * @param onStatus   ({ appId, state, details })
 */
export function useBuildSocket(appId, onMessage, onStatus) {
  useEffect(() => {
    if (!appId) return;

    let socket;
    let closed = false;

    (async () => {
      // 428 when the user has not linked Base44, 501 when the bridge is
      // unconfigured. Either way there is nothing to connect to, and the poll is
      // still running, so stay quiet.
      const credential = await fetchCredential().catch(() => null);
      if (!credential || closed) return;

      const { token, url, path, namespace } = credential;

      socket = io(`${url}${namespace}`, {
        path,
        transports: ["websocket"],
        // A function, not a value: socket.io calls it on every connection
        // attempt, so a reconnect after the token expired re-reads a fresh one
        // rather than retrying forever with the stale one. Either way the
        // credential travels in the CONNECT packet, never in the URL.
        auth: (cb) =>
          fetchCredential()
            .then((fresh) => cb({ token: fresh?.token ?? token }))
            .catch(() => cb({ token })),
      });

      // The join is what authorizes: Base44 answers `error` and leaves us out of
      // the room if this principal cannot reach the app.
      socket.on("connect", () => socket.emit("join", roomFor(appId)));

      socket.on("update_model", (payload) => {
        const data = parsePush(payload);
        if (!data) return;
        // A stamped push is another client's branch work on the same app,
        // broadcast to the same room. Sunny only ever builds on main.
        if (data._scope_branch_id) return;

        const message = data._last_msg;
        if (message && typeof message === "object") {
          onMessage?.({
            appId,
            messageId: message.id ?? null,
            role: message.role ?? "assistant",
            content: typeof message.content === "string" ? message.content : "",
          });
        }

        const status = data.status;
        if (status && typeof status.state === "string") {
          onStatus?.({ appId, state: status.state, details: status.details ?? null });
        }
      });
    })();

    return () => {
      closed = true;
      socket?.close();
    };
  }, [appId, onMessage, onStatus]);
}

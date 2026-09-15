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
 * **The projection is done here, and awkwardly, because the wire format is
 * internal.** `update_model` is Base44's own `UserApp` field diff, arriving as
 * `{ room, data }` with `data` a JSON *string*, and an absent key meaning
 * "unchanged" rather than "empty". We read the two fields the build UI needs and
 * ignore the rest. A partner-facing event contract is what removes this.
 *
 * Returns whether the socket is **in the room** — not merely connected. The
 * caller polls on that: Base44's own builder runs no poll at all during a build,
 * because one conversation load plus these pushes is the whole picture, so a
 * subscriber that is genuinely in the room can drop to a safety net. It has to
 * be the room and not the connection, because a refused join leaves the socket
 * connected and permanently silent, which is indistinguishable from an idle
 * build. Hence `joined`, and hence false until it arrives — an older Base44
 * that does not send it simply keeps the caller polling.
 */

import { useEffect, useState } from "react";
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
 * @returns          true while this socket is joined to the app's room
 */
export function useBuildSocket(appId, onMessage, onStatus) {
  const [joinedAppId, setJoinedAppId] = useState(null);

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

      // The join is what authorizes: Base44 answers `joined` once we are in the
      // room, or `error` and leaves us out if this principal cannot reach the app.
      socket.on("connect", () => socket.emit("join", roomFor(appId)));
      socket.on("joined", () => setJoinedAppId(appId));

      // Any of these means pushes are no longer arriving, so the caller must go
      // back to reading. A reconnect re-joins and sets it again.
      const stopTrusting = () => setJoinedAppId(null);
      socket.on("error", stopTrusting);
      socket.on("disconnect", stopTrusting);
      socket.on("connect_error", stopTrusting);

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
      setJoinedAppId(null);
      socket?.close();
    };
  }, [appId, onMessage, onStatus]);

  // Compared, not coerced: the state survives into the next app's first render,
  // and reporting a stale `true` there would stand the poll down for an app
  // this socket has not joined.
  return joinedAppId !== null && joinedAppId === appId;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { buildSessionsEnabled } from "@/lib/base44Config";
import { subscribeToSession } from "@/lib/buildSession";
import { messageFromStream } from "@/components/builder/streamTranscript";

/**
 * Learns what a build is doing by being told, rather than by asking.
 *
 * Returns `{ sessionState, streamError, live }`. `live` is false when the push
 * channel is switched off, and the caller then falls back to reading
 * `app.status` off its poll — so this hook is the *whole* difference between the
 * two mechanisms, and the sidebar keeps one set of render logic.
 *
 * Three events do the work:
 *
 * - `state.changed` / `turn.started` / `error` carry the session state, which is
 *   what "building" and "waiting on you" are read from. `waiting` outranks
 *   `running` upstream, so a turn parked on a tool call reports as waiting
 *   rather than as a build that will never finish.
 * - `message.updated` carries the whole message, as a snapshot rather than a
 *   delta, so it is handed over as a transcript row and a streaming build costs
 *   no HTTP at all. `streamTranscript` does the adapting, because the published
 *   projection names three fields differently from the REST shape and omits tool
 *   `results` — which is the one thing still worth a read, once, when the turn
 *   ends.
 * - `turn.finished` is a real completion signal. The old mechanism had to infer
 *   completion from a polling edge (seen `processing`, no longer `processing`,
 *   not waiting) and keep a ref to remember which app that edge belonged to.
 *   None of that is needed when the platform simply says so.
 *
 * Two more report work done to the app from outside the turn we are watching,
 * which is why they carry no state and no `turn_id`: `conversation.reset` (a
 * checkpoint restore or a branch sync rewrote the history) and `files.changed`
 * (files moved with no turn to attribute them to). Nothing follows either one,
 * so a handler that ignores them leaves a stale view on screen permanently —
 * they are the only notice there is.
 */
export function useBuildSessionStream({
  appId,
  onMessage,
  onTurnFinished,
  onConversationReset,
  onFilesChanged,
}) {
  const live = buildSessionsEnabled();

  // Tagged with the app it describes rather than cleared on a switch. Clearing
  // would leave a window in which an event already in flight for the app being
  // left lands and is read as the new one's state; a mismatched tag simply is
  // not current, so there is no window to get wrong.
  const [tracked, setTracked] = useState({ appId: null, state: null, error: null });

  // Latest-callback refs, written in effects rather than during render — the
  // subscription's only dependency is the app it watches, because re-subscribing
  // mid-build would replay the window and lose whatever arrived in the gap.
  // Declared above the subscribe effect so they are set before it first runs.
  const onMessageRef = useRef(onMessage);
  const onTurnFinishedRef = useRef(onTurnFinished);
  const onConversationResetRef = useRef(onConversationReset);
  const onFilesChangedRef = useRef(onFilesChanged);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  useEffect(() => {
    onTurnFinishedRef.current = onTurnFinished;
  }, [onTurnFinished]);
  useEffect(() => {
    onConversationResetRef.current = onConversationReset;
  }, [onConversationReset]);
  useEffect(() => {
    onFilesChangedRef.current = onFilesChanged;
  }, [onFilesChanged]);

  const handleEvent = useCallback(
    (event) => {
      const data = event.data || {};
      switch (event.type) {
        case "message.updated":
          // Tagged with the app, so a row from a session the user has left
          // cannot be merged into the one on screen.
          onMessageRef.current?.(messageFromStream(data), appId);
          break;
        case "turn.finished":
          setTracked({ appId, state: data, error: null });
          onTurnFinishedRef.current?.(data);
          break;
        case "turn.started":
        case "state.changed":
          setTracked({ appId, state: data, error: null });
          break;
        case "conversation.reset":
          // Carries no payload by design — the transcript we hold is simply no
          // longer what the server has, and re-reading is the only answer.
          onConversationResetRef.current?.();
          break;
        case "files.changed":
          onFilesChangedRef.current?.();
          break;
        case "error":
          // `detail` is only present when a turn died outside a request, which
          // is exactly the case that has no response to have failed — so it is
          // the only account of the failure the user will ever get.
          setTracked({ appId, state: data, error: data.detail || null });
          break;
        default:
          // Unrecognised types are ignored by contract, so Base44 can add
          // events without a release on this side.
          break;
      }
    },
    [appId],
  );

  const handleError = useCallback(
    (message) =>
      setTracked((prev) => ({
        appId,
        state: prev.appId === appId ? prev.state : null,
        error: message,
      })),
    [appId],
  );

  useEffect(() => {
    if (!live || !appId) return undefined;
    return subscribeToSession(appId, { onEvent: handleEvent, onError: handleError });
  }, [live, appId, handleEvent, handleError]);

  const current = tracked.appId === appId;
  return {
    sessionState: current ? tracked.state : null,
    streamError: current ? tracked.error : null,
    live,
  };
}

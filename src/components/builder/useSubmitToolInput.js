import { useCallback, useState } from "react";
import * as platform from "@/lib/base44Platform";
import { buildSessionsEnabled } from "@/lib/base44Config";

/**
 * The single place a user-input widget submits from, so the invariants can't
 * drift per-widget: it surfaces errors instead of throwing, refreshes the
 * conversation so the resumed turn shows up, and tracks a busy flag to disable
 * inputs mid-flight.
 *
 * `submit(approve, payload, opts)` resolves this tool call. It never throws — a
 * failed submit sets `error` and leaves the turn paused, so the widget always
 * keeps a way out (retry / skip). Never dead-end a paused turn.
 *
 * Two ways to answer, selected by the push-channel switch. `/respond` is the
 * better of the two beyond just returning early: it validates the waitpoint
 * against the live turn, so a stale id from a widget that missed a state change
 * comes back as a plain "not waiting on that any more" instead of a 404 raised
 * deep inside the builder.
 */
export function useSubmitToolInput({ appId, toolCallId, messageId, kind, onSubmitted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const live = buildSessionsEnabled();

  const submit = useCallback(
    async (approve, payload = {}, opts = {}) => {
      setBusy(true);
      setError(null);
      try {
        if (live) {
          await platform.respondToBuildSession(
            appId,
            toolCallId,
            // Upstream discriminates the body on the waitpoint kind and 409s if
            // it disagrees with the live one, so pass the kind the interrupt
            // actually reported rather than inferring it from the payload.
            kind || "approval",
            approve ? "approved" : "rejected",
            payload,
          );
          // No refresh: the resumed turn arrives on the stream. Awaiting a read
          // here would hold the widget busy through work already reported.
        } else {
          await platform.submitToolCallInput(appId, toolCallId, approve, payload, {
            messageId,
            ...opts,
          });
          await onSubmitted?.();
        }
      } catch (err) {
        setError(err?.message || "Couldn't submit — try again.");
      } finally {
        setBusy(false);
      }
    },
    [live, appId, toolCallId, messageId, kind, onSubmitted],
  );

  return { submit, busy, error };
}

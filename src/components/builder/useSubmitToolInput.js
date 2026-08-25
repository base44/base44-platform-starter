import { useCallback, useState } from "react";
import * as platform from "@/lib/base44Platform";

/**
 * The single place a user-input widget submits from, so the invariants can't
 * drift per-widget: it surfaces errors instead of throwing, refreshes the
 * conversation so the resumed turn shows up, and tracks a busy flag to disable
 * inputs mid-flight.
 *
 * `submit(approve, payload, opts)` resolves this tool call. It never throws — a
 * failed submit sets `error` and leaves the turn paused, so the widget always
 * keeps a way out (retry / skip). Never dead-end a paused turn.
 */
export function useSubmitToolInput({ appId, toolCallId, messageId, onSubmitted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = useCallback(
    async (approve, payload = {}, opts = {}) => {
      setBusy(true);
      setError(null);
      try {
        await platform.submitToolCallInput(appId, toolCallId, approve, payload, {
          messageId,
          ...opts,
        });
        await onSubmitted?.();
      } catch (err) {
        setError(err?.message || "Couldn't submit — try again.");
      } finally {
        setBusy(false);
      }
    },
    [appId, toolCallId, messageId, onSubmitted],
  );

  return { submit, busy, error };
}

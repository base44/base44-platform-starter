import { useCallback, useState } from "react";

/**
 * Runs one of a question's bound actions (`answer`, `submit`, `approve`,
 * `decline`) with a busy flag, so a widget can disable its inputs mid-flight.
 *
 * The actions never throw. A failed answer sets the chat's `error` and opens the
 * question again, so the widget always keeps a way out. Never dead-end a paused turn.
 */
export function useAnswer() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

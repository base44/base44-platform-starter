"use client";

/**
 * Minimal toast, with an optional action.
 *
 * There is no toast dependency in this project and adding one to say four
 * sentences would be the wrong trade. What the dashboard actually needs is
 * narrow: confirm that something happened, and let the user take it back —
 * removing a widget is one click with no confirm step, so "Undo" is what makes
 * that safe rather than a dialog in front of every removal.
 *
 * `aria-live="polite"` rather than `assertive`: these are confirmations, and
 * they should not interrupt whatever a screen reader is already reading.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

const ToastContext = createContext(null);

const DEFAULT_DURATION = 6000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ message, action, actionLabel, duration = DEFAULT_DURATION }) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, action, actionLabel }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 px-4 w-full max-w-sm pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto w-full flex items-center gap-3 rounded-lg bg-foreground text-background shadow-lg px-3 py-2.5"
          >
            <p className="text-sm flex-1 min-w-0">{t.message}</p>
            {t.action && (
              <button
                onClick={() => {
                  dismiss(t.id);
                  t.action();
                }}
                className="text-sm font-semibold underline underline-offset-2 flex-shrink-0 min-h-[36px] px-1"
              >
                {t.actionLabel || "Undo"}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="flex-shrink-0 p-1 rounded opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** No-ops outside a provider so a component is never coupled to being wrapped. */
export function useToast() {
  return useContext(ToastContext) ?? { toast: () => -1, dismiss: () => {} };
}

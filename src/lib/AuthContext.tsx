"use client";

/**
 * Tracks the Base44 *link* status: whether this user has a minted platform token,
 * which is what gates the builder UI.
 *
 * Auto-connects on mount — provision, mint, store — and falls back to the
 * sidebar's "connect" state when the bridge is unreachable or unconfigured. The
 * shell's own session is separate and comes from `useSession()` (client) or
 * `getSessionUser()` (server).
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { base44LinkStatus, connectBase44, isNotLinkedError } from "@/lib/base44Platform";

type AuthValue = {
  /** null = still checking, true = linked, false = not linked / unavailable. */
  b44Linked: boolean | null;
  /** Retry the link (provision + mint). Takes 5-15s. */
  connect: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [b44Linked, setB44Linked] = useState<boolean | null>(null);

  /**
   * Resolve the link, reporting the outcome through `onResult` rather than
   * touching state directly: the caller decides whether the answer still
   * matters, which keeps every `setB44Linked` on an async continuation instead
   * of the synchronous path of an effect.
   */
  const resolveLink = useCallback(async (onResult: (linked: boolean) => void) => {
    try {
      const status = (await base44LinkStatus()) as { linked?: boolean };
      if (status?.linked) {
        onResult(true);
        return;
      }
      // Not linked — auto-connect. Single attempt: provision + mint takes 5-15s and
      // retrying compounds that.
      await connectBase44();
      onResult(true);
    } catch (err) {
      // not_linked / reauthorize_required / bridge_misconfigured are all
      // "show the Connect button", so only anything else is worth logging.
      if (!isNotLinkedError(err)) {
        console.warn("[AuthContext] b44 connect failed:", (err as Error)?.message);
      }
      onResult(false);
    }
  }, []);

  const connect = useCallback(() => resolveLink(setB44Linked), [resolveLink]);

  useEffect(() => {
    // Ignore a result that arrives after unmount, or after a newer attempt.
    let cancelled = false;
    void resolveLink((linked) => {
      if (!cancelled) setB44Linked(linked);
    });
    return () => {
      cancelled = true;
    };
  }, [resolveLink]);

  return <AuthContext.Provider value={{ b44Linked, connect }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

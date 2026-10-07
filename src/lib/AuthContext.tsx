"use client";

/**
 * Tracks whether the app builder is available: is the Base44 bridge configured on
 * this deployment? That is what gates the builder UI.
 *
 * There is nothing per-user to establish — one integration account builds every
 * app, server-side — so this is a single status call on mount, and `recheck()`
 * repeats it. The shell's own session is separate and comes from `useSession()`
 * (client) or `getSessionUser()` (server).
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { builderStatus, isBuilderUnavailable } from "@/lib/base44Platform";

type AuthValue = {
  /** null = still checking, true = the builder is available, false = not configured here. */
  builderAvailable: boolean | null;
  /** Ask again — after the deployment was configured, or after a 501 mid-session. */
  recheck: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [builderAvailable, setBuilderAvailable] = useState<boolean | null>(null);

  /**
   * Resolve the status, reporting the outcome through `onResult` rather than
   * touching state directly: the caller decides whether the answer still
   * matters, which keeps every `setBuilderAvailable` on an async continuation
   * instead of the synchronous path of an effect.
   */
  const resolve = useCallback(async (onResult: (available: boolean) => void) => {
    try {
      await builderStatus();
      onResult(true);
    } catch (err) {
      // bridge_misconfigured is the expected "not here" answer; anything else is
      // worth a line in the console.
      if (!isBuilderUnavailable(err)) {
        console.warn("[AuthContext] builder status failed:", (err as Error)?.message);
      }
      onResult(false);
    }
  }, []);

  const recheck = useCallback(() => resolve(setBuilderAvailable), [resolve]);

  useEffect(() => {
    // Ignore a result that arrives after unmount, or after a newer attempt.
    let cancelled = false;
    void resolve((available) => {
      if (!cancelled) setBuilderAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, [resolve]);

  return (
    <AuthContext.Provider value={{ builderAvailable, recheck }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

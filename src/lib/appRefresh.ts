/**
 * Cross-page announcements about a built app, for the two cases a page has no
 * other way to learn about.
 *
 * **Rebuilt.** A rebuilt or redeployed app is served from the same URL, so an
 * iframe has no reason to refetch and the user keeps seeing the old bundle.
 * Keyed by app id: a dashboard holds several.
 *
 * **Removed.** Base44 deleted the app and the shell has dropped its rows — see
 * src/lib/base44AppMirror.ts. The removal already happened server-side; this is
 * how a page that is *already open* stops showing it, rather than waiting for a
 * reload.
 */
import { useEffect, useRef, useState } from "react";

export const APP_REBUILT = "app-rebuilt";

export function announceAppRebuilt(appId: string | null | undefined): void {
  if (!appId || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APP_REBUILT, { detail: { appId, nonce: Date.now() } }));
}

/** Changes whenever `appId` is announced. Use as a frame's `key` so it remounts. */
export function useAppRebuildNonce(appId: string | null | undefined): number {
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!appId) return;
    const onRebuilt = (e: Event) => {
      const detail = (e as CustomEvent<{ appId?: string; nonce?: number }>).detail;
      if (detail?.appId !== appId) return;
      setNonce(detail.nonce ?? Date.now());
    };
    window.addEventListener(APP_REBUILT, onRebuilt);
    return () => window.removeEventListener(APP_REBUILT, onRebuilt);
  }, [appId]);

  return nonce;
}

/** Nonce 0 leaves the url untouched, so a first load is unchanged. */
export function withNonce(url: string | null, nonce: number): string | null {
  if (!url || !nonce) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${nonce}`;
}

/** An app Base44 deleted, which the shell has stopped carrying. */
export const APP_REMOVED = "base44-app-removed";

export function announceAppRemoved(appId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APP_REMOVED, { detail: { appId } }));
}

/**
 * Calls `onRemoved(appId)` when an app the shell was carrying goes away.
 *
 * Ref-held so an inline arrow does not rebind — and miss an event — every
 * render, matching `useMarketChanges`.
 */
export function useAppRemoved(onRemoved: (appId: string) => void): void {
  const latest = useRef(onRemoved);
  useEffect(() => {
    latest.current = onRemoved;
  }, [onRemoved]);

  useEffect(() => {
    const fire = (e: Event) => {
      const appId = (e as CustomEvent<{ appId?: string }>).detail?.appId;
      if (appId) latest.current(appId);
    };
    window.addEventListener(APP_REMOVED, fire);
    return () => window.removeEventListener(APP_REMOVED, fire);
  }, []);
}

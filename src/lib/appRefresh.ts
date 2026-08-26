/**
 * Tells embedded copies of a built app that it changed. A rebuilt or redeployed
 * app is served from the same URL, so an iframe has no reason to refetch and the
 * user keeps seeing the old bundle. Keyed by app id: a dashboard holds several.
 */
import { useEffect, useState } from "react";

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

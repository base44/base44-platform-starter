/**
 * The Sunny half of the viewer-token handshake (server half: src/lib/appTokens.ts).
 *
 * An embedded app cannot see who is signed in — its `fetch` to /api/sunny is
 * cross-site and carries no cookie. This page can: it asks its own server for a token
 * scoped to the current viewer and posts it into the frame on request.
 *
 * Request-driven rather than pushed on load: the frame asks once its listener exists,
 * so there is no race with its own boot. Both directions are origin-pinned — we only
 * answer the frame we embedded, and we post to that app's exact origin, never `*`.
 */

import { useEffect } from "react";

export const AUTH_REQUEST = "sunny:auth:request";
export const AUTH_TOKEN = "sunny:auth:token";
export const AUTH_DENIED = "sunny:auth:denied";

type Frame = { current: HTMLIFrameElement | null };

function originOf(url: string | null): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export function useAppFrameAuth(frameRef: Frame, appId: string | null, url: string | null) {
  const appOrigin = originOf(url);

  useEffect(() => {
    if (!appId || !appOrigin) return;

    async function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      // Answer only the frame we embedded, and only from the origin we embedded it
      // from: `event.source` identity is what stops another frame on the page from
      // collecting a token for an app it does not host.
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== appOrigin) return;
      if ((event.data as { type?: string })?.type !== AUTH_REQUEST) return;

      const res = await fetch("/api/sunny/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: appId }),
      });

      if (!res.ok) {
        frame.contentWindow?.postMessage({ type: AUTH_DENIED, status: res.status }, appOrigin);
        return;
      }

      const { token, expires_in } = (await res.json()) as { token: string; expires_in: number };
      frame.contentWindow?.postMessage({ type: AUTH_TOKEN, token, expires_in }, appOrigin);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, appId, appOrigin]);
}

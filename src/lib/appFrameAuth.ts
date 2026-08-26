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
 *
 * `onState` reports what happened, because whether an app ever asked for a token is
 * the one thing this page knows about what the frame is showing. An app rendering
 * invented sample rows never asks; an app reading the viewer's boards always does.
 * That difference is what the widget's data badge is built on — see DashboardWidgets.
 */

import { useEffect, useRef } from "react";

export const AUTH_REQUEST = "sunny:auth:request";
export const AUTH_TOKEN = "sunny:auth:token";
export const AUTH_DENIED = "sunny:auth:denied";

type Frame = { current: HTMLIFrameElement | null };

/** "idle" = the frame has not asked for a token (yet, or ever). */
export type FrameAuthState = "idle" | "granted" | "denied";

/**
 * Resolved against the current document, so a same-origin app — one Sunny hosts
 * itself, rather than a Base44 deployment on its own subdomain — gets an origin too.
 * Without the base, a relative `src` throws, `appOrigin` is null, and the listener is
 * never attached: the frame asks for a token and waits forever.
 *
 * Returning null still disables the handshake, which is the right failure: with no
 * known origin there is nowhere safe to post a token.
 */
function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const base = typeof window === "undefined" ? undefined : window.location.href;
    return new URL(url, base).origin;
  } catch {
    return null;
  }
}

export function useAppFrameAuth(
  frameRef: Frame,
  appId: string | null,
  url: string | null,
  onState?: (state: FrameAuthState) => void,
) {
  const appOrigin = originOf(url);
  // Kept in a ref so a caller passing an inline arrow does not rebind the
  // listener — and drop a token request — on every render.
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);

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
        onStateRef.current?.("denied");
        return;
      }

      const { token, expires_in } = (await res.json()) as { token: string; expires_in: number };
      frame.contentWindow?.postMessage({ type: AUTH_TOKEN, token, expires_in }, appOrigin);
      onStateRef.current?.("granted");
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, appId, appOrigin]);
}

/**
 * Lets an embedded app tell the shell how tall it wants to be.
 *
 * A widget frame is cross-origin, so nothing here can measure the app's content
 * — which is why every widget was a fixed 320px box regardless of whether it
 * held three rows or thirty, and why a short app sat above 180px of white. The
 * app is the only party that can measure itself, so it reports:
 *
 *   parent.postMessage({ type: "sunny:size", height: 214 }, "*")
 *
 * Advisory, and clamped here: a frame cannot make itself 20,000px tall, and an
 * app that never reports keeps whatever height the row already had. The builder
 * teaches new apps to send it (src/lib/builderInstructions.ts); older apps
 * simply never do, and nothing about them changes.
 */

import { useEffect, useState } from "react";

export const SIZE_REPORT = "sunny:size";

export const MIN_FRAME_HEIGHT = 160;
export const MAX_FRAME_HEIGHT = 800;

/** Ignore reports that differ from the applied height by less than this. */
const SETTLE_PX = 8;

function originOf(url: string | null): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export function clampFrameHeight(height: number): number {
  return Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.round(height)));
}

/**
 * The height the frame at `url` last asked for, or null if it never asked.
 * Origin-pinned and source-pinned exactly like the token handshake: a report is
 * only honoured from the window we embedded.
 */
export function useReportedFrameHeight(
  frameRef: { current: HTMLIFrameElement | null },
  url: string | null,
): number | null {
  const appOrigin = originOf(url);
  // Keyed by url so a remount (new app, or a rebuild nonce) starts over rather
  // than inheriting the previous frame's height. Adjusting during render is the
  // supported way to reset state on a prop change; an effect would cost an extra
  // render and briefly show the stale height.
  const [state, setState] = useState<{ url: string | null; height: number | null }>({
    url,
    height: null,
  });
  if (state.url !== url) setState({ url, height: null });

  useEffect(() => {
    if (!appOrigin) return;

    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== appOrigin) return;

      const data = event.data as { type?: string; height?: unknown };
      if (data?.type !== SIZE_REPORT) return;
      const raw = Number(data.height);
      if (!Number.isFinite(raw) || raw <= 0) return;

      const next = clampFrameHeight(raw);
      setState((prev) => {
        // A report that arrives after the frame was replaced belongs to a frame
        // nobody is looking at any more.
        if (prev.url !== url) return prev;
        if (prev.height !== null && Math.abs(prev.height - next) < SETTLE_PX) return prev;
        return { url, height: next };
      });
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, appOrigin, url]);

  return state.url === url ? state.height : null;
}

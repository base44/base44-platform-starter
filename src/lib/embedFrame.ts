/**
 * The URL a frame should load: the same app, with the viewer signed in.
 *
 * The token is single-use and lives 60 seconds, so it is minted here — at the
 * frame — and not in `usableApps`. Pass the result to both the iframe and
 * `useAppFrameAuth`: a minted URL is on the app's live host, and the handshake
 * checks the frame's origin against what was loaded.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import type { EmbedRefusal } from "@/lib/embedSession";

export type EmbedFrameSrc = {
  /** The URL to load. Never null when `url` was not null. */
  src: string | null;
  /** True once a minted URL is in `src`. */
  signedIn: boolean;
  /** Why not, when not. Null while minting and on success. */
  reason: EmbedRefusal | "error" | null;
};

export function useEmbedSrc(appId: string | null, url: string | null, nonce = 0): EmbedFrameSrc {
  const key = `${appId}:${url}:${nonce}`;
  const [minted, setMinted] = useState<{ key: string; src: string | null; reason: EmbedFrameSrc["reason"] } | null>(null);
  const mintedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!appId || !url) return;
    if (mintedFor.current === key) return;
    mintedFor.current = key;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/embed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ app_id: appId }),
        });
        const body = (await res.json().catch(() => null)) as {
          embed_url?: string | null;
          reason?: EmbedRefusal | null;
        } | null;
        if (cancelled) return;
        setMinted({
          key,
          src: res.ok ? (body?.embed_url ?? null) : null,
          reason: res.ok ? (body?.embed_url ? null : (body?.reason ?? "refused")) : "error",
        });
      } catch {
        if (!cancelled) setMinted({ key, src: null, reason: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appId, url, nonce, key]);

  const fresh = minted?.key === key ? minted : null;
  return {
    src: fresh?.src ?? url,
    signedIn: Boolean(fresh?.src),
    reason: fresh?.reason ?? null,
  };
}

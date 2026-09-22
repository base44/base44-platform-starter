/**
 * The URL a frame should actually load: the same app, with the viewer signed in.
 *
 * Every surface that embeds an app — the Apps page, the Home widgets, the market
 * modal, the builder preview — computes a URL from the app's slug or its listing
 * snapshot. This hook takes that URL and, when it can, trades it for one that
 * carries a one-time embed token, so the app knows who is looking at it.
 *
 * Minting happens here rather than in `usableApps` because the token is
 * single-use and lives 60 seconds: it belongs to *this* frame load, not to a list
 * that a page may hold for minutes. Remount (a new `nonce`, a different app) and
 * a fresh token is minted; nothing is cached, and the URL never outlives the
 * frame it was made for.
 *
 * `signedOut` is not a failure. An app that has never been deployed has no live
 * host to redeem a token on, and the platform refuses to mint for an app's owner
 * or editors, so a frame falls back to exactly what it loaded before this
 * existed. Callers that want to explain themselves can read `reason`.
 *
 * Pass the returned `src` to **both** the iframe and `useAppFrameAuth`: the
 * install-token handshake validates the frame's origin against the URL it was
 * embedded from, and a minted URL is on the app's live host rather than its
 * sandbox preview.
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
  // One frame load, one identity. The mint result is stored under that key and
  // read back only for the same one, so a changed app, URL or nonce falls back
  // to the plain URL until its own token arrives — no stale token, and nothing
  // to reset when the key changes.
  const key = `${appId}:${url}:${nonce}`;
  const [minted, setMinted] = useState<{ key: string; src: string | null; reason: EmbedFrameSrc["reason"] } | null>(null);
  // React 18 runs effects twice in development. Without this the second pass
  // spends a second token and reloads the frame under the viewer.
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

import React, { useEffect, useRef, useState } from "react";

import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { useEmbedSrc } from "@/lib/embedFrame";

/** The market's embed runs somebody else's code, so it is confined. */
export const APP_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups";

/**
 * A market card's picture: the app itself when the viewer can open it, else the
 * screenshot taken at publish time. Base44 never screenshots an app that needs a
 * login, which is every Sunny app, so the screenshot is usually missing.
 */
export default function ListingPreview({ listing, live, fallback }) {
  const frameRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const url = live ? listing.app_url ?? null : null;
  const { src, signedIn, reason } = useEmbedSrc(listing.app_id, url);
  useAppFrameAuth(frameRef, listing.app_id, src);
  useEffect(() => { setLoaded(false); }, [src]);
  // Wait for the mint: the bare URL of a login-only app frames a sign-in page first.
  const settled = signedIn || reason !== null;

  return (
    <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-card">
      {!loaded && fallback}
      {url && settled && (
        <iframe
          key={src}
          ref={frameRef}
          src={src}
          title={`${listing.title} preview`}
          tabIndex={-1}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className="pointer-events-none absolute inset-0 h-full w-full border-0"
          style={{ visibility: loaded ? "visible" : "hidden" }}
          sandbox={APP_SANDBOX}
        />
      )}
    </div>
  );
}

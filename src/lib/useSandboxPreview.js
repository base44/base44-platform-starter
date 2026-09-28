"use client";

import { useEffect, useState } from "react";
import * as platform from "@/lib/base44Platform";

function previewUrl(result) {
  const raw = result?.preview_url || result?.url;
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (result.preview_token) url.searchParams.set("_preview_token", result.preview_token);
    url.searchParams.set("server_url", url.origin);
    url.searchParams.set("hide_badge", "true");
    url.searchParams.set("analytics-enable", "false");
    return url.href;
  } catch {
    return null;
  }
}

/** Fresh sandbox URL for an app its author can edit, including its short-lived token. */
export function useSandboxPreview(appId, version = 0) {
  const [result, setResult] = useState({ appId: null, version: null, url: null, error: "" });

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        try {
          const url = previewUrl(await platform.getPreviewUrl(appId));
          if (url) {
            if (!cancelled) setResult({ appId, version, url, error: "" });
            return;
          }
        } catch (err) {
          if (attempt === 19 && !cancelled) {
            setResult({ appId, version, url: null, error: err.message || "Preview unavailable." });
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!cancelled) setResult({ appId, version, url: null, error: "The preview is not ready yet." });
    })();
    return () => { cancelled = true; };
  }, [appId, version]);

  return result.appId === appId && result.version === version
    ? { url: result.url, error: result.error }
    : { url: null, error: "" };
}

"use client";

import { useEffect, useState } from "react";
import * as actions from "../../server/actions";
import { unwrap } from "../unwrap";
import type { App } from "../../types";
import Base44Preview from "./Base44Preview";

export default function PreviewFrame({ app, live = false, title, showControls }: { app: App; live?: boolean; title: string; showControls?: boolean }) {
  const latestBuildUrl = useLatestBuildUrl(app);
  return <Base44Preview
    appId={app.id}
    title={title}
    live={live}
    showControls={showControls}
    staticUrl={latestBuildUrl}
    screenshotUrl={app.preview_screenshot_url}
    loadPreview={(appId) => unwrap(actions.getPreviewUrl(appId))}
  />;
}

// A one-time sign-in URL for the app's latest build, fetched when the frame
// mounts and again after each build. Without one, the screenshot shows instead.
function useLatestBuildUrl(app: App) {
  const [url, setUrl] = useState<string>();
  const building = app.status?.state === "processing";
  useEffect(() => {
    if (building) return;
    let current = true;
    unwrap(actions.getLatestBuildUrl(app.id)).then((r) => current && setUrl(r.url ?? undefined), () => {});
    return () => { current = false; };
  }, [app.id, building]);
  return url;
}

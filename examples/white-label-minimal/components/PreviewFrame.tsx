"use client";

import { getPreviewUrl } from "../lib/chat/builder-api";
import type { App } from "../lib/types";
import Base44Preview from "./Base44Preview";

export default function PreviewFrame({ app, live = false, title, showControls }: { app: App; live?: boolean; title: string; showControls?: boolean }) {
  return <Base44Preview
    appId={app.id}
    title={title}
    live={live}
    showControls={showControls}
    staticUrl={app.static_preview_url}
    screenshotUrl={app.preview_screenshot_url}
    loadPreview={getPreviewUrl}
  />;
}

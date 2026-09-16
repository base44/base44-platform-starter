"use client";

import { getPreviewUrl } from "../lib/chat/builder-api";
import type { App } from "../lib/types";
import Base44Preview, { type Base44PreviewProps } from "./Base44Preview";

export default function PreviewFrame({ app, live = false, title, showControls, onStatusChange }: { app: App; live?: boolean; title: string } & Pick<Base44PreviewProps, "showControls" | "onStatusChange">) {
  return <Base44Preview
    appId={app.id}
    title={title}
    live={live}
    showControls={showControls}
    onStatusChange={onStatusChange}
    staticUrl={app.static_preview_url}
    screenshotUrl={app.preview_screenshot_url}
    loadPreview={getPreviewUrl}
  />;
}

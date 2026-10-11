"use client";
import { useEffect, useState } from "react";
import { getPreviewUrl, type App } from "../server/base44";

// The app's latest build. Once the app is building, the live sandbox loads behind it, then
// takes over and shows each change as it lands.
export default function AppPreview({ app, live }: { app: App | null; live: boolean }) {
  const [latestUrl, setLatestUrl] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [shown, setShown] = useState<"latest" | "live" | null>(null);

  useEffect(() => {
    if (app) getPreviewUrl(app.id, "latest_preview").then(setLatestUrl, console.error);
  }, [app]);

  useEffect(() => {
    if (app && live) getPreviewUrl(app.id, "live_preview").then(setLiveUrl, console.error);
  }, [app, live]);

  if (!app) {
    return (
      <main className="preview">
        <p className="preview-message">Describe your app in the chat. It shows up here.</p>
      </main>
    );
  }
  return (
    <main className="preview">
      {!shown && (
        <p className="preview-message">Starting the preview…</p>
      )}
      {latestUrl && shown !== "live" && (
        <iframe src={latestUrl} title={app.name} onLoad={() => setShown("latest")} className="preview-frame" />
      )}
      {liveUrl && (
        <iframe src={liveUrl} title={app.name} onLoad={() => setShown("live")} className="preview-frame" data-hidden={shown !== "live"} />
      )}
    </main>
  );
}

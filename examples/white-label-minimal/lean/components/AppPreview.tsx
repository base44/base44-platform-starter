"use client";
import { useEffect, useState } from "react";
import { getPreviewUrl, bootLivePreview } from "../server/base44";
import type { App } from "../types";

// The app's latest build. Once the app is building, the live sandbox boots and loads
// behind it, then takes over and shows each change as it lands. Workspace remounts it per app.
export default function AppPreview({ app, live }: { app: App | null; live: boolean }) {
  const [latestUrl, setLatestUrl] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [shown, setShown] = useState<"latest" | "live" | null>(null);
  // A new app has no build yet, so it goes straight to the sandbox.
  const [noBuild, setNoBuild] = useState(false);

  useEffect(() => {
    if (app) getPreviewUrl(app.id, "latest_preview").then((url) => (url ? setLatestUrl(url) : setNoBuild(true)), console.error);
  }, [app]);

  useEffect(() => {
    if (!app || !(live || noBuild)) return;
    let stopped = false;
    async function load() {
      while (!stopped && !(await bootLivePreview(app!.id))) await new Promise((resolve) => setTimeout(resolve, 3000));
      if (!stopped) setLiveUrl(await getPreviewUrl(app!.id, "live_preview"));
    }
    load().catch(console.error);
    return () => {
      stopped = true;
    };
  }, [app, live, noBuild]);

  if (!app) {
    return (
      <main className="flex h-full items-center justify-center bg-muted p-6 text-sm text-muted-foreground">
        Describe your app in the chat. It shows up here.
      </main>
    );
  }
  return (
    <main className="relative h-full">
      {!shown && (
        <p className="absolute inset-0 flex items-center justify-center bg-muted text-sm text-muted-foreground">Starting the preview…</p>
      )}
      {latestUrl && shown !== "live" && (
        <iframe src={latestUrl} title={app.name} onLoad={() => setShown("latest")} className="absolute inset-0 size-full border-0" />
      )}
      {liveUrl && (
        <iframe src={liveUrl} title={app.name} onLoad={() => setShown("live")} className={`absolute inset-0 size-full border-0 ${shown === "live" ? "" : "invisible"}`} />
      )}
    </main>
  );
}

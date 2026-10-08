"use client";
import { useEffect, useState } from "react";
import { getPreviewUrl } from "../server/base44";
import type { App } from "../types";

// The app's latest build. Changes from a build show when the app is opened again.
// Workspace remounts it per app.
export default function AppPreview({ app }: { app: App | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (app) getPreviewUrl(app.id).then(setUrl, console.error);
  }, [app]);

  if (!app) {
    return (
      <main className="flex h-full items-center justify-center bg-muted p-6 text-sm text-muted-foreground">
        Describe your app in the chat. It shows up here.
      </main>
    );
  }
  return (
    <main className="relative h-full">
      {!loaded && (
        <p className="absolute inset-0 flex items-center justify-center bg-muted text-sm text-muted-foreground">Starting the preview…</p>
      )}
      {url && <iframe src={url} title={app.name} onLoad={() => setLoaded(true)} className="size-full border-0" />}
    </main>
  );
}

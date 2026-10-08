"use client";
import { useEffect, useState } from "react";
import type { Base44App } from "../sdk";
import { listApps } from "../server/base44";
import AppPreview from "./AppPreview";
import Chat from "./chats/Chat";
import Header from "./Header";

// Tiny's one screen. The selected app drives the preview and the chat.
export default function Workspace() {
  const [apps, setApps] = useState<Base44App[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? null;

  useEffect(() => {
    listApps().then(setApps, console.error);
  }, []);

  function onAppCreated(app: Base44App) {
    setApps((all) => [app, ...all]);
    setSelectedAppId(app.id);
  }

  return (
    <div className="grid h-dvh grid-cols-[1fr_400px] grid-rows-[auto_minmax(0,1fr)]">
      <Header apps={apps} selectedAppId={selectedAppId} onSelectApp={setSelectedAppId} />
      {/* The chat comes first in the page so its server call goes first: Next.js runs a page's
          server calls one at a time, and the preview's can wait half a minute for the sandbox. */}
      <div className="col-start-2 row-start-2 min-h-0">
        <Chat key={`chat-${selectedAppId}`} app={selectedApp} onAppCreated={onAppCreated} />
      </div>
      <div className="col-start-1 row-start-2 min-h-0">
        <AppPreview key={`preview-${selectedAppId}`} app={selectedApp} />
      </div>
    </div>
  );
}

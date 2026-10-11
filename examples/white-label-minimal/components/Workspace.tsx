"use client";
import { useCallback, useEffect, useState } from "react";
import { listApps, type App } from "../server/base44";
import AppPreview from "./AppPreview";
import Chat from "./Chat";
import Header from "./Header";

export default function Workspace() {
  const [apps, setApps] = useState<App[]>([]);
  const [appId, setAppId] = useState<string | null>(null);
  const [liveAppId, setLiveAppId] = useState<string | null>(null);
  const app = apps.find((a) => a.id === appId) ?? null;

  useEffect(() => {
    listApps().then(setApps, console.error);
  }, []);

  function onAppCreated(created: App) {
    setApps((all) => [created, ...all]);
    setAppId(created.id);
  }

  // A build switches the preview to the live sandbox. When it ends, the list picks up a new app's name.
  const onBuildingChange = useCallback(
    (building: boolean) => {
      if (building) setLiveAppId(appId);
      else if (liveAppId === appId) listApps().then(setApps, console.error);
    },
    [appId, liveAppId],
  );

  return (
    <div className="grid h-dvh grid-cols-[1fr_400px] grid-rows-[auto_minmax(0,1fr)]">
      <Header apps={apps} selectedAppId={appId} onSelectApp={setAppId} />
      <div className="min-h-0">
        <AppPreview key={appId} app={app} live={liveAppId === appId} />
      </div>
      <div className="min-h-0">
        <Chat key={appId} app={app} onAppCreated={onAppCreated} onBuildingChange={onBuildingChange} />
      </div>
    </div>
  );
}

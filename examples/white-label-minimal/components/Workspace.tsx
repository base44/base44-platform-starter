"use client";
import { useCallback, useEffect, useState } from "react";
import { Base44ChatProvider, useChatState, type Base44ChatBackend } from "@base44/platform/react";
import { createApp, listApps, openLiveSession, sendMessage, submitToolCallInput, type App } from "../server/base44";
import AppPreview from "./AppPreview";
import Chat, { Step, Text } from "./Chat";
import Header from "./Header";
import { questionParts } from "./QuestionParts";

// The four Base44 calls, run on the server. The chat calls them, so the browser never holds a key.
const backend: Base44ChatBackend = { createApp, openLiveSession, sendMessage, submitToolCallInput };
// Tiny's parts. Every question kind needs one; the text and step parts are optional.
const components = { message: { Text, Step }, question: questionParts };

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

  const onBuildingChange = useCallback(
    (building: boolean) => {
      if (building) setLiveAppId(appId);
      else if (liveAppId === appId) listApps().then(setApps, console.error);
    },
    [appId, liveAppId],
  );

  // One provider above everything that reads the chat.
  return (
    <Base44ChatProvider appId={appId} backend={backend} onAppCreated={onAppCreated} components={components}>
      <div className="workspace">
        <Header apps={apps} selectedAppId={appId} onSelectApp={setAppId} />
        <AppPreview key={`preview-${appId}`} app={app} live={liveAppId === appId} />
        <Chat hasApp={!!app} />
        <BuildWatcher onBuildingChange={onBuildingChange} />
      </div>
    </Base44ChatProvider>
  );
}

// Tells the workspace when a build starts and ends, so the preview goes live and the app list refreshes.
function BuildWatcher({ onBuildingChange }: { onBuildingChange: (building: boolean) => void }) {
  const building = useChatState().status === "building";
  useEffect(() => {
    onBuildingChange(building);
  }, [building, onBuildingChange]);
  return null;
}

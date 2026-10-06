"use client";
import { useState } from "react";
import { mockApps } from "../mock-apps";
import AppPreview from "./AppPreview";
import Chat from "./Chat";
import Header from "./Header";

// Tiny's one screen. The only state is which app is selected; the three panels read it.
export default function Workspace() {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const selectedApp = mockApps.find((app) => app.id === selectedAppId) ?? null;

  return (
    <div className="grid h-dvh grid-cols-[1fr_400px] grid-rows-[auto_minmax(0,1fr)]">
      <Header apps={mockApps} selectedAppId={selectedAppId} onSelectApp={setSelectedAppId} />
      <AppPreview app={selectedApp} />
      {/* A new key per app starts a fresh conversation. */}
      <Chat key={selectedAppId ?? "new"} app={selectedApp} />
    </div>
  );
}

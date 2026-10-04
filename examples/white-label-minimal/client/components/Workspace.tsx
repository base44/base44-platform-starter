"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ArrowLeft, LogOut, Plus } from "lucide-react";
import type { App } from "../../types";
import { useApps } from "../useApps";
import AppsPage from "./AppsPage";
import Builder from "./Builder";
import EditorPanel from "./EditorPanel";
import PreviewFrame from "./PreviewFrame";
import TinySunnyLogo from "./TinySunnyLogo";

// Tiny's one screen: the apps page or an open app, with the assistant beside it.
export default function Workspace({ name }: { name: string }) {
  const apps = useApps();
  const [showApp, setShowApp] = useState(false);
  // The app in the assistant, or null for a new one. A new key starts a fresh conversation.
  const [editor, setEditor] = useState<{ app: App | null; key: number }>({ app: null, key: 0 });
  const [panelOpen, setPanelOpen] = useState(false);
  const title = editor.app?.name || "";

  function openApp(app: App | null) {
    setEditor((current) => ({ app, key: current.key + 1 }));
    setShowApp(true);
    setPanelOpen(true);
  }

  function backToApps() {
    setEditor((current) => ({ app: null, key: current.key + 1 }));
    setShowApp(false);
    setPanelOpen(false);
  }

  // Keep the key: the conversation that created the app goes on.
  function onCreated(app: App) {
    apps.add(app);
    setEditor((current) => ({ ...current, app }));
    setShowApp(true);
  }

  const { update } = apps;
  const onUpdated = useCallback((app: App) => {
    update(app);
    setEditor((current) => (current.app?.id === app.id ? { ...current, app } : current));
  }, [update]);

  return (
    <div className="workspace">
      <header className="topbar">
        <Link href="/" aria-label="Tiny Sunny home">
          <TinySunnyLogo />
        </Link>
        <div className="account">
          <button className="secondary" onClick={() => openApp(null)}>
            <Plus size={16} /> New app
          </button>
          <span>{name}</span>
          <button className="icon-button" aria-label="Sign out" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="workspace-body">
        {showApp ? (
          <main className="app-stage">
            <header className="stage-heading">
              <button className="secondary" onClick={backToApps}>
                <ArrowLeft size={16} /> All apps
              </button>
              <strong>{title || "New app"}</strong>
            </header>
            <div className="stage-body">
              {editor.app ? (
                <PreviewFrame key={editor.app.id} app={editor.app} live title={`${editor.app.name || "Untitled"} preview`} />
              ) : (
                <div className="widget-placeholder">
                  Describe what you want to build. The preview appears here once the app exists.
                </div>
              )}
            </div>
          </main>
        ) : (
          <AppsPage
            apps={apps.apps}
            loading={apps.loading}
            removing={apps.removing}
            error={apps.error}
            onRetry={apps.reload}
            onCreate={() => openApp(null)}
            onOpen={openApp}
            onRemove={(app) => void apps.remove(app)}
          />
        )}

        <EditorPanel
          title={title || "Build an app"}
          editing={!!editor.app}
          open={panelOpen}
          onOpen={() => setPanelOpen(true)}
          onClose={() => setPanelOpen(false)}
        >
          <Builder
            key={editor.key}
            initialAppId={editor.app?.id}
            autoFocus={editor.key > 0 && !editor.app}
            onCreated={onCreated}
            onUpdated={onUpdated}
            onGoHome={backToApps}
          />
        </EditorPanel>
      </div>
    </div>
  );
}

"use client";
import type { App } from "../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ArrowLeft, Grid2X2, Loader2, LogOut, MessageSquare, Plus, Sparkles, X } from "lucide-react";
import TinySunnyLogo from "./TinySunnyLogo";
import * as actions from "../app/actions";
import { unwrap } from "../lib/chat/unwrap";
import Builder from "./Builder";
import AppWidget from "./AppWidget";
import PreviewFrame from "./PreviewFrame";

export default function Workspace({ name }: { name: string }) {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [inApp, setInApp] = useState(false);
  // What the stage shows. Kept apart from `editor` so an app created mid-chat
  // can appear beside the conversation without remounting the Builder.
  const [stageApp, setStageApp] = useState<App | null>(null);
  // Bumping `version` remounts the Builder with a fresh conversation.
  const [editor, setEditor] = useState<{ app: App | null; version: number }>({ app: null, version: 0 });
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const editorPanel = useRef<HTMLElement>(null);
  const assistantButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const activeName = stageApp?.name || "";

  useEffect(() => {
    if (mobileEditorOpen && window.matchMedia("(max-width: 760px)").matches) closeButton.current?.focus();
  }, [mobileEditorOpen]);
  useEffect(() => {
    if (editor.version > 0 && !editor.app)
      editorPanel.current?.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
  }, [editor.version, editor.app]);

  const load = useCallback(async () => {
    try {
      const all: App[] = [];
      for (let skip = 0; ; ) {
        const page = await unwrap(actions.listApps(skip));
        all.push(...page.apps);
        if (!page.hasMore) break;
        if (page.nextSkip <= skip) throw new Error("Could not load the next page of apps.");
        skip = page.nextSkip;
      }
      setApps(all);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your apps.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // useState setters are stable, so this callback is too.
  const updateApp = useCallback((app: App) => {
    setApps((current) => current.map((item) => (item.id === app.id ? app : item)));
    setStageApp((current) => (current?.id === app.id ? app : current));
    setEditor((current) => (current.app?.id === app.id ? { ...current, app } : current));
  }, [setApps, setStageApp, setEditor]);

  function openApp(app: App | null = null) {
    setStageApp(app);
    setEditor((current) => ({ app, version: current.version + 1 }));
    setInApp(true);
    setMobileEditorOpen(true);
  }
  function backToApps() {
    setInApp(false);
    setMobileEditorOpen(false);
    setStageApp(null);
    setEditor((current) => ({ app: null, version: current.version + 1 }));
  }
  function closeAssistant() {
    setMobileEditorOpen(false);
    assistantButton.current?.focus();
  }
  function onCreated(app: App) {
    setStageApp(app);
    setApps((current) => [app, ...current]);
    // Adopt the app without bumping the version: the conversation that just
    // created it has to survive.
    setEditor((current) => ({ ...current, app }));
    setInApp(true);
  }

  async function removeApp(app: App) {
    if (removing) return;
    setRemoving(app.id);
    setError("");
    try {
      await unwrap(actions.removeApp(app.id));
      setApps((current) => current.filter((item) => item.id !== app.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the app.");
    } finally {
      setRemoving(null);
    }
  }
  return (
    <div className="workspace">
      <header className="topbar">
        <Link href="/" aria-label="Tiny Sunny home">
          <TinySunnyLogo />
        </Link>
        <div className="account">
          <button className="secondary" onClick={() => openApp()}>
            <Plus size={16} /> New app
          </button>
          <span>{name}</span>
          <button className="icon-button" aria-label="Sign out" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <div className="workspace-body">
        {!inApp ? (
          <main className="apps-page">
            <div className="apps-content">
              {error && (
                <div role="alert" className="error">
                  <p>{error}</p>
                  <button className="secondary" onClick={() => load()}>Try again</button>
                </div>
              )}
              {loading && !apps.length ? (
                <div className="empty-state" role="status">
                  <Loader2 className="spin" />
                  <p>Loading your apps…</p>
                </div>
              ) : !error && !apps.length ? (
                <div className="empty-state">
                  <Grid2X2 size={28} />
                  <h2>Make room for your first idea</h2>
                  <p>Tell the assistant what you want to build.</p>
                  <button onClick={() => openApp()}>
                    <Plus size={16} /> Create an app
                  </button>
                </div>
              ) : (
                <div className="apps-grid">
                  {apps.map((app) => (
                    <AppWidget
                      key={app.id}
                      app={app}
                      removing={!!removing || loading}
                      onEdit={() => openApp(app)}
                      onRemove={() => void removeApp(app)}
                    />
                  ))}
                </div>
              )}
            </div>
          </main>
        ) : (
          <main className="app-stage">
            <header className="stage-heading">
              <button className="secondary" onClick={backToApps}>
                <ArrowLeft size={16} /> All apps
              </button>
              <strong>{activeName || "New app"}</strong>
            </header>
            <div className="stage-body">
              {stageApp ? (
                <PreviewFrame key={stageApp.id} app={stageApp} live title={`${stageApp.name || "Untitled"} preview`} />
              ) : (
                <div className="widget-placeholder">
                  Describe what you want to build. The preview appears here once the app exists.
                </div>
              )}
            </div>
          </main>
        )}
        <button
          ref={assistantButton}
          className="mobile-assistant"
          onClick={() => setMobileEditorOpen(true)}
          aria-expanded={mobileEditorOpen}
          aria-controls="app-editor"
        >
          <MessageSquare size={18} /> Assistant
        </button>
        <section
          ref={editorPanel}
          id="app-editor"
          className={`editor-panel ${mobileEditorOpen ? "is-open" : ""} ${editor.app ? "is-editing" : ""}`}
          aria-label="App editor"
          onKeyDown={(e) => e.key === "Escape" && closeAssistant()}
        >
          <header className="editor-heading">
            <div>
              {editor.app ? (
                <span className="editing-badge">
                  <span className="editing-flare" aria-hidden="true" />
                  Editing
                </span>
              ) : (
                <Sparkles size={14} />
              )}
              <strong>{activeName || "Build an app"}</strong>
            </div>
            <div>
              <button ref={closeButton} className="icon-button mobile-close" aria-label="Close assistant" onClick={closeAssistant}>
                <X size={20} />
              </button>
            </div>
          </header>
          <Builder
            key={editor.version}
            initialAppId={editor.app?.id}
            onUpdated={updateApp}
            onGoHome={backToApps}
            onCreated={onCreated}
          />
        </section>
      </div>
    </div>
  );
}

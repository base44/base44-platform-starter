"use client";
import type { App } from "../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ArrowLeft, Grid2X2, Loader2, LogOut, MessageSquare, Plus, Sparkles, X } from "lucide-react";
import TinySunnyLogo from "./TinySunnyLogo";
import * as api from "../lib/chat/builder-api";
import Builder from "./Builder";
import AppWidget from "./AppWidget";
import PreviewFrame from "./PreviewFrame";

export default function Workspace({ name }: { name: string }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const editorPanel = useRef<HTMLElement>(null);
  const assistantButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsConnection, setNeedsConnection] = useState(false);
  // What the stage shows. Kept apart from `editor` so an app created mid-chat
  // can appear beside the conversation without remounting the Builder.
  const [stageApp, setStageApp] = useState<App | null>(null);
  const [editor, setEditor] = useState<{ app: App | null; version: number }>({
    app: null,
    version: 0,
  });
  const [inApp, setInApp] = useState(false);
  function closeAssistant() {
    setMobileEditorOpen(false);
    assistantButton.current?.focus();
  }
  const [activeName, setActiveName] = useState("");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  useEffect(() => {
    if (mobileEditorOpen && window.matchMedia("(max-width: 760px)").matches)
      closeButton.current?.focus();
  }, [mobileEditorOpen]);
  useEffect(() => {
    if (editor.version > 0 && !editor.app)
      editorPanel.current?.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
  }, [editor.version, editor.app]);
  const updateApp = useCallback((app: App) => {
    setActiveName(app.name || "");
    setApps((current) => current.map((item) => (item.id === app.id ? app : item)));
    setStageApp((current) => (current?.id === app.id ? app : current));
    setEditor((current) => (current.app?.id === app.id ? { ...current, app } : current));
    // useState setters are stable, so this stays a stable callback; naming them
    // is what lets the React Compiler keep the memoization.
  }, [setActiveName, setApps, setStageApp, setEditor]);
  function openApp(app: App | null = null) {
    setActiveName(app?.name || "");
    setStageApp(app);
    setEditor((current) => ({ app, version: current.version + 1 }));
    setInApp(true);
    setMobileEditorOpen(true);
  }
  function backToApps() {
    setInApp(false);
    setMobileEditorOpen(false);
    setStageApp(null);
    setActiveName("");
    setEditor((current) => ({ app: null, version: current.version + 1 }));
  }
  const load = useCallback(() => {
    return (async () => {
      const allApps: App[] = [];
      let skip = 0;
      while (true) {
        const page = await api.listApps(skip);
        allApps.push(...page.apps);
        if (!page.hasMore) return allApps;
        if (page.nextSkip <= skip) throw new Error("Could not load the next page of apps.");
        skip = page.nextSkip;
      }
    })()
      .then((result) => {
        setError("");
        setApps(result);
        setNeedsConnection(false);
      })
      .catch((err) => {
        if (err instanceof api.ApiError && err.status === 428) setNeedsConnection(true);
        else setError(err instanceof Error ? err.message : "Could not load your apps.");
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function removeApp(app: App) {
    if (removing) return;
    setRemoving(app.id);
    setError("");
    try {
      await api.removeApp(app.id);
      setApps((current) => current.filter((item) => item.id !== app.id));
      // No guard for "was the open app removed": the cards only exist on the
      // home page, and stageApp is only set once you are inside an app.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the app.");
    } finally {
      setRemoving(null);
    }
  }
  async function connect() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/base44/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      if (!response.ok) throw new Error("Could not connect your workspace. Please try again.");
      setNeedsConnection(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }
  return (
    <div className="workspace">
      <header className="topbar">
        <Link href="/" aria-label="Tiny Sunny home">
          <TinySunnyLogo />
        </Link>
        <div className="account">
          <button className="secondary" onClick={() => openApp()} disabled={needsConnection}>
            <Plus size={16} /> New app
          </button>
          <span>{name}</span>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
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
                  <button className="secondary" onClick={() => load()}>
                    Try again
                  </button>
                </div>
              )}
              {needsConnection ? (
                <div className="empty-state">
                  <MessageSquare size={28} />
                  <h2>Your ideas start here</h2>
                  <p>Connect your workspace to build your first app.</p>
                  <button disabled={loading} onClick={connect}>
                    {loading ? "Connecting…" : "Connect workspace"}
                  </button>
                </div>
              ) : loading && !apps.length ? (
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
              <button ref={backButton} className="secondary" onClick={backToApps}>
                <ArrowLeft size={16} /> All apps
              </button>
              <strong>{activeName || "New app"}</strong>
            </header>
            <div className="stage-body">
              {stageApp ? (
                <PreviewFrame
                  key={stageApp.id}
                  app={stageApp}
                  live
                  title={`${stageApp.name || "Untitled"} preview`}
                />
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
            className={`editor-panel ${mobileEditorOpen ? "is-open" : ""} ${
            editor.app ? "is-editing" : ""
          }`}
            aria-label="App editor"
            onKeyDown={(e) => {
              if (e.key === "Escape") closeAssistant();
            }}
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
                <button
                  ref={closeButton}
                  className="icon-button mobile-close"
                  aria-label="Close assistant"
                  onClick={closeAssistant}
                >
                  <X size={20} />
                </button>
              </div>
            </header>
            <Builder
              key={editor.version}
              initialAppId={editor.app?.id}
              onUpdated={updateApp}
              onGoHome={backToApps}
              onCreated={(app) => {
                setActiveName(app.name || "");
                setStageApp(app);
                setApps((current) => [app, ...current]);
                // Adopt the app without bumping the version: the conversation
                // that just created it has to survive.
                setEditor((current) => ({ ...current, app }));
                setInApp(true);
              }}
            />
        </section>
      </div>
    </div>
  );
}

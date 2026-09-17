"use client";
import type { App } from "../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Grid2X2, Loader2, LogOut, MessageSquare, Plus, X, Sparkles } from "lucide-react";
import TinySunnyLogo from "./TinySunnyLogo";
import * as api from "../lib/chat/builder-api";
import Builder from "./Builder";
import AppPreview from "./AppPreview";
import AppWidget from "./AppWidget";

export default function Workspace({ name }: { name: string }) {
  const [liveApps, setLiveApps] = useState<Set<string>>(() => new Set());
  const activeAppId = useRef<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const editorPanel = useRef<HTMLElement>(null);
  const assistantButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [previewApp, setPreviewApp] = useState<App | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsConnection, setNeedsConnection] = useState(false);
  const [editor, setEditor] = useState<{ app: App | null; version: number }>({
    app: null,
    version: 0,
  });
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
    activeAppId.current = app.id;
    setActiveName(app.name || "");
    setApps((current) => current.map((item) => (item.id === app.id ? app : item)));
    setEditor((current) => (current.app?.id === app.id ? { ...current, app } : current));
  }, []);
  function openEditor(app: App | null = null) {
    if (app) setLiveApps(current => new Set(current).add(app.id));
    activeAppId.current = app?.id || null;
    setActiveName(app?.name || "");
    setEditor((current) => ({ app, version: current.version + 1 }));
    setMobileEditorOpen(true);
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
      if (activeAppId.current === app.id) openEditor();
      if (previewApp?.id === app.id) setPreviewApp(null);
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
  const editingExisting = !!editor.app;
  return (
    <div className="workspace">
      <header className="topbar">
        <Link href="/" aria-label="Tiny Sunny home">
          <TinySunnyLogo />
        </Link>
        <div className="account">
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
      {previewApp && <AppPreview key={previewApp.id} app={previewApp} live={liveApps.has(previewApp.id)} onClose={() => setPreviewApp(null)} />}
      <div className="workspace-body">
        <main className="apps-page">
          <div className="page-heading">
            <h1>Apps</h1>
          </div>
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
                <button onClick={() => openEditor()}>
                  <Plus size={16} /> Create an app
                </button>
              </div>
            ) : (
              <div className="apps-grid">
                {apps.map((app) => (
                  <AppWidget key={app.id} app={app} live={liveApps.has(app.id)} removing={!!removing || loading}
                    editing={editor.app?.id === app.id}
                    onEdit={() => openEditor(app)} onRemove={() => void removeApp(app)}
                    onExpand={() => setPreviewApp(app)} />
                ))}
              </div>
            )}

          </div>
        </main>
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
            editingExisting ? "is-editing" : ""
          }`}
          aria-label="App editor"
          onKeyDown={(e) => {
            if (e.key === "Escape") closeAssistant();
          }}
        >
          <header className="editor-heading">
            <div>
              {editingExisting ? (
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
              {apps.length > 0 && <button className="secondary" onClick={() => openEditor()} disabled={needsConnection}>
                <Plus size={16} /> New app
              </button>}
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
            key={`${editor.app?.id || "new"}:${editor.version}`}
            initialAppId={editor.app?.id}
            onUpdated={updateApp}
            onPreview={app => { setLiveApps(current => new Set(current).add(app.id)); setPreviewApp(app); }}
            onCreated={(app) => {
              setLiveApps(current => new Set(current).add(app.id));
              activeAppId.current = app.id;
              setApps((current) => [app, ...current]);
            }}
          />
        </section>
      </div>
    </div>
  );
}

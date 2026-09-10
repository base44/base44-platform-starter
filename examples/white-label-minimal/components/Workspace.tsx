"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Grid2X2, Loader2, LogOut, MessageSquare, Pencil, Plus } from "lucide-react";
import SunnyLogo from "@/components/SunnyLogo";
import * as api from "../lib/base44-client";
import Builder from "./Builder";

export default function Workspace({ name }: { name: string }) {
  const [apps, setApps] = useState<api.App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsConnection, setNeedsConnection] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [editor, setEditor] = useState<{ app: api.App | null; version: number }>({ app: null, version: 0 });
  const load = useCallback((skip = 0) => api.listApps(skip)
    .then(result => {
      setError("");
      setApps(current => skip ? [...current, ...result.apps] : result.apps);
      setHasMore(result.hasMore);
      setNeedsConnection(false);
    })
    .catch(err => {
      if (err instanceof api.ApiError && err.status === 428) setNeedsConnection(true);
      else setError(err instanceof Error ? err.message : "Could not load your apps.");
    })
    .finally(() => setLoading(false)), []);
  useEffect(() => {
    void load();
  }, [load]);
  async function connect() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/base44/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      if (!response.ok) throw new Error("Could not connect your workspace. Please try again.");
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
          <SunnyLogo className="sunny-logo" />
        </Link>
        <span className="tiny-label">tiny</span>
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
      <div className="workspace-body">
        <main className="apps-page">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Workspace</p>
              <h1>My apps</h1>
              <p>Apps you built. Open one to keep creating.</p>
            </div>
            <button onClick={() => setEditor(current => ({ app: null, version: current.version + 1 }))} disabled={needsConnection}>
              <Plus size={16} /> New app
            </button>
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
                <button onClick={() => setEditor(current => ({ app: null, version: current.version + 1 }))}>
                  <Plus size={16} /> Create an app
                </button>
              </div>
            ) : (
              <div className="apps-grid">
                {apps.map((app) => (
                  <article className="app-card" key={app.id}>
                    <button
                      className="app-thumbnail"
                      aria-label={`Open ${app.name || "Untitled"}`}
                      onClick={() => setEditor({ app, version: 0 })}
                    >
                      {app.preview_screenshot_url ? (
                        <img src={app.preview_screenshot_url} alt="" />
                      ) : (
                        <span>{(app.name || "?")[0].toUpperCase()}</span>
                      )}
                    </button>
                    <div className="app-caption">
                      <div>
                        <h2>{app.name || "Untitled"}</h2>
                        <p>{app.user_description || "Built by you"}</p>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${app.name || "Untitled"}`}
                        onClick={() => setEditor({ app, version: 0 })}
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {hasMore && (
              <button
                className="secondary load-more"
                disabled={loading}
                onClick={() => load(apps.length)}
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </main>
        <section className="editor-panel" aria-label="App editor">
          <header className="editor-heading">
            <div>
              <MessageSquare size={18} />
              <strong>{editor.app?.name || "Build an app"}</strong>
            </div>
          </header>
          <Builder
            key={`${editor.app?.id || "new"}:${editor.version}`}
            initialAppId={editor.app?.id}
            onCreated={(app) => {
              setApps((current) => [app, ...current]);
            }}
          />
        </section>
      </div>
    </div>
  );
}

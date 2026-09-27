"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Pencil, Plus, Store, Trash2 } from "lucide-react";
import * as platform from "@/lib/base44Platform";
import { AppOwnership } from "@/lib/entityClient";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { useEmbedSrc } from "@/lib/embedFrame";
import { useAppRebuildNonce, useAppRemoved, withNonce } from "@/lib/appRefresh";
import { useAuth } from "@/lib/AuthContext";
import { useMarketChanges } from "@/lib/marketEvents";
import AppBuilderSidebar from "@/components/AppBuilderSidebar";
import PublishDialog from "@/components/market/PublishDialog";

function previewUrl(result) {
  const raw = result?.preview_url || result?.url;
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (result.preview_token) url.searchParams.set("_preview_token", result.preview_token);
    url.searchParams.set("server_url", url.origin);
    url.searchParams.set("hide_badge", "true");
    url.searchParams.set("analytics-enable", "false");
    return url.href;
  } catch {
    return null;
  }
}

function LivePreview({ app }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const frameRef = useRef(null);
  const rebuildNonce = useAppRebuildNonce(app.id);
  const { src: framedUrl } = useEmbedSrc(app.id, url, rebuildNonce + version, "live_preview");
  useAppFrameAuth(frameRef, app.id, framedUrl);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError("");
    (async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        try {
          const found = previewUrl(await platform.getPreviewUrl(app.id));
          if (found) {
            if (!cancelled) setUrl(found);
            return;
          }
        } catch (err) {
          if (attempt === 19 && !cancelled) setError(err.message);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!cancelled) setError((current) => current || "The live preview is not ready yet.");
    })();
    return () => { cancelled = true; };
  }, [app.id, app.last_git_commit_hash, app.status?.state, version]);

  return <div className="sunny-apps-live" aria-label={`${app.name || "Untitled"} preview`}>
    {url
      ? <iframe ref={frameRef} key={framedUrl} src={framedUrl} title={`${app.name || "Untitled"} preview`} allow="fullscreen" />
      : <div className="sunny-apps-placeholder" role="status">
          {!error && <Loader2 className="animate-spin" size={20} />}
          {error || "Starting your preview…"}
        </div>}
    <div className="sunny-apps-preview-controls">
      <span>{url ? "Live preview" : error || "Starting live preview…"}</span>
      <button onClick={() => setVersion((value) => value + 1)}>Refresh preview</button>
    </div>
  </div>;
}

function StaticPreview({ app }) {
  const frameRef = useRef(null);
  const rebuildNonce = useAppRebuildNonce(app.id);
  const published = app.last_deployed_at ? platform.publishedUrl(app.slug) : null;
  const url = published || platform.previewUrl(app.slug);
  const { src } = useEmbedSrc(app.id, withNonce(url, rebuildNonce), rebuildNonce, published ? null : "latest_preview");
  useAppFrameAuth(frameRef, app.id, src);
  if (!url) return app.preview_screenshot_url || app.logo_url
    ? <img src={app.preview_screenshot_url || app.logo_url} alt="" />
    : <span>No built preview is available yet. Open the assistant to build this app.</span>;
  return <iframe ref={frameRef} src={src} title={`${app.name || "Untitled"} widget preview`} tabIndex={-1} />;
}

export default function MyTools() {
  const { b44Linked } = useAuth();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inApp, setInApp] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [builderAppId, setBuilderAppId] = useState(null);
  const [builderRequest, setBuilderRequest] = useState(0);
  const [publishing, setPublishing] = useState(null);
  const [published, setPublished] = useState(new Set());
  const [removing, setRemoving] = useState(null);

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const list = await platform.listAppsForUser({ limit: 50 });
      setApps(list);
      setError("");
      const requested = new URLSearchParams(window.location.search).get("app");
      const match = requested && list.find((app) => app.id === requested);
      if (match) {
        setSelected(match);
        setBuilderAppId(match.id);
        setBuilderRequest((value) => value + 1);
        setInApp(true);
        setMobileOpen(true);
      }
    } catch (err) {
      setError(err.message || "Could not load your apps.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (b44Linked === true) void loadApps();
    if (b44Linked === false) setLoading(false);
  }, [b44Linked, loadApps]);
  const refreshPublished = useCallback(() => {
    fetch("/api/marketplace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "mine" }),
    })
      .then((response) => response.ok ? response.json() : { listings: [] })
      .then(({ listings = [] }) => setPublished(new Set(
        listings.filter((item) => item.status === "published").map((item) => item.app_id),
      )))
      .catch(() => {});
  }, []);
  useEffect(() => { refreshPublished(); }, [refreshPublished]);
  useMarketChanges(refreshPublished);

  const backToApps = useCallback(() => {
    setInApp(false);
    setMobileOpen(false);
    setSelected(null);
    setBuilderAppId(null);
    setBuilderRequest((value) => value + 1);
  }, []);
  useAppRemoved((appId) => {
    setApps((current) => current.filter((app) => app.id !== appId));
    if (selected?.id === appId) backToApps();
  });
  const openApp = useCallback((app = null) => {
    setSelected(app);
    setBuilderAppId(app?.id || null);
    setBuilderRequest((value) => value + 1);
    setInApp(true);
    setMobileOpen(true);
  }, []);
  const onActiveAppChange = useCallback((app) => {
    if (app) {
      setSelected(app);
      setApps((current) => current.map((item) => item.id === app.id ? { ...item, ...app } : item));
    }
  }, []);
  const onAppCreated = useCallback((app) => {
    setSelected(app);
    setApps((current) => [app, ...current.filter((item) => item.id !== app.id)]);
  }, []);
  async function removeApp(app) {
    if (removing) return;
    setRemoving(app.id);
    setError("");
    try {
      const rows = await AppOwnership.filter({ app_id: app.id });
      for (const row of rows) await AppOwnership.delete(row.id);
      setApps((current) => current.filter((item) => item.id !== app.id));
    } catch (err) {
      setError(err.message || "Could not remove the app from My apps.");
    } finally {
      setRemoving(null);
    }
  }

  return <div className="sunny-apps">
    <div className="sunny-apps-toolbar">
      <strong>My apps</strong>
      <button onClick={() => openApp()}><Plus size={16} /> New app</button>
    </div>
    <div className="sunny-apps-body">
      {inApp ? <main className="sunny-apps-stage">
        <header>
          <button className="sunny-apps-secondary" onClick={backToApps}><ArrowLeft size={16} /> All apps</button>
          <strong>{selected?.name || "New app"}</strong>
        </header>
        <div className="sunny-apps-stage-content">
          {selected
            ? <LivePreview key={selected.id} app={selected} />
            : <div className="sunny-apps-placeholder">Describe what you want to build. The preview appears here once the app exists.</div>}
        </div>
      </main> : <main className="sunny-apps-list">
        {error && <div role="alert" className="sunny-apps-error">{error} <button onClick={loadApps}>Try again</button></div>}
        {loading ? <div className="sunny-apps-placeholder"><Loader2 className="animate-spin" size={20} /> Loading your apps…</div>
          : apps.length === 0 ? <div className="sunny-apps-placeholder">
              <h2>Make room for your first idea</h2>
              <p>Tell the assistant what you want to build.</p>
              <button onClick={() => openApp()}><Plus size={16} /> Create an app</button>
            </div>
          : <div className="sunny-apps-grid">{apps.map((app) => {
              const name = app.name || "Untitled";
              return <article key={app.id} className="sunny-apps-card" aria-label={name}>
                <header>
                  <h2>{name}</h2>
                  {app.status?.state === "processing" && <Loader2 className="animate-spin" size={14} />}
                  <div className="sunny-apps-card-actions">
                    <button aria-label={`Edit ${name}`} title="Open app" onClick={() => openApp(app)}><Pencil size={15} /></button>
                    <button aria-label={`Remove ${name} from My apps`} title="Remove from My apps only" disabled={Boolean(removing)} onClick={() => void removeApp(app)}><Trash2 size={15} /></button>
                    <button aria-label={`Publish ${name}`} title="Publish to Sunny Market" onClick={() => setPublishing(app)}><Store size={15} className={published.has(app.id) ? "text-primary" : ""} /></button>
                  </div>
                </header>
                <button className="sunny-apps-card-preview" onClick={() => openApp(app)} aria-label={`Open ${name}`}>
                  {app.status?.state === "processing"
                    ? <span><Loader2 className="animate-spin" size={20} /> Generating your app…</span>
                    : <StaticPreview app={app} />}
                </button>
              </article>;
            })}</div>}
      </main>}
      <button className="sunny-apps-mobile-toggle" onClick={() => setMobileOpen(true)}>Assistant</button>
      <AppBuilderSidebar
        embedded
        mobileExpanded={mobileOpen}
        open
        onClose={() => setMobileOpen(false)}
        initialMode="build"
        initialAppId={builderAppId}
        requestId={builderRequest}
        onActiveAppChange={onActiveAppChange}
        onAppCreated={onAppCreated}
        onGoHome={backToApps}
      />
    </div>
    {publishing && <PublishDialog app={publishing} onClose={() => setPublishing(null)} onDone={() => {
      setPublished((current) => new Set(current).add(publishing.id));
      setPublishing(null);
    }} />}
  </div>;
}

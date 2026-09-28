"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Pencil, Plus, Store, Trash2 } from "lucide-react";
import Link from "next/link";
import * as platform from "@/lib/base44Platform";
import { AppOwnership } from "@/lib/entityClient";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { useEmbedSrc } from "@/lib/embedFrame";
import { useAppRebuildNonce, useAppRemoved } from "@/lib/appRefresh";
import { useAuth } from "@/lib/AuthContext";
import { useMarketChanges } from "@/lib/marketEvents";
import { marketPublishState } from "@/lib/marketPublishState";
import { useSandboxPreview } from "@/lib/useSandboxPreview";
import AppBuilderSidebar from "@/components/AppBuilderSidebar";
import PublishDialog from "@/components/market/PublishDialog";

function LivePreview({ app }) {
  const [version, setVersion] = useState(0);
  const frameRef = useRef(null);
  const rebuildNonce = useAppRebuildNonce(app.id);
  const { url, error } = useSandboxPreview(app.id, `${rebuildNonce}:${app.last_git_commit_hash || ""}:${app.status?.state || ""}:${version}`);
  const { src: framedUrl } = useEmbedSrc(app.id, url, rebuildNonce + version, "live_preview");
  useAppFrameAuth(frameRef, app.id, framedUrl);

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

function CardPreview({ app }) {
  const image = app.preview_screenshot_url || app.social_image_url || app.logo_url;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [image]);

  return <>
    {image && !imageFailed
      ? <img src={image} alt="" loading="lazy" onError={() => setImageFailed(true)} />
      : <span className="sunny-apps-card-fallback" aria-hidden="true">
          <span>{(app.name || "App").slice(0, 1).toUpperCase()}</span>
          <strong>{app.name || "Untitled app"}</strong>
        </span>}
  </>;
}

function CardApp({ app }) {
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const frameRef = useRef(null);
  const rebuildNonce = useAppRebuildNonce(app.id);
  const { url, error } = useSandboxPreview(app.id, `${rebuildNonce}:${app.last_git_commit_hash || ""}:${app.status?.state || ""}:${version}`);
  const { src } = useEmbedSrc(app.id, url, rebuildNonce + version, "live_preview");
  useAppFrameAuth(frameRef, app.id, src);
  useEffect(() => { setLoaded(false); }, [src]);

  return <div className="sunny-apps-card-preview" aria-label={`${app.name || "Untitled"} app`}>
    {!loaded && <div className="sunny-apps-card-loading" role="status">
      <CardPreview app={app} />
      <span>{error || "Starting interactive app…"}</span>
      {error && <button onClick={() => setVersion((current) => current + 1)}>Try again</button>}
    </div>}
    {url && <iframe
      ref={frameRef}
      key={src}
      src={src}
      title={`${app.name || "Untitled"} app`}
      onLoad={() => setLoaded(true)}
      style={{ visibility: loaded ? "visible" : "hidden" }}
      allow="fullscreen"
    />}
  </div>;
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
  const [listings, setListings] = useState({});
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
      .then(({ listings = [] }) => setListings(Object.fromEntries(
        listings.map((item) => [item.app_id, item]),
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
              const listing = listings[app.id];
              const marketState = marketPublishState(app, listing);
              const building = app.status?.state === "processing";
              return <article key={app.id} className="sunny-apps-card" aria-label={name}>
                <header>
                  <h2>{name}</h2>
                  {building && <Loader2 className="animate-spin" size={14} />}
                  <div className="sunny-apps-card-actions">
                    <button aria-label={`Edit ${name}`} title="Edit app" onClick={() => openApp(app)}><Pencil size={15} /></button>
                    <button aria-label={`Remove ${name} from My apps`} title="Remove from My apps only" disabled={Boolean(removing)} onClick={() => void removeApp(app)}><Trash2 size={15} /></button>
                  </div>
                </header>
                <CardApp app={app} />
                <footer className="sunny-apps-card-footer">
                  <span>{marketState === "live" ? "Published and up to date" : marketState === "needs_publish" ? "Changes are in preview until published" : "Preview only"}</span>
                  {marketState === "live"
                    ? <Link href="/market"><Store size={14} /> Live in app market</Link>
                    : <button disabled={building || !app.slug} onClick={() => setPublishing(app)}><Store size={14} /> Publish to market</button>}
                </footer>
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
        onCreateNewApp={() => openApp()}
        marketListing={listings[selected?.id]}
      />
    </div>
    {publishing && <PublishDialog app={publishing} onClose={() => setPublishing(null)} onDone={(fresh) => {
      setApps((current) => current.map((item) => item.id === fresh.id ? { ...item, ...fresh } : item));
      refreshPublished();
      setPublishing(null);
    }} />}
  </div>;
}

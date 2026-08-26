import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Check, Trash2, ArrowLeft, ShieldCheck, Sparkles, Store, LayoutGrid } from "lucide-react";

import { addAppToMyWidgets } from "@/lib/myWidgets";
import { useAppFrameAuth } from "@/lib/appFrameAuth";
import { listUsableApps } from "@/lib/usableApps";
import { announceMarketChanged, useMarketChanges } from "@/lib/marketEvents";
import PublishDialog from "@/components/market/PublishDialog";

/**
 * The app market.
 *
 * An app one person builds, another installs and runs against their own boards. What
 * makes that safe is not on this page — it is the viewer token (src/lib/appTokens.ts):
 * the app is one deployment with one author, and the token is what makes it read the
 * *viewer's* rows rather than the author's.
 *
 * So this page never passes an identity to anything. Installing writes an `AppInstall`
 * row — the grant — and embedding triggers the handshake. Everything about who the app
 * acts for is resolved server-side from the token.
 *
 * Installing and pinning to Home are separate acts, deliberately: an app you open once
 * a month should not have to live on your home page to work.
 */

const post = async (path, body) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${path} failed (${res.status})`);
  return json;
};

/** An installed app, embedded. Same handshake the dashboard widgets use. */
function EmbeddedApp({ listing, onBack }) {
  const frameRef = useRef(null);
  const [denied, setDenied] = useState(false);
  useAppFrameAuth(frameRef, listing.app_id, listing.app_url, (s) => setDenied(s === "denied"));

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      <div className="flex flex-shrink-0 items-center gap-4 border-b border-border bg-card px-6 py-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Market
        </button>
        <span className="truncate text-sm font-medium text-foreground">{listing.title}</span>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">by {listing.author}</span>
        {denied && (
          <span className="ml-auto text-xs text-destructive">
            Sunny refused this app a token — it cannot read your data.
          </span>
        )}
      </div>
      {listing.app_url ? (
        <iframe
          ref={frameRef}
          src={listing.app_url}
          title={listing.title}
          className="w-full flex-1 border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            This listing has no embed URL — its author needs to re-publish after deploying.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * "How do I get my app in here?" is asked *on this page*, not on the Apps page, so the
 * answer lives here too. Lists the apps you built and hands the chosen one to the
 * same PublishDialog that My Tools uses.
 */
function PublishPicker({ onCancel, onPick }) {
  const [apps, setApps] = useState(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const all = await listUsableApps().catch(() => []);
      if (alive) setApps(all.filter((a) => a.source === "built"));
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-foreground">Publish one of your apps</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick an app you built. Anyone in Sunny will be able to install it.
        </p>

        {apps === null ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : apps.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">You have not built an app yet.</p>
            <button
              onClick={() => { onCancel(); window.dispatchEvent(new CustomEvent("open-assistant", { detail: { mode: "build", origin: "market" } })); }}
              className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" /> Build one
            </button>
          </div>
        ) : (
          <div className="mt-4 max-h-80 divide-y divide-border overflow-y-auto rounded border border-border">
            {apps.map((a) => (
              <button
                key={a.id}
                onClick={() => onPick(a.app)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  {a.screenshot ? (
                    <img src={a.screenshot} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-base font-semibold text-muted-foreground">{a.name[0].toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{a.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.subtitle}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function InstallDialog({ listing, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-foreground">Install {listing.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Built by {listing.author}.</p>

        <div className="mt-4 flex items-start gap-2.5 rounded-md border border-border p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
          <p className="text-sm text-foreground">
            It will read and write <strong>your</strong> boards and items, as you.
            <span className="mt-1 block text-xs text-muted-foreground">
              It never sees anyone else&apos;s work — not even its author&apos;s. Uninstall it and
              it loses access immediately.
            </span>
          </p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          It will appear in My Tools. Add it to your home page separately, if you want it there.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
          >
            {busy ? "Installing…" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ListingCard({ listing, onInstall, onUninstall, onOpen, onUnpublish, onPin }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
      <div className="flex aspect-[16/9] items-center justify-center overflow-hidden bg-muted">
        {listing.screenshot_url ? (
          <img src={listing.screenshot_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="select-none font-display text-4xl text-muted-foreground/20">
            {listing.title[0].toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex-1 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{listing.title}</p>
          {listing.installed && (
            <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              <Check className="h-2.5 w-2.5" /> Installed
            </span>
          )}
        </div>
        {listing.tagline && <p className="mt-1 text-xs text-muted-foreground">{listing.tagline}</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {listing.is_author ? "Built by you" : `by ${listing.author}`}
          {listing.install_count > 0 &&
            ` · ${listing.install_count} install${listing.install_count === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="flex gap-2 border-t border-border p-2.5">
        {listing.is_author && listing.status === "published" && (
          <button
            onClick={() => onUnpublish(listing)}
            title="Stop offering it. Anyone who already installed it keeps working."
            className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
          >
            Remove from market
          </button>
        )}
        {listing.is_author && listing.status === "delisted" && (
          <span className="flex-1 px-3 py-1.5 text-center text-xs text-muted-foreground">
            Delisted — republish from My Tools
          </span>
        )}
        {!listing.is_author &&
          (listing.installed ? (
            <>
              <button onClick={() => onOpen(listing)} className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
                Open
              </button>
              <button
                onClick={() => onPin(listing)}
                disabled={listing.pinned}
                title={listing.pinned ? "Already on your home page" : "Add it to your home page"}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onUninstall(listing)}
                title="Uninstall — revokes its access to your data"
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => onInstall(listing)}
              className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
            >
              Install
            </button>
          ))}
      </div>
    </div>
  );
}

export default function Marketplace() {
  const [tab, setTab] = useState("browse");
  const [listings, setListings] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [installing, setInstalling] = useState(null);
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState(null);
  const [picking, setPicking] = useState(false);
  const [publishing, setPublishing] = useState(null);

  const load = useCallback(async (which) => {
    setLoading(true);
    setError(null);
    try {
      const { listings } = await post("/api/marketplace", { action: which });
      setListings(listings);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  // Publishing from the builder happens in a panel over this page, so the grid has to
  // be told; nothing about the click that caused it happened here.
  useMarketChanges(() => load(tab));

  /** The grant, and nothing else. Where it shows up is a separate choice. */
  const install = async () => {
    const listing = installing;
    setInstalling(null);
    try {
      await post("/api/installs", {
        action: "install",
        app_id: listing.app_id,
        app_name: listing.title,
      });
      announceMarketChanged();
      setNotice(`${listing.title} is installed. Find it in Apps.`);
      await load(tab);
    } catch (err) {
      setError(err.message);
    }
  };

  /**
   * Revokes. The server also removes any widgets for the app: unpinning is not
   * uninstalling, but the reverse does hold — a widget with no grant behind it renders
   * as a frame that cannot read anything, which looks broken rather than revoked.
   */
  const uninstall = async (listing) => {
    try {
      await post("/api/installs", { action: "uninstall", app_id: listing.app_id });
      window.dispatchEvent(new CustomEvent("widgets-updated"));
      announceMarketChanged();
      setNotice(`${listing.title} uninstalled. It can no longer read your boards.`);
      await load(tab);
    } catch (err) {
      setError(err.message);
    }
  };

  /** Put an installed app on Home. Pinning grants nothing on its own. */
  const pin = async (listing) => {
    try {
      await addAppToMyWidgets(
        {
          id: listing.app_id,
          name: listing.title,
          slug: null,
          preview_screenshot_url: listing.screenshot_url,
        },
        listing.app_url,
      );
      setNotice(`${listing.title} added to your home page.`);
      await load(tab);
    } catch (err) {
      setError(err.message);
    }
  };

  const unpublish = async (listing) => {
    try {
      await post("/api/marketplace", { action: "unpublish", app_id: listing.app_id });
      announceMarketChanged();
      await load(tab);
    } catch (err) {
      setError(err.message);
    }
  };

  if (open) return <EmbeddedApp listing={open} onBack={() => setOpen(null)} />;

  const shown = query
    ? listings.filter((l) =>
        `${l.title} ${l.tagline ?? ""} ${l.category ?? ""}`.toLowerCase().includes(query.toLowerCase()),
      )
    : listings;

  return (
    <div className="min-h-screen bg-background">
      {installing && (
        <InstallDialog listing={installing} onCancel={() => setInstalling(null)} onConfirm={install} />
      )}
      {picking && (
        <PublishPicker
          onCancel={() => setPicking(false)}
          onPick={(app) => { setPicking(false); setPublishing(app); }}
        />
      )}
      {publishing && (
        <PublishDialog
          app={publishing}
          onClose={() => setPublishing(null)}
          onDone={() => { setPublishing(null); setTab("mine"); load("mine"); }}
        />
      )}

      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-8 md:py-10">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Workspace</p>
          <h1 className="font-display text-3xl text-foreground md:text-4xl">App market</h1>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Apps built by other people in Sunny. Install one and it works on your boards — it
              never sees anyone else&apos;s.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setPicking(true)}
                className="flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <Store className="h-3.5 w-3.5" /> Publish an app
              </button>
              <button
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("open-assistant", { detail: { mode: "build", origin: "market" } }))
                }
                className="flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Sparkles className="h-3.5 w-3.5" /> Build an app
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {[
            ["browse", "Browse"],
            ["installed", "Installed"],
            ["mine", "Published by me"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                tab === key ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {label}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps"
              className="rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        {notice && (
          <p className="mb-4 flex items-center gap-2 text-sm text-primary">
            <Check className="h-3.5 w-3.5" /> {notice}
            <Link href="/Dashboard" className="underline underline-offset-2">Home</Link>
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : shown.length === 0 ? (
          <div className="py-24 text-center">
            <Store className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {tab === "browse" && "Nothing published yet. Build an app, then publish it from My Tools."}
              {tab === "installed" && "You haven't installed anything yet."}
              {tab === "mine" && "You haven't published anything yet."}
            </p>
            {(tab === "mine" || tab === "browse") && (
              <button
                onClick={() => setPicking(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground"
              >
                <Store className="h-3.5 w-3.5" /> Publish an app
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((l) => (
              <ListingCard
                key={l.app_id}
                listing={l}
                onInstall={setInstalling}
                onUninstall={uninstall}
                onOpen={setOpen}
                onUnpublish={unpublish}
                onPin={pin}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

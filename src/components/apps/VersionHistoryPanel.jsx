"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2, RefreshCw, RotateCcw, Upload, X } from "lucide-react";
import * as platform from "@/lib/base44Platform";
import { previewState, restoreBlocked, versionActionError, versionState, versionTitle } from "@/lib/appVersions";

/**
 * The app's version history: every saved version, newest first, with the three
 * things a builder does with one — look at it, go back to it, or ship it.
 *
 * Base44 saves a version at the end of every builder turn (and on imports,
 * clones and manual saves — never on publish), so this list is the editor's
 * own history, read through `listCheckpoints`. Each version has a static
 * preview build; the panel shows it in place of the live preview when a row is
 * selected, and the parent swaps back on "Back to live".
 *
 * Two actions, deliberately kept apart:
 *   - **Restore** calls `restoreCheckpoint`: the builder's code, functions,
 *     entity schemas and chat all return to that version. Nothing is published.
 *   - **Publish this version** calls `deployApp` with the version's id: production
 *     serves that build and the builder's draft is untouched. A rollback for the
 *     people using the app, without rewinding anyone's work.
 *
 * The list is re-read whenever the app's commit or status changes, so a finished
 * turn or a restore shows up without a manual refresh; a version whose preview
 * is still building is polled until it settles.
 */

const PREVIEW_POLL_MS = 4000;
const PAGE_SIZE = 25;

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function ConfirmDialog({ title, body, confirmLabel, busy, onConfirm, onCancel, destructive = false }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="sunny-versions-confirm-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="sunny-versions-confirm" role="dialog" aria-modal="true" aria-labelledby="sunny-versions-confirm-title">
        <h3 id="sunny-versions-confirm-title">{title}</h3>
        {body}
        <div className="sunny-versions-confirm-actions">
          <button type="button" className="sunny-apps-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? "sunny-versions-primary is-destructive" : "sunny-versions-primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Loader2 className="animate-spin" size={14} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VersionHistoryPanel({
  app,
  selectedId,
  onSelect,
  onClose,
  onRestored,
  onPublished,
}) {
  const appId = app?.id || null;
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(null); // null | { kind: "restore" | "publish", version }
  const [busy, setBusy] = useState(null); // null | "restore" | "publish" | `retry:${id}`
  const reqRef = useRef(0);

  const commit = app?.last_git_commit_hash || "";
  const deployedCommit = app?.last_deployed_git_commit_hash || "";
  const appState = app?.status?.state || "";

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!appId) return;
    const req = ++reqRef.current;
    if (!quiet) setLoading(true);
    try {
      const list = await platform.listCheckpoints(appId, { limit: PAGE_SIZE });
      if (req !== reqRef.current) return;
      setVersions(Array.isArray(list) ? list : []);
      setError("");
    } catch (err) {
      if (req !== reqRef.current) return;
      setError(err.message || "Could not load the version history.");
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [appId]);

  // Keyed on what changes the list: a new build adds a row, a publish or a
  // restore relabels one.
  useEffect(() => {
    void load();
  }, [load, commit, deployedCommit, appState]);

  // A preview that is still building settles on its own; keep reading until it has.
  const building = versions.some((v) => previewState(v) === "building");
  useEffect(() => {
    if (!building) return;
    const id = setInterval(() => void load({ quiet: true }), PREVIEW_POLL_MS);
    return () => clearInterval(id);
  }, [building, load]);

  const blocked = restoreBlocked(app);

  async function restore(version) {
    setBusy("restore");
    setError("");
    try {
      const restored = await platform.restoreCheckpoint(appId, version.id);
      setConfirming(null);
      onRestored?.(restored, version);
    } catch (err) {
      setConfirming(null);
      setError(versionActionError("restore", err.status ?? null, err.message || ""));
    } finally {
      setBusy(null);
    }
  }

  async function publish(version) {
    setBusy("publish");
    setError("");
    try {
      const result = await platform.deployApp(appId, { checkpointId: version.id });
      setConfirming(null);
      onPublished?.(result, version);
      void load({ quiet: true });
    } catch (err) {
      setConfirming(null);
      setError(versionActionError("publish", err.status ?? null, err.message || ""));
    } finally {
      setBusy(null);
    }
  }

  async function retry(version) {
    setBusy(`retry:${version.id}`);
    setError("");
    try {
      await platform.retryCheckpointBuild(appId, version.id);
      await load({ quiet: true });
    } catch (err) {
      setError(err.message || "The preview could not be rebuilt.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside className="sunny-versions" aria-label="Version history">
      <header>
        <History size={16} aria-hidden="true" />
        <strong>Versions</strong>
        <button type="button" onClick={onClose} aria-label="Close version history">
          <X size={16} />
        </button>
      </header>
      <p className="sunny-versions-intro">
        Every change the assistant makes is saved here. Select a version to see it, then restore it or publish it.
      </p>
      {blocked && (
        <p className="sunny-versions-note" role="status">
          The app is building. You can look at versions now and restore one when it finishes.
        </p>
      )}
      {error && (
        <p className="sunny-versions-error" role="alert">
          {error}
        </p>
      )}
      <div className="sunny-versions-list">
        {loading ? (
          <div className="sunny-versions-empty" role="status">
            <Loader2 className="animate-spin" size={18} /> Loading versions…
          </div>
        ) : versions.length === 0 ? (
          <div className="sunny-versions-empty">No saved versions yet. The first one appears when a build finishes.</div>
        ) : (
          versions.map((version) => {
            const state = versionState(app, version);
            const selected = version.id === selectedId;
            const retrying = busy === `retry:${version.id}`;
            return (
              <article
                key={version.id}
                className={`sunny-versions-row ${selected ? "is-selected" : ""}`}
                aria-current={selected ? "true" : undefined}
              >
                <button
                  type="button"
                  className="sunny-versions-row-main"
                  onClick={() => onSelect?.(state.preview === "ready" ? version : null, version)}
                  disabled={state.preview !== "ready"}
                  title={state.preview === "ready" ? "Show this version" : undefined}
                >
                  <span className="sunny-versions-row-title">{versionTitle(version)}</span>
                  <span className="sunny-versions-row-meta">
                    {formatDate(version.created_date)}
                    {state.current && <em>Current</em>}
                    {state.live && <em className="is-live">Live</em>}
                    {state.preview === "building" && <em>Preview building…</em>}
                    {state.preview === "failed" && <em className="is-failed">Preview failed</em>}
                  </span>
                </button>
                <div className="sunny-versions-row-actions">
                  {state.preview === "failed" && (
                    <button type="button" onClick={() => void retry(version)} disabled={Boolean(busy)} title="Build the preview again">
                      {retrying ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} Retry preview
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirming({ kind: "restore", version })}
                    disabled={Boolean(busy) || blocked}
                    title={blocked ? "Wait for the build to finish" : "Return the editor to this version"}
                  >
                    <RotateCcw size={13} /> Restore
                  </button>
                  {!state.live && (
                    <button
                      type="button"
                      onClick={() => setConfirming({ kind: "publish", version })}
                      disabled={Boolean(busy) || appState === "processing" || !version.git_commit_hash}
                      title="Make this the version everyone uses"
                    >
                      <Upload size={13} /> Publish
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {confirming?.kind === "restore" && (
        <ConfirmDialog
          title={`Restore “${versionTitle(confirming.version)}”?`}
          confirmLabel={busy === "restore" ? "Restoring…" : "Restore"}
          busy={busy === "restore"}
          destructive
          onCancel={() => setConfirming(null)}
          onConfirm={() => void restore(confirming.version)}
          body={
            <>
              <p>
                The editor goes back to this version: its code, backend functions and data tables. Messages after it
                leave the chat.
              </p>
              <p>
                <strong>Nothing is published.</strong> People using the app keep seeing the live version until you
                publish again. No version is deleted, so you can come back to the current one.
              </p>
              <p className="sunny-versions-fineprint">
                Restoring takes a little while. The chat and preview refresh when it is done.
              </p>
            </>
          }
        />
      )}
      {confirming?.kind === "publish" && (
        <ConfirmDialog
          title={`Publish “${versionTitle(confirming.version)}”?`}
          confirmLabel={busy === "publish" ? "Publishing…" : "Publish this version"}
          busy={busy === "publish"}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void publish(confirming.version)}
          body={
            <>
              <p>This version becomes the live app for everyone using it.</p>
              <p>
                The editor is not changed: the assistant keeps working on the current version, and you can publish it
                again whenever you are ready.
              </p>
            </>
          }
        />
      )}
    </aside>
  );
}

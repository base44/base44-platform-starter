"use client";
import { Grid2X2, Loader2, Plus } from "lucide-react";
import type { App } from "../../types";
import AppWidget from "./AppWidget";

// The home page: the builder's apps, or a way to create the first one.
export default function AppsPage({ apps, openId, hidden, loading, removing, error, onRetry, onCreate, onOpen, onRemove }: {
  apps: App[];
  openId?: string;
  hidden: boolean;
  loading: boolean;
  removing: boolean;
  error: string;
  onRetry: () => void;
  onCreate: () => void;
  onOpen: (app: App) => void;
  onRemove: (app: App) => void;
}) {
  let content;
  if (loading && apps.length === 0) {
    content = (
      <div className="empty-state" role="status">
        <Loader2 className="spin" />
        <p>Loading your apps…</p>
      </div>
    );
  } else if (apps.length === 0 && !error) {
    content = (
      <div className="empty-state">
        <Grid2X2 size={28} />
        <h2>Make room for your first idea</h2>
        <p>Tell the assistant what you want to build.</p>
        <button onClick={onCreate}>
          <Plus size={16} /> Create an app
        </button>
      </div>
    );
  } else {
    content = (
      <div className="apps-grid">
        {apps.map((app) => (
          <AppWidget
            key={app.id}
            app={app}
            open={app.id === openId}
            removing={removing || loading}
            onEdit={() => onOpen(app)}
            onRemove={() => onRemove(app)}
          />
        ))}
      </div>
    );
  }

  return (
    <main className={`apps-page ${openId ? "has-open-app" : ""}`} hidden={hidden}>
      <div className="apps-content">
        {error && (
          <div role="alert" className="error">
            <p>{error}</p>
            <button className="secondary" onClick={onRetry}>Try again</button>
          </div>
        )}
        {content}
      </div>
    </main>
  );
}

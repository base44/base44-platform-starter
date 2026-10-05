"use client";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import type { App } from "../../types";
import AppPreview from "./AppPreview";

// A card on the apps page. It shows the app's latest build, which starts no sandbox.
// Open, it fills the stage and loads the live sandbox over that build.
export default function AppWidget({ app, open, removing, onEdit, onRemove }: {
  app: App;
  open: boolean;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const name = app.name || "Untitled";
  const building = app.status?.state === "processing";

  return (
    <article className={`app-widget ${open ? "is-open" : ""}`} aria-label={name}>
      <header className="widget-heading">
        <h2>{name}</h2>
        {building && <Loader2 size={14} className="spin" aria-label="Building" />}
        <div className="widget-actions">
          <button className="icon-button" aria-label={`Edit ${name}`} title="Open app" onClick={onEdit}>
            <Pencil size={15} />
          </button>
          <button className="icon-button" aria-label={`Remove ${name} from My apps`} title="Remove from Tiny only" disabled={removing} onClick={onRemove}>
            <Trash2 size={15} />
          </button>
        </div>
      </header>
      <div className="widget-preview">
        {building && !open ? (
          <div className="widget-placeholder" role="status">
            <Loader2 size={20} className="spin" aria-hidden="true" /> Generating your app…
          </div>
        ) : (
          <AppPreview app={app} live={open} title={open ? `${name} preview` : `${name} widget preview`} showControls={open} />
        )}
      </div>
    </article>
  );
}

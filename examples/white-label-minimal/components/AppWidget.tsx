"use client";

import { Loader2, Pencil, Trash2 } from "lucide-react";
import type { App } from "../lib/types";

// A card in the apps list. It carries no preview: a preview means a live or
// static build, and those are only worth fetching once someone opens the app.
export default function AppWidget({ app, removing, onEdit, onRemove }: {
  app: App;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const building = app.status?.state === "processing";
  const name = app.name || "Untitled";
  return <article className="app-widget" aria-label={name}>
    <button className="widget-open" onClick={onEdit} aria-label={`Open ${name}`}>
      <h2>{name}</h2>
      {app.user_description && <p>{app.user_description}</p>}
    </button>
    <footer className="widget-heading">
      {building && <span className="widget-building"><Loader2 size={13} className="spin" aria-hidden="true" /> Generating…</span>}
      <div className="widget-actions">
        <button className="icon-button" aria-label={`Edit ${name}`} title="Open app" onClick={onEdit}><Pencil size={15} /></button>
        <button className="icon-button" aria-label={`Remove ${name} from My apps`} title="Remove from Tiny only" disabled={removing} onClick={onRemove}><Trash2 size={15} /></button>
      </div>
    </footer>
  </article>;
}

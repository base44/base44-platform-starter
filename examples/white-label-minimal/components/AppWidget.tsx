"use client";

import { Loader2, Pencil, Trash2 } from "lucide-react";
import PreviewFrame from "./PreviewFrame";
import type { App } from "../lib/types";

// A card in the apps list, showing the app's last static build. The live
// preview belongs to the app you are editing, so listing apps starts no
// sandboxes at all.
export default function AppWidget({ app, removing, onEdit, onRemove }: {
  app: App;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const building = app.status?.state === "processing";
  const name = app.name || "Untitled";
  return <article className="app-widget" aria-label={name}>
    <header className="widget-heading">
      <h2>{name}</h2>
      {building && <Loader2 size={14} className="spin" aria-label="Building" />}
      <div className="widget-actions">
        <button className="icon-button" aria-label={`Edit ${name}`} title="Open app" onClick={onEdit}><Pencil size={15} /></button>
        <button className="icon-button" aria-label={`Remove ${name} from My apps`} title="Remove from Tiny only" disabled={removing} onClick={onRemove}><Trash2 size={15} /></button>
      </div>
    </header>
    <div className="widget-preview">
      {building
        ? <div className="widget-placeholder" role="status">
            <Loader2 size={20} className="spin" aria-hidden="true" />
            <span>Generating your app…</span>
          </div>
        : <PreviewFrame app={app} showControls={false} title={`${name} widget preview`} />}
    </div>
  </article>;
}

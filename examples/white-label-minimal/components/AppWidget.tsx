"use client";

import { Loader2, Maximize2, Pencil, Trash2 } from "lucide-react";
import PreviewFrame from "./PreviewFrame";
import type { App } from "../lib/types";

export default function AppWidget({ app, live, editing, removing, onEdit, onRemove, onExpand }: {
  app: App;
  live: boolean;
  editing: boolean;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onExpand: () => void;
}) {
  const building = app.status?.state === "processing";
  const name = app.name || "Untitled";
  return <article
    className={`app-widget ${editing ? "is-editing" : ""}`}
    aria-label={editing ? `${name}, open in the editor` : name}
  >
    <header className="widget-heading">
      <h2>{name}</h2>
      {building && <Loader2 size={14} className="spin" aria-label="Building" />}
      <div className="widget-actions">
        <button className="icon-button" aria-label={`Edit ${name}`} title="Edit app" onClick={onEdit}><Pencil size={15} /></button>
        <button className="icon-button" aria-label={`Open ${name}`} title="Expand preview" onClick={onExpand}><Maximize2 size={15} /></button>
        <button className="icon-button" aria-label={`Remove ${name} from My apps`} title="Remove from Tiny only" disabled={removing} onClick={onRemove}><Trash2 size={15} /></button>
      </div>
    </header>
    <div className="widget-preview">
      <PreviewFrame app={app} live={live} title={`${name} widget preview`} />
    </div>
  </article>;
}

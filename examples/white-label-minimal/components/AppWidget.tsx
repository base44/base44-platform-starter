"use client";

import { Loader2, Maximize2, Pencil, Trash2 } from "lucide-react";
import PreviewFrame from "./PreviewFrame";
import type { App } from "../lib/types";

export default function AppWidget({ app, live, removing, onEdit, onRemove, onExpand }: {
  app: App;
  live: boolean;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onExpand: () => void;
}) {
  const building = app.status?.state === "processing";
  return <article className="app-widget" aria-label={app.name || "Untitled"}>
    <header className="widget-heading">
      <h2>{app.name || "Untitled"}</h2>
      {building && <Loader2 size={14} className="spin" aria-label="Building" />}
      <div className="widget-actions">
        <button className="icon-button" aria-label={`Edit ${app.name || "Untitled"}`} title="Edit app" onClick={onEdit}><Pencil size={15} /></button>
        <button className="icon-button" aria-label={`Open ${app.name || "Untitled"}`} title="Expand preview" onClick={onExpand}><Maximize2 size={15} /></button>
        <button className="icon-button" aria-label={`Remove ${app.name || "Untitled"} from My apps`} title="Remove from Tiny only" disabled={removing} onClick={onRemove}><Trash2 size={15} /></button>
      </div>
    </header>
    <div className="widget-preview">
      <PreviewFrame app={app} live={live} title={`${app.name || "Untitled"} widget preview`} />
    </div>
  </article>;
}

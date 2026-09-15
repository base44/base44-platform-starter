"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { App } from "../lib/types";
import PreviewFrame from "./PreviewFrame";

export default function AppPreview({ app, live = true, onClose }: { app: App; live?: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="app-preview" aria-labelledby="preview-title" onClose={onClose}>
    <header><h2 id="preview-title">{app.name || "Untitled"}</h2>
      <button className="icon-button" aria-label="Close app preview" onClick={() => dialog.current?.close()}><X size={20} /></button>
    </header>
    <PreviewFrame app={app} live={live} title={`${app.name || "Untitled"} preview`} />
  </dialog>;
}

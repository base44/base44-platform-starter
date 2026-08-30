"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";

import * as platform from "@/lib/base44Platform";

/** The app's name, editable in place. Enter saves, Escape cancels, blur commits. */
export default function AppNameField({ app, onRenamed, className = "" }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(app.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setValue(app.name);
  }, [app.name]);

  const save = async () => {
    const name = value.trim();
    if (!name || name === app.name) return setEditing(false);
    setBusy(true);
    setError(null);
    try {
      await platform.renameApp(app.id, name);
      onRenamed(app.id, name);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        title="Rename"
        className={`group flex items-center gap-1.5 text-sm font-medium text-foreground truncate hover:text-primary transition-colors ${className}`}
      >
        {app.name}
        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0" />
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 min-w-0">
      <input
        autoFocus
        value={value}
        maxLength={60}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(app.name);
            setEditing(false);
          }
        }}
        onBlur={save}
        className={`rounded border border-border bg-background px-2 py-1 text-sm text-foreground min-w-0 w-full ${className}`}
      />
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      {error && <span className="text-xs text-destructive truncate">{error}</span>}
    </span>
  );
}

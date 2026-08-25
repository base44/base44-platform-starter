import React, { useState } from "react";
import { Eye, BookmarkCheck, Pencil, X, Loader2, Check } from "lucide-react";

export default function AppReadyWidget({
  appName,
  onPreview,
  onSaveToMyTools,
  onKeepEditing,
  isSaving,
  isSaved,
  isLoadingPreview,
}) {
  return (
    <>
      <div className="mt-2 bg-card border border-border rounded-lg p-4 flex flex-col gap-3 max-w-sm">
        <div>
          <p className="text-sm font-semibold text-foreground">
            🎉 {appName || "Your app"} is ready!
          </p>
          <p className="text-xs text-muted-foreground mt-1">What do you want to do next?</p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={onPreview}
            disabled={isLoadingPreview}
            className="flex items-center gap-2 text-xs font-medium border border-border text-foreground px-3 py-2.5 rounded hover:bg-secondary transition-colors w-full disabled:opacity-40"
          >
            {isLoadingPreview ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            {isLoadingPreview ? "Opening…" : "Preview"}
          </button>
          <button
            onClick={onSaveToMyTools}
            disabled={isSaving || isSaved}
            className={`flex items-center gap-2 text-xs font-medium px-3 py-2.5 rounded transition-colors w-full disabled:opacity-100 ${isSaved ? "bg-green-600 text-white cursor-default" : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"}`}
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isSaved ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <BookmarkCheck className="w-3.5 h-3.5" />
            )}
            {isSaving ? "Saving…" : isSaved ? "Saved to My Tools!" : "Save to My Tools"}
          </button>
          <button
            onClick={onKeepEditing}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground px-3 py-2.5 rounded hover:bg-secondary transition-colors w-full"
          >
            <Pencil className="w-3.5 h-3.5" />
            Keep editing
          </button>
        </div>
      </div>
    </>
  );
}

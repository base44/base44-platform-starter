import React from "react";
import Link from "next/link";
import { Eye, BookmarkCheck, Pencil, LayoutGrid, Loader2, Check, ArrowRight } from "lucide-react";

/**
 * The "your app is ready" card, with one filing action.
 *
 * "Publish" is what the old "Save to My Tools" did — an app is in My Tools from the
 * moment it is built, so nothing was being filed; `deployApp` publishes. From the
 * Add-widget picker it becomes "Add to my widgets", which publishes *and* pins.
 * Already pinned, it reverts to Publish so an app on the dashboard can still be
 * iterated on.
 */
export default function AppReadyWidget({
  appName,
  onPreview,
  onSaveToMyTools,
  onKeepEditing,
  isSaving,
  isSaved,
  isLoadingPreview,
  offerMyWidgets = false,
  onAddToMyWidgets,
  isAddingToMyWidgets = false,
  isAddedToMyWidgets = false,
  myToolsHref = null,
  onNavigate,
}) {
  const busy = isSaving || isAddingToMyWidgets;
  // Not `isSaved || isAddedToMyWidgets`: the picker creates a Widget row without
  // deploying, and conflating them would disable the only deploy control.
  const settled = isSaved;

  const primary =
    "flex items-center gap-2 text-xs font-medium px-3 py-2.5 rounded transition-colors w-full disabled:opacity-100 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60";
  const done =
    "flex items-center gap-2 text-xs font-medium px-3 py-2.5 rounded transition-colors w-full disabled:opacity-100 bg-green-600 text-white hover:bg-green-700";
  const secondary =
    "flex items-center gap-2 text-xs font-medium border border-border text-foreground px-3 py-2.5 rounded hover:bg-secondary transition-colors w-full disabled:opacity-40";

  return (
    <div className="mt-2 bg-card border border-border rounded-lg p-4 flex flex-col gap-3 max-w-sm">
      <div>
        <p className="text-sm font-semibold text-foreground">🎉 {appName || "Your app"} is ready!</p>
        <p className="text-xs text-muted-foreground mt-1">What do you want to do next?</p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          onClick={onPreview}
          disabled={isLoadingPreview}
          className={secondary}
        >
          {isLoadingPreview ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
          {isLoadingPreview ? "Opening…" : "Preview"}
        </button>

        {offerMyWidgets && !isAddedToMyWidgets ? (
          <button onClick={onAddToMyWidgets} disabled={busy} className={primary}>
            {isAddingToMyWidgets ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LayoutGrid className="w-3.5 h-3.5" />
            )}
            {isAddingToMyWidgets ? "Adding…" : "Add to my widgets"}
          </button>
        ) : settled && myToolsHref ? (
          <Link href={myToolsHref} onClick={onNavigate} className={done}>
            <Check className="w-3.5 h-3.5" />
            Published — view in My Tools
            <ArrowRight className="w-3.5 h-3.5 ml-auto" />
          </Link>
        ) : (
          <button onClick={onSaveToMyTools} disabled={busy} className={primary}>
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BookmarkCheck className="w-3.5 h-3.5" />
            )}
            {isSaving ? "Publishing…" : "Publish"}
          </button>
        )}

        <button
          onClick={onKeepEditing}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground px-3 py-2.5 rounded hover:bg-secondary transition-colors w-full"
        >
          <Pencil className="w-3.5 h-3.5" />
          Keep editing
        </button>
      </div>
    </div>
  );
}

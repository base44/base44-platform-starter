"use client";

/**
 * Tells the user when Base44 removed one of their apps, and gets the pages that
 * are already open to catch up.
 *
 * Renders nothing. The toast is the whole UI.
 *
 * ## Why it polls
 *
 * The webhook lands on the server, and this browser may not be open when it
 * does. So the receiver leaves the notice on a row and this claims it — on
 * mount, whenever the tab becomes visible again, and on a slow timer for a tab
 * left open. A hidden tab does not poll at all: `visibilitychange` is the signal
 * that actually correlates with somebody looking.
 *
 * ## Why it lives in Providers
 *
 * Mounted inside `ToastProvider`, above the pages, so it covers every
 * authenticated route. An app can be deleted while its owner is looking at a
 * board, and the toast is the only thing that explains why their dashboard is
 * about to have one fewer widget on it.
 *
 * ## Why the events
 *
 * The rows are already gone by the time a notice exists — this does not perform
 * the removal, it reports one. `widgets-updated` makes the dashboard re-read
 * (the pin it was rendering no longer exists) and `APP_REMOVED` lets the apps
 * list drop the card, and close it if that app is the one on screen.
 */

import { useEffect } from "react";
import { useSession } from "next-auth/react";

import { useToast } from "@/components/ui/toast";
import { announceAppRemoved } from "@/lib/appRefresh";

type Notice = { app_id: string; app_name: string | null; kind: "deleted" | "restored" };

/**
 * `src/components/ui/toast.jsx` lives in the untyped product-UI tree, and what
 * TypeScript infers from it is its out-of-provider fallback — a zero-argument
 * no-op. Narrowed here rather than by typing that file, which would pull a
 * relaxed-lint `.jsx` module into the strict tree for one call site.
 */
type Toast = (options: { message: string; duration?: number }) => number;

/** Long: it explains a change the user did not make in this tab. */
const TOAST_MS = 12_000;
const POLL_MS = 60_000;

/** Names the app when the shell knew its name, and stays truthful when it did not. */
function message({ app_name, kind }: Notice): string {
  const subject = app_name ? `“${app_name}”` : "An app you built";
  return kind === "deleted"
    ? `${subject} was deleted in Base44, so it has been removed from Sunny. Base44 keeps it in trash for 30 days.`
    : `${subject} was restored in Base44 and is back in My apps. Add it to your dashboard again if you want it there.`;
}

export default function AppNotices() {
  const { status } = useSession();
  const { toast } = useToast() as { toast: Toast };

  useEffect(() => {
    if (status !== "authenticated") return;
    let stopped = false;

    const claim = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      let notices: Notice[] = [];
      try {
        const res = await fetch("/api/base44/app-notices", { method: "POST" });
        if (!res.ok) return;
        ({ notices = [] } = (await res.json()) as { notices?: Notice[] });
      } catch {
        // A missed claim is a late toast. The notice stays pending.
        return;
      }
      if (stopped || notices.length === 0) return;

      for (const notice of notices) {
        toast({ message: message(notice), duration: TOAST_MS });
        if (notice.kind === "deleted") announceAppRemoved(notice.app_id);
      }
      // The dashboard's pins are rows, so it has to re-read to see one go.
      window.dispatchEvent(new CustomEvent("widgets-updated"));
    };

    void claim();
    const timer = setInterval(claim, POLL_MS);
    document.addEventListener("visibilitychange", claim);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", claim);
    };
  }, [status, toast]);

  return null;
}

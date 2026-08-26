import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Store, Sparkles, ArrowRight } from "lucide-react";

/**
 * The market's entry point on the home page.
 *
 * Home is where someone notices they are missing a tool, so this offers the two ways
 * out of that: install what somebody already built, or build it. Both one click.
 *
 * The count is a live read rather than static copy, because "3 apps to install" is a
 * reason to click and "Apps" is not. It falls back to the plain sentence if the fetch
 * fails — this card is never worth an error state.
 */
export default function MarketCard() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/marketplace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "browse" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setCount(j?.listings?.filter((l) => !l.installed).length ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Store className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">App market</h3>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {count
          ? `${count} app${count === 1 ? "" : "s"} built by other people, ready to install.`
          : "Apps built by other people in Sunny. Install one and it works on your boards."}
      </p>

      <Link
        href="/Marketplace"
        className="mt-4 flex items-center justify-between rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Browse apps <ArrowRight className="h-3.5 w-3.5" />
      </Link>

      <button
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("open-assistant", { detail: { mode: "build", origin: "home-widget" } }),
          )
        }
        className="mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
        Build your own
      </button>
    </div>
  );
}

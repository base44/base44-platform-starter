"use client";
import { useCallback, useEffect, useState } from "react";
import * as actions from "../server/actions";
import type { App } from "../types";
import { unwrap } from "./unwrap";

// The signed-in builder's apps: Tiny's ownership rows, each read from Base44.
export function useApps() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const all: App[] = [];
      let skip = 0;
      while (true) {
        const page = await unwrap(actions.listApps(skip));
        all.push(...page.apps);
        if (!page.hasMore) break;
        skip = page.nextSkip;
      }
      setApps(all);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your apps.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Removes the app from Tiny's list only. It stays in Base44.
  async function remove(app: App) {
    if (removing) return;
    setRemoving(true);
    setError("");
    try {
      await unwrap(actions.removeApp(app.id));
      setApps((current) => current.filter((item) => item.id !== app.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the app.");
    } finally {
      setRemoving(false);
    }
  }

  const add = useCallback((app: App) => setApps((current) => [app, ...current]), []);

  const update = useCallback((app: App) => {
    setApps((current) => current.map((item) => (item.id === app.id ? app : item)));
  }, []);

  return { apps, loading, removing, error, reload: load, remove, add, update };
}

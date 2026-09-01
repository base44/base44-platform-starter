/**
 * The signed-in half of `/`, in the shell every other page gets from
 * src/app/(app)/layout.tsx.
 *
 * It exists as its own file for the same reason the other route files carry
 * `"use client"`: the views in src/views are client components, and `/` is a
 * server component — it has to read the session before it can decide which half
 * of the home page to render.
 */
"use client";

import AppShell from "@/components/AppShell";
import Providers from "@/components/Providers";
import Dashboard from "@/views/Dashboard";

export default function HomeDashboard() {
  return (
    <Providers>
      <AppShell>
        <Dashboard />
      </AppShell>
    </Providers>
  );
}

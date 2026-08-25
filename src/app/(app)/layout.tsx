/**
 * Authenticated shell. Everything in this route group requires a session.
 *
 * The gate is here, on the server, rather than in a client effect: an
 * unauthenticated visitor is redirected before any markup or data is sent,
 * instead of briefly rendering an empty dashboard. It sends them to the landing
 * page rather than to NextAuth's own sign-in page, so the product has one
 * sign-in button, not two. `/api/entities` enforces the same thing independently
 * (a 401), so this is UX, not the security boundary.
 */

import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import Providers from "@/components/Providers";
import { getSessionUser } from "@/lib/auth";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/");

  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}

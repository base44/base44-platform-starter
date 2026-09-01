/**
 * Authenticated shell. Every page in this route group requires a session except
 * `/`, which is the sign-in page for anyone without one.
 *
 * The gate is here, on the server, rather than in a client effect: an
 * unauthenticated visitor is redirected before any markup or data is sent,
 * instead of briefly rendering an empty dashboard. It sends them to the landing
 * page rather than to NextAuth's own sign-in page, so the product has one
 * sign-in button, not two. `/api/entities` enforces the same thing independently
 * (a 401), so this is UX, not the security boundary.
 *
 * The path they asked for rides along as `?next=`, so a link to a board survives
 * the round trip through Google instead of dumping everyone on the dashboard —
 * which made every shared link inside the product useless to a signed-out reader.
 *
 * `/` is where they are sent, so it is the one path this gate lets through
 * signed-out — redirecting it would be a loop. Its page renders the sign-in card
 * itself, and gets `children` without the shell around it.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import Providers from "@/components/Providers";
import { getSessionUser } from "@/lib/auth";
import { PATHNAME_HEADER } from "@/proxy";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    const requested = (await headers()).get(PATHNAME_HEADER) ?? "/";
    if (requested.split("?")[0] !== "/") redirect(`/?next=${encodeURIComponent(requested)}`);
    return <>{children}</>;
  }

  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}

/**
 * Authenticated shell. Everything in this route group requires a session.
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
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AuthenticatedShell from "@/components/AuthenticatedShell";
import { getSessionUser } from "@/lib/auth";
import { PATHNAME_HEADER } from "@/proxy";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    const path = (await headers()).get(PATHNAME_HEADER);
    redirect(path ? `/?next=${encodeURIComponent(path)}` : "/");
  }

  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}

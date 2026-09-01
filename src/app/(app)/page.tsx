/**
 * `/` — the home page, for both kinds of visitor: a sign-in card for anyone
 * signed out, the dashboard for anyone signed in.
 *
 * It sits in the authenticated route group so that the shell around it is the
 * same mounted component every other page gets. Outside the group it was a
 * second copy, and navigating between `/` and anywhere else tore down the shell
 * and everything open inside it. The group's layout leaves `/` alone when there
 * is no session, since redirecting the sign-in page to itself is a loop, so the
 * signed-out half below renders bare.
 *
 * `?next=` is set by the authenticated layout when it turns a signed-out visitor
 * away, and is the reason a link to a specific board survives sign-in. It is
 * attacker-controlled — it arrives in a URL anyone can send — so it is only ever
 * used as a same-origin path, never as a URL.
 */

import { redirect } from "next/navigation";

import GoogleSignInButton from "@/components/GoogleSignInButton";
import SunnyLogo from "@/components/SunnyLogo";
import { getSessionUser } from "@/lib/auth";

import HomeDashboard from "./HomeDashboard";

const HOME = "/";

/**
 * A single leading slash and nothing that could re-target the browser: `//host`
 * and `/\host` are both read as protocol-relative URLs by browsers, so a bare
 * `startsWith("/")` check is an open redirect.
 */
function safeDestination(next: string | string[] | undefined): string {
  if (typeof next !== "string") return HOME;
  if (!next.startsWith("/")) return HOME;
  if (next.startsWith("//") || next.startsWith("/\\")) return HOME;
  return next;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const destination = safeDestination((await searchParams).next);

  if (await getSessionUser()) {
    // Only travel on: landing back here is the destination, not a redirect loop.
    if (destination !== HOME) redirect(destination);

    return <HomeDashboard />;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 px-6 bg-background">
      <SunnyLogo className="h-8 w-auto text-primary" />

      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-display text-2xl text-foreground">Work management, your way</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Boards, groups and items — plus the apps your team builds on top of them.
        </p>
      </div>

      <GoogleSignInButton callbackUrl={destination} />
    </main>
  );
}

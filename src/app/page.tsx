/**
 * Landing page. Signed-in visitors go straight to where they were headed;
 * everyone else gets a sign-in card.
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

const DEFAULT_DESTINATION = "/Dashboard";

/**
 * A single leading slash and nothing that could re-target the browser: `//host`
 * and `/\host` are both read as protocol-relative URLs by browsers, so a bare
 * `startsWith("/")` check is an open redirect.
 */
function safeDestination(next: string | string[] | undefined): string {
  if (typeof next !== "string") return DEFAULT_DESTINATION;
  if (!next.startsWith("/")) return DEFAULT_DESTINATION;
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_DESTINATION;
  return next;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const destination = safeDestination((await searchParams).next);
  if (await getSessionUser()) redirect(destination);

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

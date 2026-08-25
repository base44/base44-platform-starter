/**
 * Landing page. Signed-in visitors go straight to the dashboard; everyone else
 * gets a sign-in card.
 */

import { redirect } from "next/navigation";

import GoogleSignInButton from "@/components/GoogleSignInButton";
import SunnyLogo from "@/components/SunnyLogo";
import { getSessionUser } from "@/lib/auth";

export default async function Home() {
  if (await getSessionUser()) redirect("/Dashboard");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 px-6 bg-background">
      <SunnyLogo className="h-8 w-auto text-primary" />

      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-display text-2xl text-foreground">Work management, your way</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Boards, groups and items — plus the apps your team builds on top of them.
        </p>
      </div>

      <GoogleSignInButton callbackUrl="/Dashboard" />

      <p className="max-w-xs text-center text-xs text-muted-foreground">
        The Google consent screen warns that the app is unverified — expected while the OAuth
        project is in Testing mode.
      </p>
    </main>
  );
}

"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

/**
 * One click from the landing page to Google's consent screen.
 *
 * A plain `<Link href="/api/auth/signin">` would land on NextAuth's *own*
 * sign-in page, which shows a second button with this same label — so signing in
 * cost two identical clicks before Google was ever reached. `signIn("google")`
 * posts straight to the provider (fetching the CSRF token itself), which is what
 * that interstitial exists to do when an app has more than one provider. This
 * one has exactly one.
 */
export default function GoogleSignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        // No `await`: the promise only settles if the redirect never happens.
        signIn("google", { callbackUrl }).catch(() => setPending(false));
      }}
      className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-70"
    >
      {pending ? "Redirecting to Google…" : "Sign in with Google"}
    </button>
  );
}

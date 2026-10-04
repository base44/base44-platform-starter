"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function GoogleSignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    setPending(true);
    setError("");
    try {
      await signIn("google", { redirectTo: "/" });
    } catch {
      setError("Could not start sign-in. Please try again.");
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" disabled={pending} onClick={login}>
        {pending ? "Redirecting to Google…" : "Sign in with Google"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

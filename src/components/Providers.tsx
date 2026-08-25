"use client";

import { SessionProvider } from "next-auth/react";

import { AuthProvider } from "@/lib/AuthContext";

/**
 * The two client providers the UI needs: `SessionProvider` makes `useSession()`
 * work in client components, and `AuthProvider` carries the Base44 link status
 * (see src/lib/AuthContext.tsx).
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthProvider>{children}</AuthProvider>
    </SessionProvider>
  );
}

"use client";

import { SessionProvider } from "next-auth/react";

import { ToastProvider } from "@/components/ui/toast";
import { AuthProvider } from "@/lib/AuthContext";

/**
 * The client providers the UI needs: `SessionProvider` makes `useSession()` work
 * in client components, `AuthProvider` carries the Base44 link status (see
 * src/lib/AuthContext.tsx), and `ToastProvider` owns the one place confirmations
 * and their Undo actions render.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </SessionProvider>
  );
}

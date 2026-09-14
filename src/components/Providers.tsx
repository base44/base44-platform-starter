"use client";

import { SessionProvider } from "next-auth/react";

import AppNotices from "@/components/AppNotices";
import { ToastProvider } from "@/components/ui/toast";
import { AuthProvider } from "@/lib/AuthContext";

/**
 * The client providers the UI needs: `SessionProvider` makes `useSession()` work
 * in client components, `AuthProvider` carries the Base44 link status (see
 * src/lib/AuthContext.tsx), and `ToastProvider` owns the one place confirmations
 * and their Undo actions render.
 *
 * `AppNotices` sits inside the toast provider and above the pages on purpose: it
 * reports app deletions Base44 sent while nobody was looking, and those need to
 * reach the user on whatever page they happen to be on.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthProvider>
        <ToastProvider>
          <AppNotices />
          {children}
        </ToastProvider>
      </AuthProvider>
    </SessionProvider>
  );
}

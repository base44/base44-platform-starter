import AppShell from "@/components/AppShell";
import Providers from "@/components/Providers";

/**
 * The signed-in chrome: client providers plus the nav shell.
 *
 * Two places render it — the authenticated route group's layout, and the root
 * page, which is Home and so cannot sit inside that group (a route group layout
 * cannot own `/` while another page.tsx already resolves to it). Keeping the
 * composition here means the two cannot drift apart.
 */
export default function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}

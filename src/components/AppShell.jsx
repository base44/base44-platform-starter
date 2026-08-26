"use client";

/**
 * The nav chrome and the
 * builder sidebar.
 *
 * Stays `.jsx`, like the rest of the product UI: the shadcn primitives it uses are
 * untyped JS whose `forwardRef` calls infer away even `children`, so consuming
 * them from a `.tsx` file is a type error with no real defect behind it. New
 * infrastructure (`src/lib`, `src/app`) is `.tsx` and strictly typed.
 *
 * It is a client component because the whole tree below it is; the App Router
 * layout that wraps it stays a server component, so the session is fetched there
 * and handed down.
 *
 * The `open-assistant` window event is how several pages open the builder with a
 * preset mode; rewiring that to context is future polish.
 *
 * The builder starts closed and remembers the last choice. It used to open on
 * every page, on every route, taking 380px — over a quarter of a 1440px window —
 * to show a list of four apps, and squeezing the page the user actually asked
 * for. Opening a panel is the user's decision to make once, not the shell's to
 * make repeatedly.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { LogOut, Menu as MenuIcon, Sparkles, X } from "lucide-react";

import AppBuilderSidebar from "@/components/AppBuilderSidebar";
import SunnyLogo from "@/components/SunnyLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createPageUrl } from "@/utils";

const AVATAR_GRADIENT = "linear-gradient(135deg,#0E2E56 0%,#5B87DA 100%)";

const BUILDER_OPEN_KEY = "sunny:builder-open";

/** Closed unless this browser has said otherwise. SSR always renders closed. */
function readBuilderOpen() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BUILDER_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function initialsOf(value) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function AccountMenu() {
  const { data: session } = useSession();
  const user = session?.user;
  const name = user?.name || user?.email || "Account";
  const initials = initialsOf(user?.name || user?.email || "U");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Account menu"
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 hover:ring-2 hover:ring-primary/30 transition-all"
          style={{ background: AVATAR_GRADIENT }}
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="flex items-center gap-3 px-2 py-2">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0 shadow-sm"
            style={{ background: AVATAR_GRADIENT }}
          >
            {initials}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{name}</p>
            {user?.email && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })} className="cursor-pointer">
          <LogOut className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const navigationItems = [
  { title: "Home", url: createPageUrl("Dashboard") },
  { title: "Boards", url: createPageUrl("Boards") },
  { title: "Analytics", url: createPageUrl("Analytics") },
  { title: "My Tools", url: "/MyTools" },
];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Always false on the server and on the first client render: reading storage
  // during render would make the two disagree and hydration would tear.
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderInitialMode, setBuilderInitialMode] = useState(null);

  // `builderInitialMode` sticks around after the open that set it, so clear it
  // here: the assistant button always lands on the builder's own entry screen,
  // never on whatever a previous caller asked for.
  const openAssistant = () => {
    setBuilderInitialMode(null);
    setBuilderOrigin(null);
    setBuilderRequest((n) => n + 1);
    setBuilderOpenPersisted(true);
  };
  const [builderInitialAppId, setBuilderInitialAppId] = useState(null);
  // "home-widget" means the user started in the Add-widget picker.
  const [builderOrigin, setBuilderOrigin] = useState(null);
  // Counts requests, not their contents: two identical requests set the same
  // values, React bails out of the re-render, and the second is never heard.
  const [builderRequest, setBuilderRequest] = useState(0);

  useEffect(() => {
    if (readBuilderOpen()) setBuilderOpen(true);
  }, []);

  const setBuilderOpenPersisted = (next) => {
    setBuilderOpen(next);
    try {
      window.localStorage.setItem(BUILDER_OPEN_KEY, next ? "1" : "0");
    } catch {
      // Private mode: the panel still opens, it just will not be remembered.
    }
  };

  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail;
      setBuilderInitialMode(detail?.mode || null);
      setBuilderInitialAppId(detail?.appId || null);
      setBuilderOrigin(detail?.origin || null);
      setBuilderRequest((n) => n + 1);
      setBuilderOpenPersisted(true);
    };
    window.addEventListener("open-assistant", handler);
    return () => window.removeEventListener("open-assistant", handler);
  }, []);

  const isActive = (url) => pathname === url || (url === "/Dashboard" && pathname === "/");

  return (
    <div
      className={`min-h-screen flex flex-col bg-background transition-all duration-300 ${
        builderOpen ? "md:mr-[380px]" : ""
      }`}
    >
      <nav className="bg-card border-b border-border shadow-sm sticky top-0 z-30">
        <div className="px-4 sm:px-6">
          <div className="flex items-center h-14 gap-8">
            <Link
              href={createPageUrl("Dashboard")}
              aria-label="Sunny home"
              className="flex items-center flex-shrink-0"
            >
              <SunnyLogo className="h-6 w-auto text-primary" aria-hidden="true" />
            </Link>

            <div className="hidden md:flex items-center gap-1 flex-1 flex-nowrap overflow-hidden">
              {navigationItems.map((item) => (
                <Link
                  key={item.title}
                  href={item.url}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap ${
                    isActive(item.url)
                      ? "text-primary font-semibold bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {item.title}
                </Link>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-3 ml-auto justify-end flex-1">
              {!builderOpen && (
                <button
                  onClick={() => openAssistant()}
                  className="flex items-center gap-2 text-sm font-medium bg-primary text-primary-foreground px-3.5 py-1.5 rounded-md hover:bg-primary/90 transition-colors shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  Assistant
                </button>
              )}
              <AccountMenu />
            </div>

            <div className="md:hidden ml-auto flex items-center gap-2">
              <button
                onClick={() => openAssistant()}
                aria-label="Open the Assistant"
                className="flex items-center justify-center min-w-[40px] min-h-[40px] text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <AccountMenu />
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? "Close the menu" : "Open the menu"}
                aria-expanded={mobileMenuOpen}
                className="flex items-center justify-center min-w-[40px] min-h-[40px] rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                {mobileMenuOpen ? (
                  <X className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <MenuIcon className="w-5 h-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-card">
            <div className="px-4 sm:px-6 py-3 space-y-1">
              {navigationItems.map((item) => (
                <Link
                  key={item.title}
                  href={item.url}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                    isActive(item.url)
                      ? "text-primary font-semibold bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {item.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>

      <AppBuilderSidebar
        open={builderOpen}
        onClose={() => setBuilderOpenPersisted(false)}
        initialMode={builderInitialMode}
        initialAppId={builderInitialAppId}
        origin={builderOrigin}
        requestId={builderRequest}
      />
    </div>
  );
}

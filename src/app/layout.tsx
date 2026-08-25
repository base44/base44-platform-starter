import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

/**
 * Inter used to arrive via `@import url(...)` at the top of index.css.
 * next/font self-hosts it instead — one less render-blocking request, and no
 * layout shift. `--font-inter` is what globals.css feeds into --font-body etc.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sunny",
  description: "Work management, white-labelled on Base44.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

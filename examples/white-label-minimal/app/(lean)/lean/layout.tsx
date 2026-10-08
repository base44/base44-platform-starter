import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "../../../lean/globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Tiny Sunny",
  description: "Your apps, built with Sunny",
};

// The lean rewrite's own root layout, so its styles never load with the classic app's.
export default function LeanLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} font-sans`}>
      <body>{children}</body>
    </html>
  );
}

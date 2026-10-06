import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Tiny Sunny",
  description: "Your apps, built with Sunny",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} font-sans`}>
      <body>{children}</body>
    </html>
  );
}

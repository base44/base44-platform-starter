import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Minimal Builder', description: 'A local Base44 white-label integration example', referrer: 'no-referrer' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

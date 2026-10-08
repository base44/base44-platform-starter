import { notFound } from "next/navigation";
import Workspace from "../../../lean/components/Workspace";

// Read the flag on each request, not once at build time.
export const dynamic = "force-dynamic";

// Shown only when TINY_SUNNY_LEAN=true; app/(classic)/page.tsx sends / here.
export default function LeanPage() {
  if (process.env.TINY_SUNNY_LEAN !== "true") notFound();
  return <Workspace />;
}

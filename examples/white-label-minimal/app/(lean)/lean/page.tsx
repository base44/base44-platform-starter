import { notFound } from "next/navigation";
import { Button } from "../../../lean/components/ui/button";
import Workspace from "../../../lean/components/Workspace";
import { auth, signIn } from "../../../lean/server/auth";

// Shown only when TINY_SUNNY_LEAN=true; app/(classic)/page.tsx sends / here.
export default async function LeanPage() {
  if (process.env.TINY_SUNNY_LEAN !== "true") notFound();
  if (await auth()) return <Workspace />;
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-6">
      <img className="h-8" src="/tiny-sunny-logo.svg" alt="Tiny Sunny" />
      <form action={async () => { "use server"; await signIn("google", { redirectTo: "/lean" }); }}>
        <Button>Sign in with Google</Button>
      </form>
    </main>
  );
}

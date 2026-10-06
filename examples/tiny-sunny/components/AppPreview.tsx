import { AppWindow } from "lucide-react";
import type { App } from "../types";

export default function AppPreview({ app }: { app: App | null }) {
  if (!app) {
    return (
      <main className="flex h-full items-center justify-center bg-muted p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border bg-background shadow-xs">
            <AppWindow className="size-6 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-semibold">No app yet</h1>
          <p className="text-sm text-muted-foreground">
            Describe what you want to build in the chat. Your app shows up here.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full bg-muted p-4">
      <iframe
        key={app.id}
        title={app.name}
        srcDoc={app.html}
        sandbox="allow-scripts"
        className="size-full rounded-xl border bg-white shadow-sm"
      />
    </main>
  );
}

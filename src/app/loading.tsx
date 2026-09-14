import SunnyLogo from "@/components/SunnyLogo";

/** Above the authenticated layout so its session lookup can stream a fallback. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading Sunny" className="min-h-screen bg-background">
      <span className="sr-only">Loading your workspace…</span>
      <div aria-hidden="true">
        <div className="h-14 border-b border-border bg-card px-4 sm:px-6 flex items-center">
          <SunnyLogo className="h-6 w-auto text-primary" />
        </div>
        <div className="border-b border-border">
          <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-7 space-y-3">
            <div className="h-4 w-40 rounded bg-primary/10 motion-safe:animate-pulse" />
            <div className="h-8 w-64 rounded bg-primary/10 motion-safe:animate-pulse" />
          </div>
        </div>
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-8 space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-[72px] rounded-lg bg-primary/10 motion-safe:animate-pulse" />
            ))}
          </div>
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-lg border border-border bg-card p-4 space-y-4">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="h-10 rounded bg-primary/10 motion-safe:animate-pulse" />
              ))}
            </div>
            <div className="rounded-lg border border-border bg-card p-4 space-y-4">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="h-10 rounded bg-primary/10 motion-safe:animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

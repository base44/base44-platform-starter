import { Loader2 } from "lucide-react";

const PENDING = ["running", "waiting_for_user_input", "pending"];
const FAILED = ["error", "stopped"];

/**
 * Shared chrome for a user-input tool row, so status presentation can't drift
 * between widgets. Mirrors the generic ToolCallDisplay's visual language (same
 * border/spinner tokens) but always shows its summary and interactive slot —
 * a form folded inside a collapsed row is the worst failure mode in this design.
 */
export default function ToolRow({ status, name, isLastRunningTool, summary, form }) {
  const pending = PENDING.includes(status);
  const failed = FAILED.includes(status);
  const running = status === "running";

  return (
    <div className="mt-2 text-xs border border-border rounded overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary text-left">
        {pending ? (
          <Loader2 className="w-3 h-3 animate-spin text-accent flex-shrink-0" />
        ) : failed ? (
          <span className="w-2 h-2 rounded-full bg-destructive flex-shrink-0" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-foreground/40 flex-shrink-0" />
        )}
        <span
          className={`font-medium text-foreground font-mono ${running && isLastRunningTool ? "opacity-70" : ""}`}
        >
          {name}
        </span>
      </div>
      {summary && <div className="px-3 py-2 text-muted-foreground bg-card">{summary}</div>}
      {form && (
        <div className="px-3 py-3 bg-card border-t border-border border-l-2 border-l-accent">
          {form}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

const PENDING = ["running", "waiting"];
const FAILED = ["error", "stopped"];

/**
 * One step of a builder turn, with `useChat`'s step status. Every step renders
 * through it, so status presentation can't drift between widgets. It always
 * shows its summary and interactive slot: a form folded inside a collapsed row
 * is the worst failure mode in this design. Only `details` folds, behind the
 * header.
 */
export default function ToolRow({ status, name, summary, form, details }) {
  const [expanded, setExpanded] = useState(false);
  const pending = PENDING.includes(status);
  const failed = FAILED.includes(status);
  const Header = details ? "button" : "div";

  return (
    <div className="mt-2 text-xs border border-border rounded overflow-hidden">
      <Header
        {...(details && { type: "button", onClick: () => setExpanded(!expanded), "aria-expanded": expanded })}
        className={`w-full flex items-center gap-2 px-3 py-2 bg-secondary text-left ${details ? "hover:bg-secondary/70 transition-colors" : ""}`}
      >
        {pending ? (
          <Loader2 className="w-3 h-3 animate-spin text-accent flex-shrink-0" />
        ) : failed ? (
          <span className="w-2 h-2 rounded-full bg-destructive flex-shrink-0" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-foreground/40 flex-shrink-0" />
        )}
        <span className="font-medium text-foreground truncate">{name}</span>
        {details && (
          <ChevronDown
            className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </Header>
      {expanded && details && <div className="px-3 py-2 bg-card text-muted-foreground">{details}</div>}
      {summary && <div className="px-3 py-2 text-muted-foreground bg-card">{summary}</div>}
      {form && (
        <div className="px-3 py-3 bg-card border-t border-border border-l-2 border-l-accent">
          {form}
        </div>
      )}
    </div>
  );
}

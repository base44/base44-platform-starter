/**
 * The four numbers that decide what the user does next, as filters rather than
 * facts. Selecting one drives the work list below it; selecting it again clears.
 *
 * This replaces the "You have N tasks pending" sentence, which was both wrong
 * (see src/lib/taskStats.ts) and inert — it named a number the user could not
 * act on, in the most valuable strip of the page.
 */
import React from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, UserMinus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const CARDS = [
  { key: "overdue", label: "Overdue", icon: AlertTriangle, tone: "text-destructive" },
  { key: "dueToday", label: "Due today", icon: CalendarClock, tone: "text-foreground" },
  { key: "unassigned", label: "Unassigned", icon: UserMinus, tone: "text-foreground" },
  { key: "doneThisWeek", label: "Done this week", icon: CheckCircle2, tone: "text-foreground" },
];

export default function TaskStats({ buckets, selected, onSelect, isLoading }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {CARDS.map((card) => (
          <Skeleton key={card.key} className="h-[72px] rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {CARDS.map((card) => {
        const count = buckets[card.key]?.length ?? 0;
        const active = selected === card.key;
        const empty = count === 0;
        return (
          <button
            key={card.key}
            type="button"
            onClick={() => onSelect(active ? null : card.key)}
            // The visible name is split across two elements and the number is
            // the point, so spell it out rather than leaving it to be inferred.
            aria-label={`${card.label}: ${count} ${count === 1 ? "task" : "tasks"}${
              empty ? "" : active ? ". Showing these." : ". Show these."
            }`}
            aria-pressed={active}
            // Nothing to filter to, so it reads as a number and not as a control.
            disabled={empty}
            className={`text-left rounded-lg border px-4 py-3 min-h-[72px] transition-colors ${
              active
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-foreground/25"
            } ${empty ? "opacity-60 cursor-default hover:border-border" : ""}`}
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <card.icon
                className={`w-3.5 h-3.5 ${count > 0 && card.key === "overdue" ? card.tone : ""}`}
                aria-hidden="true"
              />
              {card.label}
            </span>
            <span
              className={`block mt-1 text-2xl font-semibold tabular-nums ${
                count > 0 && card.key === "overdue" ? "text-destructive" : "text-foreground"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

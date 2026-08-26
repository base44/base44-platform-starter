/**
 * "Pick up where you left off" — the work itself, on the home page.
 *
 * Replaces the Quick actions block, two thirds of which (Analytics, and a second
 * route to Boards) only repeated the top nav. What the home page was missing was
 * not another way to navigate: it was any way to *finish* something. Status is
 * editable inline here, against the board's own status column, so the common
 * case — mark the thing you just did as done — never costs a page load.
 *
 * It carries no action strip of its own. "Build a tool" sat in this card's footer
 * only because removing Quick actions would otherwise have dropped an entry
 * point — a bad reason: a tool built from here appears in My Widgets far below,
 * so the affordance promised something the card it lived in could not deliver.
 * The Assistant button in the nav and "+ Add widget" both already lead there.
 * Calendar is a view of the workspace, so it moved to the nav.
 */
import React, { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, isToday, isPast } from "date-fns";
import { ChevronDown, Inbox, CalendarDays } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { createPageUrl } from "@/utils";
import { columnOfType, dueDateOf, isDone, statusOf } from "@/lib/taskStats";

const FALLBACK_CHOICES = [
  { label: "Not Started", color: "#C4C4C4" },
  { label: "Working on it", color: "#F1BD6C" },
  { label: "Done", color: "#5DA283" },
  { label: "Stuck", color: "#F06A6A" },
];

const EMPTY_COPY = {
  overdue: "Nothing is overdue.",
  dueToday: "Nothing is due today.",
  unassigned: "Every task has an owner.",
  doneThisWeek: "Nothing finished this week yet.",
  default: "No tasks yet. Create a board to start tracking work.",
};

const LIMIT = 6;

/**
 * `done` matters: a finished task with a date in the past is not overdue, and the
 * stat cards already exclude it. Without this the counts and the rows disagree —
 * "Overdue: 2" above three rows each labelled Overdue.
 */
function DueLabel({ due, done }) {
  if (!due) return null;
  const overdue = !done && isPast(due) && !isToday(due);
  const prefix = overdue ? "Overdue · " : isToday(due) ? "Due today · " : "Due ";
  return (
    <span className={`text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
      {prefix}
      {formatDistanceToNow(due, { addSuffix: true })}
    </span>
  );
}

function StatusPicker({ item, board, onChange }) {
  const [saving, setSaving] = useState(false);
  const column = columnOfType(board, "status");
  const current = statusOf(item, board) || "Not Started";
  const choices = column?.options?.choices?.length ? column.options.choices : FALLBACK_CHOICES;
  const color = choices.find((c) => c.label === current)?.color || "#C4C4C4";

  // No status column means no status to set — show the item, offer nothing.
  if (!column?.id) return null;

  const pick = async (label) => {
    if (label === current) return;
    setSaving(true);
    try {
      await onChange(item, column.id, label);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={saving}
          aria-label={`Status of ${item.title || "this task"}: ${current}. Change it.`}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded min-h-[32px] disabled:opacity-60 transition-opacity"
          style={{ backgroundColor: `${color}26`, color: "inherit" }}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <span className="truncate max-w-[7rem]">{current}</span>
          <ChevronDown className="w-3 h-3 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map((choice) => (
          <DropdownMenuItem
            key={choice.label}
            onClick={() => pick(choice.label)}
            className="cursor-pointer text-xs"
          >
            <span
              className="w-2 h-2 rounded-full mr-2 flex-shrink-0"
              style={{ backgroundColor: choice.color || "#C4C4C4" }}
            />
            {choice.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function WorkList({ items, boardsById, isLoading, filter, onStatusChange }) {
  const visible = items.slice(0, LIMIT);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-3 h-6">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Inbox className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {filter ? "Filtered tasks" : "Pick up where you left off"}
        </h2>
        <div className="flex items-center gap-3">
          {items.length > LIMIT && (
            <span className="text-xs text-muted-foreground">
              showing {LIMIT} of {items.length}
            </span>
          )}
          {/* The calendar is these same tasks arranged by date, so it belongs next to
              them rather than in the header. Someone scanning due dates finds it
              without having gone looking. */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-calendar"))}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
            Calendar
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array(3)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10 px-4">
            {EMPTY_COPY[filter] || EMPTY_COPY.default}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((item) => {
              const board = boardsById.get(item.board_id);
              const due = dueDateOf(item, board);
              const done = isDone(item, board);
              return (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={createPageUrl(`Board?id=${item.board_id}`)}
                      className="text-sm font-medium text-foreground hover:underline block truncate"
                    >
                      {item.title || "Untitled task"}
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground truncate">
                        {board?.title || "Unknown board"}
                      </span>
                      {due && <span className="w-1 h-1 rounded-full bg-border" />}
                      <DueLabel due={due} done={done} />
                    </div>
                  </div>
                  <StatusPicker item={item} board={board} onChange={onStatusChange} />
                </li>
              );
            })}
          </ul>
        )}

      </div>
    </div>
  );
}

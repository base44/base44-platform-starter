/**
 * "Pick up where you left off" — the work itself, on the home page.
 *
 * Replaces the Quick actions block, two thirds of which (Analytics, and a second
 * route to Boards) only repeated the top nav. What the home page was missing was
 * not another way to navigate: it was any way to *finish* something. Status is
 * editable inline here, against the board's own status column, so the common
 * case — mark the thing you just did as done — never costs a page load.
 *
 * The two actions that are genuinely not in the nav (Build a tool, Calendar)
 * survive as a footer strip.
 */
import React, { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, isToday, isPast } from "date-fns";
import { Calendar, ChevronDown, Inbox, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { createPageUrl } from "@/utils";
import { columnOfType, dueDateOf, statusOf } from "@/lib/taskStats";

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

function DueLabel({ due }) {
  if (!due) return null;
  const overdue = isPast(due) && !isToday(due);
  return (
    <span className={`text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
      {overdue ? "Overdue · " : isToday(due) ? "Due today · " : "Due "}
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

export default function WorkList({
  items,
  boardsById,
  isLoading,
  filter,
  onStatusChange,
  onOpenCalendar,
}) {
  const visible = items.slice(0, LIMIT);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-3 h-6">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Inbox className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {filter ? "Filtered tasks" : "Pick up where you left off"}
        </h2>
        {items.length > LIMIT && (
          <span className="text-xs text-muted-foreground">
            showing {LIMIT} of {items.length}
          </span>
        )}
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
                      <DueLabel due={due} />
                    </div>
                  </div>
                  <StatusPicker item={item} board={board} onChange={onStatusChange} />
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-border px-2 py-1.5 flex items-center gap-1">
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("open-assistant", { detail: { mode: "build" } }),
              )
            }
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 min-h-[36px] rounded hover:bg-secondary transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Build a tool
          </button>
          <button
            onClick={onOpenCalendar}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 min-h-[36px] rounded hover:bg-secondary transition-colors"
          >
            <Calendar className="w-3.5 h-3.5" aria-hidden="true" /> Calendar
          </button>
        </div>
      </div>
    </div>
  );
}

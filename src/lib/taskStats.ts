/**
 * Reads task state out of boards + items, the way the board UI does.
 *
 * A board's columns are user-defined, so an item's status does not live under
 * `data.status` — it lives under `data[<the status column's id>]`. The default
 * board template happens to name that column `status`, which is why reading
 * `data.status` looked correct: it works until someone renames or rebuilds the
 * column, and then every item silently reads as "no status". Resolve the column
 * first, here, once, and every caller gets the same answer as the board grid.
 *
 * Everything is scoped to boards the caller actually passed in. An item whose
 * board is gone still exists in the table, and counting it is how the dashboard
 * came to claim four pending tasks against a workspace holding three.
 */

export type BoardColumn = { id?: string; title?: string; type?: string };
export type BoardLike = { id?: string; title?: string; columns?: BoardColumn[] | null };
export type ItemLike = {
  id?: string;
  title?: string;
  board_id?: string;
  group_id?: string | null;
  data?: Record<string, unknown> | null;
  updated_date?: string;
};

/** Status labels that mean "no longer pending", lowercased. */
const DONE_LABELS = new Set(["done", "complete", "completed", "closed", "shipped"]);

export function columnOfType(board: BoardLike | undefined, type: string): BoardColumn | undefined {
  return board?.columns?.find((col) => col?.type === type);
}

function cellValue(item: ItemLike, column: BoardColumn | undefined): unknown {
  if (!column?.id) return undefined;
  return item.data?.[column.id];
}

export function statusOf(item: ItemLike, board: BoardLike | undefined): string | null {
  const value = cellValue(item, columnOfType(board, "status"));
  return typeof value === "string" && value.trim() ? value : null;
}

export function isDone(item: ItemLike, board: BoardLike | undefined): boolean {
  const status = statusOf(item, board);
  return status !== null && DONE_LABELS.has(status.trim().toLowerCase());
}

/** `<input type="date">` — which is what the board's date cell is — writes this. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The window a date cell accepts, as `<input type="date">` min/max attributes.
 *
 * A native date input takes up to six year digits, so a stray keystroke turns
 * "2029" into "20299" and the board dutifully stores a due date 18,000 years
 * out — sorting, the calendar and the timeline all follow it there.
 */
export const MIN_DATE = "1900-01-01";
export const MAX_DATE = "2099-12-31";

/**
 * A bare `YYYY-MM-DD` as a *local* date, or null.
 *
 * `new Date("2026-08-26")` is UTC midnight by spec, which is the *previous* day
 * anywhere west of UTC — so a task due today reads as overdue in New York. A
 * bare date carries no timezone and means that day where the reader is.
 *
 * The parts are read back because `new Date(2026, 1, 30)` rolls into March
 * rather than rejecting February 30th.
 */
function parseDateOnly(value: string): Date | null {
  const parts = DATE_ONLY.exec(value.trim());
  if (!parts) return null;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const date = new Date(year, month - 1, day);
  const rolled =
    date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day;
  return rolled ? null : date;
}

/**
 * Whatever is stored in a date cell, as a Date — or null when it isn't one.
 *
 * Cells hold either a bare `YYYY-MM-DD` (the grid's date input) or a full ISO
 * timestamp (the task modal's calendar, which serialises a Date), so both have
 * to read back.
 */
export function parseCellDate(value: unknown): Date | null {
  if (typeof value === "string") {
    const dateOnly = parseDateOnly(value);
    if (dateOnly) return dateOnly;
  } else if (typeof value !== "number" && !(value instanceof Date)) {
    return null;
  }

  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A Date as the `YYYY-MM-DD` an `<input type="date">` will show. */
export function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True when a date cell may commit this input: a real day, inside the window. */
export function isDateInputValid(value: string): boolean {
  const trimmed = value.trim();
  if (!parseDateOnly(trimmed)) return false;
  return trimmed >= MIN_DATE && trimmed <= MAX_DATE;
}

export function dueDateOf(item: ItemLike, board: BoardLike | undefined): Date | null {
  return parseCellDate(cellValue(item, columnOfType(board, "date")));
}

/** True when the board has a people column and this item leaves it empty. */
export function isUnassigned(item: ItemLike, board: BoardLike | undefined): boolean {
  const column = columnOfType(board, "people");
  if (!column) return false;
  const value = cellValue(item, column);
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export type Bucket = "overdue" | "dueToday" | "unassigned" | "doneThisWeek";

export type TaskStats = {
  /** Items that live on one of the boards passed in. Orphans are excluded. */
  scoped: ItemLike[];
  /** Items whose board no longer exists — counted nowhere, surfaced for debugging. */
  orphaned: ItemLike[];
  pending: number;
  buckets: Record<Bucket, ItemLike[]>;
};

/**
 * `now` is a parameter so this is pure and testable; callers pass `new Date()`.
 */
export function summarize(
  boards: BoardLike[],
  items: ItemLike[],
  now: Date = new Date(),
): TaskStats {
  const byId = new Map<string, BoardLike>();
  for (const board of boards) if (board?.id) byId.set(board.id, board);

  const scoped: ItemLike[] = [];
  const orphaned: ItemLike[] = [];
  for (const item of items) {
    (item.board_id && byId.has(item.board_id) ? scoped : orphaned).push(item);
  }

  const today = startOfDay(now);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const buckets: Record<Bucket, ItemLike[]> = {
    overdue: [],
    dueToday: [],
    unassigned: [],
    doneThisWeek: [],
  };
  let pending = 0;

  for (const item of scoped) {
    const board = byId.get(item.board_id as string);
    const done = isDone(item, board);
    if (!done) pending += 1;

    if (done) {
      const updated = item.updated_date ? new Date(item.updated_date) : null;
      if (updated && !Number.isNaN(updated.getTime()) && updated >= weekAgo) {
        buckets.doneThisWeek.push(item);
      }
      // A finished task is neither overdue nor waiting on an owner.
      continue;
    }

    const due = dueDateOf(item, board);
    if (due) {
      const dueDay = startOfDay(due);
      if (dueDay < today) buckets.overdue.push(item);
      else if (dueDay.getTime() === today.getTime()) buckets.dueToday.push(item);
    }
    if (isUnassigned(item, board)) buckets.unassigned.push(item);
  }

  return { scoped, orphaned, pending, buckets };
}

/** Per-board item counts, scoped the same way the stats are. */
export function countsByBoard(items: ItemLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.board_id) continue;
    counts.set(item.board_id, (counts.get(item.board_id) ?? 0) + 1);
  }
  return counts;
}

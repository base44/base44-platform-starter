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

export function dueDateOf(item: ItemLike, board: BoardLike | undefined): Date | null {
  const value = cellValue(item, columnOfType(board, "date"));
  if (typeof value !== "string" && typeof value !== "number") return null;

  // `new Date("2026-08-26")` is UTC midnight by spec, which is the *previous*
  // day anywhere west of UTC — so a task due today reads as overdue in New York.
  // A bare date carries no timezone and means that day where the reader is.
  if (typeof value === "string") {
    const parts = DATE_ONLY.exec(value.trim());
    if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

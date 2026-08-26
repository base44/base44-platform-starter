/**
 * Seeds "Summit House" — the worked example board.
 *
 * A demo of Sunny should exercise every column type against work that reads as
 * real, because a board of "Task 1 / Task 2" demonstrates nothing and a board of
 * book titles demonstrates the wrong thing. So: a two-day company summit, four
 * tracks, real money, owners, and a spread of statuses.
 *
 * Due dates are relative to the run, not fixed, so the board keeps showing
 * genuine "overdue" and "due today" states next month instead of decaying into a
 * wall of red. Re-running replaces the board rather than stacking duplicates.
 *
 *   npm run seed:example -- you@example.com
 *
 * The email must already exist as a `User`; the rows are created as owned by it,
 * because every user-owned model is read back through `scopedWhere()`.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BOARD_TITLE = "Summit House";

const columns = [
  { id: "task", title: "Task", type: "text", width: 300 },
  {
    id: "status",
    title: "Status",
    type: "status",
    width: 150,
    options: {
      choices: [
        { label: "Not Started", color: "#C4C4C4" },
        { label: "Working on it", color: "#F1BD6C" },
        { label: "Blocked", color: "#F06A6A" },
        { label: "In Review", color: "#9747FF" },
        { label: "Done", color: "#5DA283" },
      ],
    },
  },
  { id: "owner", title: "Owner", type: "people", width: 140 },
  { id: "due_date", title: "Due Date", type: "date", width: 130 },
  {
    id: "track",
    title: "Track",
    type: "dropdown",
    width: 130,
    options: {
      choices: [
        { value: "logistics", label: "Logistics", color: "#5B87DA" },
        { value: "program", label: "Program", color: "#9747FF" },
        { value: "comms", label: "Comms", color: "#EC8D71" },
        { value: "finance", label: "Finance", color: "#5DA283" },
      ],
    },
  },
  { id: "budget", title: "Budget", type: "budget", width: 110 },
  { id: "confirmed", title: "Confirmed", type: "checkbox", width: 100 },
  { id: "notes", title: "Notes", type: "text", width: 220 },
];

const groups = [
  { id: "g_venue", title: "Venue & logistics", color: "#5B87DA", collapsed: false },
  { id: "g_program", title: "Program", color: "#9747FF", collapsed: false },
  { id: "g_comms", title: "Comms & attendees", color: "#EC8D71", collapsed: false },
  { id: "g_finance", title: "Budget & vendors", color: "#5DA283", collapsed: false },
];

type Row = {
  group: string;
  title: string;
  status: string;
  owner: string;
  due: number;
  track: string;
  budget: number;
  confirmed: boolean;
  notes: string;
  priority: "low" | "medium" | "high" | "critical";
};

/** `owner: ""` is deliberate — an unassigned task is a state worth demonstrating. */
const rows: Row[] = [
  { group: "g_venue", title: "Sign the venue contract", status: "Done", owner: "Amit", due: -21, track: "logistics", budget: 42000, confirmed: true, notes: "Two floors, 12–13 Nov", priority: "critical" },
  { group: "g_venue", title: "Confirm the AV and stage build", status: "Blocked", owner: "Dana", due: -4, track: "logistics", budget: 15500, confirmed: false, notes: "Waiting on the rigging survey", priority: "critical" },
  { group: "g_venue", title: "Walk the floor plan with the venue", status: "Working on it", owner: "Amit", due: 0, track: "logistics", budget: 0, confirmed: false, notes: "Bring the seating map", priority: "high" },
  { group: "g_venue", title: "Book the shuttle from the airport", status: "Not Started", owner: "", due: 6, track: "logistics", budget: 3800, confirmed: false, notes: "", priority: "medium" },
  { group: "g_venue", title: "Accessibility review of both floors", status: "Not Started", owner: "", due: -1, track: "logistics", budget: 0, confirmed: false, notes: "Step-free route to the stage", priority: "high" },

  { group: "g_program", title: "Lock the keynote speaker", status: "In Review", owner: "Amit", due: 0, track: "program", budget: 12000, confirmed: false, notes: "Two candidates, both available", priority: "critical" },
  { group: "g_program", title: "Publish the session grid", status: "Working on it", owner: "Noa", due: 3, track: "program", budget: 0, confirmed: false, notes: "Depends on the keynote slot", priority: "high" },
  { group: "g_program", title: "Brief the eight track hosts", status: "Not Started", owner: "Noa", due: 9, track: "program", budget: 0, confirmed: false, notes: "", priority: "medium" },
  { group: "g_program", title: "Dry-run the demo stations", status: "Not Started", owner: "", due: 11, track: "program", budget: 2400, confirmed: false, notes: "", priority: "medium" },
  { group: "g_program", title: "Collect speaker slides", status: "Working on it", owner: "Dana", due: -2, track: "program", budget: 0, confirmed: false, notes: "3 of 8 received", priority: "high" },

  { group: "g_comms", title: "Send the save-the-date", status: "Done", owner: "Noa", due: -18, track: "comms", budget: 0, confirmed: true, notes: "Opened by 71%", priority: "medium" },
  { group: "g_comms", title: "Open registration", status: "Done", owner: "Amit", due: -9, track: "comms", budget: 1900, confirmed: true, notes: "412 registered so far", priority: "critical" },
  { group: "g_comms", title: "Write the week-before logistics email", status: "Not Started", owner: "Amit", due: 4, track: "comms", budget: 0, confirmed: false, notes: "", priority: "high" },
  { group: "g_comms", title: "Design the badge and signage set", status: "In Review", owner: "Dana", due: 1, track: "comms", budget: 5600, confirmed: false, notes: "", priority: "medium" },
  { group: "g_comms", title: "Draft the post-event survey", status: "Not Started", owner: "", due: 14, track: "comms", budget: 0, confirmed: false, notes: "", priority: "low" },

  { group: "g_finance", title: "Reconcile the catering quote", status: "Blocked", owner: "Amit", due: -6, track: "finance", budget: 22800, confirmed: false, notes: "Vendor has not sent the final headcount price", priority: "critical" },
  { group: "g_finance", title: "Approve the photographer", status: "Working on it", owner: "Noa", due: 2, track: "finance", budget: 4200, confirmed: false, notes: "", priority: "medium" },
  { group: "g_finance", title: "Close out last year's invoices", status: "Done", owner: "Amit", due: -30, track: "finance", budget: 0, confirmed: true, notes: "", priority: "low" },
  { group: "g_finance", title: "Set the contingency line at 8%", status: "Not Started", owner: "", due: 7, track: "finance", budget: 0, confirmed: false, notes: "", priority: "medium" },
];

/** `<input type="date">` format, in local time — see dueDateOf in src/lib/taskStats.ts. */
function dayOffset(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) {
    console.error("Usage: npm run seed:example -- you@example.com");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No User row for ${email}. Sign in once first, so the row exists.`);
    process.exit(1);
  }

  // deleteMany, not delete: it is the owner-scoped form, and it is a no-op on a
  // first run instead of throwing.
  const { count } = await prisma.board.deleteMany({
    where: { title: BOARD_TITLE, createdBy: email },
  });
  if (count) console.log(`replaced ${count} existing "${BOARD_TITLE}" board(s)`);

  const board = await prisma.board.create({
    data: {
      title: BOARD_TITLE,
      description: "Two-day company summit, 12–13 Nov. Every column type, four tracks, real money.",
      color: "#0E2E56",
      visibility: "private",
      viewType: "table",
      columns,
      groups,
      createdBy: email,
    },
  });

  await prisma.item.createMany({
    data: rows.map((row, index) => ({
      title: row.title,
      boardId: board.id,
      groupId: row.group,
      orderIndex: index,
      priority: row.priority,
      createdBy: email,
      data: {
        task: row.title,
        status: row.status,
        owner: row.owner,
        due_date: dayOffset(row.due),
        track: row.track,
        budget: row.budget,
        confirmed: row.confirmed,
        notes: row.notes,
      },
    })),
  });

  const overdue = rows.filter((r) => r.due < 0 && r.status !== "Done").length;
  const dueToday = rows.filter((r) => r.due === 0 && r.status !== "Done").length;
  const unassigned = rows.filter((r) => !r.owner && r.status !== "Done").length;
  console.log(
    `seeded "${BOARD_TITLE}" (${board.id}) for ${email}: ${rows.length} items — ` +
      `${overdue} overdue, ${dueToday} due today, ${unassigned} unassigned`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

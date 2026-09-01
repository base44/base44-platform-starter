/**
 * The white-label strip at the top of the workspace: name, blurb, accent colour.
 *
 * Pure branding, with no model behind it. A `Team` entity lived here once and
 * could not do the one thing a team is for: every user-owned model is scoped to
 * `created_by` (src/lib/rls.ts), so a team row was private to whoever created it
 * and shared nothing. A shell that renames itself per customer needs a constant;
 * real sharing needs a membership predicate inside `scopedWhere()`, which is a
 * different product from the one this repo demonstrates.
 */
export const WORKSPACE_BRAND = {
  name: "Summit House",
  description: "Work management for the Summit House crew.",
  /** Square emblem for the banner thumbnail; falls back to initials when empty. */
  logoUrl: "/brand/summit-house-emblem.png",
  /** Accent behind the banner. Same default as a new board. */
  color: "#0073EA",
} as const;

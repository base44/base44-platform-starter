/**
 * The entity registry — the wire⇄Prisma boundary for /api/entities.
 *
 * Two jobs, both pure (no Prisma, no I/O, so `scripts/entity-api-smoke.ts` can
 * hammer them):
 *
 *   1. **Translation.** The wire contract is Base44's: snake_case fields with
 *      `created_date`/`updated_date`/`created_by`. The schema is camelCase with
 *      `createdAt`/`updatedAt`/`createdBy`, so a passthrough would be wrong and
 *      every field is declared here exactly once.
 *   2. **Whitelisting.** A caller-supplied filter, sort or body must never reach a
 *      Prisma query as-is: a raw object spread into `where` is an injection into the
 *      RLS predicate (`{ createdBy: { not: "..." } }` would defeat it, `{ items: … }`
 *      would traverse relations). Nothing crosses this module unless it is declared
 *      `filterable` / `sortable` / `writable` below.
 *
 * Surface is scoped to what the UI actually calls: list(sort, limit),
 * filter(equality, sort), create, bulkCreate, update(id, data), delete(id).
 * Base44's `PATCH /update-many`, `PUT /bulk`, `/restore` and body-filtered
 * collection DELETE have no call sites here, so they are not implemented.
 */

import { USER_OWNED_MODELS, type UserOwnedModel } from "@/lib/rls";

/** Thrown for any bad request; routes turn it into a 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

type FieldType =
  | { kind: "string" }
  | { kind: "int" }
  | { kind: "float" }
  | { kind: "bool" }
  | { kind: "json" }
  | { kind: "stringArray" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "date" };

type FieldSpec = {
  /** camelCase Prisma field. */
  prisma: string;
  type: FieldType;
  /** Accepts an explicit null (and may be omitted on create). */
  nullable: boolean;
  writable: boolean;
  /** Must be present on create. */
  required: boolean;
  /** Usable as an equality key in `q`. */
  filterable: boolean;
  sortable: boolean;
};

type Fields = Record<string, FieldSpec>;

function field(
  prisma: string,
  type: FieldType,
  opts: Partial<Omit<FieldSpec, "prisma" | "type">> = {},
): FieldSpec {
  return {
    prisma,
    type,
    nullable: opts.nullable ?? false,
    writable: opts.writable ?? true,
    required: opts.required ?? false,
    // Only scalars are filterable; Json and arrays are excluded by default because
    // equality on them is meaningless here and the values are attacker-shaped.
    filterable: opts.filterable ?? (type.kind !== "json" && type.kind !== "stringArray"),
    sortable: opts.sortable ?? (type.kind !== "json" && type.kind !== "stringArray"),
  };
}

/**
 * Present on every model. `id`, the timestamps and `created_by` are read-only:
 * `created_by` in particular is stamped from the session by `ownerFields()` and
 * must never come from request input (gotcha 6).
 */
const AUTO_FIELDS: Fields = {
  id: field("id", { kind: "string" }, { writable: false }),
  created_by: field("createdBy", { kind: "string" }, { writable: false }),
  created_date: field("createdAt", { kind: "date" }, { writable: false, filterable: false }),
  updated_date: field("updatedAt", { kind: "date" }, { writable: false, filterable: false }),
};

const VISIBILITY = ["private", "shared"] as const;
const VIEW_TYPE = ["table", "kanban"] as const;
const PRIORITY = ["low", "medium", "high", "critical"] as const;

export const ENTITY_FIELDS: Record<UserOwnedModel, Fields> = {
  Board: {
    ...AUTO_FIELDS,
    title: field("title", { kind: "string" }, { required: true }),
    description: field("description", { kind: "string" }, { nullable: true }),
    color: field("color", { kind: "string" }),
    visibility: field("visibility", { kind: "enum", values: VISIBILITY }),
    view_type: field("viewType", { kind: "enum", values: VIEW_TYPE }),
    // Denormalized exactly as in Base44 — see the Board model in prisma/schema.prisma.
    columns: field("columns", { kind: "json" }),
    groups: field("groups", { kind: "json" }),
  },
  Item: {
    ...AUTO_FIELDS,
    title: field("title", { kind: "string" }, { required: true }),
    description: field("description", { kind: "string" }, { nullable: true }),
    order_index: field("orderIndex", { kind: "float" }, { nullable: true }),
    data: field("data", { kind: "json" }),
    priority: field("priority", { kind: "enum", values: PRIORITY }),
    color: field("color", { kind: "string" }, { nullable: true }),
    board_id: field("boardId", { kind: "string" }, { required: true }),
    group_id: field("groupId", { kind: "string" }, { nullable: true }),
  },
  Widget: {
    ...AUTO_FIELDS,
    app_id: field("appId", { kind: "string" }, { required: true }),
    app_name: field("appName", { kind: "string" }, { required: true }),
    app_slug: field("appSlug", { kind: "string" }, { nullable: true }),
    preview_url: field("previewUrl", { kind: "string" }, { nullable: true }),
    preview_screenshot_url: field("previewScreenshotUrl", { kind: "string" }, { nullable: true }),
    order_index: field("orderIndex", { kind: "float" }),
    height: field("height", { kind: "int" }),
    col_span: field("colSpan", { kind: "int" }),
  },
  AppOwnership: {
    ...AUTO_FIELDS,
    app_id: field("appId", { kind: "string" }, { required: true }),
    app_name: field("appName", { kind: "string" }, { nullable: true }),
  },
};

/**
 * URL segment → model. Base44's REST used the model name verbatim (`/entities/Board`);
 * lowercase is accepted too so callers need not care about casing.
 *
 * The allowlist is exactly `USER_OWNED_MODELS`: `Base44Link` is secret-bearing and
 * must not be reachable here (gotcha 3), and `User` is served by /api/me.
 */
const BY_SEGMENT = new Map<string, UserOwnedModel>(
  USER_OWNED_MODELS.flatMap((m) => [[m, m] as const, [m.toLowerCase(), m] as const]),
);

export function resolveEntity(segment: string): UserOwnedModel | null {
  return BY_SEGMENT.get(segment) ?? null;
}

// --- outbound: Prisma row → wire record ---------------------------------------

type Row = Record<string, unknown>;

export function toWire(model: UserOwnedModel, row: Row): Row {
  const out: Row = {};
  for (const [wire, spec] of Object.entries(ENTITY_FIELDS[model])) {
    const value = row[spec.prisma];
    if (value === undefined) continue;
    out[wire] = spec.type.kind === "date" && value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

// --- inbound: wire value → Prisma value ---------------------------------------

function coerce(wire: string, spec: FieldSpec, value: unknown): unknown {
  if (value === null) {
    if (!spec.nullable) throw new ValidationError(`${wire} cannot be null`);
    return null;
  }

  switch (spec.type.kind) {
    case "string":
      if (typeof value !== "string") throw new ValidationError(`${wire} must be a string`);
      return value;
    case "enum":
      if (typeof value !== "string" || !spec.type.values.includes(value)) {
        throw new ValidationError(`${wire} must be one of ${spec.type.values.join(", ")}`);
      }
      return value;
    case "int":
    case "float": {
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) {
        throw new ValidationError(`${wire} must be a number`);
      }
      if (spec.type.kind === "int" && !Number.isInteger(n)) {
        throw new ValidationError(`${wire} must be an integer`);
      }
      return n;
    }
    case "bool":
      if (typeof value !== "boolean") throw new ValidationError(`${wire} must be a boolean`);
      return value;
    case "stringArray":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        throw new ValidationError(`${wire} must be an array of strings`);
      }
      return value;
    case "json":
      // Any JSON is legal here (Board.columns/groups, Item.data are open-ended by
      // design) but a bare scalar is not — the readers all expect object/array.
      if (typeof value !== "object")
        throw new ValidationError(`${wire} must be an object or array`);
      return value;
    case "date":
      throw new ValidationError(`${wire} is read-only`);
  }
}

/**
 * Validate a create/update body into Prisma `data`. Unknown and read-only keys are
 * rejected rather than dropped — silently ignoring `created_by` would hide a caller
 * bug that matters (gotcha 6).
 */
export function parseBody(model: UserOwnedModel, body: unknown, mode: "create" | "update"): Row {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("body must be a JSON object");
  }

  const fields = ENTITY_FIELDS[model];
  const data: Row = {};

  for (const [key, value] of Object.entries(body as Row)) {
    const spec = fields[key];
    if (!spec) throw new ValidationError(`unknown field ${key} for ${model}`);
    if (!spec.writable) throw new ValidationError(`${key} is read-only`);
    if (value === undefined) continue;
    data[spec.prisma] = coerce(key, spec, value);
  }

  if (mode === "create") {
    for (const [wire, spec] of Object.entries(fields)) {
      if (spec.required && data[spec.prisma] === undefined) {
        throw new ValidationError(`${wire} is required`);
      }
    }
  } else if (Object.keys(data).length === 0) {
    throw new ValidationError("no writable fields in body");
  }

  return data;
}

/**
 * Like `parseBody`, but for the **public** API in /api/sunny, whose documented
 * behaviour is that anything outside its writable list "is dropped silently"
 * (docs/sunny-platform-skill.md). Rejecting
 * unknown keys there would break built apps that send extra fields.
 *
 * `allowed` is that route's own writable list, intersected with this model's
 * writable fields — so it can never widen what the registry permits. Values are
 * still type-checked: a bad type is a clean 400 instead of a Prisma 500.
 *
 * Required fields are NOT enforced here; /api/sunny emits its own error strings
 * for those, and they have to match the documented wording exactly.
 */
export function parsePicked(model: UserOwnedModel, body: unknown, allowed: readonly string[]): Row {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("body must be a JSON object");
  }

  const fields = ENTITY_FIELDS[model];
  const data: Row = {};

  for (const wire of allowed) {
    const spec = fields[wire];
    if (!spec?.writable) continue;
    const value = (body as Row)[wire];
    if (value === undefined) continue;
    data[spec.prisma] = coerce(wire, spec, value);
  }

  return data;
}

/**
 * `q` → Prisma `where`. Equality only, on declared scalar fields: that is the whole
 * of what the shell uses (`{ id }`, `{ board_id }`) and it keeps the predicate
 * flat, so a caller cannot smuggle in an operator object or a relation traversal.
 * The RLS predicate is spread *after* this result and therefore always wins.
 */
export function parseFilter(model: UserOwnedModel, q: string | null): Row {
  if (!q) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(q);
  } catch {
    throw new ValidationError("q must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError("q must be a JSON object");
  }

  const fields = ENTITY_FIELDS[model];
  const where: Row = {};

  for (const [key, value] of Object.entries(parsed as Row)) {
    const spec = fields[key];
    if (!spec) throw new ValidationError(`unknown filter field ${key} for ${model}`);
    if (!spec.filterable) throw new ValidationError(`${key} is not filterable`);
    if (value !== null && typeof value === "object") {
      throw new ValidationError(`${key} filter must be a scalar (equality only)`);
    }
    where[spec.prisma] = value === null ? null : coerce(key, { ...spec, nullable: true }, value);
  }

  return where;
}

export const DEFAULT_LIMIT = 1000;
export const MAX_LIMIT = 5000;

/** `"-updated_date"` → `{ updatedAt: "desc" }`, matching the Base44 `sort_by` param. */
export function parseSort(model: UserOwnedModel, sortBy: string | null): Row | undefined {
  if (!sortBy) return undefined;

  const desc = sortBy.startsWith("-");
  const key = desc ? sortBy.slice(1) : sortBy;
  const spec = ENTITY_FIELDS[model][key];
  if (!spec) throw new ValidationError(`unknown sort field ${key} for ${model}`);
  if (!spec.sortable) throw new ValidationError(`${key} is not sortable`);

  return { [spec.prisma]: desc ? "desc" : "asc" };
}

export function parseCount(raw: string | null, fallback: number, cap: number): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0)
    throw new ValidationError("limit/skip must be a non-negative integer");
  return Math.min(n, cap);
}

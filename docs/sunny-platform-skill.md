# The `sunny-platform` skill

The block below is a **worked example** of the second half of step 4 in the
[README](../README.md): the on-demand skill a built app loads before it writes code against your
data. `src/lib/builderInstructions.ts` carries the always-on instructions that route to it; this is
the long document those instructions point at.

To use it, install it as a skill in your Base44 workspace, replacing `<SUNNY_HOST>` with your
deployed host and telling the operator the `X-Sunny-Api-Token` value out of band.

Read it for the shape rather than the contents — what earns its place in a skill for a code-writing
agent is the endpoint, the actions, the field names, the enum values, and the failure modes that are
not guessable from the happy path:

1. Every action with its exact request and response shape.
2. That the token is mandatory.
3. Which unknown-id cases are a `404` `{error}` and which are an empty list
   (`getBoard` / `updateItem` / `deleteItem` vs. `listItems`).
4. That `createItem` with a non-existent `board_id` is a `400` — the foreign key is real, so the API
   cannot create orphan items.
5. That records omit `created_by`, because the endpoint is unscoped.

---

```markdown
---
name: sunny-platform
description: Sunny's data model and HTTP API (boards, groups, items, columns, widgets) for apps embedded in Sunny. Use whenever a request mentions Sunny, the platform, a board, group, item, task, column, status, or widget — or asks to read, write, sync, or display the user's real work data. Read before writing code that touches Sunny data; the API is not discoverable from this app's own entities.
---

# Sunny platform

Work-management platform: **boards** hold **groups** of **items** (tasks) shown in
**columns**. Apps built from Sunny are embedded back as **widgets**.

Sunny's data lives in a different service — not in `base44.entities.*`. This
endpoint is the only way in.

## Endpoint

```
POST https://<SUNNY_HOST>/api/sunny
Content-Type: application/json
X-Sunny-Api-Token: <token>
{ "action": "<action>", ...params }
```

CORS is open and OPTIONS is handled, so browser `fetch` works. POST only (else
`405 "Use POST."`). The token is **required**: a 401 means it is missing or
wrong — ask the user, keep it configurable, never commit it.

Errors are `{error}` with a 4xx/5xx status. Surface them; don't render an empty
state as if the board were empty.

## Actions

| action | params | → |
|---|---|---|
| `listBoards` | `limit` (100, max 500) | `{boards}` newest-updated first |
| `getBoard` | `board_id`* | `{board}` — only reliable source of `columns`/`groups`; 404 if unknown |
| `listItems` | `board_id`, `limit` | `{items}` — by `order_index` when board-scoped, else newest. An unknown `board_id` is an empty list, not an error |
| `createItem` | `board_id`*, `title`*, + writable | `{item}` — 400 if `board_id` does not exist |
| `updateItem` | `item_id`*, `patch` | `{item}` — 404 if unknown |
| `deleteItem` | `item_id`* | `{ok:true}` — 404 if unknown |

\* required; omitting one is a 400. Writable Item fields: `board_id`, `group_id`,
`title`, `description`, `order_index`, `data`, `priority`, `color` — anything else
is dropped silently, though a wrong *type* on a writable field is a 400.
**No board writes**: boards are read-only, so never put board creation on a
happy path.

## Schemas

**Board**: `title`*, `description`, `color` (hex, default `#0073EA`), `visibility`
(`private`|`shared`), `view_type` (`table`|`kanban`|`calendar`), `columns[]`,
`groups[]`, `team_id`.
- `columns[]`: `{id, title, type, width, options}`; `type` ∈ `text`, `status`,
  `date`, `people`, `number`, `budget`, `priority`, `checkbox`, `dropdown`.
  `options` is per-type and open (e.g. status labels).
- `groups[]`: `{id, title, color, collapsed, visible_columns[], custom_columns[]}`.
  A group's effective columns = board `columns` filtered by `visible_columns`, plus
  `custom_columns` (same shape as `columns[]`).

**Item**: `board_id`*, `title`*, `group_id`, `description`, `order_index`,
`priority` (`low`|`medium`|`high`|`critical`), `color`, `data`.

Every record also has `id`, `created_date` and `updated_date` (ISO strings).
Owner emails are never returned.

**`data` is keyed by column id, not name.** `getBoard`, find the column by
title/type, then index `item.data[col.id]`. `item.data.status` is always wrong.

**Widget** (read-only context, added from Sunny's UI): `{app_id, app_name,
app_slug, preview_screenshot_url, order_index, height` (px, default 320)`,
col_span` (1 = half width, 2 = full)`}`.

## Gotchas

- Service-role endpoint, no session: results span **all** users. Never label them
  "my tasks" or filter by assignee.
- Items you create have no human owner, so Sunny's own UI (which scopes by owner)
  hides them from everyone except an admin. They stay readable through this API.
- Prefer real boards over seeding fake ones. Use Sunny's vocabulary in the UI.

## Example

```js
const SUNNY_API = "https://<SUNNY_HOST>/api/sunny";
const SUNNY_TOKEN = "<token>"; // keep configurable, never commit

async function sunny(action, params = {}) {
  const res = await fetch(SUNNY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sunny-Api-Token": SUNNY_TOKEN,
    },
    body: JSON.stringify({ action, ...params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Sunny API ${res.status}`);
  return body;
}

const { boards } = await sunny("listBoards");
const { board } = await sunny("getBoard", { board_id: boards[0].id });
const status = board.columns?.find((c) => c.type === "status");
const { items } = await sunny("listItems", { board_id: board.id });
const rows = items.map((i) => ({ title: i.title, status: i.data?.[status?.id] }));

await sunny("createItem", {
  board_id: board.id,
  group_id: board.groups?.[0]?.id,
  title: "Follow up with design",
  priority: "high",
});
```
```

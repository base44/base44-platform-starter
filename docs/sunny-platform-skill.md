# The `sunny-platform` skill

The block below is a **worked example** of the second half of step 4 in the
[README](../README.md): the on-demand skill a built app loads before it writes code against your
data. `src/lib/builderInstructions.ts` carries the always-on instructions that route to it; this is
the long document those instructions point at.

To use it, install it as a skill in your Base44 workspace, replacing `<SUNNY_HOST>` with your
deployed host. There is no secret to hand over — the app asks the page embedding it for a token.

Read it for the shape rather than the contents — what earns its place in a skill for a code-writing
agent is the endpoint, the actions, the field names, the enum values, and the failure modes that are
not guessable from the happy path:

1. Every action with its exact request and response shape.
2. That the token is mandatory.
3. Which unknown-id cases are a `404` `{error}` and which are an empty list
   (`getBoard` / `updateItem` / `deleteItem` vs. `listItems`).
4. That `createItem` with a non-existent `board_id` is a `400` — the foreign key is real, so the API
   cannot create orphan items.
5. That records omit `created_by`.
6. How the app gets a token for the person using it — without that handshake it sees every
   user's rows, which is wrong for any app that says "my".

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
Authorization: Bearer <viewer token>
{ "action": "<action>", ...params }
```

CORS is open and OPTIONS is handled, so browser `fetch` works. POST only (else
`405 "Use POST."`).

## Get a viewer token first

This app runs on its own origin, so its requests carry no Sunny session — Sunny
cannot tell who is looking at it. Ask the page embedding you, which can:

```js
function getSunnyToken({ timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    function done(fn, arg) {
      window.removeEventListener("message", onMessage);
      clearInterval(retry);
      clearTimeout(giveUp);
      fn(arg);
    }
    function onMessage(e) {
      if (e.source !== window.parent) return;
      const data = e.data || {};
      if (data.type === "sunny:auth:token") done(resolve, data.token);
      if (data.type === "sunny:auth:denied") {
        done(reject, new Error("Sunny denied access — is this app installed?"));
      }
    }
    const ask = () => window.parent.postMessage({ type: "sunny:auth:request" }, "*");

    window.addEventListener("message", onMessage);
    ask();
    // Ask again in case we loaded before the page was listening, and never hang:
    // a promise that neither resolves nor rejects is a blank widget with no error.
    const retry = setInterval(ask, 500);
    const giveUp = setTimeout(
      () => done(reject, new Error("Sunny did not respond — is this app embedded in Sunny?")),
      timeout,
    );
  });
}
```

Send it as `Authorization: Bearer <token>`. Then every call answers for **that
person** — the one who installed you, not whoever built you.

The token lasts ten minutes. On a `401`, call `getSunnyToken()` again and retry;
don't cache it beyond the session.

**Without a token there is no answer at all** — every call is a `401`. If the
handshake fails, say so; do not fall back to rendering an empty board as if the
person had no work.

Errors are `{error}` with a 4xx/5xx status. Surface them; don't render an empty
state as if the board were empty.

## Fit the widget to your content

Sunny embeds you cross-origin and cannot measure you, so a widget card is a fixed
box until you say otherwise — which is how a three-row list ends up sitting above
180px of white. Report your height and the card follows it:

```js
const reportSize = () => {
  const height = document.documentElement.scrollHeight;
  window.parent.postMessage({ type: "sunny:size", height }, "*");
};

reportSize();
new ResizeObserver(reportSize).observe(document.body);
```

Advisory and clamped by Sunny to 160–800px, and ignored for a widget the user has
resized by hand. Report on mount and whenever content changes — after data loads,
not only on first paint, or the card is sized to your empty state.

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

- Every action answers for the person looking, so "my tasks" is honest — and a `401`
  means the handshake failed, not that they have no tasks.
- The token is per-viewer, not per-app: the same app shows B their rows and A theirs.
  Don't cache one token across users, and don't store it anywhere shared.
- Items you create belong to that person and appear in Sunny's own UI like any other.
- Prefer real boards over seeding fake ones. Use Sunny's vocabulary in the UI.

## Example

```js
const SUNNY_API = "https://<SUNNY_HOST>/api/sunny";
let token = null;

async function sunny(action, params = {}, retry = true) {
  token ||= await getSunnyToken();
  const res = await fetch(SUNNY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...params }),
  });
  // Ten-minute token: one silent re-ask, then give up.
  if (res.status === 401 && retry) {
    token = null;
    return sunny(action, params, false);
  }
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

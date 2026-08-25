# Teaching built apps about your platform

Step 4 of the [README](../README.md) walkthrough: how an app your user just built learns that your
product exists, and how it reads and writes your data.

Reference implementation: `src/lib/builderInstructions.ts` (always-on instructions),
`docs/sunny-platform-skill.md` (the on-demand skill), `src/app/api/sunny/route.ts` (the callback
API).

---

## The situation

A freshly built Base44 app is a normal Base44 app. It has its own entities, its own origin, and no
idea your platform exists. If your user asks it for "a chart of my overdue tasks", it will happily
invent an empty local entity and render nothing.

So you have to supply two things: **instructions** (how this app should behave, and where the real
data lives) and **an API** (the data itself).

---

## Two instruction channels, and why they're separate

Every builder turn pays for the always-on instructions, so they have to stay small. Base44 gives you
a second channel that's loaded on demand.

| | `custom_instructions` | Skill |
| --- | --- | --- |
| Where | The app's `custom_instructions` field, set at create | A workspace skill document the builder loads by name |
| Cost | Every turn | Only when loaded |
| Length | Keep it a page | As long as it needs to be |
| Content | Runtime constraints, visual direction, **a router** | The endpoint, actions, schemas, gotchas, an example |

### The always-on part

`src/lib/builderInstructions.ts` covers three things:

1. **Context** — what your product is, and that this app was generated from inside it to extend it.
2. **Runtime constraints** — the ones the builder can't discover. In this repo: embedded in a
   sandboxed iframe (`allow-scripts allow-same-origin allow-forms allow-popups`), user-resizable and
   short by default, so design for a small viewport that scales up; no top-level navigation, no
   downloads, no full-screen; `public_without_login`, so no auth flow and no per-user gating; plus a
   line of visual direction so widgets look like they belong.
3. **A route to the skill** — with explicit trigger words, and an instruction for when it can't be
   loaded:

> Read it before writing code whenever the request mentions … board(s), item(s), task(s), status,
> due date, widget(s), dashboard — or asks to read, write, sync, import, export, summarize or chart
> the user's real work data. Indicative, not exhaustive: if it plausibly touches their boards, load
> it.
>
> Cannot load it? Say so and ask. Guessing the API yields an app that silently shows nothing.

That last line matters more than it looks. The failure mode you're designing against is a *silent*
one — an app that renders an empty state instead of an error.

### The on-demand part

The skill is where the real content goes: endpoint, auth header, every action with its parameters
and response shape, the data model, the gotchas, and a copy-pasteable example. This repo's text is
in [sunny-platform-skill.md](sunny-platform-skill.md).

Keep the skill's `name` in the frontmatter and the name your instructions reference in sync — the
router is a literal string match.

---

## The callback API

The built app runs on its own Base44 origin, in a user's browser, with **no session in your
product**. That fact drives every design decision:

```
POST https://your-host/api/sunny
Content-Type: application/json
X-Sunny-Api-Token: <shared token>

{ "action": "listBoards", ...params }
```

### It is service-role, and that's a boundary you must respect

There is no session to scope by, so this endpoint deliberately does **not** go through your
row-level-security helper — it returns rows across users. A shared token plus CORS is its entire
security boundary. Three consequences:

1. **Don't reuse your session-based CRUD module.** Every function there requires an actor; wiring an
   actor-less caller into it is how you end up with a half-scoped query. Query the database directly
   in this route, and keep it obviously separate.
2. **Withhold owner identity from responses.** This endpoint is unscoped and third-party apps call
   it — shipping a `created_by` field hands every caller the email address of every user with data.
3. **Leaving the token unset must not leave the endpoint open.** Treat a missing token as a
   misconfiguration, and compare tokens with a timing-safe comparison.

Rows created through this endpoint have no human owner. This repo stamps a sentinel
(`sunny-api@service.local`) rather than allowing a null: it matches no real user, so the ordinary
owner-scoped UI hides those rows exactly as an ownerless row would, and unlike an empty string it's
greppable.

### CORS is not optional

Built apps are on other origins, so without these the whole thing is dead — preflight included:

```ts
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sunny-Api-Token",
  "Access-Control-Max-Age": "86400",
};
```

### Design the contract like a public API

Once apps are built against it, they are deployed code you don't control. So:

- **One POST endpoint, an `action` field, and a small closed set of actions.** Six here:
  `listBoards`, `getBoard`, `listItems`, `createItem`, `updateItem`, `deleteItem`. Boards are
  read-only on purpose — the platform owns its own top-level objects.
- **Whitelist writable fields.** Anything else in the payload is dropped, so a client can't write
  platform-owned columns. A *wrong type* on a writable field, though, is a 400 — silence there just
  hides bugs.
- **Cap the limits** (100 default, 500 max).
- **Errors are `{error}` with a 4xx/5xx status**, and the skill tells apps to surface them rather
  than rendering an empty state.
- **Freeze the shapes.** This repo asserts the contract action by action (`npm run sunny:smoke`)
  precisely because built apps depend on it.

### An example of the client the builder writes

```js
const API = "https://your-host/api/sunny";
const TOKEN = "…"; // keep configurable, never commit

async function api(action, params = {}) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sunny-Api-Token": TOKEN },
    body: JSON.stringify({ action, ...params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `API ${res.status}`);
  return body;
}
```

---

## Surfacing the app back in your product

Building is only half of it — the app has to come home:

- **Preview:** `getPreviewUrl` returns a sandbox URL whose token expires in 300s. Fetch it fresh
  each time and render it in an iframe. This is why `prevent_iframe_embedding: false` is set at
  create.
- **Ownership:** record `app_id → your user` locally when you create the app. Platform apps have no
  per-your-user owner, so this local row is the only thing that makes "my apps" possible. If it
  fails, only admins will see the app — log it loudly.
- **Widgets:** in this repo an app can be pinned to a dashboard as a resizable widget (`height` in
  px, `col_span` 1 or 2). Those dimensions are exactly what the always-on instructions describe, so
  the generated UI fits the frame it will actually live in.

## Rollout note

The instruction text and the skill are read at build time, so changing them affects only apps built
afterwards. Already-built apps keep calling whatever endpoint they were written against — which
means an old endpoint and a new one can coexist indefinitely, and nothing forces a flip. Plan the
cutover as "point new builds at the new host, leave the old one up", not as a migration.

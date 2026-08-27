# Calling Base44's platform REST API from your server

Step 3 of the [README](../README.md) walkthrough: the endpoints that create and build *other* apps,
and the proxy you should put in front of them.

Reference implementation: `src/app/api/base44/platform/route.ts` (server) and
`src/lib/base44Platform.ts` (browser client).

---

## The shape

```
browser                     your server                        Base44
  │  POST /api/base44/platform     │                              │
  │  {action:"createApp", prompt}  │                              │
  ├───────────────────────────────►│ look up this user's token    │
  │                                │ re-mint if near expiry       │
  │                                │ map action → method + path   │
  │                                ├─────────────────────────────►│
  │                                │ Authorization: Bearer …      │
  │                                │ X-Active-Workspace-Id: …     │
  │◄───────────────────────────────┤◄─────────────────────────────┤
```

The browser names an **action**, never a URL. Two headers do all the authorization work:

```ts
Authorization: `Bearer ${accessToken}`   // WHO — this user's service principal
"X-Active-Workspace-Id": workspaceId     // WHERE — your governed workspace
```

The Bearer token says who you are; the workspace header pins a multi-workspace token's reads and
writes to the workspace you govern. Send both on every call.

## Why an allow-list, not a passthrough

Base44 enforces OAuth scopes in its **MCP tool layer, not on this REST surface**. A token minted
with `apps:read apps:write` is not actually constrained by those strings when it talks to
`/api/apps/*`.

So the allow-list in your proxy is the *only* limit on what a compromised frontend can reach. Keep
it tight:

- never add a generic passthrough action;
- never let the caller supply a path, a host, or a workspace id (a request-controlled host on code
  holding user credentials is an SSRF; a request-controlled workspace id defeats tenancy);
- validate every id you interpolate into a path against something like `/^[A-Za-z0-9_-]+$/`.

The implementation is one table:

```ts
type Op = {
  method: string;
  path: (p: Params) => string;
  body?: (p: Params) => unknown;
  headers?: (p: Params) => Record<string, string>;
  timeoutMs?: number;
};

const OPS: Record<string, Op> = { listApps: {…}, createApp: {…}, … };
```

---

## The endpoints

Base URL is your platform host. Every call carries the two headers above.

### `GET /api/apps` — list

```
/api/apps?q={"app_type":{"$nin":["user_agent"]}}
         &sort=-updated_date&limit=20&skip=0
         &filter_mode=all_apps_workspace
         &folder_id={your folder id}
```

Returns a **bare array**, no total count. `folder_id` is what scopes the list to apps your platform
built — the workspace holds others. The folder *is* the boundary, so it comes from your config, not
from the caller.

Platform apps carry no per-your-user owner (they're all in one workspace), so filtering to "this
user's apps" is a local join. This repo keeps an `AppOwnership` row per created app and intersects.

### `POST /api/apps` — create

```jsonc
{
  "name": "Sprint burndown",              // optional
  "user_description": "<the prompt>",
  "organization_id": "<workspace id>",
  "public_settings": "public_without_login",
  "custom_instructions": "<always-on instructions>",  // persisted, applied every turn
  "secrets": {                                        // installed before the first build turn
    "SOME_NAME": { "type": "value", "value": "<value>" }  // APP_SECRETS is empty today
  },
  "initial_message": { "content": "<the prompt>" },   // create-only, starts the first build
  "prevent_iframe_embedding": false                   // required for an embeddable preview
}
```

Three fields do different jobs and all must be set **here**:

- `initial_message` kicks off the first build. It is *scheduled*, not awaited — Base44 spawns a
  background task and this call returns as soon as the app exists — but it is create-only, so
  anything you patch afterwards misses that first turn.
- `custom_instructions` is persisted on the app and re-applied on every later turn.
- `secrets` are written before that turn is scheduled, so the app never builds without its
  credentials. `POST /api/apps/{id}/secrets` exists too, but it races the turn. Resolve the values
  server-side from an allow-list — a caller that can send a *value* can write anything into an app.
  Base44 exposes app secrets only to backend functions, never to the frontend bundle.

The platform silently drops fields it doesn't accept, and a dropped `custom_instructions` is
invisible — the build just ignores it. Read it back off the response and log loudly if it didn't
stick.

### `POST /api/app-folders/{folderId}/items` — file

```json
{ "app_ids": ["…"] }
```

Empty body on success. `/api/apps` has no folder field on create, so a fresh app is briefly unfiled
— and listing reads *from* the folder. File immediately, and treat a failure as loud: an unfiled app
is invisible to its own creator.

### `GET /api/apps/{appId}` — read one

### `GET /api/apps/{appId}/chat/full-conversation?limit=100&skip=0`

The full builder transcript, typically polled every few seconds while a build runs. Every tool
call's arguments and results come back with it — file contents included — so the body grows all
build long. Watch this one: a late-build read is much heavier than an early one, so if you see
timeouts here, raise the limit rather than treating it as an upstream fault.

### `POST /api/apps/{appId}/chat/message` — build turn

```json
{ "content": "add a filter by status" }
```

Blocks on an LLM turn (~30s is normal). The response means the message was accepted, not that the
build finished — poll the app and the conversation after.

### `POST /api/apps/{appId}/chat/submit-tool-call-input` — resume a paused turn

```json
{
  "tool_call_id": "toolu_…",
  "action": "approved",          // or "rejected"
  "extra_user_input": {},
  "message_id": "…"
}
```

When a builder turn pauses on a `requires_user_input` tool call: `rejected` records the call as
stopped and the tool never runs; `approved` runs it with `extra_user_input` injected as its
`user_input` argument.

Send an `X-Request-ID` that is **stable per logical submit** (this repo derives it from the tool call
id). A network-retried POST then dedupes instead of resuming — and charging for — the turn twice.

### `GET /api/apps/{appId}/sandbox/preview-url`

Boots or reuses a dev sandbox. The returned `preview_token` has a **300s TTL** — never cache it.

### `POST /api/apps/{appId}/deploy`

Empty body. Publishes the app.

---

## The push channel

Everything above is the polling mechanism, and it has four costs you feel immediately: writes block
for the length of an LLM turn, progress costs a full transcript read every 2.5 seconds, there is no
completion signal so you infer one from a polling edge, and there is no way to cancel.

Base44's build-session API replaces all four. Set `NEXT_PUBLIC_BASE44_BUILD_SESSIONS=1` to use it
here; the old path stays intact so you can compare them. It needs the `base44-for-platforms` flag
enabled for your workspace — without it every endpoint below answers **404**, deliberately, so an
unenrolled workspace cannot tell the surface exists.

### The shape

```
your server  ──POST /build/grants────────────►  Base44   (your API key; mints a grant)
                                                   │
browser      ──POST /build/tickets───────────────►─┤     (grant in a header → 60s ticket)
browser      ──GET  /build/events?ticket=────────►─┘     (SSE)
your server  ──POST /build/messages──────────►           (202, turn runs detached)
```

Writes stay on your server, because they need your Base44 credential. The **stream goes
browser-direct** — Base44 serves it with wildcard CORS and no credentials, and a serverless function
is the worst place to sit in the middle of a long-lived stream.

The grant never appears in a URL. `EventSource` cannot set headers, so the grant is exchanged — in a
header, where it belongs — for a **single-use ticket** valid for a minute. What lands in an access
log is then a credential that is already spent. A client streaming with `fetch` and a
`ReadableStream` can skip the ticket and send the grant in `Authorization` directly.

### Trigger endpoints (your server)

Everything lives under one path family: `/api/v1/apps/{id}/build/*`.

| Endpoint | Answers | Notes |
| --- | --- | --- |
| `POST .../build/grants` | `201` | `{grant_id, token, expires_in, expires_at, events_url}`. Read-only, single-session, 15 min by default and 1 h at most |
| `DELETE .../build/grants/{grant_id}` | `204` | Revoke before expiry. Idempotent, and says nothing about whether the id was real |
| `POST .../build/messages` | `202` | `{content, file_urls?}` → `{turn_id}` plus `Location`. Accepted, not performed |
| `POST .../build/responses` | `202` | `{kind: "approval", waitpoint_id, approved}` or `{kind: "input"\|"choice", waitpoint_id, value?}` |
| `POST .../build/cancel` | `200` | Stops the running turn |

Send an **`Idempotency-Key`** on both writes. A turn costs credits and a 202 that never arrives
invites a retry, so the key names the turn: a retry claims the same one instead of starting a second.
It is also the `turn_id` you get back, and what `Location` points at.

**Mint a fresh key per send, and never derive one from the message.** The claim is held for ten
minutes, so a key derived from the content makes sending the same text twice — "continue", a re-send
after a cancelled build — a silent no-op: the write still answers `202` and the turn is dropped
inside the detached task, which from the outside is indistinguishable from a slow build. Long keys
are truncated at 255 characters, so two long messages sharing a prefix collide the same way. A
message body is not a legal header value either — a newline or an emoji makes `fetch` throw before
the request leaves. An *answer* is the opposite case: it is keyed by the waitpoint id, because
answering the same waitpoint twice is the retry.

`/responses` is discriminated on the waitpoint kind and validated against the **live** waitpoint, so
a stale id — or the wrong kind — returns a clear conflict rather than being silently coerced.
Omitting `value` declines a question; there is no separate reject field.

`/messages` refuses a second turn while one is running, or while a waitpoint is unanswered — the two
are distinguished, because the remedies differ (wait, versus answer it).

### Read endpoints (browser)

The grant goes in `Authorization: Bearer`. For `EventSource`, exchange it at `POST .../build/tickets`
and pass `?ticket=`.

| Endpoint | Purpose |
| --- | --- |
| `GET .../build/events` | SSE. What you should use |
| `GET .../build/state` | Current state. The documented polling floor |
| `GET .../build/messages` | History, for reconciling after a long outage |
| `GET .../build/turns/{turn_id}` | One turn's outcome, without holding the stream |
| `POST .../build/tickets` | A one-shot 60s ticket for `EventSource` |

History pages by cursor: follow `next_after` rather than counting rows, and an append cannot shift
the pages beneath you. `offset` still works and is deprecated for one release — it counted back from
the newest row, so a message arriving mid-walk shifted every later page by one, which is worst in
this route's own use case. Mixing the two in one walk is a `400`.

### The events

`turn.started`, `turn.finished`, `message.updated`, `state.changed`, `error`, plus `conversation.reset`
and `files.changed`. **Ignore types you do not recognise** — that rule is what lets Base44 add events
without a release on your side. Every frame carries `turn_id`, so a resumed stream stays attributable
to the right turn.

The last two are the ones worth reading the contract twice on, because "ignore what you don't know"
is the wrong reflex for them. They report work done to the app from **outside** the turn you are
watching — `conversation.reset` means a checkpoint restore or a branch sync rewrote the history you
are showing, `files.changed` means files moved with no turn to attribute them to — so both carry no
payload and no `turn_id`, and the only useful response is to re-read. Nothing follows either one, so
a client that drops them keeps a stale view on screen indefinitely. This repo re-reads the
conversation on the first and remounts the preview frame on the second.

Status is `idle | running | waiting | blocked | error`. `waiting` carries a `waiting_on` saying
*why*, and every kind is answerable through `/responses`:

| `waiting_on.kind` | Render |
| --- | --- |
| `approval` | Approve / reject |
| `choice` | A picker over the options the tool offered |
| `input` | A form (secrets, field values) |

Running out of credits is **not** a waitpoint — no answer clears it. It arrives as
`status: "blocked"` with `reason: "quota"`: nothing failed, and the turn resumes when there is
budget.

`message.updated` is a **snapshot per `message_id`**, not a delta: replace what you hold for that id,
never concatenate. Its tool calls carry `arguments` — which is what makes an interrupt renderable —
and never `results`. Both the stream and the history route return the same projection of the same
message set, including your own user messages, so reconciling cannot produce a different transcript
than you streamed.

### Resuming

Every frame's SSE `id` is the journal sequence. Reconnect with `Last-Event-ID` (the browser does this
itself) or `?last_event_id=` (which you need when *you* reconnect deliberately, to refresh an
expiring token) and only the gap is replayed. The replay window is finite and published in
`X-Base44-Stream-Retention-Seconds` rather than left for you to discover. Offline longer than that,
reconcile through `/messages`.

Reconnecting with no resume point replays the whole retained window. That is harmless — snapshots are
last-write-wins — but hold the last seq you saw so a token refresh doesn't re-send a build's history
every fifteen minutes.

---

## Timeouts

The single most common self-inflicted bug: a blanket 30s timeout on calls that wait on an LLM.

| Action | Timeout here | Why |
| --- | --- | --- |
| `sendMessage`, `createApp`, `deployApp`, `submitToolCallInput` | 120s | A build turn measures ~28–30s against a live app; a 30s ceiling aborts working builds intermittently and reports them as upstream faults. Deploy bundles, so a large app can exceed 30s too |
| the `build/*` writes | 30s | They answer before the turn runs, so the CRUD default is the honest one — a slow answer here means the platform is unwell, not that a build is long |
| everything else | 30s | Plain CRUD |

This whole table is a symptom of the blocking mechanism. On the push channel there is nothing to
size: the only long-lived connection is the stream, and the browser holds that one itself.

Keep them well under your function/platform ceiling (300s on Vercel), so a genuinely hung upstream
still fails rather than holding the function open.

## Error handling

| Upstream | Meaning | Response to your client |
| --- | --- | --- |
| `401` | Token died early — usually the workspace grant changed, which Base44 re-validates per request | Re-mint **once**, retry **once**, then `428 reauthorize_required` |
| `403` containing `scoped to MCP` | The minted token's `client_id` has an MCP prefix (`chatgpt_`, `claude_`, `cursor_`, `oauth_`), making it valid only at `/mcp` | `500` — this is a wiring regression, not a user problem |
| other `4xx`/`5xx` | Upstream refusal | Pass the status through with a truncated detail |
| Missing env var (thrown before any call) | Deployment isn't configured | `501 bridge_misconfigured` — **not** 400 and **not** 502. Echoing env var names into a response body is also worth avoiding |

Client-side, three codes should collapse into one UI state ("show the Connect button"):
`not_linked`, `reauthorize_required`, `bridge_misconfigured`. See `isNotLinkedError()` in
`src/lib/base44Platform.ts`.

Path builders read config (folder id, workspace id), so a missing variable surfaces *inside* the
request-building step. Re-throw it rather than letting it masquerade as a 400 — otherwise you'll
hunt a caller bug that doesn't exist.

## The browser client

`src/lib/base44Platform.ts` is a thin wrapper; no credential is ever present in it. Worth copying:
it composes multi-call operations (create → file → record ownership) in one place so callers can't
get the order wrong, and it turns upstream error bodies into a typed error carrying `code` and
`status` so the UI can branch.

```ts
const call = (action, params) =>
  fetch("/api/base44/platform", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  }).then(…);
```

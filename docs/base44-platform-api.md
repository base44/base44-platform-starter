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

- `initial_message` kicks off the first build inside this same call — so this request blocks on an
  LLM turn, and anything you patch afterwards misses that turn.
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

Empty body publishes the app's current build. With a body it publishes a saved version instead:

```json
{ "checkpoint_id": "68a1f0c2b7e4d9a3c5f21e07" }
```

Production then serves that version while the builder's draft is untouched — a rollback for the
people using the app that rewinds nobody's work. `409` while the app is `processing` or when the
version belongs to a branch; `400` with `error.code = checkpoint_source_no_longer_compiles` when
its functions no longer build. The documented response is `{app_id, checkpoint_id,
git_commit_hash, deployed_at}`; a personal access token currently gets the full app instead, so
this repo reads `last_deployed_git_commit_hash` off `getApp` rather than relying on either shape.

---

## Versions

Base44 saves a **checkpoint** at the end of every builder turn (and on imports, remixes and
manual saves — never on publish). The editor's version history is these rows, and the same four
endpoints are what `src/components/apps/VersionHistoryPanel.jsx` is built on. All of them take
the full-access personal token the rest of this page uses; a read-only token and a workspace key
are refused.

### `GET /api/apps/{appId}/app-checkpoints?limit=25&skip=0` — list

Newest first, bare array, no total. Send a `limit`: without one you get every checkpoint the app
has. The fields this repo renders:

| Field | Used for |
| --- | --- |
| `id` | the id to restore or publish |
| `name`, `changes`, `created_date` | the row |
| `git_commit_hash` | `=== app.last_git_commit_hash` → **Current**; `=== app.last_deployed_git_commit_hash` → **Live**. Never label from `last_deployed_at`: it says a version was live once, not that it is live now |
| `preview_status`, `preview_url` | `ready` → the row is selectable and `preview_url` loads in place of the live preview; `pending`/`building` → poll; `failed` → offer a retry |
| `build_error.message` | why a preview build failed |

`preview_url` is a static build Base44 made when the version was saved. It needs no sandbox and
no preview token, and it is on its own host, so the embed sign-in (`/api/embed`) does not apply —
the frame loads signed out and the viewer-token handshake still runs.

### `POST /api/apps/{appId}/app-checkpoints/{checkpointId}/load` — restore

Empty body. Returns the restored app (same shape as `GET /api/apps/{appId}`). Upstream rolls the
code forward to that tree as a new commit, redeploys the backend functions, re-applies the entity
schemas and runtime config, and rewinds the chat — messages after the version are dropped. **It
publishes nothing**, which is the one sentence the confirmation must say.

It does all of that before answering, so it gets `BUILDER_TIMEOUT_MS`, not the CRUD default. The
app's `status.state` is `processing` for the duration (`details: "Restoring checkpoint"`); on a
timeout, poll `getApp` until it leaves `processing` rather than calling restore again. `409` when
a turn is running (`"This app is working. Wait for it to finish, then restore."`), when the version
is from another branch, or when main is protected. `src/lib/appVersions.ts` maps those to the
sentence the panel shows, and disables Restore while the app is `processing` so the user never
meets the first one.

After a restore this repo reloads the two things that show the build: the chat, by re-opening the
app in the builder (which re-reads the conversation), and the live preview, through
`announceAppRebuilt` plus the new commit hash.

### `POST /api/apps/{appId}/app-checkpoints/{checkpointId}/retry-build` — retry a preview

Empty body. Starts a new preview build in the background and returns
`{ status: "building" | "ready" | "skipped", git_commit_hash }` — `ready` means the commit already
had a build. Poll the list until `preview_status` settles.

### Publish a version

`POST /api/apps/{appId}/deploy` with `{ checkpoint_id }`, above. The allow-list exposes it as
`deployApp` with an optional `checkpointId`, held to the same `/^[A-Za-z0-9_-]+$/` shape as a
path id even though it travels in the body.

### Restore vs publish a version vs undo

| The user wants to | Call | Changes |
| --- | --- | --- |
| go back to a version they picked | restore (`load`) | the editor: code, functions, schemas, chat. Production unchanged |
| make the live app an earlier version | deploy with `checkpoint_id` | production only. Editor unchanged |
| take back the last thing the agent did | `POST /chat/message/{id}/undo` | same as restore, to that message's version (not wired here) |

---

## Timeouts

The single most common self-inflicted bug: a blanket 30s timeout on calls that wait on an LLM.

| Action | Timeout here | Why |
| --- | --- | --- |
| `sendMessage`, `createApp`, `deployApp`, `submitToolCallInput` | 120s | A build turn measures ~28–30s against a live app; a 30s ceiling aborts working builds intermittently and reports them as upstream faults. Deploy bundles, so a large app can exceed 30s too |
| everything else | 30s | Plain CRUD |

Keep them well under your function/platform ceiling (300s on Vercel), so a genuinely hung upstream
still fails rather than holding the function open.

## Error handling

| Upstream | Meaning | Response to your client |
| --- | --- | --- |
| `401` | Token died early — usually the workspace grant changed, which Base44 re-validates per request | Re-mint **once**, retry **once**, then `428 reauthorize_required` |
| `403` containing `scoped to MCP` | The minted token's `client_id` has an MCP prefix (`chatgpt_`, `claude_`, `cursor_`, `oauth_`), making it valid only at `/mcp` | `500` — this is a wiring regression, not a user problem |
| other `4xx`/`5xx` | Upstream refusal | Pass the status through with a truncated detail |

## Renaming an app

`renameApp` sends **`PUT /api/apps/{id}`** with `{name}`. Not PATCH — that route 404s.
A one-field PUT merges rather than replacing; verified by diffing an app's fields
either side of the call. Re-check that if anything ever sends more than `name`.

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

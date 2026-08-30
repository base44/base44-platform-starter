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

Empty body. Publishes the app.

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

## `renameApp` is unverified upstream

`createApp` sets an app's name once, from the first prompt. Iterating in the chat
changes the app's code and never its record, so an app keeps whatever it was called
before anyone knew what it did.

`renameApp` sends `PATCH /api/apps/{id}` with a one-field body, `{name}`. **The verb and
shape are a guess.** Base44's public docs do not cover the platform REST API, and the
host this repo points at was suspended when it was written, so it could not be probed.

A one-field PATCH is safe if the upstream merges, which is what PATCH means. If it turns
out to replace, this action is wrong and must be removed rather than patched around —
it would clear every field it does not send. Anyone with a live platform host should
confirm before relying on it: rename a throwaway app, then `getApp` and check nothing
else moved.

The input is validated before anything is sent — non-empty, 60 characters, clean id —
and asserted in `npm run base44:smoke`, which needs no upstream.

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

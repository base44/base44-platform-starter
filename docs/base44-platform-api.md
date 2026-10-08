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
  ├───────────────────────────────►│ does this user own the app?  │
  │                                │ map action → method + path   │
  │                                ├─────────────────────────────►│
  │                                │ Authorization: Bearer …      │
  │                                │ X-Active-Workspace-Id: …     │
  │◄───────────────────────────────┤◄─────────────────────────────┤
```

The browser names an **action**, never a URL. Two headers do all the authorization work:

```ts
Authorization: `Bearer ${accessToken()}`  // WHO — the one integration account, always
"X-Active-Workspace-Id": workspaceId      // WHERE — your governed workspace
```

The Bearer token is the integration account's personal access token — the same one for every user
of your platform; the workspace header is what Base44 checks permissions against, so send both on
every call. Because the token is the same for everyone, *who may touch which app* is a question
your proxy answers before it calls upstream — see [base44-identity.md](base44-identity.md).

## Why an allow-list, not a passthrough

The access token can do anything the integration account can, to every app it owns, and Base44
enforces no scopes on this REST surface.

So the allow-list in your proxy — together with the ownership check in front of every app-scoped
action — is the *only* limit on what a compromised frontend can reach. Keep it tight:

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
         &sort=-updated_date&limit=500&skip=0
         &filter_mode=all_apps_workspace
```

Returns a **bare array**, no total count. `filter_mode=all_apps_workspace` lists every app in the
workspace, not only the token's own — apps built under earlier identities still belong to your
users. The workspace is the boundary, so give your platform one of its own.

Platform apps carry no per-your-user owner (they all belong to the integration account), so
filtering to "this user's apps" is a local join. This repo keeps an `AppOwnership` row per created
app and intersects server-side. It asks for a large page, so at its scale the whole workspace is one
snapshot, and keeps reading pages while they come back full — filtering a single page would hide a
user's older apps behind other users' newer ones. Base44 documents no maximum `limit`, so a page it
refuses as a bad request is retried once at 50, the size known to work.

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
| `401` | Base44 refused the integration account's token — revoked or expired | `501 bridge_misconfigured`, logged loudly. A deployment problem, the same UI state as a missing variable |
| `403` | The account's role: a non-Editor cannot deploy, or the workspace isn't enabled for something | Pass the status through with the detail |
| other `4xx`/`5xx` | Upstream refusal | Pass the status through with a truncated detail |

## Renaming an app

`renameApp` sends **`PUT /api/apps/{id}`** with `{name}`. Not PATCH — that route 404s.
A one-field PUT merges rather than replacing; verified by diffing an app's fields
either side of the call. Re-check that if anything ever sends more than `name`.

| Missing env var (thrown before any call) | Deployment isn't configured | `501 bridge_misconfigured` — **not** 400 and **not** 502. Echoing env var names into a response body is also worth avoiding |

Client-side, `bridge_misconfigured` is one UI state ("the builder is not available here") — see
`isBuilderUnavailable()` in `src/lib/base44Platform.ts` — and `not_found` on an app-scoped action
means the caller does not own the app they named.

Path builders read config (the workspace id), so a missing variable surfaces *inside* the
request-building step. Re-throw it rather than letting it masquerade as a 400 — otherwise you'll
hunt a caller bug that doesn't exist.

## The browser client

`src/lib/base44Platform.ts` is a thin wrapper; no credential is ever present in it. Worth copying:
it composes multi-call operations (create → file) in one place so callers can't get the order
wrong — ownership is recorded by the server inside the create, never from the browser — and it turns upstream error bodies into a typed error carrying `code` and
`status` so the UI can branch.

```ts
const call = (action, params) =>
  fetch("/api/base44/platform", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  }).then(…);
```

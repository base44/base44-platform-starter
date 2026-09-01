# Build your own platform on Base44

**Base44** is an AI app builder: describe an app, get a real, deployed app. This repo shows how to
put that builder *inside your own product*, so your users build apps under your brand, your login
and your governance — and those apps can read and write your product's data.

This README is a walkthrough. It has four steps, each one a boundary you have to get right, with
the working code in this repo next to it. Everything here is generic; **Sunny**, the
work-management app you'll see in the code, is just the example product being extended.

Live example: <https://sunny44.com>

---

## The shape of the thing

```
   YOUR PRODUCT (this repo)                      BASE44
   ─────────────────────────                     ──────
   your users, your DB, your login
            │
            │  1. user clicks "Connect"
            ├──────────────────────────────────► provision a service principal
            │                                    (a robot identity, one per user)
            │                                    mint a ~1h access token for it
            │  ◄──────────────────────────────
            │  token stored server-side only
            │
            │  2. user describes an app
            ├──────────────────────────────────► createApp → build → deploy
            │     (server-side allow-list)        the app is owned by *that user's*
            │                                     principal, inside your workspace
            │
            │  3. the built app runs
            │  ◄────────────────────────────────  it calls back into your data API
            │      POST /api/sunny                with a shared token, over CORS
```

Four boundaries, four steps:

| Step | Boundary | Code |
| --- | --- | --- |
| [1](#step-1--your-product-owns-its-users-and-data) | Your own auth and database. Your shell is **not** a Base44 app. | `src/lib/auth.ts`, `prisma/schema.prisma`, `src/lib/rls.ts` |
| [2](#step-2--give-each-user-their-own-base44-identity) | One Base44 identity per user, so their apps are theirs. | `src/lib/base44Link.ts`, `src/app/api/base44/link/route.ts` |
| [3](#step-3--call-base44-from-your-server-behind-an-allow-list) | A server-side proxy in front of Base44's REST API. | `src/app/api/base44/platform/route.ts` |
| [4](#step-4--let-the-built-apps-talk-to-your-data) | A public API the built apps call, plus instructions teaching them how. | `src/app/api/sunny/route.ts`, `src/lib/builderInstructions.ts` |

---

## Before you start

You need, from Base44:

| What | Why |
| --- | --- |
| An **enterprise workspace** with the platform capability enabled | All your users' apps live in it, so you have one place to govern and offboard |
| Its **workspace id** | Sent as `X-Active-Workspace-Id` on every platform call |
| A **workspace API key** (`b44k_…`) with the `user_tokens:mint` scope | Vends per-user access tokens |
| Optionally a **second key** with `service_users:provision` | Creates the per-user identities. Splitting the two is the safer setup — see [step 2](#step-2--give-each-user-their-own-base44-identity) |
| The **platform host** your workspace is served from | Base of every REST call |
| An **app folder id** | The one folder your platform files its apps into, so listing apps means listing that folder |

Those land in env as `BASE44_ORG_ID`, `BASE44_SVC_KEY`, `BASE44_PROVISION_KEY`,
`BASE44_PLATFORM_HOST`, `BASE44_APPS_FOLDER_ID` (see `.env.example`). All server-only — none of
them may ever reach the browser.

---

## Step 1 — Your product owns its users and data

The first decision is the one people get wrong: **your platform shell is not a Base44 app.** It has
its own login, its own database, and it never uses `@base44/sdk` for its own data. Base44 is a
service you call, not the substrate you live in.

In this repo that means NextAuth (Google) for sessions and Postgres + Prisma for data:

```ts
// src/lib/auth.ts — the session, turned into an actor
const actor = await requireSessionUser();   // { email, role } — 401s if not signed in
```

Because the shell owns its data, it also owns row-level security. Every user-owned query goes
through one helper, and one module is allowed to run those queries:

```ts
// src/lib/rls.ts
export const scopedWhere = (actor) => ({ createdBy: actor.email });
```

No role widens that predicate — an `admin` is an ordinary reader of their own rows, so nobody's
dashboard fills up with someone else's boards, apps or widgets.

Sharing, when you want it, is a property of the **row**, never of the caller. A board carries a
`visibility` flag, so reads use a second predicate built from the first:

```ts
// src/lib/rls.ts — reads only
export const readWhere = (actor, model) =>
  model === "Board" ? { OR: [scopedWhere(actor), { visibility: "shared" }] } : scopedWhere(actor);
```

Writes stay on `scopedWhere()`. A shared board is readable by the workspace and writable by its
owner alone, which is why the two helpers exist instead of one: widening the owner predicate itself
would have made every shared board editable by everyone who could see it.

That's the whole trick, and it's the single biggest correctness risk in a design like this — a
missing predicate is a data leak. This repo pins it down with an ESLint rule that bans by-id
`update`/`delete` (those can't carry an owner predicate) and a smoke test (`npm run rls:smoke`).

**Takeaway:** decide up front that Base44 is downstream of your auth, not the other way around.

---

## Step 2 — Give each user their own Base44 identity

Now the interesting part. When your user builds an app, **who owns it?**

The lazy answer is "one API key for the whole deployment" — every app your platform ever builds
belongs to one account. You can't show a user only their apps, can't offboard anyone, and one leaked
key is everything.

The right answer is one Base44 identity per user. Base44 gives you a **service principal**: a
workspace-owned robot account that can never log in. No password, no SSO identity, and a synthetic
non-routable address (`…@{workspace}.svc.base44.invalid`). You address it by an **opaque id you
choose**, and Base44 derives everything else from that.

### 2a. Provision the principal

```ts
// POST {host}/api/service/users     Authorization: <b44k_ key>   ← bare, no "Bearer"
{
  "service_external_id": "sunny-9f2c…",   // your opaque handle for this user
  "display_name": "Sunny user 9f2c…"
}
// → { service_external_id, user_id, email: "…@….svc.base44.invalid", role: "editor", created }
```

Idempotent: calling it for an existing principal returns `created: false`, so "Connect" is safe to
press twice.

Two rules worth copying:

- **Derive the id, don't store it.** `src/lib/base44Link.ts` computes it as
  `sha256(workspaceId + ":" + userEmail)`. If it were random and stored only on a link row, then
  disconnect → reconnect would create a *second* principal and strand the first one's apps.
- **Never use the user's real email as the id.** Base44 builds the principal's address from it, and
  the whole safety property is that this identity can't be logged into or mailed. Verify the address
  you get back is in the reserved `.invalid` domain before you mint against it.

### 2b. Mint a token that acts as it

```ts
// POST {host}/api/service/user-tokens     Authorization: <b44k_ key>
{ "service_external_id": "sunny-9f2c…" }
// → { access_token, refresh_token, expires_in }   ~1 hour
```

No OAuth redirect, no consent screen, no PKCE — you already own both sides. The workspace comes
from the *key*, never from the request; that's your cross-tenant guarantee.

**Mint never auto-provisions.** An unknown principal is a 404, and that's the feature: it's what
makes removing someone actually stick. Which is also why the two scopes are worth splitting —
if the hot-path key can provision, a removed user just presses "Connect" and walks back in.

### 2c. Store it, refresh it, and never return it

```ts
// src/lib/base44Link.ts is the ONLY module that reads or writes tokens,
// and no function in it returns one to a caller:
export function linkStatus(link) {
  return { linked: …, base44_user_email: …, organization_id: … };  // booleans and display fields
}
```

Tokens live ~1h, so re-minting is routine. This repo re-mints proactively 5 minutes before expiry
and once more on a mid-call 401, then gives up and asks the user to reconnect. Note the distinction
that matters: a **429 or 5xx is a blip** (leave the row alone and retry), a **4xx is a dead grant**
(downgrade to `pending` and show the Connect button). Conflating them turns a busy minute into a
fleet-wide forced reconnect.

→ Full detail, lifecycle and every error code: **[docs/base44-identity.md](docs/base44-identity.md)**

---

## Step 3 — Call Base44 from your server, behind an allow-list

Your frontend must never hold a Base44 credential. So it calls *you*, and you call Base44:

```
browser → POST /api/base44/platform {action, …params} → your server → Base44 REST
```

`src/app/api/base44/platform/route.ts` is that proxy. Its design is a single table of allowed
actions — the caller names an action, never a URL:

```ts
const OPS = {
  listApps:   { method: "GET",  path: (p) => `/api/apps?…folder_id=${appsFolderId()}` },
  createApp:  { method: "POST", path: () => "/api/apps", body: (p) => ({ … }) },
  sendMessage:{ method: "POST", path: (p) => `/api/apps/${p.appId}/chat/message`, … },
  …
};
```

Nine actions, and that's the whole surface. Why an allow-list and not a passthrough: Base44 enforces
OAuth scopes in its MCP tool layer, *not* on this REST surface, so `apps:read apps:write` does not
constrain what a token can do here. **Your allow-list is the actual limit.** Never let a caller
supply a path, a host, or a workspace id.

Three things every request carries:

```ts
headers: {
  Authorization: `Bearer ${accessToken}`,      // who: this user's principal
  "X-Active-Workspace-Id": orgId(),            // where: your governed workspace
  "Content-Type": "application/json",
}
```

And two things people get bitten by:

- **Timeouts.** `createApp`, `sendMessage` and `deployApp` block on an LLM build turn — ~30s is
  normal. A 30s default timeout aborts working builds and blames the upstream. This repo uses 120s
  for those actions and 30s for everything else.
- **Validate ids.** Anything interpolated into a path is checked against `/^[A-Za-z0-9_-]+$/`, or a
  caller can escape the allow-listed path shape.

→ Every endpoint, body, response and failure mode: **[docs/base44-platform-api.md](docs/base44-platform-api.md)**

---

## Step 4 — Build an app, and let it talk to your data

### 4a. Building

Creating an app is three calls in a fixed order (`src/lib/base44Platform.ts`):

```ts
const app = await createApp({ prompt, name, customInstructions });  // 1. create + first build turn
await fileAppsInFolder([app.id]);                                    // 2. into your folder
await AppOwnership.create({ app_id: app.id, app_name: app.name });   // 3. record who owns it
```

Why in that order:

1. `custom_instructions` and `initial_message` both go in the **create** body. `initial_message`
   starts the first build inside that same call, so patching instructions afterwards is too late.
2. `/api/apps` has no folder field on create, so a fresh app is briefly unfiled — and your app list
   reads *from the folder*. An unfiled app is invisible.
3. Platform apps have no per-your-user owner (they're all in one workspace), so "which apps are
   mine?" is a join you keep locally.

Then `getPreviewUrl` for an iframe preview (the preview token has a 300s TTL — never cache it) and
`deployApp` to publish.

### 4b. Teaching the app about your data

A built app doesn't know your product exists. Two mechanisms, and the split matters because
**every build turn pays for the instructions**:

- **`custom_instructions`** (`src/lib/builderInstructions.ts`) — short, always loaded. Describes the
  runtime (embedded in a sandboxed iframe, no login, short viewport) and *routes*: "load the
  `sunny-platform` skill before writing code that touches this data."
- **A Base44 skill** (`docs/sunny-platform-skill.md`) — long, loaded on demand. The endpoint,
  actions, schemas and gotchas.

### 4c. The callback API

The built app runs on its own Base44 origin with no session in your product. So your data API is
cross-origin and cookie-less, so the request has to carry its own identity.

```
POST https://your-host/api/sunny
Content-Type: application/json
Authorization: Bearer <viewer token>
{ "action": "listBoards" }
```

It has no actor of its own, so it must not reuse your session-based CRUD module, and must withhold
owner emails from responses. It gets an actor from a **viewer token**: the page embedding the app
mints one for whoever is signed in and posts it to the frame, and the app sends it as a bearer
token. That's what makes an installed app answer with the installer's rows rather than its author's.
Treat the contract as frozen once apps are built against it: they're deployed code you don't
control.

→ Instructions, skills, the callback contract and CORS: **[docs/base44-built-apps.md](docs/base44-built-apps.md)**

---

## Run this repo

```bash
cp .env.example .env     # Postgres, Google OAuth, and the BASE44_* vars
npm install
npm run db:migrate
npm run dev
```

Without the `BASE44_*` variables everything works except the builder: the bridge answers
`501 bridge_misconfigured` and the UI shows its "Connect" state. That's on purpose — you can explore
the product before you have a workspace.

Checks, each one asserting a boundary above:

```bash
npm run typecheck
npm run lint
npm run rls:smoke        # step 1: the owner predicate, including the traps
npm run auth:smoke       # step 1: session → actor
npm run entities:smoke   # step 1: whitelisting, scoping, wire shape
npm run base44:smoke     # steps 2–3: token containment, allow-list, session keying
npm run sunny:smoke     # step 4: the public contract, action by action
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `501 bridge_misconfigured` | A `BASE44_*` env var is missing. It's a deployment problem, not a user one — show the Connect gate, don't send them into a reconnect loop |
| `403` on provision | The workspace isn't enabled for platform app-building yet |
| `409` on provision | Something already sits at the synthetic address. Refuse — don't attach to it |
| `404` on mint | The principal doesn't exist. Provision first; mint never creates one |
| `428 reauthorize_required` | The grant is gone (removed from the workspace, role changed, key lost its scope) |
| `403 "scoped to MCP"` | The minted token's `client_id` has an MCP prefix; it's then valid only at `/mcp`, not REST |
| `sendMessage` times out at ~30s | Your own timeout, not Base44's. Build turns need ~120s |
| A new app doesn't appear in the list | It was created but never filed into the folder |

## Where to read next

- **[docs/base44-identity.md](docs/base44-identity.md)** — service principals, minting, refresh,
  revocation, offboarding
- **[docs/base44-platform-api.md](docs/base44-platform-api.md)** — the REST endpoints, verbatim
- **[docs/base44-built-apps.md](docs/base44-built-apps.md)** — instructions, skills, and the
  callback API
- **[docs/sunny-platform-skill.md](docs/sunny-platform-skill.md)** — the skill text a built app
  reads, as a worked example of documenting your data model for a builder
- [docs/deploy.md](docs/deploy.md) — deploying to Netlify + Neon
- [CLAUDE.md](CLAUDE.md) — the conventions this repo holds itself to, and where each boundary
  is enforced in the code

## Stack

Next.js (App Router) · TypeScript · Tailwind 4 · Postgres + Prisma · NextAuth (Google only) ·
deployed on Netlify with Neon. Platform infrastructure (`src/lib`, `src/app`) is strict TypeScript;
the example product UI (`src/components`, `src/views`) is JSX with relaxed lint — it's the example,
not the lesson.

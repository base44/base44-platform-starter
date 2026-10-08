# Build your own platform on Base44

**Base44** is an AI app builder: describe an app, get a real, deployed app. This repo shows how to
put that builder *inside your own product*, so your users build apps under your brand, your login
and your governance — and those apps can read and write your product's data.

This README is a walkthrough. It has four steps, each one a boundary you have to get right, with
the working code in this repo next to it. Everything here is generic; **Sunny**, the
work-management app you'll see in the code, is just the example product being extended.

This repository contains two references:

- [`examples/white-label-minimal/`](examples/white-label-minimal/): the focused, local shared-account guide companion. Start here to learn the build loop without Sunny's database or sign-in.
- [`src/`](src/): the full Sunny product and the production-oriented integration described below — one Base44 account, with the shell keeping its builders apart.

Live example: <https://sunny44.com>

---

## The shape of the thing

```
   YOUR PRODUCT (this repo)                      BASE44
   ─────────────────────────                     ──────
   your users, your DB, your login
            │
            │  1. one integration account, its access
            │     token in env, server-side only
            │     (no Base44 identity per user at all)
            │
            │  2. user describes an app
            ├──────────────────────────────────► createApp → build → deploy
            │     (server-side allow-list +        the app is owned by *the account*,
            │      "is this app yours?" check)     inside your workspace; *your* DB
            │                                      records which user built it
            │
            │  3. the built app runs
            │  ◄────────────────────────────────  it calls back into your data API
            │      POST /api/sunny                with a shared token, over CORS
```

Five boundaries, five steps — four calling out to Base44, one where it calls back in:

| Step | Boundary | Code |
| --- | --- | --- |
| [1](#step-1--your-product-owns-its-users-and-data) | Your own auth and database. Your shell is **not** a Base44 app. | `src/lib/auth.ts`, `prisma/schema.prisma`, `src/lib/rls.ts` |
| [2](#step-2--one-base44-account-and-you-keep-your-users-apart) | One Base44 account for the whole platform — and you keep your users apart. | `src/lib/base44Config.ts`, `src/lib/appOwnership.ts` |
| [3](#step-3--call-base44-from-your-server-behind-an-allow-list) | A server-side proxy in front of Base44's REST API. | `src/app/api/base44/platform/route.ts` |
| [4](#step-4--let-the-built-apps-talk-to-your-data) | A public API the built apps call, plus instructions teaching them how. | `src/app/api/sunny/route.ts`, `src/lib/builderInstructions.ts` |
| [5](#step-5--let-base44-tell-you-what-happened) | Signed inbound webhooks, so you learn about deletions at all — and act on them. | `src/app/api/base44/webhooks/route.ts`, `src/lib/base44WebhookSignature.ts` |

---

## Before you start

You need, from Base44:

| What | Why |
| --- | --- |
| An **enterprise workspace**, used by this platform alone | All your users' apps live in it, so you have one place to govern, and listing apps means listing it |
| Its **workspace id** | Sent as `X-Active-Workspace-Id` on every platform call |
| An **integration account** with Editor or higher in that workspace, and its **personal access token** created *in* that workspace | The one identity that builds everything — see [step 2](#step-2--one-base44-account-and-you-keep-your-users-apart) |
| Optionally a **workspace API key** (`b44k_…`) | Signs viewers into embedded apps and registers webhooks. Not needed to build |
| The **platform host** your workspace is served from | Base of every REST call |

Those land in env as `BASE44_ACCESS_TOKEN`, `BASE44_ORG_ID`, `BASE44_PLATFORM_HOST` and
optionally `BASE44_SVC_KEY` (see `.env.example`). All server-only —
none of them may ever reach the browser.

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

## Step 2 — One Base44 account, and you keep your users apart

Now the interesting part. When your user builds an app, **who owns it?**

On Base44's side the answer is simple, and it is the model Base44 documents for white-label
integrations: **one Base44 account sits behind your whole integration.** It owns every app your
users build, and its personal access token authenticates every call you make. Your users have no
Base44 identity at all — Base44 sees one builder.

```ts
// src/lib/base44Config.ts — the whole credential story
export const accessToken = () => required("BASE44_ACCESS_TOKEN");   // the account's PAT
export const orgId       = () => required("BASE44_ORG_ID");         // the workspace it builds in
```

Two things about that token: create it **in your enterprise workspace**, not the account's
personal one (or builds miss the design system, skills and plan you set up there), and give the
account **Editor or higher** — viewers and guests can't create apps, and deploy succeeds only for an
Editor.

What that model hands *you* is the part people underestimate. Base44 puts it plainly: **keeping your
builders apart is yours to enforce.** Scoping each builder to their own apps, and hiding other
builders' apps, is entirely up to you. So the real work of step 2 is in your database:

```ts
// src/lib/appOwnership.ts — the only record of who built what
export async function ownsApp(actor, appId)        // the proxy's gate for every app-scoped action
export async function ownedAppIds(actor)           // listApps = the workspace ∩ this
export async function recordOwnership(actor, appId) // written by the proxy, inside createApp
```

Three rules worth copying:

- **Check before every upstream call.** The proxy in step 3 refuses any action that names an app
  the caller didn't build — a 404, before Base44 is ever asked. Upstream the token owns every app,
  so nothing there will stop a user driving someone else's.
- **Write ownership server-side, in the request that creates the app.** Never from the browser. A
  client that could insert the row could claim any app in the workspace, so the generic entity API
  refuses to create or update one.
- **No admin bypass.** Ownership matches on the caller's own email, like installs do. Reading another
  user's rows through an admin session is one thing; handing them the controls of another user's
  app is another.

There's no "Connect" step, no per-user token to refresh, and offboarding a user is deleting their
rows: their apps stay in the account, and what they lose is the rows that let them reach those apps
through you. The workspace API key (`BASE44_SVC_KEY`) is still around, but only for what a workspace
key alone can do — signing a viewer into an embedded app, and registering webhooks.

→ The model in full, the failure classes, and the containment rules:
**[docs/base44-identity.md](docs/base44-identity.md)** · Base44's own description:
[Tenancy and credentials](https://docs.base44.com/developers/white-label/tenancy-and-credentials)

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
  listApps:   { method: "GET",  path: (p) => `/api/apps?…filter_mode=all_apps_workspace` },
  createApp:  { method: "POST", path: () => "/api/apps", body: (p) => ({ … }) },
  sendMessage:{ method: "POST", path: (p) => `/api/apps/${p.appId}/chat/message`, … },
  …
};
```

Nine actions, and that's the whole surface. Why an allow-list and not a passthrough: the access
token can do anything the integration account can, to every app it owns, and Base44 enforces no
scopes on this REST surface. **Your allow-list is the actual limit.** Never let a caller supply a
path, a host, or a workspace id.

Three things every request carries:

```ts
headers: {
  Authorization: `Bearer ${accessToken()}`,    // who: the integration account, always
  "X-Active-Workspace-Id": orgId(),            // where: your governed workspace
  "Content-Type": "application/json",
}
```

And because *who* is the same for every user, the proxy decides *whose* before it sends anything:

```ts
if (!(await ownsEveryApp(actor, action, params))) return notFound(action);  // 404, pre-upstream
```

Two more things people get bitten by:

- **Timeouts.** `createApp`, `sendMessage` and `deployApp` block on an LLM build turn — ~30s is
  normal. A 30s default timeout aborts working builds and blames the upstream. This repo uses 120s
  for those actions and 30s for everything else.
- **Validate ids.** Anything interpolated into a path is checked against `/^[A-Za-z0-9_-]+$/`, or a
  caller can escape the allow-listed path shape.

→ Every endpoint, body, response and failure mode: **[docs/base44-platform-api.md](docs/base44-platform-api.md)**

---

## Step 4 — Build an app, and let it talk to your data

### 4a. Building

Creating an app is one call from the browser (`src/lib/base44Platform.ts`), and one write the
server makes on its own:

```ts
const app = await createApp({ prompt, name, customInstructions });  // create + first build turn
                                                                     // (server records ownership here)
```

`custom_instructions` and `initial_message` both go in the **create** body. `initial_message`
starts the first build inside that same call, so patching instructions afterwards is too late. And
the server writes the `AppOwnership` row in that same request — never the browser, which could
otherwise claim any app.

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
Feed that subject the same predicates the rest of the product uses — the read one for reads, the
owner one for writes — and an app sees exactly what its viewer could already open in your UI, shared
rows included, while still writing only their own.
Treat the contract as frozen once apps are built against it: they're deployed code you don't
control.

→ Instructions, skills, the callback contract and CORS: **[docs/base44-built-apps.md](docs/base44-built-apps.md)**

---

## Step 5 — Let Base44 tell you what happened

Steps 1–4 are all your shell calling out. This is the one direction where Base44 calls in, and the
reason it has to exist is deletion: `listApps` cannot report one — a trashed app just stops
appearing. That fixes the apps list on its own, but a pinned widget renders from its own stored URL
and is in no list, so without the event it frames a missing app indefinitely.

The receiver handles one event, `app.deleted.v1`: it verifies the signature, looks up who built
`app_id` in your ownership table from step 2 — nothing in the payload names your user, since
upstream every app belongs to the one account — and deletes those users' pins for the app. Deleting is idempotent and a restore never brings pins back,
so duplicates and out-of-order deliveries need no extra state.

**The signature is the whole security boundary.** The URL is public, so nothing in a request is
trustworthy until it verifies. Base44 signs Ed25519 (`v1a`) over
`webhook-id + "." + webhook-timestamp + "." + raw body`. Verify the body text as received —
re-serializing it changes the bytes and breaks every signature.

**`app.deleted` is trash, not erasure** — restorable for 30 days. Remove only what would show a
missing app; never purge.

Register once per environment:

```bash
npm run webhook:register -- --url https://your-shell.example.com
```

It prints `BASE44_WEBHOOK_PUBLIC_KEYS` (a public key, not a secret). Registering mints the
workspace's first key, so on a first run the probe can't verify yet — deploy the key, then finish
with `npm run webhook:register -- --activate <endpoint id>`.

```bash
npm run webhook:smoke   # the signature, case by case — no server, no database
```

→ Delivery semantics and the retry ladder: **[docs/base44-webhooks.md](docs/base44-webhooks.md)**

---

## Run this repo

```bash
cp .env.example .env     # Postgres, Google OAuth, and the BASE44_* vars
npm install
npm run db:migrate
npm run dev
```

Without the `BASE44_*` variables everything works except the builder: the bridge answers
`501 bridge_misconfigured` and the UI says the builder is not configured. That's on purpose — you
can explore the product before you have a workspace.

Checks, each one asserting a boundary above:

```bash
npm run typecheck
npm run lint
npm run rls:smoke        # step 1: the owner predicate, including the traps
npm run auth:smoke       # step 1: session → actor
npm run entities:smoke   # step 1: whitelisting, scoping, wire shape
npm run base44:smoke     # steps 2–3: token containment, allow-list, the ownership gate
npm run sunny:smoke     # step 4: the public contract, action by action
npm run webhook:smoke    # step 5: the inbound signature, negative controls
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `501 bridge_misconfigured` | A `BASE44_*` env var is missing, or Base44 answered `401` to the integration account's token (revoked, expired). A deployment problem, not a user one — the UI says the builder is unavailable |
| `404 not_found` on an app-scoped action | The caller has no `AppOwnership` row for that app. Built before ownership was tracked? Insert the row |
| `403` on deploy | The integration account isn't an Editor in the workspace |
| Builds ignore your design system or skills | The token was created in the account's personal workspace. Create it in the enterprise workspace |
| `sendMessage` times out at ~30s | Your own timeout, not Base44's. Build turns need ~120s |
| A new app doesn't appear in the list | Its `AppOwnership` row was not recorded — the server logs this loudly at create |

## Where to read next

- **[docs/base44-identity.md](docs/base44-identity.md)** — the one-account model, the access token,
  and keeping your builders apart
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

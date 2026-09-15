# base44-platform-starter

Reference implementation of a **white-label platform built on Base44**. Base44 is the backend and
app-factory; this repo is the shell a company wraps around it. **Sunny** is the worked example — a
work-management product (boards / groups / items / widgets) whose users can build their own apps via
Base44's builder, embedded here.

Read `README.md` first: it is the walkthrough, organised around the four boundaries this repo exists
to demonstrate.

## What this is / isn't

- **Is:** a Next.js (App Router) shell — its own auth, own DB, own UI — that calls Base44's platform
  API from the *server* to build, preview and deploy user apps.
- **Isn't:** a Base44 app. It does not use `@base44/sdk` for its own data. The apps it *builds* are
  Base44 apps; this shell is not. So app-level Base44 integrations (`InvokeLLM`, `UploadFile`) are
  not available to it — an AI feature over this data belongs in a generated widget, which has
  `InvokeLLM` natively.

## Stack

Next.js App Router · TypeScript · Tailwind 4 · Postgres + Prisma · NextAuth (Google only) · Netlify
+ Neon.

## The five boundaries

| Boundary | Code |
| --- | --- |
| 1. Your own auth and database | `src/lib/auth.ts`, `src/lib/rls.ts`, `prisma/schema.prisma`, `src/lib/entities.ts`, `src/lib/entityCrud.ts` |
| 2. One Base44 identity per user | `src/lib/base44Link.ts`, `src/app/api/base44/link/route.ts` |
| 3. A server-side allow-list in front of Base44's REST API | `src/app/api/base44/platform/route.ts` |
| 4. A public data API the built apps call | `src/app/api/sunny/route.ts`, `src/lib/builderInstructions.ts` |
| 5. Signed inbound webhooks from Base44 | `src/app/api/base44/webhooks/route.ts`, `src/lib/base44WebhookSignature.ts`, `src/lib/base44WebhookEvents.ts`, `src/lib/base44AppMirror.ts` |

## Conventions

- **RLS is hand-enforced.** Every user-owned entity query goes through `src/lib/rls.ts`: writes use
  `scopedWhere(session)` (`where: { createdBy: session.email }`, no role bypass), reads use
  `readWhere(session, model)` — the same predicate, OR-ed with `Board.visibility = "shared"` (and,
  for `Item`, its board's). So a shared board is readable by any signed-in user and writable only by
  its owner; sharing is a property of the row, never of the caller. `src/lib/entityCrud.ts` is the
  *only* module that queries owner-scoped models — never query them raw. This is the single biggest
  correctness risk in the codebase, and ESLint bans by-id `update`/`delete` on those models to keep
  it that way.
- **`src/lib/base44Link.ts` and `src/lib/base44TokenStore.ts` own `Base44Link` persistence.**
  The first handles connection lifecycle; the second implements the SDK token store.
  Tokens stay server-side; browser responses use `linkStatus()` to expose only connection status. The webhook receiver joins an event to a user
  through `emailForServiceExternalId()` there, which returns an email and nothing else.
- **An inbound webhook is untrusted until its signature verifies.** `src/lib/base44WebhookSignature.ts`
  is the boundary: the URL is public, so the event type, the app id and above all
  `owner_service_external_id` — which decides whose rows the projection touches — are all
  attacker-controlled until it returns ok. Verify the **raw** body text, never a re-serialized one.
  Verification material comes from `BASE44_WEBHOOK_PUBLIC_KEYS` when set (pinned, no network call,
  rotation applied by hand) and from the published key set otherwise (fetched, rotation automatic);
  the pinned value is a public key, so it is the one `BASE44_*` variable that is not a secret.
  `app.deleted.v1` is a *trash* signal, restorable for 30 days; never purge on it — and mind that
  the stakes are no longer cosmetic: `src/lib/base44AppMirror.ts` removes the shell's own rows for a
  deleted app, so a forged event would be data loss against a named user.
- **`src/lib/base44AppMirror.ts` is what the shell does about an event**, as opposed to what it
  records. It removes the `Widget` and `AppOwnership` rows for a deleted app and puts the ownership
  row back on a restore, and it raises the notice the browser claims through
  `POST /api/base44/app-notices`. Every removal goes through `entityCrud.ts` with an actor built
  from the event's resolved owner, so the RLS predicate — not the event — decides which rows are
  reachable; that file's read and write paths are untouched. `Base44AppState` is scoped by hand
  (`ownerEmail`), the same documented carve-out `appInstall.ts` and `marketplace.ts` hold.
- **Server-only secrets** (`BASE44_SVC_KEY`, workspace id, platform host) live in env and are never
  shipped to the client, and never caller-supplied — a request-controlled host would be an SSRF and
  a request-controlled workspace id would defeat the tenancy boundary.
- **`/api/sunny` serves externally-hosted Base44 apps**: CORS `*`, no user session, so it cannot
  go through `entityCrud.ts` and it withholds `created_by`. Identity comes from a **viewer token**
  (`src/lib/appTokens.ts`) that the embedding page mints for the current user and posts into the
  frame (`src/lib/appFrameAuth.ts`); its subject is the actor, so an installed app answers for its
  installer, never its author. Reads use `readWhere()` and writes `scopedWhere()`, the same split as
  `entityCrud.ts`, so a built app sees exactly what its viewer can already open in the shell —
  including boards other people marked `shared` — and can still write only rows they own.
  Treat its contract as frozen once apps are built against it — they are deployed code you do not
  control.
- **Two lint regimes.** Platform infrastructure (`src/lib`, `src/app`) is strict `.tsx`/`.ts`. The
  example product UI (`src/components`, `src/views`) is `.jsx` with relaxed lint — it's the example,
  not the lesson.
- This is a getting-started guide: optimize integration code for human readers. Use descriptive
  names, explicit control flow, and one meaningful operation per statement. Keep SDK usage visible;
  separate storage details from the connection flow instead of compressing them together.
- Comments explain what the code *is*, not what it used to be.

## Checks

```bash
npm run typecheck
npm run lint
npm run rls:smoke        # boundary 1: the owner predicate, including the traps
npm run auth:smoke       # boundary 1: session → actor
npm run entities:smoke   # boundary 1: whitelisting, scoping, wire shape
npm run base44:smoke     # boundaries 2–3: token containment, allow-list, session keying
npm run sunny:smoke     # boundary 4: the public contract, action by action
npm run webhook:register # boundary 5: register the endpoint, print the key to pin (deploy-time)
npm run webhook:smoke    # boundary 5: the inbound signature, both key sources, negative controls
npm run webhook:projection:smoke   # boundary 5: removal, notice claim, restore, replayed delete
```

The smoke suites need `npm run dev` running, write throwaway rows to `DATABASE_URL` and clean up
after themselves. Don't point them at a database you care about. Two exceptions: `webhook:smoke`
needs neither (it mints its own keypair and stubs the key-set fetch), and
`webhook:projection:smoke` needs the database but not the server.

## Docs

- `docs/base44-identity.md` — service principals, minting, refresh, revocation, offboarding
- `docs/base44-platform-api.md` — the platform REST endpoints
- `docs/base44-built-apps.md` — builder instructions, skills, and the callback API
- `docs/sunny-platform-skill.md` — the skill text a built app reads, as a worked example
- `docs/base44-webhooks.md` — inbound events: registration, signature, delivery semantics
- `docs/deploy.md` — Netlify + Neon

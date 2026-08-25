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

## The four boundaries

| Boundary | Code |
| --- | --- |
| 1. Your own auth and database | `src/lib/auth.ts`, `src/lib/rls.ts`, `prisma/schema.prisma`, `src/lib/entities.ts`, `src/lib/entityCrud.ts` |
| 2. One Base44 identity per user | `src/lib/base44Link.ts`, `src/app/api/base44/link/route.ts` |
| 3. A server-side allow-list in front of Base44's REST API | `src/app/api/base44/platform/route.ts` |
| 4. A public data API the built apps call | `src/app/api/sunny/route.ts`, `src/lib/builderInstructions.ts` |

## Conventions

- **RLS is hand-enforced.** Every user-owned entity query goes through `scopedWhere(session)` in
  `src/lib/rls.ts` (`where: { createdBy: session.email }`, admin bypass). `src/lib/entityCrud.ts` is
  the *only* module that queries owner-scoped models — never query them raw. This is the single
  biggest correctness risk in the codebase, and ESLint bans by-id `update`/`delete` on those models
  to keep it that way.
- **`src/lib/base44Link.ts` is the only module that touches `Base44Link`**, and it never returns a
  token to a caller. Vended tokens stay server-side.
- **Server-only secrets** (`BASE44_SVC_KEY`, workspace id, platform host) live in env and are never
  shipped to the client, and never caller-supplied — a request-controlled host would be an SSRF and
  a request-controlled workspace id would defeat the tenancy boundary.
- **`/api/sunny` is service-role**, for externally-hosted Base44 apps: `X-Sunny-Api-Token` +
  CORS `*`, no user session. Because it is unscoped it deliberately does *not* go through
  `entityCrud.ts`, and it withholds `created_by`. Treat its contract as frozen once apps are built
  against it — they are deployed code you do not control.
- **Two lint regimes.** Platform infrastructure (`src/lib`, `src/app`) is strict `.tsx`/`.ts`. The
  example product UI (`src/components`, `src/views`) is `.jsx` with relaxed lint — it's the example,
  not the lesson.
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
```

The smoke suites need `npm run dev` running, write throwaway rows to `DATABASE_URL` and clean up
after themselves. Don't point them at a database you care about.

## Docs

- `docs/base44-identity.md` — service principals, minting, refresh, revocation, offboarding
- `docs/base44-platform-api.md` — the platform REST endpoints
- `docs/base44-built-apps.md` — builder instructions, skills, and the callback API
- `docs/sunny-platform-skill.md` — the skill text a built app reads, as a worked example
- `docs/deploy.md` — Netlify + Neon

# Build your own platform on Base44

**Base44** is an AI app builder: describe an app, get a real, deployed app. This repo shows how to
put that inside *your own product*, so your users build apps under your brand, your login and your
governance, and those apps can read and write your product's data.

The integration guide is on the docs site:
[White label overview](https://docs.base44.com/developers/white-label/overview). This repo is the
code that goes with it, in two sizes.

## Tiny Sunny and Sunny

- **[Tiny Sunny](examples/white-label-minimal/)** is the minimal version. A chat where you describe
  an app, watch Base44 build it, answer its questions and see it in a preview. No database and no
  sign-in. Start here to learn the build loop.
- **Sunny** (`src/`) is the full version: a work-management product (boards, groups, items,
  widgets) with its own sign-in and Postgres database, whose users build apps that are embedded back
  into it and read Sunny's data. It shows what production needs on top of the build loop. Live at
  <https://sunny44.com>.

## How Sunny is put together

```
   YOUR PRODUCT (this repo)                      BASE44
   ─────────────────────────                     ──────
   your users, your DB, your login
            │
            │  one workspace API key, running as the
            │  owner, in env, server-side only
            │
            │  user describes an app
            ├──────────────────────────────────► createApp → build → deploy
            │  (server-side allow-list +          the app is owned by the account;
            │   "is this app yours?" check)       your DB records which user built it
            │
            │  the built app runs
            │  ◄────────────────────────────────  it calls back into your data API
            │      POST /api/sunny                with a viewer token, over CORS
            │
            │  ◄────────────────────────────────  signed webhooks (app.deleted.v1)
```

| Boundary | Code | Docs |
| --- | --- | --- |
| Your own auth and database. The shell is **not** a Base44 app, and it owns row-level security. | `src/lib/auth.ts`, `prisma/schema.prisma`, `src/lib/rls.ts` | |
| One Base44 account for the whole platform, and you keep your users apart. | `src/lib/base44Config.ts`, `src/lib/appOwnership.ts` | [Tenancy and credentials](https://docs.base44.com/developers/white-label/tenancy-and-credentials) |
| A server-side proxy with an allow-list of actions in front of Base44's REST API. | `src/app/api/base44/platform/route.ts` | [The build turn](https://docs.base44.com/developers/white-label/the-build-turn), [Common APIs](https://docs.base44.com/developers/white-label/common-apis) |
| Custom instructions and a skill that teach built apps about your data. | `src/lib/builderInstructions.ts`, `src/lib/sunny-platform-skill.md` | [Custom instructions](https://docs.base44.com/developers/white-label/custom-instructions), [Skills and MCP](https://docs.base44.com/developers/white-label/skills-and-mcp) |
| A public API the built apps call, as the person viewing them. | `src/app/api/sunny/route.ts`, `src/lib/embedSession.ts` | [Embed the app](https://docs.base44.com/developers/white-label/embed-the-app) |
| Signed inbound webhooks, so you learn about deleted apps. | `src/app/api/base44/webhooks/route.ts`, `src/lib/base44Webhooks.ts` | [Workspace webhooks](https://docs.base44.com/Enterprise/workspace-webhooks) |

[CLAUDE.md](CLAUDE.md) has the conventions this repo holds itself to and where each boundary is
enforced.

## Run it

You need a Base44 white-label workspace, its id and platform host, and a workspace API key
(`b44k_`) with Full access, created in that workspace. The
[setup checklist](https://docs.base44.com/developers/white-label/setup-checklist) covers it.

```bash
cp .env.example .env     # Postgres, Google OAuth, and the BASE44_* vars
npm install
npm run db:migrate
npm run dev
```

Without the `BASE44_*` variables everything works except building apps: the bridge answers
`501 bridge_misconfigured` and the UI says so. You can explore the product before you have a
workspace.

Checks, each one asserting a boundary above:

```bash
npm run typecheck
npm run lint
npm run rls:smoke        # the owner predicate, including the traps
npm run auth:smoke       # session → actor
npm run entities:smoke   # whitelisting, scoping, wire shape
npm run base44:smoke     # token containment, allow-list, the ownership gate
npm run sunny:smoke      # the public contract, action by action
npm run webhook:smoke    # the inbound signature, negative controls
```

The smoke suites write throwaway rows to `DATABASE_URL`. Don't point them at a database you care
about.

## Deploy

It runs on free plans: **Netlify** for the app and **Neon** for Postgres. `netlify.toml` already
holds the build settings; its build command runs `prisma migrate deploy`, so a deploy moves the
schema forward.

- **Database.** `DATABASE_URL` is Neon's pooled host, `DIRECT_URL` the unpooled one (used by
  migrations). Never point both at the pooled host.
- **Google OAuth.** One client per environment, with origin `https://<your-host>` and redirect URI
  `https://<your-host>/api/auth/callback/google`.
- **Env vars.** As in `.env.example`. Scope `NEXTAUTH_URL` to production only.
- **`/api/sunny` is public** once deployed. It only answers viewer tokens signed with
  `NEXTAUTH_SECRET`, so that secret protects it too.

Deploy previews need a redirect proxy for Google sign-in and their own Neon branch, so they never
migrate production. [PREVIEW-DEPLOYS.md](PREVIEW-DEPLOYS.md) has the setup and what's still open.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `501 bridge_misconfigured` | A `BASE44_*` env var is missing, or Base44 answered `401` to the workspace API key (revoked, expired) |
| `404 not_found` on an app-scoped action | The caller has no `AppOwnership` row for that app. Built before ownership was tracked? Insert the row |
| `403` on a build call | The workspace key lacks Full access, or the workspace isn't entitled to run keys as the owner |
| Builds ignore your design system or skills | The key belongs to another workspace than `BASE44_ORG_ID`. Create it in the white-label workspace |
| `sendMessage` times out at ~30s | Your own timeout, not Base44's. Build turns need ~120s |
| A new app doesn't appear in the list | Its `AppOwnership` row was not recorded. The server logs this at create |

## Stack

Next.js (App Router) · TypeScript · Tailwind 4 · Postgres + Prisma · NextAuth (Google only) ·
deployed on Netlify with Neon. Platform infrastructure (`src/lib`, `src/app`) is strict TypeScript;
the example product UI (`src/components`, `src/views`) is JSX with relaxed lint.

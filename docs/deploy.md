# Deploying

This runs on free plans: **Netlify** for the app + **Neon** for Postgres. Nothing in the stack needs
a paid feature.

Two things to understand before you start:

- **A deployment makes `/api/sunny` reachable from the internet.** It answers only requests
  carrying a viewer token signed with `NEXTAUTH_SECRET` (see
  [base44-built-apps.md](base44-built-apps.md)), so there is no shared secret to leak and no open
  mode to forget to close — but a weak or reused `NEXTAUTH_SECRET` now compromises that API too.
- **Google's OAuth client names one exact host.** Wildcards are not allowed, so a preview
  deployment's URL — a new one per pull request — can never be registered. Previews sign in by
  borrowing production's callback through a redirect proxy. See
  [Preview deployments](#preview-deployments) below.

---

## 1. Create the database

Neon (or any Postgres). `prisma/schema.prisma` declares both `url` and `directUrl`, but **one Neon
connection string is enough** — the two hosts differ only by a `-pooler` segment:

```
direct:  postgresql://user:pw@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
pooled:  postgresql://user:pw@ep-example-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
```

- `DATABASE_URL` — the **pooled** host, used by the app at runtime. Each serverless function opens
  its own pool, so this is what stops connection exhaustion.
- `DIRECT_URL` — the **unpooled** host, used by `prisma migrate`.

Pointing both at the direct host works at small scale. Pointing both at the *pooled* host is the one
combination to avoid: migrations misbehave through a transaction pooler.

## 2. Create the Google OAuth client

A Web application client in the Google Cloud console, with:

- Authorized JavaScript origin: `https://<your-host>`
- Authorized redirect URI: `https://<your-host>/api/auth/callback/google`

Use **two clients, one per environment** — localhost in your local `.env`, the deployed host in the
deploy environment. A single client would need both origins, and rotating one would break the other.

Preview deployments need **no entry of their own**: that is what the redirect proxy is for, and
Google would not accept `https://*--<your-site>.netlify.app` anyway.

While the OAuth consent screen is in **Testing**, only the listed test users can sign in, and they
all see an "unverified app" warning. Publishing it is a separate decision.

## 3. Connect the repo to Netlify

`netlify.toml` is already in the repo and carries everything build-related:

- **Build command** is `npm run build:deploy` — that is `prisma migrate deploy && next build`, so a
  deploy is what moves the schema forward and you never reach the database from your laptop.
  (`npm run build` stays database-free for local use, and `prisma generate` runs from `postinstall`.)
- **Node 24.**
- The Next.js runtime auto-installs on detection; do **not** add it as a plugin.
- `SECRETS_SCAN_OMIT_PATHS` excludes Turbopack's build cache under `.netlify/`, which records
  resolved `process.env` reads and is never served. The omission is scoped to that path rather than
  to key names, so the scanner still catches those keys if they ever reach real output.

`prisma/schema.prisma` sets `binaryTargets = ["native", "rhel-openssl-3.0.x"]`: Netlify builds on
Ubuntu but runs functions on Amazon Linux, and without it the query engine is missing at runtime.

## 4. Set the environment variables

All server-side except the last, which is deliberately public. See `.env.example` for what each
one is.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** URL |
| `DIRECT_URL` | Neon **unpooled** URL |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://<your-host>` — the production domain, exactly. **Scope it to production**: it overrides the origin read off the request, so a preview holding it would sign users into production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the production OAuth client |
| `AUTH_REDIRECT_PROXY_URL` | `https://<your-host>/api/auth` — only needed if you turn previews on; set it on production *and* the preview contexts |
| `BASE44_SVC_KEY` | the `b44k_` workspace key — without it the builder shows its "Connect" state |
| `BASE44_PROVISION_KEY` | optional second key; defaults to `BASE44_SVC_KEY` |
| `BASE44_ORG_ID`, `BASE44_PLATFORM_HOST`, `BASE44_APPS_FOLDER_ID` | from your workspace |
| `NEXT_PUBLIC_BASE44_APP_HOST` | the host Base44 serves built apps from. The one public var — these URLs are built in the browser to be iframed. Unset, the UI shows no app previews |

## 5. Verify

```bash
curl -s https://<your-host>/api/me                              # 401 {"error":"unauthenticated"}
curl -s https://<your-host>/api/entities/Board                  # 401
curl -s -X POST https://<your-host>/api/sunny \
  -H 'content-type: application/json' -d '{"action":"listBoards"}'   # 401 without the token
curl -s https://<your-host>/api/auth/providers                  # callback URL matches the OAuth client
```

Then sign in through the browser. The smoke suites can be pointed at a deployment:

```bash
NEXTAUTH_URL=https://<your-host> npm run sunny:smoke
```

…but they **write throwaway rows and clean up after themselves**, and `sunny:smoke` needs
`NEXTAUTH_SECRET` locally to match the deployment's — it mints its own viewer tokens. Don't run them
against anything you care about.

The deployed database starts empty. Every route works; there is just nothing to list until you sign
in and create a board.

## Preview deployments

A preview gets a fresh URL per pull request (`deploy-preview-42--<site>.netlify.app`), which is
exactly what neither Google nor Prisma is happy about. Both problems have a fix.

### Sign-in: the redirect proxy

Google matches redirect URIs exactly and allows no wildcard, so a preview's callback URL cannot be
registered. Instead **every deployment sends Google production's callback** and encodes its own
origin in the OAuth `state`; production notices a state that belongs elsewhere and forwards the
callback there. Auth.js calls this a redirect proxy, and `src/lib/auth.ts` turns it on whenever
`AUTH_REDIRECT_PROXY_URL` is set.

The flow, for a preview at `https://deploy-preview-42--<site>.netlify.app`:

1. the preview sends the user to Google naming production's callback as the
   `redirect_uri`, with `state` carrying its own callback URL,
2. Google returns the code to **production**, which decodes the state and 302s the whole callback to
   the preview,
3. the preview verifies its own `state` cookie, exchanges the code (again naming production's
   `redirect_uri`, which is what Google issued it for) and sets its own session.

To set it up:

| Netlify env var | Production | Deploy previews / branch deploys |
| --- | --- | --- |
| `AUTH_REDIRECT_PROXY_URL` | `https://<your-host>/api/auth` | same value |
| `NEXTAUTH_SECRET` | your secret | **the same secret** |
| `NEXTAUTH_URL` | `https://<your-host>` | **unset** |
| `GOOGLE_CLIENT_ID` / `_SECRET` | production client | same client |

Three things are load-bearing:

- **The shared `NEXTAUTH_SECRET`.** The state is encrypted with it, so only a deployment holding the
  secret can name a forwarding target, and a preview with a different secret cannot complete the
  handshake at all. It also means a preview can mint viewer tokens for `/api/sunny` that production
  accepts — treat preview deploys as production-equivalent trust.
- **No `NEXTAUTH_URL` on previews.** It overrides the origin NextAuth reads from the request, so a
  preview that inherits production's value believes it *is* production: it stops proxying and signs
  the user into production instead. `trustHost: true` in `src/lib/auth.ts` is what lets a
  deployment resolve its own origin at all; on a preview that origin is then pinned, below.
- **`AUTH_REDIRECT_PROXY_URL` on production too.** The deployment whose own origin matches that
  URL is the one that forwards; without it, production treats a preview's callback as its own.

- **The preview's origin comes from `DEPLOY_PRIME_URL`, not from the request.** Netlify answers the
  deploy *alias* (`deploy-preview-42--<site>.netlify.app`) but hands the server handler the deploy
  *permalink* (`<deploy-id>--<site>.netlify.app`) in `host` / `x-forwarded-host`. Taken from the
  request, a preview would name the permalink as its forwarding target while the browser — and so
  the `state` cookie, which is host-only — sits on the alias. Sign-in then fails with
  `InvalidCheck: state value could not be parsed`, which is also the message for a cookie that is
  simply *absent*: `parseCookie` in `@auth/core` rewrites every cause into that one string. So
  `src/lib/auth.ts` pins `AUTH_URL` to Netlify's own `DEPLOY_PRIME_URL`, which *is* the alias,
  baked into the build by the `env` block in `next.config.ts` because the function's runtime
  environment does not carry Netlify's build variables.

  A consequence worth knowing: a preview signs in on its alias URL only. Open the permalink
  directly and the browser is back on a host the deployment does not claim.

Local dev leaves `AUTH_REDIRECT_PROXY_URL` unset and uses the ordinary direct flow.

### Builds: previews must not migrate

Scope the Postgres vars to production only and a preview cannot build at all — `prisma generate`
fails schema validation in `postinstall`. Giving a preview production's `DATABASE_URL` is worse:
`build:deploy` is `prisma migrate deploy && next build`, so **every pull request would migrate
production**.

So `netlify.toml` overrides the command for the preview contexts to plain `npm run build`, which
never touches the database, and you give the preview scope its own **Neon branch** for
`DATABASE_URL`/`DIRECT_URL`. A pull request that adds a migration therefore deploys against an
un-migrated preview database until you apply it to that branch yourself:

```bash
DATABASE_URL=<preview branch pooled> DIRECT_URL=<preview branch direct> npm run db:deploy
```

That is deliberate. The alternative — letting previews migrate — is a schema change from an
unreviewed branch running automatically, against a database shared by every other open pull
request.

## Known rough edges

- **Neon's free tier suspends on inactivity**, so the first request after a pause pays a cold start
  of a second or two on top of the serverless cold start.
- **No connection-pool tuning.** Prisma opens a pool per function instance; the pooled URL is what
  keeps that from exhausting connections.
- **`/api/sunny` has no rate limiting.** It is token-gated but otherwise open by URL, and it
  writes. Worth adding before it matters.


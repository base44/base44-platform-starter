# Deploying

This runs on free plans: **Netlify** for the app + **Neon** for Postgres. Nothing in the stack needs
a paid feature.

Two things to understand before you start:

- **A deployment makes `/api/sunny` reachable from the internet.** It answers only requests
  carrying a viewer token signed with `NEXTAUTH_SECRET` (see
  [base44-built-apps.md](base44-built-apps.md)), so there is no shared secret to leak and no open
  mode to forget to close — but a weak or reused `NEXTAUTH_SECRET` now compromises that API too.
- **Sign-in is pinned to one origin.** `NEXTAUTH_URL` and the Google OAuth client both name an exact
  host, so preview deployments cannot sign in unless you give them their own client. See
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
| `NEXTAUTH_URL` | `https://<your-host>` — the production domain, exactly |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the production OAuth client |
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

Previews are off by default, for two independent reasons:

1. **They cannot build.** Scope the Postgres vars to production and a preview has no
   `DATABASE_URL`/`DIRECT_URL`, so `prisma generate` fails schema validation in `postinstall`.
   Granting a preview those vars is worse, not better: the build command is
   `prisma migrate deploy && next build`, so **every pull request would migrate production**.
2. **They cannot sign in.** `NEXTAUTH_URL` and the OAuth client are pinned to the production domain,
   so the callback never matches a preview URL.

Making previews real means a separate database branch for the preview scope plus a second OAuth
client for the preview domain.

## Known rough edges

- **Neon's free tier suspends on inactivity**, so the first request after a pause pays a cold start
  of a second or two on top of the serverless cold start.
- **No connection-pool tuning.** Prisma opens a pool per function instance; the pooled URL is what
  keeps that from exhausting connections.
- **`/api/sunny` has no rate limiting.** It is token-gated but otherwise open by URL, and it
  writes. Worth adding before it matters.

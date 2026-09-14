# Tiny Sunny

Sunny's My Apps experience with Google login, an apps grid, and a chat editor.
There is no marketplace, installation flow, or dashboard data API.

## Development

Use Node.js 24 (also configured for Netlify). The assistant-ui dependencies
require Node.js 22, 24, or 26+; Node.js 20 is no longer supported by this example.

Run from the repository root:

```sh
npm install
cp examples/white-label-minimal/.env.example examples/white-label-minimal/.env.local
npm run minimal:dev
```

Fill in the environment variables before starting. Keep `NEXTAUTH_URL` explicitly
set to `http://127.0.0.1:3001` locally so Prisma does not inherit Sunny’s root URL. Tiny uses Sunny's existing
Google/Auth.js configuration, Prisma database, and Base44 service-principal
integration. It must stay in this repository because it imports those shared
server modules and the Sunny logo. It does not require a personal API key or a
builder password.

Sign in at http://127.0.0.1:3001, connect the workspace, then create an app or
edit one you own. Apps are persisted in the shared ownership table and survive
refreshing the page. Sharing Sunny's database and workspace also makes a user's
existing Sunny apps available in Tiny.

## Netlify

Keep the repository root as the base directory and set the package directory to
`examples/white-label-minimal`. The package's `netlify.toml` builds Tiny.

Configure the variables from `.env.example` for builds and production functions.
Set `NEXTAUTH_URL` and `BUILDER_ORIGIN` to `https://tiny.sunny44.com`.
Use an existing migrated Sunny database; this build does not run migrations.

For Google login, either register
`https://tiny.sunny44.com/api/auth/callback/google` on the Google OAuth client, or
use Sunny's existing Auth.js redirect proxy: set `AUTH_REDIRECT_PROXY_URL` to
`https://sunny44.com/api/auth` and use the same `NEXTAUTH_SECRET` and Google client
as Sunny. Cookies remain scoped to each hostname.

Netlify cannot export production variables marked as secret. Populate these
from their original values; changing a variable name does not convert a workspace
key into a personal API key.

## Code layout

- `lib/types.ts`: shared app, conversation, tool-input, and app-service contracts.
- `lib/builder-api.ts`: browser requests to Tiny's `/api/base44` endpoint.
- `lib/base44-server.ts`: server-to-Base44 app operations using a supplied access token.
- `lib/base44-config.ts`: validated platform origin and workspace configuration.
- `lib/auth.ts`: Sunny session entry point, backed by Auth.js v5 / Google in
  `../../src/lib/auth.ts`. Login does not provision or mint Base44 credentials.
- `lib/base44-identity.ts`: Base44 connection and token renewal, backed by the shared
  service-principal integration in `../../src/lib/base44Link.ts`. Its workspace-key
  and issuer settings remain in `../../src/lib/base44Config.ts`.
- `lib/app-repository.ts`: Prisma app ownership storage, always scoped to the Sunny user.
- `lib/app-service.ts`: combines the verified session, Base44 token, API client, and
  ownership repository for a builder request. This replaces `lib/workspace.ts`.

Google login runs through `/api/auth`. After login, the separate **Connect workspace**
action calls `/api/base44/connection` to provision a service principal and mint its token.
Builder requests reuse that stored token and renew it near expiry; they do not
provision identities. The browser receives no Base44 access tokens.

## Boundaries

The chat uses `@assistant-ui/react` with an external-store runtime. Base44's
polled conversation remains the source of truth; `lib/assistant-messages.ts`
maps it into message and tool-call parts. `components/BuilderChat.tsx` composes
the library's viewport, Markdown, and composer primitives using the existing
styles. `Question` and `ToolActivity` remain inline tool renderers, preserving
Base44 approvals, choices, secret inputs, and retry behavior. No assistant-ui
cloud account or separate model endpoint is needed.

Every builder request requires a server-verified session. App reads, edits,
previews, and deploys check ownership in the database before contacting Base44.
The workspace key provisions and mints a token for the signed-in user's service
principal. Tokens remain server-side. The browser cannot choose its identity,
workspace, credentials, or upstream URL.

Preview credentials stay in page memory and are removed before expiry. Long
Base44 operations can exceed the hosting provider's request limit; uncertain
creation responses offer recovery instead of automatically creating another app.

## Checks

```sh
npm run minimal:typecheck
npm run minimal:test
npm run test:browser --workspace @base44/white-label-minimal
npm run minimal:build
```

Browser tests run a separate fixture application outside the production `app`
directory. It supplies a sample user for UI tests, without adding a login bypass
to Tiny. API tests cover missing sessions, ownership, origins, request validation,
and upstream failures.

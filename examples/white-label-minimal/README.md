# Tiny Sunny

A minimal Base44 integration: sign in, connect a workspace, create an app,
chat with the builder, answer its questions, preview, and publish.

This example uses the [service-user tenancy model](https://base44-docs-white-label-rewrite.mintlify.site/white-label/tenancy-and-credentials#service-users).
Each builder gets a Base44 service user that owns their apps. Your backend provisions
that identity using a workspace API key, then uses the service user's access token
to create and manage apps. Both credentials stay on the server.

## Run locally

Use Node.js 24. From the repository root:

```sh
npm install
cp examples/white-label-minimal/.env.example examples/white-label-minimal/.env.local
```

Fill in `.env.local` with Sunny's Google OAuth credentials, Auth.js secret,
migrated Prisma database, and Base44 workspace service key. Keep `NEXTAUTH_URL`
set to `http://127.0.0.1:3001`, then run:

```sh
npm run minimal:dev
```

Open [Tiny Sunny](http://127.0.0.1:3001), sign in, and select **Connect workspace**.
Apps are saved in Sunny's ownership table, so existing apps in the same database
and workspace are available here too.

## Copy the integration

| Folder | Responsibility |
| --- | --- |
| `lib/base44/` | Base44 API calls, identity lifecycle, and custom instructions |
| `lib/server/` | Authentication and request handling |
| `lib/storage/` | Database access and app ownership |
| `lib/chat/` | Browser API calls and conversation helpers |
| `lib/types.ts` | Shared types |

Start with [lib/base44/client.ts](lib/base44/client.ts). It contains the Base44
endpoints and request payloads for creation, conversation, tool answers, preview,
and publishing. Copy it with `lib/base44/config.ts`, `lib/base44/error.ts`,
`lib/base44/custom-instructions.ts`, and `lib/types.ts`. It uses `fetch` and `server-only`, with
no Sunny imports. Set `BASE44_PLATFORM_HOST` to your Base44 HTTPS origin and
adapt `lib/base44/custom-instructions.ts` to your product. New apps use the first 80
characters of the prompt as their initial name.

For a complete browser integration, follow this path:

```text
components/Builder.tsx → lib/chat/builder-api.ts → app/api/base44/route.ts
  → lib/server/api-handler.ts → lib/server/app-service.ts → lib/base44/client.ts
```

[lib/server/app-service.ts](lib/server/app-service.ts) is where your application plugs in:

- [server/auth.ts](lib/server/auth.ts) supplies the verified user from your session.
- [base44/identity.ts](lib/base44/identity.ts) provisions a service user, mints its token,
  and refreshes it near expiry.
- [storage/app-repository.ts](lib/storage/app-repository.ts) saves ownership and scopes app access to that user.

[prisma/schema.prisma](prisma/schema.prisma) defines identity links and app ownership.
[lib/storage/db.ts](lib/storage/db.ts) connects through `DATABASE_URL`. The Prisma client is generated
on install and build; run `npm run db:generate` from the example after schema edits.

Google login and Base44 connection are separate. `/api/base44/connection`
provisions a service principal using the workspace key. Builder requests use its
stored token; they do not provision identities or send credentials to the browser.
The API handler validates requests and checks app ownership before app operations.

For the chat UI, copy `components/`, `lib/chat/builder-api.ts`, `lib/chat/conversation.ts`,
and `lib/chat/assistant-messages.ts`. The chat uses assistant-ui's external-store runtime
with Base44's polled conversation as its source of truth. `Question.tsx` handles
approvals, choices, and secrets; retries preserve the original answer and request ID.
Preview tokens stay in page memory and are cleared before expiry. A timed-out
creation may still succeed, so the UI asks users to check before creating again.
An app can only be resumed here if its ownership was saved successfully.

## Deploy to Netlify

Use the repository root as the base directory and `examples/white-label-minimal`
as the package directory. Its `netlify.toml` builds the example without running
migrations; use an already migrated Sunny database.

Set the variables from `.env.example` for builds and production functions.
Set `NEXTAUTH_URL` and `BUILDER_ORIGIN` to your deployment's exact HTTPS origin.
Register `<origin>/api/auth/callback/google` with your Google OAuth client, or
set `AUTH_REDIRECT_PROXY_URL=https://sunny44.com/api/auth` and use Sunny's Google
client and `NEXTAUTH_SECRET` for its existing redirect proxy.

## Verify

```sh
npm run minimal:typecheck
npm run minimal:test
npm run test:browser --workspace @base44/white-label-minimal
npm run minimal:build
```

API tests cover session checks, ownership, validation, and upstream failures.
Browser tests use a separate fixture app with mocked Base44 responses.

### Static and live previews

Browsing uses `https://preview--{slug}.{BASE44_STATIC_PREVIEW_DOMAIN}` (default
`base44.app`). Confirm this hosting convention for your Base44 environment and
set the domain accordingly. This URL is derived by Tiny, not returned by Base44.
Apps without a slug show a screenshot or placeholder; browsing never starts a sandbox.
Editing requests a live preview and keeps static visible until the live iframe loads.
A load event only controls the visual transition; it does not verify app health.
Edited widgets remain live for the page session instead of silently switching to a
potentially stale static build. Expired previews offer manual refresh. No private
build-status, runtime-auth, or heartbeat endpoints are used.

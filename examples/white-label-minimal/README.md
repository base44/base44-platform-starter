# Tiny Sunny

A minimal Base44 integration: sign in, connect a workspace, create an app,
chat with the builder, answer its questions, preview, and publish.

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

Start with [lib/base44-server.ts](lib/base44-server.ts). It contains the Base44
endpoints and request payloads for creation, conversation, tool answers, preview,
and publishing. Copy it with `base44-config.ts`, `base44-error.ts`,
`custom-instructions.ts`, and `types.ts`. It uses `fetch` and `server-only`, with
no Sunny imports. Set `BASE44_PLATFORM_HOST` to your Base44 HTTPS origin and
adapt `custom-instructions.ts` to your product. New apps use the first 80
characters of the prompt as their initial name.

For a complete browser integration, follow this path:

```text
components/Builder.tsx → lib/builder-api.ts → app/api/base44/route.ts
  → lib/api-handler.ts → lib/app-service.ts → lib/base44-server.ts
```

[lib/app-service.ts](lib/app-service.ts) is where your application plugs in:

- `auth.ts` supplies the verified user from your session.
- `base44-identity.ts` supplies that user's Base44 access token and renews it near expiry.
- `app-repository.ts` saves ownership and scopes app access to that user.

These three adapters currently use Sunny's shared server modules in `../../src/lib`.
Replace them with your authentication, identity provisioning, and storage when
copying the example into another project. The full demo also imports Sunny's
logo and Google sign-in button; it runs inside this repository as shipped.

Google login and Base44 connection are separate. `/api/base44/connection`
provisions a service principal using the workspace key. Builder requests use its
stored token; they do not provision identities or send credentials to the browser.
The API handler validates requests and checks app ownership before app operations.

For the chat UI, copy `components/`, `lib/builder-api.ts`, `lib/conversation.ts`,
and `lib/assistant-messages.ts`. The chat uses assistant-ui's external-store runtime
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

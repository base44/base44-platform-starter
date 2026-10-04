# Tiny Sunny

A minimal Base44 integration: sign in, create an app, chat with the builder,
answer its questions, preview, and publish.

It follows Base44's [tenancy model](https://docs.base44.com/developers/white-label/tenancy-and-credentials):
one Base44 account owns every app, and your server calls Base44 with that account's
personal access token. Base44 cannot tell your builders apart, so Tiny keeps them
apart itself: it records which builder owns each app and checks that on every call.
The token never reaches the browser.

## From the docs to the code

If you have read the [white label docs](https://docs.base44.com/developers/white-label/overview),
each part of them lives in one place here:

| Docs | Code |
| --- | --- |
| [Tenancy and credentials](https://docs.base44.com/developers/white-label/tenancy-and-credentials) | [lib/base44/config.ts](lib/base44/config.ts), [lib/base44/http.ts](lib/base44/http.ts) |
| Keeping builders apart | [lib/server/api-handler.ts](lib/server/api-handler.ts), [lib/storage/app-repository.ts](lib/storage/app-repository.ts) |
| [The build turn](https://docs.base44.com/developers/white-label/the-build-turn), steps 1–6 | [lib/base44/client.ts](lib/base44/client.ts), one commented section per step |
| Watch it build (live, instead of polling) | [lib/base44/socket-session.ts](lib/base44/socket-session.ts), [lib/chat/live-updates.ts](lib/chat/live-updates.ts) |
| Answer the agent's questions | [components/Question.tsx](components/Question.tsx), one UI per `waiting_on.kind` |
| Publish the app | `publish()` in [components/Builder.tsx](components/Builder.tsx) |
| [Embed the app](https://docs.base44.com/developers/white-label/embed-the-app) | [lib/base44/embed.ts](lib/base44/embed.ts), used for the latest build in each app card |
| [Custom instructions](https://docs.base44.com/developers/white-label/custom-instructions) | [lib/base44/custom-instructions.ts](lib/base44/custom-instructions.ts) |

Everything else is Tiny's own product: sign-in, the app list, and the chat UI.

## Run locally

Use Node.js 24. From the repository root:

```sh
npm install
cp examples/white-label-minimal/.env.example examples/white-label-minimal/.env.local
```

Fill in `.env.local` with Sunny's Google OAuth credentials, Auth.js secret,
migrated Prisma database, and the integration account's
[personal access token](https://docs.base44.com/Workspaces/Personal-access-tokens) and workspace ID.
Create the token in your enterprise workspace, with access to all apps and full permission.
Live chat updates also need a workspace API key with the `apps:watch` scope (`BASE44_SVC_KEY`).
Keep `NEXTAUTH_URL` set to `http://127.0.0.1:3001`, then run:

```sh
npm run minimal:dev
```

Open [Tiny Sunny](http://127.0.0.1:3001) and sign in.

## Copy the integration

| Folder | Responsibility |
| --- | --- |
| `lib/base44/` | Base44 API calls, credentials, and custom instructions |
| `lib/server/` | Authentication and request handling |
| `lib/storage/` | Database access and app ownership |
| `lib/chat/` | Browser API calls and conversation helpers |
| `lib/types.ts` | Shared types |

Start with [lib/base44/client.ts](lib/base44/client.ts). It contains the Base44
endpoints and request payloads for creation, conversation, tool answers, preview,
and publishing. Copy it with `lib/base44/http.ts`, `lib/base44/config.ts`, `lib/base44/error.ts`,
`lib/base44/custom-instructions.ts`, and `lib/types.ts`. Every endpoint it calls is described in
Base44's [OpenAPI spec](https://app.base44.com/api/openapi.json), if you prefer to generate a typed client. It uses `fetch` and `server-only`, with
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
- [storage/app-repository.ts](lib/storage/app-repository.ts) saves ownership and scopes app access to that user.

[prisma/schema.prisma](prisma/schema.prisma) defines app ownership.
[lib/storage/db.ts](lib/storage/db.ts) connects through `DATABASE_URL`. The Prisma client is generated
on install and build; run `npm run db:generate` from the example after schema edits.

Every Base44 call sends `Authorization: Bearer <token>` and `X-Active-Workspace-Id`, and
new apps are created with `organization_id`, so they use your workspace's design system,
skills, and plan. The API handler validates each request and checks that the signed-in
builder owns the app before any app operation.

For the chat UI, copy `components/`, `lib/chat/`, and `lib/base44/socket-session.ts`.
The chat uses assistant-ui's external-store runtime with Base44's live updates as its
source of truth (see below). `Question.tsx` handles
approvals, choices, and secrets; retries preserve the original answer and request ID.
Preview URLs stay in page memory and remain stable during normal use. A timed-out
creation may still succeed, so the UI asks users to check before creating again.
An app can only be resumed here if its ownership was saved successfully.

## Live builder updates

The chat updates live over the Base44 platform socket, through the Platform SDK,
[`@base44/platform`](https://github.com/base44/javascript-sdk/tree/main/packages/platform).

```text
components/useBuilderSocket.ts → lib/chat/live-updates.ts → @base44/platform
lib/chat/builder-api.ts → app/api/base44/route.ts → lib/base44/socket-session.ts
```

1. **Server** ([socket-session.ts](lib/base44/socket-session.ts)): after the usual
   sign-in and app-ownership checks, opens a read-only session for one app with the
   workspace key. `BASE44_SVC_KEY` needs the `apps:watch` scope. Only the session
   token reaches the browser.
2. **Browser** ([live-updates.ts](lib/chat/live-updates.ts)): connects with that
   token and subscribes to the app. A snapshot (status and the last 50 messages)
   arrives on every connect; then `message.updated`, `message.removed` and
   `app.status_changed` keep the chat current.
3. **React** ([useBuilderSocket.ts](components/useBuilderSocket.ts)): holds the
   state and shows one error with **Reconnect live updates** if the connection stops.

Kept out to stay minimal; add them in production:

- The session is not closed on leave; it expires after an hour. Workspace keys have
  a limit on open sessions, so close it (`DELETE /api/service/socket-sessions/{id}`)
  when the builder unmounts.
- The chat shows the last 50 messages. Load older ones with
  [Read conversation messages](https://docs.base44.com/api-reference/read-conversation-messages) if you need full history.
- Generated images stay as placeholders until the next reconnect (`image.resolved`).

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

### Latest build and live previews

Tiny shows two versions of an app, both from documented Base44 calls:

- **Latest build** (app cards, and the stage until the live preview loads): the server
  signs the builder into the app with [Embed the app](https://docs.base44.com/developers/white-label/embed-the-app)
  and `target: "latest_preview"` ([lib/base44/embed.ts](lib/base44/embed.ts)). The URL works once and
  expires in 60 seconds, so [PreviewFrame](components/PreviewFrame.tsx) asks for a new one when it mounts and
  after each build. It needs no sandbox. Before the first build there is no URL, and the card shows
  the screenshot or a placeholder.
- **Live preview** (while editing): [Get preview URL](https://docs.base44.com/api-reference/get-preview-url),
  step 5 of the build turn. It runs the app's sandbox and shows each change as the agent makes it.

The live frame keeps the latest build visible until it loads. Recovery checks the source window and
live origin of `preview:requestRefresh` messages, with at most three attempts per preview session and no
retries on authorization failures. This observed Base44 message is not a confirmed public contract, so
manual refresh remains available.

### Reusing the preview component

`components/Base44Preview.tsx` owns static/live rendering, loading, recovery, and manual refresh. It depends only on React. `PreviewFrame` adapts Tiny's app model and backend client to its props:

```tsx
<Base44Preview
  appId={app.id}
  title="App preview"
  staticUrl={latestBuildUrl}
  screenshotUrl={app.preview_screenshot_url}
  live={editing}
  loadPreview={getPreviewUrl}
/>
```

`loadPreview(appId)` calls your authenticated backend and returns `{ url }`. Reject with an error carrying `status: 401` or `403` to stop automatic recovery on authorization failures. Keep platform credentials on the backend. Changing the app or live mode starts a new preview session; changing the callback does not reload the iframe.

When copying the component, include the `preview-frame`, `preview-loading-frame`, `preview-fallback`, `preview-controls`, `preview-spinner`, `widget-placeholder`, and `secondary` styles from `app/globals.css`, or provide equivalent styles and a sized parent container.

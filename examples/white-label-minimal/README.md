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
| [Tenancy and credentials](https://docs.base44.com/developers/white-label/tenancy-and-credentials) | [server/base44/config.ts](server/base44/config.ts), [server/base44/request.ts](server/base44/request.ts) |
| Keeping builders apart | [server/actions.ts](server/actions.ts), [server/ownership.ts](server/ownership.ts) |
| [The build turn](https://docs.base44.com/developers/white-label/the-build-turn), steps 1–6 | [server/base44/build-turn.ts](server/base44/build-turn.ts), one function per call, numbered by step |
| Watch it build (live, instead of polling) | [server/base44/live-updates.ts](server/base44/live-updates.ts), [client/useBuildTurn.ts](client/useBuildTurn.ts) |
| Answer the agent's questions | [components/Question.tsx](client/components/Question.tsx), one UI per `waiting_on.kind` |
| Publish the app | `publish()` in [components/Builder.tsx](client/components/Builder.tsx) |
| [Embed the app](https://docs.base44.com/developers/white-label/embed-the-app) | [server/base44/embed.ts](server/base44/embed.ts), used for every preview |
| [Custom instructions](https://docs.base44.com/developers/white-label/custom-instructions) | [server/base44/custom-instructions.ts](server/base44/custom-instructions.ts) |

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

| Folder | What runs there |
| --- | --- |
| `server/` | The server: Base44 calls ([server/base44/](server/base44)), server actions, sign-in, and app ownership |
| `client/` | The browser: the build turn's state, live updates, and the UI components |
| `app/` | Next.js routes only: the page, its layout, and the sign-in callback |
| `types.ts` | Types both sides share |

Start with [server/base44/build-turn.ts](server/base44/build-turn.ts). It has one function per Base44 call,
numbered by the step of the build turn: create, send a prompt, watch, answer, and publish.
[embed.ts](server/base44/embed.ts) and [live-updates.ts](server/base44/live-updates.ts) cover the other two docs
pages, and [request.ts](server/base44/request.ts) is the `fetch` they share. Copy them with
`server/base44/config.ts`, `server/base44/error.ts`, `server/base44/custom-instructions.ts`, and `types.ts`. Every endpoint it calls is described in
Base44's [OpenAPI spec](https://app.base44.com/api/openapi.json), if you prefer to generate a typed client. It uses `fetch` and `server-only`, with
no Sunny imports. Set `BASE44_PLATFORM_HOST` to your Base44 HTTPS origin and
adapt `server/base44/custom-instructions.ts` to your product. New apps use the first 80
characters of the prompt as their initial name.

For a complete browser integration, follow this path:

```text
client/components/Builder.tsx → server/actions.ts → server/base44/build-turn.ts
```

[server/actions.ts](server/actions.ts) holds Tiny's server actions, and is where your application plugs in:

- [server/auth.ts](server/auth.ts) supplies the verified user from your session.
- [server/ownership.ts](server/ownership.ts) records which builder created each app, and checks it.

[prisma/schema.prisma](prisma/schema.prisma) defines app ownership.
[server/db.ts](server/db.ts) connects through `DATABASE_URL`. The Prisma client is generated
on install and build; run `npm run db:generate` from the example after schema edits.

Every Base44 call sends `Authorization: Bearer <token>` and `X-Active-Workspace-Id`, and
new apps are created with `organization_id`, so they use your workspace's design system,
skills, and plan. Each server action checks who is signed in and, for an app, that they own it,
before it calls Base44.

In the browser, [client/useBuildTurn.ts](client/useBuildTurn.ts) is the whole build turn: it opens
live updates, sends prompts and answers questions. The components only show it. The chat uses
assistant-ui's external-store runtime with Base44's live updates as its source of truth (see below). `Question.tsx` handles
approvals, choices, and secrets; retries preserve the original answer and request ID.
A timed-out creation may still succeed, and the error says so.

## Live builder updates

The chat updates live over the Base44 platform socket, through the Platform SDK,
[`@base44/platform`](https://github.com/base44/javascript-sdk/tree/main/packages/platform).

```text
client/useBuildTurn.ts → server/actions.ts → server/base44/live-updates.ts
client/useBuildTurn.ts → @base44/platform
```

1. **Server** ([server/base44/live-updates.ts](server/base44/live-updates.ts)): after the usual
   sign-in and app-ownership checks, opens a read-only session for one app with the
   workspace key. `BASE44_SVC_KEY` needs the `apps:watch` scope. Only the session
   token reaches the browser.
2. **Browser** ([useBuildTurn.ts](client/useBuildTurn.ts), step 2): creates the platform
   client with that token and subscribes to the app. A snapshot (status and the last 50
   messages) arrives on every connect; then `message.updated`, `message.removed` and
   `app.status_changed` keep the chat current. If the connection stops, the builder sees
   one error with **Reconnect live updates**.

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
Set `NEXTAUTH_URL` to your deployment's exact HTTPS origin.
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

Every preview is the app signed in as the builder, through
[Embed the app](https://docs.base44.com/developers/white-label/embed-the-app)
([server/base44/embed.ts](server/base44/embed.ts)). The builder is not a Base44 user, so
without it a private app would show its own sign-in page inside the frame.

- **Latest build** (`target: "latest_preview"`): app cards, and the stage until the live preview
  loads. It needs no sandbox. Before the first build there is no URL, and the card shows the
  screenshot or a placeholder.
- **Live preview** (`target: "live_preview"`): while editing. It runs the app's sandbox and shows
  each change as the agent makes it.

Each URL works once and expires in 60 seconds, so [PreviewFrame](client/components/PreviewFrame.tsx) asks
for a new one whenever it loads a frame.

The live frame keeps the latest build visible until it loads. Recovery checks the source window and
live origin of `preview:requestRefresh` messages, with at most three attempts per preview session and no
retries on authorization failures. This observed Base44 message is not a confirmed public contract, so
manual refresh remains available.

### Reusing the preview component

`client/components/Base44Preview.tsx` owns static/live rendering, loading, recovery, and manual refresh. It depends only on React. `PreviewFrame` adapts Tiny's app model and backend client to its props:

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

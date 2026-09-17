# Tiny Sunny

A minimal Base44 integration: sign in, connect a workspace, create an app,
chat with the builder, answer its questions, preview, and publish.

This example uses the [service-user tenancy model](https://base44-docs-white-label-rewrite.mintlify.site/white-label/tenancy-and-credentials#service-users).
Each builder gets a Base44 service user that owns their apps. Your backend provisions
that identity using a workspace API key, then uses the service user's access token
to create and manage apps. The API key stays on the server. For this socket integration, the current service-user
access token is sent to the signed-in browser after an app-ownership check.

## Run locally

Use Node.js 24. From the repository root:

```sh
npm ci
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
stored token; they do not provision identities during ordinary app operations.
The API handler validates requests and checks app ownership before app operations.

For the chat UI, copy `components/`, `lib/chat/builder-api.ts`, `lib/chat/conversation.ts`,
and `lib/chat/assistant-messages.ts`. The chat uses assistant-ui's external-store runtime
with an initial conversation snapshot followed by SDK builder socket updates. `Question.tsx` handles
approvals, choices, and secrets; retries preserve the original answer and request ID.
Preview URLs stay in page memory and remain stable during normal use. A timed-out
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

Browsing uses `https://preview--{slug}.{BASE44_STATIC_PREVIEW_DOMAIN}`. Set
`BASE44_STATIC_PREVIEW_DOMAIN` to the preview hosting domain confirmed for your
Base44 environment. Without it, browsing uses screenshots or placeholders. This URL is derived by Tiny, not returned by Base44.
Apps without a slug show a screenshot or placeholder; browsing never starts a sandbox.
Editing requests a live preview and keeps static visible until the live iframe loads.
A load event only controls the visual transition; it does not verify app health.
Edited widgets remain live for the page session instead of silently switching to a
potentially stale static build. Recovery checks the source window and live origin of `preview:requestRefresh` messages, with at most three recovery attempts per preview session and no retries on authorization failures. This observed Base44 message is not a confirmed public contract, so manual refresh remains available. Recovery reloads the iframe using its last parent-supplied path and parameters; cross-origin navigation inside the app cannot be preserved without a supported bridge. No private
build-status, runtime-auth, or heartbeat endpoints are used.

### Reusing the preview component

`components/Base44Preview.tsx` owns static/live rendering, loading, recovery, and manual refresh. It depends only on React. `PreviewFrame` adapts Tiny's app model and backend client to its props:

```tsx
<Base44Preview
  appId={app.id}
  title="App preview"
  staticUrl={app.static_preview_url}
  screenshotUrl={app.preview_screenshot_url}
  live={editing}
  loadPreview={getPreviewUrl}
/>
```

`loadPreview(appId)` calls your authenticated backend and returns `{ url }`. Reject with an error carrying `status: 401` or `403` to stop automatic recovery on authorization failures. Keep platform credentials on the backend. Changing the app or live mode starts a new preview session; changing the callback does not reload the iframe.

When copying the component, include the `preview-frame`, `preview-loading-frame`, `preview-fallback`, `preview-controls`, `widget-placeholder`, and `secondary` styles from `app/globals.css`, or provide equivalent styles and a sized parent container.
## Live builder updates

The example pins the preview of [SDK PR #286](https://github.com/base44/javascript-sdk/pull/286)
under the `@base44/sdk` alias. Update that exact version when adopting a released SDK.

```text
Builder.tsx → useBuilderSocket.ts → lib/chat/build-stream.ts
  → lib/chat/builder-connection.ts → @base44/sdk/platform/client
```

`builder-connection.ts` constructs the platform client and calls `client.builder.init`.
Its `refreshToken` callback calls the same-origin `POST /api/base44/socket-token`
endpoint on each reconnect. The endpoint requires a valid session, verifies the
request origin and app ownership, refreshes the existing server credential if
needed, and returns `{ serverUrl, token }` with `Cache-Control: no-store, private`.
The browser keeps the token in memory and supplies it only through Socket.IO
CONNECT `auth.token`. API keys and refresh tokens never go to the browser.

**Temporary credential decision:** this uses the existing service-user access token,
as requested, until the browser-specific token solution is available. This token
can authorize HTTP operations too; the read-only socket does not narrow its powers.
The app-ownership check protects token retrieval but does not make the token itself
app-scoped. Replace this exchange when the dedicated browser credential lands.
The backend must accept this credential at `/ws-whitelabel/socket.io/` and enable
the workspace's white-label socket flag. The pending verifier in the backend PR
still blocks deployed connections until integrated; there is no legacy-socket fallback.

The client subscribes before fetching initial history. The SDK buffers ordered
updates while that snapshot loads and resumes from applied cursors after transport
reconnects. App/message replacements and image resolutions are applied directly.
There are no periodic conversation or app reads. Invalidation events and completed
HTTP mutations trigger reconciliation; ready-state updates refresh preview metadata.
Queue/task events advance the cursor but have no separate UI in this minimal example.

Reviewed question and secret-form schemas arrive in the socket update that opens the
tool card. The browser renders those schemas directly and posts any answer through
the existing partner-backend mutation route. Tool cards use reviewed file paths,
activity summaries, entity counts, package names, plan fields, and generated-media
labels, state, and approved asset URLs; they never render source, diffs, commands,
execution output, secret values or raw results.
The partner backend remains responsible for applying the same filtering policy to
its existing HTTP history responses.

When retained history expires or an event cannot be applied, delivery stops and
**Reconnect live updates** starts a new session and snapshot. Snapshot recovery is
not an atomic history API; buffered events may briefly repeat newer snapshot state.
Switching apps/unmounting cancels reads and closes the builder session. Production
verification with the real token verifier remains a prerequisite for rollout.

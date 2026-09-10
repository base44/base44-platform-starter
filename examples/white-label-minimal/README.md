# Minimal white-label builder

A local, single-screen companion to the [white-label integration guide](https://base44-docs-white-label-rewrite.mintlify.site/white-label/overview).
Create an app from a prompt, watch its conversation, answer questions, open a fresh preview, and deliberately deploy.

## Start locally

Requires Node.js 20.19+ and an enabled Base44 workspace with a **personal API key** belonging to a member of that workspace. Workspace provisioning keys (`b44k_…`) cannot build apps.
Obtaining enterprise access is a prerequisite, not part of the three-minute local setup.

From the repository root:

```sh
npm install
cp examples/white-label-minimal/.env.example examples/white-label-minimal/.env.local
```

Fill in the three values in the example's `.env.local`:

| Variable | Value |
| --- | --- |
| `BASE44_API_KEY` | Personal API key of the shared account |
| `BASE44_ORG_ID` | Workspace ID in which to build |
| `BASE44_PLATFORM_HOST` | HTTPS platform origin, normally `https://app.base44.com` |

Then run one command:

```sh
npm run minimal:dev
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). Sunny keeps its usual port and commands.
Root installation also runs Sunny's Prisma client generation; the example does not use Prisma or need a database.
Its environment file belongs here, **not** beside the root package. Restart after changing it.

To use this directory independently, copy it outside the repository, run `npm install`, configure `.env.local`, and run `npm run dev`.
All imports and dependencies are local to this package; no Sunny source is needed. The repository lockfile pins workspace installs; an extracted package creates its own lockfile.

## Follow the build

```text
browser  ── POST /api/base44 ──>  local Next.js route  ── api_key + workspace ──> Base44
```

1. Enter a prompt. Creation includes the initial message and custom instructions in the same request.
2. Read status and conversation. Later prompts update the same app.
3. Answer or reject a waiting question. The composer stays locked until the question is resolved.
4. Open preview on request. Refresh obtains a new URL; closing it or reaching four minutes removes it from the screen.
5. Click **Deploy app** to publish the current version immediately, then open the published link.

The current app lives in memory. Reloading starts a new local session; keep the displayed app ID and use **Resume an existing app**, or find created apps in your Base44 workspace. This example has no app library or persistence.

## Local boundary and credentials

This is **not suitable for an unrestricted public deployment**. Every created app belongs to one shared account; there is no user login or app ownership check. Anyone with local access can operate on any app reachable by that account.
Both `dev` and `start` bind to loopback. The route accepts only loopback hosts, matching browser origins, JSON bodies up to 64 KB, and a closed set of validated actions. It rejects extra fields, including browser-supplied hosts, credentials, and workspace IDs. These checks prevent foreign web pages from casually invoking the local API; they do not authenticate local users.

The key exists only in `base44-server.ts`, marked with `server-only`. It is sent as `api_key`, with `X-Active-Workspace-Id` on every Base44 request. Creation additionally sends `organization_id`.
Neither upstream response bodies nor credentials are logged on errors. Upstream redirects are rejected.

Preview URLs contain short-lived credentials. They must reach the browser to display the iframe, but are never written to storage, cached by the local API, or logged. The iframe uses `no-referrer` and a sandbox. The platform may set its own preview cookies; this example controls only its own storage and responses.

For production tenancy, read [Sunny's service-user lifecycle](../../src/lib/base44Link.ts), [ownership enforcement](../../src/app/api/base44/platform/route.ts), and the [tenancy guide](https://base44-docs-white-label-rewrite.mintlify.site/white-label/tenancy-and-credentials).
Choose tenancy before real users create apps: the guide does not support transferring shared-account apps to service users later.

## Timing, pagination, and recovery

Create, message, tool input, deploy, and cold preview calls allow 120 seconds; conversation reads allow 60 seconds and ordinary reads 30 seconds. The route's deployment ceiling is 180 seconds; any hosting proxy must allow enough time too.

Conversation results are oldest first, but `skip` counts **backward from the newest message**. Each refresh reads the latest 20 and pages backward until it overlaps known history. Matching message IDs are replaced so changing tool statuses remain current. An older running or waiting tool extends that refresh range. Hidden messages still count toward offsets, but are omitted from display.
There is one refresh at a time. It schedules the next read after completion (2 seconds processing, 10 seconds idle), aborts on unmount, and pauses on failure. **Resume polling** reconciles the conversation afresh.
Offsets are not snapshot cursors. Concurrent appends can temporarily shift page boundaries; merging removes duplicates and subsequent polling catches new arrivals. Editing or undoing arbitrary old messages is outside this example.

A failed response does not prove a mutation failed. Create, message, and deploy are never automatically retried. For an uncertain create, inspect the workspace and use the recovery app-ID field before creating again. For other operations, refresh state first; **Check published URL** can recover the link without deploying again. An existing published URL alone does not prove that a timed-out deployment published the newest version.

Question retries keep the original decision and payload in memory and use `submit-${toolCallId}` as `X-Request-ID`. Inputs remain locked after an uncertain answer so a retry cannot change its meaning. The question component guards duplicate clicks before React re-renders. A tool status change remounts its controls, discarding any retained answer or secret after the waiting state ends.

## Guide to code

| Concept | Source |
| --- | --- |
| Server credentials, workspace, HTTP endpoints, preview and publishing | [lib/base44-server.ts](lib/base44-server.ts) |
| Local boundary, validation, safe errors | [app/api/base44/route.ts](app/api/base44/route.ts) |
| Browser calls and shared wire types | [lib/base44-client.ts](lib/base44-client.ts) |
| Custom instructions before initial build | [lib/custom-instructions.ts](lib/custom-instructions.ts) |
| Polling lifecycle and read recovery | [components/useBuildPolling.ts](components/useBuildPolling.ts) |
| Conversation pagination and reconciliation | [lib/conversation.ts](lib/conversation.ts) |
| Choice, input, approval and immutable answer retry | [components/Question.tsx](components/Question.tsx) |
| Prompt → question → preview → deploy | [components/Builder.tsx](components/Builder.tsx) |

The guide documents `waiting_on.kind`; the conversation OpenAPI schema currently omits it. Choice fields (`questions`) and input fields (`secrets_schema`) follow Sunny's existing integration. Unknown kinds or argument schemas remain visible as expandable diagnostics with a rejection action. There is no guessed generic form.
The preview token is attached as `_preview_token`, matching Base44's public editor implementation inspected on 2026-09-09. The preview API reference describes the token but does not specify that query parameter. These beta contracts should be rechecked when the guide changes.

## Verify

From this directory:

```sh
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:browser
```

Unit and browser tests use fixtures and do not spend Base44 credits. Browser tests build and start their own loopback production server on port 3101 and intercept the local API (except the real-route origin check); server tests separately validate the real route against a mocked upstream fetch.
The `server-only` dependency provides an enforceable import boundary. `tsx` and Playwright are development-only dependencies for deterministic tests, including duplicate clicks and retry recovery.

An optional live smoke test requires the configured local server running on port 3001:

```sh
npm run smoke
```

This explicit command creates **one real app and consumes credits**. It waits up to five minutes, reads the conversation, and requests a preview without printing the token. It never deploys or approves questions; if a question appears, it stops. Keep the printed app ID, inspect it in Base44, and delete the test app manually when finished. Missing environment values skip the run.

The runtime has two more TypeScript files than the original sketch: a polling hook and a conversation merge module. Those boundaries keep timing and pagination testable without hiding HTTP calls behind a framework. All components remain below the plan's size limits.

## Netlify deployment preparation

This package has its own `netlify.toml`. Create a separate Netlify project using
this repository, leave Base directory empty, and set Package directory to
`examples/white-label-minimal`. The package configuration builds only the example;
Sunny's root deployment configuration runs database migrations and is not the
configuration for this project.

The configuration alone does not make the builder production-ready: its route
still accepts local origins only and has no hosted authentication. Netlify's
synchronous function limit is shorter than this example's long-running Base44
calls. A hosted deployment must provide access protection and an appropriate
long-running execution path before enabling real credentials. Do not remove the
local origin check alone and expose the shared account.

### Hosted private demo

Set `BUILDER_ORIGIN=https://tiny.sunny44.com` and a randomly generated
`BUILDER_PASSWORD` of at least 24 characters in the hosting environment, alongside
the three Base44 variables in `.env.example`. Enter that password in the builder.
It stays in page memory and is sent only to this application's API; refreshing
requires entering it again. Never use your Base44 API key as the access password.
All password holders can access the shared workspace's apps; this is a trusted
collaborator demo, not per-user isolation. Rotate the environment password to revoke
access. Hosted requests fail closed when access configuration is missing.

Netlify function limits still apply: long Base44 operations may outlive a request.
An uncertain creation must be checked in the workspace before retrying.

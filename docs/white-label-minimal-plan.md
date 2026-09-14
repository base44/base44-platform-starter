# Lean White-Label Integration Example

## Goal

Create a small, self-contained Base44 white-label example that accompanies the
[white-label integration guide](https://base44-docs-white-label-rewrite.mintlify.site/white-label/overview).

The example should make the integration understandable at a glance. A reader should be able to
clone the repository, configure Base44, run one command, and follow the complete build loop without
first learning the rest of Sunny.

The existing Sunny application remains the complete, production-oriented reference. The new
example focuses only on the integration itself.

## Decision

Add a standalone package at:

```text
examples/white-label-minimal/
```

Keep it in this repository so it can share repository history, dependency installation, CI, and
maintenance. Keep its runtime code self-contained: it must not import implementation details from
the full Sunny application. This makes the example easy to read, copy, or extract into its own
repository later.

Use the shared-account tenancy model in this minimal example. It is the shortest path through the
App Management API and keeps attention on the build loop. Clearly label it as a local learning
example, not a safe public multi-user deployment. Link readers to the full Sunny service-user
implementation for the production tenancy model.

## Scope

The example demonstrates only this flow:

1. Create an app from an initial prompt.
2. Poll its build status and conversation.
3. Render questions from the agent.
4. Approve, reject, or answer those questions.
5. Open a fresh preview.
6. Deploy the app and show its published URL.

The example also demonstrates these integration requirements:

- Base44 credentials stay on the server.
- The workspace is selected explicitly on every applicable request.
- Custom instructions are present before the initial build begins.
- Long-running build calls use appropriate timeouts.
- Tool-call submissions use stable request IDs.
- Preview tokens are short-lived: never persist, cache, or log them; retain a URL only while displaying it.
- Conversation polling refreshes a bounded recent window and pages backward when needed, merging by message ID.

## Non-goals

Do not include:

- Boards, tasks, analytics, widgets, or marketplace features.
- Sunny's entity compatibility layer or public data API.
- Prisma or another database.
- Google sign-in or a general-purpose authentication system.
- Service-user provisioning and token refresh.
- A component library, state-management library, or data-fetching framework.
- Multiple pages, themes, responsive layout work beyond basic usability, or product polish.
- Generic SDK abstractions intended to predict future use cases.

## Simplicity requirements

Code clarity is a feature of this example, not a cleanup task for later.

### Prefer direct code

- Keep one obvious path from a UI action to the local API route and then to Base44.
- Use platform `fetch`, React state, and small functions before adding dependencies.
- Prefer explicit action handlers over a generic request framework.
- Share code only when duplication would make the example harder to understand or easier to get
  wrong.
- Keep types close to the code that consumes them unless several files genuinely share them.
- Use names from the integration guide so readers can move between prose and code without
  translating concepts.

### Keep abstractions earned

- A single-caller helper or polling hook is appropriate when it isolates a named responsibility or a timing invariant; do not add speculative layers.
- Do not introduce repositories, services, factories, providers, registries, or dependency
  injection.
- Keep the browser client thin and keep Base44 request construction in one server-only module.
- Use one API route with a closed action allowlist. Do not build a transparent proxy.
- Prefer a short switch statement over metadata-driven routing if the switch is easier to read.

### Keep files focused

- Aim for fewer than ten source files.
- Aim for components below 250 lines and other modules below 200 lines.
- Split a file only when the new boundary has a clear name and responsibility.
- Avoid barrel files and re-export layers.

These are review signals, not mechanical limits. Exceeding one should require a concrete readability
reason in the pull request.

### Make comments useful

- Comment security boundaries, surprising API behavior, and timing constraints.
- Do not narrate syntax or repeat what a well-named function already says.
- Keep the most important explanations beside the relevant code, with deeper operational detail in
  the README.

### Keep the dependency budget small

The package should depend only on Next.js, React, and React DOM unless a missing capability cannot
be implemented clearly with the platform. Any additional runtime dependency requires an explicit
reason in the pull request.

## Proposed structure

Start with this structure and combine files if the implementation is clearer with fewer boundaries:

```text
examples/white-label-minimal/
├── app/
│   ├── api/base44/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── Builder.tsx
│   ├── useBuildPolling.ts
│   └── Question.tsx
├── lib/
│   ├── base44/
│   ├── server/
│   ├── storage/
│   ├── chat/
│   └── types.ts
├── .env.example
├── README.md
├── package.json
└── tsconfig.json
```

Responsibilities:

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Render the single example screen. |
| `components/Builder.tsx` | Own the build loop, polling, conversation, preview, and deploy actions. |
| `components/Question.tsx` | Render and submit `choice`, `input`, and `approval` questions. |
| `app/api/base44/route.ts` | Enforce the local origin boundary, validate action-specific payloads, and return safe errors. |
| `lib/base44/client.ts` | Hold credentials and make the allow-listed Base44 HTTP calls. |
| `lib/chat/builder-api.ts` | Provide small typed functions that call the local API route. |
| `lib/base44/custom-instructions.ts` | Keep the full per-app custom instructions visible and easy to find. |

Avoid a separate types file unless shared types make at least three of these files clearer.

## Decisions resolved before implementation

- **Local access, no user authentication:** dev and start bind to `127.0.0.1`, on port
  3001 so Sunny can run alongside the example. The route requires a loopback Host,
  an exactly matching Origin, JSON content type, and a bounded request body. This
  is not a multi-user authorization system; every reachable app belongs to the shared account.
- **Credentials:** use a personal API key in the `api_key` header (not Sunny's
  service-user Bearer token), plus the workspace header on every upstream call.
- **Pagination:** the API returns messages oldest first, but `skip` and `limit`
  count backward from the newest message. Poll the latest 20, page backward until
  overlapping known history, and replace matching IDs so changing tool statuses
  are not frozen. Include any older unresolved tool call in the refreshed range.
  Reject missing message IDs clearly instead of silently losing history. Offsets
  are not a snapshot cursor: concurrent appends can require another refresh;
  undo/edit flows and arbitrary historical rewrites are outside this example.
- **Polling lifecycle:** one refresh at a time; schedule after completion, abort on
  unmount, and ignore stale results. Pause on read failure with Resume polling.
  A small hook is allowed to keep these invariants out of the screen rendering.
- **Uncertain mutations:** do not automatically retry create, message, or deploy.
  A network failure or timeout may leave upstream work running. Reconcile known
  app/conversation/published state; if creation returned no ID, direct the reader
  to the Base44 workspace before creating again. Tool retries retain the exact
  decision and payload as well as a deterministic request ID; lock edited answers
  while the outcome is uncertain. Disable duplicate submissions synchronously.
- **Package independence:** declare all dependencies locally, exclude the example
  from root TypeScript checks, ignore nested build output, and document that
  workspace installation still runs root Prisma generation. A copied package
  must install, typecheck, and build without Sunny or Prisma. `.env.local` belongs
  in the example directory. No environment values are required just to build.
- **Verification:** deterministic fixtures exercise all question kinds, malformed
  and unknown questions, pagination overlap and updates, safe errors, request
  validation, retry identity, and preview handling. Live smoke is explicit, never
  deploys, and stops if the agent asks a question. Environment presence alone must
  not trigger app creation during ordinary tests.

API contract checked against the guide's Markdown pages on 2026-09-09:
[tenancy](https://base44-docs-white-label-rewrite.mintlify.site/white-label/tenancy-and-credentials),
[conversation](https://base44-docs-white-label-rewrite.mintlify.site/api-reference/read-conversation-messages),
[preview](https://base44-docs-white-label-rewrite.mintlify.site/api-reference/get-preview-url),
and [published URL](https://base44-docs-white-label-rewrite.mintlify.site/api-reference/get-published-url).
The guide describes `waiting_on.kind`; the published conversation schema currently
omits it. Use the guide plus Sunny's concrete question argument schemas, and show
unsupported payloads as diagnostics rather than guessing their meaning.

## Delivery order

Implement vertical slices: create → poll → conversation first; questions and
continuation second; preview and deliberate deployment third. The sections below
specify responsibilities, not a requirement to build every layer before trying a
complete path. Finish with documentation, deterministic checks, build isolation,
and the simplicity review.

## Implementation phases

### 1. Scaffold the package

- Read the relevant Next.js 16 documentation in `node_modules/next/dist/docs/` before writing code.
- Add `examples/white-label-minimal` as an npm workspace.
- Add root scripts for `minimal:dev`, `minimal:build`, and `minimal:typecheck`.
- Add the smallest valid Next.js configuration and one unstyled page.
- Confirm that the existing Sunny development and build commands are unchanged.

### 2. Implement the server-only Base44 client

Support only these operations:

- `createApp`
- `getApp`
- `getConversation`
- `sendMessage`
- `submitToolCallInput`
- `getPreviewUrl`
- `deployApp`
- `getPublishedUrl`

The module must:

- Read `BASE44_API_KEY`, `BASE44_ORG_ID`, and `BASE44_PLATFORM_HOST` only on the server.
- Send `X-Active-Workspace-Id` on applicable requests.
- Send `organization_id` when creating an app.
- Pass `initial_message` and `custom_instructions` in the create request.
- Use a longer timeout for create, message, tool submission, and deploy calls.
- Generate a stable `X-Request-ID` from the tool-call ID.
- Return small, actionable errors without leaking credentials or full upstream bodies.
- Never accept a host, workspace ID, or credential from the browser.

Use the existing Sunny platform route as behavioral reference, but rewrite the minimal path directly
instead of copying its service-user, ownership, folder, and compatibility concerns.

### 3. Add the closed local API route

- Accept a small JSON body containing an action and its required parameters.
- Validate action-specific strings, IDs, booleans, input objects, and pagination bounds; reject unexpected fields.
- Reject unknown actions before making an upstream request.
- Call the matching function in `base44-server.ts`.
- Keep route handling readable as one switch statement.
- Normalize errors in one place.

### 4. Add the browser client

- Export one function per supported action.
- Call only `/api/base44`.
- Parse successful and failed JSON responses consistently.
- Carry a small typed error with status and message only if the UI needs both.
- Do not mirror the entire upstream API or expose a generic arbitrary-path method.

### 5. Build the single-screen experience

The page should contain:

- A prompt field and submit button.
- A compact status indicator.
- The chronological conversation.
- Inline question controls when the agent pauses.
- A preview panel opened only on request.
- A deploy button and published link.

Behavior:

- The first prompt creates an app; later prompts update the same app.
- Poll quickly while the app is processing and slowly while it is idle.
- Stop polling after an error and surface a useful message.
- Refresh recent messages and backfill with newest-relative pagination as specified above.
- Disable the composer while a question is waiting.
- Support approval and rejection.
- Request a new preview URL whenever preview is opened or refreshed.
- Require an explicit user action before deployment.

Use plain CSS and semantic HTML. The UI should be pleasant enough to understand, but visual polish
must not obscure or enlarge the integration code.

### 6. Render agent questions

Implement the three documented `waiting_on.kind` values:

- `choice`: show the available options.
- `input`: show the requested fields.
- `approval`: show approve and reject actions.

Keep parsing and rendering together unless separating a pure parser measurably improves readability.
Unknown tool calls should render as a small expandable diagnostic block rather than disappear.

After a question is submitted, immediately refresh the app and conversation before normal polling
continues.

### 7. Add custom instructions

Keep the complete instruction string in `lib/base44/custom-instructions.ts`. It should explain only what a
generated app needs to know about the example platform and name any workspace skill it should use.

Pass it during app creation, because the initial build starts in that request. Read
`custom_instructions` from the returned app and log a server-side warning if Base44 silently omitted
it.

Do not add a Sunny data contract initially. That can be a separate follow-up example if the guide
needs to demonstrate generated apps calling back into a host platform.

### 8. Document setup and safety

The package README should include:

- A three-minute local setup path.
- The required environment variables.
- The one command used to run the example.
- A diagram showing `browser -> local API route -> Base44`.
- A warning that the shared account owns every created app.
- A warning not to expose this package as an unrestricted public deployment.
- A link to Sunny's service-user implementation for production multi-user tenancy.
- A guide-to-code table that points each documentation concept to one source file.

The root README should distinguish the two references:

- `src/`: full Sunny product and production-oriented service-user integration.
- `examples/white-label-minimal/`: focused, shared-account guide companion.

### 9. Verify behavior

Required checks:

- Typecheck the root package and the example package.
- Build the root package and the example package.
- Verify that unsupported actions never reach Base44.
- Verify that browser-provided host, workspace, and credential fields are ignored or rejected.
- Verify stable request IDs for tool-call submissions.
- Verify approval and rejection payloads.
- Verify no-store response headers, no request/response body logging, and preview URL disposal on close, refresh, and expiration.
- Verify that the existing Sunny package still starts and builds normally.

Add an optional live smoke script that runs only when Base44 environment variables are present. It
requires an explicit smoke command and may create an app, poll until the build settles, read the conversation, and request a preview. It
must not deploy by default.

### 10. Perform a simplicity review

Before considering the example complete, review it independently from functional correctness:

- Can a reader locate credential handling, app creation, polling, question submission, preview, and
  deployment in under a minute?
- Does every source file have one clear reason to exist?
- Can any wrapper, type, state variable, dependency, or comment be deleted without losing clarity or
  safety?
- Are guide terms used consistently in file names, function names, and UI copy?
- Are security rules visible at the exact points where mistakes would otherwise be easy?
- Does the README explain setup without requiring knowledge of the full Sunny codebase?

Prefer deleting code during this review. Do not add an abstraction merely to make the example look
architecturally complete.

## Definition of done

The example is complete when a new reader can:

1. Find the integration code immediately.
2. Configure three Base44 environment values.
3. Start the example with one command.
4. Create an app and watch the build progress.
5. Answer or reject an agent question.
6. Open a fresh preview.
7. Deploy deliberately and open the published app.
8. Explain why credentials stay server-side and why this shared-account example is not sufficient
   for an unrestricted multi-user production deployment.

The implementation should feel smaller than the guide, not like a second product hidden inside the
repository.

## Implementation notes

- `server-only` is the one additional runtime dependency: it makes accidental browser
  imports a build error. `tsx` and Playwright are development-only test tools.
- A polling hook and a conversation merge module exceed the initial source-file
  target by two TypeScript files, with focused responsibilities and deterministic
  tests. Component and module size targets remain intact.
- The preview URL uses `_preview_token`, verified against the public Base44 editor
  implementation on 2026-09-09; the API reference omits the transport parameter.
- The package README is the setup and operational reference. Automated tests use
  fixtures; live smoke remains an explicit opt-in with configured credentials.

## Verification results (2026-09-09)

- 18 deterministic server, conversation, and question-rendering checks passed.
- 8 Chromium browser checks passed against a production build, covering immutable
  retries, duplicate clicks, input/rejection payloads, preview refresh/expiry,
  deliberate deploy, uncertain creation, polling recovery/non-overlap, and the
  real Next.js local-origin boundary.
- Example typecheck, production build, and scoped ESLint passed.
- Root typecheck passed. Sunny built and served HTTP 200 with temporary test values
  for the missing NEXTAUTH_SECRET / Google auth configuration; no real sign-in
  or database operation was exercised.
- A copy outside the repository installed, typechecked, and built without Sunny,
  Prisma, or a configured environment file.
- Live Base44 smoke skipped because the example's three environment values are
  not configured. Real account access, billing, and live beta API behavior remain
  to be verified with that explicit smoke command. No real app was deployed.

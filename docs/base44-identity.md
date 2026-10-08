# One Base44 account behind the whole platform

How your platform authenticates to Base44, and whose job it is to keep your users apart. This is
step 2 of the [README](../README.md) walkthrough, in full. The canonical description is Base44's own:
[Tenancy and credentials](https://docs.base44.com/developers/white-label/tenancy-and-credentials).

Reference implementation: `src/lib/base44Config.ts` (where the credential lives),
`src/app/api/base44/platform/route.ts` (where it is used) and `src/lib/appOwnership.ts` (who built
what).

---

## The model

**One Base44 account sits behind your whole integration.** It owns every app your builders create,
and its personal access token authenticates every call you make.

Four parties, and only two of them exist on Base44's side:

| Role | Who | Where they exist |
| --- | --- | --- |
| Base44 | The execution harness: builds, previews, deploys | — |
| Your platform | Sign-in, tenancy, billing, UI | Your database |
| A **builder** | Your user, describing and building apps through your UI | **Your database only** |
| An **end user** | Someone using a published app without building | Your database, plus an app user Base44 provisions for the embed |

No Base44 identity exists for the builder at all. Base44 sees one account building everything, and
says so plainly: *keeping your builders apart is yours to enforce.* Scoping each builder to their
own apps, and hiding other builders' apps, is entirely up to you.

That is the whole design. Everything below is what follows from it.

---

## The credential

A **personal access token** for the integration account, sent as `Authorization: Bearer <token>` on
every Apps API call, together with the workspace:

```ts
headers: {
  Authorization: `Bearer ${accessToken()}`,   // WHO — always the integration account
  "X-Active-Workspace-Id": orgId(),           // WHERE — Base44 checks permissions against this
  "Content-Type": "application/json",
}
```

Three rules for the token:

- **Create it in your enterprise workspace**, not the account's personal workspace, or your builds
  miss the design system, skills and plan you set up there.
- **The account needs Editor or higher** in that workspace. Viewers and guests can't create apps,
  and deploy only succeeds for an Editor.
- **It is the most sensitive value you hold.** It can do anything the account can, to every app
  your platform has ever built. Server-only, never caller-supplied, never installed into a built app
  (`APP_SECRETS` is the allow-list for that, and it does not contain it).

It lands in env as `BASE44_ACCESS_TOKEN`, next to `BASE44_ORG_ID` (the workspace id),
and `BASE44_PLATFORM_HOST`. See `.env.example`.

There is no per-user token to mint, store, refresh or revoke, and no "Connect" step in the UI. The
builder is either configured on a deployment or it is not; `POST /api/base44/platform
{action:"status"}` answers which, from config alone.

### What the workspace key is still for

`BASE44_SVC_KEY`, the `b44k_` workspace API key, does **not** build apps. It is for the two things
only a workspace key can do: signing a viewer into an embedded app — provisioning an app user and
minting an embed sign-in token (`src/lib/embedSession.ts`) — and registering the outbound webhook
endpoint. It is optional: without it the builder still works, and embedded apps load signed out.

---

## Keeping builders apart

Since upstream every app has the same owner, "which apps are mine?" and "may I edit this app?" are
questions only your database can answer. In this repo the answer is `AppOwnership`: one row per
(app, builder), and `src/lib/appOwnership.ts` is the module that reads it for authorization.

The platform proxy enforces it in three places:

```
createApp          → create upstream, then recordOwnership(actor, app.id) — same request
listApps           → list the workspace upstream, keep only ids the caller owns
every other action → ownsApp(actor, appId) first; 404 otherwise, before any upstream call
```

The 404 is deliberate: the workspace is shared by every builder, and "that exists but isn't yours"
tells a caller more than "no such app". It is also the answer they would get for an id that was
never created, so the two cases stay indistinguishable.

Two rules make this hold:

**Ownership is written server-side, in the request that creates the app.** Never from the browser.
A client that could insert an `AppOwnership` row could claim any app in the workspace, so the generic
entity API lets a user read and delete their own rows ("forget this app") and refuses to create or
update one — `src/lib/entities.ts` marks every field read-only.

**Reads have no admin bypass.** Like `AppInstall`, ownership matches on the caller's own email. An
admin's My apps page shows their own apps, not everyone's. Reading another user's rows through an
admin session is one thing; handing them the controls of another user's app is another.

The same module answers for the embed and token routes (`/api/embed`, `/api/sunny/token`): an app
is reachable by its author *or* by someone who installed it, and nobody else.

### Apps with no row

An app in the workspace with no `AppOwnership` row — built before ownership was tracked, or in
Base44's own UI — is visible to nobody here, and no action reaches it. Recover one by
inserting its row for the right user.

---

## Lifecycle

```
set up      create the token in the enterprise workspace (Editor+) → env → deploy
            `status` answers 200 configured; the builder UI appears

build       browser → /api/base44/platform {action} → ownership check → Bearer <token> → Base44
            every app lands in the one account, in your workspace

offboard    delete the user's AppOwnership (and AppInstall, Widget) rows
            their apps stay in the account — reassign by inserting rows for someone else, or
            delete the apps upstream; nothing upstream needs to change for the *user*

rotate      create a new token, deploy it, revoke the old one
            no per-user state to migrate: every stored id is an app id, not a credential

401 upstream  the token was revoked or expired → 501 bridge_misconfigured, loudly logged
              a deployment problem, not something a user can fix by retrying
```

### Failure classes

| Failure | Meaning | Response |
| --- | --- | --- |
| Missing env var | Deployment isn't configured | `501 bridge_misconfigured`, before any call. The body never names the variable |
| Upstream `401` | Base44 refused the integration account's token | `501 bridge_misconfigured`, logged with the upstream detail. Same bucket, same UI state |
| Upstream `403` | The account's role — a non-Editor cannot deploy, a workspace isn't enabled for something | Passed through with the upstream detail |
| App-scoped call on an app the caller didn't build | Not theirs | `404 not_found`, before any upstream call |
| Network error, `5xx` | Upstream trouble | `502`, retry |

---

## Containment rules

What this repo holds itself to, asserted by `npm run base44:smoke`:

1. **The token is read in one place** (`accessToken()` in `src/lib/base44Config.ts`) and used in one
   place (the proxy's `send()`). No response body ever contains it, and no error body names the
   variable.
2. **Every app-scoped action checks ownership before upstream.** For every action in `APP_SCOPED`.
3. **`listApps` answers with the caller's apps only, wherever they sit in the workspace.**
4. **`AppOwnership` cannot be created or updated through the entity API.** Only the proxy writes it.
5. **A foreign app is a 404 even on an unconfigured deployment** — the ownership gate runs before
   config is read, so the two kinds of failure never blur.

## Notes for your own port

- The isolation lives entirely in your database. Whatever you call your ownership table, make it
  the *only* thing your proxy consults, check it before every upstream call, and never let a client
  write it.
- Give the platform a workspace of its own. Listing reads every app in it, so a workspace shared
  with other tools makes every listing larger, though ownership still hides their apps.
- Don't filter a single upstream page. The workspace is shared by your users, so one page of it can
  hold none of a user's apps while their older ones sit further down. This repo asks for one large
  page and keeps reading while pages come back full (`pageOwnedApps()`), and keeps the listing as
  the source rather than fetching each owned id, because the listing is what drops a trashed app.
- Offboarding a user does not touch Base44. Their apps remain in the account; what they lose is the
  rows that let them reach those apps through you.
- If you ever need per-user Base44 identities again — real accounts, with Base44 enforcing the
  split — that is a different model with a different set of endpoints, not a flag on this one.

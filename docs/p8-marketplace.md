# The app market

An app one person builds, another installs and runs against **their own** boards.

## Why this needed nothing new in the security layer

The hard part was already done. `/api/sunny` takes a viewer token
(`src/lib/appTokens.ts`), minted by the page embedding the app and handed to the frame
over `postMessage` (`src/lib/appFrameAuth.ts`). Its subject drives `scopedWhere()`, so
a market app — one deployment, one author, many installers — reads whoever is looking
at it. That is the whole reason a market is safe here, and none of it is in this
feature.

What was missing was only the catalogue: a way to find an app you did not build.

## An install is a `Widget` row

There is deliberately no separate install record. `/api/sunny/token` mints for an app
you have **pinned** or authored, so pinning is already the grant and unpinning is
already revocation. The market installs by pinning and counts installs by counting
rows.

A second grant concept beside it would mean two places to look when someone asks why
an app can read their boards, and two places to get it wrong. The cost is that
"installed" and "on my home page" are the same state — you cannot install without
pinning. That is a real limitation and the right trade for now.

## Publishing snapshots the app

`app_slug` / `app_url` / `screenshot_url` are captured at publish time, not resolved
when someone views the listing. Forced by the P5 gap: an installer's Base44 service
principal cannot see another user's app in the shared workspace, so at install and
render time nothing can ask the platform where the app lives.

Two consequences:

* **Publishing requires a deployed app.** The dialog says so, and the server refuses a
  listing with no URL. Installers load the deployed build; a preview sandbox is
  per-owner and boots on demand.
* **Listings go stale.** Re-publishing is what refreshes the snapshot.

## `app_slug` is a switch, not decoration

`DashboardWidgets` derives `https://preview--<slug>.…` when a widget has a slug,
because that address is stable across rebuilds while a stored sandbox URL is not.
Correct for an app you built; wrong for one you did not, since you have no slug you
can address.

So a market app is pinned with **`app_slug: null`** and carries its listing's snapshot
URL, and the widget falls back to that. Get this wrong and Home renders
`https://preview--demo-quick-capture.…` — a real Base44 host, which answers
`{"error_type":"HTTPException","message":"App not found"}` inside the frame. It looks
like a broken install; it is a URL built by a convention that does not cover the case.

## The one non-scoped read

`listPublished()` queries `MarketplaceListing` with no owner predicate. It is the first
such query in the codebase, so `npm run market:smoke` points 31 assertions at it, and
section 2 exists solely to fence it in: published rows cross owners, drafts and
delisted rows do not, a card carries no field beyond the declared shape, and every
write is still owner-only.

Three properties that are easy to get backwards, all asserted:

* **A listing grants nothing.** Browsing does not install; the token is refused until
  the app is pinned.
* **Delisting is discovery, not access.** Pulling a listing leaves existing installs
  working — cutting an app off is the installer's call. Otherwise an author could break
  everyone who came to depend on their app.
* **Install counts follow the pins**, so unpinning both decrements and revokes.

## Where you meet it

| | |
| --- | --- |
| **Market** in the top nav | the catalogue: Browse / Installed / Published by me |
| Home | an App market card with a live count, and *Build your own* |
| Add widget | links to the market and the builder |
| My Tools | a store icon on each app card publishes it |
| Market header | *Build an app* — the market is where you learn nobody built the thing you need |

## Seeing it on a local database

```bash
npx tsx --env-file=.env scripts/market-demo-seed.ts
```

Three listings authored by `demo-author@example.com`, so installing one is genuinely
installing another person's app — the case viewer tokens exist for:

| app | what it shows |
| --- | --- |
| Weekly report | reads across boards; resolves a status column by id, not by name |
| My week | finds date columns by *type* rather than assuming a field called "due" |
| Quick capture | writes — creates an item on the viewer's board, owned by the viewer |

They live in `public/market-demo/` and share `sunny-sdk.js`, which is the
`sunny:auth:request` handshake plus `Authorization: Bearer` on `/api/sunny`. A real
Base44 app would inline it. Everything else is the real path.

Remove with `--remove`, then delete `public/market-demo/` and the seed script.

## Changes to existing files, and why

* `src/lib/appFrameAuth.ts` — `originOf` now resolves against the current document. A
  relative `src` used to throw, leaving `appOrigin` null and the listener unattached,
  so the frame asked for a token and waited forever. Same-origin apps are legitimate.
* `src/lib/myWidgets.ts` — `addAppToMyWidgets(app, url)` takes an optional URL, because
  a market app's URL cannot be resolved through the platform.
* `src/components/dashboard/DashboardWidgets.jsx` — falls back to the stored
  `preview_url` when there is no slug.

## What is left

**Publish from chat.** The builder should offer to publish when an app is ready — a
tool widget with the assistant proposing the title and the one-liner. Wants P6's
`InvokeLLM`.

**A review gate.** Nothing stands between `publish` and `published`. Third-party code
holding a viewer token needs at minimum an admin approval step, per-token rate limits,
and an admin kill switch for a listing.

**Scopes.** An install is all-or-nothing: the app reads and writes everything the
viewer can. Per-action scopes would let a reporting widget be installed without write
access. That is a change to the token, not to the catalogue — `appTokens.ts` would
carry the grant and `/api/sunny` would check it per action.

**Installing without pinning.** Today they are the same act.

**Origin binding.** `appTokens.ts` records the `app` claim but does not enforce it, and
says so: a token that escaped one app would work in another. Binding it to the app's
origin and checking it against the request's `Origin` is the fix.

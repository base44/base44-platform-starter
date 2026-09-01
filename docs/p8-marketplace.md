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

## Installing is not pinning

The grant is an `AppInstall` row (`src/lib/appInstall.ts`). `/api/sunny/token` mints
for an app you have installed or authored, so installing is what lets an app read your
boards and uninstalling revokes.

It used to be the `Widget` row. That held while every app was one you built — pinning
it to Home was the only reason to have it — and broke as soon as apps come from a
market: *I want this app* and *I want it on my home page* are different intents, and
welding them meant an app you open monthly had to sit on Home to work at all. So the
grant moved, and `Widget` went back to meaning only what its name says.

The migration **backfills one install per already-pinned `(app, user)`**. Without it,
moving the predicate would revoke everyone at once.

Two directions, and only one of them holds:

* Unpinning is **not** uninstalling. Take it off Home, it still works in My Tools.
* Uninstalling **does** unpin. A widget with no grant behind it renders as a frame that
  cannot read anything, which reads as broken rather than as revoked — so `uninstall()`
  removes the widgets too.

`npm run market:smoke` asserts both, including that a pin alone grants nothing.

## Two surfaces list every app you can open

`src/lib/usableApps.ts` merges the two sources so **My Tools** and the **Add widget**
picker cannot disagree:

* apps you **built** — the Base44 folder, live, which is the truth for a slug, a
  screenshot and whether the app is deployed;
* apps you **installed** — the listing snapshot, because an installer's principal
  cannot see another user's app in the workspace at all.

Neither failing takes the other down: a Base44 outage should not hide your market apps.
Publishing and *Edit in builder* only appear on apps you built — an installed app is
somebody else's code and neither applies.

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

## Getting an app *into* the market

Three ways in, and the third is the one that matters:

* **Market → Publish an app** — a picker of the apps you built. This is where the
  question gets asked, so this is where the answer lives.
* **My Tools → Publish** on any app you built. Labelled, not a bare storefront glyph:
  an icon does not say "offer this to other people", and nobody hovers a control whose
  meaning they have not already guessed.
* **From the chat.** Opening the builder from the market passes `origin: "market"`, and
  the finished app's ready card offers **Add to the market** as its primary action —
  deploy, then the listing dialog.

That last one follows a pattern this codebase already had: `origin: "home-widget"`
makes the ready card offer *Add to my widgets*. **Where the builder was opened from is
already a statement of intent**, so it picks the destination instead of asking. Someone
who clicked "Build an app" inside the market is building it *for* the market.

It is a default, not a fork. The other destinations stay one click away, and nobody is
asked to choose up front — at the start of a build you do not yet know whether the app
is any good, which is the worst possible moment to be asked where to file it.

Note that "Publish" in the ready card already means `deployApp`. Hence **"Add to the
market"** for the listing, so the two are not the same word.

## "Apps", not "My Tools"

Half of what is on that page is not the user's — an installed app is someone else's
code they were granted the right to run — so the page is **Apps**. The route matches the
name: `/apps`, which `?app=` deep links from the builder and the widgets point at.

The two sources are a **filter**, not tabs: All · Built by me · From the market, with
counts, and a badge on every card. Opening an app is the common action and people do
not reliably remember whether they built the thing they are looking for, so *All* has
to be the default; the filter is for when you already know. Tabs would make the common
case a guess. (Hard tabs are a one-line change if that turns out to be wrong.)

The Add-widget picker **groups** instead — installed apps first, then yours, with
headers only when both are present. Where an app came from is a property of the group,
not of each row, and a badge repeated down eight rows says the same thing eight times.
Installed goes first because it is the shorter list and the newer idea: a picker that
opens on thirteen of your own apps buries the two you just installed.

## The market refreshes itself

The builder is a side panel over whatever page you were on, so you can publish an app
from the chat while looking straight at the market grid behind it — and the grid has no
reason to refetch. The only fix was a manual reload, which reads as "it didn't work".

`src/lib/marketEvents.ts` is a `market-changed` window event, the same shape as the
`widgets-updated` and `app-rebuilt` events this codebase already uses to coordinate
across surfaces. It is announced from **`PublishDialog`** rather than from each caller:
the builder, the Apps page and the market page all publish through that one component,
so a new caller gets the refresh for free instead of having to remember. Install and
uninstall announce it too.

The Apps page listens as well, so a card's *In market* marker is right without a
reload.

Related, and the same mistake in miniature: after listing an app the ready card used to
say *"Published — view in Apps"*, confirming a destination the user had not chosen. It
now says *"In the market — view it"*.

## Who can delist what

Only an author, and only their own listing. `unpublish()` scopes the update with
`ownerFields(actor)`, so another user's row is not merely hidden from the UI — it is
outside the `where`. The button renders only for `is_author`, and
`npm run market:smoke` asserts a non-author gets a 404.

That is the *author* half. The **platform** half — Sunday delisting somebody else's app
because it misbehaves — does not exist yet and is listed under What is left. The two
are different powers and should not be the same code path: `unpublish` is personal by
construction, and widening it would be the wrong way to build a kill switch.

## Card actions say what they do

Three glyphs were doing work no glyph can do:

* a **storefront icon** meant "offer this to everyone" — now a labelled *Publish*;
* a **grid icon** meant "put it on your home page" — now *Add to Home* / *On Home*;
* a **trash can** meant "revoke this app's access" — which is not deletion, and was in
  the wrong place besides.

Uninstall now lives on **Apps**, not in the market. A storefront is for getting things;
managing what you already have belongs next to the thing itself. That also makes the
two card kinds symmetrical: an app you built offers *Publish* and *Edit in builder*, an
app you installed offers *Uninstall*.

## Where you meet it

| | |
| --- | --- |
| **Market** in the top nav | the catalogue: Browse / Installed / Published by me |
| **Apps** in the top nav | everything you can open, filtered by source |
| Home | an App market card with a live count, and *Build your own* |
| Add widget | links to the market and the builder |
| Apps | a labelled *Publish* on each app you built |
| Market header | *Build an app* — the market is where you learn nobody built the thing you need |

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

**Origin binding.** `appTokens.ts` records the `app` claim but does not enforce it, and
says so: a token that escaped one app would work in another. Binding it to the app's
origin and checking it against the request's `Origin` is the fix.

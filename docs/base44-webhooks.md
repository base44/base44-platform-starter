# Inbound webhooks: letting Base44 tell you what happened

Boundary 5, and the only one where Base44 calls **in**.

Everything else in this repo is the shell calling out: provision a principal, mint a token, build an
app, list a folder. That works because the shell is the one taking the action. It stops working the
moment something changes on Base44's side without the shell asking — and the clearest case is
deletion. `listApps` is a poll: it costs a round trip per page load, it lags reality, and **it cannot
report a deletion at all**. A trashed app just stops appearing, which is indistinguishable from a
failed call. There is no version of polling that tells you *an app was deleted*; there is only a list
that used to have it.

Webhooks carry the transition itself.

## What you get

| Event | Meaning |
| --- | --- |
| `app.created.v1` | An app now exists in your workspace. |
| `app.published.v1` | A version went live. Carries `published_version`. |
| `app.unpublished.v1` | The live version was taken down. |
| `app.deleted.v1` | Moved to **trash** — see below. |
| `app.restored.v1` | Came back out of trash. |

Each payload carries `app_id`, `workspace_id`, `owner_id` and — the field that makes this useful —
`owner_service_external_id`. That is the same value this shell stores on
`Base44Link.serviceExternalId`, so an event joins straight back to a Sunny user with one indexed
lookup and no call to Base44. `emailForServiceExternalId()` is that join.

## `app.deleted.v1` is trash, not erasure

A deleted app is restorable for 30 days self-serve, and longer through support. **A receiver that
purges on this event is wrong for every app that comes back** — which is exactly why
`app.restored.v1` exists. This is the single most likely way to get an integration wrong, because
"deleted" reads as final and is not.

So the projection here sets `lifecycle = trashed` and keeps the row. Nothing about *Base44's* app is
forgotten, and a restore is a one-field update rather than a resurrection.

What does get removed is the shell's own — see [Acting on a deletion](#acting-on-a-deletion).

## Registering the endpoint

The receiver lives at `POST /api/base44/webhooks`. Registering is a **deploy-time** action, once per
environment:

```bash
npm run webhook:register -- --url https://your-shell.example.com
npm run webhook:register -- --url https://… --events app.deleted.v1,app.restored.v1
```

It registers, waits for the probe, reports `activated`, and then prints the workspace's public key as
a `BASE44_WEBHOOK_PUBLIC_KEYS=` line — the receiver requires it, see
[Verifying a delivery](#verifying-a-delivery). The order matters: **registering is what mints the
workspace's first signing key**, so there is nothing to copy before it runs, and on a first run the
activation probe cannot verify either. That leaves the endpoint pending, which is the expected first
result, not a failure to chase:

```bash
npm run webhook:register -- --url https://your-shell.example.com   # pending; prints the key
# deploy BASE44_WEBHOOK_PUBLIC_KEYS="whpk_…" to the receiver
npm run webhook:register -- --activate <endpoint id>               # re-probes the same endpoint
```

`--activate` re-sends the probe instead of registering again, which would leave a second endpoint
behind and count against the workspace's limit of ten.

`--events` (repeatable, comma- or space-separated; or `BASE44_WEBHOOK_EVENT_TYPES`) defaults to every
type the receiver handles. Narrowing it is the useful case, because the **subscription is what makes
Base44 write an outbox row at all** — an unselected type costs nothing rather than being delivered and
discarded. Unknown names pass through to the platform to accept or refuse, so a type added to Base44's
catalog after this script was written still works; the script warns instead about a type *it* has no
handler for, which the platform has no way to know.

It is a script rather than a route on purpose. A platform brings a workspace online once, and nothing
a user can trigger should be able to point Base44 at a different URL.

The same thing by hand, with the workspace API key (scope `outbound_webhooks:write`):

```bash
# The workspace key goes in Authorization — bare or `Bearer`-prefixed. This
# router takes workspace API keys only: a platform JWT here is a 401, not a
# fallback.
curl -X POST "$BASE44_PLATFORM_HOST/api/service/outbound-webhooks/endpoints" \
  -H "Authorization: Bearer $BASE44_WEBHOOK_KEY" \
  -H 'content-type: application/json' \
  -d '{
        "target_url": "https://your-shell.example.com/api/base44/webhooks",
        "description": "Sunny shell",
        "selected_event_types": [
          "app.created.v1", "app.published.v1", "app.unpublished.v1",
          "app.deleted.v1", "app.restored.v1"
        ]
      }'
```

Registration **probes the endpoint in the same call** and returns `201` whether or not activation
succeeded — so check the `activated` field in the response, never the status code.

Two things about the probe:

- It is a signed `webhook.test.v1`, and activation requires **echoing the `challenge` from the body
  back**. A bare 2xx is not enough. That is an anti-amplification control, not a formality: without
  the echo, anyone could register a URL they don't control and have Base44 deliver signed traffic to
  a third party who never agreed to anything. Echoing proves the receiver *read the body*.
- It bypasses the outbox, because an endpoint cannot activate through the delivery path it is trying
  to earn access to.

Changing `target_url` later returns the endpoint to `pending` and it must activate again.

**Your endpoint must be reachable on public HTTPS.** Base44 refuses private addresses, `localhost`
and its own domains, and never follows redirects — so a bare→www or trailing-slash hop reads as a
failed delivery, not a redirect. For local development, tunnel (`ngrok`, `cloudflared`) and register
the tunnel URL.

No new environment variables: the receiver derives the key-set URL from `BASE44_PLATFORM_HOST` and
`BASE44_ORG_ID`, which are already configured.

## Verifying a delivery

This is the whole security boundary. The URL is public, so **nothing** in a request is trustworthy
until the signature verifies — including `owner_service_external_id`, which decides whose rows get
touched. An unverified body is an attacker naming a victim.

Scheme: Standard Webhooks `v1a`, Ed25519. Base44 holds the private key and publishes the public half
at `GET /api/workspace/public/outbound-webhooks/{workspace_id}/keys`, unauthenticated. This shell only
ever holds public keys, so nothing here can forge an event.

```
signed payload = webhook-id + "." + webhook-timestamp + "." + <raw request body>
header         = webhook-signature: v1a,<base64>            (space-separated list)
```

Four ways to get this wrong, each of which breaks every signature:

1. **Re-serializing the body.** `JSON.parse` then `JSON.stringify` does not preserve key order or
   number formatting, so the bytes you verify stop being the bytes that were signed. Read the body
   once as text; verify that exact string. This is the most common failure by a wide margin.
2. **Signing only the body.** The id and timestamp are part of the payload. Binding the id is what
   stops a captured delivery being relabelled with a fresh id to slip past de-duplication.
3. **Parsing the header by equality.** It is a list. A key rotation sends two entries, and a receiver
   that only ever handled one breaks on the first rotation.
4. **base64url.** The wire format is *standard* base64 — it contains `+` and `/`.

### Where the keys come from

`BASE44_WEBHOOK_PUBLIC_KEYS`, and nowhere else. `npm run webhook:register` prints the `whpk_` keys
once; they are deployed like any other config, and verification is local — no network call on the
request path. A receiver that fetched the key set per delivery would spend part of Base44's 15s
budget on a second round trip, and could verify nothing whenever it could not reach the platform —
answering non-2xx and putting itself on the retry ladder for an outage that was not its own.

Unset, the receiver answers **500** and logs why. That is deliberate: the event is fine and this
deployment is not, so it stays on Base44's retry ladder until the key is deployed rather than being
refused as a forgery.

It is not a secret. It is a public key: it verifies signatures and cannot produce one, so it is the
single `BASE44_*` value whose leak costs nothing.

**Rotation is applied by hand.** `v1a` carries no key id, so Base44 rotates by publishing a second
key and signing with both through an overlap window — `valid_until` on the retiring one. Deploy the
new key alongside the old one inside that window (the variable takes a list), then drop the old one.
A receiver still holding only the retiring key stops verifying when it retires.

Signatures older than 300 seconds are refused even when they verify, which bounds replay of a
captured request to a window rather than forever.

`npm run webhook:smoke` drives all of that against a freshly minted keypair. The negative controls
are the point — a tampered body, a relabelled replay, an unknown key and a stale timestamp each have
to be refused, and refused for the stated reason. `fetch` is replaced with one that fails the suite,
so a verifier that quietly reached the network cannot pass. A key truncated by a bad paste has to
**throw**, and so does a missing one: a silently invalid key verifies nothing for ever, which looks
identical to every event being forged.

## Acting on a deletion

Recording the state is half of it. `src/lib/base44AppMirror.ts` is the other half: what the shell has
to change about *itself*, and how the owner finds out.

**Two kinds of row point at a Base44 app.** A `Widget` is a pin on somebody's dashboard; an
`AppOwnership` is the register `listAppsForUser` intersects the workspace folder against. Left in
place after a delete, the first renders an iframe of an app that is not there and the second keeps
claiming it. Both go.

**This is the part polling could not have done, and it is worth being precise about why.** A trashed
app drops out of `listApps`, so the apps list self-corrects on its own — eventually, and only because
the shell recomputes an intersection on every page load. A `Widget` row is not in that intersection.
It renders from its own stored `preview_url`, so nothing about a poll would ever reach it: it sits on
the dashboard indefinitely, framing an app that no longer exists.

**A restore puts the register back and deliberately does not put the pin back.** Without the
ownership row a restored app is invisible in the shell for ever, and no later event will fix that. A
dashboard pin is different — it is a placement its owner chose, a slot and a height and a width — and
inventing one back is worse than letting them re-add it. The notice says so.

**The name in the notice is the shell's, not the event's.** App lifecycle payloads carry identifiers
and timestamps and nothing a user authored, because an app named after a person would reclassify the
whole event stream as PII-bearing. So the receiver reads the last-known name off the rows it is about
to delete and keeps it on `Base44AppState.appName` — which is the only place a notice can honestly
get a name from, and why that column outlives the rows it came from.

**Removal is scoped by the RLS predicate, not by the event.** Every delete goes through
`src/lib/entityCrud.ts` with an actor built from the resolved owner, so a verified event can only
reach that one user's rows. The read and write paths in that file are unchanged; the mirror composes
what is already exported. An event whose `owner_service_external_id` belongs to no `Base44Link` — an
app built by another tool in the same workspace — removes nothing and raises no notice, which is an
ordinary answer rather than an error.

### Telling the user

A deletion happens while nobody is looking, so the notice waits on the app's state row:
`pendingNotice` plus `noticeAt`. `POST /api/base44/app-notices` hands the signed-in user theirs and
clears them in the same call — a compare-and-swap per notice, so two open tabs divide them rather
than each announcing all of them. It is a POST because reading a notice consumes it; a GET here would
be a cacheable mutation.

`src/components/AppNotices.tsx` claims on mount, whenever the tab becomes visible, and on a slow
timer. It sits inside `ToastProvider` above the pages, so a deletion reaches its owner on whatever
screen they are on — then fires three events for the pages already open. `widgets-updated`: the
dashboard re-reads, since its pin is gone. `APP_REMOVED`: the builder drawer and My apps drop the
card at once, and close it if it is the app on screen. `APPS_CHANGED`, for a deletion or a restore:
both read `listAppsForUser` again. That last one is what keeps an open list honest — a list is a copy
taken when the page loaded, and a restored app can only come back into view by being read again.

Losing a notice to a tab that closes mid-flight is accepted by design. A notice is a courtesy; the
removal it describes already happened and is durable. `GET /api/base44/webhooks` reports
`notices_unclaimed` — ordinary in ones and twos, and a number that only ever grows means the claim
path is broken rather than that users are ignoring it.

```bash
npm run webhook:projection:smoke   # needs a database, no dev server
```

Five properties, each a way to get this wrong: the removal captures the name before the rows go; a
notice is claimed exactly once; a restore rebuilds the register and not the pin; a replayed
`app.deleted` that a newer `app.restored` has superseded is dropped rather than re-applied; and an
unresolvable owner touches nothing.

## Delivery semantics you have to design for

**At-least-once.** Base44 retries every non-2xx and every timeout: 8 attempts over ~27h35m
(immediate, +5s, +5m, +30m, +2h, +5h, +10h, +10h), 15s timeout per attempt. A delivery whose response
was lost in flight arrives again with the same CloudEvents `id`. De-duplicate on that id — here, the
unique index on `base44_webhook_events.cloud_event_id`, which makes a redelivery a conflict rather
than a second projection.

**Order is not guaranteed.** A slow attempt 3 of an earlier event can land after attempt 1 of a later
one. Every apply is gated on the event's own `time` being newer than what the row already recorded,
so a stale `app.deleted` arriving after a fresh `app.restored` cannot re-trash a live app.

**Your status code is an instruction.** Non-2xx means retry, and enough consecutive failures
auto-pause the endpoint — at which point you stop receiving the events you *do* handle. So an event
type you don't care about gets a 2xx, not a 4xx. Return 4xx/5xx only when a retry could genuinely
help.

**Answer fast.** 15s is the whole budget. Record and return; anything slow belongs in a job the
receiver triggers.

## What this implementation deliberately leaves out

It is a reference receiver, not a finished product surface.

- **Only deletion and restore are acted on.** `app.created`, `app.published` and `app.unpublished`
  are recorded and nothing reads them. Published state in particular is still resolved live from
  Base44 wherever the UI needs it, so the projection is a second, weaker copy — useful for a
  dashboard, not something to switch a render path onto without deciding which one wins.
- **Only the owner's own rows are cleaned up.** A deleted app can still have a `MarketplaceListing`
  offering it and `AppInstall` rows granting other users access to it, and both survive. Those are
  other people's rows and a real product decision — does an installer get told, does a delisted
  listing come back on restore — rather than an oversight to fix in the same pass. A production
  deployment has to answer it; the shape to copy is the one here, routed through
  `src/lib/marketplace.ts` and `src/lib/appInstall.ts`, which own those models.
- **No replay of history.** Base44 does not send a newly registered endpoint the events it missed,
  and this receiver does not backfill. An app built before the endpoint existed has no state row
  until its next transition. Readers must treat a missing row as "nothing reported", never as
  "trashed". Deleting such an app is still handled correctly, though — the removal keys off the
  event's `app_id`, not off a state row that may not exist yet.
- **One crash window is left open on purpose.** The event id is claimed before the projection runs,
  so a crash in between leaves a row with `processed_at` null and the retry is rejected as a
  duplicate. That is a visible, queryable defect — `GET /api/base44/webhooks` counts them — where
  re-running a half-applied projection would be a silent one. A production deployment would either
  make the claim and the projection one transaction, or reconcile unprocessed rows on a schedule.
- **`x-base44-webhook-no-retry` is not honoured by Base44 yet.** It appears in the contract; the
  delivery path cannot read response headers today. Don't build on it.
- **No alerting.** `unprocessed > 0` for more than a few minutes is the signal worth paging on.

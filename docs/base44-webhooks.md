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

So the projection here sets `lifecycle = trashed` and keeps the row. Nothing is deleted, and a
restore is a one-field update rather than a resurrection.

## Registering the endpoint

The receiver lives at `POST /api/base44/webhooks`. Register it against your workspace with the
workspace API key (scope `outbound_webhooks:write`):

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

`v1a` carries no key id, so a rotated key is indistinguishable from a forgery until you refetch. The
verifier caches the key set for five minutes and refetches **once** on a mismatch; that refetch is
the documented recovery path, not an optimisation.

Signatures older than 300 seconds are refused even when they verify, which bounds replay of a
captured request to a window rather than forever.

`npm run webhook:smoke` drives all of that against a freshly minted keypair. The negative controls
are the point — a tampered body, a relabelled replay, an unknown key and a stale timestamp each have
to be refused, and refused for the stated reason.

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

- **The projection is not wired into the UI.** `Base44AppState` records that an app is trashed, and
  `GET /api/base44/webhooks` reports the count, but no screen reads it. Hiding a trashed app's
  widgets would mean changing the `Widget` read path in `src/lib/entityCrud.ts` — the RLS chokepoint
  and, per `CLAUDE.md`, the single biggest correctness risk in this repo. That belongs in its own
  change, reviewed on its own terms. `trashedAppIds(ownerEmail)` in
  `src/lib/base44WebhookEvents.ts` is the query it would use, and it encodes the trap: a *missing*
  row means "nothing reported", never "trashed".
- **No replay of history.** Base44 does not send a newly registered endpoint the events it missed,
  and this receiver does not backfill. An app built before the endpoint existed has no state row
  until its next transition. Readers must treat a missing row as "nothing reported", never as
  "trashed".
- **One crash window is left open on purpose.** The event id is claimed before the projection runs,
  so a crash in between leaves a row with `processed_at` null and the retry is rejected as a
  duplicate. That is a visible, queryable defect — `GET /api/base44/webhooks` counts them — where
  re-running a half-applied projection would be a silent one. A production deployment would either
  make the claim and the projection one transaction, or reconcile unprocessed rows on a schedule.
- **`x-base44-webhook-no-retry` is not honoured by Base44 yet.** It appears in the contract; the
  delivery path cannot read response headers today. Don't build on it.
- **No alerting.** `unprocessed > 0` for more than a few minutes is the signal worth paging on.

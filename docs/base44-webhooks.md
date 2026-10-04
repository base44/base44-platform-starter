# Inbound webhooks: letting Base44 tell you what happened

Boundary 5, and the only one where Base44 calls **in**. It exists for deletion: `listApps` cannot
report one, and a dashboard pin renders from its own stored URL, so without the event a pin frames a
deleted app indefinitely.

## What the receiver does

`POST /api/base44/webhooks` (`src/app/api/base44/webhooks/route.ts`):

1. Verifies the signature (`src/lib/base44WebhookSignature.ts`). Nothing else runs before this.
2. Checks the event's `source` is this deployment's workspace.
3. Echoes the `challenge` for `webhook.test.v1` — that is how the endpoint activates.
4. On `app.deleted.v1`, maps `owner_service_external_id` to a Sunny user via
   `emailForServiceExternalId()` and deletes that user's `Widget` rows for the app.
5. Answers 2xx to everything else.

It keeps no state. Deleting pins is idempotent, so a redelivery is harmless, and a restore never puts
pins back, so a late `app.deleted` arriving after an `app.restored` leaves the same result as one
that arrived on time.

`app.deleted.v1` is **trash**, restorable for 30 days. The receiver leaves `AppOwnership` alone: a
trashed app already drops out of `listApps`, and a restored one reappears there by itself.

## Registering the endpoint

Once per environment, with a workspace key that has `outbound_webhooks:write`:

```bash
npm run webhook:register -- --url https://your-shell.example.com
```

It subscribes to `app.deleted.v1`, registers, and prints `BASE44_WEBHOOK_PUBLIC_KEYS`. Registering is
what mints the workspace's first signing key, so on a first run the activation probe cannot verify
and the endpoint stays pending. Deploy the printed key, then:

```bash
npm run webhook:register -- --activate <endpoint id>
```

Check `activated` in the output, not the HTTP status — registration returns 201 either way.

The endpoint must be public HTTPS. Base44 refuses `localhost` and private addresses and never
follows redirects. For local development, tunnel (`ngrok`, `cloudflared`).

## Verifying a delivery

Standard Webhooks `v1a`, Ed25519:

```
signed payload = webhook-id + "." + webhook-timestamp + "." + <raw request body>
header         = webhook-signature: v1a,<base64> [v1a,<base64> ...]
```

- Verify the body text as received. `JSON.parse` + `JSON.stringify` changes the bytes.
- The header is a list — two entries during a key rotation.
- Standard base64, not base64url.
- Timestamps older than 300 seconds are refused.

Keys come from `BASE44_WEBHOOK_PUBLIC_KEYS` only, so verification makes no network call. Missing or
malformed, the receiver answers 500 and the event stays on Base44's retry ladder. On a rotation,
deploy the new key alongside the old one inside the overlap window, then drop the old one.

`npm run webhook:smoke` covers the negative cases: tampered body, relabelled id, unknown key, stale
timestamp, truncated key.

## Delivery semantics

- **At least once.** 8 attempts over ~27h35m, 15s timeout each.
- **No ordering guarantee.** A retry of an earlier event can land after a later one.
- **Status codes are instructions.** Non-2xx is retried, and enough failures auto-pause the endpoint
  — so unhandled event types get 2xx.
- **No history replay.** A newly registered endpoint receives only new events.

## Not handled

- **Other users' rows.** A deleted app can still have a `MarketplaceListing` and `AppInstall` rows
  granting others access. Whether installers are told, and whether a listing returns on restore, is
  a product decision.
- **Telling the owner.** The pin just disappears on the next dashboard load.

/**
 * Inbound Base44 webhooks, verified by `@base44/platform/server`.
 *
 * Nothing in a request is trustworthy until the SDK verifies it — the URL is
 * public. It checks Standard Webhooks `v1a` (Ed25519) over the raw body, against
 * the keys pinned in BASE44_WEBHOOK_PUBLIC_KEYS and nothing else, so it makes no
 * network call. It parses nothing before the signature passes.
 *
 * Built per call, not cached: the SDK reads its keys once, at construction, and
 * building it is cheap. Throws MissingConfigError when a required env var is
 * unset, and the SDK throws WebhookConfigurationError for a malformed key.
 * Both mean nothing can be verified, so the receiver answers 500 and Base44
 * retries.
 */

import { Base44PlatformServer, type WebhooksModule } from "@base44/platform/server";

import { platformHost, svcKey, webhookPublicKeys } from "@/lib/base44Config";

export function base44Webhooks(): WebhooksModule {
  // The workspace key and host are required by the client, though receiving webhooks uses neither.
  return new Base44PlatformServer({
    serverUrl: platformHost(),
    apiKey: svcKey(),
    webhooks: { publicKeys: webhookPublicKeys() },
  }).webhooks;
}

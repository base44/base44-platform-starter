/**
 * Inbound Base44 webhooks, verified by `@base44/platform/server`.
 *
 * Nothing in a request is trustworthy until the SDK verifies it — the URL is
 * public. It checks Standard Webhooks `v1a` (Ed25519) over the raw body, against
 * the keys pinned in BASE44_WEBHOOK_PUBLIC_KEYS and nothing else, so it makes no
 * network call. It parses nothing before the signature passes.
 */

import { createPlatformServer, type VerifyEventOptions } from "@base44/platform/server";

import { webhookPublicKeys } from "@/lib/base44Config";

export const webhooks = createPlatformServer().webhooks;

/**
 * Read per call, so a rotated key deploys without a code change. Throws
 * MissingConfigError when the keys are unset, and the SDK throws
 * WebhookConfigurationError for a malformed one. Both mean nothing can be
 * verified, so the receiver answers 500 and Base44 retries.
 */
export function verifyOptions(): VerifyEventOptions {
  return { publicKeys: webhookPublicKeys() };
}

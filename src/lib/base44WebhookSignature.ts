/**
 * Verifies the Ed25519 signature on an inbound Base44 webhook.
 *
 * This is the whole security boundary for the endpoint. Anyone on the internet
 * can POST to a webhook URL, so nothing about a request is trustworthy until it
 * verifies here: not the event type, not the app id, and above all not the
 * `owner_service_external_id` the reconciler uses to decide *whose* rows to
 * touch. An unverified body is an attacker naming a victim.
 *
 * The scheme is Standard Webhooks `v1a` (asymmetric). Base44 signs with a
 * private key held in its workspace keyring and publishes the public half; we
 * only ever hold public keys, so a leak of this deployment's disk cannot be used
 * to forge events to anyone — including us.
 *
 * Three details are easy to get wrong and each one silently breaks every
 * signature:
 *
 *   1. **The signature covers the raw bytes.** Never `JSON.parse` and
 *      re-serialize before verifying: key order and number formatting are not
 *      preserved, so the bytes you hash stop being the bytes that were signed.
 *      The route reads `await request.text()` once and passes that string here.
 *   2. **The signed payload includes the id and timestamp**, not just the body:
 *      `webhook-id + "." + webhook-timestamp + "." + body`. Binding the id is
 *      what stops a captured delivery being replayed under a different event id
 *      to defeat de-duplication.
 *   3. **The header is a space-separated list**, one `v1a,<base64>` entry per
 *      active key. During a key rotation Base44 sends two, and a receiver that
 *      parsed the header by equality rather than by splitting breaks on the
 *      first rotation.
 */

import crypto from "node:crypto";

import { orgId, platformHost } from "@/lib/base44Config";

export const MESSAGE_ID_HEADER = "webhook-id";
export const TIMESTAMP_HEADER = "webhook-timestamp";
export const SIGNATURE_HEADER = "webhook-signature";

const SIGNATURE_SCHEME = "v1a";
const PUBLIC_KEY_PREFIX = "whpk_";

/**
 * Matches Base44's own tolerance. A signature older than this is refused even
 * when it verifies, which is what bounds replay of a captured request to a
 * window rather than forever.
 */
const TOLERANCE_SECONDS = 300;

/**
 * Ed25519 public keys arrive as the 32 raw bytes; Node wants a DER SPKI
 * document. This is the fixed 12-byte SPKI header for Ed25519, so the DER is
 * just this prefix followed by the key.
 */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Public key sets are small and change only on rotation. */
const KEY_SET_TTL_MS = 5 * 60 * 1000;

export type VerificationFailure =
  | "missing_headers"
  | "malformed_timestamp"
  | "timestamp_outside_tolerance"
  | "no_signature_entries"
  | "no_published_keys"
  | "signature_mismatch";

export type VerificationResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: VerificationFailure };

type PublishedKey = { kid: string; public_key: string; algorithm: string };

let cache: { keys: crypto.KeyObject[]; at: number } | null = null;

function keySetUrl(): string {
  return `${platformHost()}/api/workspace/public/outbound-webhooks/${orgId()}/keys`;
}

/**
 * The workspace's active public keys, newest fetch cached briefly.
 *
 * Unauthenticated by design on Base44's side — a public key is public — so this
 * needs no credential and is safe to call on a request path. `force` skips the
 * cache: `v1a` carries no key id, so the only way to tell "rotated" from
 * "forged" is to refetch once on a mismatch, which is the documented recovery.
 */
async function publishedKeys(force = false): Promise<crypto.KeyObject[]> {
  if (!force && cache && Date.now() - cache.at < KEY_SET_TTL_MS) return cache.keys;

  const response = await fetch(keySetUrl(), { cache: "no-store" });
  if (!response.ok) {
    // Leave a stale cache in place rather than failing closed on a blip: the
    // keys we already hold are still the right ones for an in-flight delivery.
    if (cache) return cache.keys;
    throw new Error(`Base44 key set returned ${response.status}`);
  }

  const body = (await response.json()) as { keys?: PublishedKey[] };
  const keys = (body.keys ?? [])
    .filter((key) => key.algorithm === "ed25519_v1" && key.public_key.startsWith(PUBLIC_KEY_PREFIX))
    .map((key) =>
      crypto.createPublicKey({
        key: Buffer.concat([
          SPKI_PREFIX,
          // Standard base64, not base64url — the wire format contains + and /.
          Buffer.from(key.public_key.slice(PUBLIC_KEY_PREFIX.length), "base64"),
        ]),
        format: "der",
        type: "spki",
      }),
    );

  cache = { keys, at: Date.now() };
  return keys;
}

/** Every `v1a` signature in the header, decoded. Other schemes are ignored. */
function signatures(header: string): Buffer[] {
  const decoded: Buffer[] = [];
  for (const entry of header.split(" ")) {
    const [scheme, encoded] = entry.split(",");
    if (scheme === SIGNATURE_SCHEME && encoded) decoded.push(Buffer.from(encoded, "base64"));
  }
  return decoded;
}

function verifiesAgainstAny(
  payload: Buffer,
  entries: Buffer[],
  keys: crypto.KeyObject[],
): boolean {
  // Any signature against any key: the header carries no key id, so a rotation
  // is a second entry and either may be the one this receiver knows about.
  return entries.some((signature) =>
    keys.some((key) => crypto.verify(null, payload, key, signature)),
  );
}

/**
 * True only if `rawBody` is byte-for-byte what Base44 signed, recently.
 *
 * `rawBody` must be the exact request body as received — see the note on
 * re-serialization at the top of this file.
 */
export async function verifyWebhook(
  headers: Headers,
  rawBody: string,
): Promise<VerificationResult> {
  const messageId = headers.get(MESSAGE_ID_HEADER);
  const timestamp = headers.get(TIMESTAMP_HEADER);
  const signature = headers.get(SIGNATURE_HEADER);
  if (!messageId || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const issuedAt = Number(timestamp);
  if (!Number.isInteger(issuedAt)) return { ok: false, reason: "malformed_timestamp" };
  if (Math.abs(Math.floor(Date.now() / 1000) - issuedAt) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp_outside_tolerance" };
  }

  const entries = signatures(signature);
  if (entries.length === 0) return { ok: false, reason: "no_signature_entries" };

  const payload = Buffer.concat([
    Buffer.from(`${messageId}.${issuedAt}.`, "utf8"),
    Buffer.from(rawBody, "utf8"),
  ]);

  if (verifiesAgainstAny(payload, entries, await publishedKeys())) {
    return { ok: true, messageId };
  }
  // Refetch once: a key rotated since the cache was filled looks exactly like a
  // bad signature until the new key is in hand.
  const rotated = await publishedKeys(true);
  if (rotated.length === 0) return { ok: false, reason: "no_published_keys" };
  if (verifiesAgainstAny(payload, entries, rotated)) return { ok: true, messageId };

  return { ok: false, reason: "signature_mismatch" };
}

/** Test seam: drops the cached key set so a rotation is picked up immediately. */
export function resetKeySetCache(): void {
  cache = null;
}

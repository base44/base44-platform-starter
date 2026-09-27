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
 *
 * ## Where the public keys come from
 *
 * `BASE44_WEBHOOK_PUBLIC_KEYS`, and nowhere else. `npm run webhook:register`
 * prints the workspace's keys once; they are deployed like any other config, so
 * verification is local and makes no network call. A receiver that fetched keys
 * on the request path would spend Base44's 15s delivery budget on a second
 * round trip, and could verify nothing whenever the platform was unreachable.
 *
 * `v1a` carries no key id, so Base44 rotates by publishing a second key and
 * signing with both for an overlap window. The variable takes a list for that:
 * pin the new key alongside the old one inside the window, then drop the old one.
 */

import crypto from "node:crypto";

import { webhookPublicKeys } from "@/lib/base44Config";

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

/** Ed25519 public keys are exactly this long; a shorter one is a bad paste. */
const ED25519_KEY_BYTES = 32;

export type VerificationFailure =
  | "missing_headers"
  | "malformed_timestamp"
  | "timestamp_outside_tolerance"
  | "no_signature_entries"
  | "signature_mismatch";

export type VerificationResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: VerificationFailure };

function toKeyObject(wire: string): crypto.KeyObject {
  if (!wire.startsWith(PUBLIC_KEY_PREFIX)) {
    throw new Error(`Base44 public key must start with ${PUBLIC_KEY_PREFIX}: got "${wire.slice(0, 12)}…"`);
  }
  // Standard base64, not base64url — the wire format contains + and /.
  const raw = Buffer.from(wire.slice(PUBLIC_KEY_PREFIX.length), "base64");
  if (raw.length !== ED25519_KEY_BYTES) {
    // Caught here rather than left to crypto's DER error, because the usual
    // cause is a key truncated by a copy-paste and the DER message says nothing
    // about that. A key that is silently wrong verifies nothing, for ever.
    throw new Error(
      `Base44 public key decoded to ${raw.length} bytes, expected ${ED25519_KEY_BYTES}`,
    );
  }
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

/**
 * The pinned keys, parsed. Throws when none are set (`MissingConfigError`) or one
 * is malformed: a receiver that silently verified nothing would read, from the
 * outside, exactly like every delivery being forged.
 */
function verificationKeys(): crypto.KeyObject[] {
  return webhookPublicKeys().map(toKeyObject);
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
export function verifyWebhook(headers: Headers, rawBody: string): VerificationResult {
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

  return verifiesAgainstAny(payload, entries, verificationKeys())
    ? { ok: true, messageId }
    : { ok: false, reason: "signature_mismatch" };
}

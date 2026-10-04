/**
 * Verifies an inbound Base44 webhook: Standard Webhooks `v1a`, Ed25519.
 *
 * Nothing in a request is trustworthy until this returns ok — the URL is public.
 * Verify the raw body text, never a re-serialized one: the signature covers the
 * exact bytes. The header is a list, one entry per active key during a rotation.
 */

import crypto from "node:crypto";

import { webhookPublicKeys } from "@/lib/base44Config";

const TOLERANCE_SECONDS = 300;
// DER SPKI header for a raw 32-byte Ed25519 public key.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type VerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing_headers" | "timestamp_outside_tolerance" | "no_signature_entries" | "signature_mismatch";
    };

function toKey(wire: string): crypto.KeyObject {
  const raw = Buffer.from(wire.replace(/^whpk_/, ""), "base64");
  // A truncated paste must throw: a silently wrong key reads as every event being forged.
  if (raw.length !== 32) throw new Error(`Base44 public key decoded to ${raw.length} bytes, expected 32`);
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

/** Throws when BASE44_WEBHOOK_PUBLIC_KEYS is missing or malformed — answer 500 so Base44 retries. */
export function verifyWebhook(headers: Headers, rawBody: string): VerificationResult {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const header = headers.get("webhook-signature");
  if (!id || !timestamp || !header) return { ok: false, reason: "missing_headers" };
  // Negated so a non-numeric timestamp (NaN) is refused too.
  if (!(Math.abs(Date.now() / 1000 - Number(timestamp)) <= TOLERANCE_SECONDS)) {
    return { ok: false, reason: "timestamp_outside_tolerance" };
  }

  const signatures = header
    .split(" ")
    .filter((entry) => entry.startsWith("v1a,"))
    .map((entry) => Buffer.from(entry.slice(4), "base64"));
  if (signatures.length === 0) return { ok: false, reason: "no_signature_entries" };

  const keys = webhookPublicKeys().map(toKey);
  const payload = Buffer.from(`${id}.${timestamp}.${rawBody}`, "utf8");
  const verified = signatures.some((signature) => keys.some((key) => crypto.verify(null, payload, key, signature)));
  return verified ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}

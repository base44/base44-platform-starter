/**
 * Boundary 5: the inbound webhook signature, case by case.
 *
 *   npm run webhook:smoke
 *
 * Unlike the other smoke suites this one needs no dev server and no database:
 * it mints its own Ed25519 keypair, stubs the key-set fetch, and drives
 * `verifyWebhook` directly. So it is safe to run anywhere, and it is the check
 * worth running after touching anything in src/lib/base44WebhookSignature.ts.
 *
 * The negative controls are the point. "A genuine signature verifies" passes
 * just as happily against a verifier that returns true unconditionally — what
 * makes the suite mean something is that a tampered body, a relabelled event id,
 * an unknown key and a stale timestamp are each refused, and refused for the
 * stated reason.
 */

import crypto from "node:crypto";

import { orgId, platformHost } from "../src/lib/base44Config";
import { resetKeySetCache, verifyWebhook } from "../src/lib/base44WebhookSignature";

const KEYS_URL = `${platformHost()}/api/workspace/public/outbound-webhooks/${orgId()}/keys`;

type Signer = { privateKey: crypto.KeyObject; wire: string };

function mint(): Signer {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  // Base44's wire format is whpk_ + STANDARD base64 of the 32 raw bytes; the
  // DER SPKI document Node exports carries a fixed 12-byte header first.
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  return { privateKey, wire: `whpk_${raw.toString("base64")}` };
}

const known = mint();
const stranger = mint();

let published: Signer[] = [known];
let fetches = 0;

globalThis.fetch = (async (url: string | URL) => {
  fetches += 1;
  if (String(url) !== KEYS_URL) throw new Error(`unexpected fetch: ${url}`);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      signature_scheme: "v1a",
      keys: published.map((signer, i) => ({
        kid: `whk_${i + 1}`,
        public_key: signer.wire,
        algorithm: "ed25519_v1",
      })),
    }),
  };
}) as unknown as typeof fetch;

const BODY = JSON.stringify({
  specversion: "1.0",
  id: "evt_smoke",
  type: "app.created.v1",
  source: `https://base44.com/workspaces/${orgId()}`,
  time: new Date().toISOString(),
  datacontenttype: "application/json",
  data: { app_id: "6aa1000000000000000000aa", workspace_id: orgId() },
});

function signedHeaders(
  opts: { id?: string; ts?: number; signers?: Signer[]; scheme?: string } = {},
): Headers {
  const id = opts.id ?? "evt_smoke";
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const payload = Buffer.concat([
    Buffer.from(`${id}.${ts}.`, "utf8"),
    Buffer.from(BODY, "utf8"),
  ]);
  const entries = (opts.signers ?? [known]).map(
    (signer) =>
      `${opts.scheme ?? "v1a"},${crypto.sign(null, payload, signer.privateKey).toString("base64")}`,
  );
  return new Headers({
    "webhook-id": id,
    "webhook-timestamp": String(ts),
    "webhook-signature": entries.join(" "),
  });
}

let failed = 0;

async function expect(name: string, want: true | string, headers: Headers, body = BODY) {
  const result = await verifyWebhook(headers, body);
  const got = result.ok ? "ok" : result.reason;
  const pass = want === true ? result.ok : got === want;
  if (!pass) failed += 1;
  console.log(`${pass ? "  ok  " : " FAIL "} ${name} -> ${got}`);
}

async function main() {
  console.log("boundary 5: inbound webhook signature\n");

  await expect("a genuine signature verifies", true, signedHeaders());

  await expect(
    "a tampered body is refused",
    "signature_mismatch",
    signedHeaders(),
    BODY.replace("app.created", "app.deleted"),
  );

  // The replay that binding the event id into the signature exists to stop:
  // relabel a captured delivery so it reads as a new event to de-duplication.
  const relabelled = new Headers(signedHeaders({ id: "evt_captured" }));
  relabelled.set("webhook-id", "evt_replayed");
  await expect("a relabelled replay is refused", "signature_mismatch", relabelled);

  await expect(
    "a signature from an unpublished key is refused",
    "signature_mismatch",
    signedHeaders({ signers: [stranger] }),
  );

  await expect(
    "a stale timestamp is refused even though it verifies",
    "timestamp_outside_tolerance",
    signedHeaders({ ts: Math.floor(Date.now() / 1000) - 400 }),
  );

  await expect(
    "missing headers are refused",
    "missing_headers",
    new Headers({ "webhook-id": "evt_smoke" }),
  );

  await expect(
    "an unknown signature scheme is refused",
    "no_signature_entries",
    signedHeaders({ scheme: "v1" }),
  );

  await expect(
    "a rotation header with two entries verifies on the known key",
    true,
    signedHeaders({ signers: [stranger, known] }),
  );

  // Rotation must not strand a receiver holding a cached key set: `v1a` carries
  // no key id, so a rotated key is indistinguishable from a forgery until the
  // set is refetched once.
  resetKeySetCache();
  await verifyWebhook(signedHeaders(), BODY);
  published = [stranger];
  const before = fetches;
  await expect(
    "a key rotated after the cache was filled verifies after one refetch",
    true,
    signedHeaders({ signers: [stranger] }),
  );
  if (fetches - before !== 1) {
    failed += 1;
    console.log(` FAIL expected exactly one refetch, saw ${fetches - before}`);
  }

  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();

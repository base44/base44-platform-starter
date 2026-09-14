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
 *
 * Both key sources are covered, and the fetch counter is what proves the pinned
 * one: a pinned deployment that quietly still reached the network would pass
 * every correctness assertion while keeping the runtime dependency pinning
 * exists to remove.
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

  // --- pinned keys: the same verifier, with no network at all ---------------
  resetKeySetCache();
  process.env.BASE44_WEBHOOK_PUBLIC_KEYS = known.wire;
  let pinnedFetches = fetches;
  await expect("a pinned key verifies a genuine signature", true, signedHeaders());
  if (fetches !== pinnedFetches) {
    failed += 1;
    console.log(" FAIL pinned verification still fetched the key set");
  }

  // The refetch-on-mismatch path must NOT run when pinned: there is no newer
  // answer, and reaching for one would restore the dependency.
  pinnedFetches = fetches;
  await expect(
    "a pinned key refuses a signature it does not cover",
    "signature_mismatch",
    signedHeaders({ signers: [stranger] }),
  );
  if (fetches !== pinnedFetches) {
    failed += 1;
    console.log(" FAIL a pinned mismatch refetched the key set");
  }

  // Two pinned keys is how a rotation is survived without a redeploy mid-window.
  process.env.BASE44_WEBHOOK_PUBLIC_KEYS = `${stranger.wire} ${known.wire}`;
  await expect("both keys of a pinned rotation verify", true, signedHeaders());

  // A key truncated by a copy-paste must fail loudly. Silently verifying
  // nothing would look exactly like every event being forged.
  process.env.BASE44_WEBHOOK_PUBLIC_KEYS = known.wire.slice(0, -8);
  let threw = false;
  try {
    await verifyWebhook(signedHeaders(), BODY);
  } catch {
    threw = true;
  }
  console.log(`${threw ? "  ok  " : " FAIL "} a truncated pinned key throws rather than verifying nothing`);
  if (!threw) failed += 1;

  delete process.env.BASE44_WEBHOOK_PUBLIC_KEYS;

  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();

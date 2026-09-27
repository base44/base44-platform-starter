/**
 * Boundary 5: the inbound webhook signature, case by case.
 *
 *   npm run webhook:smoke
 *
 * Unlike the other smoke suites this one needs no dev server and no database:
 * it mints its own Ed25519 keypair, pins its public half, and drives
 * `verifyWebhook` directly. So it is safe to run anywhere, and it is the check
 * worth running after touching anything in src/lib/base44WebhookSignature.ts.
 *
 * The negative controls are the point. "A genuine signature verifies" passes
 * just as happily against a verifier that returns true unconditionally — what
 * makes the suite mean something is that a tampered body, a relabelled event id,
 * an unknown key and a stale timestamp are each refused, and refused for the
 * stated reason.
 *
 * `fetch` is replaced with one that fails the suite: verification is local by
 * design, and a verifier that quietly reached the network would pass every
 * correctness assertion while bringing back a request-path dependency.
 */

import crypto from "node:crypto";

import { MissingConfigError, orgId } from "../src/lib/base44Config";
import { verifyWebhook } from "../src/lib/base44WebhookSignature";

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

process.env.BASE44_WEBHOOK_PUBLIC_KEYS = known.wire;

let fetches = 0;
globalThis.fetch = (async () => {
  fetches += 1;
  throw new Error("verification made a network call");
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

function expect(name: string, want: true | string, headers: Headers, body = BODY) {
  const result = verifyWebhook(headers, body);
  const got = result.ok ? "ok" : result.reason;
  const pass = want === true ? result.ok : got === want;
  if (!pass) failed += 1;
  console.log(`${pass ? "  ok  " : " FAIL "} ${name} -> ${got}`);
}

function throws(name: string, run: () => unknown, match: (err: unknown) => boolean = () => true) {
  let pass = false;
  try {
    run();
  } catch (err) {
    pass = match(err);
  }
  if (!pass) failed += 1;
  console.log(`${pass ? "  ok  " : " FAIL "} ${name}`);
}

function main() {
  console.log("boundary 5: inbound webhook signature\n");

  expect("a genuine signature verifies", true, signedHeaders());

  expect(
    "a tampered body is refused",
    "signature_mismatch",
    signedHeaders(),
    BODY.replace("app.created", "app.deleted"),
  );

  // The replay that binding the event id into the signature exists to stop:
  // relabel a captured delivery so it reads as a new event to de-duplication.
  const relabelled = new Headers(signedHeaders({ id: "evt_captured" }));
  relabelled.set("webhook-id", "evt_replayed");
  expect("a relabelled replay is refused", "signature_mismatch", relabelled);

  expect(
    "a signature from an unpinned key is refused",
    "signature_mismatch",
    signedHeaders({ signers: [stranger] }),
  );

  expect(
    "a stale timestamp is refused even though it verifies",
    "timestamp_outside_tolerance",
    signedHeaders({ ts: Math.floor(Date.now() / 1000) - 400 }),
  );

  expect(
    "missing headers are refused",
    "missing_headers",
    new Headers({ "webhook-id": "evt_smoke" }),
  );

  expect(
    "an unknown signature scheme is refused",
    "no_signature_entries",
    signedHeaders({ scheme: "v1" }),
  );

  expect(
    "a rotation header with two entries verifies on the known key",
    true,
    signedHeaders({ signers: [stranger, known] }),
  );

  // Two pinned keys is how a rotation is survived: both are valid inside
  // Base44's overlap window, and either may be the one a delivery is signed with.
  process.env.BASE44_WEBHOOK_PUBLIC_KEYS = `${stranger.wire} ${known.wire}`;
  expect("both keys of a pinned rotation verify", true, signedHeaders());
  expect("the incoming key of a rotation verifies too", true, signedHeaders({ signers: [stranger] }));

  // A key truncated by a copy-paste must fail loudly. Silently verifying
  // nothing would look exactly like every event being forged.
  process.env.BASE44_WEBHOOK_PUBLIC_KEYS = known.wire.slice(0, -8);
  throws("a truncated pinned key throws rather than verifying nothing", () =>
    verifyWebhook(signedHeaders(), BODY),
  );

  // No key at all is a deployment that cannot verify anything: the route turns
  // this into a 500, so Base44 keeps the event until the key is deployed.
  delete process.env.BASE44_WEBHOOK_PUBLIC_KEYS;
  throws(
    "no pinned key throws MissingConfigError",
    () => verifyWebhook(signedHeaders(), BODY),
    (err) => err instanceof MissingConfigError && err.variable === "BASE44_WEBHOOK_PUBLIC_KEYS",
  );

  if (fetches !== 0) {
    failed += 1;
    console.log(` FAIL verification made ${fetches} network call(s)`);
  } else {
    console.log("  ok   no check made a network call");
  }

  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

/**
 * Boundary 5: the inbound webhook signature, case by case.
 *
 *   npm run webhook:smoke
 *
 * Unlike the other smoke suites this one needs no dev server and no database:
 * it mints its own Ed25519 keypair, pins its public half, and drives the
 * `@base44/platform/server` verifier the receiver uses, wired from this
 * deployment's config by src/lib/base44Webhooks.ts. So it is safe to run
 * anywhere, and it is the check worth running after touching that module or
 * bumping the SDK.
 *
 * The negative controls are the point. "A genuine signature verifies" passes
 * just as happily against a verifier that returns true unconditionally — what
 * makes the suite mean something is that a tampered body, a relabelled event id,
 * an unknown key and a stale timestamp are each refused, and refused for the
 * stated reason. The handler checks then pin the status codes, which are
 * instructions to Base44: 400 is refused, 500 is retried, 2xx is done.
 *
 * `fetch` is replaced with one that fails the suite: verification is local by
 * design, and a verifier that quietly reached the network would pass every
 * correctness assertion while bringing back a request-path dependency.
 */

import crypto from "node:crypto";

import { WebhookConfigurationError, WebhookVerificationError } from "@base44/platform/server";

import { MissingConfigError, orgId } from "../src/lib/base44Config";
import { base44Webhooks } from "../src/lib/base44Webhooks";

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
// The SDK client requires both, though verification uses neither.
process.env.BASE44_SVC_KEY ||= "b44k_smoke";
process.env.BASE44_PLATFORM_HOST ||= "https://base44.app";

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
  opts: { id?: string; ts?: number; signers?: Signer[]; scheme?: string; body?: string } = {},
): Headers {
  const id = opts.id ?? "evt_smoke";
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const payload = Buffer.concat([
    Buffer.from(`${id}.${ts}.`, "utf8"),
    Buffer.from(opts.body ?? BODY, "utf8"),
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
  let got: string;
  try {
    await base44Webhooks().verifyEvent(body, headers);
    got = "ok";
  } catch (err) {
    got = err instanceof WebhookVerificationError ? err.code : String(err);
  }
  const pass = got === (want === true ? "ok" : want);
  if (!pass) failed += 1;
  console.log(`${pass ? "  ok  " : " FAIL "} ${name} -> ${got}`);
}

async function throws(name: string, run: () => unknown, match: (err: unknown) => boolean) {
  let pass = false;
  try {
    await run();
  } catch (err) {
    pass = match(err);
  }
  if (!pass) failed += 1;
  console.log(`${pass ? "  ok  " : " FAIL "} ${name}`);
}

async function status(name: string, want: number, body: string, headers: Headers, check?: (res: Response) => Promise<boolean>) {
  const res = await base44Webhooks().createHandler()(
    new Request("https://shell.example.com/api/base44/webhooks", { method: "POST", headers, body }),
  );
  const pass = res.status === want && (!check || (await check(res)));
  if (!pass) failed += 1;
  console.log(`${pass ? "  ok  " : " FAIL "} ${name} -> ${res.status}`);
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
    "a signature from an unpinned key is refused",
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

  // Two pinned keys is how a rotation is survived: both are valid inside
  // Base44's overlap window, and either may be the one a delivery is signed with.
  process.env.BASE44_WEBHOOK_PUBLIC_KEYS = `${stranger.wire} ${known.wire}`;
  await expect("both keys of a pinned rotation verify", true, signedHeaders());
  await expect("the incoming key of a rotation verifies too", true, signedHeaders({ signers: [stranger] }));

  // The handler the route mounts: the status code is what Base44 acts on.
  await status("a genuine event is answered 204", 204, BODY, signedHeaders());
  await status(
    "a tampered event is answered 400, not retried",
    400,
    BODY.replace("app.created", "app.deleted"),
    signedHeaders(),
  );
  const PROBE = JSON.stringify({
    specversion: "1.0",
    id: "evt_probe",
    type: "webhook.test.v1",
    data: { endpoint_id: "whe_smoke", workspace_id: orgId(), sent_at: new Date().toISOString(), challenge: "chl_smoke" },
  });
  await status(
    "the activation probe echoes its challenge",
    200,
    PROBE,
    signedHeaders({ id: "evt_probe", body: PROBE }),
    async (res) => (await res.json()).challenge === "chl_smoke",
  );

  // A key truncated by a copy-paste must fail loudly. Silently verifying
  // nothing would look exactly like every event being forged.
  process.env.BASE44_WEBHOOK_PUBLIC_KEYS = known.wire.slice(0, -8);
  await throws(
    "a truncated pinned key throws rather than verifying nothing",
    () => base44Webhooks().verifyEvent(BODY, signedHeaders()),
    (err) => err instanceof WebhookConfigurationError && err.code === "invalid_public_key",
  );

  // No key at all is a deployment that cannot verify anything: the route turns
  // this into a 500, so Base44 keeps the event until the key is deployed.
  delete process.env.BASE44_WEBHOOK_PUBLIC_KEYS;
  await throws(
    "no pinned key throws MissingConfigError",
    () => base44Webhooks().verifyEvent(BODY, signedHeaders()),
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

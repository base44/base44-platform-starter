/**
 * Registers this deployment's inbound webhook endpoint with Base44, and prints
 * the public key the receiver verifies against.
 *
 *   npm run webhook:register -- --url https://your-shell.example.com
 *   npm run webhook:register -- --activate <endpoint id>
 *
 * Registration is a **deploy-time** action, which is why it is a script and not
 * a route: a platform brings a workspace online once, and nothing a user does
 * should be able to point Base44 at a different URL.
 *
 * The service router registers, probes and activates in **one call**, and
 * returns `201 whether or not activation succeeded` — so this asserts on
 * `activated`, never on the status code. Activation requires the receiver to
 * echo a `challenge` out of the probe body, which is what proves it read the
 * body rather than merely answering 200; a URL somebody does not control cannot
 * be talked into accepting signed traffic.
 *
 * Then it reads the workspace's published key set and prints it as the
 * `BASE44_WEBHOOK_PUBLIC_KEYS` line the receiver requires. Registration is what
 * mints the workspace's first key, so on a first run the key cannot be deployed
 * yet and the probe fails to verify: deploy the printed line, then finish with
 *
 *   npm run webhook:register -- --activate <endpoint id>
 *
 * which re-sends the probe to the endpoint just created rather than registering
 * a second one. */

import { orgId, platformHost, webhookKey } from "../src/lib/base44Config";

// The receiver acts on deletions only; subscribing to less means Base44 sends less.
const EVENT_TYPES = ["app.deleted.v1"];

// Functions, not constants: these read required env vars, and at module scope a
// missing one throws before main() can catch it — a stack trace where
// MissingConfigError's own sentence is what the operator needs.
const endpointsUrl = () => `${platformHost()}/api/service/outbound-webhooks/endpoints`;
const keysUrl = () =>
  `${platformHost()}/api/workspace/public/outbound-webhooks/${orgId()}/keys`;

type Endpoint = { id: string; target_url: string; state: string; activated_at: string | null };
type Activation = {
  endpoint: Endpoint;
  activated: boolean;
  http_status: number | null;
  failure_category: string | null;
  detail: string;
};

/** Every value given for `flag`, in order — the flag may repeat. */
function flagValues(flag: string): string[] {
  const found: string[] = [];
  process.argv.forEach((arg, i) => {
    if (arg !== flag) return;
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
    found.push(value);
  });
  return found;
}

function targetUrl(): string {
  const raw =
    flagValues("--url").at(-1) ??
    process.env.BASE44_WEBHOOK_TARGET_URL ??
    process.env.NEXTAUTH_URL;
  if (!raw) {
    throw new Error(
      "No target URL. Pass --url https://your-host, or set BASE44_WEBHOOK_TARGET_URL.",
    );
  }
  const base = raw.replace(/\/+$/, "");
  return base.endsWith("/api/base44/webhooks") ? base : `${base}/api/base44/webhooks`;
}

/** Bare or `Bearer` — Base44's workspace-key auth takes either. Never a JWT. */
const authHeaders = () => ({
  Authorization: `Bearer ${webhookKey()}`,
  "content-type": "application/json",
});

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${res.status} from Base44, and the body was not JSON: ${text.slice(0, 300)}`);
  }
}

async function register(url: string, selected: string[]): Promise<Activation> {
  const res = await fetch(endpointsUrl(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      target_url: url,
      description: "Sunny shell",
      selected_event_types: selected,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const { error, message, details } = body as Record<string, unknown>;
    throw new Error(
      `register failed (${res.status}): ${String(error ?? "")} ${String(message ?? "")} ` +
        `${details ? JSON.stringify(details) : ""}`.trim(),
    );
  }
  return body as Activation;
}

/** Re-sends the activation probe to an endpoint that already exists. */
async function activate(endpointId: string): Promise<Activation> {
  const res = await fetch(`${endpointsUrl()}/${encodeURIComponent(endpointId)}/test`, {
    method: "POST",
    headers: authHeaders(),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const { error, message } = body as Record<string, unknown>;
    throw new Error(`activate failed (${res.status}): ${String(error ?? "")} ${String(message ?? "")}`.trim());
  }
  return body as Activation;
}

function report({ endpoint, activated, http_status, failure_category, detail }: Activation): void {
  console.log(`  endpoint    ${endpoint.id}`);
  console.log(`  state       ${endpoint.state}`);
  console.log(`  activated   ${activated}`);
  if (!activated) {
    // The probe's outcome, not the receiver's body — Base44 never echoes that
    // back, because a mistyped URL could return somebody else's data.
    console.log(`  why         ${failure_category ?? "?"} (http ${http_status ?? "-"}) ${detail}`);
  }
}

async function publishedKeys(): Promise<string[]> {
  const res = await fetch(keysUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`key set returned ${res.status}`);
  const { keys = [] } = (await res.json()) as { keys?: { public_key: string }[] };
  return keys.map((k) => k.public_key);
}

async function main() {
  const toActivate = flagValues("--activate").at(-1);
  if (toActivate) {
    console.log(`activating endpoint ${toActivate}\n`);
    const result = await activate(toActivate);
    report(result);
    process.exitCode = result.activated ? 0 : 1;
    return;
  }

  const url = targetUrl();
  const selected = EVENT_TYPES;
  console.log(`registering ${url}`);
  console.log(`  workspace   ${orgId()} at ${platformHost()}`);
  console.log(`  events      ${selected.join(", ")}`);

  console.log("");

  const result = await register(url, selected);
  report(result);

  // After registration, never before: registering is what mints the workspace's
  // first signing key, so there is nothing to print until this point.
  const keys = await publishedKeys();
  if (keys.length === 0) {
    console.log("\nNo published keys yet — unexpected after a successful register.");
  } else {
    console.log(`\nThe receiver verifies against these. Set them in its env:\n`);
    console.log(`BASE44_WEBHOOK_PUBLIC_KEYS="${keys.join(" ")}"\n`);
  }
  if (!result.activated) {
    console.log(
      "The endpoint exists but is pending. Deploy the line above (or fix whatever " +
        "the probe reported), then finish with:\n\n" +
        `  npm run webhook:register -- --activate ${result.endpoint.id}\n`,
    );
  }

  process.exitCode = result.activated ? 0 : 1;
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

/**
 * Registers this deployment's inbound webhook endpoint with Base44, and prints
 * the public key to pin.
 *
 *   npm run webhook:register -- --url https://your-shell.example.com
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
 * `BASE44_WEBHOOK_PUBLIC_KEYS` line, because registration is what mints the
 * workspace's first key — there is nothing to copy before this runs.
 */

import { orgId, platformHost, webhookKey } from "../src/lib/base44Config";

const EVENT_TYPES = [
  "app.created.v1",
  "app.published.v1",
  "app.unpublished.v1",
  "app.deleted.v1",
  "app.restored.v1",
];

const ENDPOINTS_URL = `${platformHost()}/api/service/outbound-webhooks/endpoints`;
const KEYS_URL = `${platformHost()}/api/workspace/public/outbound-webhooks/${orgId()}/keys`;

type Endpoint = { id: string; target_url: string; state: string; activated_at: string | null };
type Activation = {
  endpoint: Endpoint;
  activated: boolean;
  http_status: number | null;
  failure_category: string | null;
  detail: string;
};

function targetUrl(): string {
  const flag = process.argv.indexOf("--url");
  const raw =
    (flag >= 0 ? process.argv[flag + 1] : undefined) ??
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

async function register(url: string): Promise<Activation> {
  const res = await fetch(ENDPOINTS_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      target_url: url,
      description: "Sunny shell",
      selected_event_types: EVENT_TYPES,
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

async function publishedKeys(): Promise<string[]> {
  const res = await fetch(KEYS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`key set returned ${res.status}`);
  const { keys = [] } = (await res.json()) as { keys?: { public_key: string }[] };
  return keys.map((k) => k.public_key);
}

async function main() {
  const url = targetUrl();
  console.log(`registering ${url}\n  workspace ${orgId()} at ${platformHost()}\n`);

  const result = await register(url);
  const { endpoint, activated, http_status, failure_category, detail } = result;

  console.log(`  endpoint    ${endpoint.id}`);
  console.log(`  state       ${endpoint.state}`);
  console.log(`  activated   ${activated}`);
  if (!activated) {
    // The probe's outcome, not the receiver's body — Base44 never echoes that
    // back, because a mistyped URL could return somebody else's data.
    console.log(`  why         ${failure_category ?? "?"} (http ${http_status ?? "-"}) ${detail}`);
    console.log(
      "\nThe endpoint exists but is pending. Fix the receiver and re-run, or " +
        "POST …/endpoints/{id}/test to retry the probe.",
    );
  }

  // After registration, never before: registering is what mints the workspace's
  // first signing key, so there is nothing to print until this point.
  const keys = await publishedKeys();
  if (keys.length === 0) {
    console.log("\nNo published keys yet — unexpected after a successful register.");
  } else {
    console.log(`\nPin these in the receiver's env to verify without a round trip:\n`);
    console.log(`BASE44_WEBHOOK_PUBLIC_KEYS="${keys.join(" ")}"\n`);
    console.log(
      "Leave it unset to fetch the key set instead, which picks up a rotation on " +
        "its own. See docs/base44-webhooks.md.",
    );
  }

  process.exitCode = activated ? 0 : 1;
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

/**
 * Registers this deployment's inbound webhook endpoint with Base44, and prints
 * the public key to pin.
 *
 *   npm run webhook:register -- --url https://your-shell.example.com
 *   npm run webhook:register -- --url https://… --events app.deleted.v1,app.restored.v1
 *
 * `--events` defaults to every type this receiver handles. Narrowing it is the
 * useful case: a subscription is what makes Base44 write an outbox row at all,
 * so registering for less is less traffic rather than traffic that gets
 * filtered afterwards. Unknown names are passed through and left to the platform
 * to refuse — the catalog grows, and a script holding its own allowlist would
 * reject a type that is perfectly valid upstream.
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
import { HANDLED_EVENT_TYPES } from "../src/lib/base44WebhookEventTypes";

const HANDLED = new Set<string>(HANDLED_EVENT_TYPES);

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

/**
 * The types to subscribe to: `--events` (repeatable, and comma- or
 * space-separated), else `BASE44_WEBHOOK_EVENT_TYPES`, else every type this
 * receiver handles.
 */
function eventTypes(): string[] {
  const flags = flagValues("--events");
  const fromEnv = process.env.BASE44_WEBHOOK_EVENT_TYPES ?? "";
  const asked = flags.length > 0 || fromEnv.trim().length > 0;

  const named = [...new Set(
    [...flags, fromEnv]
      .join(" ")
      .split(/[\s,]+/)
      .map((type) => type.trim())
      .filter((type) => type.length > 0),
  )];

  // Asked for explicitly and resolved to nothing — `--events ","`, say. Falling
  // back to all five here would subscribe to more than was requested, which is
  // the one wrong answer.
  if (asked && named.length === 0) {
    throw new Error("--events (or BASE44_WEBHOOK_EVENT_TYPES) named no event types.");
  }
  return named.length > 0 ? named : [...HANDLED_EVENT_TYPES];
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

async function publishedKeys(): Promise<string[]> {
  const res = await fetch(keysUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`key set returned ${res.status}`);
  const { keys = [] } = (await res.json()) as { keys?: { public_key: string }[] };
  return keys.map((k) => k.public_key);
}

async function main() {
  const url = targetUrl();
  const selected = eventTypes();
  console.log(`registering ${url}`);
  console.log(`  workspace   ${orgId()} at ${platformHost()}`);
  console.log(`  events      ${selected.join(", ")}`);

  // Said before the call, not after: Base44 will accept these happily and
  // deliver them, and this receiver will answer 2xx and do nothing. The platform
  // cannot warn about it — only this side knows what it handles.
  const ignored = selected.filter((type) => !HANDLED.has(type));
  if (ignored.length > 0) {
    console.log(`  note        this receiver ignores ${ignored.join(", ")} — 2xx, no effect`);
  }
  console.log("");

  const result = await register(url, selected);
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

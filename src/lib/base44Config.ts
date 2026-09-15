/**
 * Server-only config for the Base44 app-factory bridge.
 *
 * Every value here is read *only* on the server, and none is ever caller-supplied:
 * a request-controlled base URL on code holding user credentials is an SSRF, and a
 * request-controlled workspace or folder id would defeat the tenancy boundary.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new MissingConfigError(name);
  }
  return value;
}

export class MissingConfigError extends Error {
  code = "bridge_misconfigured";
  constructor(public readonly variable: string) {
    super(
      `Missing env var ${variable}. The Base44 bridge needs BASE44_SVC_KEY, ` +
        `BASE44_ORG_ID, BASE44_PLATFORM_HOST and BASE44_APPS_FOLDER_ID — see .env.example.`,
    );
    this.name = "MissingConfigError";
  }
}

/**
 * The `b44k_` workspace key used on the **hot path**: minting. Needs
 * `user_tokens:mint` and `service_users:provision`. Sent in `Authorization` **bare** — no `Bearer` — which is
 * the format Base44's workspace-key auth accepts.
 *
 * The SDK uses this one key for provisioning, deprovisioning and minting.
 */
export const svcKey = () => required("BASE44_SVC_KEY");

/**
 * The Base44 enterprise workspace every Sunny user is provisioned into. One
 * workspace, central membership, one place to deprovision. Used as `X-Active-Workspace-Id`
 * on every platform call, as `createApp`'s `organization_id`, and as a salt in
 * the principal id so the same person in a different workspace is a different
 * principal. The provision and mint endpoints derive the org from the *key*, so
 * it is deliberately not sent to either — that is the cross-tenant guarantee.
 */
export const orgId = () => required("BASE44_ORG_ID");

/**
 * Host for both the platform REST API and the provision/mint endpoints. One value
 * here, but architecturally two: in production these are the data host and the
 * token issuer, so keep them separable.
 *
 * NB the value in `.env` today is a Base44 PR-preview host, and **it rotates**.
 */
export const platformHost = () => required("BASE44_PLATFORM_HOST").replace(/\/+$/, "");

/**
 * The `sunny_widgets` folder every built app is filed into. `listApps` reads out
 * of it, so an unfiled app is invisible in My Tools. Not caller-supplied: the
 * folder *is* the boundary, so letting the browser name it defeats the point.
 */
export const appsFolderId = () => required("BASE44_APPS_FOLDER_ID");

/**
 * The workspace's Ed25519 public keys, pinned in env instead of fetched.
 *
 * `whpk_`-prefixed, whitespace- or comma-separated, copied once out of the
 * published key set (`npm run webhook:register` prints them). Unset means fetch
 * — see src/lib/base44WebhookSignature.ts for what each mode costs.
 *
 * **The one BASE44_* value that is not a secret.** It is a public key: it
 * verifies signatures and cannot produce them, so leaking it buys nothing. It
 * stays server-side anyway because nothing in the browser verifies webhooks.
 */
export const webhookPublicKeys = (): string[] =>
  (process.env.BASE44_WEBHOOK_PUBLIC_KEYS ?? "")
    .split(/[\s,]+/)
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

/**
 * The `b44k_` key that registers this deployment's webhook endpoint. Needs
 * `outbound_webhooks:write`.
 *
 * Used by `npm run webhook:register` and by nothing on a request path —
 * registration is a deploy-time action, not something a user triggers. Falls
 * back to `BASE44_SVC_KEY` so a single-key deployment works, the same configured workspace key used by the SDK.
 */
export const webhookKey = () => process.env.BASE44_WEBHOOK_KEY?.trim() || svcKey();

/**
 * The reserved, non-routable domain Base44 mints synthetic principal addresses
 * in (RFC 2606 `.invalid`, so it can never resolve). Asserted on the provision
 * response: if what comes back is *not* in this domain we did not get a robot
 * identity, and refusing is cheaper than finding out later which real account we
 * are acting as.
 *
 * NB the principal's own domain is `{organization_id}.{this}` — match as a
 * suffix, not for equality.
 */
export const SERVICE_PRINCIPAL_EMAIL_DOMAIN = "svc.base44.invalid";

/**
 * The client_id used when revoking. Deliberately a NON-MCP prefix: a token whose
 * client_id starts with one of Base44's MCP prefixes (`chatgpt_`, `claude_`,
 * `cursor_`, `oauth_`) is rejected everywhere except `/mcp`.
 */
export const SERVICE_CLIENT_ID = "svc_delegate";

/**
 * Re-mint this far before the stated expiry, so a slow call cannot land after it.
 *
 * Vended access tokens are now minted with an explicit **1h** TTL rather than the
 * ~30-day platform default, so this is ~8% of a token's life, not ~0.01%. The
 * practical consequence is that re-minting is a routine hourly event per active
 * user instead of something that fires once a month — see the note on the mint
 * rate limit in `remint()`.
 */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Values this deployment will install as app secrets on apps it builds. The
 * browser sends names, never values — which is what keeps `BASE44_SVC_KEY` out
 * of a built app.
 */
export const APP_SECRETS: Record<string, () => string> = {
  // Empty since viewer tokens landed: a built app gets its credential from the
  // embedding page at runtime, so there is nothing to install at create time. The
  // registry stays because it is the whole security model of `setAppSecrets` — a
  // name that is not a key here is a 400, and an empty registry rejects everything.
};

export function resolveAppSecrets(names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    // hasOwn, not `in`: "constructor" is not a secret.
    const source = Object.hasOwn(APP_SECRETS, name) ? APP_SECRETS[name] : undefined;
    if (!source) throw new Error(`Unknown app secret "${name}"`);
    out[name] = source();
  }
  return out;
}

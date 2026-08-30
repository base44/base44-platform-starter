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
 * `user_tokens:mint`. Sent in `Authorization` **bare** — no `Bearer` — which is
 * the format Base44's workspace-key auth accepts.
 *
 * Minting and provisioning are separate Base44 scopes (`user_tokens:mint` vs
 * `service_users:provision`), and that split is the point: a mint-only key can
 * vend tokens for principals that already exist but cannot *create* one, so it
 * can never be turned into an impersonate-anyone primitive.
 */
export const svcKey = () => required("BASE44_SVC_KEY");

/**
 * The key used for the two rare, privileged calls: provision and deprovision
 * (`service_users:provision`).
 *
 * Defaults to `BASE44_SVC_KEY` so a single-key deployment still works. Setting
 * `BASE44_PROVISION_KEY` separately — and giving `BASE44_SVC_KEY` only
 * `user_tokens:mint` — is the stronger posture, because it is what makes
 * Base44's deprovision lever real: with a provision-capable key on the hot path,
 * a deprovisioned user can simply press Connect and be re-provisioned, which
 * quietly undoes the offboarding.
 */
export const provisionKey = () => process.env.BASE44_PROVISION_KEY?.trim() || svcKey();

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
 * The one Base44 host: the platform REST API, the identity endpoints
 * (provision, mint, revoke) and the build-session surface are all served from
 * it. They were briefly separable, while the two halves of this integration sat
 * on different unmerged branches; both have landed, so there is one value again.
 *
 * NB the value in `.env` today is a Base44 PR-preview host, and **it rotates**.
 *
 * Server-only and never caller-supplied: a request-controlled base URL on code
 * holding user credentials is an SSRF.
 */
export const platformHost = () => required("BASE44_PLATFORM_HOST").replace(/\/+$/, "");

/**
 * The `sunny_widgets` folder every built app is filed into. `listApps` reads out
 * of it, so an unfiled app is invisible in My Tools. Not caller-supplied: the
 * folder *is* the boundary, so letting the browser name it defeats the point.
 */
export const appsFolderId = () => required("BASE44_APPS_FOLDER_ID");

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
 * Whether to drive builds through the push channel (`/build/*` plus the
 * SSE stream) instead of the blocking `sendMessage` + polling pair.
 *
 * `NEXT_PUBLIC_`, unlike everything else in this file, because the browser is
 * what branches on it: it decides whether to open an `EventSource` or start a
 * poll timer. It is a mode switch, not a secret — same class as
 * `NEXT_PUBLIC_BASE44_APP_HOST`.
 *
 * Two prerequisites, and both fail as a flat 404 rather than anything
 * descriptive: the platform host must be running a build carrying the endpoints,
 * and `base44-for-platforms` must be enabled for `BASE44_ORG_ID`'s workspace. A
 * header override cannot substitute for the second — `EventSource` cannot set
 * request headers, so it would cover the server-side calls and leave the stream
 * 404ing.
 */
export const buildSessionsEnabled = () =>
  process.env.NEXT_PUBLIC_BASE44_BUILD_SESSIONS === "1";

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

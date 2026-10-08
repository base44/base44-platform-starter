/**
 * Server-only config for the Base44 app-factory bridge.
 *
 * Every value here is read *only* on the server, and none is ever caller-supplied:
 * a request-controlled base URL on code holding credentials is an SSRF, and a
 * request-controlled workspace id would defeat the tenancy boundary.
 *
 * ## The identity model — one account
 *
 * One Base44 account sits behind the whole integration. It owns every app the
 * shell's users build, and its personal access token authenticates every platform
 * call. No shell user has a Base44 identity of their own: Base44 sees one builder,
 * and keeping *our* builders apart — which apps each one may list, edit, deploy —
 * is entirely this shell's job. `AppOwnership` is that record, and the platform
 * proxy refuses an app-scoped call without a row for the caller.
 *
 * https://docs.base44.com/developers/white-label/tenancy-and-credentials
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MissingConfigError(name);
  }
  return value;
}

export class MissingConfigError extends Error {
  code = "bridge_misconfigured";
  constructor(public readonly variable: string) {
    super(
      `Missing env var ${variable}. The Base44 bridge needs BASE44_ACCESS_TOKEN, ` +
        `BASE44_ORG_ID and BASE44_PLATFORM_HOST — see .env.example.`,
    );
    this.name = "MissingConfigError";
  }
}

/**
 * The integration account's **personal access token**. Sent as
 * `Authorization: Bearer …` on every Apps API call, so it is the credential
 * behind everything the builder does.
 *
 * Create it in the enterprise workspace, not the account's personal one, or
 * builds miss the design system, skills and plan set up there. The account needs
 * the Editor role or higher in that workspace: viewers and guests cannot create
 * apps, and deploy succeeds only for an Editor.
 */
export const accessToken = () => required("BASE44_ACCESS_TOKEN");

/**
 * The `b44k_` **workspace API key**. Not for building — that is the access token
 * above — but for the two things only a workspace key can do: sign a viewer into
 * an embedded app (provision an app user, mint an embed sign-in token; see
 * src/lib/embedSession.ts) and register the outbound webhook endpoint. Sent as
 * `api_key`, never `Bearer`.
 *
 * Optional: without it the builder still works, and embedded apps load signed out.
 */
export const svcKey = () => required("BASE44_SVC_KEY");

/**
 * The Base44 enterprise workspace every app is built in. Sent as
 * `X-Active-Workspace-Id` on every platform call — Base44 checks permissions
 * against the active workspace, not the body — and as `createApp`'s
 * `organization_id`. One workspace, one place to govern.
 */
export const orgId = () => required("BASE44_ORG_ID");

/**
 * Host for the platform REST API.
 *
 * NB the value in `.env` today is a Base44 PR-preview host, and **it rotates**.
 */
export const platformHost = () => required("BASE44_PLATFORM_HOST").replace(/\/+$/, "");

/**
 * The workspace's Ed25519 public keys, which verify inbound webhooks.
 *
 * `whpk_`-prefixed, whitespace- or comma-separated, printed by
 * `npm run webhook:register`. Required by the receiver: it verifies against
 * these and nothing else — see src/lib/base44WebhookSignature.ts.
 *
 * **The one BASE44_* value that is not a secret.** It is a public key: it
 * verifies signatures and cannot produce them, so leaking it buys nothing. It
 * stays server-side anyway because nothing in the browser verifies webhooks.
 */
export const webhookPublicKeys = (): string[] => {
  const keys = (process.env.BASE44_WEBHOOK_PUBLIC_KEYS ?? "")
    .split(/[\s,]+/)
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (keys.length === 0) throw new MissingConfigError("BASE44_WEBHOOK_PUBLIC_KEYS");
  return keys;
};

/**
 * The `b44k_` key that registers this deployment's webhook endpoint. Needs
 * `outbound_webhooks:write`.
 *
 * Used by `npm run webhook:register` and by nothing on a request path —
 * registration is a deploy-time action, not something a user triggers. Falls
 * back to `BASE44_SVC_KEY` so a single-key deployment works.
 */
export const webhookKey = () => process.env.BASE44_WEBHOOK_KEY?.trim() || svcKey();

/**
 * Values this deployment will install as app secrets on apps it builds. The
 * browser sends names, never values — which is what keeps the access token and
 * the workspace key out of a built app.
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

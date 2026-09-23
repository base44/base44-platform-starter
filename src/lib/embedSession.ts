/**
 * Signing a viewer into an embedded app: provision them as an app user, then
 * mint a one-time token, which comes back as the app's live URL with `?ott=`.
 * The app's server redeems it on the document request and answers with a
 * session, so nothing inside the built app changes.
 */

import { orgId, platformHost, svcKey } from "@/lib/base44Config";

/** What the browser is told. `embedUrl` null means "load the app signed out". */
export type EmbedSession = {
  embedUrl: string | null;
  expiresIn: number | null;
  /** Why there is no session, when there is none. Informational, never a secret. */
  reason: EmbedRefusal | null;
};

export type EmbedRefusal =
  /** The app has never been deployed: redemption runs on the live host only. */
  | "not_deployed"
  /** The platform never mints for an app's owner, editors or service identities. */
  | "privileged_user"
  /** Anything else upstream refused. The frame still renders, signed out. */
  | "refused";

const CLEAN_ID = /^[A-Za-z0-9_-]+$/;

export class EmbedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "EmbedError";
  }
}

/**
 * The workspace key, not the viewer's token: a user's service principal cannot
 * administer another user's app, which is the market case. Nothing here is
 * caller-supplied.
 */
function headers() {
  return {
    api_key: svcKey(),
    "X-Active-Workspace-Id": orgId(),
    "Content-Type": "application/json",
  };
}

async function send(method: "POST" | "DELETE", path: string, body: unknown) {
  const res = await fetch(`${platformHost()}${path}`, {
    method,
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, text: await res.text() };
}

const post = (path: string, body: unknown) => send("POST", path, body);

/** `email` is the session's, never the request body's — that would be impersonation. */
export async function embedSessionFor(appId: string, email: string): Promise<EmbedSession> {
  if (!CLEAN_ID.test(appId)) throw new EmbedError("invalid app id", "invalid_request", 400);

  const provisions = `/api/apps/${appId}/users/provisions`;
  const mint = `/api/apps/${appId}/embed-tokens`;

  const provisioned = await post(provisions, { email, role: "user" });
  if (provisioned.status >= 400) {
    console.warn(`[embed] provision ${appId} → ${provisioned.status} ${provisioned.text.slice(0, 200)}`);
    return { embedUrl: null, expiresIn: null, reason: refusalFrom(provisioned) };
  }

  let minted = await post(mint, { email });

  /**
   * Provisioning matches an access request of any status, so a viewer who once
   * pressed "Request access" on the app's own URL has a *pending* row: provision
   * answers `exists` and changes nothing, and the mint — which wants an approved
   * one — answers `unknown_user`. Left alone that is permanent, and it is the
   * likely order of events, since a private app is what sends someone to that
   * page in the first place.
   *
   * Clearing the grant and writing it again is what breaks the tie. Only on this
   * exact pair of answers, and only once: the viewer is already locked out, so
   * there is nothing working to disturb.
   */
  if (minted.status === 404 && provisioned.text.includes('"exists"')) {
    console.warn(`[embed] ${appId}: provisioned but unknown to the mint; re-provisioning ${email}`);
    await send("DELETE", provisions, { email });
    const again = await post(provisions, { email, role: "user" });
    if (again.status < 400) minted = await post(mint, { email });
  }

  if (minted.status >= 400) {
    console.warn(`[embed] mint ${appId} → ${minted.status} ${minted.text.slice(0, 200)}`);
    return { embedUrl: null, expiresIn: null, reason: refusalFrom(minted) };
  }

  try {
    const body = JSON.parse(minted.text || "{}") as { embed_url?: string | null; expires_in?: number };
    return {
      embedUrl: body.embed_url ?? null,
      expiresIn: body.expires_in ?? null,
      reason: body.embed_url ? null : "not_deployed",
    };
  } catch {
    throw new EmbedError("upstream returned a body that is not JSON", "bad_upstream");
  }
}

function refusalFrom({ status, text }: { status: number; text: string }): EmbedRefusal {
  if (status === 403 && text.includes("privileged_user")) return "privileged_user";
  return "refused";
}

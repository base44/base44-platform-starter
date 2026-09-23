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

async function post(path: string, body: unknown) {
  const res = await fetch(`${platformHost()}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, text: await res.text() };
}

/** `email` is the session's, never the request body's — that would be impersonation. */
export async function embedSessionFor(appId: string, email: string): Promise<EmbedSession> {
  if (!CLEAN_ID.test(appId)) throw new EmbedError("invalid app id", "invalid_request", 400);

  const provisioned = await post(`/api/apps/${appId}/users/provisions`, {
    email,
    role: "user",
  });
  if (provisioned.status >= 400) {
    console.warn(`[embed] provision ${appId} → ${provisioned.status} ${provisioned.text.slice(0, 200)}`);
    return { embedUrl: null, expiresIn: null, reason: refusalFrom(provisioned) };
  }

  const minted = await post(`/api/apps/${appId}/embed-tokens`, { email });
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

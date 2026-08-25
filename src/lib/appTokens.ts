/**
 * Short-lived tokens that let a built app act **as the person looking at it**.
 *
 * A built app runs on its own origin, so a cross-site `fetch` to this shell carries
 * no session cookie — the app has no way to prove who its viewer is. The shared
 * `SUNNY_API_TOKEN` cannot help: every app holds the same copy, so it identifies
 * nobody. Scoping to the app's *owner* is worse than useless once apps are installed
 * from a marketplace, because it would answer with the author's rows.
 *
 * So the Sunny page embedding the app — the one place that does hold a session —
 * mints a token for its current viewer and hands it to the frame over `postMessage`
 * (see `useAppToken`). Nothing here is a session: the token names one viewer, for one
 * app, for a few minutes.
 *
 * HMAC rather than a JWT library: the only consumer is this server, so there is no
 * interop to buy and no key distribution to get wrong. The key is derived from
 * `NEXTAUTH_SECRET` through a fixed label, so an app token can never be mistaken for
 * a session cookie signed with the same secret.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const APP_TOKEN_TTL_SECONDS = 600;

const LABEL = "sunny-app-token-v1";

type Claims = {
  /** The viewer this token speaks for. */
  sub: string;
  /**
   * The app it was minted for. Recorded, **not** enforced: this endpoint has no
   * trustworthy way to know which app is calling it, so a token that escapes one app
   * would work in another. What keeps it from escaping is the handshake — the token
   * is posted to one origin and lives ten minutes. Binding this claim to the app's
   * origin and checking it against the request's `Origin` is the way to make it real.
   */
  app: string;
  /** Unix seconds. */
  exp: number;
};

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint app tokens.");
  return createHmac("sha256", secret).update(LABEL).digest();
}

const b64url = (buf: Buffer) => buf.toString("base64url");

const sign = (body: string) => b64url(createHmac("sha256", key()).update(body).digest());

export function mintAppToken(email: string, appId: string, now = Date.now()): string {
  const claims: Claims = {
    sub: email.toLowerCase(),
    app: appId,
    exp: Math.floor(now / 1000) + APP_TOKEN_TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(claims)));
  return `${body}.${sign(body)}`;
}

/** The claims, or null for anything malformed, mis-signed or expired. */
export function verifyAppToken(token: string | null | undefined, now = Date.now()): Claims | null {
  if (!token) return null;

  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }

  if (!claims.sub || !claims.app) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  return claims;
}

/** `Authorization: Bearer <token>` → the token, or null. */
export function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

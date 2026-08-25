/**
 * The **only** module that reads or writes `Base44Link`, and it is server-only.
 *
 * That model holds per-user Base44 platform access tokens, so it is deliberately
 * kept out of the generic entity CRUD — `/api/entities` refuses the entity
 * outright. Everything here is keyed by the session user's email, and **no
 * function returns a token to a caller**: `linkStatus()` returns booleans and
 * display fields only. A token leaves this module solely as the `Authorization`
 * header of a server-side fetch.
 *
 * ## Identity model — synthetic service principals
 *
 * The shell needs to act on Base44 *as* each of its own users, so that the apps a
 * user builds belong to them and not to whoever's API key the deployment happens
 * to hold. Base44 offers exactly that: a **service principal** — a per-end-user,
 * workspace-owned robot that can never log in. It has no password, no
 * `sso_external_id`, and a synthetic non-routable address
 * (`{slug}-{hash}@{org}.svc.base44.invalid`), so no login path can resolve it and
 * there is no real mailbox to impersonate.
 *
 * The concrete consequences for this file:
 *
 *   * we address the principal by an **opaque `service_external_id`, never an
 *     email** (see `principalId`), and Base44 derives the address from it;
 *   * **provisioning is a separate endpoint and a separate scope** from minting,
 *     so the hot path can hold a mint-only key (see `provisionKey`);
 *   * mint **never auto-provisions** — it 404s for an unknown principal, which
 *     is what makes deprovisioning stick;
 *   * vended access tokens live **~1h**.
 *
 * The alternative Base44 also supports — SCIM-provisioning the user's real email
 * as a workspace member and minting for that — is not used here: it produces a
 * real, login-capable account, and a key that can both provision and mint one is
 * an impersonate-anyone primitive.
 */

import { createHash } from "node:crypto";

import type { Base44Link } from "@prisma/client";

import {
  SERVICE_CLIENT_ID,
  SERVICE_PRINCIPAL_EMAIL_DOMAIN,
  orgId,
  platformHost,
  provisionKey,
  svcKey,
} from "@/lib/base44Config";
import { prisma } from "@/lib/prisma";

export type { Base44Link };

/** What a client is allowed to know about a link. Deliberately token-free. */
export type LinkStatus = {
  linked: boolean;
  base44_user_email: string | null;
  organization_id: string | null;
};

export class Base44Error extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "Base44Error";
  }
}

const norm = (email: string) => email.toLowerCase();

// --- reads -----------------------------------------------------------------

/** The raw row, tokens included. Never hand this to a client. */
export function getLink(email: string): Promise<Base44Link | null> {
  return prisma.base44Link.findUnique({ where: { appUserEmail: norm(email) } });
}

export function linkStatus(link: Base44Link | null): LinkStatus {
  return {
    linked: link?.status === "linked" && Boolean(link.accessToken),
    base44_user_email: link?.base44UserEmail ?? null,
    organization_id: link?.organizationId ?? null,
  };
}

// --- principal identity ----------------------------------------------------

/**
 * The opaque `service_external_id` for a Sunny user.
 *
 * **Deterministic, not random, and not the email.** Deterministic because the id
 * is the only handle on the principal that owns a user's apps: if it were random
 * and stored only on the link row, then disconnecting (which deletes the row) and
 * reconnecting would provision a *second* principal and strand the first one's
 * apps under an identity nothing points at any more. Recomputing it from the
 * email means reconnect always lands on the same principal.
 *
 * Not the email because Base44 builds the principal's address out of this value
 * — passing a real address is exactly the impersonation surface the synthetic
 * design removes, and it would also publish every Sunny user's email in the
 * workspace's member list.
 *
 * Unsalted on purpose: this is an identifier, not a credential. Knowing it buys
 * nothing without a `b44k_` key, and a secret salt would be one more thing whose
 * loss would orphan every principal.
 */
export function principalId(email: string): string {
  const digest = createHash("sha256")
    .update(`${orgId()}:${norm(email)}`)
    .digest("hex");
  return `sunny-${digest.slice(0, 32)}`;
}

// --- provisioning ----------------------------------------------------------

type ProvisionResponse = {
  service_external_id?: string;
  user_id?: string;
  email?: string;
  role?: string;
  created?: boolean;
};

/**
 * Creates this user's service principal, or returns the existing one.
 * Idempotent on `(workspace, service_external_id)`: a principal that already
 * exists comes back `created: false`, so this is safe to call on every connect.
 *
 * Deliberately sends **no `role`** — the endpoint defaults to `editor` and clamps
 * anything above the vendable ceiling anyway. Naming it here would add a field we
 * could get wrong for no capability we do not already have.
 *
 * Note the 409: a conflict is **not** a success. The synthetic address is
 * workspace-namespaced and non-routable, so a user already sitting at it, with no
 * membership, is an anomaly rather than a pre-existing account — Base44 refuses to
 * attach to it and so do we.
 */
async function provisionPrincipal(
  serviceExternalId: string,
  displayName: string,
): Promise<ProvisionResponse> {
  // Read config before the try: a missing env var is a deployment problem, and
  // reporting it as an upstream failure sends you hunting the wrong bug.
  const host = platformHost();
  const key = provisionKey();

  const res = await fetch(`${host}/api/service/users`, {
    method: "POST",
    // Bare, not `Bearer` — the documented format for a Base44 workspace key.
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      service_external_id: serviceExternalId,
      display_name: displayName,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();

  if (res.status === 403) {
    throw new Base44Error(
      "This Base44 workspace is not enabled for app building yet.",
      "principals_not_enabled",
      502,
      // The gate is two independent checks upstream (the enterprise capability
      // and a launch allowlist), and the response says which.
      `provision refused (403): ${text.slice(0, 300)}`,
    );
  }
  if (res.status === 409) {
    throw new Base44Error(
      "Could not set up your Base44 identity — it collides with an existing account.",
      "principal_conflict",
      502,
      `provision conflict (409): ${text.slice(0, 300)}`,
    );
  }
  if (!res.ok) {
    throw new Base44Error(
      "Could not set up your Base44 identity in the workspace.",
      "provision_failed",
      502,
      `provision failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  let parsed: ProvisionResponse;
  try {
    parsed = JSON.parse(text) as ProvisionResponse;
  } catch {
    throw new Base44Error(
      "Could not set up your Base44 identity in the workspace.",
      "provision_failed",
      502,
      `provision returned a non-JSON body: ${text.slice(0, 200)}`,
    );
  }

  // The whole security story is "this is a robot, not a person". Verify it
  // rather than assume it: the address must be in the reserved non-routable
  // domain. If it is not, something upstream handed us a real account and we
  // would be about to mint a token that acts as a human.
  const email = parsed.email ?? "";
  const domain = email.includes("@") ? email.split("@").pop()!.toLowerCase() : "";
  const synthetic =
    domain === SERVICE_PRINCIPAL_EMAIL_DOMAIN ||
    domain.endsWith(`.${SERVICE_PRINCIPAL_EMAIL_DOMAIN}`);
  if (!synthetic) {
    throw new Base44Error(
      "Could not set up your Base44 identity in the workspace.",
      "provision_failed",
      502,
      "provision returned an identity outside the reserved service-principal domain",
    );
  }

  console.log(
    `[base44Link] principal ${serviceExternalId} ${parsed.created ? "created" : "already existed"}` +
      ` in ${orgId()} as ${parsed.role ?? "editor"}`,
  );
  return parsed;
}

/**
 * Removes the principal from the workspace, which is Base44's real offboarding
 * lever: the workspace grant is re-validated on **every** request, so outstanding
 * access tokens fail on their next call rather than living out their hour.
 *
 * **Not** what `disconnect` does, and not wired to a route. Deprovisioning also
 * deletes the principal and transfers the apps it owned to the workspace owner,
 * so it is an offboarding action ("this person has left"), not a UI toggle
 * ("unlink my account"). Idempotent upstream — a 404 is a no-op, not an error.
 */
export async function deprovisionPrincipal(serviceExternalId: string): Promise<void> {
  const host = platformHost();
  const key = provisionKey();

  const res = await fetch(`${host}/api/service/users/${encodeURIComponent(serviceExternalId)}`, {
    method: "DELETE",
    headers: { Authorization: key },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 404) {
    throw new Base44Error(
      "Could not remove this Base44 identity from the workspace.",
      "deprovision_failed",
      502,
      `deprovision failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  console.log(`[base44Link] deprovisioned principal ${serviceExternalId} (${res.status})`);
}

// --- minting ---------------------------------------------------------------

type MintResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
};

/**
 * Mints a token that **acts as** the given service principal. No OAuth dance: no
 * redirect, no consent screen, no PKCE.
 *
 * The body carries only `service_external_id`. There is no `scope` field — the
 * endpoint pins `apps:read apps:write offline` itself, because REST enforces no
 * scopes and a narrower string would advertise a boundary it cannot honour. And
 * the org comes from the key, never the request: that is the
 * cross-tenant guarantee, so there is nothing here that could point at another
 * workspace.
 *
 * 404 means the principal does not exist. Mint **never auto-provisions**, which
 * is deliberate — it is what makes a deprovision stick.
 */
async function mint(serviceExternalId: string): Promise<Response> {
  return fetch(`${platformHost()}/api/service/user-tokens`, {
    method: "POST",
    headers: { Authorization: svcKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ service_external_id: serviceExternalId }),
    signal: AbortSignal.timeout(30_000),
  });
}

const expiryFrom = (expiresIn: MintResponse["expires_in"]) =>
  new Date(Date.now() + (Number(expiresIn) || 0) * 1000);

/**
 * Provision, then mint, then store. In that order: mint refuses an unknown
 * principal and will not create one for you.
 *
 * `organizationId` is recorded from config rather than decoded out of the opaque
 * token — the mint endpoint pins the token to that org anyway.
 */
export async function connect(email: string): Promise<LinkStatus> {
  const appUserEmail = norm(email);
  const serviceExternalId = principalId(appUserEmail);

  // The display name reaches Base44's member list, so it stays free of the
  // user's real address for the same reason the id does. The workspace admin
  // sees an opaque robot; the id ↔ person mapping lives in this database, which
  // is where it belongs.
  const principal = await provisionPrincipal(
    serviceExternalId,
    `Sunny user ${serviceExternalId.slice(-8)}`,
  );

  const res = await mint(serviceExternalId);
  const text = await res.text();
  if (!res.ok) {
    throw new Base44Error(
      "Could not mint your Base44 access token.",
      "mint_failed",
      502,
      `token mint failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  let tokens: MintResponse;
  try {
    tokens = JSON.parse(text) as MintResponse;
  } catch {
    throw new Base44Error(
      "Could not mint your Base44 access token.",
      "mint_failed",
      502,
      `token mint returned a non-JSON body: ${text.slice(0, 200)}`,
    );
  }

  const record = {
    status: "linked" as const,
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: expiryFrom(tokens.expires_in),
    organizationId: orgId(),
    serviceExternalId,
    // The synthetic address, not the user's. Safe to store and useless to
    // anyone: it cannot receive mail and cannot log in.
    base44UserEmail: principal.email ?? null,
    principalProvisioned: true,
  };

  const link = await prisma.base44Link.upsert({
    where: { appUserEmail },
    create: {
      appUserEmail,
      ...record,
      // `createdBy` is the owner column on this model too. It equals the link's
      // own user: a link is only ever created by the person it belongs to.
      createdBy: appUserEmail,
    },
    update: record,
  });

  return linkStatus(link);
}

/**
 * Forgets the link. Only the refresh token is revocable (RFC 7009) — the access
 * token is a self-contained JWT and stays valid until it expires, so dropping the
 * row is the best available on that half. That window is now an hour rather than
 * a month, which makes the gap far less interesting than it used to be.
 *
 * Deliberately does **not** deprovision the principal: the user's built apps are
 * owned by it, and unlinking an account in the UI should not hand them to the
 * workspace owner. `deprovisionPrincipal()` is the offboarding path.
 *
 * Revocation is best-effort: a failed revoke must not strand the user in a linked
 * state they cannot leave.
 */
export async function disconnect(email: string): Promise<LinkStatus> {
  const link = await getLink(email);
  if (!link) return linkStatus(null);

  if (link.refreshToken) {
    try {
      await fetch(`${platformHost()}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: link.refreshToken, client_id: SERVICE_CLIENT_ID }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error("[base44Link] revoke failed; deleting the record anyway", err);
    }
  }

  await prisma.base44Link.delete({ where: { appUserEmail: norm(email) } });
  return linkStatus(null);
}

/**
 * Re-mints and persists a fresh access token.
 *
 * Re-mint rather than `POST /oauth/token`, even though vended tokens do come with
 * a refresh token. The shell holds a mint-capable key, so asking for a new token
 * is strictly simpler than a refresh exchange — no
 * rotation to persist correctly, no way to end up holding a refresh token the
 * server has already revoked. Both paths re-validate the workspace grant, so
 * **deprovisioning propagates either way**; the tie goes to the one with fewer
 * moving parts.
 *
 * The cost is a mint per active user per hour, against a limit of 60/60s **per
 * workspace** (shared with every other user, so it is a fleet budget, not a
 * per-user one). That is ~3600 users/hour of headroom. If it ever binds, the fix
 * is the refresh exchange, not a longer TTL.
 *
 * Returns null when the grant is dead — principal deprovisioned, role no longer
 * vendable, or the key lost its mint scope — and downgrades the row to `pending`
 * so the UI falls back to the connect gate. A *transient* failure returns null
 * **without** touching the row, so the next call retries rather than forcing a
 * reconnect.
 */
export async function remint(link: Base44Link): Promise<Base44Link | null> {
  const email = link.appUserEmail;
  if (!email) return null;

  // Read config *before* the try, so a missing env var propagates instead of
  // being mistaken for a network blip. Telling the user "your connection
  // expired, connect again" when the deployment simply has no key sends them
  // into a reconnect loop that cannot succeed.
  const host = platformHost();
  const key = svcKey();

  // A row with no stored principal id still recomputes one — it is derived, not
  // stored. If no principal was ever created for this user the mint 404s below,
  // which is the intended outcome: one reconnect, which provisions.
  const serviceExternalId = link.serviceExternalId ?? principalId(email);

  let res: Response;
  try {
    res = await fetch(`${host}/api/service/user-tokens`, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ service_external_id: serviceExternalId }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // A network blip is NOT a dead grant — leave the record alone so the next
    // call retries rather than forcing a reconnect.
    console.error("[base44Link] re-mint request never completed", err);
    return null;
  }

  const text = await res.text();
  if (!res.ok) {
    console.error(`[base44Link] re-mint failed ${res.status}: ${text.slice(0, 300)}`);
    // Only a *definitive* rejection means reconnect. 429 is the shared
    // per-workspace mint limiter — another user's traffic, not this user's
    // grant — and 408/5xx are upstream trouble; downgrading on those would
    // convert a busy minute into a fleet-wide forced reconnect.
    const deadGrant =
      res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408;
    if (deadGrant) {
      await prisma.base44Link
        .update({
          where: { appUserEmail: email },
          data: { status: "pending", accessToken: null, refreshToken: null },
        })
        .catch((err) => console.error("[base44Link] failed to downgrade link status", err));
    }
    return null;
  }

  let tokens: MintResponse;
  try {
    tokens = JSON.parse(text) as MintResponse;
  } catch {
    console.error("[base44Link] re-mint response was not JSON:", text.slice(0, 200));
    return null;
  }

  const patch = {
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? link.refreshToken,
    expiresAt: expiryFrom(tokens.expires_in),
    // Backfills a row that had no stored principal id.
    serviceExternalId,
    principalProvisioned: true,
  };

  try {
    return await prisma.base44Link.update({ where: { appUserEmail: email }, data: patch });
  } catch (err) {
    console.error("[base44Link] failed to persist refreshed token", err);
    // Hand back the in-memory patch so the current call can still proceed.
    return { ...link, ...patch };
  }
}

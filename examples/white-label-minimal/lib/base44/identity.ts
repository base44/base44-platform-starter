import "server-only";
import { createHash } from "node:crypto";
import type { Base44Link } from "../../generated/prisma";
import { prisma } from "../storage/db";
import { withIdentityLock } from "../storage/identity-repository";
import { Base44Error } from "./error";
import { base44Fetch } from "./http";

// Each Sunny user gets one Base44 service user. We keep its tokens server-side
// and refresh the access token shortly before it expires.

export function getLink(email: string) {
  return prisma.base44Link.findUnique({ where: { appUserEmail: email.toLowerCase() } });
}

export function linkStatus(link: Base44Link | null) {
  return {
    linked: link?.status === "linked" && Boolean(link.accessToken),
    base44_user_email: link?.base44UserEmail ?? null,
    organization_id: link?.organizationId ?? null,
  };
}

export async function connect(email: string) {
  const appUserEmail = email.toLowerCase();
  const organizationId = required("BASE44_ORG_ID");
  const key = required("BASE44_SVC_KEY");
  const existing = await getLink(appUserEmail);
  // Deterministic, so reconnecting finds the same service user and its apps.
  const digest = createHash("sha256").update(`${organizationId}:${appUserEmail}`).digest("hex");
  const serviceExternalId = existing?.serviceExternalId ?? `sunny-${digest.slice(0, 32)}`;

  const principal = await post("/api/service/users", {
    service_external_id: serviceExternalId,
    display_name: `Builder ${serviceExternalId.slice(-8)}`,
  }, process.env.BASE44_PROVISION_KEY?.trim() || key);
  const base44UserEmail = principal?.email;
  if (typeof base44UserEmail !== "string" || !/@([^@]+\.)?svc\.base44\.invalid$/.test(base44UserEmail))
    throw new Base44Error("Base44 returned an invalid service-user identity.");

  const tokens = await post("/api/service/user-tokens", { service_external_id: serviceExternalId }, key);
  const record = {
    ...tokenFields(tokens),
    status: "linked" as const,
    organizationId,
    serviceExternalId,
    base44UserEmail,
    principalProvisioned: true,
  };
  return linkStatus(await prisma.base44Link.upsert({
    where: { appUserEmail },
    create: { appUserEmail, createdBy: appUserEmail, ...record },
    update: record,
  }));
}

export function getBase44AccessToken(email: string): Promise<string> {
  const appUserEmail = email.toLowerCase();
  // The row lock stops two requests from spending the same refresh token.
  return withIdentityLock(appUserEmail, async (identities) => {
    const link = await identities.findUnique({ where: { appUserEmail } });
    if (link?.status !== "linked" || !link.accessToken)
      throw new Base44Error("Connect your workspace to start building.", 428);
    if (link.expiresAt && link.expiresAt.getTime() > Date.now() + 60_000) return link.accessToken;
    if (!link.refreshToken) throw new Base44Error("Reconnect your workspace to continue.", 428);

    const tokens = await post("/oauth/token", new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "svc_delegate",
      refresh_token: link.refreshToken,
    }));
    const refreshed = await identities.update({
      where: { appUserEmail },
      data: tokenFields(tokens, link.refreshToken),
    });
    return refreshed.accessToken!;
  });
}

export async function disconnect(email: string) {
  const link = await getLink(email);
  if (link?.refreshToken) {
    // Best effort: the local tokens are cleared even if revocation fails.
    await post("/oauth/revoke", new URLSearchParams({ token: link.refreshToken, client_id: "svc_delegate" }))
      .catch(() => {});
  }
  await prisma.base44Link.updateMany({
    where: { appUserEmail: email.toLowerCase() },
    data: { status: "pending", accessToken: null, refreshToken: null, expiresAt: null },
  });
  return linkStatus(null);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Base44Error(`Configure ${name} on the server.`, 503);
  return value;
}

function post(path: string, body: object | URLSearchParams, key?: string) {
  return base44Fetch(path, {
    body,
    headers: key ? { Authorization: key } : {},
    // A rejected refresh token means the user must reconnect.
    errorFor: (status) => path === "/oauth/token" && [400, 401, 403].includes(status)
      ? new Base44Error("Reconnect your workspace to continue.", 428)
      : new Base44Error(`Base44 returned ${status}. Please try again.`, 502),
  });
}

function tokenFields(data: Record<string, unknown> | null, previousRefreshToken?: string | null) {
  const accessToken = data?.access_token;
  const refreshToken = data?.refresh_token ?? previousRefreshToken;
  const expiresIn = Number(data?.expires_in);
  if (typeof accessToken !== "string" || !accessToken || typeof refreshToken !== "string" || !refreshToken ||
      !Number.isFinite(expiresIn) || expiresIn <= 0)
    throw new Base44Error("Base44 returned invalid credentials.");
  return { accessToken, refreshToken, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "../storage/db";
import { Base44Error } from "./error";
import { base44Fetch } from "./http";

// Each Tiny user gets one Base44 service user, created with the workspace key.
// Base44 calls use a 1-hour token minted for that service user. Minting is
// rate-limited per workspace, so the token is stored and reused until it expires.

export async function getConnection(email: string) {
  const link = await prisma.base44Link.findUnique({ where: { appUserEmail: email.toLowerCase() } });
  return { linked: link?.status === "linked" };
}

export async function connect(email: string) {
  const appUserEmail = email.toLowerCase();
  const organizationId = required("BASE44_ORG_ID");
  const existing = await prisma.base44Link.findUnique({ where: { appUserEmail } });
  // Never change this format: existing apps belong to the service user it names.
  const digest = createHash("sha256").update(`${organizationId}:${appUserEmail}`).digest("hex");
  const serviceExternalId = existing?.serviceExternalId ?? `sunny-${digest.slice(0, 32)}`;

  // Idempotent: returns the existing service user when there is one.
  const principal = await post("/api/service/users", {
    service_external_id: serviceExternalId,
    display_name: `Builder ${serviceExternalId.slice(-8)}`,
  });
  const base44UserEmail = principal?.email;
  if (typeof base44UserEmail !== "string" || !/@([^@]+\.)?svc\.base44\.invalid$/.test(base44UserEmail))
    throw new Base44Error("Base44 returned an invalid service-user identity.");

  const record = {
    ...(await mint(serviceExternalId)),
    status: "linked" as const,
    organizationId,
    serviceExternalId,
    base44UserEmail,
    principalProvisioned: true,
  };
  await prisma.base44Link.upsert({
    where: { appUserEmail },
    create: { appUserEmail, createdBy: appUserEmail, ...record },
    update: record,
  });
  return { linked: true };
}

export async function getBase44AccessToken(email: string): Promise<string> {
  const appUserEmail = email.toLowerCase();
  const link = await prisma.base44Link.findUnique({ where: { appUserEmail } });
  if (link?.status !== "linked" || !link.serviceExternalId)
    throw new Base44Error("Connect your workspace to start building.", 428);
  if (link.accessToken && link.expiresAt && link.expiresAt.getTime() > Date.now() + 60_000)
    return link.accessToken;

  const tokens = await mint(link.serviceExternalId);
  await prisma.base44Link.update({ where: { appUserEmail }, data: tokens });
  return tokens.accessToken;
}

// Keeps the service user, so reconnecting brings back the same apps.
export async function disconnect(email: string) {
  const appUserEmail = email.toLowerCase();
  const link = await prisma.base44Link.findUnique({ where: { appUserEmail } });
  if (link?.refreshToken) {
    // Best effort: the local tokens are cleared even if revocation fails.
    await base44Fetch("/oauth/revoke", {
      body: new URLSearchParams({ token: link.refreshToken, client_id: "svc_delegate" }),
    }).catch(() => {});
  }
  await prisma.base44Link.updateMany({
    where: { appUserEmail },
    data: { status: "pending", accessToken: null, refreshToken: null, expiresAt: null },
  });
  return { linked: false };
}

async function mint(serviceExternalId: string) {
  const data = await post("/api/service/user-tokens", { service_external_id: serviceExternalId }, (status) =>
    // 429 is the workspace-wide mint limit and 408 a timeout: try again later.
    // Any other 4xx means the service user or key no longer works: reconnect.
    status >= 400 && status < 500 && status !== 429 && status !== 408
      ? new Base44Error("Reconnect your workspace to continue.", 428)
      : undefined);
  const expiresIn = Number(data?.expires_in);
  if (typeof data?.access_token !== "string" || !data.access_token || !(expiresIn > 0) || !Number.isFinite(expiresIn))
    throw new Base44Error("Base44 returned invalid credentials.");
  return {
    accessToken: data.access_token as string,
    // Unused here, but main Sunny shares this row and revokes it on disconnect.
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

// Calls authenticated with the workspace key. It needs the service_users:provision
// and user_tokens:mint scopes.
function post(path: string, body: object, errorFor?: (status: number) => Base44Error | undefined) {
  return base44Fetch(path, {
    body,
    headers: { Authorization: required("BASE44_SVC_KEY") },
    errorFor: (status) => errorFor?.(status) ?? new Base44Error(`Base44 returned ${status}. Please try again.`, 502),
  });
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Base44Error(`Configure ${name} on the server.`, 503);
  return value;
}

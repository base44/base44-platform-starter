import "server-only";
import { createHash } from "node:crypto";
import type { Base44Link } from "../../generated/prisma";
import { prisma } from "../storage/db";
import { Base44Error } from "./error";
import { getBase44Config } from "./config";
import { withIdentityLock } from "../storage/identity-repository";

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

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Base44Error(`Configure ${name} on the server.`, 503);
  return value;
}

async function request(path: string, body: object | URLSearchParams, key?: string) {
  const { host } = getBase44Config();
  let response: Response;
  try {
    response = await fetch(`${host}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": body instanceof URLSearchParams
          ? "application/x-www-form-urlencoded" : "application/json",
        ...(key ? { Authorization: key } : {}),
      },
      body: body instanceof URLSearchParams ? body : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Base44Error("Could not reach Base44. Please try again.", 504);
  }
  if (!response.ok) {
    const expired = path === "/oauth/token" && [400, 401, 403].includes(response.status);
    throw new Base44Error(
      expired ? "Reconnect your workspace to continue." : `Base44 returned ${response.status}. Please try again.`,
      expired ? 428 : 502,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Base44Error("Base44 returned an unreadable identity response.");
  }
}

function tokenFields(data: Record<string, unknown> | null, previousRefreshToken?: string | null) {
  if (!data) throw new Base44Error("Base44 returned invalid credentials.");
  const refreshToken = data.refresh_token ?? previousRefreshToken;
  const expiresIn = Number(data.expires_in);
  if (typeof data.access_token !== "string" || !data.access_token ||
      typeof refreshToken !== "string" || !refreshToken ||
      !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Base44Error("Base44 returned invalid credentials.");
  }
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

export async function connect(email: string) {
  const appUserEmail = email.toLowerCase();
  const organizationId = required("BASE44_ORG_ID");
  const key = required("BASE44_SVC_KEY");
  const existing = await getLink(appUserEmail);
  const digest = createHash("sha256").update(`${organizationId}:${appUserEmail}`).digest("hex");
  const serviceExternalId = existing?.serviceExternalId ?? `sunny-${digest.slice(0, 32)}`;
  const principal = await request("/api/service/users", {
    service_external_id: serviceExternalId,
    display_name: `Builder ${serviceExternalId.slice(-8)}`,
  }, process.env.BASE44_PROVISION_KEY?.trim() || key);
  const domain = typeof principal?.email === "string" ? principal.email.split("@")[1] : "";
  if (!domain || !(domain === "svc.base44.invalid" || domain.endsWith(".svc.base44.invalid")))
    throw new Base44Error("Base44 returned an invalid service-user identity.");
  const tokens = await request("/api/service/user-tokens", {
    service_external_id: serviceExternalId,
  }, key);
  const record = {
    ...tokenFields(tokens),
    status: "linked" as const,
    organizationId,
    serviceExternalId,
    base44UserEmail: principal.email,
    principalProvisioned: true,
  };
  return linkStatus(await prisma.base44Link.upsert({
    where: { appUserEmail },
    create: { appUserEmail, createdBy: appUserEmail, ...record },
    update: record,
  }));
}

export async function getBase44AccessToken(email: string): Promise<string> {
  const appUserEmail = email.toLowerCase();
  return withIdentityLock(appUserEmail, async (identities) => {
    const link = await identities.findUnique({ where: { appUserEmail } });
    if (link?.status !== "linked" || !link.accessToken)
      throw new Base44Error("Connect your workspace to start building.", 428);
    if (link.expiresAt && link.expiresAt.getTime() > Date.now() + 60_000)
      return link.accessToken;
    if (!link.refreshToken)
      throw new Base44Error("Reconnect your workspace to continue.", 428);
    const tokens = await request("/oauth/token", new URLSearchParams({
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
    const { host } = getBase44Config();
    try {
      await fetch(`${host}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: link.refreshToken, client_id: "svc_delegate" }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
    }
  }
  await prisma.base44Link.updateMany({
    where: { appUserEmail: email.toLowerCase() },
    data: { status: "pending", accessToken: null, refreshToken: null, expiresAt: null },
  });
  return linkStatus(null);
}

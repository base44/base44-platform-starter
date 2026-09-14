/** Server-side connection between a Sunny user and their Base44 service identity. */
import { createHash } from "node:crypto";
import type { Base44Link } from "@prisma/client";
import { Base44PlatformClient, Base44PlatformError } from "@base44/sdk/platform/server";
import { orgId, platformHost, svcKey } from "@/lib/base44Config";
import { base44TokenStore } from "@/lib/base44TokenStore";
import { prisma } from "@/lib/prisma";

export type { Base44Link };
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

let platformClient: Base44PlatformClient | undefined;

export function getPlatformClient(): Base44PlatformClient {
  if (!platformClient) {
    platformClient = new Base44PlatformClient({
      apiKey: svcKey(),
      workspaceId: orgId(),
      serverUrl: platformHost(),
      tokenStore: base44TokenStore,
    });
  }
  return platformClient;
}

export function getLink(email: string): Promise<Base44Link | null> {
  return prisma.base44Link.findUnique({ where: { appUserEmail: email.toLowerCase() } });
}

export async function emailForServiceExternalId(serviceExternalId: string): Promise<string | null> {
  const link = await prisma.base44Link.findUnique({
    where: { serviceExternalId },
    select: { appUserEmail: true },
  });
  return link?.appUserEmail ?? null;
}

export function linkStatus(link: Base44Link | null): LinkStatus {
  return {
    linked: link?.status === "linked" && Boolean(link.accessToken),
    base44_user_email: link?.base44UserEmail ?? null,
    organization_id: link?.organizationId ?? null,
  };
}

export function principalId(email: string): string {
  const hash = createHash("sha256")
    .update(`${orgId()}:${email.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
  return `sunny-${hash}`;
}

export async function connect(email: string): Promise<LinkStatus> {
  const appUserEmail = email.toLowerCase();
  const serviceExternalId = principalId(email);
  const client = getPlatformClient();

  let principal;
  try {
    principal = await client.users.provision({
      externalId: serviceExternalId,
      displayName: `Sunny user ${serviceExternalId.slice(-8)}`,
    });
  } catch (error) {
    if (!(error instanceof Base44PlatformError)) throw error;
    const codes: Record<number, string> = {
      403: "principals_not_enabled",
      409: "principal_conflict",
    };
    throw new Base44Error(error.message, codes[error.status] ?? "provision_failed");
  }

  const identity = {
    organizationId: orgId(),
    serviceExternalId,
    base44UserEmail: principal.email,
    principalProvisioned: true,
  };
  // The token store updates this row, so create the mapping before requesting a token.
  await prisma.base44Link.upsert({
    where: { appUserEmail },
    create: { ...identity, appUserEmail, createdBy: appUserEmail, status: "pending" },
    update: identity,
  });

  try {
    await client.asUser(serviceExternalId).getAccessToken();
  } catch (error) {
    throwBridgeError(error, "mint_failed");
  }
  return linkStatus(await getLink(email));
}

export async function deprovisionPrincipal(serviceExternalId: string): Promise<void> {
  try {
    await getPlatformClient().users.deprovision(serviceExternalId);
  } catch (error) {
    throwBridgeError(error, "deprovision_failed");
  }
}

export async function disconnect(email: string): Promise<LinkStatus> {
  const link = await getLink(email);
  if (!link) return linkStatus(null);

  try {
    const externalId = link.serviceExternalId ?? principalId(email);
    await getPlatformClient().asUser(externalId).revokeToken();
  } catch {
    console.warn("[base44Link] remote revocation failed; removing local link");
  }
  await prisma.base44Link.deleteMany({ where: { appUserEmail: email.toLowerCase() } });
  return linkStatus(null);
}

/** Chat still uses raw HTTP, so it obtains renewed credentials through this adapter. */
export async function remint(link: Base44Link): Promise<Base44Link | null> {
  const client = getPlatformClient();
  const externalId = link.serviceExternalId ?? principalId(link.appUserEmail);
  if (!link.serviceExternalId) {
    await prisma.base44Link.update({
      where: { appUserEmail: link.appUserEmail },
      data: { serviceExternalId: externalId },
    });
  }

  try {
    await client.asUser(externalId).getAccessToken({ forceRefresh: true });
  } catch (error) {
    if (isRejectedCredential(error)) {
      await base44TokenStore.delete({
        serverUrl: new URL(platformHost()).toString().replace(/\/+$/, ""),
        workspaceId: orgId(),
        externalId,
      });
    }
    return null;
  }
  return getLink(link.appUserEmail);
}

/** Forget a rejected credential so reconnect cannot reuse it. */
export async function clearLinkCredentials(email: string): Promise<void> {
  await prisma.base44Link.updateMany({
    where: { appUserEmail: email.toLowerCase(), organizationId: orgId() },
    data: { accessToken: null, refreshToken: null, expiresAt: null, status: "pending" },
  });
}

function isRejectedCredential(error: unknown): boolean {
  return (
    error instanceof Base44PlatformError &&
    error.status >= 400 && error.status < 500 &&
    error.status !== 408 && error.status !== 429
  );
}

function throwBridgeError(error: unknown, code: string): never {
  if (error instanceof Base44PlatformError) {
    throw new Base44Error(error.message, code);
  }
  throw error;
}

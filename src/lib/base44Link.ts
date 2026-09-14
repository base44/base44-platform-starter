/** Server-only Base44 identity mapping and the sole owner of Base44Link persistence. */
import { createHash } from "node:crypto";
import type { Base44Link } from "@prisma/client";
import { Base44PlatformClient, Base44PlatformError, type TokenKey, type TokenStore } from "@base44/sdk/platform/server";
import { orgId, platformHost, svcKey } from "@/lib/base44Config";
import { prisma } from "@/lib/prisma";

export type { Base44Link };
export type LinkStatus = { linked: boolean; base44_user_email: string | null; organization_id: string | null };
export class Base44Error extends Error {
  constructor(message: string, readonly code: string, readonly status = 502, readonly detail?: string) { super(message); this.name = "Base44Error"; }
}
const norm = (email: string) => email.toLowerCase();
export function getLink(email: string): Promise<Base44Link | null> {
  return prisma.base44Link.findUnique({ where: { appUserEmail: norm(email) } });
}
export async function emailForServiceExternalId(serviceExternalId: string): Promise<string | null> {
  const row = await prisma.base44Link.findUnique({ where: { serviceExternalId }, select: { appUserEmail: true } });
  return row?.appUserEmail ?? null;
}
export function linkStatus(link: Base44Link | null): LinkStatus {
  return { linked: link?.status === "linked" && Boolean(link.accessToken), base44_user_email: link?.base44UserEmail ?? null, organization_id: link?.organizationId ?? null };
}
export function principalId(email: string): string {
  return `sunny-${createHash("sha256").update(`${orgId()}:${norm(email)}`).digest("hex").slice(0, 32)}`;
}

function assertStorageNamespace(key: TokenKey) {
  if (key.workspaceId !== orgId() || key.serverUrl !== new URL(platformHost()).toString().replace(/\/+$/, "")) throw new Error("Unexpected token namespace");
}
const tokenStore: TokenStore = {
  async get(key) {
    assertStorageNamespace(key);
    const row = await prisma.base44Link.findUnique({ where: { serviceExternalId: key.externalId } });
    if (!row?.accessToken || !row.expiresAt || row.organizationId !== key.workspaceId || row.status !== "linked") return null;
    return { accessToken: row.accessToken, refreshToken: row.refreshToken, expiresAt: row.expiresAt.getTime(), renewAt: row.expiresAt.getTime() - 300_000 };
  },
  async set(key, record) {
    assertStorageNamespace(key);
    const result = await prisma.base44Link.updateMany({
      where: { serviceExternalId: key.externalId, organizationId: key.workspaceId },
      data: { accessToken: record.accessToken, refreshToken: record.refreshToken, expiresAt: new Date(record.expiresAt), status: "linked", principalProvisioned: true },
    });
    // A disconnect must not be undone by an in-flight mint completing later.
    if (result.count !== 1) throw new Error("Link no longer exists");
  },
  async delete(key) {
    assertStorageNamespace(key);
    await prisma.base44Link.updateMany({ where: { serviceExternalId: key.externalId, organizationId: key.workspaceId }, data: { accessToken: null, refreshToken: null, expiresAt: null, status: "pending" } });
  },
};
let sdk: Base44PlatformClient | undefined;
export function getPlatformClient(): Base44PlatformClient {
  return sdk ??= new Base44PlatformClient({ apiKey: svcKey(), workspaceId: orgId(), serverUrl: platformHost(), tokenStore });
}
function bridgeError(error: unknown, code: string): never {
  if (error instanceof Base44PlatformError) throw new Base44Error(error.message, code, 502);
  throw error;
}
export async function connect(email: string): Promise<LinkStatus> {
  const appUserEmail = norm(email), serviceExternalId = principalId(email);
  const client = getPlatformClient();
  let principal;
  try { principal = await client.users.provision({ externalId: serviceExternalId, displayName: `Sunny user ${serviceExternalId.slice(-8)}` }); }
  catch (error) { return bridgeError(error, error instanceof Base44PlatformError && error.status === 409 ? "principal_conflict" : error instanceof Base44PlatformError && error.status === 403 ? "principals_not_enabled" : "provision_failed"); }
  const data = { organizationId: orgId(), serviceExternalId, base44UserEmail: principal.email, principalProvisioned: true };
  await prisma.base44Link.upsert({ where: { appUserEmail }, create: { ...data, appUserEmail, createdBy: appUserEmail, status: "pending" }, update: data });
  try { await client.asUser(serviceExternalId).getAccessToken(); }
  catch (error) { return bridgeError(error, "mint_failed"); }
  return linkStatus(await getLink(email));
}
export async function deprovisionPrincipal(serviceExternalId: string): Promise<void> {
  try { await getPlatformClient().users.deprovision(serviceExternalId); }
  catch (error) { return bridgeError(error, "deprovision_failed"); }
}
export async function disconnect(email: string): Promise<LinkStatus> {
  const row = await getLink(email);
  if (!row) return linkStatus(null);
  try { await getPlatformClient().asUser(row.serviceExternalId ?? principalId(email)).revokeToken(); }
  catch { console.warn("[base44Link] remote revocation failed; removing local link"); }
  await prisma.base44Link.deleteMany({ where: { appUserEmail: norm(email) } });
  return linkStatus(null);
}
/** Compatibility seam for chat; token lifecycle now belongs to the platform SDK. */
export async function remint(link: Base44Link): Promise<Base44Link | null> {
  const client = getPlatformClient();
  const externalId = link.serviceExternalId ?? principalId(link.appUserEmail);
  if (!link.serviceExternalId) await prisma.base44Link.update({ where: { appUserEmail: link.appUserEmail }, data: { serviceExternalId: externalId } });
  try { await client.asUser(externalId).getAccessToken({ forceRefresh: true }); }
  catch (error) {
    if (error instanceof Base44PlatformError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
      await tokenStore.delete({ serverUrl: new URL(platformHost()).toString().replace(/\/+$/, ""), workspaceId: orgId(), externalId });
    }
    return null;
  }
  return getLink(link.appUserEmail);
}

/** Forget a rejected credential so reconnect cannot reuse it. */
export async function clearLinkCredentials(email: string): Promise<void> {
  await prisma.base44Link.updateMany({ where: { appUserEmail: norm(email), organizationId: orgId() }, data: { accessToken: null, refreshToken: null, expiresAt: null, status: "pending" } });
}

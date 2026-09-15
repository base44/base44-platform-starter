import type { TokenKey, TokenStore } from "@base44/sdk/platform/server";
import { orgId, platformHost, REFRESH_SKEW_MS } from "@/lib/base44Config";
import { prisma } from "@/lib/prisma";

function assertStorageNamespace(key: TokenKey) {
  const serverUrl = new URL(platformHost()).toString().replace(/\/+$/, "");
  if (key.workspaceId !== orgId() || key.serverUrl !== serverUrl) {
    throw new Error("Unexpected token namespace");
  }
}

/** Adapt Sunny's existing connection rows to the SDK's persistent token store. */
export const base44TokenStore: TokenStore = {
  async get(key) {
    assertStorageNamespace(key);
    const link = await prisma.base44Link.findUnique({
      where: { serviceExternalId: key.externalId },
    });
    if (!link?.accessToken || !link.expiresAt) return null;
    if (link.organizationId !== key.workspaceId || link.status !== "linked") return null;

    return {
      accessToken: link.accessToken,
      refreshToken: link.refreshToken,
      expiresAt: link.expiresAt.getTime(),
      renewAt: link.expiresAt.getTime() - REFRESH_SKEW_MS,
    };
  },

  async set(key, record) {
    assertStorageNamespace(key);
    const result = await prisma.base44Link.updateMany({
      where: {
        serviceExternalId: key.externalId,
        organizationId: key.workspaceId,
      },
      data: {
        accessToken: record.accessToken,
        refreshToken: record.refreshToken,
        expiresAt: new Date(record.expiresAt),
        status: "linked",
        principalProvisioned: true,
      },
    });
    // An in-flight mint must not recreate a connection deleted by disconnect().
    if (result.count !== 1) throw new Error("Link no longer exists");
  },

  async delete(key) {
    assertStorageNamespace(key);
    await prisma.base44Link.updateMany({
      where: {
        serviceExternalId: key.externalId,
        organizationId: key.workspaceId,
      },
      data: {
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        status: "pending",
      },
    });
  },
};

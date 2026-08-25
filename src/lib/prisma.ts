import { PrismaClient } from "@prisma/client";

// Next dev hot-reloads modules, which would otherwise open a new pool per reload
// until Postgres refuses connections. Stash the client on globalThis in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

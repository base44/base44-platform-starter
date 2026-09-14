import "server-only";
import { PrismaClient } from "../../generated/prisma";

const globalForDb = globalThis as unknown as { minimalPrisma?: PrismaClient };

export const prisma = globalForDb.minimalPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForDb.minimalPrisma = prisma;

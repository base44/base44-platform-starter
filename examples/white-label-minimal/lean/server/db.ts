import "server-only";
import { PrismaClient } from "../../generated/prisma";

// One client per server; in development it survives hot reloads.
const globalForDb = globalThis as unknown as { leanPrisma?: PrismaClient };
export const prisma = globalForDb.leanPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForDb.leanPrisma = prisma;

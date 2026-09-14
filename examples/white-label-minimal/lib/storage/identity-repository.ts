import "server-only";
import type { Prisma } from "../../generated/prisma";
import { prisma } from "./db";

export function withIdentityLock<T>(
  email: string,
  operation: (identities: Prisma.TransactionClient["base44Link"]) => Promise<T>,
) {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM base44_links WHERE app_user_email = ${email} FOR UPDATE`;
    return operation(db.base44Link);
  }, { timeout: 40_000 });
}

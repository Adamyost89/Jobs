import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  /** Bumped when Prisma schema gains models so dev HMR does not keep an outdated client. */
  prismaSchemaStamp?: string;
};

const SCHEMA_STAMP = "2026-04-snapshot";

function createPrisma(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrisma(): PrismaClient {
  const g = globalForPrisma;
  const client = g.prisma;
  const stampOk = g.prismaSchemaStamp === SCHEMA_STAMP;
  const hasSnapshotDelegate =
    !!client &&
    typeof (client as unknown as { spreadsheetSnapshot?: { findMany: unknown } }).spreadsheetSnapshot
      ?.findMany === "function";

  if (client && stampOk && hasSnapshotDelegate) {
    return client;
  }

  if (client) {
    void client.$disconnect().catch(() => {});
  }

  const fresh = createPrisma();
  g.prisma = fresh;
  g.prismaSchemaStamp = SCHEMA_STAMP;
  return fresh;
}

export const prisma = getPrisma();

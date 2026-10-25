import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

let walReady: Promise<void> | null = null;

export function ensureWal() {
  if (!walReady) {
    walReady = prisma
      .$queryRawUnsafe("PRAGMA journal_mode=WAL;")
      .then(() => undefined)
      .catch((error) => {
        walReady = null;
        throw error;
      });
  }
  return walReady;
}

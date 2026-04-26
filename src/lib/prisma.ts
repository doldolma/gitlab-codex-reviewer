import { PrismaClient } from "@prisma/client";
import { loadConfig } from "./config";

const config = loadConfig();
process.env.DATABASE_URL = config.databaseUrl;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type Db = PrismaClient;

export function nowIso(): string {
  return new Date().toISOString();
}

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

type Global = typeof globalThis & {
  prisma?: PrismaClient;
  pool?: Pool;
};

const globalForPrisma = globalThis as Global;

const getPool = () => {
  if (globalForPrisma.pool) return globalForPrisma.pool;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  // Match keyshade: do not force SSL; use connection string as-is.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c search_path=public',
  });
  
  if (process.env.NODE_ENV !== "production") globalForPrisma.pool = pool;
  return pool;
};

const prismaClientSingleton = () => {
  const adapter = new PrismaPg(getPool());
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query"] : ["error"],
  });
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

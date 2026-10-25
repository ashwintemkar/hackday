import { Pool } from 'pg';

// Cached on `globalThis` so Next.js dev's module hot-reload doesn't open a fresh
// pool (and leak connections) on every edit - same pattern Next.js docs recommend
// for any per-process resource held across route reloads.
declare global {
  var __ticketlyPgPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__ticketlyPgPool) {
    globalThis.__ticketlyPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return globalThis.__ticketlyPgPool;
}

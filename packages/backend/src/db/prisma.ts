// Prisma client singleton.
//
// The client is lazy — a real Prisma connection isn't established
// until something calls the exported getter. That matters because
// most of the codebase still runs against JSON-file persistence
// (`loadStore/saveStore`), and we don't want to require a running
// Postgres to boot the backend in development mode.
//
// When DATABASE_URL is set, the Prisma path becomes live. When it's
// unset, `getPrisma()` throws — routes should check `hasDatabase()`
// first (or use a repository that hides the branch entirely).

import { PrismaClient } from '@prisma/client';
import logger from '../lib/logger';

let cached: PrismaClient | null = null;

/**
 * Is a Postgres database configured? Read at every call so an
 * operator can toggle DATABASE_URL without a restart during
 * migration testing.
 */
export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Get the Prisma client, instantiating on first use. Throws if
 * DATABASE_URL is not set — callers should gate on `hasDatabase()`
 * first, or use a repository that does so on their behalf.
 */
export function getPrisma(): PrismaClient {
  if (cached) return cached;
  if (!hasDatabase()) {
    throw new Error(
      'DATABASE_URL is not set. The Postgres persistence path requires a live database — ' +
      'either set DATABASE_URL to a valid Postgres connection string, or use the JSON store path.',
    );
  }
  cached = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['warn', 'error']
      : ['error'],
  });
  logger.info('Prisma client initialised');
  return cached;
}

/**
 * Disconnect the Prisma client on shutdown. No-op if the client
 * was never instantiated.
 */
export async function disconnectPrisma(): Promise<void> {
  if (!cached) return;
  await cached.$disconnect();
  cached = null;
}

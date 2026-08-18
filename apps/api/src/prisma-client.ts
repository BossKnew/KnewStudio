import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export const DEFAULT_DATABASE_CONNECTION_LIMIT = 5;
export const DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS = 10;

function positiveInteger(value: string | null, fallback: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function databasePoolConfig(raw: string) {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error('DATABASE_URL must be a valid postgresql:// URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use postgresql://');
  if (!url.hostname) throw new Error('DATABASE_URL must include a hostname');

  const max = positiveInteger(url.searchParams.get('connection_limit'), DEFAULT_DATABASE_CONNECTION_LIMIT);
  const poolTimeoutSeconds = positiveInteger(url.searchParams.get('pool_timeout'), DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS);
  url.searchParams.delete('connection_limit');
  url.searchParams.delete('pool_timeout');

  return {
    connectionString: url.toString(),
    max,
    connectionTimeoutMillis: poolTimeoutSeconds * 1_000,
  };
}

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('Set DATABASE_URL/DATABASE_URL_FILE or POSTGRES_PASSWORD');
  return value;
}

export function prismaClientOptions(raw = databaseUrl()) {
  return { adapter: new PrismaPg(databasePoolConfig(raw)) };
}

export function createPrismaClient(raw = databaseUrl()) {
  return new PrismaClient(prismaClientOptions(raw));
}

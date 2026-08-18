import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const configDirectory = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(configDirectory, '../../.env'), quiet: true });

if (!process.env.DATABASE_URL && process.env.POSTGRES_PASSWORD) {
  const user = encodeURIComponent(process.env.POSTGRES_USER || 'knewstudio');
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
  const database = encodeURIComponent(process.env.POSTGRES_DB || 'knewstudio');
  process.env.DATABASE_URL = `postgresql://${user}:${password}@postgres:5432/${database}?connection_limit=5&pool_timeout=10`;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});

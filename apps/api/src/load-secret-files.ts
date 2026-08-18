import 'dotenv/config';
import { readFileSync } from 'node:fs';

for (const name of ['DATABASE_URL', 'REDIS_URL', 'PROVIDER_SECRET_KEY', 'PROVIDER_SECRET_KEYS', 'MFA_SECRET_KEY', 'MFA_SECRET_KEYS', 'MFA_SECRET_ACTIVE_KID', 'BOOTSTRAP_ADMIN_USERNAME', 'BOOTSTRAP_ADMIN_PASSWORD']) {
  const path = process.env[`${name}_FILE`];
  if (!process.env[name] && path) {
    const value = readFileSync(path, 'utf8').trim();
    if (!value) throw new Error(`${name}_FILE 指向了空文件`);
    process.env[name] = value;
  }
}

if (!process.env.DATABASE_URL) {
  if (!process.env.POSTGRES_PASSWORD) throw new Error('Set DATABASE_URL/DATABASE_URL_FILE or POSTGRES_PASSWORD');
  const user = encodeURIComponent(process.env.POSTGRES_USER || 'knewstudio');
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD || '');
  const database = encodeURIComponent(process.env.POSTGRES_DB || 'knewstudio');
  process.env.DATABASE_URL = `postgresql://${user}:${password}@postgres:5432/${database}?connection_limit=5&pool_timeout=10`;
}

import type { RedisOptions } from 'ioredis';

export function redisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  if (!process.env.REDIS_PASSWORD) throw new Error('Set REDIS_URL/REDIS_URL_FILE or REDIS_PASSWORD');
  return `redis://:${encodeURIComponent(process.env.REDIS_PASSWORD)}@redis:6379/0`;
}

export function parseRedisUrl(raw = redisUrl()): RedisOptions {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL'); }
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('REDIS_URL must use redis:// or rediss://');
  if (!url.hostname) throw new Error('REDIS_URL must include a hostname');
  const dbText = url.pathname.replace(/^\//, '') || '0';
  if (!/^\d+$/.test(dbText) || Number(dbText) > 15) throw new Error('REDIS_URL database must be an integer from 0 to 15');
  if (url.search || url.hash) throw new Error('REDIS_URL must not contain query parameters or fragments');

  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379)),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(dbText),
    ...(url.protocol === 'rediss:' ? { tls: { servername: url.hostname } } : {}),
  };
}

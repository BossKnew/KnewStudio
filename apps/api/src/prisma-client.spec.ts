import { DEFAULT_DATABASE_CONNECTION_LIMIT, DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS, databasePoolConfig } from './prisma-client';

describe('Prisma PostgreSQL adapter configuration', () => {
  it('uses bounded defaults and removes legacy Prisma pool parameters', () => {
    const config = databasePoolConfig('postgresql://user:pass@db.example:5432/app');
    expect(config).toMatchObject({
      max: DEFAULT_DATABASE_CONNECTION_LIMIT,
      connectionTimeoutMillis: DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS * 1_000,
    });
    expect(new URL(config.connectionString).search).toBe('');
  });

  it('maps legacy pool parameters to pg settings while preserving standard parameters', () => {
    const config = databasePoolConfig('postgresql://user:pass@db.example/app?connection_limit=12&pool_timeout=7&sslmode=require&schema=tenant');
    const url = new URL(config.connectionString);
    expect(config).toMatchObject({ max: 12, connectionTimeoutMillis: 7_000 });
    expect(url.searchParams.get('connection_limit')).toBeNull();
    expect(url.searchParams.get('pool_timeout')).toBeNull();
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.get('schema')).toBe('tenant');
  });

  it.each([
    ['0', '-1'],
    ['abc', '1.5'],
    ['', ''],
  ])('falls back for invalid pool values connection_limit=%s pool_timeout=%s', (connectionLimit, poolTimeout) => {
    const url = new URL('postgresql://user:pass@db.example/app');
    url.searchParams.set('connection_limit', connectionLimit);
    url.searchParams.set('pool_timeout', poolTimeout);
    expect(databasePoolConfig(url.toString())).toMatchObject({
      max: DEFAULT_DATABASE_CONNECTION_LIMIT,
      connectionTimeoutMillis: DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS * 1_000,
    });
  });

  it.each(['mysql://db.example/app', 'not-a-url'])('rejects invalid database URLs: %s', (url) => {
    expect(() => databasePoolConfig(url)).toThrow('DATABASE_URL');
  });
});

import { parseRedisUrl, redisUrl } from './redis-config';

describe('parseRedisUrl', () => {
  const originalUrl = process.env.REDIS_URL;
  const originalPassword = process.env.REDIS_PASSWORD;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = originalUrl;
    if (originalPassword === undefined) delete process.env.REDIS_PASSWORD; else process.env.REDIS_PASSWORD = originalPassword;
  });

  it('parses credentials and database numbers', () => {
    expect(parseRedisUrl('redis://user:p%40ss@redis.example:6381/4')).toMatchObject({
      host: 'redis.example', port: 6381, username: 'user', password: 'p@ss', db: 4, protocol: 2,
    });
  });

  it('enables TLS for rediss URLs', () => {
    expect(parseRedisUrl('rediss://cache.example/0')).toMatchObject({
      host: 'cache.example', port: 6380, tls: { servername: 'cache.example' },
    });
  });

  it.each(['http://cache.example', 'redis://cache.example/abc', 'redis://cache.example/16', 'redis://cache.example/0?tls=true'])('rejects invalid Redis URLs: %s', (url) => {
    expect(() => parseRedisUrl(url)).toThrow();
  });

  it('builds the bundled Redis URL only when a password is configured', () => {
    delete process.env.REDIS_URL;
    process.env.REDIS_PASSWORD = 'p@ss word';
    expect(redisUrl()).toBe('redis://:p%40ss%20word@redis:6379/0');
    delete process.env.REDIS_PASSWORD;
    expect(() => redisUrl()).toThrow('REDIS_PASSWORD');
  });
});

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';

const INCREMENT_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

const READ_WINDOW_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

const ACQUIRE_SCRIPT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = math.max(1, math.ceil((tonumber(oldest[2]) - now) / 1000))
  return { 0, retry }
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[1]) * 1000, ARGV[3])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]) + 1)
return { 1, tonumber(ARGV[1]) }
`;

const RELEASE_SCRIPT = `
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end
return removed
`;

@Injectable()
export class RateLimitService {
  constructor(private redis: RedisService) {}

  keyPart(value: string) { return createHash('sha256').update(value).digest('base64url').slice(0, 32); }

  async consume(scope: string, identity: string, limit: number, windowSeconds: number) {
    const [count, ttl] = await this.increment(this.key(scope, identity), windowSeconds);
    if (count > limit) this.reject(ttl);
  }

  async assertAvailable(scope: string, identity: string, limit: number) {
    const result = await this.redis.client.eval(READ_WINDOW_SCRIPT, 1, this.key(scope, identity)) as Array<number | string>;
    if (Number(result[0]) >= limit) this.reject(Number(result[1]));
  }

  async recordFailure(scope: string, identity: string, limit: number, windowSeconds: number) {
    const [count, ttl] = await this.increment(this.key(scope, identity), windowSeconds);
    if (count >= limit) this.reject(ttl);
  }

  async clear(scope: string, identity: string) {
    await this.redis.client.del(this.key(scope, identity));
  }

  async acquireConcurrency(scope: string, identity: string, limit: number, leaseSeconds: number) {
    const key = this.key(scope, identity);
    const token = randomUUID();
    const result = await this.redis.client.eval(ACQUIRE_SCRIPT, 1, key, leaseSeconds, limit, token) as Array<number | string>;
    if (Number(result[0]) !== 1) this.reject(Number(result[1]), 'CONCURRENCY_LIMITED');

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await this.redis.client.eval(RELEASE_SCRIPT, 1, key, token);
    };
  }

  private key(scope: string, identity: string) {
    return `rate:${scope}:${this.keyPart(identity)}`;
  }

  private async increment(key: string, windowSeconds: number): Promise<[number, number]> {
    const result = await this.redis.client.eval(INCREMENT_WINDOW_SCRIPT, 1, key, windowSeconds) as Array<number | string>;
    return [Number(result[0]), Number(result[1])];
  }

  private reject(ttl: number, errorCode = 'RATE_LIMITED'): never {
    throw new HttpException({
      statusCode: 429,
      errorCode,
      message: '请求过于频繁，请稍后重试',
      retryAfterSeconds: Math.max(1, ttl),
    }, HttpStatus.TOO_MANY_REQUESTS, { cause: undefined, description: 'rate limited' });
  }
}

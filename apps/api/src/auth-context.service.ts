import { Injectable } from '@nestjs/common';
import type { AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

const CACHE_SECONDS = 30;

@Injectable()
export class AuthContextService {
  private readonly pending = new Map<string, Promise<AuthUser | null>>();

  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async get(userId: string) {
    const key = this.key(userId);
    const cached = await this.redis.client.get(key);
    if (cached) {
      try { return JSON.parse(cached) as AuthUser; }
      catch { await this.redis.client.del(key); }
    }
    const existing = this.pending.get(userId);
    if (existing) return existing;
    let loading!: Promise<AuthUser | null>;
    loading = this.load(userId).finally(() => {
      if (this.pending.get(userId) === loading) this.pending.delete(userId);
    });
    this.pending.set(userId, loading);
    return loading;
  }

  async invalidate(userId: string) {
    this.pending.delete(userId);
    await this.redis.client.eval("redis.call('incr', KEYS[2]); return redis.call('del', KEYS[1])", 2, this.key(userId), this.versionKey(userId));
  }

  private async load(userId: string, retry = 0): Promise<AuthUser | null> {
    const version = await this.redis.client.get(this.versionKey(userId)) ?? '0';
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, displayName: true, role: true, status: true, mustChangePwd: true,
        mfaCredential: { select: { userId: true } },
        groupMemberships: { select: { groupId: true } },
      },
    });
    if (!user) return null;
    const context: AuthUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      role: user.role,
      status: user.status,
      mustChangePwd: user.mustChangePwd,
      mfaEnabled: Boolean(user.mfaCredential),
      mfaRequired: user.role === 'ADMIN',
      groupIds: user.groupMemberships.map(({ groupId }) => groupId),
    };
    const cached = await this.redis.client.eval(
      "if (redis.call('get', KEYS[2]) or '0') == ARGV[1] then redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end",
      2,
      this.key(userId),
      this.versionKey(userId),
      version,
      JSON.stringify(context),
      String(CACHE_SECONDS),
    );
    if (!Number(cached) && retry < 2) return this.load(userId, retry + 1);
    return context;
  }

  private key(userId: string) { return `auth-context:v1:${userId}`; }
  private versionKey(userId: string) { return `auth-context-version:v1:${userId}`; }
}

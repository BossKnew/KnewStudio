import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { securityConfig } from './security-config';
import { randomUUID } from 'node:crypto';

@Injectable()
export class QuotaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuotaService.name);
  private reconciliationTimer?: NodeJS.Timeout;
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async onModuleInit() {
    await this.reconcile().catch((error) => this.logger.warn(`quota reconciliation failed: ${error instanceof Error ? error.message : 'unknown'}`));
    this.reconciliationTimer = setInterval(() => void this.reconcile(), 60 * 60 * 1000);
    this.reconciliationTimer.unref();
  }

  onModuleDestroy() { if (this.reconciliationTimer) clearInterval(this.reconciliationTimer); }

  private exceeded(message: string) {
    return new HttpException({ statusCode: 429, errorCode: 'QUOTA_EXCEEDED', message, retryAfterSeconds: 60 }, HttpStatus.TOO_MANY_REQUESTS);
  }

  async ensure(userId: string) {
    await this.prisma.userUsage.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  async reserveStorage(userId: string, bytes: bigint) {
    await this.ensure(userId);
    const quota = securityConfig.storageBytesPerUser();
    if (bytes < 0n || bytes > quota) throw this.exceeded('用户媒体存储配额不足');
    const result = await this.prisma.userUsage.updateMany({
      where: { userId, storageBytes: { lte: quota - bytes } },
      data: { storageBytes: { increment: bytes } },
    });
    if (!result.count) throw this.exceeded('用户媒体存储配额不足');
  }

  async releaseStorage(userId: string, bytes: bigint) {
    await this.ensure(userId);
    if (bytes <= 0n) return;
    await this.prisma.$executeRaw`UPDATE "UserUsage" SET "storageBytes" = GREATEST("storageBytes" - ${bytes}, 0), "updatedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId}`;
  }

  async reserveJob(userId: string) {
    await this.ensure(userId);
    const lockKey = 'quota:active-jobs:lock';
    const lockToken = randomUUID();
    const acquired = await this.redis.client.set(lockKey, lockToken, 'PX', 5000, 'NX');
    if (!acquired) throw this.exceeded('任务配额正在更新，请稍后重试');
    try {
      const aggregate = await this.prisma.userUsage.aggregate({ _sum: { activeJobs: true } });
      if ((aggregate._sum.activeJobs ?? 0) >= securityConfig.queuedJobsGlobal()) throw this.exceeded('系统任务队列已满');
      const result = await this.prisma.userUsage.updateMany({
        where: { userId, activeJobs: { lt: securityConfig.activeJobsPerUser() } },
        data: { activeJobs: { increment: 1 } },
      });
      if (!result.count) throw this.exceeded('活动任务数量已达上限');
    } finally {
      await this.redis.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lockToken);
    }
  }

  async releaseJob(userId: string, jobId: string) {
    const claimed = await this.prisma.generationJob.updateMany({ where: { id: jobId, quotaReleased: false }, data: { quotaReleased: true } });
    if (!claimed.count) return;
    await this.prisma.$executeRaw`UPDATE "UserUsage" SET "activeJobs" = GREATEST("activeJobs" - 1, 0), "updatedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId}`;
  }

  async releaseJobSlot(userId: string) {
    await this.prisma.$executeRaw`UPDATE "UserUsage" SET "activeJobs" = GREATEST("activeJobs" - 1, 0), "updatedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId}`;
  }

  async reacquireJob(userId: string, jobId: string) {
    await this.reserveJob(userId);
    const claimed = await this.prisma.generationJob.updateMany({ where: { id: jobId, quotaReleased: true }, data: { quotaReleased: false } });
    if (!claimed.count) {
      await this.releaseJobSlot(userId);
      throw new Error('任务配额状态无效');
    }
  }

  async acquireSse(userId: string) {
    const key = `sse:${userId}`;
    const count = await this.redis.client.incr(key);
    await this.redis.client.expire(key, 1800);
    if (count > securityConfig.ssePerUser()) {
      await this.redis.client.decr(key);
      throw this.exceeded('实时连接数量已达上限');
    }
    return async () => { const remaining = await this.redis.client.decr(key); if (remaining <= 0) await this.redis.client.del(key); };
  }

  private async reconcile() {
    const lockKey = 'quota:reconciliation:lock';
    const token = randomUUID();
    if (!await this.redis.client.set(lockKey, token, 'EX', 300, 'NX')) return;
    try {
      const [usageRows, storageRows, jobRows] = await Promise.all([
        this.prisma.userUsage.findMany(),
        this.prisma.asset.groupBy({ by: ['userId'], where: { deletedAt: null }, _sum: { sizeBytes: true } }),
        this.prisma.generationJob.groupBy({ by: ['userId'], where: { status: { in: ['QUEUED', 'RUNNING'] } }, _count: { _all: true } }),
      ]);
      const storage = new Map(storageRows.map((row) => [row.userId, row._sum.sizeBytes ?? 0n]));
      const jobs = new Map(jobRows.map((row) => [row.userId, row._count._all]));
      for (const usage of usageRows) {
        const actualStorage = storage.get(usage.userId) ?? 0n;
        const actualJobs = jobs.get(usage.userId) ?? 0;
        if (usage.storageBytes !== actualStorage || usage.activeJobs !== actualJobs) {
          this.logger.warn(`quota drift userId=${usage.userId} storedBytes=${usage.storageBytes} actualBytes=${actualStorage} storedJobs=${usage.activeJobs} actualJobs=${actualJobs}`);
        }
      }
    } finally {
      await this.redis.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, token);
    }
  }
}

import { ConflictException, HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { securityConfig } from './security-config';
import { randomUUID } from 'node:crypto';
import { ACTIVE_JOB_STATUSES } from './domain-constants';
import type { AuthUser } from './common';
import { evaluatePolicies, evaluateVideoPolicies, eventsInWindow, quotaPoliciesFromGroups, retryAfterSeconds, usedImages, videoQuotaPoliciesFromGroups } from './generation-quota';

@Injectable()
export class QuotaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuotaService.name);
  private reconciliationTimer?: NodeJS.Timeout;
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async onModuleInit() {
    await this.ensureUsageRows();
    await this.prisma.globalUsage.upsert({ where: { id: 'global' }, create: { id: 'global' }, update: {} });
    await this.reconcile().catch((error) => this.logger.warn(`quota reconciliation failed: ${error instanceof Error ? error.message : 'unknown'}`));
    this.reconciliationTimer = setInterval(() => void this.reconcile(), 60 * 60 * 1000);
    this.reconciliationTimer.unref();
  }

  onModuleDestroy() { if (this.reconciliationTimer) clearInterval(this.reconciliationTimer); }

  private exceeded(message: string, retryAfterSeconds = 60) {
    return new HttpException({ statusCode: 429, errorCode: 'QUOTA_EXCEEDED', message, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }

  async reserveStorage(userId: string, bytes: bigint) {
    const quota = securityConfig.storageBytesPerUser();
    if (bytes < 0n || bytes > quota) throw this.exceeded('用户媒体存储配额不足');
    const result = await this.prisma.userUsage.updateMany({
      where: { userId, storageBytes: { lte: quota - bytes } },
      data: { storageBytes: { increment: bytes } },
    });
    if (!result.count) throw this.exceeded('用户媒体存储配额不足');
  }

  async releaseStorage(userId: string, bytes: bigint) {
    if (bytes <= 0n) return;
    await this.prisma.$executeRaw`UPDATE "UserUsage" SET "storageBytes" = GREATEST("storageBytes" - ${bytes}, 0), "updatedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId}`;
  }

  async reserveJobInTransaction(
    tx: Prisma.TransactionClient,
    user: Pick<AuthUser, 'id' | 'role' | 'groupIds'>,
    imageCount: number,
    context: { jobId: string; modelId?: string | null; kind: 'SUBMIT' | 'RETRY'; videoSeconds?: number },
  ) {
    const global = await tx.globalUsage.updateMany({
      where: { id: 'global', activeJobs: { lt: securityConfig.queuedJobsGlobal() } },
      data: { activeJobs: { increment: 1 } },
    });
    if (!global.count) throw this.exceeded('系统任务队列已满');
    const result = await tx.userUsage.updateMany({
      where: { userId: user.id, activeJobs: { lt: securityConfig.activeJobsPerUser() } },
      data: { activeJobs: { increment: 1 } },
    });
    if (!result.count) throw this.exceeded('活动任务数量已达上限');
    const videoSeconds = Math.max(0, Number(context.videoSeconds) || 0);
    if (imageCount > 0) await this.assertImageQuota(tx, user, imageCount);
    if (videoSeconds > 0) await this.assertVideoQuota(tx, user, videoSeconds);
    await tx.quotaEvent.create({
      data: { userId: user.id, jobId: context.jobId, modelId: context.modelId ?? null, imageCount, videoSeconds, kind: context.kind },
    });
  }

  async releaseJob(userId: string, jobId: string) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.generationJob.updateMany({ where: { id: jobId, quotaReleased: false }, data: { quotaReleased: true } });
      if (!claimed.count) return;
      await tx.$executeRaw`UPDATE "GlobalUsage" SET "activeJobs" = GREATEST("activeJobs" - 1, 0), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'global'`;
      await tx.$executeRaw`UPDATE "UserUsage" SET "activeJobs" = GREATEST("activeJobs" - 1, 0), "updatedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId}`;
    });
  }

  async reacquireJob(user: Pick<AuthUser, 'id' | 'role' | 'groupIds'>, jobId: string, imageCount: number, modelId?: string | null, videoSeconds = 0) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.generationJob.updateMany({
        where: { id: jobId, userId: user.id, status: 'FAILED', quotaReleased: true },
        data: { status: 'QUEUED', quotaReleased: false, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null },
      });
      if (!claimed.count) throw new ConflictException('任务状态已变化，请刷新后重试');
      await this.reserveJobInTransaction(tx, user, imageCount, { jobId, modelId, kind: 'RETRY', videoSeconds });
    });
  }

  async currentUsage(user: Pick<AuthUser, 'id' | 'role' | 'groupIds'>) {
    const now = new Date();
    const [usage, groups] = await Promise.all([
      this.prisma.userUsage.findUnique({ where: { userId: user.id }, select: { storageBytes: true } }),
      user.groupIds.length ? this.prisma.userGroup.findMany({
        where: { id: { in: user.groupIds } },
        select: { id: true, name: true, quotaWindow: true, quotaImages: true, videoQuotaWindow: true, quotaVideoSeconds: true },
        orderBy: { name: 'asc' },
      }) : Promise.resolve([]),
    ]);
    const policies = user.role === 'ADMIN' ? [] : quotaPoliciesFromGroups(groups);
    const videoPolicies = user.role === 'ADMIN' ? [] : videoQuotaPoliciesFromGroups(groups);
    const maxWindow = [...policies, ...videoPolicies].reduce((max, policy) => Math.max(max, policy.windowSeconds), 0);
    const events = maxWindow ? await this.prisma.quotaEvent.findMany({
      where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - maxWindow * 1000) } },
      select: { createdAt: true, imageCount: true, videoSeconds: true },
      orderBy: { createdAt: 'asc' },
    }) : [];
    const imageEvents = events.map((event) => ({ createdAt: event.createdAt, imageCount: event.imageCount }));
    const videoEvents = events.map((event) => ({ createdAt: event.createdAt, imageCount: event.videoSeconds, videoSeconds: event.videoSeconds }));
    return {
      storageBytes: usage?.storageBytes.toString() ?? '0',
      storageQuotaBytes: securityConfig.storageBytesPerUser().toString(),
      policies: policies.map((policy) => {
        const inWindow = eventsInWindow(imageEvents, now, policy.windowSeconds);
        const used = usedImages(inWindow);
        const remaining = Math.max(0, policy.images - used);
        const oldest = inWindow[0];
        return {
          groupId: policy.groupId,
          groupName: policy.name,
          window: policy.window,
          images: policy.images,
          used,
          remaining,
          resetAt: oldest ? new Date(oldest.createdAt.getTime() + policy.windowSeconds * 1000).toISOString() : null,
          retryAfterSeconds: remaining === 0 ? retryAfterSeconds(inWindow, policy.windowSeconds, policy.images, 1, now) : 0,
        };
      }),
      videoPolicies: videoPolicies.map((policy) => {
        const inWindow = eventsInWindow(videoEvents, now, policy.windowSeconds);
        const used = usedImages(inWindow);
        const remaining = Math.max(0, policy.seconds - used);
        const oldest = inWindow[0];
        return {
          groupId: policy.groupId,
          groupName: policy.name,
          window: policy.window,
          seconds: policy.seconds,
          used,
          remaining,
          resetAt: oldest ? new Date(oldest.createdAt.getTime() + policy.windowSeconds * 1000).toISOString() : null,
          retryAfterSeconds: remaining === 0 ? retryAfterSeconds(inWindow, policy.windowSeconds, policy.seconds, 1, now) : 0,
        };
      }),
    };
  }

  private async assertImageQuota(tx: Prisma.TransactionClient, user: Pick<AuthUser, 'id' | 'role' | 'groupIds'>, imageCount: number) {
    if (user.role === 'ADMIN' || !user.groupIds.length) return;
    const groups = await tx.userGroup.findMany({
      where: { id: { in: user.groupIds } },
      select: { id: true, name: true, quotaWindow: true, quotaImages: true },
    });
    const policies = quotaPoliciesFromGroups(groups);
    if (!policies.length) return;
    const now = new Date();
    const maxWindow = policies.reduce((max, policy) => Math.max(max, policy.windowSeconds), 0);
    const events = await tx.quotaEvent.findMany({
      where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - maxWindow * 1000) } },
      select: { createdAt: true, imageCount: true },
      orderBy: { createdAt: 'asc' },
    });
    const result = evaluatePolicies(policies, events, imageCount, now);
    if (!result.ok) throw this.exceeded('生成张数已达上限', result.retryAfterSeconds);
  }

  private async assertVideoQuota(tx: Prisma.TransactionClient, user: Pick<AuthUser, 'id' | 'role' | 'groupIds'>, videoSeconds: number) {
    if (user.role === 'ADMIN' || !user.groupIds.length) return;
    const groups = await tx.userGroup.findMany({
      where: { id: { in: user.groupIds } },
      select: { id: true, name: true, videoQuotaWindow: true, quotaVideoSeconds: true },
    });
    const policies = videoQuotaPoliciesFromGroups(groups);
    if (!policies.length) return;
    const now = new Date();
    const maxWindow = policies.reduce((max, policy) => Math.max(max, policy.windowSeconds), 0);
    const events = await tx.quotaEvent.findMany({
      where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - maxWindow * 1000) } },
      select: { createdAt: true, videoSeconds: true },
      orderBy: { createdAt: 'asc' },
    });
    const result = evaluateVideoPolicies(policies, events, videoSeconds, now);
    if (!result.ok) throw this.exceeded('视频生成秒数已达上限', result.retryAfterSeconds);
  }

  async acquireSse(userId: string) {
    const key = `sse:${userId}`;
    const count = await this.redis.client.incr(key);
    await this.redis.client.expire(key, 1800);
    if (count > securityConfig.ssePerUser()) {
      await this.redis.client.decr(key);
      throw this.exceeded('实时连接数量已达上限');
    }
    const renewal = setInterval(() => void this.redis.client.expire(key, 1800).catch(() => undefined), 5 * 60 * 1000);
    renewal.unref();
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      clearInterval(renewal);
      const remaining = await this.redis.client.decr(key);
      if (remaining <= 0) await this.redis.client.del(key);
    };
  }

  private async reconcile() {
    const lockKey = 'quota:reconciliation:lock';
    const token = randomUUID();
    if (!await this.redis.client.set(lockKey, token, 'EX', 300, 'NX')) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "GlobalUsage" WHERE "id" = 'global' FOR UPDATE`;
        const [usageRows, storageRows, jobRows] = await Promise.all([
          tx.userUsage.findMany(),
          tx.asset.groupBy({ by: ['userId'], where: { deletedAt: null, role: { not: 'THUMBNAIL' } }, _sum: { sizeBytes: true } }),
          tx.generationJob.groupBy({ by: ['userId'], where: { status: { in: [...ACTIVE_JOB_STATUSES] } }, _count: { _all: true } }),
        ]);
        const storage = new Map(storageRows.map((row) => [row.userId, row._sum.sizeBytes ?? 0n]));
        const jobs = new Map(jobRows.map((row) => [row.userId, row._count._all]));
        for (const usage of usageRows) {
          const actualStorage = storage.get(usage.userId) ?? 0n;
          const actualJobs = jobs.get(usage.userId) ?? 0;
          if (usage.storageBytes !== actualStorage || usage.activeJobs !== actualJobs) {
            this.logger.warn(`repairing quota drift userId=${usage.userId} storedBytes=${usage.storageBytes} actualBytes=${actualStorage} storedJobs=${usage.activeJobs} actualJobs=${actualJobs}`);
            await tx.userUsage.update({ where: { userId: usage.userId }, data: { storageBytes: actualStorage, activeJobs: actualJobs } });
          }
        }
        await tx.globalUsage.update({ where: { id: 'global' }, data: { activeJobs: [...jobs.values()].reduce((sum, value) => sum + value, 0) } });
      }, { isolationLevel: 'Serializable' });
    } finally {
      await this.redis.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, token);
    }
  }

  private async ensureUsageRows() {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    if (users.length) await this.prisma.userUsage.createMany({ data: users.map(({ id }) => ({ userId: id })), skipDuplicates: true });
  }
}

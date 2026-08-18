import { Injectable } from '@nestjs/common';
import { ACTIVE_JOB_STATUSES } from './domain-constants';
import { GenerationEventsService } from './generation-events.service';
import { PrismaService } from './prisma.service';
import { QuotaService } from './quota.service';

type TerminalStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

@Injectable()
export class GenerationLifecycleService {
  constructor(
    private prisma: PrismaService,
    private quota: QuotaService,
    private events: GenerationEventsService,
  ) {}

  async start(userId: string, jobId: string) {
    const result = await this.prisma.generationJob.updateMany({
      where: { id: jobId, userId, status: { in: [...ACTIVE_JOB_STATUSES] } },
      data: { status: 'RUNNING', startedAt: new Date(), errorCode: null, errorMessage: null },
    });
    if (result.count) await this.publish(userId, jobId);
    return Boolean(result.count);
  }

  async finish(userId: string, jobId: string, status: TerminalStatus, failure?: { code: string; message: string }) {
    const result = await this.prisma.generationJob.updateMany({
      where: { id: jobId, userId, status: { in: [...ACTIVE_JOB_STATUSES] } },
      data: {
        status,
        finishedAt: new Date(),
        errorCode: status === 'FAILED' ? failure?.code ?? 'GENERATION_FAILED' : null,
        errorMessage: status === 'FAILED' ? failure?.message ?? '图片生成失败' : null,
      },
    });
    await this.releaseAndPublish(userId, jobId);
    return Boolean(result.count);
  }

  async releaseAndPublish(userId: string, jobId: string) {
    await this.quota.releaseJob(userId, jobId);
    await this.publish(userId, jobId);
  }

  async publish(userId: string, jobId: string) {
    await this.events.publish(userId, jobId).catch(() => undefined);
  }
}

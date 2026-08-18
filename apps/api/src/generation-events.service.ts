import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from './redis.service';
import { PrismaService } from './prisma.service';
import { generationJobSelect, serializeGenerationJob } from './generation-response';

type GenerationEvent = ReturnType<typeof serializeGenerationJob>;
type Listener = (job: GenerationEvent) => void;

@Injectable()
export class GenerationEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationEventsService.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly subscriptions = new Map<string, Promise<void>>();
  private subscriber!: Redis;

  constructor(private redis: RedisService, private prisma: PrismaService) {}

  async onModuleInit() {
    this.subscriber = this.redis.client.duplicate({ enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: true });
    this.subscriber.on('message', (channel, jobId) => void this.deliver(channel, jobId));
    this.subscriber.on('error', (error) => this.logger.warn(`generation event subscriber error: ${error.message}`));
    await this.subscriber.connect();
  }

  async publish(userId: string, jobId: string) {
    await this.redis.client.publish(this.channel(userId), jobId);
  }

  async subscribe(userId: string, listener: Listener) {
    let listeners = this.listeners.get(userId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(userId, listeners);
    }
    listeners.add(listener);
    let subscription = this.subscriptions.get(userId);
    if (!subscription) {
      subscription = this.subscriber.subscribe(this.channel(userId)).then(() => undefined);
      this.subscriptions.set(userId, subscription);
    }
    try { await subscription; }
    catch (error) {
      listeners.delete(listener);
      if (!listeners.size) {
        this.listeners.delete(userId);
        this.subscriptions.delete(userId);
      }
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const current = this.listeners.get(userId);
      current?.delete(listener);
      if (current && !current.size) {
        this.listeners.delete(userId);
        this.subscriptions.delete(userId);
        await this.subscriber.unsubscribe(this.channel(userId));
      }
    };
  }

  async onModuleDestroy() {
    if (!this.subscriber) return;
    if (this.subscriber.status === 'ready') await this.subscriber.quit().catch(() => this.subscriber.disconnect());
    else this.subscriber.disconnect();
  }

  private async deliver(channel: string, jobId: string) {
    const userId = channel.slice('generation-events:v1:'.length);
    if (!this.listeners.get(userId)?.size) return;
    try {
      const job = await this.prisma.generationJob.findFirst({ where: { id: jobId, userId }, select: generationJobSelect });
      if (!job) return;
      const event = serializeGenerationJob(job);
      for (const listener of this.listeners.get(userId) ?? []) {
        try { listener(event); }
        catch (error) { this.logger.warn(`local generation event listener failed: ${error instanceof Error ? error.message : 'unknown'}`); }
      }
    } catch (error) {
      this.logger.warn(`generation event delivery failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  private channel(userId: string) { return `generation-events:v1:${userId}`; }
}

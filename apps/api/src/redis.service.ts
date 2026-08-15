import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { redisUrl } from './redis-config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(redisUrl(), {
      connectTimeout: 5_000,
      commandTimeout: 5_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  async onModuleDestroy() {
    if (this.client.status !== 'ready') {
      this.client.disconnect();
      return;
    }
    await this.client.quit().catch(() => this.client.disconnect());
  }
}

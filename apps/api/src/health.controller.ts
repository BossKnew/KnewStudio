import { Controller, Get } from '@nestjs/common';
import { Public } from './common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService, private redis: RedisService) {}
  @Public() @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    await this.redis.client.ping();
    return { status: 'ok', time: new Date().toISOString() };
  }
}

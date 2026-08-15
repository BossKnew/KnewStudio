import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';
import { QuotaService } from './quota.service';
import { parseBody } from './validation';
import { z } from 'zod';
import { generationJobSelect, serializeGenerationJob } from './generation-response';

const titleSchema = z.object({ title: z.string().trim().min(1).max(80) }).strict();

@Controller('conversations')
export class ConversationsController {
  constructor(private prisma: PrismaService, private storage: StorageService, private quota: QuotaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.conversation.findMany({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { jobs: true } } } });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const body = raw === undefined || (typeof raw === 'object' && raw !== null && !Object.keys(raw).length) ? { title: '新创作' } : parseBody(titleSchema, raw);
    const title = body.title;
    return this.prisma.conversation.create({ data: { userId: user.id, title } });
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, title: true, jobs: { orderBy: { createdAt: 'asc' }, select: generationJobSelect } },
    });
    if (!conversation) throw new NotFoundException();
    return { id: conversation.id, title: conversation.title, jobs: conversation.jobs.map(serializeGenerationJob) };
  }

  @Patch(':id')
  async rename(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(titleSchema, raw);
    const result = await this.prisma.conversation.updateMany({ where: { id, userId: user.id }, data: { title: body.title.trim().slice(0, 80) } });
    if (!result.count) throw new NotFoundException();
    return { ok: true };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, userId: user.id },
      select: { jobs: { select: { status: true, assets: { select: { objectKey: true, sizeBytes: true, deletedAt: true } } } } },
    });
    if (!conversation) throw new NotFoundException();
    if (conversation.jobs.some((job) => ['QUEUED', 'RUNNING'].includes(job.status))) throw new ConflictException('会话仍有活动任务，暂时不能删除');
    for (const asset of conversation.jobs.flatMap((job) => job.assets)) await this.storage.delete(asset.objectKey);
    const bytes = conversation.jobs.flatMap((job) => job.assets).filter((asset) => !asset.deletedAt).reduce((sum, asset) => sum + asset.sizeBytes, 0n);
    await this.prisma.conversation.delete({ where: { id } });
    if (bytes) await this.quota.releaseStorage(user.id, bytes);
    return { ok: true };
  }
}

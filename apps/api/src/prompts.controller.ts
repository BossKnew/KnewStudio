import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { cursorWhere, decodeCursor, encodeCursor, pageLimit } from './pagination';
import { parseBody } from './validation';

const favoriteSchema = z.object({ isFavorite: z.boolean() }).strict();

@Controller('prompts')
export class PromptsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('tab') rawTab?: string, @Query('limit') rawLimit?: string, @Query('cursor') rawCursor?: string) {
    const tab = rawTab === 'favorites' ? 'favorites' : 'history';
    const limit = pageLimit(rawLimit, 30);
    const cursor = decodeCursor(rawCursor);
    const where = {
      userId: user.id,
      ...(tab === 'favorites' ? { isFavorite: true } : {}),
      ...cursorWhere('lastUsedAt', cursor),
    };
    const rows = await this.prisma.promptEntry.findMany({
      where,
      orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { id: true, prompt: true, isFavorite: true, usageCount: true, lastUsedAt: true, createdAt: true },
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.lastUsedAt, last.id) : null,
    };
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(favoriteSchema, raw);
    const result = await this.prisma.promptEntry.updateMany({ where: { id, userId: user.id }, data: { isFavorite: body.isFavorite } });
    if (!result.count) throw new NotFoundException();
    return this.prisma.promptEntry.findFirstOrThrow({
      where: { id, userId: user.id },
      select: { id: true, prompt: true, isFavorite: true, usageCount: true, lastUsedAt: true, createdAt: true },
    });
  }
}

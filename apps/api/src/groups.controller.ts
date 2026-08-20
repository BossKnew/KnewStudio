import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthUser } from './common';
import { PrismaService } from './prisma.service';

@Controller('groups')
export class GroupsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.userGroup.findMany({
      where: user.role === 'ADMIN' ? undefined : { id: { in: user.groupIds ?? [] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }
}

import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { AuthService } from './auth.service';
import { assertPassword, CurrentUser, Roles, type AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';
import { parseBody, passwordSchema, safeText, uuidSchema } from './validation';
import { z } from 'zod';
import { QuotaService } from './quota.service';
import { hashPassword } from './password-hash';

const registrationSchema = z.object({ enabled: z.boolean() }).strict();
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).strict();
const resetSchema = z.object({ password: passwordSchema }).strict();
const resetMfaSchema = z.object({ actorCode: z.string().regex(/^\d{6}$/) }).strict();
const sessionDurationSchema = z.object({ duration: z.string().min(2).max(4) }).strict();
const userGroupSchema = z.object({ name: safeText(64), description: safeText(300).optional().nullable() }).strict();
const userGroupsAssignmentSchema = z.object({ groupIds: z.array(uuidSchema).max(100) }).strict();

@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private storage: StorageService,
    @InjectQueue('image-generation') private queue: Queue,
    private quota: QuotaService,
  ) {}

  @Get('settings')
  async settings() { return { registrationEnabled: await this.auth.registrationEnabled(), userSessionDuration: await this.auth.userSessionDuration(), adminSessionDuration: '1d' }; }

  @Patch('settings/registration')
  async registration(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const body = parseBody(registrationSchema, raw);
    await this.prisma.$transaction([
      this.prisma.systemSetting.upsert({ where: { key: 'registration_enabled' }, create: { key: 'registration_enabled', value: body.enabled }, update: { value: body.enabled } }),
      this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'registration.updated', targetType: 'setting', targetId: 'registration_enabled', metadata: { enabled: body.enabled } } }),
    ]);
    return { enabled: body.enabled };
  }

  @Patch('settings/session-duration')
  async sessionDuration(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const body = parseBody(sessionDurationSchema, raw);
    let duration: string;
    try { duration = await this.auth.updateUserSessionDuration(body.duration); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'session.duration.updated', targetType: 'setting', targetId: 'user_session_duration', metadata: { duration } } });
    return { duration };
  }

  @Get('users')
  async users() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, username: true, displayName: true, role: true, status: true, mustChangePwd: true, createdAt: true, updatedAt: true, mfaCredential: { select: { userId: true } }, groupMemberships: { select: { group: { select: { id: true, name: true } } }, orderBy: { group: { name: 'asc' } } }, _count: { select: { jobs: true, conversations: true } } },
    });
    const visibleAssets = await this.prisma.asset.groupBy({
      by: ['userId'],
      where: { role: { in: ['UPLOAD', 'OUTPUT'] }, deletedAt: null },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    });
    const assetMap = new Map(visibleAssets.map((item) => [item.userId, { count: item._count._all, sizeBytes: item._sum.sizeBytes?.toString() ?? '0' }]));
    return users.map((user) => {
      const assetStats = assetMap.get(user.id) ?? { count: 0, sizeBytes: '0' };
      const { mfaCredential, groupMemberships, ...publicUser } = user;
      return { ...publicUser, groups: groupMemberships?.map(({ group }) => group) ?? [], mfaEnabled: Boolean(mfaCredential), mfaRequired: user.role === 'ADMIN', _count: { ...user._count, assets: assetStats.count }, storageBytes: assetStats.sizeBytes };
    });
  }

  @Get('user-groups')
  userGroups() {
    return this.prisma.userGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true, models: true } } },
    });
  }

  @Post('user-groups')
  async createUserGroup(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const body = parseBody(userGroupSchema, raw);
    const name = body.name.trim();
    if (await this.prisma.userGroup.findUnique({ where: { name }, select: { id: true } })) throw new ConflictException('用户组名称已存在');
    const group = await this.prisma.userGroup.create({ data: { name, description: body.description?.trim() || null } });
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'user-group.created', targetType: 'user-group', targetId: group.id, metadata: { name } } });
    return group;
  }

  @Patch('user-groups/:id')
  async updateUserGroup(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(userGroupSchema.partial().strict(), raw);
    const name = body.name?.trim();
    if (name && await this.prisma.userGroup.findFirst({ where: { name, id: { not: id } }, select: { id: true } })) throw new ConflictException('用户组名称已存在');
    const group = await this.prisma.userGroup.update({ where: { id }, data: { ...(name ? { name } : {}), ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}) } });
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'user-group.updated', targetType: 'user-group', targetId: id } });
    return group;
  }

  @Delete('user-groups/:id')
  async deleteUserGroup(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const group = await this.prisma.userGroup.findUniqueOrThrow({ where: { id }, include: { _count: { select: { users: true, models: true } } } });
    if (group._count.users || group._count.models) throw new ConflictException('请先移除该组中的用户和模型权限，再删除用户组');
    await this.prisma.$transaction([
      this.prisma.userGroup.delete({ where: { id } }),
      this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'user-group.deleted', targetType: 'user-group', targetId: id, metadata: { name: group.name } } }),
    ]);
    return { ok: true };
  }

  @Patch('users/:id/groups')
  async userGroupsAssignment(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(userGroupsAssignmentSchema, raw);
    const groupIds = [...new Set(body.groupIds)];
    if (groupIds.length !== body.groupIds.length) throw new BadRequestException('用户组不能重复');
    if (groupIds.length && await this.prisma.userGroup.count({ where: { id: { in: groupIds } } }) !== groupIds.length) throw new BadRequestException('包含不存在的用户组');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({ where: { id }, select: { id: true } });
      await tx.userGroupMembership.deleteMany({ where: { userId: id } });
      if (groupIds.length) await tx.userGroupMembership.createMany({ data: groupIds.map((groupId) => ({ userId: id, groupId })) });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'user.groups.updated', targetType: 'user', targetId: id, metadata: { groupIds } } });
    });
    return { groupIds };
  }

  @Patch('users/:id/status')
  async userStatus(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(statusSchema, raw);
    if (actor.id === id && body.status !== 'ACTIVE') throw new BadRequestException('不能禁用自己的管理员账号');
    const user = await this.prisma.user.update({ where: { id }, data: { status: body.status }, select: { id: true, username: true, role: true, status: true } });
    if (body.status !== 'ACTIVE') {
      await this.auth.revokeUser(id);
      await this.cancelActiveJobs(id);
    }
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'user.status.updated', targetType: 'user', targetId: id, metadata: { status: body.status } } });
    return user;
  }

  @Post('users/:id/reset-password')
  async resetPassword(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(resetSchema, raw);
    const target = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) throw new BadRequestException('目标用户不存在');
    let password: string;
    try { password = assertPassword(body.password, target.role); } catch (error) { throw new BadRequestException((error as Error).message); }
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), mustChangePwd: true } });
    await this.auth.revokeUser(id);
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'user.password.reset', targetType: 'user', targetId: id } });
    return { ok: true };
  }

  @Post('users/:id/reset-mfa')
  async resetMfa(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(resetMfaSchema, raw);
    await this.auth.adminResetMfa(actor.id, id, body.actorCode);
    return { ok: true };
  }

  @Delete('users/:id')
  async deleteUser(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    if (actor.id === id) throw new BadRequestException('不能删除自己的管理员账号');
    const user = await this.prisma.user.update({ where: { id }, data: { status: 'DELETING' }, select: { id: true } });
    await this.auth.revokeUser(user.id);
    await this.cancelActiveJobs(id);
    await this.storage.deleteUser(id);
    await this.prisma.$transaction([
      this.prisma.user.delete({ where: { id } }),
      this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'user.deleted', targetType: 'user', targetId: id } }),
    ]);
    return { ok: true };
  }

  @Get('storage')
  async storageStats() {
    const result = await this.prisma.asset.aggregate({ where: { role: { in: ['UPLOAD', 'OUTPUT'] }, deletedAt: null }, _sum: { sizeBytes: true }, _count: true });
    return { assetCount: result._count, storageBytes: result._sum.sizeBytes?.toString() ?? '0' };
  }

  @Get('audit-logs')
  auditLogs() {
    return this.prisma.auditLog.findMany({ take: 200, orderBy: { createdAt: 'desc' }, select: { id: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true, actor: { select: { username: true } } } });
  }

  private async cancelActiveJobs(userId: string) {
    const jobs = await this.prisma.generationJob.findMany({
      where: { userId, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true, status: true },
    });
    const queuedIds = new Set(jobs.filter((job) => job.status === 'QUEUED').map((job) => job.id));
    if (queuedIds.size > 0) {
      const queuedJobs = await this.queue.getJobs(['waiting', 'delayed', 'prioritized', 'paused'], 0, -1, true);
      const matchingQueueJobs = queuedJobs.filter((queueJob) => queuedIds.has(String(queueJob.data?.jobId)));
      for (let index = 0; index < matchingQueueJobs.length; index += 8) {
        await Promise.all(matchingQueueJobs.slice(index, index + 8).map(async (queueJob) => {
          try { await queueJob.remove(); }
          catch { /* A worker may already have claimed or removed the job. */ }
        }));
      }
    }
    await this.prisma.generationJob.updateMany({
      where: { userId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    await Promise.all(jobs.map((job) => this.quota.releaseJob(userId, job.id)));
  }
}

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, ROLES } from './common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookieName } from './auth.controller';
import { AuthContextService } from './auth-context.service';
import { SESSION_PREFIX } from './domain-constants';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private reflector: Reflector, private redis: RedisService, private prisma: PrismaService, @Optional() private authContext?: AuthContextService) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.[cookieName()];
    if (!token) throw new UnauthorizedException('请先登录');
    const digest = createHash('sha256').update(token).digest('base64url');
    const rawSession = await this.redis.client.get(`${SESSION_PREFIX}${digest}`);
    if (!rawSession) throw new UnauthorizedException('登录已失效');
    let session: { userId: string; csrfToken: string; stage?: 'FULL' | 'PASSWORD_CHANGE'; mfaAuthenticated?: boolean };
    try { session = JSON.parse(rawSession); } catch { throw new UnauthorizedException('登录已失效'); }
    const userId = session.userId;
    const storedUser = this.authContext ? await this.authContext.get(userId) : await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, role: true, status: true, mustChangePwd: true, mfaCredential: { select: { userId: true } }, groupMemberships: { select: { groupId: true } } } });
    const user = storedUser && 'mfaEnabled' in storedUser ? storedUser : storedUser ? {
      id: storedUser.id, username: storedUser.username, displayName: storedUser.displayName ?? storedUser.username,
      role: storedUser.role, status: storedUser.status, mustChangePwd: storedUser.mustChangePwd,
      mfaEnabled: Boolean(storedUser.mfaCredential), mfaRequired: storedUser.role === 'ADMIN',
      groupIds: storedUser.groupMemberships?.map(({ groupId }) => groupId) ?? [],
    } : null;
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('账号不可用');
    const mfaEnabled = user.mfaEnabled;
    request.user = user;
    request.sessionCsrf = session.csrfToken;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const supplied = request.headers['x-csrf-token'];
      const expected = Buffer.from(session.csrfToken);
      const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ForbiddenException('CSRF 校验失败');
    }
    if ((user.mustChangePwd || session.stage === 'PASSWORD_CHANGE') && !['/api/v1/auth/change-password', '/api/v1/auth/logout', '/api/v1/auth/me'].includes(request.path)) {
      throw new ForbiddenException('必须先修改初始密码');
    }
    if (!user.mustChangePwd && session.stage !== 'PASSWORD_CHANGE' && ((mfaEnabled && !session.mfaAuthenticated) || (user.role === 'ADMIN' && !mfaEnabled))) {
      throw new ForbiddenException('必须完成双重验证');
    }
    const roles = this.reflector.getAllAndOverride<Array<'USER' | 'ADMIN'>>(ROLES, [context.getHandler(), context.getClass()]);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException('权限不足');
    return true;
  }
}

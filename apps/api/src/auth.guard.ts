import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, ROLES } from './common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookieName } from './auth.controller';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private reflector: Reflector, private redis: RedisService, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.[cookieName()];
    if (!token) throw new UnauthorizedException('请先登录');
    const digest = createHash('sha256').update(token).digest('base64url');
    const rawSession = await this.redis.client.get(`session:v2:${digest}`);
    if (!rawSession) throw new UnauthorizedException('登录已失效');
    let session: { userId: string; csrfToken: string; stage?: 'FULL' | 'PASSWORD_CHANGE'; mfaAuthenticated?: boolean };
    try { session = JSON.parse(rawSession); } catch { throw new UnauthorizedException('登录已失效'); }
    const userId = session.userId;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, role: true, status: true, mustChangePwd: true, mfaCredential: { select: { userId: true } }, groupMemberships: { select: { groupId: true } } } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('账号不可用');
    const mfaEnabled = Boolean(user.mfaCredential);
    request.user = { id: user.id, username: user.username, displayName: user.displayName ?? user.username, role: user.role, status: user.status, mustChangePwd: user.mustChangePwd, mfaEnabled, mfaRequired: user.role === 'ADMIN', groupIds: user.groupMemberships?.map(({ groupId }) => groupId) ?? [] };
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

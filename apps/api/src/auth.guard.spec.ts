import { ForbiddenException } from '@nestjs/common';
import { SessionGuard } from './auth.guard';

describe('SessionGuard security boundaries', () => {
  function context(request: any) {
    return {
      getHandler: () => ({}), getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
  }

  function guardFor(request: any) {
    const reflector = { getAllAndOverride: jest.fn((key: string) => key === 'isPublic' ? false : undefined) };
    const digestValue = JSON.stringify({ userId: 'admin-1', csrfToken: 'csrf-secret' });
    const redis = { client: { get: jest.fn().mockResolvedValue(digestValue) } };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin-1', username: 'admin', role: 'ADMIN', status: 'ACTIVE', mustChangePwd: true }) } };
    return { guard: new SessionGuard(reflector as any, redis as any, prisma as any), request };
  }

  it('does not exempt administrators from mandatory password changes', async () => {
    const request = { method: 'GET', path: '/api/v1/admin/users', cookies: { kv_session_dev: 'token' }, headers: {} };
    const { guard } = guardFor(request);
    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires the session-bound CSRF token on unsafe methods', async () => {
    const request: any = { method: 'POST', path: '/api/v1/auth/change-password', cookies: { kv_session_dev: 'token' }, headers: {} };
    const { guard } = guardFor(request);
    await expect(guard.canActivate(context(request))).rejects.toThrow('CSRF');
    request.headers['x-csrf-token'] = 'csrf-secret';
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
  });

  it('rejects a full administrator session that did not complete MFA', async () => {
    const request = { method: 'GET', path: '/api/v1/admin/users', cookies: { kv_session_dev: 'token' }, headers: {} };
    const reflector = { getAllAndOverride: jest.fn((key: string) => key === 'isPublic' ? false : undefined) };
    const redis = { client: { get: jest.fn().mockResolvedValue(JSON.stringify({ userId: 'admin-1', csrfToken: 'csrf-secret', stage: 'FULL', mfaAuthenticated: false })) } };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin-1', username: 'admin', role: 'ADMIN', status: 'ACTIVE', mustChangePwd: false, mfaCredential: null }) } };
    const guard = new SessionGuard(reflector as any, redis as any, prisma as any);
    await expect(guard.canActivate(context(request))).rejects.toThrow('双重验证');
  });

  it('does not allow an MFA-enabled user to reuse a password-only session', async () => {
    const request = { method: 'GET', path: '/api/v1/models', cookies: { kv_session_dev: 'token' }, headers: {} };
    const reflector = { getAllAndOverride: jest.fn((key: string) => key === 'isPublic' ? false : undefined) };
    const redis = { client: { get: jest.fn().mockResolvedValue(JSON.stringify({ userId: 'user-1', csrfToken: 'csrf-secret', stage: 'FULL', mfaAuthenticated: false })) } };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', username: 'user', role: 'USER', status: 'ACTIVE', mustChangePwd: false, mfaCredential: { userId: 'user-1' } }) } };
    const guard = new SessionGuard(reflector as any, redis as any, prisma as any);
    await expect(guard.canActivate(context(request))).rejects.toThrow('双重验证');
  });
});

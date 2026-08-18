import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

describe('AuthService MFA login state machine', () => {
  async function fixture(user: any) {
    const password = 'correct horse battery staple';
    if (user) user.passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue({ value: '2w' }) },
    };
    const tx: any = { set: jest.fn(), zadd: jest.fn(), expire: jest.fn(), zrem: jest.fn(), del: jest.fn(), exec: jest.fn().mockResolvedValue([]) };
    Object.values(tx).forEach((method: any) => { if (method?.mockReturnValue) method.mockReturnValue(tx); });
    tx.exec.mockResolvedValue([]);
    const redis = { client: { multi: jest.fn(() => tx), zrange: jest.fn().mockResolvedValue([]) } };
    const limits = {
      consume: jest.fn(),
      assertAvailable: jest.fn(),
      recordFailure: jest.fn(),
      clear: jest.fn(),
      keyPart: jest.fn(() => 'source'),
    };
    const mfa = {
      requiredFor: jest.fn((role: string) => role === 'ADMIN'),
      createLoginChallenge: jest.fn().mockResolvedValue({ token: 'challenge', maxAgeMs: 300000 }),
      createSetupChallenge: jest.fn().mockResolvedValue({ token: 'setup', maxAgeMs: 300000 }),
    };
    return { service: new AuthService(prisma as any, redis as any, limits as any, mfa as any), password, tx, redis, mfa, limits };
  }

  it('does not create a formal session before an enrolled factor is verified', async () => {
    const { service, password, tx, mfa } = await fixture({ id: 'u1', username: 'user', role: 'USER', status: 'ACTIVE', mustChangePwd: false, mfaCredential: { userId: 'u1' } });
    await expect(service.login('user', password, '127.0.0.1')).resolves.toMatchObject({ next: 'MFA_REQUIRED' });
    expect(mfa.createLoginChallenge).toHaveBeenCalledWith('u1', false);
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('forces an administrator without a factor into enrollment', async () => {
    const { service, password, tx, mfa } = await fixture({ id: 'a1', username: 'admin', role: 'ADMIN', status: 'ACTIVE', mustChangePwd: false, mfaCredential: null });
    await expect(service.login('admin', password, '127.0.0.1')).resolves.toMatchObject({ next: 'MFA_ENROLLMENT_REQUIRED' });
    expect(mfa.createSetupChallenge).toHaveBeenCalledWith('a1', false, false);
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('allows an optional user without MFA and writes only the v2 session namespace', async () => {
    const { service, password, tx, redis } = await fixture({ id: 'u2', username: 'normal', role: 'USER', status: 'ACTIVE', mustChangePwd: false, mfaCredential: null });
    const result: any = await service.login('normal', password, '127.0.0.1');
    expect(result).toMatchObject({ next: 'AUTHENTICATED' });
    expect(tx.set.mock.calls[0][0]).toMatch(/^session:v2:/);
    expect(redis.client.zrange).toHaveBeenCalledWith('user_sessions:v2:u2', '0', '-11');
    expect(result.session.maxAgeMs).toBeUndefined();
  });

  it('revokes indexed sessions with ioredis 6 string range arguments', async () => {
    const { service, redis, tx } = await fixture(null);
    redis.client.zrange.mockResolvedValue(['digest-one', 'digest-two']);

    await service.revokeUser('u5');

    expect(redis.client.zrange).toHaveBeenCalledWith('user_sessions:v2:u5', '0', '-1');
    expect(tx.del).toHaveBeenCalledWith('session:v2:digest-one');
    expect(tx.del).toHaveBeenCalledWith('session:v2:digest-two');
    expect(tx.del).toHaveBeenCalledWith('user_sessions:v2:u5');
  });

  it('uses the configured duration only when a regular user remembers the login', async () => {
    const { service, password, tx } = await fixture({ id: 'u3', username: 'remembered', role: 'USER', status: 'ACTIVE', mustChangePwd: false, mfaCredential: null });
    const result: any = await service.login('remembered', password, '127.0.0.1', true);
    expect(tx.set.mock.calls[0][3]).toBe(14 * 24 * 60 * 60);
    expect(result.session.maxAgeMs).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('keeps administrator sessions fixed at one day', async () => {
    const user = { id: 'a2', username: 'admin2', role: 'ADMIN', status: 'ACTIVE', mustChangePwd: false, mfaCredential: { userId: 'a2' } };
    const { service, tx } = await fixture(user);
    const session = await (service as any).createSession(user, 'FULL', true, 'totp', true);
    expect(tx.set.mock.calls[0][3]).toBe(24 * 60 * 60);
    expect(session.maxAgeMs).toBe(24 * 60 * 60 * 1000);
  });

  it('records account failures and clears them after a valid password', async () => {
    const invalid = await fixture(null);
    await expect(invalid.service.login('missing', 'wrong', '127.0.0.1')).rejects.toThrow();
    expect(invalid.limits.assertAvailable).toHaveBeenCalledWith('login-account-failure', 'missing', 30);
    expect(invalid.limits.recordFailure).toHaveBeenCalledWith('login-account-failure', 'missing', 30, 600);

    const valid = await fixture({ id: 'u4', username: 'valid', role: 'USER', status: 'ACTIVE', mustChangePwd: false, mfaCredential: null });
    await valid.service.login('valid', valid.password, '127.0.0.1');
    expect(valid.limits.clear).toHaveBeenCalledWith('login-account-failure', 'valid');
    expect(valid.limits.recordFailure).not.toHaveBeenCalled();
  });
});

import { AuthContextService } from './auth-context.service';

describe('AuthContextService', () => {
  it('coalesces cold reads and invalidates the Redis snapshot', async () => {
    const values = new Map<string, string>();
    const redis: any = { client: {
      get: jest.fn(async (key: string) => values.get(key) ?? null),
      del: jest.fn(async (key: string) => { values.delete(key); return 1; }),
      eval: jest.fn(async (script: string, _keys: number, cacheKey: string, versionKey: string, ...args: string[]) => {
        if (script.includes("'incr'")) {
          values.set(versionKey, String(Number(values.get(versionKey) ?? '0') + 1));
          const existed = values.delete(cacheKey);
          return existed ? 1 : 0;
        }
        const [expectedVersion, payload] = args;
        if ((values.get(versionKey) ?? '0') !== expectedVersion) return 0;
        values.set(cacheKey, payload);
        return 1;
      }),
    }};
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({
      id: 'user-1', username: 'alice', displayName: null, role: 'USER', status: 'ACTIVE', mustChangePwd: false,
      mfaCredential: null, groupMemberships: [{ groupId: 'group-1' }],
    }) } };
    const service = new AuthContextService(prisma, redis);

    const [first, second] = await Promise.all([service.get('user-1'), service.get('user-1')]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ displayName: 'alice', groupIds: ['group-1'], mfaEnabled: false });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    await service.invalidate('user-1');
    await service.get('user-1');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});

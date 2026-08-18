import { MfaService } from './mfa.service';

describe('MfaService login challenge metadata', () => {
  it('carries the remember-login choice through the MFA challenge', async () => {
    const redis = { client: { set: jest.fn().mockResolvedValue('OK') } };
    const service = new MfaService({} as any, redis as any, {} as any, {} as any);
    await service.createLoginChallenge('user-1', true);
    const stored = JSON.parse(redis.client.set.mock.calls[0][1]);
    expect(stored).toMatchObject({ userId: 'user-1', purpose: 'LOGIN', remember: true });
    expect(redis.client.set.mock.calls[0].slice(2)).toEqual(['EX', 300]);
  });
});

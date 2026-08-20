import { UsageController } from './usage.controller';

describe('UsageController', () => {
  it('returns the current user usage snapshot', async () => {
    const quota: any = { currentUsage: jest.fn().mockResolvedValue({ storageBytes: '10', storageQuotaBytes: '100', policies: [] }) };
    const user = { id: 'user-1', role: 'USER', groupIds: ['intern'] } as any;
    await expect(new UsageController(quota).current(user)).resolves.toEqual({ storageBytes: '10', storageQuotaBytes: '100', policies: [] });
    expect(quota.currentUsage).toHaveBeenCalledWith(user);
  });
});

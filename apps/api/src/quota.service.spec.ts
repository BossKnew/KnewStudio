import { QuotaService } from './quota.service';

describe('QuotaService atomic job counters', () => {
  it('increments global and user counters through the same transaction client', async () => {
    const tx: any = {
      globalUsage: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userUsage: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new QuotaService({} as any, {} as any);
    await service.reserveJobInTransaction(tx, 'user-1');
    expect(tx.globalUsage.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.userUsage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }));
  });

  it('releases an SSE quota slot at most once', async () => {
    const client = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      decr: jest.fn().mockResolvedValue(0),
      del: jest.fn().mockResolvedValue(1),
    };
    const service = new QuotaService({} as any, { client } as any);
    const release = await service.acquireSse('user-1');

    await Promise.all([release(), release()]);

    expect(client.decr).toHaveBeenCalledTimes(1);
    expect(client.del).toHaveBeenCalledTimes(1);
  });
});

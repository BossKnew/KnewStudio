import { QuotaService } from './quota.service';

describe('QuotaService atomic job counters', () => {
  it('increments global and user counters through the same transaction client', async () => {
    const tx: any = {
      globalUsage: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userUsage: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      quotaEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new QuotaService({} as any, {} as any);
    await service.reserveJobInTransaction(tx, { id: 'user-1', role: 'ADMIN', groupIds: [] }, 2, { jobId: 'job-1', modelId: 'model-1', kind: 'SUBMIT' });
    expect(tx.globalUsage.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.userUsage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }));
    expect(tx.quotaEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', jobId: 'job-1', imageCount: 2, kind: 'SUBMIT' }),
    }));
  });

  it('rejects a member whose sliding window is already full before writing an event', async () => {
    const now = Date.now();
    const tx: any = {
      globalUsage: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userUsage: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userGroup: { findMany: jest.fn().mockResolvedValue([{ id: 'intern', name: 'Intern', quotaWindow: '5h', quotaImages: 5 }]) },
      quotaEvent: {
        findMany: jest.fn().mockResolvedValue([{ createdAt: new Date(now - 60_000), imageCount: 5 }]),
        create: jest.fn(),
      },
    };
    const service = new QuotaService({} as any, {} as any);
    await expect(service.reserveJobInTransaction(tx, { id: 'user-1', role: 'USER', groupIds: ['intern'] }, 1, { jobId: 'job-1', kind: 'SUBMIT' })).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({ message: '生成张数已达上限' }),
    });
    expect(tx.quotaEvent.create).not.toHaveBeenCalled();
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

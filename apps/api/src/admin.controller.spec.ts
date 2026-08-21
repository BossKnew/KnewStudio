import { AdminController } from './admin.controller';

describe('AdminController user statistics', () => {
  it('counts only visible, non-deleted library assets', async () => {
    const prisma: any = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-1', username: 'alice', displayName: null, role: 'USER', status: 'ACTIVE', mustChangePwd: false, createdAt: new Date(), updatedAt: new Date(), usage: { storageBytes: 4096n }, mfaCredential: null, groupMemberships: [], _count: { jobs: 4, conversations: 2, assets: 3 } }]) },
    };
    const controller = new AdminController(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result = await controller.users();

    expect(result.items[0]).toMatchObject({ _count: { jobs: 4, conversations: 2, assets: 3 }, storageBytes: '4096' });
  });

  it('uses the shared cancellation flow when disabling a user', async () => {
    const queued = { remove: jest.fn().mockResolvedValue(undefined) };
    const unrelated = { remove: jest.fn().mockResolvedValue(undefined) };
    const lifecycle = { releaseAndPublish: jest.fn().mockResolvedValue(undefined) };
    const prisma: any = {
      user: { update: jest.fn().mockResolvedValue({ id: 'user-1', username: 'alice', role: 'USER', status: 'DISABLED' }) },
      generationJob: { findMany: jest.fn().mockResolvedValue([{ id: 'queued-1', status: 'QUEUED' }, { id: 'running-1', status: 'RUNNING' }]), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const auth = { revokeUser: jest.fn().mockResolvedValue(undefined) };
    const queue = {
      getJobs: jest.fn().mockResolvedValue([
        { id: 'retry-queued-1-123', data: { jobId: 'queued-1' }, ...queued },
        { id: 'another-job', data: { jobId: 'another-database-job' }, ...unrelated },
      ]),
    };
    const videoQueue = { getJobs: jest.fn().mockResolvedValue([]) };
    const controller = new AdminController(prisma, auth as any, {} as any, queue as any, videoQueue as any, { invalidate: jest.fn().mockResolvedValue(undefined) } as any, lifecycle as any);

    await controller.userStatus({ id: 'admin-1' } as any, 'user-1', { status: 'DISABLED' });

    expect(queue.getJobs).toHaveBeenCalledWith(['waiting', 'delayed', 'prioritized'], 0, -1, true);
    expect(queued.remove).toHaveBeenCalledTimes(1);
    expect(unrelated.remove).not.toHaveBeenCalled();
    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
    expect(lifecycle.releaseAndPublish).toHaveBeenCalledTimes(2);
  });
});

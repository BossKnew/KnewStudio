import { BadRequestException } from '@nestjs/common';
import { GenerationsController } from './generations.controller';

describe('GenerationsController retry', () => {
  const user = { id: 'user-1', role: 'USER', groupIds: ['editors'] } as any;
  let prisma: any;
  let queue: any;
  let storage: any;
  let limits: any;
  let quota: any;
  let controller: GenerationsController;

  beforeEach(() => {
    prisma = {
      generationJob: { findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
      asset: { findMany: jest.fn(), deleteMany: jest.fn() },
      conversation: { update: jest.fn() },
    };
    queue = { add: jest.fn().mockResolvedValue({}) };
    storage = { delete: jest.fn().mockResolvedValue(undefined) };
    limits = { consume: jest.fn().mockResolvedValue(undefined) };
    quota = {
      reserveJob: jest.fn().mockResolvedValue(undefined), releaseJobSlot: jest.fn().mockResolvedValue(undefined), releaseJob: jest.fn().mockResolvedValue(undefined),
      reacquireJob: jest.fn().mockResolvedValue(undefined), releaseStorage: jest.fn().mockResolvedValue(undefined), acquireSse: jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined)),
    };
    controller = new GenerationsController(prisma, queue, storage, limits, quota);
  });

  it('requeues a failed job with its original source and mask', async () => {
    prisma.generationJob.findFirst.mockResolvedValue({
      id: 'job-1', userId: 'user-1', conversationId: 'conversation-1', status: 'FAILED', mode: 'INPAINT',
      parameters: { sourceAssetIds: ['source-1'], maskAssetId: 'mask-1', size: '1024x1024', quality: 'standard', count: 1 },
      model: { enabled: true, provider: { enabled: true, archivedAt: null }, allowedGroups: [{ groupId: 'editors' }] },
      assets: [{ id: 'partial-output', objectKey: 'user-1/partial.png' }],
    });
    prisma.asset.findMany.mockResolvedValue([{ id: 'source-1' }, { id: 'mask-1' }]);
    prisma.asset.deleteMany.mockResolvedValue({ count: 1 });
    prisma.generationJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.conversation.update.mockResolvedValue({});

    const result = await controller.retry(user, 'job-1');

    expect(result).toEqual({ id: 'job-1', conversationId: 'conversation-1', status: 'QUEUED' });
    expect(storage.delete).toHaveBeenCalledWith('user-1/partial.png');
    expect(prisma.asset.deleteMany).toHaveBeenCalledWith({ where: { jobId: 'job-1', role: 'OUTPUT' } });
    expect(queue.add).toHaveBeenCalledWith('generate', { jobId: 'job-1' }, expect.objectContaining({ attempts: 3 }));
  });

  it('refuses retry when the retained mask no longer exists', async () => {
    prisma.generationJob.findFirst.mockResolvedValue({
      id: 'job-1', userId: 'user-1', conversationId: 'conversation-1', status: 'FAILED', mode: 'INPAINT',
      parameters: { sourceAssetIds: ['source-1'], maskAssetId: 'mask-1' },
      model: { enabled: true, provider: { enabled: true, archivedAt: null }, allowedGroups: [{ groupId: 'editors' }] }, assets: [],
    });
    prisma.asset.findMany.mockResolvedValue([{ id: 'source-1' }]);

    await expect(controller.retry(user, 'job-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses retry after the user loses access to the model group', async () => {
    prisma.generationJob.findFirst.mockResolvedValue({
      id: 'job-1', userId: 'user-1', conversationId: 'conversation-1', status: 'FAILED', mode: 'TEXT_TO_IMAGE', parameters: {},
      model: { enabled: true, provider: { enabled: true, archivedAt: null }, allowedGroups: [{ groupId: 'premium' }] }, assets: [],
    });

    await expect(controller.retry({ id: 'user-1', role: 'USER', groupIds: ['free'] } as any, 'job-1')).rejects.toThrow('模型或供应商已不可用');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('releases the SSE quota and does not overlap slow job reads', async () => {
    jest.useFakeTimers();
    let resolveJob: ((job: any) => void) | undefined;
    const release = jest.fn().mockResolvedValue(undefined);
    quota.acquireSse.mockResolvedValue(release);
    prisma.generationJob.findFirst.mockImplementation(() => new Promise((resolve) => { resolveJob = resolve; }));
    const subscription = controller.events(user, 'job-1').subscribe();

    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(3_000);
    expect(prisma.generationJob.findFirst).toHaveBeenCalledTimes(1);

    resolveJob?.({ id: 'job-1', status: 'SUCCEEDED', assets: [] });
    await Promise.resolve();
    subscription.unsubscribe();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('releases SSE quota when the client disconnects before acquisition resolves', async () => {
    let resolveAcquire!: (release: () => Promise<void>) => void;
    const release = jest.fn().mockResolvedValue(undefined);
    quota.acquireSse.mockReturnValue(new Promise((resolve) => { resolveAcquire = resolve; }));

    const subscription = controller.events(user, 'job-1').subscribe();
    subscription.unsubscribe();
    resolveAcquire(release);
    await Promise.resolve();
    await Promise.resolve();

    expect(release).toHaveBeenCalledTimes(1);
    expect(prisma.generationJob.findFirst).not.toHaveBeenCalled();
  });
});

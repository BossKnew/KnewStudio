import { BadRequestException } from '@nestjs/common';
import { GenerationsController } from './generations.controller';

describe('GenerationsController retry', () => {
  const user = { id: 'user-1', role: 'USER', groupIds: ['editors'] } as any;
  let prisma: any;
  let queue: any;
  let assets: any;
  let lifecycle: any;
  let events: any;
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
    assets = { removeJobOutputs: jest.fn().mockResolvedValue(0n) };
    lifecycle = { publish: jest.fn().mockResolvedValue(undefined), finish: jest.fn().mockResolvedValue(true) };
    events = { publish: jest.fn().mockResolvedValue(undefined), subscribe: jest.fn() };
    limits = { consume: jest.fn().mockResolvedValue(undefined) };
    quota = {
      releaseJob: jest.fn().mockResolvedValue(undefined),
      reacquireJob: jest.fn().mockResolvedValue(undefined), releaseStorage: jest.fn().mockResolvedValue(undefined), acquireSse: jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined)),
    };
    controller = new GenerationsController(prisma, queue, limits, quota, assets, lifecycle, events);
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
    expect(assets.removeJobOutputs).toHaveBeenCalledWith('user-1', 'job-1');
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

  it('releases the SSE quota and performs no database polling while idle', async () => {
    jest.useFakeTimers();
    let listener: ((job: any) => void) | undefined;
    const release = jest.fn().mockResolvedValue(undefined);
    const unsubscribe = jest.fn().mockResolvedValue(undefined);
    quota.acquireSse.mockResolvedValue(release);
    events.subscribe.mockImplementation(async (_userId: string, callback: (job: any) => void) => { listener = callback; return unsubscribe; });
    const completedJob = { id: 'job-1', conversationId: 'conversation-1', status: 'SUCCEEDED', mode: 'TEXT_TO_IMAGE', prompt: 'done', errorMessage: null, parameters: {}, modelSnapshot: {}, assets: [] };
    const subscription = controller.events(user).subscribe();

    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(60_000);
    expect(prisma.generationJob.findFirst).not.toHaveBeenCalled();
    listener?.(completedJob);
    await Promise.resolve();
    expect(prisma.generationJob.findFirst).not.toHaveBeenCalled();
    subscription.unsubscribe();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('releases SSE quota when the client disconnects before acquisition resolves', async () => {
    let resolveAcquire!: (release: () => Promise<void>) => void;
    const release = jest.fn().mockResolvedValue(undefined);
    quota.acquireSse.mockReturnValue(new Promise((resolve) => { resolveAcquire = resolve; }));

    const subscription = controller.events(user).subscribe();
    subscription.unsubscribe();
    resolveAcquire(release);
    await Promise.resolve();
    await Promise.resolve();

    expect(release).toHaveBeenCalledTimes(1);
    expect(prisma.generationJob.findFirst).not.toHaveBeenCalled();
  });
});

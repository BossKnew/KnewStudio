import { ConversationsController } from './conversations.controller';

describe('ConversationsController asset cleanup', () => {
  it('keeps deleted outputs in history without exposing a content URL', async () => {
    const prisma: any = { conversation: { findFirst: jest.fn().mockResolvedValue({
      id: 'conversation-1',
      title: 'History',
      jobs: [{ id: 'job-1', status: 'SUCCEEDED', mode: 'TEXT_TO_IMAGE', prompt: 'test', errorMessage: null, parameters: { count: 1, sourceAssetIds: ['private'] }, modelSnapshot: { displayName: 'Public name', upstreamModelId: 'private-model', providerName: 'private-provider' }, assets: [{ id: 'asset-1', role: 'OUTPUT', objectKey: 'user-1/deleted.png', mimeType: 'image/png', width: 10, height: 10, sizeBytes: 1024n, deletedAt: new Date() }] }],
    }) } };
    const controller = new ConversationsController(prisma, {} as any, { releaseStorage: jest.fn().mockResolvedValue(undefined) } as any);

    const result = await controller.get({ id: 'user-1' } as any, 'conversation-1');

    expect(result.jobs[0].assets[0]).toMatchObject({ id: 'asset-1', deleted: true, contentUrl: null, sizeBytes: '1024' });
    expect((result.jobs[0].assets[0] as any).objectKey).toBeUndefined();
    expect(result.jobs[0].modelSnapshot).toEqual({ displayName: 'Public name' });
    expect(result.jobs[0].parameters).toEqual({ count: 1 });
    expect((result.jobs[0] as any).userId).toBeUndefined();
  });

  it('deletes every output and retained mask with the conversation after confirmation reaches the API', async () => {
    const transaction: any = {
      asset: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      conversation: { delete: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conversation-1', jobs: [{ status: 'SUCCEEDED', parameters: {}, assets: [
          { id: 'output-1', objectKey: 'user-1/output.png', sizeBytes: 6n, deletedAt: null, role: 'OUTPUT' },
          { id: 'mask-1', objectKey: 'user-1/mask.png', sizeBytes: 4n, deletedAt: null, role: 'MASK' },
        ] }] }),
      },
      $transaction: jest.fn((callback: any) => callback(transaction)),
    };
    const storage: any = { deleteMany: jest.fn().mockResolvedValue(undefined) };
    const controller = new ConversationsController(prisma, storage, { releaseStorage: jest.fn().mockResolvedValue(undefined) } as any);

    await expect(controller.remove({ id: 'user-1' } as any, 'conversation-1')).resolves.toEqual({ ok: true, deletedAssetIds: ['output-1'] });
    expect(storage.deleteMany).toHaveBeenCalledWith(['user-1/output.png', 'user-1/mask.png']);
    expect(transaction.asset.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['output-1', 'mask-1'] } } });
    expect(transaction.conversation.delete).toHaveBeenCalledWith({ where: { id: 'conversation-1' } });
  });

  it('deletes an uploaded edit source used only by the removed conversation but preserves shared uploads', async () => {
    const transaction: any = {
      asset: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      conversation: { delete: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      conversation: { findFirst: jest.fn().mockResolvedValue({
        id: 'conversation-1',
        jobs: [{ status: 'FAILED', parameters: { sourceAssetIds: ['exclusive-upload', 'shared-upload'] }, assets: [] }],
      }) },
      asset: { findMany: jest.fn().mockResolvedValue([
        { id: 'exclusive-upload', objectKey: 'user-1/exclusive.png', sizeBytes: 20n, deletedAt: null, role: 'UPLOAD', thumbnail: { id: 'exclusive-thumb', objectKey: 'user-1/exclusive.webp', sizeBytes: 2n, deletedAt: null, role: 'THUMBNAIL' } },
        { id: 'shared-upload', objectKey: 'user-1/shared.png', sizeBytes: 30n, deletedAt: null, role: 'UPLOAD', thumbnail: null },
      ]) },
      generationJob: { findMany: jest.fn().mockResolvedValue([{ parameters: { sourceAssetIds: ['shared-upload'] } }]) },
      $transaction: jest.fn((callback: any) => callback(transaction)),
    };
    const storage: any = { deleteMany: jest.fn().mockResolvedValue(undefined) };
    const quota: any = { releaseStorage: jest.fn().mockResolvedValue(undefined) };
    const controller = new ConversationsController(prisma, storage, quota);

    await expect(controller.remove({ id: 'user-1' } as any, 'conversation-1')).resolves.toEqual({ ok: true, deletedAssetIds: ['exclusive-upload'] });

    expect(prisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['exclusive-upload', 'shared-upload'] }, userId: 'user-1', role: 'UPLOAD' } }));
    expect(prisma.generationJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversationId: { not: 'conversation-1' } }) }));
    expect(storage.deleteMany).toHaveBeenCalledWith(['user-1/exclusive.png', 'user-1/exclusive.webp']);
    expect(transaction.asset.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['exclusive-upload', 'exclusive-thumb'] } } });
    expect(quota.releaseStorage).toHaveBeenCalledWith('user-1', 20n);
  });
});

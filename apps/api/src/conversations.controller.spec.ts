import { ConversationsController } from './conversations.controller';

describe('ConversationsController asset tombstones', () => {
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
    const prisma: any = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conversation-1', jobs: [{ assets: [{ objectKey: 'user-1/output.png', sizeBytes: 6n, deletedAt: null }, { objectKey: 'user-1/mask.png', sizeBytes: 4n, deletedAt: null }] }] }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const storage: any = { delete: jest.fn().mockResolvedValue(undefined) };
    const controller = new ConversationsController(prisma, storage, { releaseStorage: jest.fn().mockResolvedValue(undefined) } as any);

    await expect(controller.remove({ id: 'user-1' } as any, 'conversation-1')).resolves.toEqual({ ok: true });
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(storage.delete).toHaveBeenCalledWith('user-1/output.png');
    expect(storage.delete).toHaveBeenCalledWith('user-1/mask.png');
    expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: 'conversation-1' } });
  });
});

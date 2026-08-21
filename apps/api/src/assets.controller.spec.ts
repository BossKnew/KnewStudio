import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetsController } from './assets.controller';

describe('AssetsController', () => {
  const user = { id: 'user-1', role: 'USER', username: 'alice' } as any;
  let prisma: any;
  let storage: any;
  let lifecycle: any;
  let controller: AssetsController;

  beforeEach(() => {
    delete process.env.MEDIA_X_ACCEL_REDIRECT;
    prisma = {
      asset: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    storage = { normalizeImageFile: jest.fn(), saveStaged: jest.fn(), deleteStaged: jest.fn(), delete: jest.fn() };
    lifecycle = { persistNormalized: jest.fn(), remove: jest.fn() };
    controller = new AssetsController(prisma, storage, lifecycle);
  });

  it('stores generated masks with the MASK role so they stay out of the asset library', async () => {
    const file = { path: 'staging/upload', size: 3, mimetype: 'image/png', originalname: 'mask.png' } as Express.Multer.File;
    storage.normalizeImageFile.mockResolvedValue({ path: 'staging/normalized', sizeBytes: 3n, mimeType: 'image/png', width: 1024, height: 1024 });
    lifecycle.persistNormalized.mockResolvedValue({ id: 'mask-1', role: 'MASK', objectKey: 'user-1/mask.png', sizeBytes: 3n, deletedAt: null, note: null, thumbnail: null });

    await controller.upload(user, { role: 'MASK' }, file);

    expect(lifecycle.persistNormalized).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', role: 'MASK', originalName: 'mask.png' }));
  });

  it('trims and saves a note only after confirming ownership', async () => {
    prisma.asset.findFirst.mockResolvedValue({ id: 'asset-1' });
    prisma.asset.update.mockResolvedValue({ id: 'asset-1', note: '旅行灵感' });

    await expect(controller.updateNote(user, 'asset-1', { note: '  旅行灵感  ' })).resolves.toEqual({ id: 'asset-1', note: '旅行灵感' });
    expect(prisma.asset.findFirst).toHaveBeenCalledWith({ where: { id: 'asset-1', userId: 'user-1', deletedAt: null }, select: { id: true } });
    expect(prisma.asset.update).toHaveBeenCalledWith({ where: { id: 'asset-1' }, data: { note: '旅行灵感' }, select: { id: true, note: true } });
  });

  it('stores a cleared note as null', async () => {
    prisma.asset.findFirst.mockResolvedValue({ id: 'asset-1' });
    prisma.asset.update.mockResolvedValue({ id: 'asset-1', note: null });
    await controller.updateNote(user, 'asset-1', { note: '   ' });
    expect(prisma.asset.update).toHaveBeenCalledWith(expect.objectContaining({ data: { note: null } }));
  });

  it('rejects invalid or oversized notes', async () => {
    await expect(controller.updateNote(user, 'asset-1', { note: 123 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.updateNote(user, 'asset-1', { note: 'x'.repeat(1001) })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.asset.findFirst).not.toHaveBeenCalled();
  });

  it('does not update an asset owned by another user', async () => {
    prisma.asset.findFirst.mockResolvedValue(null);
    await expect(controller.updateNote(user, 'other-asset', { note: 'private' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });

  it('returns notes and generation prompts without exposing storage keys', async () => {
    prisma.asset.findMany.mockResolvedValue([{
      id: 'asset-1', userId: 'user-1', role: 'OUTPUT', objectKey: 'user-1/private.png', mimeType: 'image/png',
      sizeBytes: 4096n, width: 1024, height: 1024, originalName: null, note: '封面候选', contentHash: 'private-sha256', createdAt: new Date(), job: { prompt: '雨夜城市' },
    }]);
    prisma.asset.count = jest.fn().mockResolvedValue(1);
    const result = await controller.list(user);
    expect(result.items[0]).toMatchObject({ id: 'asset-1', note: '封面候选', generationPrompt: '雨夜城市', visibility: 'owned', sharedGroupIds: [], sizeBytes: '4096', contentUrl: '/api/v1/assets/asset-1/content', thumbnailUrl: '/api/v1/assets/asset-1/content' });
    expect(result.items[0].objectKey).toBeUndefined();
    expect(result.items[0].contentHash).toBeUndefined();
    expect((result.items[0] as any).job).toBeUndefined();
    expect(result.total).toBe(1);
  });

  it('allows only private caching for authenticated asset content', async () => {
    prisma.asset.findFirst.mockResolvedValue({ id: 'asset-1', userId: 'user-1', role: 'OUTPUT', deletedAt: null, shares: [], objectKey: 'user-1/private.png', mimeType: 'image/png', sizeBytes: 3n });
    const stream = { on: jest.fn().mockReturnThis(), pipe: jest.fn() };
    storage.createReadStream = jest.fn(() => stream);
    const response = { setHeader: jest.fn(), destroy: jest.fn() } as any;

    await controller.content(user, 'asset-1', response);

    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(stream.pipe).toHaveBeenCalledWith(response);
  });

  it('serves byte ranges for video seeking', async () => {
    prisma.asset.findFirst.mockResolvedValue({ id: 'asset-1', userId: 'user-1', role: 'OUTPUT', deletedAt: null, shares: [], objectKey: 'user-1/clip.mp4', mimeType: 'video/mp4', sizeBytes: 100n });
    const stream = { on: jest.fn().mockReturnThis(), pipe: jest.fn() };
    storage.createReadStream = jest.fn(() => stream);
    const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), destroy: jest.fn() } as any;

    await controller.content(user, 'asset-1', response, { headers: { range: 'bytes=0-9' } } as any);

    expect(response.status).toHaveBeenCalledWith(206);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-9/100');
    expect(storage.createReadStream).toHaveBeenCalledWith('user-1/clip.mp4', { start: 0, end: 9 });
  });

  it('offloads authenticated media to the internal Nginx location in production', async () => {
    process.env.MEDIA_X_ACCEL_REDIRECT = 'true';
    prisma.asset.findFirst.mockResolvedValue({ userId: 'user-1', role: 'OUTPUT', deletedAt: null, shares: [], objectKey: 'user-1/private image.png', mimeType: 'image/png', sizeBytes: 3n });
    const response = { setHeader: jest.fn(), end: jest.fn() } as any;

    await controller.content(user, 'asset-1', response);

    expect(response.setHeader).toHaveBeenCalledWith('X-Accel-Redirect', '/_protected_media/user-1/private%20image.png');
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(storage.createReadStream).toBeUndefined();
  });

  it('deletes stored bytes but keeps a tombstone for conversation history', async () => {
    lifecycle.remove.mockResolvedValue({ id: 'asset-1' });

    await expect(controller.remove(user, 'asset-1')).resolves.toEqual({ ok: true });

    expect(lifecycle.remove).toHaveBeenCalledWith('user-1', 'asset-1');
  });

  it('hides unshared private content from other users and administrators', async () => {
    prisma.asset.findFirst.mockResolvedValue({ id: 'asset-1', userId: 'owner-1', role: 'OUTPUT', deletedAt: null, shares: [], objectKey: 'owner-1/private.png', mimeType: 'image/png', sizeBytes: 3n, thumbnailFor: null });
    const response = { setHeader: jest.fn() } as any;
    await expect(controller.content({ id: 'member-1', role: 'USER', groupIds: ['design'] } as any, 'asset-1', response)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.content({ id: 'admin-1', role: 'ADMIN', groupIds: [] } as any, 'asset-1', response)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.createReadStream).toBeUndefined();
  });

  it('lets a current group member read shared content', async () => {
    prisma.asset.findFirst.mockResolvedValue({
      id: 'asset-1', userId: 'owner-1', role: 'OUTPUT', deletedAt: null, shares: [{ groupId: 'design' }],
      objectKey: 'owner-1/shared.png', mimeType: 'image/png', sizeBytes: 3n, thumbnailFor: null,
    });
    const stream = { on: jest.fn().mockReturnThis(), pipe: jest.fn() };
    storage.createReadStream = jest.fn(() => stream);
    const response = { setHeader: jest.fn(), destroy: jest.fn() } as any;
    await controller.content({ id: 'member-1', role: 'USER', groupIds: ['design'] } as any, 'asset-1', response);
    expect(stream.pipe).toHaveBeenCalledWith(response);
  });

  it('omits notes and prompts from the group library', async () => {
    prisma.assetShare = {
      findMany: jest.fn().mockResolvedValue([{
        id: 'share-1', createdAt: new Date('2026-08-20T00:00:00.000Z'),
        group: { id: 'design', name: 'Design' },
        sharedBy: { displayName: 'Alice', username: 'alice' },
        asset: { id: 'asset-1', userId: 'owner-1', role: 'OUTPUT', mimeType: 'image/png', sizeBytes: 4n, width: 10, height: 10, deletedAt: null, objectKey: 'owner/secret.png', note: 'secret', thumbnail: null },
      }]),
      count: jest.fn().mockResolvedValue(1),
    };
    const result = await controller.shared({ id: 'member-1', role: 'USER', groupIds: ['design'] } as any);
    expect(result.items[0]).toMatchObject({
      id: 'asset-1', visibility: 'shared', note: null, generationPrompt: null,
      group: { id: 'design', name: 'Design' }, sharedBy: { displayName: 'Alice' }, canUnshare: false,
      contentUrl: '/api/v1/assets/asset-1/content',
    });
    expect((result.items[0] as any).objectKey).toBeUndefined();
  });

  it('lets only the owner replace share targets', async () => {
    const groupId = '11111111-1111-4111-8111-111111111111';
    prisma.asset.findFirst.mockResolvedValue({ id: 'asset-1', userId: 'owner-1', role: 'OUTPUT', deletedAt: null });
    await expect(controller.replaceShares({ id: 'member-1', role: 'USER', groupIds: [groupId] } as any, 'asset-1', { groupIds: [groupId] })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.replaceShares({ id: 'admin-1', role: 'ADMIN', groupIds: [] } as any, 'asset-1', { groupIds: [groupId] })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets an administrator unshare another user\'s asset', async () => {
    const groupId = '11111111-1111-4111-8111-111111111111';
    prisma.asset.findFirst.mockResolvedValue({ id: 'asset-1', userId: 'owner-1', deletedAt: null });
    prisma.assetShare = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
    prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
    await expect(controller.unshare({ id: 'admin-1', role: 'ADMIN', groupIds: [] } as any, 'asset-1', groupId)).resolves.toEqual({ ok: true });
    expect(prisma.assetShare.deleteMany).toHaveBeenCalledWith({ where: { assetId: 'asset-1', groupId } });
  });
});

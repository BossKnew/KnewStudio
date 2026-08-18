import { AssetLifecycleService } from './asset-lifecycle.service';

describe('AssetLifecycleService thumbnails', () => {
  it('reuses an active upload with the same SHA-256 without consuming quota or creating a thumbnail', async () => {
    const existing = { id: 'existing-1', userId: 'user-1', role: 'UPLOAD', objectKey: 'user/existing.png', sizeBytes: 1000n, contentHash: 'same-hash', deletedAt: null, note: null, thumbnail: { id: 'existing-thumb', deletedAt: null } };
    const prisma: any = { asset: { findFirst: jest.fn().mockResolvedValue(existing), findMany: jest.fn() } };
    const storage: any = {
      hashStaged: jest.fn().mockResolvedValue('same-hash'),
      deleteStaged: jest.fn().mockResolvedValue(undefined),
      createThumbnailFile: jest.fn(),
    };
    const quota: any = { reserveStorage: jest.fn(), releaseStorage: jest.fn() };
    const service = new AssetLifecycleService(prisma, storage, quota);

    await expect(service.persistNormalized({ userId: 'user-1', role: 'UPLOAD', image: { path: 'duplicate-stage', sizeBytes: 1000n, mimeType: 'image/png', width: 1024, height: 512 } })).resolves.toBe(existing);

    expect(storage.deleteStaged).toHaveBeenCalledWith('duplicate-stage');
    expect(storage.createThumbnailFile).not.toHaveBeenCalled();
    expect(quota.reserveStorage).not.toHaveBeenCalled();
    expect(prisma.asset.findMany).not.toHaveBeenCalled();
  });

  it('recognizes a matching upload created before content hashes were introduced', async () => {
    const existing = { id: 'legacy-1', userId: 'user-1', role: 'UPLOAD', objectKey: 'user/legacy.png', sizeBytes: 1000n, contentHash: 'same-hash', deletedAt: null, note: null, thumbnail: null };
    const prisma: any = { asset: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([{ id: 'legacy-1', objectKey: 'user/legacy.png' }]),
      update: jest.fn().mockResolvedValue(existing),
    } };
    const storage: any = {
      hashStaged: jest.fn().mockResolvedValue('same-hash'),
      hashObject: jest.fn().mockResolvedValue('same-hash'),
      deleteStaged: jest.fn().mockResolvedValue(undefined),
      createThumbnailFile: jest.fn(),
    };
    const quota: any = { reserveStorage: jest.fn(), releaseStorage: jest.fn() };
    const service = new AssetLifecycleService(prisma, storage, quota);

    await expect(service.persistNormalized({ userId: 'user-1', role: 'UPLOAD', image: { path: 'duplicate-stage', sizeBytes: 1000n, mimeType: 'image/png', width: 1024, height: 512 } })).resolves.toBe(existing);

    expect(prisma.asset.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'legacy-1' }, data: { contentHash: 'same-hash' } }));
    expect(quota.reserveStorage).not.toHaveBeenCalled();
  });

  it('cleans up the losing copy when simultaneous identical uploads hit the unique index', async () => {
    const winner = { id: 'winner-1', userId: 'user-1', role: 'UPLOAD', objectKey: 'user/winner.png', sizeBytes: 1000n, contentHash: 'same-hash', deletedAt: null, note: null, thumbnail: null };
    const prisma: any = {
      asset: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockRejectedValue({ code: 'P2002' }),
    };
    const storage: any = {
      hashStaged: jest.fn().mockResolvedValue('same-hash'),
      createThumbnailFile: jest.fn().mockResolvedValue({ path: 'thumb-stage', sizeBytes: 100n, mimeType: 'image/webp', width: 512, height: 256 }),
      saveStaged: jest.fn().mockResolvedValueOnce({ objectKey: 'user/loser.png', sizeBytes: 1000n }).mockResolvedValueOnce({ objectKey: 'user/loser.webp', sizeBytes: 100n }),
      deleteStaged: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const quota: any = { reserveStorage: jest.fn().mockResolvedValue(undefined), releaseStorage: jest.fn().mockResolvedValue(undefined) };
    const service = new AssetLifecycleService(prisma, storage, quota);

    await expect(service.persistNormalized({ userId: 'user-1', role: 'UPLOAD', image: { path: 'source-stage', sizeBytes: 1000n, mimeType: 'image/png', width: 1024, height: 512 } })).resolves.toBe(winner);

    expect(storage.delete).toHaveBeenCalledWith('user/loser.png');
    expect(storage.delete).toHaveBeenCalledWith('user/loser.webp');
    expect(quota.releaseStorage).toHaveBeenCalledWith('user-1', 1000n);
  });

  it('persists one unmetered thumbnail beside a metered source asset', async () => {
    const created: any[] = [];
    const tx: any = { asset: { create: jest.fn(async ({ data }: any) => {
      created.push(data);
      return { id: created.length === 1 ? 'source-1' : 'thumb-1', deletedAt: null, note: null, ...data };
    }) } };
    const prisma: any = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const storage: any = {
      createThumbnailFile: jest.fn().mockResolvedValue({ path: 'thumb-stage', sizeBytes: 100n, mimeType: 'image/webp', width: 512, height: 256 }),
      saveStaged: jest.fn().mockResolvedValueOnce({ objectKey: 'user/source.png', sizeBytes: 1000n }).mockResolvedValueOnce({ objectKey: 'user/thumb.webp', sizeBytes: 100n }),
      deleteStaged: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined),
    };
    const quota: any = { reserveStorage: jest.fn().mockResolvedValue(undefined), releaseStorage: jest.fn().mockResolvedValue(undefined) };
    const service = new AssetLifecycleService(prisma, storage, quota);

    await service.persistNormalized({ userId: 'user-1', role: 'OUTPUT', jobId: 'job-1', image: { path: 'source-stage', sizeBytes: 1000n, mimeType: 'image/png', width: 1024, height: 512 } });

    expect(quota.reserveStorage).toHaveBeenCalledWith('user-1', 1000n);
    expect(created[1]).toMatchObject({ role: 'THUMBNAIL', thumbnailForId: 'source-1', objectKey: 'user/thumb.webp' });
  });

  it('deletes the source and thumbnail while releasing only metered source bytes', async () => {
    const prisma: any = {
      asset: {
        findFirst: jest.fn().mockResolvedValue({ id: 'source-1', objectKey: 'user/source.png', sizeBytes: 1000n, thumbnail: { id: 'thumb-1', objectKey: 'user/thumb.webp' } }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const storage: any = { deleteMany: jest.fn().mockResolvedValue(undefined) };
    const quota: any = { releaseStorage: jest.fn().mockResolvedValue(undefined) };
    const service = new AssetLifecycleService(prisma, storage, quota);

    await service.remove('user-1', 'source-1');

    expect(storage.deleteMany).toHaveBeenCalledWith(['user/source.png', 'user/thumb.webp']);
    expect(prisma.asset.update).toHaveBeenCalledTimes(2);
    expect(quota.releaseStorage).toHaveBeenCalledWith('user-1', 1000n);
  });
});

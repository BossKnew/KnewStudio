import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetsController } from './assets.controller';

describe('AssetsController', () => {
  const user = { id: 'user-1', role: 'USER', username: 'alice' } as any;
  let prisma: any;
  let storage: any;
  let quota: any;
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
    quota = { reserveStorage: jest.fn().mockResolvedValue(undefined), releaseStorage: jest.fn().mockResolvedValue(undefined) };
    controller = new AssetsController(prisma, storage, quota);
  });

  it('stores generated masks with the MASK role so they stay out of the asset library', async () => {
    const file = { path: 'staging/upload', size: 3, mimetype: 'image/png', originalname: 'mask.png' } as Express.Multer.File;
    storage.normalizeImageFile.mockResolvedValue({ path: 'staging/normalized', sizeBytes: 3n, mimeType: 'image/png', width: 1024, height: 1024 });
    storage.saveStaged.mockResolvedValue({ objectKey: 'user-1/mask.png', sizeBytes: 3n });
    prisma.asset.create.mockImplementation(({ data }: any) => ({ id: 'mask-1', ...data, note: null }));

    await controller.upload(user, { role: 'MASK' }, file);

    expect(prisma.asset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'user-1', role: 'MASK', originalName: 'mask.png' }) });
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
      sizeBytes: 4096n, width: 1024, height: 1024, originalName: null, note: '封面候选', createdAt: new Date(), job: { prompt: '雨夜城市' },
    }]);
    const result = await controller.list(user);
    expect(result[0]).toMatchObject({ id: 'asset-1', note: '封面候选', generationPrompt: '雨夜城市', sizeBytes: '4096', contentUrl: '/api/v1/assets/asset-1/content' });
    expect(result[0].objectKey).toBeUndefined();
    expect((result[0] as any).job).toBeUndefined();
    expect(prisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', role: { in: ['UPLOAD', 'OUTPUT'] }, deletedAt: null } }));
  });

  it('allows only private caching for authenticated asset content', async () => {
    prisma.asset.findFirst.mockResolvedValue({ id: 'asset-1', userId: 'user-1', objectKey: 'user-1/private.png', mimeType: 'image/png', sizeBytes: 3n });
    const stream = { on: jest.fn().mockReturnThis(), pipe: jest.fn() };
    storage.createReadStream = jest.fn(() => stream);
    const response = { setHeader: jest.fn(), destroy: jest.fn() } as any;

    await controller.content(user, 'asset-1', response);

    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(stream.pipe).toHaveBeenCalledWith(response);
  });

  it('offloads authenticated media to the internal Nginx location in production', async () => {
    process.env.MEDIA_X_ACCEL_REDIRECT = 'true';
    prisma.asset.findFirst.mockResolvedValue({ objectKey: 'user-1/private image.png', mimeType: 'image/png', sizeBytes: 3n });
    const response = { setHeader: jest.fn(), end: jest.fn() } as any;

    await controller.content(user, 'asset-1', response);

    expect(response.setHeader).toHaveBeenCalledWith('X-Accel-Redirect', '/_protected_media/user-1/private%20image.png');
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(storage.createReadStream).toBeUndefined();
  });

  it('deletes stored bytes but keeps a tombstone for conversation history', async () => {
    prisma.asset.findFirst.mockResolvedValue({ id: 'asset-1', userId: 'user-1', objectKey: 'user-1/output.png' });
    prisma.asset.update.mockResolvedValue({ id: 'asset-1', deletedAt: new Date() });

    await expect(controller.remove(user, 'asset-1')).resolves.toEqual({ ok: true });

    expect(storage.delete).toHaveBeenCalledWith('user-1/output.png');
    expect(prisma.asset.update).toHaveBeenCalledWith({ where: { id: 'asset-1' }, data: { deletedAt: expect.any(Date) } });
  });
});

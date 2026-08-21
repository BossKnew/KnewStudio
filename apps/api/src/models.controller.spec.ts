import { ModelsController } from './models.controller';

describe('ModelsController', () => {
  const currentModel = (overrides: Record<string, unknown> = {}) => ({
    id: 'model-1', providerId: '11111111-1111-4111-8111-111111111111', displayName: 'GI2', upstreamModelId: 'gpt-image-2',
    allowedSizes: ['1024x1024'], allowedQualities: ['standard'], defaults: { size: '1024x1024', quality: 'standard', count: 1 },
    supportsGeneration: true, supportsEdit: false, supportsInpaint: false, maxImages: 1, maxInputImages: 1, enabled: true, sortOrder: 0,
    ...overrides,
  });

  const setup = (current = currentModel(), adapterKind = 'openai-images') => {
    const prisma: any = {
      model: {
        create: jest.fn().mockImplementation(({ data }) => ({ ...current, ...data })),
        findUniqueOrThrow: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockImplementation(({ data }) => ({ ...current, ...data })),
      },
      provider: { findUnique: jest.fn().mockResolvedValue({ adapterKind }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    return { controller: new ModelsController(prisma), prisma };
  };

  it('moves an invalid stored default to the first newly allowed quality', async () => {
    const { controller, prisma } = setup();

    await controller.update({ id: 'admin-1' } as any, '11111111-1111-4111-8111-111111111111', { allowedQualities: ['auto', 'low', 'medium', 'high'] });

    expect(prisma.model.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ defaults: expect.objectContaining({ quality: 'auto' }) }),
    }));
  });

  it('uses auto as the only size when the admin leaves sizes empty', async () => {
    const { controller, prisma } = setup();

    await controller.update({ id: 'admin-1' } as any, '11111111-1111-4111-8111-111111111111', { allowedSizes: [] });

    expect(prisma.model.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ allowedSizes: ['auto'], defaults: expect.objectContaining({ size: 'auto' }) }),
    }));
  });

  it('creates a model with auto when sizes are left empty', async () => {
    const { controller, prisma } = setup();

    await controller.create({ id: 'admin-1' } as any, {
      providerId: '11111111-1111-4111-8111-111111111111',
      displayName: 'GI2',
      upstreamModelId: 'gpt-image-2',
      allowedSizes: [],
      allowedQualities: ['auto'],
    });

    expect(prisma.model.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ allowedSizes: ['auto'], defaults: expect.objectContaining({ size: 'auto' }) }),
    }));
  });

  it('does not add auto when explicit sizes omit it', async () => {
    const current = currentModel({ allowedSizes: ['auto'], defaults: { size: 'auto', quality: 'standard', count: 1 } });
    const { controller, prisma } = setup(current);

    await controller.update({ id: 'admin-1' } as any, '11111111-1111-4111-8111-111111111111', { allowedSizes: ['1024x1024', '1024x1536'] });

    expect(prisma.model.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ allowedSizes: ['1024x1024', '1024x1536'], defaults: expect.objectContaining({ size: '1024x1024' }) }),
    }));
  });

  it('stores video durations and locks count to 1', async () => {
    const { controller, prisma } = setup(currentModel(), 'seedance');
    await controller.create({ id: 'admin-1' } as any, {
      providerId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Seedance',
      upstreamModelId: 'doubao-seedance-2-0',
      allowedSizes: ['16:9', '9:16'],
      allowedQualities: ['720p'],
      allowedDurations: [5, 10],
      maxImages: 4,
    });
    expect(prisma.model.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mediaKind: 'VIDEO',
        maxImages: 1,
        allowedDurations: [5, 10],
        defaults: expect.objectContaining({ size: '16:9', durationSeconds: 5, count: 1 }),
      }),
    }));
  });
});

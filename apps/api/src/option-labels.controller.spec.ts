import { BadRequestException } from '@nestjs/common';
import { OptionLabelsController } from './option-labels.controller';

describe('OptionLabelsController', () => {
  it('returns an empty map when nothing is stored', async () => {
    const prisma: any = { systemSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    await expect(new OptionLabelsController(prisma).publicLabels()).resolves.toEqual({});
  });

  it('saves a de-duplicated label table', async () => {
    const prisma: any = {
      systemSetting: { upsert: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const controller = new OptionLabelsController(prisma);
    const result = await controller.save({ id: 'admin-1' } as any, {
      items: [{ value: ' auto ', zh: ' 自动 ', en: 'Auto' }, { value: '1024x1024', zh: '1:1', en: '' }],
    });
    expect(result.items).toEqual([
      { value: '1024x1024', zh: '1:1', en: '' },
      { value: 'auto', zh: '自动', en: 'Auto' },
    ]);
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { value: { auto: { zh: '自动', en: 'Auto' }, '1024x1024': { zh: '1:1', en: '' } } },
    }));
  });

  it('rejects duplicate values', async () => {
    const controller = new OptionLabelsController({} as any);
    await expect(controller.save({ id: 'admin-1' } as any, {
      items: [{ value: 'auto', zh: '自动', en: '' }, { value: 'auto', zh: '重复', en: '' }],
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});

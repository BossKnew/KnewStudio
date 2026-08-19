import { NotFoundException } from '@nestjs/common';
import { PromptsController } from './prompts.controller';

describe('PromptsController', () => {
  const user = { id: 'user-1', role: 'USER', groupIds: [] } as any;
  let prisma: any;
  let controller: PromptsController;

  beforeEach(() => {
    prisma = {
      promptEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
      },
    };
    controller = new PromptsController(prisma);
  });

  it('lists a user history page ordered by last use', async () => {
    const lastUsedAt = new Date('2026-08-19T00:00:00.000Z');
    prisma.promptEntry.findMany.mockResolvedValue([{ id: 'prompt-1', prompt: 'a cat', isFavorite: false, usageCount: 2, lastUsedAt, createdAt: lastUsedAt }]);

    const result = await controller.list(user, 'history');

    expect(prisma.promptEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
    }));
    expect(result.items[0].prompt).toBe('a cat');
    expect(result.nextCursor).toBeNull();
  });

  it('filters the favorites tab to the current user', async () => {
    await controller.list(user, 'favorites');

    expect(prisma.promptEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-1', isFavorite: true }),
    }));
  });

  it('updates only a prompt owned by the current user', async () => {
    prisma.promptEntry.updateMany.mockResolvedValue({ count: 1 });
    const updated = { id: 'prompt-1', prompt: 'a cat', isFavorite: true, usageCount: 1, lastUsedAt: new Date(), createdAt: new Date() };
    prisma.promptEntry.findFirstOrThrow.mockResolvedValue(updated);

    await expect(controller.update(user, 'prompt-1', { isFavorite: true })).resolves.toEqual(updated);
    expect(prisma.promptEntry.updateMany).toHaveBeenCalledWith({ where: { id: 'prompt-1', userId: 'user-1' }, data: { isFavorite: true } });
  });

  it('returns not found when a prompt belongs to another user', async () => {
    prisma.promptEntry.updateMany.mockResolvedValue({ count: 0 });

    await expect(controller.update(user, 'prompt-1', { isFavorite: true })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.promptEntry.findFirstOrThrow).not.toHaveBeenCalled();
  });
});

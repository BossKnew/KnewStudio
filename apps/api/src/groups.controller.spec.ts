import { GroupsController } from './groups.controller';

describe('GroupsController', () => {
  it('returns membership groups for regular users and every group for administrators', async () => {
    const prisma: any = { userGroup: { findMany: jest.fn().mockResolvedValue([{ id: 'design', name: 'Design' }]) } };
    const controller = new GroupsController(prisma);

    await controller.list({ id: 'user-1', role: 'USER', groupIds: ['design'] } as any);
    expect(prisma.userGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['design'] } },
      select: { id: true, name: true },
    }));

    await controller.list({ id: 'admin-1', role: 'ADMIN', groupIds: [] } as any);
    expect(prisma.userGroup.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: undefined,
      select: { id: true, name: true },
    }));
  });
});

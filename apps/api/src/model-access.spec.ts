import { accessibleModelWhere, canAccessModel } from './model-access';

describe('model group access', () => {
  it('lets administrators use every model', () => {
    const user = { role: 'ADMIN', groupIds: [] } as any;
    expect(accessibleModelWhere(user)).toEqual({});
    expect(canAccessModel(user, [{ groupId: 'restricted' }])).toBe(true);
  });

  it('requires regular users to share at least one group with the model', () => {
    const user = { role: 'USER', groupIds: ['designers', 'paid'] } as any;
    expect(canAccessModel(user, [])).toBe(false);
    expect(canAccessModel(user, [{ groupId: 'paid' }])).toBe(true);
    expect(canAccessModel(user, [{ groupId: 'internal' }])).toBe(false);
    expect(accessibleModelWhere(user)).toEqual({
      allowedGroups: { some: { groupId: { in: ['designers', 'paid'] } } },
    });
  });

  it('returns no restricted models for a regular user without groups', () => {
    const user = { role: 'USER', groupIds: [] } as any;
    expect(canAccessModel(user, [])).toBe(false);
    expect(accessibleModelWhere(user)).toEqual({ allowedGroups: { some: { groupId: { in: [] } } } });
  });
});

import { accessibleReferencedAssetWhere, accessibleSourceWhere, canReadAsset, canShareAsset, canUnshareAsset } from './asset-access';

const owner = { id: 'owner-1', role: 'USER', groupIds: ['design'] } as any;
const member = { id: 'member-1', role: 'USER', groupIds: ['design'] } as any;
const outsider = { id: 'outsider-1', role: 'USER', groupIds: ['other'] } as any;
const admin = { id: 'admin-1', role: 'ADMIN', groupIds: [] } as any;

const owned = { userId: 'owner-1', role: 'OUTPUT', deletedAt: null, shares: [] };
const shared = { userId: 'owner-1', role: 'OUTPUT', deletedAt: null, shares: [{ groupId: 'design' }] };
const mask = { userId: 'owner-1', role: 'MASK', deletedAt: null, shares: [] };
const thumbnail = {
  userId: 'owner-1',
  role: 'THUMBNAIL',
  deletedAt: null,
  shares: [],
  thumbnailFor: { userId: 'owner-1', role: 'OUTPUT', deletedAt: null, shares: [{ groupId: 'design' }] },
};

describe('asset group access', () => {
  it('lets the owner read every role of their own undeleted asset', () => {
    expect(canReadAsset(owner, owned)).toBe(true);
    expect(canReadAsset(owner, mask)).toBe(true);
    expect(canReadAsset(owner, { ...owned, deletedAt: new Date() })).toBe(false);
  });

  it('lets current group members read shared library assets and their thumbnails', () => {
    expect(canReadAsset(member, shared)).toBe(true);
    expect(canReadAsset(member, thumbnail)).toBe(true);
    expect(canReadAsset(outsider, shared)).toBe(false);
    expect(canReadAsset(member, mask)).toBe(false);
  });

  it('lets administrators read already-shared assets but not private ones', () => {
    expect(canReadAsset(admin, shared)).toBe(true);
    expect(canReadAsset(admin, owned)).toBe(false);
    expect(canReadAsset(admin, thumbnail)).toBe(true);
  });

  it('only lets the owner create shares of upload or output assets', () => {
    expect(canShareAsset(owner, owned)).toBe(true);
    expect(canShareAsset(owner, mask)).toBe(false);
    expect(canShareAsset(member, shared)).toBe(false);
    expect(canShareAsset(admin, shared)).toBe(false);
  });

  it('lets the owner or an administrator unshare', () => {
    expect(canUnshareAsset(owner, shared)).toBe(true);
    expect(canUnshareAsset(admin, shared)).toBe(true);
    expect(canUnshareAsset(member, shared)).toBe(false);
  });

  it('restricts generation sources to owned or currently shared library assets', () => {
    expect(accessibleSourceWhere(member)).toEqual({
      deletedAt: null,
      role: { in: ['UPLOAD', 'OUTPUT'] },
      OR: [
        { userId: 'member-1' },
        { shares: { some: { groupId: { in: ['design'] } } } },
      ],
    });
    expect(accessibleSourceWhere(admin)).toEqual({
      deletedAt: null,
      role: { in: ['UPLOAD', 'OUTPUT'] },
      OR: [
        { userId: 'admin-1' },
        { shares: { some: {} } },
      ],
    });
    expect(accessibleReferencedAssetWhere(member)).toEqual({
      deletedAt: null,
      OR: [
        { userId: 'member-1' },
        { role: { in: ['UPLOAD', 'OUTPUT'] }, shares: { some: { groupId: { in: ['design'] } } } },
      ],
    });
  });
});

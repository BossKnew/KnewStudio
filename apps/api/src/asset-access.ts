import type { Prisma } from './generated/prisma/client';
import type { AuthUser } from './common';

const LIBRARY_ROLES = ['UPLOAD', 'OUTPUT'] as const;

export type AssetShareGroup = { groupId: string };

export type AssetAccessView = {
  userId: string;
  role: string;
  deletedAt?: Date | null;
  shares?: AssetShareGroup[] | null;
  thumbnailFor?: {
    userId: string;
    role: string;
    deletedAt?: Date | null;
    shares?: AssetShareGroup[] | null;
  } | null;
};

export function sharedToViewerWhere(user: AuthUser): Prisma.AssetShareWhereInput {
  if (user.role === 'ADMIN') return {};
  return { groupId: { in: user.groupIds ?? [] } };
}

export function accessibleSourceWhere(user: AuthUser): Prisma.AssetWhereInput {
  return {
    deletedAt: null,
    role: { in: [...LIBRARY_ROLES] },
    OR: [
      { userId: user.id },
      { shares: { some: sharedToViewerWhere(user) } },
    ],
  };
}

export function accessibleReferencedAssetWhere(user: AuthUser): Prisma.AssetWhereInput {
  return {
    deletedAt: null,
    OR: [
      { userId: user.id },
      {
        role: { in: [...LIBRARY_ROLES] },
        shares: { some: sharedToViewerWhere(user) },
      },
    ],
  };
}

function libraryTarget(asset: AssetAccessView) {
  if (asset.role === 'THUMBNAIL') return asset.thumbnailFor ?? null;
  return asset;
}

function hasShareAccess(user: AuthUser, shares: AssetShareGroup[] | null | undefined) {
  if (!shares?.length) return false;
  if (user.role === 'ADMIN') return true;
  const groups = new Set(user.groupIds ?? []);
  return shares.some(({ groupId }) => groups.has(groupId));
}

export function canReadAsset(user: AuthUser, asset: AssetAccessView | null | undefined) {
  if (!asset || asset.deletedAt) return false;
  if (asset.userId === user.id) return true;
  const target = libraryTarget(asset);
  if (!target || target.deletedAt) return false;
  if (target.userId === user.id) return true;
  if (target.role !== 'UPLOAD' && target.role !== 'OUTPUT') return false;
  return hasShareAccess(user, target.shares ?? (target === asset ? asset.shares : null));
}

export function canShareAsset(user: AuthUser, asset: { userId: string; role: string; deletedAt?: Date | null } | null | undefined) {
  return Boolean(asset && !asset.deletedAt && asset.userId === user.id && (asset.role === 'UPLOAD' || asset.role === 'OUTPUT'));
}

export function canUnshareAsset(user: AuthUser, asset: { userId: string; deletedAt?: Date | null } | null | undefined) {
  if (!asset || asset.deletedAt) return false;
  return asset.userId === user.id || user.role === 'ADMIN';
}

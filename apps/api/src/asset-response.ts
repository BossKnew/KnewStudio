type AssetLinksInput = {
  id: string;
  deletedAt?: Date | null;
  thumbnail?: { id: string; deletedAt: Date | null } | null;
};

export function serializeAssetLinks(asset: AssetLinksInput) {
  if (asset.deletedAt) return { deleted: true, contentUrl: null, thumbnailUrl: null };
  const thumbnailId = asset.thumbnail && !asset.thumbnail.deletedAt ? asset.thumbnail.id : asset.id;
  return {
    deleted: false,
    contentUrl: `/api/v1/assets/${asset.id}/content`,
    thumbnailUrl: `/api/v1/assets/${thumbnailId}/content`,
  };
}

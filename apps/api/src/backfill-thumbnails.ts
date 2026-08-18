import './load-secret-files';
import { createPrismaClient } from './prisma-client';
import { StorageService } from './storage.service';

async function main() {
  const prisma = createPrismaClient();
  const storage = new StorageService();
  let afterId: string | undefined;
  let created = 0;
  try {
    while (true) {
      const assets = await prisma.asset.findMany({
        where: {
          role: { in: ['UPLOAD', 'OUTPUT'] },
          deletedAt: null,
          thumbnail: { is: null },
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 50,
        select: { id: true, userId: true, jobId: true, objectKey: true },
      });
      if (!assets.length) break;
      for (const asset of assets) {
        afterId = asset.id;
        const thumbnail = await storage.createThumbnailFromObject(asset.objectKey);
        let stored: { objectKey: string; sizeBytes: bigint } | undefined;
        try {
          stored = await storage.saveStaged(asset.userId, thumbnail.path, thumbnail.mimeType);
          await prisma.asset.create({ data: {
            userId: asset.userId,
            jobId: asset.jobId,
            role: 'THUMBNAIL',
            objectKey: stored.objectKey,
            mimeType: thumbnail.mimeType,
            sizeBytes: stored.sizeBytes,
            width: thumbnail.width,
            height: thumbnail.height,
            thumbnailForId: asset.id,
          }});
          created += 1;
        } catch (error) {
          await storage.deleteStaged(thumbnail.path).catch(() => undefined);
          if (stored) await storage.delete(stored.objectKey).catch(() => undefined);
          throw error;
        }
      }
      process.stdout.write(`created thumbnails: ${created}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
  process.stdout.write(`thumbnail backfill complete: ${created}\n`);
}

void main();

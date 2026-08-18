import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { QuotaService } from './quota.service';
import { StorageService } from './storage.service';

type NormalizedImage = { path: string; sizeBytes: bigint; mimeType: string; width: number; height: number };

function prismaErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
}

@Injectable()
export class AssetLifecycleService {
  constructor(private prisma: PrismaService, private storage: StorageService, private quota: QuotaService) {}

  async persistNormalized(input: {
    userId: string;
    role: 'UPLOAD' | 'MASK' | 'OUTPUT';
    image: NormalizedImage;
    jobId?: string;
    originalName?: string;
  }) {
    let contentHash: string | undefined;
    if (input.role === 'UPLOAD') {
      try {
        contentHash = await this.storage.hashStaged(input.image.path);
        const duplicate = await this.findDuplicateUpload(input.userId, input.image, contentHash);
        if (duplicate) {
          await this.storage.deleteStaged(input.image.path);
          return duplicate;
        }
      } catch (error) {
        await this.storage.deleteStaged(input.image.path).catch(() => undefined);
        throw error;
      }
    }
    let thumbnail: Awaited<ReturnType<StorageService['createThumbnailFile']>> | undefined;
    try { thumbnail = input.role === 'MASK' ? undefined : await this.storage.createThumbnailFile(input.image.path); }
    catch (error) { await this.storage.deleteStaged(input.image.path).catch(() => undefined); throw error; }
    try { await this.quota.reserveStorage(input.userId, input.image.sizeBytes); }
    catch (error) {
      await Promise.all([this.storage.deleteStaged(input.image.path), thumbnail ? this.storage.deleteStaged(thumbnail.path) : Promise.resolve()]);
      throw error;
    }

    let stored: { objectKey: string; sizeBytes: bigint } | undefined;
    let storedThumbnail: { objectKey: string; sizeBytes: bigint } | undefined;
    try {
      stored = await this.storage.saveStaged(input.userId, input.image.path, input.image.mimeType);
      if (thumbnail) storedThumbnail = await this.storage.saveStaged(input.userId, thumbnail.path, thumbnail.mimeType);
      return await this.prisma.$transaction(async (tx) => {
        const asset = await tx.asset.create({ data: {
          userId: input.userId,
          jobId: input.jobId,
          role: input.role,
          objectKey: stored!.objectKey,
          mimeType: input.image.mimeType,
          sizeBytes: stored!.sizeBytes,
          width: input.image.width,
          height: input.image.height,
          originalName: input.originalName,
          contentHash,
        }});
        const thumbnailAsset = storedThumbnail && thumbnail ? await tx.asset.create({ data: {
          userId: input.userId,
          jobId: input.jobId,
          role: 'THUMBNAIL',
          objectKey: storedThumbnail.objectKey,
          mimeType: thumbnail.mimeType,
          sizeBytes: storedThumbnail.sizeBytes,
          width: thumbnail.width,
          height: thumbnail.height,
          thumbnailForId: asset.id,
        }}) : null;
        return { ...asset, thumbnail: thumbnailAsset ? { id: thumbnailAsset.id, deletedAt: thumbnailAsset.deletedAt } : null };
      });
    } catch (error) {
      await Promise.all([
        this.storage.deleteStaged(input.image.path).catch(() => undefined),
        thumbnail ? this.storage.deleteStaged(thumbnail.path).catch(() => undefined) : Promise.resolve(),
        stored ? this.storage.delete(stored.objectKey).catch(() => undefined) : Promise.resolve(),
        storedThumbnail ? this.storage.delete(storedThumbnail.objectKey).catch(() => undefined) : Promise.resolve(),
      ]);
      await this.quota.releaseStorage(input.userId, input.image.sizeBytes);
      if (contentHash && prismaErrorCode(error) === 'P2002') {
        const duplicate = await this.activeUploadByHash(input.userId, contentHash);
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  private activeUploadByHash(userId: string, contentHash: string) {
    return this.prisma.asset.findFirst({
      where: { userId, role: 'UPLOAD', contentHash, deletedAt: null },
      include: { thumbnail: { select: { id: true, deletedAt: true } } },
    });
  }

  private async findDuplicateUpload(userId: string, image: NormalizedImage, contentHash: string) {
    const indexed = await this.activeUploadByHash(userId, contentHash);
    if (indexed) return indexed;

    const legacyCandidates = await this.prisma.asset.findMany({
      where: {
        userId,
        role: 'UPLOAD',
        deletedAt: null,
        contentHash: null,
        sizeBytes: image.sizeBytes,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
      },
      select: { id: true, objectKey: true },
    });
    for (const candidate of legacyCandidates) {
      let existingHash: string;
      try { existingHash = await this.storage.hashObject(candidate.objectKey); }
      catch { continue; }
      if (existingHash !== contentHash) continue;
      try {
        return await this.prisma.asset.update({
          where: { id: candidate.id },
          data: { contentHash },
          include: { thumbnail: { select: { id: true, deletedAt: true } } },
        });
      } catch (error) {
        if (prismaErrorCode(error) === 'P2025') continue;
        if (prismaErrorCode(error) === 'P2002') {
          const winner = await this.activeUploadByHash(userId, contentHash);
          if (winner) return winner;
        }
        throw error;
      }
    }
    return null;
  }

  async remove(userId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, userId, deletedAt: null, role: { in: ['UPLOAD', 'OUTPUT'] } },
      select: { id: true, objectKey: true, sizeBytes: true, thumbnail: { select: { id: true, objectKey: true } } },
    });
    if (!asset) return null;
    await this.storage.deleteMany([asset.objectKey, ...(asset.thumbnail ? [asset.thumbnail.objectKey] : [])]);
    await this.prisma.$transaction([
      this.prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } }),
      ...(asset.thumbnail ? [this.prisma.asset.update({ where: { id: asset.thumbnail.id }, data: { deletedAt: new Date() } })] : []),
    ]);
    await this.quota.releaseStorage(userId, asset.sizeBytes);
    return asset;
  }

  async removeJobOutputs(userId: string, jobId: string) {
    const assets = await this.prisma.asset.findMany({ where: { jobId, role: { in: ['OUTPUT', 'THUMBNAIL'] } }, select: { objectKey: true, role: true, sizeBytes: true, deletedAt: true } });
    await this.storage.deleteMany(assets.map(({ objectKey }) => objectKey));
    await this.prisma.asset.deleteMany({ where: { jobId, role: { in: ['OUTPUT', 'THUMBNAIL'] } } });
    const bytes = assets.filter((asset) => asset.role === 'OUTPUT' && !asset.deletedAt).reduce((sum, asset) => sum + asset.sizeBytes, 0n);
    if (bytes) await this.quota.releaseStorage(userId, bytes);
    return bytes;
  }

  async removeMask(userId: string, id: string) {
    const mask = await this.prisma.asset.findFirst({
      where: { id, userId, role: 'MASK' },
      select: { id: true, objectKey: true, sizeBytes: true },
    });
    if (!mask) return false;
    await this.storage.deleteMany([mask.objectKey]);
    await this.prisma.asset.delete({ where: { id: mask.id } });
    await this.quota.releaseStorage(userId, mask.sizeBytes);
    return true;
  }
}

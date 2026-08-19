import { BadRequestException } from '@nestjs/common';

export type PageCursor = { timestamp: Date; id: string };

export function pageLimit(raw: unknown, fallback: number, maximum = 100) {
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new BadRequestException(`limit 必须为 1-${maximum} 的整数`);
  return value;
}

export function encodeCursor(timestamp: Date, id: string) {
  return Buffer.from(JSON.stringify([timestamp.toISOString(), id]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: unknown): PageCursor | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || raw.length > 512) throw new BadRequestException('分页游标无效');
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string') throw new Error();
    const timestamp = new Date(value[0]);
    if (!Number.isFinite(timestamp.getTime()) || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value[1])) throw new Error();
    return { timestamp, id: value[1] };
  } catch {
    throw new BadRequestException('分页游标无效');
  }
}

export function cursorWhere(field: 'createdAt' | 'updatedAt' | 'lastUsedAt', cursor?: PageCursor) {
  if (!cursor) return {};
  return { OR: [
    { [field]: { lt: cursor.timestamp } },
    { [field]: cursor.timestamp, id: { lt: cursor.id } },
  ] };
}

import { BadRequestException } from '@nestjs/common';

const RESERVED_HEADERS = /^(host|content-length|connection|transfer-encoding|cookie|authorization|proxy-|sec-|x-forwarded-)/i;

export function normalizeProviderHeaders(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('自定义头必须为对象');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20) throw new BadRequestException('自定义头不能超过 20 个');
  const result: Record<string, string> = Object.create(null);
  let total = 0;
  for (const [name, raw] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || RESERVED_HEADERS.test(name) || typeof raw !== 'string' || /[\r\n]/.test(raw)) {
      throw new BadRequestException(`自定义头 ${name} 不被允许`);
    }
    total += Buffer.byteLength(name) + Buffer.byteLength(raw);
    if (total > 8192) throw new BadRequestException('自定义头总大小不能超过 8 KiB');
    result[name] = raw;
  }
  return result;
}

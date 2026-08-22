import { readFile } from 'node:fs/promises';
import { MAX_IMAGE_BYTES } from './domain-constants';

export async function fileToDataUrl(path: string, mimeType: string) {
  const bytes = await readFile(path);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('参考图超过大小限制');
  const mime = mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp' ? mimeType : 'image/png';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

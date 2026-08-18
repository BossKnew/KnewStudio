import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class CryptoService {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeKeyId: string;

  constructor() {
    const ring = (process.env.PROVIDER_SECRET_KEYS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    if (ring.length) {
      for (const entry of ring) {
        const separator = entry.indexOf(':');
        const id = entry.slice(0, separator);
        const encoded = entry.slice(separator + 1);
        if (separator < 1 || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)) throw new Error('PROVIDER_SECRET_KEYS 的 key ID 无效');
        const key = Buffer.from(encoded, 'base64');
        if (key.length !== 32) throw new Error(`供应商密钥 ${id} 必须是 32 字节 Base64`);
        this.keys.set(id, key);
      }
    } else {
      const encoded = process.env.PROVIDER_SECRET_KEY;
      if (!encoded) throw new Error('PROVIDER_SECRET_KEY 或 PROVIDER_SECRET_KEYS 未配置');
      const key = Buffer.from(encoded, 'base64');
      if (key.length !== 32) throw new Error('PROVIDER_SECRET_KEY 必须是 32 字节 Base64');
      this.keys.set('legacy', key);
    }
    this.activeKeyId = this.keys.keys().next().value!;
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', this.activeKeyId, ...[iv, cipher.getAuthTag(), payload].map((part) => part.toString('base64url'))].join('.');
  }

  decrypt(value: string): string {
    const parts = value.split('.');
    if (parts[0] === 'v1') {
      const key = this.keys.get(parts[1]);
      if (!key || parts.length !== 5) throw new Error('密钥数据版本或 key ID 无效');
      return this.decryptWith(key, parts.slice(2));
    }
    if (parts.length !== 3) throw new Error('密钥数据损坏');
    for (const key of this.keys.values()) {
      try { return this.decryptWith(key, parts); } catch { /* try the next rotation key */ }
    }
    throw new Error('密钥数据无法使用当前密钥环解密');
  }

  needsRotation(value: string) { return !value.startsWith(`v1.${this.activeKeyId}.`); }

  private decryptWith(key: Buffer, encodedParts: string[]) {
    const [iv, tag, payload] = encodedParts.map((part) => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16 || !payload.length) throw new Error('密钥数据损坏');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
  }
}

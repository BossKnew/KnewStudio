import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class MfaCryptoService {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeKeyId: string;

  constructor() {
    const ring = (process.env.MFA_SECRET_KEYS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    if (ring.length) {
      for (const entry of ring) {
        const separator = entry.indexOf(':');
        const id = entry.slice(0, separator);
        const encoded = entry.slice(separator + 1);
        if (separator < 1 || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)) throw new Error('MFA_SECRET_KEYS 的 key ID 无效');
        const key = Buffer.from(encoded, 'base64');
        if (key.length !== 32) throw new Error(`MFA 密钥 ${id} 必须是 32 字节 Base64`);
        this.keys.set(id, key);
      }
    } else {
      const encoded = process.env.MFA_SECRET_KEY;
      if (!encoded) throw new Error('MFA_SECRET_KEY 或 MFA_SECRET_KEYS 未配置');
      const key = Buffer.from(encoded, 'base64');
      if (key.length !== 32) throw new Error('MFA_SECRET_KEY 必须是 32 字节 Base64');
      this.keys.set('primary', key);
    }
    this.activeKeyId = process.env.MFA_SECRET_ACTIVE_KID || this.keys.keys().next().value!;
    if (!this.keys.has(this.activeKeyId)) throw new Error('MFA_SECRET_ACTIVE_KID 不存在于密钥环中');
  }

  encrypt(value: string, userId: string, purpose: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    cipher.setAAD(this.aad(userId, purpose));
    const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v2', this.activeKeyId, iv, cipher.getAuthTag(), payload]
      .map((part) => Buffer.isBuffer(part) ? part.toString('base64url') : part)
      .join('.');
  }

  decrypt(value: string, userId: string, purpose: string): string {
    const [version, keyId, ivPart, tagPart, payloadPart, extra] = value.split('.');
    const key = this.keys.get(keyId);
    if (!['v1', 'v2'].includes(version) || !key || !ivPart || !tagPart || !payloadPart || extra) throw new Error('MFA 密钥数据无效');
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    const payload = Buffer.from(payloadPart, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || !payload.length) throw new Error('MFA 密钥数据损坏');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(this.aad(userId, purpose, version));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
  }

  needsRotation(value: string) { return !value.startsWith(`v2.${this.activeKeyId}.`); }

  private aad(userId: string, purpose: string, version = 'v2') {
    const namespace = version === 'v1' ? ['kv', 'studio'].join('') : 'knewstudio';
    return Buffer.from(`${namespace}:mfa:${purpose}:${userId}`, 'utf8');
  }
}

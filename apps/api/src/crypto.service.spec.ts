import { randomBytes } from 'node:crypto';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  it('encrypts provider secrets with authenticated encryption', () => {
    process.env.PROVIDER_SECRET_KEY = randomBytes(32).toString('base64');
    const service = new CryptoService();
    const encrypted = service.encrypt('sk-private-value');
    expect(encrypted).not.toContain('sk-private-value');
    expect(service.decrypt(encrypted)).toBe('sk-private-value');
  });

  it('rejects an invalid master key', () => {
    process.env.PROVIDER_SECRET_KEY = Buffer.from('too-short').toString('base64');
    expect(() => new CryptoService()).toThrow();
  });
});

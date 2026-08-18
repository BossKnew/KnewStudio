import { randomBytes } from 'node:crypto';
import { MfaCryptoService } from './mfa-crypto.service';

describe('MfaCryptoService', () => {
  afterEach(() => {
    delete process.env.MFA_SECRET_KEY;
    delete process.env.MFA_SECRET_KEYS;
    delete process.env.MFA_SECRET_ACTIVE_KID;
  });

  it('encrypts the seed and binds it to the user and purpose', () => {
    process.env.MFA_SECRET_KEY = randomBytes(32).toString('base64');
    const service = new MfaCryptoService();
    const encrypted = service.encrypt('BASE32SECRET', 'user-a', 'credential');
    expect(encrypted).not.toContain('BASE32SECRET');
    expect(service.decrypt(encrypted, 'user-a', 'credential')).toBe('BASE32SECRET');
    expect(() => service.decrypt(encrypted, 'user-b', 'credential')).toThrow();
    expect(() => service.decrypt(encrypted, 'user-a', 'pending')).toThrow();
  });

  it('uses an explicitly selected active key while retaining old decrypt keys', () => {
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    process.env.MFA_SECRET_KEYS = `old:${oldKey},next:${newKey}`;
    process.env.MFA_SECRET_ACTIVE_KID = 'next';
    const service = new MfaCryptoService();
    const encrypted = service.encrypt('secret', 'user-a', 'credential');
    expect(encrypted.startsWith('v2.next.')).toBe(true);
    expect(service.decrypt(encrypted, 'user-a', 'credential')).toBe('secret');
  });
});

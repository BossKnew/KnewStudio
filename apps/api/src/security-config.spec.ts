import { randomBytes } from 'node:crypto';
import { validateSecurityConfig } from './security-config';

describe('validateSecurityConfig', () => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    origins: process.env.APP_ORIGINS,
    insecure: process.env.ALLOW_INSECURE_HTTP,
    forwarded: process.env.FORWARDED_HEADERS_MODE,
    bind: process.env.HTTP_BIND_ADDRESS,
    providerKey: process.env.PROVIDER_SECRET_KEY,
    providerKeys: process.env.PROVIDER_SECRET_KEYS,
    mfaKey: process.env.MFA_SECRET_KEY,
    mfaKeys: process.env.MFA_SECRET_KEYS,
    bootstrapUsername: process.env.BOOTSTRAP_ADMIN_USERNAME,
    bootstrapPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    mediaAcceleration: process.env.MEDIA_X_ACCEL_REDIRECT,
  };

  function restore(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  afterEach(() => {
    restore('NODE_ENV', original.nodeEnv);
    restore('APP_ORIGINS', original.origins);
    restore('ALLOW_INSECURE_HTTP', original.insecure);
    restore('FORWARDED_HEADERS_MODE', original.forwarded);
    restore('HTTP_BIND_ADDRESS', original.bind);
    restore('PROVIDER_SECRET_KEY', original.providerKey);
    restore('PROVIDER_SECRET_KEYS', original.providerKeys);
    restore('MFA_SECRET_KEY', original.mfaKey);
    restore('MFA_SECRET_KEYS', original.mfaKeys);
    restore('BOOTSTRAP_ADMIN_USERNAME', original.bootstrapUsername);
    restore('BOOTSTRAP_ADMIN_PASSWORD', original.bootstrapPassword);
    restore('MEDIA_X_ACCEL_REDIRECT', original.mediaAcceleration);
  });

  it('accepts an exact HTTPS production origin', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGINS = 'https://studio.example.com';
    process.env.ALLOW_INSECURE_HTTP = 'false';
    expect(() => validateSecurityConfig()).not.toThrow();
  });

  it.each(['', 'https://*.example.com', 'https://studio.example.com/path', 'https://studio.example.com/'])('rejects an unsafe production origin: %s', (origin) => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGINS = origin;
    process.env.ALLOW_INSECURE_HTTP = 'false';
    expect(() => validateSecurityConfig()).toThrow();
  });

  it('rejects insecure HTTP for a public hostname', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGINS = 'https://studio.example.com';
    process.env.ALLOW_INSECURE_HTTP = 'true';
    expect(() => validateSecurityConfig()).toThrow('private-network');
  });

  it('allows local development over explicitly enabled HTTP', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';
    process.env.ALLOW_INSECURE_HTTP = 'true';
    expect(() => validateSecurityConfig()).not.toThrow();
  });

  it.each(['http://192.168.1.20:8080', 'http://10.0.0.8', 'http://[fd00::20]:8080', 'http://knewstudio.local:8080'])('allows explicitly enabled private-network HTTP: %s', (origin) => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGINS = origin;
    process.env.ALLOW_INSECURE_HTTP = 'true';
    expect(() => validateSecurityConfig()).not.toThrow();
  });

  it('rejects mixed HTTPS origins when insecure HTTP mode is enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGINS = 'http://192.168.1.20:8080,https://studio.example.com';
    process.env.ALLOW_INSECURE_HTTP = 'true';
    expect(() => validateSecurityConfig()).toThrow('private-network');
  });

  it('rejects unknown forwarded-header modes', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGINS = 'https://studio.example.com';
    process.env.ALLOW_INSECURE_HTTP = 'false';
    process.env.FORWARDED_HEADERS_MODE = 'trust-everything';
    expect(() => validateSecurityConfig()).toThrow('FORWARDED_HEADERS_MODE');
  });

  it('rejects trusted proxy headers on a public bind address', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGINS = 'https://studio.example.com';
    process.env.ALLOW_INSECURE_HTTP = 'false';
    process.env.FORWARDED_HEADERS_MODE = 'trusted-single-proxy';
    process.env.HTTP_BIND_ADDRESS = '0.0.0.0';
    expect(() => validateSecurityConfig()).toThrow('loopback HTTP_BIND_ADDRESS');
  });

  it('rejects placeholder and shared encryption keys', () => {
    process.env.PROVIDER_SECRET_KEY = 'change-me-32-byte-base64-key';
    expect(() => validateSecurityConfig()).toThrow('Placeholder');

    const shared = randomBytes(32).toString('base64');
    process.env.PROVIDER_SECRET_KEY = shared;
    process.env.MFA_SECRET_KEY = shared;
    expect(() => validateSecurityConfig()).toThrow('independent');
  });

  it('requires both bootstrap administrator fields', () => {
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    expect(() => validateSecurityConfig()).toThrow('configured together');
  });

  it('rejects an ambiguous media acceleration mode', () => {
    process.env.MEDIA_X_ACCEL_REDIRECT = 'yes';
    expect(() => validateSecurityConfig()).toThrow('MEDIA_X_ACCEL_REDIRECT');
  });
});

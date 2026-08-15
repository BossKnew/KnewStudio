import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20) {
  return encodeBase32(randomBytes(bytes));
}

export function totpUri(options: { issuer: string; label: string; secret: string }) {
  const name = `${options.issuer}:${options.label}`;
  const query = new URLSearchParams({ secret: options.secret, issuer: options.issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(name)}?${query.toString()}`;
}

export function verifyTotp(options: { secret: string; token: string; now?: number; window?: number; afterTimeStep?: number }) {
  if (!/^\d{6}$/.test(options.token)) return { valid: false as const };
  const current = Math.floor((options.now ?? Date.now()) / 1000 / 30);
  const window = options.window ?? 1;
  for (let offset = -window; offset <= window; offset += 1) {
    const timeStep = current + offset;
    if (options.afterTimeStep !== undefined && timeStep <= options.afterTimeStep) continue;
    const expected = generateTotpAtStep(options.secret, timeStep);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(options.token))) return { valid: true as const, timeStep };
  }
  return { valid: false as const };
}

export function generateTotpAtStep(secret: string, timeStep: number, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % (10 ** digits)).toString().padStart(digits, '0');
}

function encodeBase32(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('TOTP Secret 不是有效的 Base32');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bytes.length < 16) throw new Error('TOTP Secret 长度不足');
  return Buffer.from(bytes);
}

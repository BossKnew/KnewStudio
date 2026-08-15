import { generateTotpAtStep, generateTotpSecret, totpUri, verifyTotp } from './totp';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('RFC 6238 TOTP', () => {
  test.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the SHA-1 vector at %i', (seconds, expected) => {
    expect(generateTotpAtStep(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it('accepts one adjacent step and rejects replayed steps', () => {
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    const previous = generateTotpAtStep(RFC_SECRET, step - 1);
    expect(verifyTotp({ secret: RFC_SECRET, token: previous, now, window: 1 })).toEqual({ valid: true, timeStep: step - 1 });
    expect(verifyTotp({ secret: RFC_SECRET, token: previous, now, window: 1, afterTimeStep: step - 1 })).toEqual({ valid: false });
  });

  it('generates a 160-bit Base32 secret and a compatible URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = new URL(totpUri({ issuer: 'KnewStudio', label: 'admin', secret }));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(uri.searchParams.get('period')).toBe('30');
  });
});

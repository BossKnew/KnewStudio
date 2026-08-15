import { assertPassword, cleanUsername } from './common';
import { passwordSchema } from './validation';

describe('input validation', () => {
  it('normalizes valid usernames', () => expect(cleanUsername('  Alice_01 ')).toBe('alice_01'));
  it('rejects unsafe usernames', () => expect(() => cleanUsername('../admin')).toThrow());
  it('requires a sufficiently long password', () => expect(() => assertPassword('short')).toThrow());
  it('enforces the 15 character administrator password floor', () => {
    expect(() => assertPassword('12345678901234')).toThrow();
    expect(assertPassword('123456789012345')).toBe('123456789012345');
  });
  it('accepts regular user passwords from 8 characters with all required character classes', () => {
    expect(assertPassword('Abcd123!', 'USER')).toBe('Abcd123!');
    expect(() => assertPassword('abcdefgh', 'USER')).toThrow('密码强度不够');
    expect(() => assertPassword('Abc123!', 'USER')).toThrow('密码强度不够');
  });
  it('lets short password input reach the role-aware strength validator', () => {
    expect(passwordSchema.safeParse('short').success).toBe(true);
  });
});

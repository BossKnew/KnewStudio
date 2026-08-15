import * as argon2 from 'argon2';
import { ConcurrencyGate } from './concurrency-gate';
import { intEnv } from './security-config';

const passwordWork = new ConcurrencyGate(intEnv('PASSWORD_HASH_CONCURRENCY', 1, 1, 4));

export function hashPassword(password: string | Buffer) {
  return passwordWork.run(() => argon2.hash(password, { type: argon2.argon2id }));
}

export function verifyPassword(hash: string, password: string | Buffer) {
  return passwordWork.run(() => argon2.verify(hash, password));
}

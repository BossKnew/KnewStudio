import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordError } from './password-policy.ts';

test('regular users can use a strong eight-character password', () => {
  assert.equal(passwordError('Abcd123!', 'USER'), '');
});

test('regular user password errors explain the missing strength', () => {
  assert.match(passwordError('short', 'USER'), /密码强度不够/);
});

test('administrator passwords keep the fifteen-character minimum', () => {
  assert.match(passwordError('Abcd123!', 'ADMIN'), /15 位/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatStorageBytes } from './format-bytes.ts';

test('keeps byte values below 1024 as integers', () => {
  assert.equal(formatStorageBytes(0), '0 B');
  assert.equal(formatStorageBytes('1023'), '1023 B');
});

test('formats storage using 1024-based units with two decimals', () => {
  assert.equal(formatStorageBytes('1024'), '1.00 KB');
  assert.equal(formatStorageBytes(1536), '1.50 KB');
  assert.equal(formatStorageBytes(1024n * 1024n), '1.00 MB');
  assert.equal(formatStorageBytes('6107432'), '5.82 MB');
  assert.equal(formatStorageBytes(1024n * 1024n * 1024n), '1.00 GB');
  assert.equal(formatStorageBytes(1536n * 1024n * 1024n), '1.50 GB');
});

test('caps display at GB and handles invalid values safely', () => {
  assert.equal(formatStorageBytes(1024n ** 4n), '1024.00 GB');
  assert.equal(formatStorageBytes('not-a-number'), '0 B');
});

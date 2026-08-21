import assert from 'node:assert/strict';
import test from 'node:test';
import { extensionForMime } from './download.ts';

test('uses safe extensions for supported image content types', () => {
  assert.equal(extensionForMime('image/png'), '.png');
  assert.equal(extensionForMime('image/jpeg'), '.jpg');
  assert.equal(extensionForMime('image/webp'), '.webp');
  assert.equal(extensionForMime('application/octet-stream'), '.png');
  assert.equal(extensionForMime('video/mp4'), '.mp4');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { optionLabelFor } from './option-labels.ts';

test('uses the locale label when present and falls back to the raw value', () => {
  const map = { auto: { zh: '自动', en: 'Auto' }, '1024x1024': { zh: '1:1' } };
  assert.equal(optionLabelFor(map, 'auto', 'zh'), '自动');
  assert.equal(optionLabelFor(map, 'auto', 'en'), 'Auto');
  assert.equal(optionLabelFor(map, '1024x1024', 'en'), '1024x1024');
  assert.equal(optionLabelFor(map, 'low', 'zh'), 'low');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedCanvasSize, MAX_MASK_CANVAS_EDGE } from './mask-canvas.ts';

test('bounds an 8192px mask editor while preserving aspect ratio', () => {
  assert.deepEqual(boundedCanvasSize(8192, 4096), { width: 2048, height: 1024 });
  assert.equal(Math.max(...Object.values(boundedCanvasSize(8192, 8192))), MAX_MASK_CANVAS_EDGE);
});

test('does not enlarge small source images', () => {
  assert.deepEqual(boundedCanvasSize(640, 480), { width: 640, height: 480 });
});

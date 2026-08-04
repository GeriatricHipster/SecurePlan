import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIT_PLAN_ZOOM,
  MAX_PLAN_ZOOM,
  MIN_PLAN_ZOOM,
  clampPlanZoom,
  pointerDistance,
  pointerMidpoint,
  zoomFromPinch,
} from '../../src/components/planGestures.js';

test('pinch gesture math zooms in and out around two touch points', () => {
  const first = { x: 20, y: 30 };
  const second = { x: 120, y: 30 };
  assert.equal(pointerDistance(first, second), 100);
  assert.deepEqual(pointerMidpoint(first, second), { x: 70, y: 30 });
  assert.equal(zoomFromPinch(1, 100, 150), 1.5);
  assert.equal(zoomFromPinch(1, 100, 50), 0.5);
});

test('pinch zoom clamps safely and ignores invalid or zero-distance input', () => {
  assert.equal(zoomFromPinch(1, 100, 1000), MAX_PLAN_ZOOM);
  assert.equal(zoomFromPinch(1, 100, 1), MIN_PLAN_ZOOM);
  assert.equal(zoomFromPinch(1.2, 0, 50), 1.2);
  assert.equal(zoomFromPinch(1.2, Number.NaN, 50), 1.2);
  assert.equal(clampPlanZoom(Number.NaN), FIT_PLAN_ZOOM);
});

import assert from 'node:assert/strict';

// Floating-point-safe equality for hand-computed expected values.
export function closeTo(actual, expected, epsilon = 0.01, message) {
  assert.ok(Number.isFinite(actual), message || `expected a finite number, got ${actual}`);
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= epsilon, message || `expected ${actual} to be within ${epsilon} of ${expected} (diff ${diff})`);
}

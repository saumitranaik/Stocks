import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { number, clamp, average, precisionForConfidence } from '../data/util.mjs';

describe('util.number', () => {
  it('rounds to 2 decimals by default', () => {
    assert.equal(number(3.14159), 3.14);
  });
  it('respects a custom digit count', () => {
    assert.equal(number(5.6, 0), 6);
  });
  it('returns null for non-finite input', () => {
    assert.equal(number(NaN), null);
    assert.equal(number(Infinity), null);
    assert.equal(number(undefined), null);
  });
});

describe('util.clamp', () => {
  it('passes values already in range through unchanged', () => {
    assert.equal(clamp(5, 0, 10), 5);
  });
  it('floors below the minimum', () => {
    assert.equal(clamp(-5, 0, 10), 0);
  });
  it('ceils above the maximum', () => {
    assert.equal(clamp(15, 0, 10), 10);
  });
});

describe('util.average', () => {
  it('averages finite values', () => {
    assert.equal(average([1, 2, 3]), 2);
  });
  it('filters out non-finite entries rather than propagating NaN', () => {
    assert.equal(average([1, NaN, 3, undefined, 5]), 3);
  });
  it('returns null for an empty or all-non-finite input', () => {
    assert.equal(average([]), null);
    assert.equal(average([NaN, undefined]), null);
  });
});

describe('util.precisionForConfidence', () => {
  it('keeps 2-decimal precision for High confidence (no behavior change for the common case)', () => {
    assert.equal(precisionForConfidence(123.456, 'High'), 123.46);
  });
  it('rounds to the nearest whole unit for Medium confidence', () => {
    assert.equal(precisionForConfidence(123.456, 'Medium'), 123);
  });
  it('rounds to the nearest 5 for Low confidence', () => {
    assert.equal(precisionForConfidence(123.456, 'Low'), 125);
    assert.equal(precisionForConfidence(122, 'Low'), 120);
  });
  it('returns null for non-finite input regardless of confidence band', () => {
    assert.equal(precisionForConfidence(NaN, 'High'), null);
  });
});

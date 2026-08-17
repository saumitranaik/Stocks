import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sharesOutstanding } from '../data/analytics/shares.mjs';
import { buildSeries } from './helpers/fixtures.mjs';

describe('shares.sharesOutstanding', () => {
  it('derives share count from Equity Capital / Face Value', () => {
    const bs = buildSeries(['FY23', 'FY24'], { equityCapital: [90, 100] });
    assert.equal(sharesOutstanding(bs, { faceValue: 10 }), 100_000_000);
  });
  it('returns null when equity capital is missing/non-positive', () => {
    const bs = buildSeries(['FY24'], { equityCapital: [0] });
    assert.equal(sharesOutstanding(bs, { faceValue: 10 }), null);
  });
  it('returns null when face value is missing/non-positive', () => {
    const bs = buildSeries(['FY24'], { equityCapital: [100] });
    assert.equal(sharesOutstanding(bs, {}), null);
    assert.equal(sharesOutstanding(bs, { faceValue: 0 }), null);
  });
});

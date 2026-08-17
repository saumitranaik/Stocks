import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cagr, cagrOverYears, longestAvailableCagr } from '../data/analytics/cagr.mjs';
import { buildSeries } from './helpers/fixtures.mjs';
import { closeTo } from './helpers/assert.mjs';

describe('cagr.cagr', () => {
  it('computes a doubling over 1 year as 100%', () => {
    assert.equal(cagr(100, 200, 1), 100);
  });
  it('computes flat growth as 0%', () => {
    assert.equal(cagr(100, 100, 5), 0);
  });
  it('refuses a negative/zero begin value', () => {
    assert.equal(cagr(-100, 200, 5), null);
    assert.equal(cagr(0, 200, 5), null);
  });
  it('refuses a negative/zero end value', () => {
    assert.equal(cagr(100, -50, 5), null);
    assert.equal(cagr(100, 0, 5), null);
  });
  it('refuses a non-positive year span', () => {
    assert.equal(cagr(100, 200, 0), null);
    assert.equal(cagr(100, 200, -2), null);
  });
});

describe('cagr.cagrOverYears', () => {
  it('reads begin/end off the trailing N full fiscal years, TTM-aware', () => {
    const series = buildSeries(['FY20', 'FY21', 'FY22', 'FY23', 'TTM'], { sales: [95, 100, 110, 150, 999] });
    // latest full year = FY23 (150); 3 years back = FY20 (95)
    const expected = (Math.pow(150 / 95, 1 / 3) - 1) * 100;
    closeTo(cagrOverYears(series, 'sales', 3), expected, 0.01);
  });
  it('returns null when the series does not reach back that far', () => {
    const series = buildSeries(['FY23'], { sales: [150] });
    assert.equal(cagrOverYears(series, 'sales', 3), null);
  });
  it('returns null for a missing series', () => {
    assert.equal(cagrOverYears(undefined, 'sales', 3), null);
  });
});

describe('cagr.longestAvailableCagr', () => {
  it('uses the full span the data covers and labels it', () => {
    const series = buildSeries(['FY20', 'FY21', 'FY22', 'FY23'], { sales: [80, 100, 120, 150] });
    const result = longestAvailableCagr(series, 'sales');
    assert.equal(result.years, 3);
    closeTo(result.value, (Math.pow(150 / 80, 1 / 3) - 1) * 100, 0.01);
  });
  it('returns null when fewer than 2 full-FY points exist', () => {
    const series = buildSeries(['FY23'], { sales: [150] });
    assert.equal(longestAvailableCagr(series, 'sales'), null);
  });
});

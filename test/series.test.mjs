import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { latestFullYearIndex, valueAt, latest, nYearsAgoIndex, valueYearsAgo, timeSeries, stdDev } from '../data/analytics/series.mjs';
import { buildSeries } from './helpers/fixtures.mjs';

describe('series.latestFullYearIndex', () => {
  it('is the last index when the last period is a full year', () => {
    assert.equal(latestFullYearIndex(['FY21', 'FY22', 'FY23']), 2);
  });
  it('steps back one extra index when the last period is the TTM partial year', () => {
    assert.equal(latestFullYearIndex(['FY21', 'FY22', 'FY23', 'TTM']), 2);
  });
  it('returns -1 for an empty/missing periods array', () => {
    assert.equal(latestFullYearIndex([]), -1);
    assert.equal(latestFullYearIndex(undefined), -1);
  });
});

describe('series.valueAt', () => {
  const rows = { sales: [100, 200, 300] };
  it('reads a finite value at index', () => {
    assert.equal(valueAt(rows, 'sales', 1), 200);
  });
  it('returns null for a negative index', () => {
    assert.equal(valueAt(rows, 'sales', -1), null);
  });
  it('returns null for a missing/non-finite value', () => {
    assert.equal(valueAt(rows, 'missingField', 0), null);
  });
});

describe('series.latest / valueYearsAgo (TTM-aware)', () => {
  const series = buildSeries(['FY20', 'FY21', 'FY22', 'FY23', 'TTM'], { sales: [100, 110, 120, 130, 999] });
  it('latest() skips the TTM column and reads the last full year', () => {
    assert.equal(latest(series, 'sales'), 130);
  });
  it('nYearsAgoIndex counts back from the last full year, not the TTM column', () => {
    assert.equal(nYearsAgoIndex(series.periods, 3), 0);
  });
  it('valueYearsAgo resolves the value at that index', () => {
    assert.equal(valueYearsAgo(series, 'sales', 3), 100);
  });
  it('returns null when the lookback goes before the start of history', () => {
    assert.equal(valueYearsAgo(series, 'sales', 10), null);
  });
  it('returns null for a missing series', () => {
    assert.equal(latest(undefined, 'sales'), null);
    assert.equal(valueYearsAgo(undefined, 'sales', 1), null);
  });
});

describe('series.timeSeries', () => {
  it('pairs each period with its value, filtering non-finite entries', () => {
    const series = buildSeries(['FY21', 'FY22', 'FY23'], { roce: [15, null, 18] });
    assert.deepEqual(timeSeries(series, 'roce'), [['FY21', 15], ['FY23', 18]]);
  });
  it('returns [] for a missing series', () => {
    assert.deepEqual(timeSeries(undefined, 'roce'), []);
  });
});

describe('series.stdDev', () => {
  it('returns null for fewer than 2 values', () => {
    assert.equal(stdDev([5]), null);
    assert.equal(stdDev([]), null);
  });
  it('computes population standard deviation', () => {
    // mean=5, deviations [-3,-1,1,3] -> variance=(9+1+1+9)/4=5 -> sqrt(5)
    assert.equal(stdDev([2, 4, 6, 8]), Math.sqrt(5));
  });
});

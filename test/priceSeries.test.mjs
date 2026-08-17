import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestPoint, alignSeries, returnsOf, pearsonCorrelation, prepareSeries,
  correlationFromPrepared, annualizedVolatilityPct, downsideDeviationPct,
  maxDrawdownPct, percentileRank
} from '../data/analytics/priceSeries.mjs';
import { closeTo } from './helpers/assert.mjs';

describe('priceSeries.nearestPoint', () => {
  const points = [{ date: '2024-01-01', close: 10 }, { date: '2024-01-10', close: 20 }];
  it('finds the nearest point within tolerance', () => {
    assert.equal(nearestPoint(points, '2024-01-03', 10).close, 10);
  });
  it('returns null when nothing is within tolerance', () => {
    assert.equal(nearestPoint(points, '2024-02-01', 10), null);
  });
  it('returns null for an empty series', () => {
    assert.equal(nearestPoint([], '2024-01-01'), null);
  });
});

describe('priceSeries.alignSeries', () => {
  it('pairs points within the default 4-day tolerance', () => {
    const a = [{ date: '2024-01-01', close: 100 }];
    const b = [{ date: '2024-01-04', close: 200 }];
    assert.deepEqual(alignSeries(a, b), [[100, 200]]);
  });
  it('drops a point with no match within tolerance', () => {
    const a = [{ date: '2024-01-01', close: 100 }];
    const b = [{ date: '2024-01-10', close: 200 }];
    assert.deepEqual(alignSeries(a, b), []);
  });
  it('returns [] for an empty input series', () => {
    assert.deepEqual(alignSeries([], [{ date: '2024-01-01', close: 1 }]), []);
  });
});

describe('priceSeries.returnsOf', () => {
  it('sorts chronologically before computing returns, regardless of input order', () => {
    const points = [
      { date: '2024-01-08', close: 110 },
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-15', close: 99 }
    ];
    const returns = returnsOf(points);
    assert.equal(returns.length, 2);
    closeTo(returns[0], 0.10, 0.0001);
    closeTo(returns[1], -0.10, 0.0001);
  });
  it('returns [] for an empty series', () => {
    assert.deepEqual(returnsOf([]), []);
  });
});

// Perfectly linear price relationships give exact +-1 correlation, an
// unambiguous cross-check independent of any implementation detail.
function weeklyPoints(closes) {
  return closes.map((close, i) => ({ date: new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10), close }));
}
const BENCH_CLOSES = [100, 105, 102, 110, 108, 115, 120, 118, 125, 130];

describe('priceSeries.pearsonCorrelation / prepareSeries+correlationFromPrepared', () => {
  it('is ~1 for an exact positive linear relationship', () => {
    const bench = weeklyPoints(BENCH_CLOSES);
    const stock = weeklyPoints(BENCH_CLOSES.map(c => 3 * c - 50));
    closeTo(pearsonCorrelation(stock, bench), 1, 0.001);
  });
  it('is ~-1 for an exact inverse linear relationship', () => {
    const bench = weeklyPoints(BENCH_CLOSES);
    const stock = weeklyPoints(BENCH_CLOSES.map(c => -2 * c + 1000));
    closeTo(pearsonCorrelation(stock, bench), -1, 0.001);
  });
  it('returns null below the 10-pair minimum', () => {
    const bench = weeklyPoints(BENCH_CLOSES.slice(0, 5));
    const stock = weeklyPoints(BENCH_CLOSES.slice(0, 5).map(c => 3 * c - 50));
    assert.equal(pearsonCorrelation(stock, bench), null);
  });
  it('the prepared-array path agrees with pearsonCorrelation on identical data', () => {
    const bench = weeklyPoints(BENCH_CLOSES);
    const stock = weeklyPoints(BENCH_CLOSES.map(c => 3 * c - 50));
    const a = prepareSeries(stock), b = prepareSeries(bench);
    assert.equal(correlationFromPrepared(a, b), pearsonCorrelation(stock, bench));
  });
});

describe('priceSeries.annualizedVolatilityPct', () => {
  it('is 0 for a constant weekly return (zero variance)', () => {
    const points = weeklyPoints(Array.from({ length: 15 }, (_, i) => 100 * Math.pow(1.01, i)));
    assert.equal(annualizedVolatilityPct(points), 0);
  });
  it('matches the stdev x sqrt(52) formula for an alternating +-2% return series', () => {
    const closes = [100];
    for (let i = 0; i < 14; i++) closes.push(closes[closes.length - 1] * (i % 2 === 0 ? 1.02 : 0.98));
    const expected = 0.02 * Math.sqrt(52) * 100;
    closeTo(annualizedVolatilityPct(weeklyPoints(closes)), expected, 0.01);
  });
  it('returns null below the 10-return minimum', () => {
    assert.equal(annualizedVolatilityPct(weeklyPoints([100, 101, 102])), null);
  });
});

describe('priceSeries.downsideDeviationPct', () => {
  it('counts only sub-threshold returns, annualized the same way as volatility', () => {
    const closes = [100];
    for (let i = 0; i < 14; i++) closes.push(closes[closes.length - 1] * (i % 2 === 0 ? 1.02 : 0.98));
    // 7 of 14 returns are -2% (below threshold 0); downside variance = 7*0.02^2/14
    const expected = Math.sqrt((7 * 0.02 ** 2) / 14) * Math.sqrt(52) * 100;
    closeTo(downsideDeviationPct(weeklyPoints(closes), 0), expected, 0.01);
  });
  it('returns null below the 10-return minimum', () => {
    assert.equal(downsideDeviationPct(weeklyPoints([100, 101, 102])), null);
  });
});

describe('priceSeries.maxDrawdownPct', () => {
  it('finds the true peak-to-trough drawdown regardless of input order', () => {
    const points = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-08', close: 120 },
      { date: '2024-01-15', close: 80 },
      { date: '2024-01-22', close: 90 }
    ];
    closeTo(maxDrawdownPct(points), ((80 - 120) / 120) * 100, 0.01);
  });
  it('returns null for an empty series', () => {
    assert.equal(maxDrawdownPct([]), null);
  });
});

describe('priceSeries.percentileRank', () => {
  const history = [10, 20, 30, 40, 50];
  it('computes the % of history at or below the value', () => {
    assert.equal(percentileRank(30, history), 60);
    assert.equal(percentileRank(5, history), 0);
    assert.equal(percentileRank(50, history), 100);
  });
  it('returns null for a null value or too little history', () => {
    assert.equal(percentileRank(null, history), null);
    assert.equal(percentileRank(10, [10, 20]), null);
  });
});

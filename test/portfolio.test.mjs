import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWeights, weightedAverage, sectorAllocation, watchlistAverages,
  positionConcentration, portfolioVolatilityPct
} from '../data/analytics/portfolio.mjs';
import { closeTo } from './helpers/assert.mjs';

describe('portfolio.resolveWeights', () => {
  it('returns [] for an empty watchlist', () => {
    assert.deepEqual(resolveWeights([]), []);
  });
  it('splits equally across the invested portion when nothing is user-weighted', () => {
    assert.deepEqual(resolveWeights([{}, {}], 0), [50, 50]);
  });
  it('nets the cash allocation target out of the equal split', () => {
    assert.deepEqual(resolveWeights([{}, {}], 20), [40, 40]);
  });
  it('fills unset companies with the remainder after explicit weights, exactly (no rescale needed)', () => {
    assert.deepEqual(resolveWeights([{ targetWeightPct: 40 }, {}], 20), [40, 40]);
    assert.deepEqual(resolveWeights([{ targetWeightPct: 50 }, {}, {}], 0), [50, 25, 25]);
  });
  it('proportionally rescales every weight, including explicit ones, when explicit weights alone exceed the invested target', () => {
    assert.deepEqual(resolveWeights([{ targetWeightPct: 80 }, { targetWeightPct: 80 }], 0), [50, 50]);
  });
});

describe('portfolio.weightedAverage', () => {
  it('weights only finite values, ignoring the rest', () => {
    assert.equal(weightedAverage([[10, 50], [20, 30], [NaN, 20]]), 13.75);
  });
  it('returns null when no weight resolves', () => {
    assert.equal(weightedAverage([[10, 0]]), null);
    assert.equal(weightedAverage([]), null);
  });
});

describe('portfolio.watchlistAverages', () => {
  it('averages each field independently, unaffected by other fields missing', () => {
    const stocks = [
      { pe: 10, metrics: { roe: 15, roce: 12, revenueCagr3y: 8 }, change: 2, score: 70 },
      { pe: 20, metrics: { roe: 25, roce: 18, revenueCagr3y: 12 }, change: -1, score: 60 }
    ];
    const result = watchlistAverages(stocks);
    assert.equal(result.pe, 15);
    assert.equal(result.roe, 20);
    assert.equal(result.roce, 15);
    assert.equal(result.revenueGrowth3y, 10);
    assert.equal(result.debtToEquity, null); // never sourced in this fixture -- must not default to 0
    assert.equal(result.change, 0.5);
    assert.equal(result.score, 65);
  });
});

describe('portfolio.sectorAllocation', () => {
  it('computes count-based share, top concentration flag, and a real HHI diversification score', () => {
    const stocks = [{ sector: 'IT' }, { sector: 'IT' }, { sector: 'Banking' }, { sector: 'Banking' }];
    const result = sectorAllocation(stocks);
    assert.equal(result.topShare, 50);
    assert.equal(result.concentrated, true); // 50% > the 40% concentration threshold
    assert.equal(result.diversificationScore, 50); // HHI = 0.25+0.25=0.5 -> (1-0.5)*100
  });
  it('flags concentration above the 40% threshold', () => {
    const stocks = [{ sector: 'IT' }, { sector: 'IT' }, { sector: 'IT' }, { sector: 'Banking' }];
    const result = sectorAllocation(stocks);
    assert.equal(result.topShare, 75);
    assert.equal(result.concentrated, true);
  });
  it('returns a null-safe empty shape for an empty watchlist', () => {
    assert.deepEqual(sectorAllocation([]), { allocation: [], topShare: null, concentrated: false, diversificationScore: null });
  });
});

describe('portfolio.positionConcentration', () => {
  it('computes HHI, effective holdings, and per-position contribution that sums to ~100%', () => {
    const stocks = [{ symbol: 'A', name: 'A Ltd' }, { symbol: 'B', name: 'B Ltd' }];
    const result = positionConcentration(stocks, [60, 40]);
    closeTo(result.hhi, 0.52, 0.001);
    closeTo(result.effectiveHoldings, 1 / 0.52, 0.01); // effectiveHoldings is rounded to 2 decimals
    assert.equal(result.topPositionPct, 60);
    const contributionSum = result.contributions.reduce((s, c) => s + c.hhiContributionPct, 0);
    closeTo(contributionSum, 100, 0.01);
    const a = result.contributions.find(c => c.symbol === 'A');
    closeTo(a.hhiContributionPct, (0.36 / 0.52) * 100, 0.01);
  });
  it('excludes unresolved positions from the total, same as every other portfolio aggregate', () => {
    const stocks = [{ symbol: 'A', unresolved: true }, { symbol: 'B' }];
    const result = positionConcentration(stocks, [60, 40]);
    assert.equal(result.contributions.length, 1);
    assert.equal(result.topPositionPct, 100);
  });
});

describe('portfolio.portfolioVolatilityPct', () => {
  it('matches the real variance-decomposition formula (not a correlation-blind average)', () => {
    const symbols = ['A', 'B'];
    const weightBySymbol = new Map([['A', 60], ['B', 40]]);
    const volatilityBySymbol = new Map([['A', 20], ['B', 30]]);
    const correlation = { matrix: [[1, 0.5], [0.5, 1]] };
    // variance = w1^2 s1^2 + w2^2 s2^2 + 2 w1 w2 s1 s2 rho
    const w1 = 0.6, w2 = 0.4, s1 = 0.2, s2 = 0.3, rho = 0.5;
    const expectedVariance = w1 ** 2 * s1 ** 2 + w2 ** 2 * s2 ** 2 + 2 * w1 * w2 * s1 * s2 * rho;
    const expectedPct = Math.sqrt(expectedVariance) * 100;
    closeTo(portfolioVolatilityPct(symbols, weightBySymbol, volatilityBySymbol, correlation), expectedPct, 0.01);
  });
  it('returns null for an empty symbol set', () => {
    assert.equal(portfolioVolatilityPct([], new Map(), new Map(), { matrix: [] }), null);
  });
});

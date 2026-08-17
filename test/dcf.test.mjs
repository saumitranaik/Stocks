import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dcfAssumptions, beta, wacc, dcfValuation } from '../data/analytics/dcf.mjs';
import { buildSeries, buildWeeklyPoints } from './helpers/fixtures.mjs';
import { closeTo } from './helpers/assert.mjs';

describe('dcf.dcfAssumptions', () => {
  it('returns the disclosed per-market constants', () => {
    assert.deepEqual(dcfAssumptions('India'), { riskFreeRatePct: 7.1, equityRiskPremiumPct: 5.5, terminalGrowthPct: 4.0 });
    assert.deepEqual(dcfAssumptions('United States'), { riskFreeRatePct: 4.3, equityRiskPremiumPct: 5.0, terminalGrowthPct: 3.0 });
    assert.deepEqual(dcfAssumptions('Global'), { riskFreeRatePct: 4.5, equityRiskPremiumPct: 5.5, terminalGrowthPct: 3.0 });
  });
  it('falls back to Global for an unrecognized market rather than guessing', () => {
    assert.deepEqual(dcfAssumptions('Mars'), dcfAssumptions('Global'));
  });
});

describe('dcf.beta', () => {
  it('returns null below the ~30-pair / 20-return minimum', () => {
    const bench = buildWeeklyPoints('2024-01-01', 100, [0.01, -0.01], 10);
    const stock = buildWeeklyPoints('2024-01-01', 50, [0.02, -0.02], 10);
    assert.equal(beta(stock, bench), null);
  });
  it('recovers an exact beta from a perfectly linear return relationship', () => {
    // benchmark weekly returns cycle through a varied, non-degenerate pattern;
    // the stock's return is exactly 2x the benchmark's every week, so
    // cov/var(bench) = 2 exactly, with no noise to average out.
    const benchReturns = [0.02, -0.015, 0.01, -0.008, 0.005, 0.012, -0.02];
    const stockReturns = benchReturns.map(r => 2 * r);
    const bench = buildWeeklyPoints('2024-01-01', 100, benchReturns, 40);
    const stock = buildWeeklyPoints('2024-01-01', 50, stockReturns, 40);
    closeTo(beta(stock, bench), 2, 0.02);
  });
});

describe('dcf.wacc', () => {
  it('returns null when beta is not finite or market cap is non-positive', () => {
    assert.equal(wacc({ market: 'India', betaValue: NaN, marketCap: 1000 }), null);
    assert.equal(wacc({ market: 'India', betaValue: 1.2, marketCap: 0 }), null);
  });
  it('is pure cost-of-equity when there is no debt', () => {
    const result = wacc({ market: 'India', betaValue: 1.0, marketCap: 1000, debt: 0 });
    const costOfEquityPct = 7.1 + 1.0 * 5.5; // Rf + beta*ERP
    closeTo(result.waccPct, costOfEquityPct, 0.01);
    assert.equal(result.costOfDebtPct, null);
    closeTo(result.equityWeightPct, 100, 0.01);
  });
  it('blends in the after-tax cost of debt when interest and tax data resolve', () => {
    const result = wacc({ market: 'India', betaValue: 1.2, marketCap: 20000, debt: 600, interest: 65, taxPct: 25 });
    const costOfEquityPct = 7.1 + 1.2 * 5.5;
    const pretaxCostOfDebtPct = (65 / 600) * 100;
    const costOfDebtPct = pretaxCostOfDebtPct * 0.75;
    const equityWeight = 20000 / 20600, debtWeight = 600 / 20600;
    const expectedBlend = costOfEquityPct * equityWeight + costOfDebtPct * debtWeight;
    closeTo(result.costOfDebtPct, costOfDebtPct, 0.01);
    closeTo(result.waccPct, expectedBlend, 0.01);
  });
  it('clamps an out-of-range tax % to the 0-50 band before tax-effecting the debt cost', () => {
    const result = wacc({ market: 'India', betaValue: 1.0, marketCap: 10000, debt: 1000, interest: 100, taxPct: 100 });
    closeTo(result.costOfDebtPct, 10 * (1 - 0.5), 0.01); // clamp(100,0,50)=50 -> 50% tax effect
  });
  it('falls back to cost of equity for the debt slice when debt exists but interest does not resolve', () => {
    const result = wacc({ market: 'India', betaValue: 1.0, marketCap: 1000, debt: 500, interest: 0 });
    const costOfEquityPct = 7.1 + 1.0 * 5.5;
    assert.equal(result.costOfDebtPct, null);
    closeTo(result.waccPct, costOfEquityPct, 0.01); // (equityWeight+debtWeight)=1, both priced at cost of equity
  });
});

// Full dcfValuation() scenario with an internally-consistent, hand-checkable
// fundamentals fixture. The 10-year present-value projection itself
// (projectPresentValue) isn't exported, so it's verified through documented
// behavioral invariants (bull > base > bear; sensitivity monotonic in WACC
// and terminal growth) rather than re-deriving its output by hand.
function fullFixture(overrides = {}) {
  const cf = buildSeries(['FY20', 'FY21', 'FY22', 'FY23', 'FY24'], { freeCashFlow: [80, 95, 110, 130, 150] });
  const pl = buildSeries(['FY20', 'FY21', 'FY22', 'FY23', 'FY24'], {
    sales: [1000, 1100, 1200, 1300, 1500], interest: [50, 50, 55, 60, 65], taxPct: [25, 25, 25, 25, 25]
  });
  const bs = buildSeries(['FY20', 'FY21', 'FY22', 'FY23', 'FY24'], {
    equityCapital: [100, 100, 100, 100, 100], borrowings: [500, 520, 540, 560, 600]
  });
  return {
    market: 'India',
    fundamentals: { annual: { profitLoss: pl, balanceSheet: bs, cashFlow: cf }, snapshot: { marketCap: 20000, faceValue: 10 } },
    quote: { regularMarketPrice: 250 },
    betaValue: 1.2,
    reversionFairValue: 300,
    ...overrides
  };
}

describe('dcf.dcfValuation — available scenario', () => {
  const result = dcfValuation(fullFixture());

  it('resolves as available with the expected growth input (FCF 3y CAGR)', () => {
    assert.equal(result.available, true);
    const expectedGrowth = (Math.pow(150 / 95, 1 / 3) - 1) * 100;
    closeTo(result.growth1Pct, expectedGrowth, 0.02);
  });

  it('computes WACC via the documented CAPM + after-tax-cost-of-debt blend', () => {
    const costOfEquityPct = 7.1 + 1.2 * 5.5;
    const costOfDebtPct = ((65 / 600) * 100) * 0.75;
    const equityWeight = 20000 / 20600, debtWeight = 600 / 20600;
    closeTo(result.wacc.waccPct, costOfEquityPct * equityWeight + costOfDebtPct * debtWeight, 0.02);
  });

  it('produces a positive base fair value with bull > base > bear', () => {
    assert.ok(result.base > 0);
    assert.ok(result.bull > result.base);
    assert.ok(result.base > result.bear);
  });

  it('produces a 3x3 sensitivity grid, monotonic in WACC (down) and terminal growth (up)', () => {
    assert.equal(result.sensitivity.length, 3);
    for (const row of result.sensitivity) assert.equal(row.row.length, 3);
    // holding terminal growth at its base column (index 1), fair value must
    // fall as WACC rises across the 3 rows (-1.5, 0, +1.5)
    const atBaseTg = result.sensitivity.map(r => r.row[1].fairValue);
    assert.ok(atBaseTg[0] > atBaseTg[1]);
    assert.ok(atBaseTg[1] > atBaseTg[2]);
    // within a row, fair value must rise as terminal growth rises
    for (const row of result.sensitivity) {
      assert.ok(row.row[0].fairValue < row.row[1].fairValue);
      assert.ok(row.row[1].fairValue < row.row[2].fairValue);
    }
  });

  it('produces a reverse-implied growth rate within the search band', () => {
    assert.ok(Number.isFinite(result.reverseImpliedGrowthPct));
    assert.ok(result.reverseImpliedGrowthPct >= -30 && result.reverseImpliedGrowthPct <= 60);
  });

  it('produces a disclosed confidence score/band', () => {
    assert.ok(Number.isFinite(result.valuationConfidenceScore));
    assert.ok(result.valuationConfidenceScore >= 0 && result.valuationConfidenceScore <= 100);
    assert.ok(['High', 'Medium', 'Low'].includes(result.confidenceBand));
  });
});

describe('dcf.dcfValuation — disclosed unavailable reasons, never a fabricated fallback', () => {
  it('declines when free cash flow history is non-positive', () => {
    const cf = buildSeries(['FY23', 'FY24'], { freeCashFlow: [-5, -2] });
    const result = dcfValuation(fullFixture({ fundamentals: { ...fullFixture().fundamentals, annual: { ...fullFixture().fundamentals.annual, cashFlow: cf } } }));
    assert.equal(result.available, false);
    assert.match(result.reason, /free cash flow/i);
  });

  it('declines when neither FCF nor revenue history is long enough for a growth estimate', () => {
    const thinCf = buildSeries(['FY23', 'FY24'], { freeCashFlow: [100, 120] });
    const thinPl = buildSeries(['FY23', 'FY24'], { sales: [1000, 1100], interest: [50, 55], taxPct: [25, 25] });
    const base = fullFixture();
    const result = dcfValuation({ ...base, fundamentals: { ...base.fundamentals, annual: { ...base.fundamentals.annual, cashFlow: thinCf, profitLoss: thinPl } } });
    assert.equal(result.available, false);
    assert.match(result.reason, /growth estimate/i);
  });

  it('declines rather than assuming a default beta of 1 when beta is not computable', () => {
    const result = dcfValuation(fullFixture({ betaValue: null }));
    assert.equal(result.available, false);
    assert.match(result.reason, /beta/i);
  });

  it('declines when the share count cannot be derived (no face value)', () => {
    const base = fullFixture();
    const result = dcfValuation({ ...base, fundamentals: { ...base.fundamentals, snapshot: { marketCap: 20000 } } });
    assert.equal(result.available, false);
    assert.match(result.reason, /share count/i);
  });
});

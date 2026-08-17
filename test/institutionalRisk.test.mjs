import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sectorRiskTags, institutionalRisk } from '../data/analytics/institutionalRisk.mjs';
import { buildSeries } from './helpers/fixtures.mjs';

describe('institutionalRisk.sectorRiskTags', () => {
  it('matches a known sector pattern', () => {
    // Note: a matched rule's own `pattern` regex rides along in the spread
    // (SECTOR_RISK_RULES entries carry `pattern` alongside the score fields),
    // so this checks the score fields individually rather than the whole
    // object shape.
    const result = sectorRiskTags('Banking');
    assert.equal(result.regulatory, 80);
    assert.equal(result.commodity, 10);
    assert.equal(result.competitive, 55);
    assert.equal(result.techDisruption, 45);
    assert.equal(result.matched, true);
  });
  it('falls back to the disclosed generic baseline for an unmatched sector, flagged matched:false', () => {
    assert.deepEqual(sectorRiskTags('Widgets & Gadgets'), { regulatory: 40, commodity: 30, competitive: 45, techDisruption: 35, matched: false });
  });
  it('returns null for no sector', () => {
    assert.equal(sectorRiskTags(null), null);
    assert.equal(sectorRiskTags(undefined), null);
  });
});

describe('institutionalRisk.institutionalRisk — fully-resolved inputs', () => {
  // Hand-computed against the module's own documented formulas.
  const bs = buildSeries(['FY21', 'FY22', 'FY23', 'FY24'], { borrowings: [400, 420, 450, 500] });
  const ratios = buildSeries(['FY21', 'FY22', 'FY23', 'FY24'], { rocePct: [15, 14, 13, 16] });
  const result = institutionalRisk({
    interestCoverage: 5,
    fundamentals: { annual: { balanceSheet: bs, ratios } },
    betaValue: 1.3, volatilityPct: 25, maxDrawdownPct: -30, peHistoricalPercentile: 60,
    promoterHoldingTrend: -2,
    sector: 'Information Technology',
    priceTrend: 'Uptrend',
    cashConversionCycle: 45,
    marginStabilityValue: 6
  });

  it('computes each category score exactly per the documented blend', () => {
    // financial: debtServiceRisk=round(avg([40, 62.5]))=51; liquidityRisk=round(clamp(50+45/3))=65 -> round(avg(51,65))=58
    assert.equal(result.categories.financial, 58);
    // business: marginRisk=round(clamp(6*4,5,90))=24
    assert.equal(result.categories.business, 24);
    // market: betaRisk=79, volatilityRisk=38, drawdownRisk=60, valuationCompressionRisk=60 -> round(avg)=59
    assert.equal(result.categories.market, 59);
    // sector (IT): round(avg([35,10,70,80]))=49
    assert.equal(result.categories.sector, 49);
    // governance: promoterChangeRisk=66, capitalAllocationRisk=52 -> round(avg)=59
    assert.equal(result.categories.governance, 59);
  });

  it('renormalizes the composite over all 5 resolved categories', () => {
    assert.equal(result.compositeRiskScore, Math.round((58 + 24 + 59 + 49 + 59) / 5));
  });

  it('reads Stable when the debt/margin/price signals net out to zero', () => {
    assert.equal(result.riskTrend, 'Stable');
  });

  it('surfaces the matched sector tag', () => {
    assert.equal(result.sector.matched, true);
  });
});

describe('institutionalRisk.institutionalRisk — partial inputs renormalize instead of defaulting to neutral', () => {
  const result = institutionalRisk({ interestCoverage: 8, fundamentals: {}, sector: 'Pharmaceuticals' });

  it('excludes every unresolved category from the composite rather than scoring it neutral', () => {
    assert.equal(result.categories.financial, 10); // clamp(90-8*10,5,95)=10, no debt trend data
    assert.equal(result.categories.business, null);
    assert.equal(result.categories.market, null);
    assert.equal(result.categories.sector, 50); // pharma tags avg([75,30,55,40])=50
    assert.equal(result.categories.governance, null);
    assert.equal(result.compositeRiskScore, Math.round((10 + 50) / 2));
  });

  it('reads N/A when there is no directional signal at all', () => {
    assert.equal(result.riskTrend, 'N/A');
  });
});

describe('institutionalRisk.institutionalRisk — riskTrend direction', () => {
  it('reads Deteriorating when debt is rising fast and price is trending down', () => {
    const bs = buildSeries(['FY21', 'FY22', 'FY23', 'FY24'], { borrowings: [100, 100, 100, 150] });
    const result = institutionalRisk({ fundamentals: { annual: { balanceSheet: bs } }, priceTrend: 'Downtrend' });
    assert.equal(result.riskTrend, 'Deteriorating');
  });
  it('reads Improving when debt is falling fast and price is trending up', () => {
    const bs = buildSeries(['FY21', 'FY22', 'FY23', 'FY24'], { borrowings: [150, 150, 150, 100] });
    const result = institutionalRisk({ fundamentals: { annual: { balanceSheet: bs } }, priceTrend: 'Uptrend' });
    assert.equal(result.riskTrend, 'Improving');
  });
});

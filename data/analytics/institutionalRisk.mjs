import { number, clamp, average } from '../util.mjs';
import { latest, valueYearsAgo, timeSeries } from './series.mjs';

// Static, disclosed keyword-matched sector -> qualitative risk-tag lookup.
// This app has no live regulatory/commodity data feed (see
// metricRegistry.mjs's `sectorRisk` entry) -- these are analyst-style
// judgment calls this project maintains, not derived from a data source.
// Unmatched sectors fall back to a generic moderate baseline, flagged via
// `matched:false` so the UI can show it's not sector-specific.
const SECTOR_RISK_RULES = [
  { pattern: /bank|financ|nbfc|insur/i, regulatory: 80, commodity: 10, competitive: 55, techDisruption: 45 },
  { pattern: /oil|gas|petro/i, regulatory: 65, commodity: 90, competitive: 50, techDisruption: 35 },
  { pattern: /metal|mining|steel|cement/i, regulatory: 55, commodity: 85, competitive: 55, techDisruption: 25 },
  { pattern: /sugar|agri|fmcg|food/i, regulatory: 50, commodity: 70, competitive: 55, techDisruption: 20 },
  { pattern: /\bit\b|tech|software|internet/i, regulatory: 35, commodity: 10, competitive: 70, techDisruption: 80 },
  { pattern: /pharma|health/i, regulatory: 75, commodity: 30, competitive: 55, techDisruption: 40 },
  { pattern: /power|utilit|energy/i, regulatory: 70, commodity: 55, competitive: 35, techDisruption: 40 },
  { pattern: /telecom/i, regulatory: 70, commodity: 15, competitive: 65, techDisruption: 60 },
  { pattern: /auto/i, regulatory: 45, commodity: 50, competitive: 65, techDisruption: 55 },
  { pattern: /defence|defense|aerospace/i, regulatory: 65, commodity: 40, competitive: 40, techDisruption: 35 },
  { pattern: /real estate|realty|construction|infra/i, regulatory: 60, commodity: 55, competitive: 50, techDisruption: 20 }
];
const DEFAULT_SECTOR_RISK = { regulatory: 40, commodity: 30, competitive: 45, techDisruption: 35 };
export function sectorRiskTags(sector) {
  if (!sector) return null;
  const rule = SECTOR_RISK_RULES.find(r => r.pattern.test(sector));
  return { ...(rule || DEFAULT_SECTOR_RISK), matched: !!rule };
}

function financialRisk({ interestCoverage, bs }) {
  const scores = [];
  if (Number.isFinite(interestCoverage)) scores.push(clamp(90 - interestCoverage * 10, 5, 95));
  const borrowingsNow = latest(bs, 'borrowings'), borrowings3y = valueYearsAgo(bs, 'borrowings', 3);
  const debtTrendPct = borrowings3y > 0 && borrowingsNow != null ? ((borrowingsNow - borrowings3y) / borrowings3y) * 100 : null;
  if (debtTrendPct != null) scores.push(clamp(50 + debtTrendPct * 0.5, 5, 95));
  const debtServiceRisk = scores.length ? Math.round(average(scores)) : null;
  const refinancingRisk = debtTrendPct != null && Number.isFinite(interestCoverage) ? Math.round(clamp(50 + debtTrendPct * 0.3 + (5 - interestCoverage) * 6, 5, 95)) : debtServiceRisk;
  return { interestCoverage: Number.isFinite(interestCoverage) ? number(interestCoverage) : null, debtServiceRisk, refinancingRisk, debtTrendPct: debtTrendPct != null ? number(debtTrendPct) : null };
}

function businessRisk(marginStabilityValue) {
  const marginRisk = Number.isFinite(marginStabilityValue) ? Math.round(clamp(marginStabilityValue * 4, 5, 90)) : null;
  return { marginRisk, revenueConcentration: null, customerConcentration: null, executionRisk: null };
}

function marketRisk({ betaValue, volatilityPct, maxDrawdownPct, peHistoricalPercentile }) {
  const betaRisk = Number.isFinite(betaValue) ? Math.round(clamp(20 + betaValue * 45, 5, 95)) : null;
  const volatilityRisk = Number.isFinite(volatilityPct) ? Math.round(clamp(volatilityPct * 1.5, 5, 95)) : null;
  const drawdownRisk = Number.isFinite(maxDrawdownPct) ? Math.round(clamp(Math.abs(maxDrawdownPct) * 2, 5, 95)) : null;
  const valuationCompressionRisk = Number.isFinite(peHistoricalPercentile) ? Math.round(peHistoricalPercentile) : null;
  return { betaRisk, volatilityRisk, drawdownRisk, valuationCompressionRisk, beta: betaValue != null ? number(betaValue) : null, volatilityPct: volatilityPct != null ? number(volatilityPct) : null, maxDrawdownPct: maxDrawdownPct != null ? number(maxDrawdownPct) : null };
}

function governanceRisk({ promoterHoldingTrend, ratios, bs }) {
  const promoterChangeRisk = Number.isFinite(promoterHoldingTrend) ? Math.round(clamp(50 - promoterHoldingTrend * 8, 5, 95)) : null;
  const roceNow = latest(ratios, 'rocePct'), roceSeries = timeSeries(ratios, 'rocePct');
  const roce3yAgoEntry = roceSeries[roceSeries.length - 4];
  const roceTrend = roceNow != null && roce3yAgoEntry ? roceNow - roce3yAgoEntry[1] : null;
  const borrowingsNow = latest(bs, 'borrowings'), borrowings3y = valueYearsAgo(bs, 'borrowings', 3);
  const debtTrendPct = borrowings3y > 0 && borrowingsNow != null ? ((borrowingsNow - borrowings3y) / borrowings3y) * 100 : null;
  const capitalAllocationInputs = [roceTrend != null ? clamp(50 - roceTrend * 3, 5, 95) : null, debtTrendPct != null ? clamp(50 + debtTrendPct * 0.3, 5, 95) : null].filter(Number.isFinite);
  const capitalAllocationRisk = capitalAllocationInputs.length ? Math.round(average(capitalAllocationInputs)) : null;
  return { promoterChangeRisk, pledge: null, capitalAllocationRisk, relatedPartyExposure: null };
}

// Directional heuristic read, not a stored historical score time series
// (this app persists no such history -- see metricRegistry.mjs's
// `riskTrend` entry). Blends already-computed real trend inputs.
function riskTrendLabel({ debtTrendPct, marginStabilityValue, priceTrend }) {
  const signals = [];
  if (debtTrendPct != null) signals.push(debtTrendPct > 5 ? 1 : debtTrendPct < -5 ? -1 : 0);
  if (Number.isFinite(marginStabilityValue)) signals.push(marginStabilityValue > 8 ? 1 : 0);
  if (priceTrend === 'Downtrend') signals.push(1); else if (priceTrend === 'Uptrend') signals.push(-1);
  if (!signals.length) return 'N/A';
  const sum = signals.reduce((a, b) => a + b, 0);
  return sum > 0 ? 'Deteriorating' : sum < 0 ? 'Improving' : 'Stable';
}

// Full 5-category institutional risk read for one stock. Everything null-
// guarded and renormalized over only the sub-scores that resolve -- same
// "never default a missing input to neutral" rule as the main scoring
// engine (data/scoring/scoringEngine.mjs).
export function institutionalRisk({ interestCoverage, fundamentals, betaValue, volatilityPct, maxDrawdownPct, peHistoricalPercentile, promoterHoldingTrend, sector, priceTrend, cashConversionCycle, marginStabilityValue }) {
  const bs = fundamentals?.annual?.balanceSheet, ratios = fundamentals?.annual?.ratios;

  const financial = financialRisk({ interestCoverage, bs });
  const liquidityRisk = Number.isFinite(cashConversionCycle) ? Math.round(clamp(50 + cashConversionCycle / 3, 5, 95)) : null;
  const business = businessRisk(marginStabilityValue);
  const market = marketRisk({ betaValue, volatilityPct, maxDrawdownPct, peHistoricalPercentile });
  const sectorTags = sectorRiskTags(sector);
  const governance = governanceRisk({ promoterHoldingTrend, ratios, bs });

  const financialCategoryScore = [financial.debtServiceRisk, liquidityRisk].filter(Number.isFinite).length
    ? Math.round(average([financial.debtServiceRisk, liquidityRisk].filter(Number.isFinite))) : null;
  const businessCategoryScore = business.marginRisk;
  const marketCategoryScore = [market.betaRisk, market.volatilityRisk, market.drawdownRisk, market.valuationCompressionRisk].filter(Number.isFinite).length
    ? Math.round(average([market.betaRisk, market.volatilityRisk, market.drawdownRisk, market.valuationCompressionRisk].filter(Number.isFinite))) : null;
  const sectorCategoryScore = sectorTags ? Math.round(average([sectorTags.regulatory, sectorTags.commodity, sectorTags.competitive, sectorTags.techDisruption])) : null;
  const governanceCategoryScore = [governance.promoterChangeRisk, governance.capitalAllocationRisk].filter(Number.isFinite).length
    ? Math.round(average([governance.promoterChangeRisk, governance.capitalAllocationRisk].filter(Number.isFinite))) : null;

  const categories = { financial: financialCategoryScore, business: businessCategoryScore, market: marketCategoryScore, sector: sectorCategoryScore, governance: governanceCategoryScore };
  const available = Object.values(categories).filter(Number.isFinite);
  const compositeRiskScore = available.length ? Math.round(average(available)) : null;

  return {
    categories, compositeRiskScore,
    financial: { ...financial, liquidityRisk },
    business, market, sector: sectorTags, governance,
    riskTrend: riskTrendLabel({ debtTrendPct: financial.debtTrendPct, marginStabilityValue, priceTrend })
  };
}

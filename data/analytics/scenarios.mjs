import { number, clamp, average } from '../util.mjs';

// Static, disclosed keyword-matched sector -> illustrative currency-exposure
// direction/magnitude lookup (same style/location as institutionalRisk.mjs's
// SECTOR_RISK_RULES). Positive = benefits from rupee depreciation (export-
// heavy, USD-denominated revenue); negative = hurt by it (import-heavy input
// costs, or FX-linked external funding/asset quality); unmatched sectors
// default to a neutral 0 (assumed predominantly domestic-facing), flagged via
// `matched:false`. Not a real FX-hedging position or revenue-mix disclosure
// -- this app has no such data source.
const CURRENCY_EXPOSURE_RULES = [
  { pattern: /\bit\b|tech|software|pharma|health/i, exposure: 0.6 },
  { pattern: /oil|gas|petro|metal|mining|steel|chemical|aviation|airline/i, exposure: -0.7 },
  { pattern: /auto/i, exposure: -0.3 },
  { pattern: /bank|financ|nbfc|insur/i, exposure: -0.2 }
];
export function currencyExposure(sector) {
  if (!sector) return { exposure: 0, matched: false };
  const rule = CURRENCY_EXPOSURE_RULES.find(r => r.pattern.test(sector));
  return { exposure: rule ? rule.exposure : 0, matched: !!rule };
}

// Illustrative stress-test, not a factor model or historical backtest (see
// metricRegistry.mjs's `scenarioImpact` entry). Each scenario is a disclosed
// multiplier applied to a stock's real, already-computed characteristics
// (leverage, interest coverage, beta, historical max drawdown, sector-risk/
// currency tags, P/E percentile, earnings-quality/business-risk scores) --
// there is no live macro/factor-model data source in this app, so this never
// claims to be one.
const SCENARIOS = [
  {
    key: 'interestRateShock', label: 'Interest-rate shock', description: 'Illustrative +150bps rate shock, weighted toward highly-levered names with thin interest coverage',
    impactPct: (s) => {
      const leverageImpact = clamp((s.debtToEquity ?? 40) / 10, 1, 15);
      const coverageAdj = Number.isFinite(s.interestCoverage) ? clamp((5 - s.interestCoverage) * 0.6, -3, 6) : 0;
      return -clamp(leverageImpact + coverageAdj, 1, 18);
    }
  },
  {
    key: 'sectorRotation', label: 'Sector rotation', description: 'Illustrative rotation away from richly-valued names, toward cheaper ones',
    impactPct: (s) => Number.isFinite(s.peHistoricalPercentile) ? -(s.peHistoricalPercentile - 50) / 2.5 : -2
  },
  {
    key: 'earningsRecession', label: 'Earnings recession', description: 'Illustrative broad earnings contraction, weighted toward higher business risk and weaker earnings quality',
    impactPct: (s) => {
      const businessImpact = ((s.businessRiskScore ?? 45) / 100) * 16;
      const qualityAdj = Number.isFinite(s.earningsQualityScore) ? clamp((60 - s.earningsQualityScore) * 0.15, -4, 8) : 0;
      return -clamp(businessImpact + qualityAdj, 2, 28);
    }
  },
  {
    key: 'marketDrawdown', label: 'Market drawdown', description: 'Illustrative -20% broad market move, scaled by beta and each stock\'s own historical drawdown severity',
    impactPct: (s) => {
      const betaImpact = (Number.isFinite(s.beta) ? s.beta : 1) * -20;
      const historicalSeverity = Number.isFinite(s.maxDrawdownPct) ? clamp(Math.abs(s.maxDrawdownPct) / 30, 0.7, 1.6) : 1;
      return clamp(betaImpact * historicalSeverity, -60, 5);
    }
  },
  {
    key: 'currencyShock', label: 'Currency shock', description: 'Illustrative rupee depreciation shock; direction/magnitude from a static sector-keyword currency-exposure heuristic',
    impactPct: (s) => (s.sectorCurrencyExposure ?? 0) * 15
  }
];

// `stockInputs` = [{ symbol, name, weight, debtToEquity, interestCoverage,
// beta, maxDrawdownPct, peHistoricalPercentile, businessRiskScore,
// earningsQualityScore, sectorCurrencyExposure }]
export function scenarioAnalysis(stockInputs) {
  const total = stockInputs.reduce((sum, s) => sum + (s.weight || 0), 0) || 1;
  return SCENARIOS.map(scenario => {
    const perStock = stockInputs.map(s => ({ symbol: s.symbol, name: s.name, impactPct: number(scenario.impactPct(s)) }));
    const portfolioImpactPct = number(perStock.reduce((sum, s, i) => sum + s.impactPct * (stockInputs[i].weight || 0) / total, 0));
    const riskContribution = perStock.map((s, i) => ({ symbol: s.symbol, name: s.name, contributionPct: number(Math.abs(s.impactPct) * (stockInputs[i].weight || 0) / total) })).sort((a, b) => b.contributionPct - a.contributionPct).slice(0, 5);
    const avgMagnitude = average(perStock.map(s => Math.abs(s.impactPct)));
    const recoverySensitivity = avgMagnitude == null ? 'N/A' : avgMagnitude > 15 ? 'Slow recovery expected' : avgMagnitude > 8 ? 'Moderate recovery expected' : 'Fast recovery expected';
    return { key: scenario.key, label: scenario.label, description: scenario.description, portfolioImpactPct, perStock, riskContribution, recoverySensitivity };
  });
}

import { average } from '../util.mjs';

// -- Research Quality Gates + Confidence as a first-class output -----------
// (foundation upgrade, §13 + §18). Pure composition over fields already
// computed elsewhere in the per-stock pass (data/watchlist/research.mjs) --
// no new fetch, no recomputation of any underlying figure. Attached once per
// resolved stock as `stock.researchQuality`.
//
// `peers`/`segments` are permanently `false` in every fundamentals bundle
// this app produces (data/providers/screenerProvider.mjs) -- they represent
// a capability gap in the data source, not missing data for this specific
// company, so they're excluded from the completeness read below (including
// them would cap every India company at 75% "Partial" forever, which isn't a
// meaningful signal).
const REAL_COMPLETENESS_KEYS = ['profitLoss', 'balanceSheet', 'cashFlow', 'ratios', 'quarterly', 'shareholding'];

function completenessLabel(pct) {
  if (pct == null) return 'N/A';
  return pct >= 80 ? 'Complete' : pct >= 40 ? 'Partial' : 'Poor';
}

export function researchQuality(stock) {
  const fundamentalsCompleteness = stock.fundamentals?.dataCompleteness || {};
  const completenessValues = REAL_COMPLETENESS_KEYS.map(key => fundamentalsCompleteness[key]).filter(v => typeof v === 'boolean');
  const dataCompletenessPct = completenessValues.length ? Math.round((completenessValues.filter(Boolean).length / completenessValues.length) * 100) : null;

  const valuationResolved = !!(stock.dcf?.available || stock.financialValuation?.available);
  const valuationCompleteness = valuationResolved ? 'Complete' : (stock.valuation?.fairValue != null ? 'Partial' : 'Unavailable');

  const peerCompleteness = stock.relativeValuation?.peerCompleteness ?? 'Unavailable';

  // No forward-estimate model exists in this app yet (see
  // data/analytics/forwardFramework.mjs) -- an honest fixed disclosure, not
  // an invented confidence read.
  const forecastConfidence = 'Not applicable — forward estimates not yet implemented (see docs/governance/roadmap.md domain 03, item 03.13)';

  const bucketsResolved = Object.values(stock.recommendation?.components || {}).filter(b => b.score != null).length;
  const evidenceScoreParts = [
    (bucketsResolved / 5) * 100,
    valuationResolved ? 100 : (stock.valuation?.fairValue != null ? 50 : 0),
    dataCompletenessPct
  ].filter(Number.isFinite);
  const evidenceScore = evidenceScoreParts.length ? average(evidenceScoreParts) : null;
  const evidenceQuality = evidenceScore == null ? 'N/A' : evidenceScore >= 70 ? 'High' : evidenceScore >= 45 ? 'Medium' : 'Low';

  return {
    dataCompleteness: completenessLabel(dataCompletenessPct), dataCompletenessPct,
    valuationCompleteness, peerCompleteness, forecastConfidence, evidenceQuality,
    methodology: 'Composite research-quality gate over already-computed signals: fundamentals field completeness (profit & loss / balance sheet / cash flow / ratios / quarterly / shareholding), whether a real intrinsic-value model (DCF or the financial-sector substitute) resolved vs. only the P/E-P/B reversion heuristic, sector-peer availability (relativeValuation.mjs), and the share of the unified recommendation engine\'s 5 buckets that resolved. Forecast confidence is a fixed disclosure, not a computed read, until a real forward-estimate model exists.'
  };
}

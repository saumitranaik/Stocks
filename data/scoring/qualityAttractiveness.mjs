import { COMPANY_QUALITY_FACTOR_KEYS, STOCK_ATTRACTIVENESS_FACTOR_KEYS } from './factors.mjs';

// -- Company Quality vs. Stock Attractiveness (foundation upgrade) ----------
// Pure composition over the already-computed factor list (data/scoring/
// factors.mjs) -- no recomputation of any underlying figure. This is the
// task-brief's core "is this a good business" (Company Quality) vs. "is this
// stock a good buy right now" (Stock Attractiveness) separation: both are
// additive outputs alongside the existing unified `rating`/`compositeScore`,
// which this module never touches. Renormalizes over whichever factors in
// each group actually resolved, same convention as every weighted-average in
// this codebase (a missing factor is excluded, never defaulted to neutral).
function weightedAverage(items) {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (!totalWeight) return null;
  return items.reduce((s, i) => s + i.score * i.weight, 0) / totalWeight;
}

function bandFor(score) {
  if (score == null) return 'N/A';
  if (score >= 75) return 'Strong';
  if (score >= 60) return 'Above average';
  if (score >= 40) return 'Average';
  if (score >= 25) return 'Below average';
  return 'Weak';
}

function scoreFor(factors, keys) {
  const items = factors.filter(f => keys.includes(f.key) && f.value != null).map(f => ({ score: f.value, weight: f.weight }));
  const totalFactorCount = keys.length;
  if (!items.length) return { score: null, label: 'N/A', resolvedFactorCount: 0, totalFactorCount };
  const score = Math.round(weightedAverage(items));
  return { score, label: bandFor(score), resolvedFactorCount: items.length, totalFactorCount };
}

// `factors` is the array `data/scoring/factors.mjs`'s `computeFactors()`
// already returns (before scoringEngine.mjs converts it to a keyed object) --
// both scores are computed once, in scoringEngine.mjs's pass-1 buildRecommendation(),
// and carried through pass 2 unchanged (the underlying factors don't change
// between passes, only the Relative-positioning bucket resolves later).
export function companyQualityScore(factors) {
  return {
    ...scoreFor(factors, COMPANY_QUALITY_FACTOR_KEYS),
    methodology: 'Weighted average of the business/financial/profitability/growth/cash-flow/balance-sheet/management/industry-position factors (data/scoring/factors.mjs), renormalized over whichever resolve -- measures the underlying business, independent of today\'s stock price.'
  };
}

export function stockAttractivenessScore(factors) {
  return {
    ...scoreFor(factors, STOCK_ATTRACTIVENESS_FACTOR_KEYS),
    methodology: 'Weighted average of the valuation/risk-profile/technical-trend/momentum-volume factors (data/scoring/factors.mjs), renormalized over whichever resolve -- measures whether the current price/market setup is attractive, independent of underlying business quality.'
  };
}

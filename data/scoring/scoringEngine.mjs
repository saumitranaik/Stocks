import { number, clamp, average } from '../util.mjs';
import { computeFactors } from './factors.mjs';
import { ratingFor, capRatingAtMost, BUY_SIDE_TIERS, INSUFFICIENT_DATA } from './ratings.mjs';

// -- Unified institutional recommendation engine -----------------------------
// Replaces the Phase 1 rating engine (a flat 12-factor weighted average) with
// a 5-bucket composite that folds in every Phase 2 analytical signal --
// institutional risk, DCF/financial-sector valuation, the technical
// scorecard and sector-relative positioning -- so one engine, computed once
// per stock, drives every Buy/Hold/Sell tag in the app (Dashboard, Valuation,
// Portfolio, Risk, Top Opportunities, every comparison table). No other
// module computes a competing rating.
//
// Bucket weights (renormalized over only the buckets that resolve -- a
// missing bucket is never defaulted to a neutral 50, same house rule as the
// old per-factor model):
//   Quality (35%)              -- business quality, financial strength,
//                                  profitability, growth, cash-flow quality,
//                                  balance sheet (factors.mjs)
//   Valuation (25%)             -- P/E/P/B/yield/PEG vs. sector, blended with
//                                  margin-of-safety from the sector-appropriate
//                                  valuation model (DCF or, for financial
//                                  institutions, the justified-P/B model --
//                                  see financialValuation.mjs)
//   Technical (15%)             -- technical scorecard's trend/momentum/
//                                  breakout scores (technicalScorecard.mjs)
//   Risk (15%, inverted)        -- 100 - institutional composite risk score
//                                  (institutionalRisk.mjs), so higher risk
//                                  pulls the composite down
//   Relative positioning (10%)  -- relative-valuation score vs. sector peers
//                                  within this watchlist (relativeValuation.mjs)
const COMPLETENESS_FLOOR_PCT = 40;
const RISK_ELEVATED_THRESHOLD = 65; // same threshold research.mjs uses for the watchlist-level "Elevated" risk status
const MATERIAL_OVERVALUATION_PCT = -20; // price >20% above the modeled fair value

const BUCKET_WEIGHTS = { quality: 35, valuation: 25, technical: 15, risk: 15, relativePositioning: 10 };
const QUALITY_FACTOR_KEYS = ['businessQuality', 'financialStrength', 'profitability', 'growth', 'cashFlowQuality', 'balanceSheet'];

function weightedAverage(items) {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (!totalWeight) return null;
  return items.reduce((s, i) => s + i.score * i.weight, 0) / totalWeight;
}

// Margin-of-safety (fair value vs. current price, %) -> a 0-100 valuation
// score centered on 50 (fairly valued). Same linear-scaling style as the
// existing per-factor heuristics in factors.mjs, not a statistical model.
function marginOfSafetyScore(marginPct) {
  return Number.isFinite(marginPct) ? clamp(50 + marginPct * 1.2, 0, 100) : null;
}

// Builds the 5 top-level buckets from already-computed sub-scores -- pure
// aggregation, no I/O. Called twice per stock: once during the per-stock
// pass (relativeValuationScore not yet resolved), once more after the
// watchlist-wide relative-valuation pass completes (see finalizeRecommendation
// below) -- neither call recomputes factors, DCF or institutional risk.
export function buildComponents({ factors, valuationMarginPct, technicalScores, institutionalRiskScore, relativeValuationScore }) {
  const qualityFactors = factors.filter(f => QUALITY_FACTOR_KEYS.includes(f.key) && f.value != null).map(f => ({ score: f.value, weight: f.weight }));
  const qualityScore = qualityFactors.length ? weightedAverage(qualityFactors) : null;

  const valuationFactor = factors.find(f => f.key === 'valuation');
  const msScore = marginOfSafetyScore(valuationMarginPct);
  const valuationParts = [valuationFactor?.value, msScore].filter(Number.isFinite);
  const valuationScore = valuationParts.length ? average(valuationParts) : null;

  const t = technicalScores || {};
  // Volatility is excluded here (magnitude, not a directional bullish/bearish
  // read) -- same treatment technicalScorecard.mjs already gives it when
  // building trendStrengthScore/momentumScore.
  const technicalParts = [t.trendStrengthScore, t.momentumScore, t.breakoutProbability].filter(Number.isFinite);
  const technicalScoreValue = technicalParts.length ? average(technicalParts) : null;

  const riskScore = Number.isFinite(institutionalRiskScore) ? 100 - institutionalRiskScore : null;

  return {
    quality: { label: 'Quality', weight: BUCKET_WEIGHTS.quality, score: qualityScore != null ? Math.round(qualityScore) : null },
    valuation: { label: 'Valuation', weight: BUCKET_WEIGHTS.valuation, score: valuationScore != null ? Math.round(valuationScore) : null, marginOfSafetyPct: Number.isFinite(valuationMarginPct) ? number(valuationMarginPct) : null },
    technical: { label: 'Technical', weight: BUCKET_WEIGHTS.technical, score: technicalScoreValue != null ? Math.round(technicalScoreValue) : null },
    risk: { label: 'Risk', weight: BUCKET_WEIGHTS.risk, score: riskScore != null ? Math.round(riskScore) : null, compositeRiskScore: Number.isFinite(institutionalRiskScore) ? number(institutionalRiskScore) : null },
    relativePositioning: { label: 'Relative positioning', weight: BUCKET_WEIGHTS.relativePositioning, score: Number.isFinite(relativeValuationScore) ? Math.round(relativeValuationScore) : null }
  };
}

const DRIVER_LABELS = {
  quality: { high: 'strong business quality', low: 'weak business quality', mid: 'stable business quality' },
  valuation: { high: 'attractive valuation', low: 'elevated valuation', mid: 'fair value' },
  technical: { high: 'positive technical trend', low: 'weak technical trend', mid: 'neutral technical trend' },
  risk: { high: 'low risk profile', low: 'elevated risk', mid: 'moderate risk' },
  relativePositioning: { high: 'strong relative positioning vs. peers', low: 'weak relative positioning vs. peers', mid: 'in-line relative positioning' }
};
// The bucket furthest from a neutral 50 explains the call best -- used for
// the "Buy (High) -- attractive valuation" style summary shown wherever a
// recommendation badge appears.
function derivePrimaryDriver(components) {
  let best = null;
  for (const [key, bucket] of Object.entries(components)) {
    if (bucket.score == null) continue;
    const deviation = Math.abs(bucket.score - 50);
    if (!best || deviation > best.deviation) best = { key, deviation, score: bucket.score };
  }
  if (!best) return 'Insufficient data';
  const tier = best.score >= 60 ? 'high' : best.score < 40 ? 'low' : 'mid';
  return DRIVER_LABELS[best.key][tier];
}

// Confidence is independent of the composite score itself -- a stock can
// score well on thin data. Blends: data completeness (how much of the
// composite resolved), whether a real intrinsic-value model applies (DCF or
// the financial-sector substitute, vs. only the multiple-based valuation
// factor), how many of the 5 institutional risk categories resolved,
// earnings stability (the business-quality factor, which is itself a
// margin/ROCE stability read), and the sector valuation model's own
// confidence band.
function deriveConfidenceInputs({ businessQualityScore, dcf, financialValuation, institutionalRisk }) {
  return {
    businessQualityScore: businessQualityScore ?? null,
    valuationApplicable: !!(dcf?.available || financialValuation?.available),
    riskCategoriesResolvedFrac: institutionalRisk ? Object.values(institutionalRisk.categories || {}).filter(Number.isFinite).length / 5 : null,
    sectorModelConfidenceBand: dcf?.confidenceBand || financialValuation?.confidenceBand || null
  };
}

// Final composition: weighting, tier, confidence, and the cross-signal
// consistency guards that keep every tab's Buy/Hold/Sell tag internally
// coherent -- a stock cannot show Buy while its own risk bucket is elevated
// or its own valuation bucket is materially overvalued, and Strong Buy
// requires High confidence. Every cap is disclosed via `capNote`, not silent.
function composeRecommendation(components, confidenceInputs) {
  const bucketList = Object.values(components);
  const available = bucketList.filter(b => b.score != null);
  const dataCompletenessPct = number(available.reduce((s, b) => s + b.weight, 0));
  const compositeScore = dataCompletenessPct >= COMPLETENESS_FLOOR_PCT ? Math.round(weightedAverage(available)) : null;

  let rating = ratingFor(compositeScore);
  const notes = [];

  const { businessQualityScore, valuationApplicable, riskCategoriesResolvedFrac, sectorModelConfidenceBand } = confidenceInputs;
  const sectorModelConfidenceScore = { High: 100, Medium: 60, Low: 30 }[sectorModelConfidenceBand] ?? null;
  const confidenceParts = [dataCompletenessPct, valuationApplicable ? 100 : 0, riskCategoriesResolvedFrac != null ? riskCategoriesResolvedFrac * 100 : null, businessQualityScore, sectorModelConfidenceScore].filter(Number.isFinite);
  const confidenceScore = confidenceParts.length ? Math.round(average(confidenceParts)) : null;
  const confidence = confidenceScore == null ? 'Low' : confidenceScore >= 70 ? 'High' : confidenceScore >= 45 ? 'Medium' : 'Low';

  if (rating !== INSUFFICIENT_DATA) {
    const riskElevated = Number.isFinite(components.risk.compositeRiskScore) && components.risk.compositeRiskScore >= RISK_ELEVATED_THRESHOLD;
    const materiallyOvervalued = Number.isFinite(components.valuation.marginOfSafetyPct) && components.valuation.marginOfSafetyPct <= MATERIAL_OVERVALUATION_PCT;
    if (BUY_SIDE_TIERS.includes(rating) && riskElevated) {
      notes.push(`Capped from ${rating} to Hold: composite risk score is elevated (${components.risk.compositeRiskScore}/100).`);
      rating = capRatingAtMost(rating, 'Hold');
    }
    if (BUY_SIDE_TIERS.includes(rating) && materiallyOvervalued) {
      notes.push(`Capped from ${rating} to Hold: price is ${Math.abs(components.valuation.marginOfSafetyPct).toFixed(0)}% above the modeled fair value.`);
      rating = capRatingAtMost(rating, 'Hold');
    }
    if (rating === 'Strong Buy' && confidence !== 'High') {
      notes.push(`Capped from Strong Buy to Buy: confidence is ${confidence}, not High.`);
      rating = capRatingAtMost(rating, 'Buy');
    }
  }

  return {
    rating, compositeScore, confidence, confidenceScore,
    primaryDriver: derivePrimaryDriver(components),
    capNote: notes.join(' ') || null,
    components, technicalScore: components.technical.score, dataCompletenessPct
  };
}

// Pass 1 (per-stock): every bucket except Relative positioning, which needs
// the full watchlist assembled first (relativeValuation.mjs runs as a
// second pass over all stocks). Returns a complete, displayable
// recommendation in its own right -- Relative positioning (10% weight)
// simply isn't in the available-bucket set yet, renormalized over the
// remaining 90%.
export function buildRecommendation({ quote, fundamentals, industryPe, dcf, financialValuation, institutionalRisk, technicalScores, valuationMarginPct }) {
  const factors = computeFactors({ quote, fundamentals, industryPe });
  const components = buildComponents({ factors, valuationMarginPct, technicalScores, institutionalRiskScore: institutionalRisk?.compositeRiskScore, relativeValuationScore: null });
  const businessQualityScore = factors.find(f => f.key === 'businessQuality')?.value ?? null;
  const confidenceInputs = deriveConfidenceInputs({ businessQualityScore, dcf, financialValuation, institutionalRisk });
  const recommendation = composeRecommendation(components, confidenceInputs);
  return { ...recommendation, factors: Object.fromEntries(factors.map(f => [f.key, f])) };
}

// Pass 2 (after the watchlist-wide relative-valuation pass): folds in the
// Relative positioning bucket and recomposes the tier/confidence/consistency
// read from scratch -- cheap (pure aggregation over already-computed
// sub-scores), not a re-fetch or re-derivation of anything. This is the
// recommendation that ships in the API response and every tab renders.
export function finalizeRecommendation({ recommendation, relativeValuationScore, dcf, financialValuation, institutionalRisk }) {
  const components = { ...recommendation.components, relativePositioning: { ...recommendation.components.relativePositioning, score: Number.isFinite(relativeValuationScore) ? Math.round(relativeValuationScore) : null } };
  const businessQualityScore = recommendation.factors?.businessQuality?.value ?? null;
  const confidenceInputs = deriveConfidenceInputs({ businessQualityScore, dcf, financialValuation, institutionalRisk });
  const final = composeRecommendation(components, confidenceInputs);
  return { ...final, factors: recommendation.factors };
}

export { INSUFFICIENT_DATA };

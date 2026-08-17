import { ACTION_SCORE_WEIGHTS, ACTION_SCORE_BANDS, PORTFOLIO_FIT, ACTION_SCORE } from './config.mjs';

const TOTAL_POSSIBLE_WEIGHT = Object.values(ACTION_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
const HOLD_BAND = ACTION_SCORE_BANDS.find(b => b.label === 'Hold') || ACTION_SCORE_BANDS[Math.floor(ACTION_SCORE_BANDS.length / 2)];

// Correlation of this stock with the single largest OTHER holding by
// resolved weight -- read directly off the already-computed correlation
// matrix (data/analytics/correlation.mjs), not recomputed. Returns null when
// the matrix couldn't resolve this symbol (thin price history) or there is
// no other weighted holding to compare against.
function correlationWithLargestHolding(stock, portfolio) {
  const symbols = portfolio?.correlation?.symbols;
  const matrix = portfolio?.correlation?.matrix;
  if (!symbols?.length || !matrix) return null;
  const idx = symbols.indexOf(stock.symbol);
  if (idx < 0) return null;
  const weights = portfolio.weights || {};
  let topSymbol = null, topWeight = -Infinity;
  for (const symbol of symbols) {
    if (symbol === stock.symbol) continue;
    const weight = weights[symbol];
    if (Number.isFinite(weight) && weight > topWeight) { topWeight = weight; topSymbol = symbol; }
  }
  if (!topSymbol) return null;
  const jdx = symbols.indexOf(topSymbol);
  return matrix[idx]?.[jdx] ?? null;
}

// Portfolio Action Score's 6th bucket: does adding to (or holding) this
// position improve or worsen portfolio construction? Purely a composition
// over already-computed portfolio fields (weight drift, sector contribution,
// correlation) -- no new analytics, no I/O. Any of the three inputs may be
// unavailable (e.g. no target weight set, or correlation matrix couldn't
// resolve this symbol); the score renormalizes over whichever resolve, same
// house rule as scoringEngine.mjs's bucket composition.
export function portfolioFitScore(stock, portfolio) {
  if (!portfolio || !stock || stock.unresolved) return null;
  const parts = [];

  const target = stock.targetWeightPct, effective = stock.effectiveWeightPct;
  if (Number.isFinite(target) && Number.isFinite(effective)) {
    const driftPct = effective - target; // positive = overweight vs. target
    if (driftPct <= -PORTFOLIO_FIT.underweightDriftPct) parts.push(75);
    else if (driftPct >= PORTFOLIO_FIT.overweightDriftPct) parts.push(25);
    else parts.push(50);
  }

  const sectorEntry = (portfolio.sectorContribution || []).find(s => s.sector === (stock.sector || 'Unclassified'));
  if (sectorEntry && Number.isFinite(sectorEntry.weightSharePct)) {
    parts.push(sectorEntry.weightSharePct >= 40 ? 25 : 65); // 40 mirrors the same sector-concentration flag used elsewhere (portfolio.mjs / config.mjs's ALERT_THRESHOLDS.portfolio.sectorConcentrationPct)
  }

  const correlationWithTop = correlationWithLargestHolding(stock, portfolio);
  if (Number.isFinite(correlationWithTop)) {
    parts.push(Math.abs(correlationWithTop) >= PORTFOLIO_FIT.highCorrelationThreshold ? 30 : 65);
  }

  if (!parts.length) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

// Portfolio Action Score (0-100): a weighted blend of the recommendation
// engine's own already-computed bucket scores (Quality/Valuation/Technical/
// Risk-inverted/Relative positioning) plus the new Portfolio Fit score above,
// renormalized over whichever buckets resolve -- same convention as
// scoringEngine.mjs's own bucket composition. Maps to a disclosed action band
// via ACTION_SCORE_BANDS.
export function actionScore(stock, fitScore) {
  if (!stock?.recommendation || stock.unresolved) return null;
  const c = stock.recommendation.components || {};
  const buckets = [
    { key: 'quality', score: c.quality?.score, weight: ACTION_SCORE_WEIGHTS.quality },
    { key: 'valuation', score: c.valuation?.score, weight: ACTION_SCORE_WEIGHTS.valuation },
    { key: 'technical', score: c.technical?.score, weight: ACTION_SCORE_WEIGHTS.technical },
    { key: 'risk', score: c.risk?.score, weight: ACTION_SCORE_WEIGHTS.risk },
    { key: 'relativePositioning', score: c.relativePositioning?.score, weight: ACTION_SCORE_WEIGHTS.relativePositioning },
    { key: 'portfolioFit', score: fitScore, weight: ACTION_SCORE_WEIGHTS.portfolioFit }
  ].filter(bucket => Number.isFinite(bucket.score));
  if (!buckets.length) return null;

  const totalWeight = buckets.reduce((sum, bucket) => sum + bucket.weight, 0);
  const score = Math.round(buckets.reduce((sum, bucket) => sum + bucket.score * bucket.weight, 0) / totalWeight);
  const band = ACTION_SCORE_BANDS.find(b => score >= b.min) || ACTION_SCORE_BANDS[ACTION_SCORE_BANDS.length - 1];

  // Stage 3 calibration: when only a minority of the 6 buckets resolved,
  // the score above is 100% renormalized onto whichever did -- a single
  // strong/weak signal (e.g. only Quality resolved) can otherwise produce a
  // confident-looking "Add aggressively"/"Exit" label off one bucket. Cap
  // to Hold below the configured resolved-weight floor, same disclosed-cap
  // convention scoringEngine.mjs already uses for the main recommendation
  // (e.g. Strong Buy requiring High confidence, surfaced via capNote).
  const resolvedShare = totalWeight / TOTAL_POSSIBLE_WEIGHT;
  const capped = resolvedShare < ACTION_SCORE.minResolvedWeightShare;
  const label = capped ? HOLD_BAND.label : band.label;
  const capNote = capped ? `Capped to Hold: only ${buckets.length} of 6 signal buckets resolved (${Math.round(resolvedShare * 100)}% of possible weight) -- too little coverage for a confident Add/Reduce/Exit call.` : null;

  return {
    score, label, capNote,
    components: {
      quality: c.quality?.score ?? null, valuation: c.valuation?.score ?? null,
      technical: c.technical?.score ?? null, risk: c.risk?.score ?? null,
      relativePositioning: c.relativePositioning?.score ?? null, portfolioFit: fitScore ?? null
    }
  };
}

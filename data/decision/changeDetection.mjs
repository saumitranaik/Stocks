import { ALERT_THRESHOLDS } from './config.mjs';

// Pulls the run-over-run comparable fields off an already-built stock object
// (data/watchlist/research.mjs's payload.stocks[i]) -- pure field selection,
// nothing recomputed. This is also the shape persisted per-company in
// data/cache/watchlistSnapshots/<id>.json (see data/watchlist/snapshotCache.mjs
// and this module's `hasAdvanced`).
export function extractSnapshotFields(stock) {
  return {
    fetchedAt: stock.fetchedAt,
    rating: stock.recommendation?.rating ?? null,
    confidence: stock.recommendation?.confidence ?? null,
    fairValue: stock.valuation?.fairValue ?? null,
    targetPrice: stock.valuation?.targetPrice ?? null,
    compositeRiskScore: stock.institutionalRisk?.compositeRiskScore ?? null,
    riskCategories: stock.institutionalRisk?.categories ?? null,
    debtTrendPct: stock.institutionalRisk?.financial?.debtTrendPct ?? null,
    technicalRegime: stock.technicalScorecard?.regime ?? null,
    watchlistRank: stock.relativeValuation?.watchlistRank ?? null,
    sectorRank: stock.relativeValuation?.sectorRank ?? null,
    premiumDiscountScore: stock.relativeValuation?.premiumDiscountScore ?? stock.sectorPremiumDiscountPe ?? null,
    primaryDriver: stock.recommendation?.primaryDriver ?? null,
    priceAboveFifty: Number.isFinite(stock.price) && Number.isFinite(stock.fifty) ? stock.price >= stock.fifty : null,
    priceAboveTwoHundred: Number.isFinite(stock.price) && Number.isFinite(stock.twoHundred) ? stock.price >= stock.twoHundred : null,
    rsiZone: Number.isFinite(stock.rsi) ? (stock.rsi >= 70 ? 'overbought' : stock.rsi <= 30 ? 'oversold' : 'neutral') : null,
    macdSign: Number.isFinite(stock.macd?.histogram) ? Math.sign(stock.macd.histogram) : null,
    relativeStrengthPercentile: stock.relativeStrengthPercentile ?? null
  };
}

// A company's persisted snapshot only advances when its own `fetchedAt` is
// newer than the stored value -- i.e. only on a genuine refetch, never a
// cache-only re-render. This is what makes "since last refresh" mean what it
// says: reloading the page or switching watchlists re-reads the same stored
// diff instead of silently clearing it.
export function hasAdvanced(previous, stock) {
  if (!stock?.fetchedAt) return false;
  if (!previous?.fetchedAt) return true;
  return new Date(stock.fetchedAt).getTime() > new Date(previous.fetchedAt).getTime();
}

// Field-level diff between a stored snapshot entry and the live stock object.
// `previous` is null on the very first run for a company (or a watchlist
// with no snapshot file yet) -- reported as a baseline, not a change (there
// is nothing to compare against yet). Every comparison is null-guarded on
// both sides so a field that just resolved for the first time isn't reported
// as "changed from N/A."
export function diffCompany(previous, stock) {
  const current = extractSnapshotFields(stock);
  if (!previous) return { hasChanges: false, isBaseline: true, changes: [], current };

  const changes = [];
  const push = (field, label, from, to) => changes.push({ field, label, from, to });

  if (previous.rating != null && current.rating != null && previous.rating !== current.rating) push('rating', 'Recommendation', previous.rating, current.rating);
  if (previous.confidence != null && current.confidence != null && previous.confidence !== current.confidence) push('confidence', 'Confidence', previous.confidence, current.confidence);
  if (Number.isFinite(previous.fairValue) && Number.isFinite(current.fairValue) && previous.fairValue !== current.fairValue) push('fairValue', 'Fair value', previous.fairValue, current.fairValue);
  if (Number.isFinite(previous.targetPrice) && Number.isFinite(current.targetPrice) && previous.targetPrice !== current.targetPrice) push('targetPrice', 'Target price', previous.targetPrice, current.targetPrice);
  if (Number.isFinite(previous.compositeRiskScore) && Number.isFinite(current.compositeRiskScore) && previous.compositeRiskScore !== current.compositeRiskScore) push('compositeRiskScore', 'Composite risk score', previous.compositeRiskScore, current.compositeRiskScore);
  if (previous.technicalRegime != null && current.technicalRegime != null && previous.technicalRegime !== current.technicalRegime) push('technicalRegime', 'Technical regime', previous.technicalRegime, current.technicalRegime);
  if (Number.isFinite(previous.watchlistRank) && Number.isFinite(current.watchlistRank) && previous.watchlistRank !== current.watchlistRank) push('watchlistRank', 'Relative valuation rank', previous.watchlistRank, current.watchlistRank);
  if (previous.primaryDriver != null && current.primaryDriver != null && previous.primaryDriver !== current.primaryDriver) push('primaryDriver', 'Primary driver', previous.primaryDriver, current.primaryDriver);

  // Category-level risk detail, leverage and sector premium/discount --
  // gated on a meaningful move (config-driven), not any float wobble.
  const rc = ALERT_THRESHOLDS.risk.categoryIncreaseThreshold;
  for (const category of ['financial', 'business', 'market', 'sector', 'governance']) {
    const from = previous.riskCategories?.[category], to = current.riskCategories?.[category];
    if (Number.isFinite(from) && Number.isFinite(to) && Math.abs(to - from) >= rc) {
      push(`${category}RiskCategory`, `${category[0].toUpperCase()}${category.slice(1)} risk`, from, to);
    }
  }
  if (Number.isFinite(previous.debtTrendPct) && Number.isFinite(current.debtTrendPct) && (current.debtTrendPct - previous.debtTrendPct) >= ALERT_THRESHOLDS.risk.leverageIncreasePctPoints) {
    push('debtTrendPct', 'Debt trend', previous.debtTrendPct, current.debtTrendPct);
  }
  if (Number.isFinite(previous.premiumDiscountScore) && Number.isFinite(current.premiumDiscountScore) && Math.abs(current.premiumDiscountScore - previous.premiumDiscountScore) >= ALERT_THRESHOLDS.valuation.premiumDiscountShiftPts) {
    push('premiumDiscountScore', 'Sector premium/discount', previous.premiumDiscountScore, current.premiumDiscountScore);
  }
  if (Number.isFinite(previous.relativeStrengthPercentile) && Number.isFinite(current.relativeStrengthPercentile) && (current.relativeStrengthPercentile - previous.relativeStrengthPercentile) >= ALERT_THRESHOLDS.technical.relativeStrengthAccelerationPts) {
    push('relativeStrengthPercentile', 'Relative strength percentile', previous.relativeStrengthPercentile, current.relativeStrengthPercentile);
  }

  // Crossing-style technical fields: only reported when the sign/zone
  // actually flips (both sides resolved), driving the DMA-crossover, RSI-
  // extreme-entry and MACD-sign-flip alerts in alerts.mjs.
  if (previous.priceAboveFifty != null && current.priceAboveFifty != null && previous.priceAboveFifty !== current.priceAboveFifty) push('priceAboveFifty', '50-day moving average position', previous.priceAboveFifty, current.priceAboveFifty);
  if (previous.priceAboveTwoHundred != null && current.priceAboveTwoHundred != null && previous.priceAboveTwoHundred !== current.priceAboveTwoHundred) push('priceAboveTwoHundred', '200-day moving average position', previous.priceAboveTwoHundred, current.priceAboveTwoHundred);
  if (previous.rsiZone != null && current.rsiZone != null && previous.rsiZone !== current.rsiZone) push('rsiZone', 'RSI zone', previous.rsiZone, current.rsiZone);
  if (Number.isFinite(previous.macdSign) && Number.isFinite(current.macdSign) && previous.macdSign !== current.macdSign) push('macdSign', 'MACD sign', previous.macdSign, current.macdSign);

  return { hasChanges: changes.length > 0, isBaseline: false, changes, current };
}

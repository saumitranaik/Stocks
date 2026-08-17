// The mandate's 6-tier institutional scale, plus an explicit gated state for
// when the composite score itself isn't computed (see scoringEngine.mjs).
export const INSUFFICIENT_DATA = 'Insufficient data for institutional score';

export function ratingFor(compositeScore) {
  if (compositeScore == null) return INSUFFICIENT_DATA;
  if (compositeScore >= 80) return 'Strong Buy';
  if (compositeScore >= 70) return 'Buy';
  if (compositeScore >= 60) return 'Accumulate';
  if (compositeScore >= 45) return 'Hold';
  if (compositeScore >= 30) return 'Reduce';
  return 'Sell';
}

// Best-to-worst order, used by the unified recommendation engine's
// cross-signal consistency guards (scoringEngine.mjs) to cap a rating down
// without hard-coding tier comparisons in multiple places. Exported so any
// other module needing a single source of truth for rating rank (e.g.
// data/decision/thesisTracking.mjs's upgrade/downgrade detection) reads
// this instead of duplicating the 6-tier scale.
export const TIER_ORDER = ['Strong Buy', 'Buy', 'Accumulate', 'Hold', 'Reduce', 'Sell'];
export const BUY_SIDE_TIERS = ['Strong Buy', 'Buy', 'Accumulate'];

// Returns `rating` unchanged if it's already at or below (worse than or
// equal to) `maxTier`; otherwise returns `maxTier`. No-op for
// INSUFFICIENT_DATA, which isn't on the tier scale.
export function capRatingAtMost(rating, maxTier) {
  if (rating === INSUFFICIENT_DATA) return rating;
  const rank = TIER_ORDER.indexOf(rating), capRank = TIER_ORDER.indexOf(maxTier);
  if (rank === -1 || capRank === -1) return rating;
  return rank < capRank ? maxTier : rating;
}

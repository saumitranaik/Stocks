// Single source of truth for every tunable constant the quantitative
// research domain (data/quant/*.mjs) uses -- same pattern as
// data/decision/config.mjs: no threshold or weight may be hard-coded inside
// factorEngine.mjs or any later data/quant module. Every value below is a
// disclosed, uncalibrated heuristic (same TD-11-class limitation already
// carried by data/decision/config.mjs's own weights, docs/governance/
// roadmap.md) -- a later empirical calibration pass changes only this file,
// never the modules that read it.

// Composite Factor Score: weighting across the 6 institutional factor
// categories, renormalized over whichever categories actually resolve for a
// given stock (same renormalize-over-resolved convention as
// scoringEngine.mjs's recommendation buckets and actionScore.mjs).
export const FACTOR_SCORE_WEIGHTS = {
  value: 20, quality: 20, growth: 15, momentum: 20, risk: 15, size: 10
};

// A stock needs at least this many same-sector peers (including itself) in
// the same watchlist before a factor sub-metric is normalized sector-
// relative; below that, normalization falls back to the full watchlist
// (still watchlist-scoped -- there is no market-wide peer database in this
// app, the same constraint already disclosed on relativeValuation.mjs and
// portfolio.mjs's factorExposure()). Below minWatchlistPeers even at
// watchlist scope, the sub-metric renders "insufficient data" rather than a
// misleadingly precise percentile off a tiny sample.
export const NORMALIZATION = {
  minSectorPeers: 4,
  minWatchlistPeers: 3
};

// Composite Factor Score confidence bands, driven by category coverage (how
// many of the 6 categories resolved at all) and normalization scope --
// mirrors the completeness-gated confidence convention used throughout this
// app (scoringEngine.mjs, actionScore.mjs).
export const FACTOR_CONFIDENCE = {
  highCoveragePct: 80,
  mediumCoveragePct: 50,
  // Below this resolved-category share, the Factor Score itself is withheld
  // (null, with a disclosed capNote) rather than shown at low confidence --
  // mirrors actionScore.mjs's ACTION_SCORE.minResolvedWeightShare.
  minResolvedCategoryShare: 0.5
};

// A category's own normalized score must sit at least this many points from
// neutral (50) to be named as a stock's "strongest positive/negative
// factor" -- avoids naming a near-neutral 51 as a meaningful signal.
export const LEADERSHIP_MIN_DEVIATION = 5;

// Phase 7 Stage 2 -- data/quant/performanceEngine.mjs. Absolute/benchmark-
// relative return periods, computed from the same weekly 5y priceHistory
// series beta/volatility/drawdown already use (yahooQuoteProvider.mjs's
// fetchPriceHistory) -- days is a calendar-day lookback from the latest
// available observation, not a trading-day count. 1Y is deliberately absent
// here: it reuses the existing daily-quote-derived oneYearReturnPct/
// relativeStrengthPct fields already computed elsewhere in this app (see
// performanceEngine.mjs) rather than a second, slightly different weekly-
// series-derived 1Y figure.
export const PERFORMANCE_PERIODS = {
  '1M': { days: 30, label: '1 Month' },
  '3M': { days: 91, label: '3 Months' },
  '6M': { days: 182, label: '6 Months' },
  '3Y': { days: 1095, label: '3 Years' },
  '5Y': { days: 1825, label: '5 Years' }
};

// CAGR is only meaningful over a multi-year window -- computed for these two
// periods only, using each period's actual elapsed time between the located
// start/end observations (not an assumed exact integer year count).
export const CAGR_PERIODS = ['3Y', '5Y'];

// A period/CAGR start observation must land within this many calendar days
// of its exact lookback target (weekly-sampled series, so consecutive points
// are ~7 days apart) or the period renders "insufficient history" rather
// than a stretched approximation -- same tolerance priceSeries.mjs's
// nearestPoint() already defaults to for historical P/E-P/B reconstruction.
export const PERFORMANCE_TOLERANCE_DAYS = 10;

// Downside-deviation threshold for the Sortino-like ratio: 0% (any negative
// weekly return counts as "downside"), not the risk-free rate -- a disclosed
// simplifying choice, consistent with how this app's existing proxy Sharpe
// ratio (portfolio.mjs's riskAdjustedReturnScore) already only subtracts the
// risk-free rate in the numerator, not the volatility denominator.
export const SORTINO_THRESHOLD_PCT = 0;

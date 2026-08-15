import { prepareSeries, correlationFromPrepared } from './priceSeries.mjs';

// Pairwise Pearson correlation of weekly returns across every company in the
// watchlist, from each company's cached priceHistory (see
// yahooQuoteProvider.mjs's fetchPriceHistory / research.mjs). `entries` is
// [{ symbol, name, points }] -- kept separate from the trimmed per-stock
// response objects so the full weekly series (used only for this matrix and
// for beta/volatility/drawdown) doesn't get serialized into every stock.
// Each series is timestamp-tagged and sorted exactly once (prepareSeries),
// and only the upper triangle is computed and then mirrored -- computing
// this naively (re-parsing dates per cell, both (i,j) and (j,i)) was >90% of
// buildResearch's CPU time on a 6-company watchlist before this fix.
export function correlationMatrix(entries) {
  const usable = entries.filter(e => e.points?.length >= 10);
  const symbols = usable.map(e => e.symbol);
  const prepared = usable.map(e => prepareSeries(e.points));
  const matrix = usable.map(() => usable.map(() => null));
  for (let i = 0; i < usable.length; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < usable.length; j++) {
      const r = correlationFromPrepared(prepared[i], prepared[j]);
      matrix[i][j] = r; matrix[j][i] = r;
    }
  }

  const pairs = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const r = matrix[i][j];
      if (Number.isFinite(r)) pairs.push({ a: usable[i].name, b: usable[j].name, correlation: r });
    }
  }
  const highlyCorrelated = pairs.filter(p => Math.abs(p.correlation) > 0.7).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)).slice(0, 8);
  const diversificationOpportunities = [...pairs].sort((a, b) => Math.abs(a.correlation) - Math.abs(b.correlation)).slice(0, 8);

  return { symbols, names: usable.map(e => e.name), matrix, highlyCorrelated, diversificationOpportunities };
}

const RECENT_WINDOW_POINTS = 26; // ~6 months of weekly points

// Rolling correlation: average pairwise correlation over a recent ~6-month
// window vs. the full available history -- reuses the same
// already-`prepareSeries`'d arrays as correlationMatrix() above (sliced for
// the recent window, not re-parsed) to avoid reintroducing the O(n x m)
// date-reparsing regression the Phase 2 correlation-matrix perf fix
// resolved. Correlation stability = 100 - the average absolute per-pair
// difference between the two windows' correlations (scaled to 0-100) -- a
// disclosed heuristic read on "have pairwise relationships materially
// shifted recently," not a statistical significance test.
export function rollingCorrelation(entries) {
  const usable = entries.filter(e => e.points?.length >= 20);
  if (usable.length < 2) return { recentAvgCorrelation: null, longRunAvgCorrelation: null, correlationStabilityScore: null, windowPoints: RECENT_WINDOW_POINTS };
  const prepared = usable.map(e => prepareSeries(e.points));
  const recentPrepared = prepared.map(series => series.slice(-RECENT_WINDOW_POINTS));

  const longRunValues = [], recentValues = [], deltas = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const longR = correlationFromPrepared(prepared[i], prepared[j]);
      const recentR = correlationFromPrepared(recentPrepared[i], recentPrepared[j]);
      if (Number.isFinite(longR)) longRunValues.push(longR);
      if (Number.isFinite(recentR)) recentValues.push(recentR);
      if (Number.isFinite(longR) && Number.isFinite(recentR)) deltas.push(Math.abs(recentR - longR));
    }
  }
  const meanOf = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const longRunAvgCorrelation = meanOf(longRunValues), recentAvgCorrelation = meanOf(recentValues);
  const avgDelta = meanOf(deltas);
  return {
    recentAvgCorrelation: recentAvgCorrelation != null ? Number(recentAvgCorrelation.toFixed(3)) : null,
    longRunAvgCorrelation: longRunAvgCorrelation != null ? Number(longRunAvgCorrelation.toFixed(3)) : null,
    correlationStabilityScore: avgDelta != null ? Math.round(Math.max(0, Math.min(100, 100 - avgDelta * 100))) : null,
    windowPoints: RECENT_WINDOW_POINTS
  };
}

import { number, average } from '../util.mjs';

// Shared helpers over the { points: [{date, close}] } shape returned by
// fetchPriceHistory() (yahooQuoteProvider.mjs) -- the weekly series used by
// beta, correlation, realized volatility, drawdown history and historical
// P/E-P/B percentile reconstruction. Centralized here so those five features
// don't each reimplement date-alignment/return-series math slightly
// differently.

const toMs = (d) => new Date(d).getTime();

// Nearest point to `targetDate` within `toleranceDays` -- used to look up
// "the closing price around this fiscal year-end" for historical multiple
// reconstruction, where an exact FY-end trading day isn't guaranteed to be
// one of the weekly sample dates.
export function nearestPoint(points, targetDate, toleranceDays = 10) {
  if (!points?.length) return null;
  const target = toMs(targetDate);
  let best = null, bestDiff = Infinity;
  for (const point of points) {
    const diff = Math.abs(toMs(point.date) - target);
    if (diff < bestDiff) { bestDiff = diff; best = point; }
  }
  return best && bestDiff <= toleranceDays * 86400000 ? best : null;
}

// Pairs two point series by nearest date within tolerance (weekly series
// from independent fetches don't always land on identical calendar dates).
// Returns [[a.close, b.close], ...] in a's chronological order. Timestamps
// are parsed once per point up front -- repeatedly calling `new Date(...)`
// inside the O(n x m) nearest-match scan below was the dominant cost when
// this ran across every pair in a correlation matrix (profiled: >90% of
// buildResearch's CPU time on a 6-company watchlist).
export function alignSeries(a, b, toleranceDays = 4) {
  if (!a?.length || !b?.length) return [];
  const sortedB = [...b].map(p => ({ ms: toMs(p.date), close: p.close })).sort((x, y) => x.ms - y.ms);
  const toleranceMs = toleranceDays * 86400000;
  const pairs = [];
  for (const pointA of a) {
    const msA = toMs(pointA.date);
    let best = null, bestDiff = Infinity;
    for (const pointB of sortedB) {
      const diff = Math.abs(msA - pointB.ms);
      if (diff < bestDiff) { bestDiff = diff; best = pointB; }
    }
    if (best && bestDiff <= toleranceMs) pairs.push([pointA.close, best.close]);
  }
  return pairs;
}

// Period-over-period % returns from a chronologically-sorted point series.
export function returnsOf(points) {
  if (!points?.length) return [];
  const sorted = [...points].sort((a, b) => toMs(a.date) - toMs(b.date));
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].close, curr = sorted[i].close;
    if (prev > 0) out.push((curr - prev) / prev);
  }
  return out;
}

function pearsonFromPairs(pairs) {
  if (pairs.length < 10) return null;
  const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
  const meanX = average(xs), meanY = average(ys);
  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < xs.length; i++) { cov += (xs[i] - meanX) * (ys[i] - meanY); varX += (xs[i] - meanX) ** 2; varY += (ys[i] - meanY) ** 2; }
  return varX > 0 && varY > 0 ? number(cov / Math.sqrt(varX * varY)) : null;
}
export function pearsonCorrelation(a, b) {
  return pearsonFromPairs(alignSeries(a, b));
}

// Timestamp-tagged, pre-sorted copy of a point series -- computed once per
// symbol before a correlation matrix's O(symbols^2) pairwise loop, instead
// of alignSeries() re-parsing dates and re-sorting the same series on every
// single cell (see correlation.mjs, and the perf note on alignSeries above).
export function prepareSeries(points) {
  return [...(points || [])].map(p => ({ ms: toMs(p.date), close: p.close })).sort((x, y) => x.ms - y.ms);
}
export function correlationFromPrepared(a, b, toleranceDays = 4) {
  if (!a?.length || !b?.length) return null;
  const toleranceMs = toleranceDays * 86400000;
  const pairs = [];
  for (const pointA of a) {
    let best = null, bestDiff = Infinity;
    for (const pointB of b) {
      const diff = Math.abs(pointA.ms - pointB.ms);
      if (diff < bestDiff) { bestDiff = diff; best = pointB; }
    }
    if (best && bestDiff <= toleranceMs) pairs.push([pointA.close, best.close]);
  }
  return pearsonFromPairs(pairs);
}

// Annualized realized volatility from weekly returns (stdev x sqrt(52),
// standard annualization factor for weekly-sampled data).
export function annualizedVolatilityPct(points) {
  const returns = returnsOf(points);
  if (returns.length < 10) return null;
  const mean = average(returns);
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return number(Math.sqrt(variance) * Math.sqrt(52) * 100);
}

// Max peak-to-trough drawdown (%) over the available window -- a real
// calculation over real historical closes, not a simulated stress scenario.
export function maxDrawdownPct(points) {
  if (!points?.length) return null;
  const sorted = [...points].sort((a, b) => toMs(a.date) - toMs(b.date));
  let peak = sorted[0].close, worst = 0;
  for (const point of sorted) {
    peak = Math.max(peak, point.close);
    if (peak > 0) worst = Math.min(worst, (point.close - peak) / peak);
  }
  return number(worst * 100);
}

// Percentile rank (0-100) of `value` within a set of historical values --
// shared by the P/E and P/B historical-percentile reconstruction.
export function percentileRank(value, history) {
  const clean = history.filter(Number.isFinite);
  if (value == null || clean.length < 3) return null;
  const below = clean.filter(v => v <= value).length;
  return number((below / clean.length) * 100, 0);
}

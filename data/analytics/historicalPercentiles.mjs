import { number } from '../util.mjs';
import { nearestPoint, percentileRank } from './priceSeries.mjs';
import { sharesOutstanding } from './shares.mjs';

// Screener period labels are "Mon YYYY" (e.g. "Mar 2015"); "01 " prefix
// gives Date a parseable day-month-year string. Non-fiscal-year labels
// ("TTM") fail to parse and are skipped by the caller.
function parsePeriodDate(period) {
  const date = new Date(`01 ${period}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Reconstructs a per-fiscal-year implied P/E (real reported EPS x the
// nearest available weekly close to that period) and ranks the current P/E
// within it. This is an approximation, not an exact FY-end close -- see
// metricRegistry.mjs's `peHistoricalPercentile` entry, surfaced in the UI.
export function peHistoricalPercentile(pl, priceHistory, currentPe) {
  if (!pl?.periods?.length || !priceHistory?.points?.length || !Number.isFinite(currentPe)) return { percentile: null, history: [] };
  const history = [];
  for (let i = 0; i < pl.periods.length; i++) {
    const eps = pl.rows.epsInRs?.[i];
    const date = parsePeriodDate(pl.periods[i]);
    if (!(eps > 0) || !date) continue;
    const point = nearestPoint(priceHistory.points, date.toISOString());
    if (!point) continue;
    history.push({ period: pl.periods[i], impliedPe: number(point.close / eps) });
  }
  return { percentile: percentileRank(currentPe, history.map(h => h.impliedPe)), history };
}

// Same reconstruction for P/B: book value per share per fiscal year, using
// real reported Equity Capital + Reserves against a *constant* shares-
// outstanding assumption (see shares.mjs) -- disclosed limitation: ignores
// splits/buybacks/dilution across the window.
export function pbHistoricalPercentile(bs, priceHistory, snapshot, currentPb) {
  const shares = sharesOutstanding(bs, snapshot);
  if (!bs?.periods?.length || !priceHistory?.points?.length || !Number.isFinite(currentPb) || !(shares > 0)) return { percentile: null, history: [] };
  const history = [];
  for (let i = 0; i < bs.periods.length; i++) {
    const equityCapital = bs.rows.equityCapital?.[i], reserves = bs.rows.reserves?.[i];
    const date = parsePeriodDate(bs.periods[i]);
    if (!Number.isFinite(equityCapital) || !Number.isFinite(reserves) || !date) continue;
    const bvps = ((equityCapital + reserves) * 1e7) / shares;
    if (!(bvps > 0)) continue;
    const point = nearestPoint(priceHistory.points, date.toISOString());
    if (!point) continue;
    history.push({ period: bs.periods[i], impliedPb: number(point.close / bvps) });
  }
  return { percentile: percentileRank(currentPb, history.map(h => h.impliedPb)), history };
}

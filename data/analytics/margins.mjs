import { number } from '../util.mjs';
import { timeSeries, stdDev } from './series.mjs';

// Real time series, direct from parsed rows — opmPct is a Screener row,
// netMarginPct is computed per-year from real netProfit/sales pairs.
export function marginTrend(pl) {
  if (!pl) return null;
  const opm = timeSeries(pl, 'opmPct');
  const netMargin = pl.periods.map((period, i) => {
    const sales = pl.rows.sales?.[i];
    const netProfit = pl.rows.netProfit?.[i];
    return sales > 0 && Number.isFinite(netProfit) ? [period, number((netProfit / sales) * 100)] : null;
  }).filter(Boolean);
  return { operatingMargin: opm, netMargin };
}

// Population std-dev of OPM% across available years. Explicitly a heuristic
// proxy for margin/pricing-power stability, not a named external formula.
export function marginStability(pl) {
  const opm = timeSeries(pl, 'opmPct').map(([, v]) => v);
  const dev = stdDev(opm);
  return dev == null ? null : number(dev);
}

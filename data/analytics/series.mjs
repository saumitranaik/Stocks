// Shared helpers over the { periods, rows } shape produced by
// screenerHtml.mjs's toPeriodSeries(). Only the profit-loss table carries a
// trailing 'TTM' (partial-year) column; every other statement's periods are
// all full fiscal years already, so "latest full year" only differs from
// "latest period" for that one table.
export function latestFullYearIndex(periods) {
  if (!periods?.length) return -1;
  return periods.length - (periods[periods.length - 1] === 'TTM' ? 2 : 1);
}
export function valueAt(rows, field, index) {
  if (index < 0) return null;
  const value = rows?.[field]?.[index];
  return Number.isFinite(value) ? value : null;
}
export function latest(series, field) {
  if (!series) return null;
  return valueAt(series.rows, field, latestFullYearIndex(series.periods));
}
export function nYearsAgoIndex(periods, years) {
  const latestIdx = latestFullYearIndex(periods);
  const idx = latestIdx - years;
  return idx >= 0 ? idx : -1;
}
export function valueYearsAgo(series, field, years) {
  if (!series) return null;
  return valueAt(series.rows, field, nYearsAgoIndex(series.periods, years));
}
// Every finite [period, value] pair for a field, in chronological order.
export function timeSeries(series, field) {
  if (!series) return [];
  const values = series.rows?.[field] ?? [];
  return series.periods.map((period, i) => [period, values[i]]).filter(([, v]) => Number.isFinite(v));
}
export function stdDev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

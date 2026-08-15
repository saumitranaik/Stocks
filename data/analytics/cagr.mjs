import { number } from '../util.mjs';
import { latest, valueYearsAgo, latestFullYearIndex } from './series.mjs';

// Never fabricates a rate from a negative/zero base or a negative-to-positive
// swing — both begin and end must be strictly positive.
export function cagr(begin, end, years) {
  if (!Number.isFinite(begin) || !Number.isFinite(end) || !(years > 0)) return null;
  if (begin <= 0 || end <= 0) return null;
  return number((Math.pow(end / begin, 1 / years) - 1) * 100);
}

// CAGR of `field` over the trailing `years` full fiscal years in `series`.
export function cagrOverYears(series, field, years) {
  if (!series) return null;
  const end = latest(series, field);
  const begin = valueYearsAgo(series, field, years);
  return cagr(begin, end, years);
}

// CAGR over the longest span the data actually covers (needs >= 2 full-FY
// points); returns { years, value } so callers can label what "longest" means.
export function longestAvailableCagr(series, field) {
  if (!series) return null;
  const span = latestFullYearIndex(series.periods);
  if (span < 1) return null;
  const value = cagrOverYears(series, field, span);
  return value == null ? null : { years: span, value };
}

import { rename, writeFile } from 'node:fs/promises';

// Strips only characters that could break out of an HTML tag/attribute.
// '&' is intentionally allowed through: several standard sector names
// contain it ("Oil & Gas", "Metals & Mining", ...), and values built from
// this are only ever written via textContent in script.js, never innerHTML.
export const clean = (value) => String(value ?? '').replace(/[<>"']/g, '').trim();

// Atomic JSON write (write .tmp, then rename) so a crash mid-write can never
// leave a half-written, unparsable file on disk -- shared by the watchlist
// store and the persistent disk cache, both of which write on every mutation.
export const writeJsonAtomic = async (file, value) => {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, file);
};
export const number = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Presentation-only rounding, keyed to a real confidence-band read (High/
// Medium/Low), so a heuristic figure doesn't display with the same apparent
// precision as a sourced/audited one. Never applied inside a calculation
// chain -- callers pass the already-fully-computed value; this only changes
// how many digits are shown, never how the value was derived. High keeps
// today's 2-decimal behavior unchanged (no regression for the common case).
export const precisionForConfidence = (value, confidenceBand) => {
  if (!Number.isFinite(value)) return null;
  if (confidenceBand === 'Medium') return Math.round(value);
  if (confidenceBand === 'Low') return Math.round(value / 5) * 5;
  return number(value, 2);
};
export const average = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};
export const request = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', accept: 'application/json,text/plain,*/*' } });
  if (!res.ok) throw new Error(`Source returned ${res.status}`);
  return res;
};

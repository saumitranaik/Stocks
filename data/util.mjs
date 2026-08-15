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
export const average = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};
export const request = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', accept: 'application/json,text/plain,*/*' } });
  if (!res.ok) throw new Error(`Source returned ${res.status}`);
  return res;
};

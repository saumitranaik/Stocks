import { latest } from './series.mjs';

// Absolute share count, derived from Equity Capital (Cr) / Face Value --
// Screener exposes neither a direct shares-outstanding figure nor a
// per-period count, so this is a real arithmetic derivation (Equity Capital
// = shares x Face Value), not sourced directly. Used wherever a per-share
// figure needs to be reconstructed for a historical period (book value per
// share, DCF fair value per share): assumes the share count implied by the
// *latest* balance sheet held constant across history -- a disclosed
// simplification that ignores splits, buybacks, rights issues and dilution.
export function sharesOutstanding(bs, snapshot) {
  const equityCapitalCr = latest(bs, 'equityCapital');
  const faceValue = snapshot?.faceValue;
  if (!(equityCapitalCr > 0) || !(faceValue > 0)) return null;
  return (equityCapitalCr * 1e7) / faceValue;
}

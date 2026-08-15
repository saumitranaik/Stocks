import { number } from '../util.mjs';
import { latest } from './series.mjs';

// Fixed Assets / Sales for the latest FY. No capex figure is derived here —
// Screener has no explicit capex line, and approximating it from "Cash from
// Investing Activity" would conflate capex with other investing flows, so
// that stays unavailable rather than mislabeled.
export function capitalIntensity(pl, bs) {
  const sales = latest(pl, 'sales');
  const fixedAssets = latest(bs, 'fixedAssets');
  return sales > 0 && fixedAssets != null ? number(fixedAssets / sales) : null;
}

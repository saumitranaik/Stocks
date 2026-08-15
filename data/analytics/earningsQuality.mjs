import { number } from '../util.mjs';
import { latest, timeSeries } from './series.mjs';

// This project's own heuristic, not a named external methodology (unlike
// Piotroski/Altman, which are specific formulas this data source cannot
// support — see docs/governance/roadmap.md §6). Lower accrualRatio and more consistent FCF
// conversion both indicate higher-quality (more cash-backed) earnings.
export function earningsQuality(pl, bs, cf) {
  const netProfit = latest(pl, 'netProfit');
  const cfo = latest(cf, 'cfo');
  const totalAssets = latest(bs, 'totalAssets');
  const accrualRatio = totalAssets > 0 && netProfit != null && cfo != null ? number((netProfit - cfo) / totalAssets) : null;
  const cfoToOpSeries = timeSeries(cf, 'cfoToOp').map(([, v]) => v);
  const cfoToOpConsistency = cfoToOpSeries.length >= 2
    ? number(1 - Math.sqrt(cfoToOpSeries.reduce((s, v, _, arr) => s + (v - arr.reduce((a, b) => a + b, 0) / arr.length) ** 2, 0) / cfoToOpSeries.length) / 100)
    : null;
  const score = accrualRatio != null && cfoToOpConsistency != null
    ? Math.round(Math.max(0, Math.min(100, 50 - accrualRatio * 300 + cfoToOpConsistency * 50)))
    : null;
  return { accrualRatio, cfoToOpConsistency, score, methodology: "Project-defined heuristic (accrual ratio + CFO/operating-profit consistency), not a named external formula" };
}

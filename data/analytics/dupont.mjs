import { number } from '../util.mjs';
import { latest } from './series.mjs';

// Total shareholder equity, consistently used wherever "equity" is needed
// (D/E, DuPont equity multiplier). The pre-Phase-1 model computed D/E from
// Borrowings/Reserves alone, ignoring Equity Capital — an accuracy fix.
function totalEquity(bs) {
  const equityCapital = latest(bs, 'equityCapital');
  const reserves = latest(bs, 'reserves');
  return equityCapital != null && reserves != null ? equityCapital + reserves : null;
}

export function debtToEquityPct(bs) {
  const borrowings = latest(bs, 'borrowings');
  const equity = totalEquity(bs);
  return borrowings != null && equity > 0 ? number((borrowings / equity) * 100) : null;
}

// Qualitative bucket over the real Debt/Equity %, same style as the
// trend/momentum text labels in yahooQuoteProvider.mjs -- not a separate
// data source, just a readable label on a number already computed above.
export function capitalStructureLabel(debtToEquityPct) {
  if (debtToEquityPct == null) return 'N/A';
  if (debtToEquityPct < 30) return 'Low leverage';
  if (debtToEquityPct <= 70) return 'Moderate leverage';
  return 'High leverage';
}

export function interestCoveragePct(pl) {
  const pbt = latest(pl, 'profitBeforeTax');
  const interest = latest(pl, 'interest');
  if (pbt == null || interest == null || interest <= 0) return null;
  return number((pbt + interest) / interest);
}

// Three-factor DuPont ROE = Net Margin x Asset Turnover x Equity Multiplier.
// `reportedRoe` (Screener's own trailing figure) rides alongside for a sanity
// cross-check — the two won't match exactly (DuPont uses FY-end balance
// sheet figures, reportedRoe is a trailing/point-in-time number) but should
// be in the same neighborhood for a stable business.
export function dupontRoe(pl, bs, reportedRoe) {
  const sales = latest(pl, 'sales');
  const netProfit = latest(pl, 'netProfit');
  const totalAssets = latest(bs, 'totalAssets');
  const equity = totalEquity(bs);
  const netMargin = sales > 0 && netProfit != null ? netProfit / sales : null;
  const assetTurnover = totalAssets > 0 && sales != null ? sales / totalAssets : null;
  const equityMultiplier = equity > 0 && totalAssets != null ? totalAssets / equity : null;
  const factorsAvailable = netMargin != null && assetTurnover != null && equityMultiplier != null;
  return {
    netMarginPct: netMargin != null ? number(netMargin * 100) : null,
    assetTurnover: assetTurnover != null ? number(assetTurnover) : null,
    equityMultiplier: equityMultiplier != null ? number(equityMultiplier) : null,
    dupontRoePct: factorsAvailable ? number(netMargin * assetTurnover * equityMultiplier * 100) : null,
    reportedRoePct: Number.isFinite(reportedRoe) ? number(reportedRoe) : null
  };
}

// ROCE's capital-employed side (Total Assets - Current Liabilities) isn't
// independently derivable — Screener's balance sheet bundles current and
// non-current liabilities into a single "Other Liabilities" plug. Screener's
// own rocePct time series is real and sourced directly; ebitMargin is fully
// computable from real P&L lines; the implied capital-turnover factor is a
// *solved residual* from those two, not an independently verified figure —
// tagged as such rather than presented as directly sourced.
export function roceDecomposition(pl, ratios) {
  const rocePct = latest(ratios, 'rocePct');
  const pbt = latest(pl, 'profitBeforeTax');
  const interest = latest(pl, 'interest');
  const sales = latest(pl, 'sales');
  const ebitMarginPct = sales > 0 && pbt != null && interest != null ? number(((pbt + interest) / sales) * 100) : null;
  const impliedCapitalTurnover = rocePct != null && ebitMarginPct > 0 ? number(rocePct / ebitMarginPct) : null;
  return {
    rocePct: rocePct != null ? number(rocePct) : null,
    ebitMarginPct,
    impliedCapitalTurnover,
    derivationMethod: 'impliedCapitalTurnover is a solved residual (rocePct / ebitMarginPct), not independently computed from balance-sheet capital employed, which this data source does not expose'
  };
}

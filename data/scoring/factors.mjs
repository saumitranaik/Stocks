import { clamp } from '../util.mjs';
import { latest, valueYearsAgo, timeSeries, stdDev } from '../analytics/series.mjs';
import { debtToEquityPct, interestCoveragePct, roceDecomposition } from '../analytics/dupont.mjs';
import { cagrOverYears } from '../analytics/cagr.mjs';
import { marginStability } from '../analytics/margins.mjs';
import { technicalTrendSignal, momentumVolumeSignal } from '../providers/yahooQuoteProvider.mjs';

// Every factor function returns { key, label, weight, value, confidence, notes }.
// value is 0-100 or null (no fabricated neutral default — see scoringEngine.mjs,
// which renormalizes over only the available factors instead of defaulting a
// missing one to 50). confidence flags heuristic/derived scores so the
// frontend can show them differently from directly-sourced ones.
const factor = (key, label, weight, value, confidence, notes) => ({ key, label, weight, value: value == null ? null : Math.round(clamp(value, 0, 100)), confidence, notes });

function businessQuality(pl, ratios) {
  if (!pl || !ratios) return factor('businessQuality', 'Business quality', 15, null, 'none', 'Requires multi-year margin and ROCE history (India/Screener.in only)');
  const marginDev = marginStability(pl);
  const roceDev = stdDev(timeSeries(ratios, 'rocePct').map(([, v]) => v));
  const scores = [];
  if (marginDev != null) scores.push(clamp(75 - marginDev * 3, 0, 100));
  if (roceDev != null) scores.push(clamp(75 - roceDev * 3, 0, 100));
  if (!scores.length) return factor('businessQuality', 'Business quality', 15, null, 'none', 'Insufficient history for a stability read');
  return factor('businessQuality', 'Business quality', 15, scores.reduce((a, b) => a + b, 0) / scores.length, 'partial',
    'Heuristic: operating-margin and ROCE stability across available history, not a named external formula');
}

function financialStrength(pl, bs) {
  if (!bs) return factor('financialStrength', 'Financial strength', 10, null, 'none', 'Requires balance sheet (India/Screener.in only)');
  const de = debtToEquityPct(bs);
  const coverage = interestCoveragePct(pl);
  const scores = [];
  if (de != null) scores.push(clamp(90 - de / 2, 0, 100));
  if (coverage != null) scores.push(clamp(coverage * 10, 0, 100));
  if (!scores.length) return factor('financialStrength', 'Financial strength', 10, null, 'none', 'Debt/equity and interest coverage unavailable');
  return factor('financialStrength', 'Financial strength', 10, scores.reduce((a, b) => a + b, 0) / scores.length, 'full', 'Debt/equity and interest coverage, from reported balance sheet and P&L');
}

function profitability(snapshot, pl) {
  const scores = [];
  if (Number.isFinite(snapshot?.roe)) scores.push(clamp(50 + (snapshot.roe - 15) * 3, 0, 100));
  if (Number.isFinite(snapshot?.roce)) scores.push(clamp(50 + (snapshot.roce - 15) * 3, 0, 100));
  const opm = latest(pl, 'opmPct');
  if (opm != null) scores.push(clamp(50 + (opm - 15) * 2, 0, 100));
  const sales = latest(pl, 'sales'), netProfit = latest(pl, 'netProfit');
  if (sales > 0 && netProfit != null) scores.push(clamp(50 + (netProfit / sales * 100 - 10) * 3, 0, 100));
  if (!scores.length) return factor('profitability', 'Profitability', 10, null, 'none', 'ROE/ROCE/margins unavailable (India/Screener.in only)');
  return factor('profitability', 'Profitability', 10, scores.reduce((a, b) => a + b, 0) / scores.length, 'full', 'ROE, ROCE, operating margin and net margin vs. broad benchmarks');
}

function growth(pl) {
  if (!pl) return factor('growth', 'Growth', 10, null, 'none', 'Requires multi-year P&L history (India/Screener.in only)');
  const scores = [];
  for (const years of [3, 5]) {
    const revCagr = cagrOverYears(pl, 'sales', years);
    const epsCagr = cagrOverYears(pl, 'epsInRs', years);
    if (revCagr != null) scores.push(clamp(50 + revCagr * 2, 0, 100));
    if (epsCagr != null) scores.push(clamp(50 + epsCagr * 2, 0, 100));
  }
  if (!scores.length) return factor('growth', 'Growth', 10, null, 'none', 'Not enough full fiscal years for a 3Y/5Y CAGR');
  return factor('growth', 'Growth', 10, scores.reduce((a, b) => a + b, 0) / scores.length, 'full', 'Revenue and EPS CAGR over 3Y/5Y trailing full fiscal years');
}

function cashFlowQuality(pl, cf) {
  if (!cf) return factor('cashFlowQuality', 'Cash flow quality', 10, null, 'none', 'Requires cash-flow statement (India/Screener.in only)');
  const scores = [];
  const cfoToOp = latest(cf, 'cfoToOp');
  if (cfoToOp != null) scores.push(clamp(cfoToOp, 0, 100));
  const fcf = latest(cf, 'freeCashFlow'), sales = latest(pl, 'sales');
  if (fcf != null && sales > 0) scores.push(clamp(50 + (fcf / sales * 100) * 3, 0, 100));
  const fcfCagr = cagrOverYears(cf, 'freeCashFlow', 3);
  if (fcfCagr != null) scores.push(clamp(50 + fcfCagr * 1.5, 0, 100));
  if (!scores.length) return factor('cashFlowQuality', 'Cash flow quality', 10, null, 'none', 'CFO/FCF fields unavailable');
  return factor('cashFlowQuality', 'Cash flow quality', 10, scores.reduce((a, b) => a + b, 0) / scores.length, 'full', 'CFO-to-operating-profit conversion, FCF margin, and FCF CAGR (frequently unavailable where FCF has changed sign)');
}

function balanceSheet(bs) {
  if (!bs) return factor('balanceSheet', 'Balance sheet', 5, null, 'none', 'Requires balance sheet (India/Screener.in only); current ratio is not available from this data source (see docs/governance/roadmap.md §6)');
  const de = debtToEquityPct(bs);
  if (de == null) return factor('balanceSheet', 'Balance sheet', 5, null, 'none', 'Borrowings/equity unavailable');
  const borrowings3y = valueYearsAgo(bs, 'borrowings', 3);
  const borrowingsNow = latest(bs, 'borrowings');
  const trendBonus = borrowings3y != null && borrowingsNow != null && borrowings3y > 0 ? clamp((borrowings3y - borrowingsNow) / borrowings3y * 50, -15, 15) : 0;
  return factor('balanceSheet', 'Balance sheet', 5, clamp(90 - de / 2, 0, 100) + trendBonus, 'partial', 'Debt/equity plus 3-year borrowings trend; current ratio not available from this data source');
}

function valuation(quote, snapshot, industryPe, pl) {
  const scores = [];
  const pe = snapshot?.pe;
  if (Number.isFinite(pe) && Number.isFinite(industryPe) && industryPe > 0) scores.push(clamp(100 - (pe / industryPe - 1) * 100, 0, 100));
  const pb = snapshot?.bookValue > 0 && Number.isFinite(quote?.regularMarketPrice) ? quote.regularMarketPrice / snapshot.bookValue : null;
  if (pb != null) scores.push(clamp(100 - (pb - 1) * 20, 0, 100));
  if (Number.isFinite(snapshot?.dividendYield)) scores.push(clamp(50 + snapshot.dividendYield * 10, 0, 100));
  const epsCagr5 = cagrOverYears(pl, 'epsInRs', 5);
  // Same near-zero-denominator guard as metricsTable.mjs's PEG: below a 2%
  // floor the ratio is a division artifact, not a meaningful signal.
  if (Number.isFinite(pe) && epsCagr5 > 2) scores.push(clamp(100 - (pe / epsCagr5 - 1) * 40, 0, 100));
  if (!scores.length) return factor('valuation', 'Valuation', 10, null, 'none', 'P/E, P/B, yield and PEG unavailable');
  return factor('valuation', 'Valuation', 10, scores.reduce((a, b) => a + b, 0) / scores.length, 'full', 'P/E vs. sector average, P/B, dividend yield, and PEG (P/E over 5Y EPS CAGR)');
}

function managementGovernance() {
  return factor('managementGovernance', 'Management & governance', 10, null, 'none', 'No pledge/related-party/governance data source is configured');
}
function industryPosition(classification) {
  return factor('industryPosition', 'Industry position', 5, null, 'none', classification ? 'Industry classification captured but peer-ranking data is not yet integrated' : 'No industry classification available');
}

function riskProfile(quote, snapshot, industryPe) {
  const scores = [];
  const pe = snapshot?.pe;
  if (Number.isFinite(pe) && Number.isFinite(industryPe) && industryPe > 0) scores.push(clamp(100 - Math.abs(pe / industryPe - 1) * 80, 0, 100));
  if (Number.isFinite(quote?.regularMarketPrice) && quote.twoHundredDayAverage > 0) scores.push(clamp(50 + (quote.regularMarketPrice / quote.twoHundredDayAverage - 1) * 110, 0, 100));
  if (Number.isFinite(quote?.regularMarketPrice) && quote.fiftyTwoWeekHigh > 0) scores.push(clamp(100 - (1 - quote.regularMarketPrice / quote.fiftyTwoWeekHigh) * 140, 0, 100));
  if (!scores.length) return factor('riskProfile', 'Risk profile', 5, null, 'none', 'Insufficient price/valuation data');
  return factor('riskProfile', 'Risk profile', 5, scores.reduce((a, b) => a + b, 0) / scores.length, 'partial', 'Inverse of relative-valuation and drawdown risk (higher = lower risk)');
}

function technicalTrend(quote) {
  const value = technicalTrendSignal(quote);
  return factor('technicalTrend', 'Technical trend', 5, value, value != null ? 'full' : 'none', 'Price vs. 50/200-day averages and distance from 52-week high');
}
function momentumVolume(quote) {
  const value = momentumVolumeSignal(quote);
  return factor('momentumVolume', 'Momentum & volume', 5, value, value != null ? 'full' : 'none', 'RSI(14), daily move, and volume vs. its 20-day average');
}

export function computeFactors({ quote, fundamentals, industryPe }) {
  const pl = fundamentals?.annual?.profitLoss;
  const bs = fundamentals?.annual?.balanceSheet;
  const cf = fundamentals?.annual?.cashFlow;
  const ratios = fundamentals?.annual?.ratios;
  const snapshot = fundamentals?.snapshot;
  return [
    businessQuality(pl, ratios),
    financialStrength(pl, bs),
    profitability(snapshot, pl),
    growth(pl),
    cashFlowQuality(pl, cf),
    balanceSheet(bs),
    valuation(quote, snapshot, industryPe, pl),
    managementGovernance(),
    industryPosition(fundamentals?.classification),
    riskProfile(quote, snapshot, industryPe),
    technicalTrend(quote),
    momentumVolume(quote)
  ];
}

// Re-exported so callers building the Fundamentals tab's ROCE-decomposition
// card don't need a separate import path for something scoring already pulls in.
export { roceDecomposition };

// -- Company Quality vs. Stock Attractiveness (foundation upgrade) ----------
// Two named groupings over the exact same factor list above -- no new
// calculation, just a conceptual split so "is this a good business" and "is
// this stock a good buy right now" can be reported as two first-class,
// separately-labeled scores (see data/scoring/qualityAttractiveness.mjs).
// Distinct from scoringEngine.mjs's own internal QUALITY_FACTOR_KEYS (which
// feeds the primary recommendation's Quality *bucket* and is unchanged by
// this addition) -- these two groupings are a separate analytical lens, the
// same non-overriding relationship data/quant/factorEngine.mjs already has
// to the primary recommendation engine.
export const COMPANY_QUALITY_FACTOR_KEYS = [
  'businessQuality', 'financialStrength', 'profitability', 'growth',
  'cashFlowQuality', 'balanceSheet', 'managementGovernance', 'industryPosition'
];
export const STOCK_ATTRACTIVENESS_FACTOR_KEYS = [
  'valuation', 'riskProfile', 'technicalTrend', 'momentumVolume'
];

import { number, clamp, average } from '../util.mjs';
import { latest, timeSeries } from './series.mjs';
import { cagrOverYears } from './cagr.mjs';
import { sharesOutstanding } from './shares.mjs';
import { alignSeries } from './priceSeries.mjs';

// Fixed, disclosed per-market assumption constants -- this app has no live
// risk-free-rate or equity-risk-premium feed, so these are static rather
// than sourced. Approximate long-run 10Y-govt-bond / equity-risk-premium
// levels per market as of this phase's implementation; not updated live.
// See metricRegistry.mjs's `wacc`/`dcfFairValue` entries, surfaced in the UI.
const RISK_FREE_RATE_PCT = { India: 7.1, 'United States': 4.3, Global: 4.5 };
const EQUITY_RISK_PREMIUM_PCT = { India: 5.5, 'United States': 5.0, Global: 5.5 };
const TERMINAL_GROWTH_PCT = { India: 4.0, 'United States': 3.0, Global: 3.0 };
const PROJECTION_YEARS = 10;

export const dcfAssumptions = (market) => ({
  riskFreeRatePct: RISK_FREE_RATE_PCT[market] ?? RISK_FREE_RATE_PCT.Global,
  equityRiskPremiumPct: EQUITY_RISK_PREMIUM_PCT[market] ?? EQUITY_RISK_PREMIUM_PCT.Global,
  terminalGrowthPct: TERMINAL_GROWTH_PCT[market] ?? TERMINAL_GROWTH_PCT.Global
});

// Beta: covariance of weekly stock returns vs. weekly benchmark returns,
// over whatever overlapping window `alignSeries` finds (~1-2 years of the
// 5y weekly priceHistory in practice) -- a real calculation from real
// prices, not a sourced field (this data source has no beta feed). Requires
// at least ~20 paired weekly return observations or returns null rather
// than a thin, unreliable estimate.
export function beta(stockPoints, benchmarkPoints) {
  const pairs = alignSeries(stockPoints, benchmarkPoints);
  if (pairs.length < 30) return null;
  const stockReturns = [], benchReturns = [];
  for (let i = 1; i < pairs.length; i++) {
    const [sPrev, bPrev] = pairs[i - 1], [sNow, bNow] = pairs[i];
    if (sPrev > 0 && bPrev > 0) { stockReturns.push((sNow - sPrev) / sPrev); benchReturns.push((bNow - bPrev) / bPrev); }
  }
  if (stockReturns.length < 20) return null;
  const meanS = average(stockReturns), meanB = average(benchReturns);
  let cov = 0, varB = 0;
  for (let i = 0; i < stockReturns.length; i++) { cov += (stockReturns[i] - meanS) * (benchReturns[i] - meanB); varB += (benchReturns[i] - meanB) ** 2; }
  cov /= stockReturns.length; varB /= stockReturns.length;
  return varB > 0 ? number(cov / varB) : null;
}

// WACC = CAPM cost of equity (Rf + beta x ERP) blended with after-tax cost
// of debt (Interest / Borrowings, tax-effected by the reported Tax % when
// available), weighted by market-cap equity weight and reported-borrowings
// debt weight. Returns null when beta itself isn't computable -- this model
// declines to assume a default beta of 1 (that would be presenting an
// invented input as if it were derived) rather than silently degrading.
export function wacc({ market, betaValue, marketCap, debt, interest, taxPct }) {
  if (!Number.isFinite(betaValue) || !(marketCap > 0)) return null;
  const { riskFreeRatePct, equityRiskPremiumPct } = dcfAssumptions(market);
  const costOfEquityPct = riskFreeRatePct + betaValue * equityRiskPremiumPct;
  const debtValue = Number.isFinite(debt) && debt > 0 ? debt : 0;
  const totalCapital = marketCap + debtValue;
  const equityWeight = marketCap / totalCapital, debtWeight = debtValue / totalCapital;
  let costOfDebtPct = null;
  if (debtValue > 0 && Number.isFinite(interest) && interest > 0) {
    const pretaxPct = (interest / debtValue) * 100;
    const taxRate = Number.isFinite(taxPct) ? clamp(taxPct, 0, 50) / 100 : 0;
    costOfDebtPct = pretaxPct * (1 - taxRate);
  }
  const blendedPct = costOfEquityPct * equityWeight + (costOfDebtPct ?? costOfEquityPct) * debtWeight;
  return {
    waccPct: number(blendedPct), costOfEquityPct: number(costOfEquityPct), costOfDebtPct: costOfDebtPct != null ? number(costOfDebtPct) : null,
    equityWeightPct: number(equityWeight * 100), debtWeightPct: number(debtWeight * 100),
    riskFreeRatePct, equityRiskPremiumPct
  };
}

// Blended near-term growth input: FCF CAGR when available (FCF is what the
// model actually discounts), falling back to revenue CAGR when FCF history
// is too thin or sign-flipping to CAGR cleanly. Clamped to a +/-30%/-15%
// band so a single volatile year can't produce an explosive 10-year
// projection -- a disclosed guard, same spirit as the existing PEG
// near-zero-growth guard elsewhere in this codebase.
function nearTermGrowthPct(cf, pl) {
  const fcfCagr = cagrOverYears(cf, 'freeCashFlow', 3) ?? cagrOverYears(cf, 'freeCashFlow', 5);
  const revenueCagr = cagrOverYears(pl, 'sales', 5) ?? cagrOverYears(pl, 'sales', 3);
  const raw = Number.isFinite(fcfCagr) ? fcfCagr : revenueCagr;
  return Number.isFinite(raw) ? clamp(raw, -15, 30) : null;
}

// Historical dispersion of the same growth driver (YoY %, not CAGR) --
// feeds the Bull/Bear band width below.
function growthDispersionPct(series, field) {
  const values = timeSeries(series, field).map(([, v]) => v);
  const rates = [];
  for (let i = 1; i < values.length; i++) if (values[i - 1] > 0) rates.push(((values[i] - values[i - 1]) / values[i - 1]) * 100);
  if (rates.length < 2) return null;
  const mean = average(rates);
  return Math.sqrt(rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length);
}

// 2-stage explicit-growth DCF: a single PROJECTION_YEARS-long linear taper
// from `growth1Pct` (year 1) down to `terminalGrowthPct` (final explicit
// year) approximates "grow at the near-term rate for several years, then
// converge toward a terminal rate" without hard-coding two separate taper
// anchors. Gordon-growth terminal value beyond. Returns the present value in
// the same currency-Cr unit as fcf0 (Screener's reporting unit) -- an equity
// value *proxy*: this model does not bridge Enterprise Value to Equity Value
// via net debt, because Net Debt is unavailable app-wide (see
// dataLimitations) -- reported Free Cash Flow is treated as an equity-cash-
// flow proxy, a disclosed simplification, not a rigorous FCFF-to-equity
// bridge.
function projectPresentValue({ fcf0, growth1Pct, terminalGrowthPct, waccPct, years = PROJECTION_YEARS }) {
  if (!(fcf0 > 0) || !Number.isFinite(growth1Pct) || !Number.isFinite(terminalGrowthPct) || !Number.isFinite(waccPct) || waccPct <= terminalGrowthPct) return null;
  const wacc = waccPct / 100, terminal = terminalGrowthPct / 100, growth1 = growth1Pct / 100;
  let fcf = fcf0, pv = 0;
  for (let year = 1; year <= years; year++) {
    const g = growth1 + (terminal - growth1) * ((year - 1) / (years - 1));
    fcf *= (1 + g);
    pv += fcf / Math.pow(1 + wacc, year);
  }
  const terminalValue = (fcf * (1 + terminal)) / (wacc - terminal);
  pv += terminalValue / Math.pow(1 + wacc, years);
  return pv;
}
const perShareValue = (presentValueCr, shares) => presentValueCr != null && shares > 0 ? number((presentValueCr * 1e7) / shares) : null;

// Binary search for the Stage-1 growth rate that reconciles the model's
// present value to today's market cap -- pure algebra on the model above,
// not an independent estimate. Bounded to a -30%/+60% search band (wide
// enough to bracket any realistic reverse-solved rate; the model's own
// nearTermGrowthPct() clamp above is the one actually used forward).
function reverseImpliedGrowthPct({ fcf0, terminalGrowthPct, waccPct, shares, currentPrice }) {
  if (!(fcf0 > 0) || !Number.isFinite(waccPct) || !(shares > 0) || !(currentPrice > 0)) return null;
  let lo = -30, hi = 60;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const perShare = perShareValue(projectPresentValue({ fcf0, growth1Pct: mid, terminalGrowthPct, waccPct }), shares);
    if (perShare == null) return null;
    if (perShare < currentPrice) lo = mid; else hi = mid;
  }
  return number((lo + hi) / 2);
}

// Full valuation engine for one stock. `reversionFairValue` is the existing
// P/E-P/B heuristic from valuation.mjs, passed in purely to compute a
// confidence score from cross-model agreement -- this module doesn't
// replace that model, it adds a second, DCF-based one alongside it.
export function dcfValuation({ market, fundamentals, quote, betaValue, reversionFairValue }) {
  const pl = fundamentals?.annual?.profitLoss, bs = fundamentals?.annual?.balanceSheet, cf = fundamentals?.annual?.cashFlow, snapshot = fundamentals?.snapshot || {};
  const fcf0 = latest(cf, 'freeCashFlow');
  const growth1Pct = nearTermGrowthPct(cf, pl);
  const shares = sharesOutstanding(bs, snapshot);
  const currentPrice = Number.isFinite(quote?.regularMarketPrice) ? quote.regularMarketPrice : null;
  const marketCap = Number.isFinite(snapshot.marketCap) ? snapshot.marketCap : null;
  const debt = latest(bs, 'borrowings');
  const interest = latest(pl, 'interest');
  const taxPct = latest(pl, 'taxPct');

  const waccResult = wacc({ market, betaValue, marketCap, debt, interest, taxPct });
  const { terminalGrowthPct } = dcfAssumptions(market);

  if (!(fcf0 > 0) || growth1Pct == null || !waccResult || !(shares > 0)) {
    return { available: false, reason: !(fcf0 > 0) ? 'Free cash flow history is unavailable or non-positive' : growth1Pct == null ? 'Insufficient revenue/FCF history for a growth estimate' : !waccResult ? 'Beta is not computable (insufficient price history or no benchmark for this market)' : 'Share count is not derivable', waccPct: waccResult?.waccPct ?? null, assumptions: dcfAssumptions(market) };
  }

  const base = perShareValue(projectPresentValue({ fcf0, growth1Pct, terminalGrowthPct, waccPct: waccResult.waccPct }), shares);
  const dispersion = growthDispersionPct(cf?.rows?.freeCashFlow ? cf : pl, cf?.rows?.freeCashFlow ? 'freeCashFlow' : 'sales');
  const band = Number.isFinite(dispersion) ? clamp(dispersion, 3, 15) : 5; // disclosed fallback band when history is too short to derive a dispersion
  const bull = perShareValue(projectPresentValue({ fcf0, growth1Pct: clamp(growth1Pct + band, -15, 35), terminalGrowthPct, waccPct: waccResult.waccPct }), shares);
  const bear = perShareValue(projectPresentValue({ fcf0, growth1Pct: clamp(growth1Pct - band, -20, 30), terminalGrowthPct, waccPct: waccResult.waccPct }), shares);

  const sensitivity = [-1.5, 0, 1.5].map(dWacc => ({
    waccPct: number(waccResult.waccPct + dWacc),
    row: [-1, 0, 1].map(dTg => ({
      terminalGrowthPct: number(terminalGrowthPct + dTg),
      fairValue: perShareValue(projectPresentValue({ fcf0, growth1Pct, terminalGrowthPct: terminalGrowthPct + dTg, waccPct: waccResult.waccPct + dWacc }), shares)
    }))
  }));

  const reverseImpliedGrowthPct1 = reverseImpliedGrowthPct({ fcf0, terminalGrowthPct, waccPct: waccResult.waccPct, shares, currentPrice });

  const completeness = [fcf0 > 0, growth1Pct != null, betaValue != null, waccResult != null].filter(Boolean).length / 4 * 100;
  const agreement = base != null && reversionFairValue > 0 ? clamp(100 - (Math.abs(base - reversionFairValue) / reversionFairValue) * 100, 0, 100) : null;
  const confidenceComponents = [completeness, agreement].filter(Number.isFinite);
  const valuationConfidenceScore = confidenceComponents.length ? Math.round(average(confidenceComponents)) : null;
  const confidenceBand = valuationConfidenceScore == null ? null : valuationConfidenceScore >= 70 ? 'High' : valuationConfidenceScore >= 45 ? 'Medium' : 'Low';

  return {
    available: true, growth1Pct: number(growth1Pct), band: number(band),
    base, bull, bear, sensitivity,
    reverseImpliedGrowthPct: reverseImpliedGrowthPct1,
    valuationConfidenceScore, confidenceBand,
    wacc: waccResult, assumptions: dcfAssumptions(market),
    methodology: 'In-house 2-stage discounted-FCF model over reported free cash flow -- treats FCF as an equity-cash-flow proxy and does not bridge Enterprise Value to Equity Value via net debt (unavailable app-wide). Not analyst consensus.'
  };
}

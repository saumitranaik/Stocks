import { number, clamp } from '../util.mjs';
import { latest } from './series.mjs';
import { dcfAssumptions } from './dcf.mjs';

// Sector gate for the DCF/WACC/reverse-DCF/sensitivity engine (dcf.mjs). A
// levered-FCF DCF is not analytically meaningful for a deposit-taking/
// lending/underwriting institution -- "capital expenditure" and "working
// capital" don't correspond to a bank/NBFC/insurer's actual economics, and
// Screener's generic Free Cash Flow line frequently resolves as positive for
// one anyway, producing a fair value with no analytical basis (see
// docs/governance/audits/2026-08-13-phase2-institutional-audit.mhtml). Checked against both
// `sector` and `industry` (Screener's own classification data) so a company
// only classified at the industry level -- e.g. an NBFC/insurer whose sector
// string doesn't itself say "Financial" -- still gates correctly.
const FINANCIAL_SECTOR_PATTERN = /bank|nbfc|non[- ]?banking financial|insur|financ|asset management/i;
export function isFinancialSector(sector, industry) {
  return FINANCIAL_SECTOR_PATTERN.test(sector || '') || FINANCIAL_SECTOR_PATTERN.test(industry || '');
}

const METHODOLOGY = 'DCF is not applicable for financial institutions: a levered-free-cash-flow model does not map to a deposit-taking/lending/underwriting balance sheet. This is a justified Price-to-Book valuation, algebraically the excess-return (residual income) model expressed as a P/B multiple: Justified P/B = (ROE - g) / (Cost of Equity - g). Cost of Equity is CAPM (risk-free rate + beta x equity risk premium, same disclosed per-market assumptions as the DCF model). g is the sustainable growth rate (ROE x retention ratio, from the reported dividend payout ratio). Fair value = Justified P/B x reported book value per share.';

// Disclosed, fixed bull/bear band on ROE (percentage points) -- this data
// source has no multi-year ROE series to derive a dispersion from (only
// ROCE has one, see metricsTable.mjs), so unlike the DCF model's
// history-derived band this is a flat assumption, same "Heuristic:"
// precedent as the fallback band in dcf.mjs.
const ROE_BAND_PP = 2;
const MAX_JUSTIFIED_PB = 8;

function confidenceBandFor(score) {
  return score == null ? null : score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
}

// Justified-P/B / excess-return / cost-of-equity valuation for banks, NBFCs,
// insurers and asset managers -- the alternative this app substitutes for
// DCF in the financial sector. Never assumes a default beta of 1 (same rule
// as dcf.mjs's own beta()/wacc()) and never defaults ROE/book value/payout
// to a fabricated neutral value -- each missing input produces an explicit
// `available: false` reason instead.
export function financialSectorValuation({ market, fundamentals, quote, betaValue }) {
  const assumptions = dcfAssumptions(market);
  const { riskFreeRatePct, equityRiskPremiumPct, terminalGrowthPct } = assumptions;

  if (!Number.isFinite(betaValue)) {
    return { available: false, sectorExcluded: true, reason: 'Beta is not computable (insufficient price history or no benchmark for this market)', assumptions, methodology: METHODOLOGY };
  }
  const costOfEquityPct = riskFreeRatePct + betaValue * equityRiskPremiumPct;

  const snapshot = fundamentals?.snapshot || {};
  const pl = fundamentals?.annual?.profitLoss;
  const bookValue = Number.isFinite(snapshot.bookValue) ? snapshot.bookValue : null;
  const roePct = Number.isFinite(snapshot.roe) ? snapshot.roe : null;

  if (!(bookValue > 0) || roePct == null) {
    return {
      available: false, sectorExcluded: true,
      reason: !(bookValue > 0) ? 'Book value per share is unavailable' : 'ROE is unavailable',
      costOfEquityPct: number(costOfEquityPct), assumptions, methodology: METHODOLOGY
    };
  }

  const payoutPct = latest(pl, 'dividendPayoutPct');
  // Reported payout ratios occasionally print as a data artifact well outside
  // [0,100] (e.g. a near-zero-earnings year) -- clamped, same defensive style
  // as the PEG near-zero-growth guard elsewhere in this codebase.
  const retentionRatio = Number.isFinite(payoutPct) ? clamp(1 - payoutPct / 100, 0, 1) : null;
  const sustainableGrowthPct = retentionRatio != null ? roePct * retentionRatio : null;
  // g is additionally capped a few points above the disclosed terminal-growth
  // assumption (not just below Cost of Equity): a mature bank/NBFC's
  // sustainable growth shouldn't be modeled near its own cost of equity long
  //-term, and the Gordon-growth-derived Justified-P/B ratio below is
  // numerically unstable as g -> Cost of Equity (division by a
  // near-zero spread), so both bounds are needed to avoid runaway fair
  // values, not just a negative one.
  const gPct = clamp(sustainableGrowthPct ?? terminalGrowthPct, 0, terminalGrowthPct + 3);

  const MIN_COE_G_SPREAD_PCT = 2;
  if (costOfEquityPct - gPct < MIN_COE_G_SPREAD_PCT) {
    return { available: false, sectorExcluded: true, reason: 'Cost of equity is too close to the sustainable-growth estimate for a stable justified-P/B fair value (the Gordon-growth ratio becomes numerically unstable as growth approaches the cost of equity)', costOfEquityPct: number(costOfEquityPct), sustainableGrowthPct: sustainableGrowthPct != null ? number(sustainableGrowthPct) : null, assumptions, methodology: METHODOLOGY };
  }

  const justifiedPbFor = (roe) => clamp((roe - gPct) / (costOfEquityPct - gPct), 0, MAX_JUSTIFIED_PB);
  const justifiedPB = justifiedPbFor(roePct);
  const base = number(justifiedPB * bookValue);
  const bull = number(justifiedPbFor(roePct + ROE_BAND_PP) * bookValue);
  const bear = number(justifiedPbFor(Math.max(0, roePct - ROE_BAND_PP)) * bookValue);

  const excessReturnPct = number(roePct - costOfEquityPct);
  const currentPrice = Number.isFinite(quote?.regularMarketPrice) ? quote.regularMarketPrice : null;

  const completeness = [bookValue > 0, roePct != null, betaValue != null, payoutPct != null].filter(Boolean).length / 4 * 100;
  const agreement = base != null && currentPrice > 0 ? clamp(100 - (Math.abs(base - currentPrice) / currentPrice) * 100, 0, 100) : null;
  const confidenceComponents = [completeness, agreement].filter(Number.isFinite);
  const valuationConfidenceScore = confidenceComponents.length ? Math.round(confidenceComponents.reduce((a, b) => a + b, 0) / confidenceComponents.length) : null;

  return {
    available: true, sectorExcluded: true,
    base, bull, bear,
    justifiedPB: number(justifiedPB), bookValuePerShare: bookValue,
    roePct: number(roePct), costOfEquityPct: number(costOfEquityPct), sustainableGrowthPct: number(gPct),
    excessReturnPct, payoutPct: payoutPct != null ? number(payoutPct) : null,
    valuationConfidenceScore, confidenceBand: confidenceBandFor(valuationConfidenceScore),
    assumptions, methodology: METHODOLOGY
  };
}

import { number } from '../util.mjs';
import { latest } from './series.mjs';
import { debtToEquityPct, interestCoveragePct, capitalStructureLabel } from './dupont.mjs';
import { cagrOverYears } from './cagr.mjs';
import { earningsQuality } from './earningsQuality.mjs';

// Most recent value of a shareholding row (periods run oldest -> newest,
// unlike the FY statements which can carry a trailing 'TTM' column).
const latestOfSeries = (series, field) => {
  const value = series?.rows?.[field]?.at(-1);
  return Number.isFinite(value) ? value : null;
};

// Builds the full institutional Stock Metrics row for one stock. Fields this
// data source cannot supply (EV, EV/EBITDA, forward P/E, cash, net debt,
// current ratio, Piotroski, Altman Z) are explicitly null with the reason
// recorded once in data.dataLimitations (server.mjs) rather than repeated
// per stock -- see docs/governance/roadmap.md §6 for why each is blocked.
export function buildStockMetrics(quote, fundamentals, recommendation) {
  const snapshot = fundamentals?.snapshot || {};
  const pl = fundamentals?.annual?.profitLoss;
  const bs = fundamentals?.annual?.balanceSheet;
  const cf = fundamentals?.annual?.cashFlow;
  const shareholding = fundamentals?.shareholding?.quarterly;

  const sales = latest(pl, 'sales'), netProfit = latest(pl, 'netProfit'), opmPct = latest(pl, 'opmPct');
  const totalAssets = latest(bs, 'totalAssets');
  const freeCashFlow = latest(cf, 'freeCashFlow');
  const epsCagr5 = cagrOverYears(pl, 'epsInRs', 5);
  const pb = snapshot.bookValue > 0 && Number.isFinite(quote?.regularMarketPrice) ? quote.regularMarketPrice / snapshot.bookValue : null;
  const fii = latestOfSeries(shareholding, 'fii');
  const dii = latestOfSeries(shareholding, 'dii');
  const promoterSeries = shareholding?.rows?.promoters;
  // Delta between the latest two reported periods (periods run oldest ->
  // newest, same as latestOfSeries above) -- not a multi-year trend line,
  // just the most recent quarter-over-quarter move.
  const promoterHoldingTrend = promoterSeries && promoterSeries.length >= 2
    && Number.isFinite(promoterSeries.at(-1)) && Number.isFinite(promoterSeries.at(-2))
    ? number(promoterSeries.at(-1) - promoterSeries.at(-2)) : null;

  return {
    cmp: number(quote?.regularMarketPrice),
    targetPrice: recommendation?.targetPrice ?? null,
    fairValue: recommendation?.fairValue ?? null,
    upsidePct: recommendation?.expectedReturn ?? null,
    marketCap: number(snapshot.marketCap),
    ev: null, evEbitda: null, // blocked: no explicit Cash line item to net against debt (see dataLimitations)
    pe: number(snapshot.pe), forwardPe: null, // forward estimates not exposed by this data source
    pb: number(pb),
    // epsCagr5 must clear a small floor, not just be positive: PEG divides by
    // it, and near-zero growth turns an unremarkable P/E into a triple-digit
    // "PEG" that looks like a precise red flag but is really a division-by-
    // near-zero artifact -- not meaningful as a comparable multiple.
    peg: Number.isFinite(snapshot.pe) && epsCagr5 > 2 ? number(snapshot.pe / epsCagr5) : null,
    roe: number(snapshot.roe), roce: number(snapshot.roce),
    roa: totalAssets > 0 && netProfit != null ? number((netProfit / totalAssets) * 100) : null,
    ebitdaMargin: number(opmPct), // Screener's Operating Profit is used as the EBITDA proxy (no separate D&A add-back line)
    netMargin: sales > 0 && netProfit != null ? number((netProfit / sales) * 100) : null,
    fcfYield: freeCashFlow != null && snapshot.marketCap > 0 ? number((freeCashFlow / snapshot.marketCap) * 100) : null,
    debt: latest(bs, 'borrowings'), cash: null, netDebt: null, // blocked: no explicit Cash line item
    debtToEquity: debtToEquityPct(bs),
    capitalStructure: capitalStructureLabel(debtToEquityPct(bs)),
    interestCoverage: interestCoveragePct(pl),
    currentRatio: null, quickRatio: null, // blocked: no Current Assets/Current Liabilities split (see dataLimitations)
    promoterHolding: latestOfSeries(shareholding, 'promoters'),
    promoterHoldingTrend,
    institutionalHolding: fii != null && dii != null ? number(fii + dii) : null,
    fiiHolding: fii, diiHolding: dii,
    mutualFundHolding: null, // blocked: Screener's shareholding table has no separate mutual-fund row (only Promoters/FII/DII/Government/Public)
    publicHolding: latestOfSeries(shareholding, 'public'),
    revenueCagr3y: cagrOverYears(pl, 'sales', 3), revenueCagr5y: cagrOverYears(pl, 'sales', 5),
    ebitdaCagr3y: cagrOverYears(pl, 'operatingProfit', 3), ebitdaCagr5y: cagrOverYears(pl, 'operatingProfit', 5),
    profitCagr3y: cagrOverYears(pl, 'netProfit', 3), profitCagr5y: cagrOverYears(pl, 'netProfit', 5),
    epsCagr3y: cagrOverYears(pl, 'epsInRs', 3), epsCagr5y: epsCagr5,
    bookValueCagr: null, // blocked: no per-period book-value-per-share row is exposed by this data source
    fcfCagr: cagrOverYears(cf, 'freeCashFlow', 3),
    dividendYield: number(snapshot.dividendYield),
    piotroski: null, altmanZ: null, // not implemented (see dataLimitations) -- both require a CA/CL split this source doesn't expose
    earningsQualityScore: earningsQuality(pl, bs, cf).score,
    dataTimestamp: fundamentals?.asOf ?? null
  };
}

import { fetchQuote } from './yahooQuoteProvider.mjs';

// Six macro indicators reachable through Yahoo Finance's public chart feed --
// the only free, unauthenticated, machine-readable macro source this app has.
// Every other indicator the Phase 6 brief names (RBI policy repo rate, India
// G-Sec yield, CPI inflation, IIP, PMI, power demand, ethanol policy, defence
// budget, banking liquidity) has no such source and is listed in
// UNAVAILABLE_MACRO_INDICATORS below as explicitly unavailable -- never
// estimated to fill the gap (same posture as system.md's TD-10 market-wide
// peer database: the blocker is data access, not engineering effort).
export const MACRO_INDICATORS = [
  { key: 'usdInr', ticker: 'INR=X', label: 'USD/INR', category: 'Currency', unit: '₹' },
  { key: 'usTreasury10y', ticker: '^TNX', label: 'US 10-Year Treasury yield', category: 'Rates', unit: '%' },
  { key: 'crudeOilWti', ticker: 'CL=F', label: 'Crude oil (WTI)', category: 'Commodity', unit: 'US$/bbl' },
  { key: 'naturalGas', ticker: 'NG=F', label: 'Natural gas (Henry Hub)', category: 'Commodity', unit: 'US$/MMBtu' },
  { key: 'gold', ticker: 'GC=F', label: 'Gold', category: 'Commodity', unit: 'US$/oz' },
  { key: 'indiaVix', ticker: '^INDIAVIX', label: 'India VIX', category: 'Volatility', unit: 'pts' }
];

// Rendered with an explicit "Future Integration" status (never fabricated or
// estimated) -- see data/watchlist/macro.mjs's buildMacroSnapshot() and the
// Dashboard's Macro Intelligence sub-tab's Data Quality panel.
export const UNAVAILABLE_MACRO_INDICATORS = [
  { key: 'rbiRepoRate', label: 'RBI policy repo rate', category: 'Rates' },
  { key: 'indiaGsec10y', label: 'India 10-Year G-Sec yield', category: 'Rates' },
  { key: 'cpiInflation', label: 'CPI inflation', category: 'Inflation' },
  { key: 'iip', label: 'Index of Industrial Production', category: 'Growth' },
  { key: 'pmi', label: 'Manufacturing / Services PMI', category: 'Growth' },
  { key: 'powerDemand', label: 'All-India power demand', category: 'Sector-specific' },
  { key: 'ethanolPolicy', label: 'Ethanol blending policy', category: 'Sector-specific' },
  { key: 'defenceBudget', label: 'Union defence budget', category: 'Sector-specific' },
  { key: 'bankingLiquidity', label: 'Banking system liquidity', category: 'Rates' }
];

// Thin wrapper over the existing equity-quote fetch: fetchQuote() returns far
// more than a macro card needs (RSI/MACD/DMAs meant for equities), so this
// narrows the response to the fields that make sense for an index/FX/
// commodity ticker. Zero new fetch mechanism -- same request()/chart-endpoint
// path every price fetch in this app already uses (see yahooQuoteProvider.mjs).
export async function fetchMacroQuote(ticker) {
  const quote = await fetchQuote(ticker);
  if (!quote) return null;
  return {
    price: quote.regularMarketPrice,
    changePct: quote.regularMarketChangePercent,
    oneYearChangePct: quote.oneYearReturnPct,
    fiftyDayAverage: quote.fiftyDayAverage,
    twoHundredDayAverage: quote.twoHundredDayAverage
  };
}

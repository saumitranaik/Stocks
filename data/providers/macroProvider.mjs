import { fetchQuote, trendLabel } from './yahooQuoteProvider.mjs';

// Seven macro indicators reachable through Yahoo Finance's public chart feed
// -- the only free, unauthenticated, machine-readable macro source this app
// has. `goldIndia` (2026-09-07, India Macro/US Macro split) reuses this exact
// mechanism for an India-specific reading: GOLDBEES.NS is a real, NSE-listed,
// physical-gold-backed ETF (Nippon India ETF Gold BeES), fetched via the same
// `.NS`-ticker/fetchQuote() path every equity price in this app already uses
// -- a genuine Sourced market price, not a converted/estimated figure. India
// Crude Oil and India Natural Gas were evaluated for the same brief: no
// NSE-listed ETF or other free, unauthenticated, machine-readable India-
// specific proxy exists for either (MCX futures require a paid/authenticated
// feed this app does not have) -- both are listed in
// UNAVAILABLE_MACRO_INDICATORS below rather than approximated from the
// existing USD-denominated WTI/Henry-Hub tickers under a misleading label.
// RBI policy repo rate, India G-Sec yield, PMI, power demand, ethanol
// policy, defence budget and banking liquidity were re-evaluated the same
// way (2026-09-08 feasibility audit, see docs/governance/roadmap.md's
// completed-work ledger for the full matrix): FRED's unauthenticated CSV
// endpoint (fredgraph.csv, no API key) is reachable and does carry
// India-tagged OECD series, but every candidate series found was either the
// wrong measure (a market-determined interbank rate, not the RBI's own
// policy repo rate) or badly stale (12-30+ months behind, discontinued in
// practice) -- both fail this app's own Live/Delayed data-quality bar.
// Official sources exist for every one of these seven (RBI itself, CCIL/
// FBIL, Grid-India/NPP, PIB, indiabudget.gov.in) but publish only HTML press
// pages or PDF/Excel reports, never a stable JSON API -- CCIL's own site
// additionally prohibits automated/commercial use of its data without
// written permission. PMI has no government source at all, free or paid --
// it is produced solely by S&P Global as a commercial product. All seven
// remain listed below as explicitly unavailable -- never estimated or
// substituted to fill the gap (same posture as system.md's TD-10 market-wide
// peer database: the blocker is data access, not engineering effort).
//
// CPI inflation and IIP are the one exception the 2026-09-08 audit found:
// MoSPI's official eSankhyiki API (api.mospi.gov.in) covers both. IIP is
// gated behind user signup + a 15-minute access token -- this app's first
// credentialed integration, built out in data/integrations/ (see that
// module's config.mjs for full source citations) after the user explicitly
// approved crossing the "no API keys" boundary. CPI turned out (same-day
// follow-on task, also 2026-09-08) to genuinely work unauthenticated --
// MoSPI's own manual documents "without access token the APIs will fetch
// only the first 10 records" as intentional platform behavior, not an
// error -- so CPI needs no credential at all; see
// data/integrations/mospiProvider.mjs's getCpiPublicSnapshot() and
// mospiClient.mjs's fetchCpiPublic(). Neither's live status is a fixed
// "Future Integration" entry here -- see data/watchlist/macro.mjs's
// buildMacroSnapshot(), which merges CPI directly into the main
// `indicators` array (public, always-on) and IIP into `configGated`
// (data/integrations/mospiProvider.mjs's per-dataset status: Live / Delayed
// / Credentials Required / Token Expired / Authentication Failed /
// Unavailable).
export const MACRO_INDICATORS = [
  { key: 'usdInr', ticker: 'INR=X', label: 'USD/INR', category: 'Currency', unit: '₹' },
  { key: 'usTreasury10y', ticker: '^TNX', label: 'US 10-Year Treasury yield', category: 'Rates', unit: '%' },
  { key: 'crudeOilWti', ticker: 'CL=F', label: 'Crude oil (WTI)', category: 'Commodity', unit: 'US$/bbl' },
  { key: 'naturalGas', ticker: 'NG=F', label: 'Natural gas (Henry Hub)', category: 'Commodity', unit: 'US$/MMBtu' },
  { key: 'gold', ticker: 'GC=F', label: 'Gold', category: 'Commodity', unit: 'US$/oz' },
  { key: 'goldIndia', ticker: 'GOLDBEES.NS', label: 'India Gold Rate (Gold BeES ETF, NSE)', category: 'Commodity', unit: '₹/unit' },
  { key: 'indiaVix', ticker: '^INDIAVIX', label: 'India VIX', category: 'Volatility', unit: 'pts' }
];

// Rendered with an explicit "Future Integration" status (never fabricated or
// estimated) -- see data/watchlist/macro.mjs's buildMacroSnapshot() and the
// Dashboard's Macro Intelligence sub-tab's Data Quality panel. CPI inflation
// and IIP moved out of this fixed list (2026-09-08) -- they now render a
// dynamic MoSPI-backed status instead; see this file's own top comment and
// data/integrations/mospiProvider.mjs.
export const UNAVAILABLE_MACRO_INDICATORS = [
  { key: 'rbiRepoRate', label: 'RBI policy repo rate', category: 'Rates' },
  { key: 'indiaGsec10y', label: 'India 10-Year G-Sec yield', category: 'Rates' },
  { key: 'pmi', label: 'Manufacturing / Services PMI', category: 'Growth' },
  { key: 'powerDemand', label: 'All-India power demand', category: 'Sector-specific' },
  { key: 'ethanolPolicy', label: 'Ethanol blending policy', category: 'Sector-specific' },
  { key: 'defenceBudget', label: 'Union defence budget', category: 'Sector-specific' },
  { key: 'bankingLiquidity', label: 'Banking system liquidity', category: 'Rates' },
  { key: 'crudeOilIndia', label: 'India Crude Oil (Indian Basket / MCX)', category: 'Commodity' },
  { key: 'naturalGasIndia', label: 'India Natural Gas (MCX)', category: 'Commodity' }
];

// IIP retains its category/label definition here (single source for both
// this module and mospiProvider.mjs's dataset labels), just outside the
// always-unavailable list above. CPI moved out of this credential-gated
// list (2026-09-08) -- see data/watchlist/macro.mjs's own `cpiInflation`
// definition, merged directly into the main, always-on indicator set.
export const MOSPI_MACRO_INDICATORS = [
  { key: 'iip', label: 'Index of Industrial Production', category: 'Growth' }
];

// Thin wrapper over the existing equity-quote fetch: fetchQuote() returns far
// more than a macro card needs (RSI/MACD meant for equities), so this narrows
// the response to the fields that make sense for an index/FX/commodity
// ticker. Zero new fetch mechanism -- same request()/chart-endpoint path every
// price fetch in this app already uses (see yahooQuoteProvider.mjs). The
// 20/50/100/200-DMA values and the Uptrend/Downtrend/Sideways trend label
// (Trend Parameters, 2026-09-07) are the exact same fields/classification
// fetchQuote()/trendLabel() already compute for every equity in this app from
// the real 1y daily-close history the chart endpoint returns -- reused
// verbatim here, not a second technical-analysis engine.
export async function fetchMacroQuote(ticker) {
  const quote = await fetchQuote(ticker);
  if (!quote) return null;
  return {
    price: quote.regularMarketPrice,
    changePct: quote.regularMarketChangePercent,
    oneYearChangePct: quote.oneYearReturnPct,
    twentyDayAverage: quote.twentyDayAverage,
    fiftyDayAverage: quote.fiftyDayAverage,
    hundredDayAverage: quote.hundredDayAverage,
    twoHundredDayAverage: quote.twoHundredDayAverage,
    trend: trendLabel(quote.regularMarketPrice, quote.fiftyDayAverage, quote.twoHundredDayAverage)
  };
}

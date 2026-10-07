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
// RBI policy repo rate, India G-Sec yield, PMI, power demand and banking
// liquidity were first evaluated in the 2026-09-08 feasibility audit (FRED's
// unauthenticated CSV endpoint, fredgraph.csv, is reachable and does carry
// India-tagged OECD series, but every candidate series found was either the
// wrong measure -- a market-determined interbank rate, not the RBI's own
// policy repo rate -- or badly stale, 12-30+ months behind and discontinued
// in practice) then independently re-verified with fresh live testing in a
// 2026-09-09 re-audit task that was explicitly instructed not to trust the
// prior conclusion as final -- see the detailed, source-by-source note above
// UNAVAILABLE_MACRO_INDICATORS below for exactly what was tested and found
// each source's own genuine blocker (registration/licensing requirements,
// no API at all, or -- for power demand -- a real documented API that is
// currently non-functional). Ethanol blending policy and Union defence
// budget were re-classified out of this unavailable set the same day, once
// a clear current officially-published figure was found for each -- see
// PERIODIC_MACRO_INDICATORS below.
//
// CPI inflation and IIP are the one exception the 2026-09-08 audit found:
// MoSPI's official eSankhyiki API (api.mospi.gov.in) covers both. This app's
// first credentialed integration (data/integrations/, built 2026-09-08 after
// the user explicitly approved crossing the "no API keys" boundary) was
// built assuming both needed a token -- but neither turned out to. CPI was
// re-verified the same day and found to work unauthenticated (MoSPI's own
// manual documents "without access token the APIs will fetch only the first
// 10 records" as intentional platform behavior, not an error). IIP was
// investigated completely independently on 2026-09-09 (explicitly not
// assumed to behave like CPI, since no dedicated IIP manual exists to cite)
// and live-tested to the exact same conclusion: real General IIP data with
// zero Authorization header, same fixed ~10-record anonymous slice, same
// TLS caveat and the same scoped workaround already approved for CPI. Both
// now need no credential at all; see data/integrations/mospiProvider.mjs's
// getCpiPublicSnapshot()/getIipPublicSnapshot() and mospiClient.mjs's
// fetchCpiPublic()/fetchIipPublic(). Neither renders a fixed "Future
// Integration" entry here -- see data/watchlist/macro.mjs's
// buildMacroSnapshot(), which merges both directly into the main
// `indicators` array (public, always-on, same Indicator/Category/Value/
// Change/1Y Change/Direction/Status/As of/Trend table every other India
// indicator uses). The credential-gated path (data/integrations/
// mospiProvider.mjs's CREDENTIALED_DATASETS) is now empty -- kept as live
// infrastructure for any future MoSPI dataset that turns out to genuinely
// need one, not deleted just because nothing populates it today.
// Commodity/currency presentation revision (2026-09-23): US Macro now shows
// the raw USD-denominated source prices for Gold/Crude Oil/Natural Gas
// (`usCommodities` group, unconverted); India Macro shows only the INR
// conversions of those same three fetched values, clearly marked derived,
// plus a new Currencies tab (12 currencies vs. INR, USD/INR reused as the
// one canonical FX input everywhere it's needed -- see CURRENCY_INDICATORS/
// CROSS_RATE_INDICATORS/usdToInr()/crossRateInr() below and
// data/watchlist/macro.mjs's toDerivedIndicator()). No new fetch mechanism;
// every new ticker is live-verified against the same Yahoo chart endpoint
// this file already uses.
export const MACRO_INDICATORS = [
  { key: 'usdInr', ticker: 'INR=X', label: 'USD/INR', category: 'Currency', unit: '₹', group: 'currencies' },
  { key: 'usTreasury10y', ticker: '^TNX', label: 'US 10-Year Treasury yield', category: 'Rates', unit: '%', group: 'usRates' },
  // Crude oil/natural gas/gold: USD-denominated source prices. Shown directly
  // (unconverted) under US Macro -> Commodities (`usCommodities` group); India
  // Macro -> Commodities shows only the derived INR conversions of these same
  // three fetched values (see toDerivedIndicator()/usdToInr() in
  // data/watchlist/macro.mjs) plus the separate, genuinely NSE-traded
  // goldIndia ETF price below -- never the raw USD figure a second time under
  // an India label (2026-09-23 commodity/currency presentation revision).
  { key: 'crudeOilWti', ticker: 'CL=F', label: 'Crude Oil (WTI)', category: 'Commodity', unit: 'US$/bbl', group: 'usCommodities' },
  { key: 'naturalGas', ticker: 'NG=F', label: 'Natural Gas (Henry Hub)', category: 'Commodity', unit: 'US$/MMBtu', group: 'usCommodities' },
  { key: 'gold', ticker: 'GC=F', label: 'Gold', category: 'Commodity', unit: 'US$/troy oz', group: 'usCommodities' },
  { key: 'goldIndia', ticker: 'GOLDBEES.NS', label: 'India Gold Rate (Gold BeES ETF, NSE)', category: 'Commodity', unit: '₹/unit', group: 'indiaCommodities' },
  { key: 'indiaVix', ticker: '^INDIAVIX', label: 'India VIX', category: 'Volatility', unit: 'pts', group: 'indiaIndices' }
];

// India Macro -> Currencies tab (2026-09-23 commodity/currency presentation
// revision): 1 unit of foreign currency = INR, for the 12 currencies most
// relevant to an Indian investor. USD/INR is NOT repeated here -- it already
// exists as the `usdInr` entry above (same ticker/cache key, reused rather
// than refetched, so there is exactly one canonical USD/INR value in this
// app) and is spliced back into `groups.currencies` at position 1 by
// data/watchlist/macro.mjs's buildMacroSnapshot(). Every ticker below is a
// direct "1 <CCY> = X INR" quote (Yahoo's `<CCY>INR=X` convention), live-
// verified against the chart endpoint before being wired in -- 11 of 12
// resolved directly; RUB did not (`RUBINR=X` returns HTTP 404 on Yahoo's
// chart endpoint, confirmed live) and is instead derived via a USD cross-rate
// -- see CROSS_RATE_INDICATORS and crossRateInr() below, never guessed or
// substituted with a stale/estimated figure.
export const CURRENCY_INDICATORS = [
  { key: 'gbpInr', ticker: 'GBPINR=X', label: 'British Pound (GBP)', code: 'GBP', category: 'Currency', unit: '₹' },
  { key: 'eurInr', ticker: 'EURINR=X', label: 'Euro (EUR)', code: 'EUR', category: 'Currency', unit: '₹' },
  { key: 'chfInr', ticker: 'CHFINR=X', label: 'Swiss Franc (CHF)', code: 'CHF', category: 'Currency', unit: '₹' },
  { key: 'audInr', ticker: 'AUDINR=X', label: 'Australian Dollar (AUD)', code: 'AUD', category: 'Currency', unit: '₹' },
  { key: 'cadInr', ticker: 'CADINR=X', label: 'Canadian Dollar (CAD)', code: 'CAD', category: 'Currency', unit: '₹' },
  { key: 'aedInr', ticker: 'AEDINR=X', label: 'UAE Dirham (AED)', code: 'AED', category: 'Currency', unit: '₹' },
  { key: 'cnyInr', ticker: 'CNYINR=X', label: 'Chinese Yuan (CNY)', code: 'CNY', category: 'Currency', unit: '₹' },
  { key: 'sgdInr', ticker: 'SGDINR=X', label: 'Singapore Dollar (SGD)', code: 'SGD', category: 'Currency', unit: '₹' },
  { key: 'thbInr', ticker: 'THBINR=X', label: 'Thai Baht (THB)', code: 'THB', category: 'Currency', unit: '₹' },
  // VND/INR is genuinely ~0.003 -- shown per 1,000 VND (displayScale below
  // multiplies the fetched price and its DMAs by 1,000 at read time, applied
  // identically to every field derived from the same series, never a
  // silently-changed denominator) rather than rounding to a meaningless 0.00.
  { key: 'vndInr', ticker: 'VNDINR=X', label: 'Vietnamese Dong (VND, per 1,000)', code: 'VND', category: 'Currency', unit: '₹ / 1,000 VND', displayScale: 1000 }
];

// RUB/INR has no direct Yahoo ticker (confirmed live, see CURRENCY_INDICATORS
// comment above). `usdRub` (1 USD = X RUB) is fetched the same way as every
// other indicator in this file purely as a cross-rate input -- it is never
// rendered as its own row anywhere in the UI, only consumed by
// crossRateInr(usdInr, usdRub) in data/watchlist/macro.mjs to derive RUB/INR.
export const CROSS_RATE_INDICATORS = [
  { key: 'usdRub', ticker: 'RUB=X', label: 'USD/RUB (cross-rate input, not displayed)', category: 'Currency', unit: '₽' }
];

// Indian Indices tab (Macro workspace, IA redesign): NIFTY/BANKNIFTY/MIDCAP/
// SENSEX, in that exact display order, reusing the identical fetchMacroQuote()
// mechanism as every other indicator in this file -- no new fetch path. Every
// ticker below was live-verified against Yahoo's chart endpoint before being
// added (never guessed): ^NSEI/^NSEBANK/^BSESN are the well-known Nifty 50/
// Bank Nifty/Sensex tickers; MIDCAP uses ^NSEMDCP50 (Nifty Midcap 50), the one
// candidate confirmed to actually resolve with a real quote (shortName "NIFTY
// MIDCAP 50") at implementation time -- ^NSEI is also the same ticker already
// read internally via benchmarkCache for market-regime classification below,
// now additionally rendered as its own indicator row here.
export const INDIA_INDEX_INDICATORS = [
  { key: 'nifty50', ticker: '^NSEI', label: 'NIFTY 50', category: 'Equity Index', unit: 'pts', group: 'indiaIndices' },
  { key: 'bankNifty', ticker: '^NSEBANK', label: 'BANKNIFTY', category: 'Equity Index', unit: 'pts', group: 'indiaIndices' },
  { key: 'niftyMidcap', ticker: '^NSEMDCP50', label: 'NIFTY MIDCAP 50', category: 'Equity Index', unit: 'pts', group: 'indiaIndices' },
  { key: 'sensex', ticker: '^BSESN', label: 'SENSEX', category: 'Equity Index', unit: 'pts', group: 'indiaIndices' }
];

// US Macro tab: major US equity benchmarks. Standard, high-confidence Yahoo
// tickers, live-verified before being added -- same fetchMacroQuote() path.
export const US_INDEX_INDICATORS = [
  { key: 'sp500', ticker: '^GSPC', label: 'S&P 500', category: 'Equity Index', unit: 'pts', group: 'usIndices' },
  { key: 'nasdaqComposite', ticker: '^IXIC', label: 'Nasdaq Composite', category: 'Equity Index', unit: 'pts', group: 'usIndices' },
  { key: 'dowJones', ticker: '^DJI', label: 'Dow Jones Industrial Average', category: 'Equity Index', unit: 'pts', group: 'usIndices' },
  { key: 'russell2000', ticker: '^RUT', label: 'Russell 2000', category: 'Equity Index', unit: 'pts', group: 'usIndices' }
];

// World tab: major global equity benchmarks grouped by geography (US indices
// live on the US Macro tab, not duplicated here). Shanghai Composite uses
// `000001.SS` -- the commonly-cited `^SSEC` ticker was live-tested and returns
// HTTP 404 on Yahoo's chart endpoint; `000001.SS` was confirmed live with a
// real quote (shortName "SSE Composite Index") before being added. Every
// other ticker below (Nikkei/Hang Seng/FTSE/DAX/CAC) is a standard,
// high-confidence Yahoo symbol, also live-verified at implementation time.
// `country` (added alongside the World Asia/Europe sticky-header fix,
// 2026-09-23, same-day follow-on): the home market each index actually
// represents -- a static, verifiable fact about the named index itself (same
// curation basis as `label`/`category` above, not a live-fetched field), so
// it carries no separate metricRegistry tier of its own, same as label/
// category/unit -- see metricRegistry.mjs's `macroIndicator` entry.
export const WORLD_INDEX_INDICATORS = [
  { key: 'nikkei225', ticker: '^N225', label: 'Nikkei 225', category: 'Equity Index', unit: 'pts', group: 'worldAsia', region: 'Asia', country: 'Japan' },
  { key: 'shanghaiComposite', ticker: '000001.SS', label: 'Shanghai Composite', category: 'Equity Index', unit: 'pts', group: 'worldAsia', region: 'Asia', country: 'China' },
  { key: 'hangSeng', ticker: '^HSI', label: 'Hang Seng', category: 'Equity Index', unit: 'pts', group: 'worldAsia', region: 'Asia', country: 'Hong Kong' },
  { key: 'ftse100', ticker: '^FTSE', label: 'FTSE 100', category: 'Equity Index', unit: 'pts', group: 'worldEurope', region: 'Europe', country: 'United Kingdom' },
  { key: 'dax', ticker: '^GDAXI', label: 'DAX', category: 'Equity Index', unit: 'pts', group: 'worldEurope', region: 'Europe', country: 'Germany' },
  { key: 'cac40', ticker: '^FCHI', label: 'CAC 40', category: 'Equity Index', unit: 'pts', group: 'worldEurope', region: 'Europe', country: 'France' }
];

// Rendered with an explicit unavailable status (never fabricated or
// estimated) -- see data/watchlist/macro.mjs's buildMacroSnapshot() and the
// Dashboard's Macro Intelligence sub-tab's Data Quality panel. CPI inflation
// and IIP moved out of this fixed list (2026-09-08) -- they now render a
// dynamic MoSPI-backed status instead; see this file's own top comment and
// data/integrations/mospiProvider.mjs. Ethanol blending policy and Union
// defence budget moved out (2026-09-09) -- see PERIODIC_MACRO_INDICATORS
// below; both are re-verified fresh evidence, not carried over from the
// original Phase 6 audit. All-India power demand moved OUT (2026-09-24) --
// see the dated note below and data/providers/nppProvider.mjs.
//
// 2026-09-09 re-verification task ("re-audit every deferred India Macro
// indicator, don't trust the prior audit as final"): each of the 7
// indicators then remaining was independently re-tested that session, not
// assumed still correct from the original Phase 6 conclusion --
//   - RBI policy repo rate: RBI's own homepage (rbi.org.in) renders it as
//     static HTML text sourced from FBIL, no JSON/API. RBI's Database on
//     Indian Economy (data.rbi.org.in/DBIE) is a browsable web UI with
//     Excel/CSV/PDF *manual* export, no programmatic endpoint found. A
//     third-party static mirror exists at dbie.rbihub.in but explicitly
//     self-describes as "a fast, fully static mirror... no server and no
//     database behind these pages" -- excluded as "unofficial data copied
//     from another website," not a genuine RBI source.
//   - India 10-Year G-Sec yield: FBIL (the RBI-authorised benchmark
//     administrator) requires ALL benchmark users -- including the 7-day
//     lagged tier -- to register an organization, submit a certified
//     turnover statement, and execute a signed Benchmark License Agreement
//     (FBIL's own published FAQ, fetched and read in full this session);
//     "unauthorized use... will be dealt with legally." Not a free
//     individual-developer signup, and not something this personal,
//     single-user local tool can complete. CCIL (the alternative source)
//     explicitly prohibits automated/commercial use of its data without
//     written permission (confirmed on ccilindia.com).
//   - Manufacturing / Services PMI: confirmed again -- S&P Global is the
//     sole producer, commercial-only, no free tier and no government
//     source exists for PMI at all.
//   - Banking system liquidity: RBI's Weekly Statistical Supplement
//     (wss.rbi.org.in) and DBIE were fetched directly this session -- HTML/
//     PDF tables only, no CSV export link or API found.
//   - All-India power demand: CEA (Central Electricity Authority) publishes
//     a genuinely public, unauthenticated, documented API
//     (cea.nic.in/api/psp_peak.php, psp_energy.php) -- a real finding, not
//     in the original audit. Live-tested 5 times this session: one request
//     returned HTTP 200 with body "Connection failed: Connection timed
//     out"; four retries timed out with zero bytes received. The documented
//     endpoint exists but returns no real data today, failing this app's
//     "real meaningful data, not just HTTP 200" bar -- kept Deferred rather
//     than wired up against a currently non-functional backend. Grid-
//     India/POSOCO's own PSP reports are PDF-only; NPP's NPDMS API is
//     restricted to registered government organizations (NITI Aayog,
//     Railways, NTPC), not self-serve. (Superseded 2026-09-24 by a
//     *different* NPP mechanism -- see below.)
//   - India Crude Oil / India Natural Gas: PPAC (Ministry of Petroleum &
//     Natural Gas) publishes the Indian Basket crude price only as a daily
//     PDF press release; the one historical XLS download link found
//     returned 404, and full historical data requires registration. No
//     CSV/JSON found for either. The existing WTI/Henry Hub tickers stay
//     correctly labeled as international benchmarks, not substituted as
//     Indian domestic prices.
//
// 2026-09-24 audit ("implement the remaining India Macro Future-Integration
// indicators from their authoritative non-MoSPI sources" task): every
// indicator below was freshly re-tested live this session (direct HTTP
// checks against RBI/FBIL/CCIL/PPAC/MCX, not assumed from the 2026-09-09
// conclusion), PMI and India Crude Oil/Natural Gas were split into their
// distinct underlying instruments per the task's own explicit instruction,
// and every remaining entry now carries its own `source`/`sourceUrl`/
// `statusNote` fields (previously undisclosed) so the UI's Source column
// names the actual authoritative provider even for an unavailable row. Per
// the user's explicit, standing instruction this same session: data.gov.in
// (India's Open Government Data platform) was identified as a *possible*
// future source for some of these (it requires a free, self-serve API key)
// but was deliberately NOT investigated further or implemented -- CLAUDE.md
// requires the same explicit sign-off any new credentialed integration got
// for MoSPI, which was not sought this session. See docs/governance/
// roadmap.md's dated 2026-09-24 entry for the full per-indicator write-up.
//   - All-India power demand is the one indicator that moved OUT of this
//     list: National Power Portal (npp.gov.in) serves a real, public,
//     unauthenticated JSON endpoint backing its own live dashboard -- a
//     different mechanism from the CEA/Grid-India/NPDMS paths the
//     2026-09-09 audit tested and rejected, live-verified this session with
//     real current data. See data/providers/nppProvider.mjs for the full
//     finding and data/watchlist/macro.mjs's loadPowerDemandIndicator().
//   - RBI policy repo rate: re-confirmed live -- rbi.org.in's own homepage
//     still renders the rate only as a static HTML table (5.25% at check
//     time), no JSON/CSV/API. This app does not scrape rendered HTML pages
//     even from an official source (this task's own explicit instruction,
//     matching CLAUDE.md's existing architecture -- every other indicator
//     in this app comes from a real structured feed, never a parsed page).
//   - India 10-Year G-Sec yield: re-confirmed live -- FBIL's site is now a
//     JS-rendered SPA shell requiring the same license agreement as before;
//     CCIL's site returned HTTP 403 to an unauthenticated automated
//     request, consistent with its documented ToS restriction.
//   - Manufacturing PMI / Services PMI (split from the former single `pmi`
//     entry): re-confirmed live -- S&P Global remains the sole, commercial-
//     only producer of both; no free tier or government alternative found
//     for either.
//   - Banking system liquidity: re-confirmed live -- RBI's WSS/DBIE remain
//     portal/manual-export only, no CSV/API found. The intended concept is
//     Net LAF (system) liquidity, not a market-quoted rate.
//   - India Crude Oil (Indian Basket) (split from the former combined
//     `crudeOilIndia` entry): re-confirmed live -- PPAC's price page is
//     populated client-side by JavaScript (absent from the raw HTML
//     response) and its report-download links are JS-triggered actions, not
//     stable file URLs.
//   - India Crude Oil (MCX) / India Natural Gas (MCX): re-confirmed live --
//     mcxindia.com blocks unauthenticated automated requests (HTTP 403);
//     live/delayed MCX data is distributed only through MCX-authorized paid
//     data vendors this app does not subscribe to.
export const UNAVAILABLE_MACRO_INDICATORS = [
  {
    key: 'rbiRepoRate', label: 'RBI Policy Repo Rate', category: 'Rates', status: 'Not Programmatically Available',
    sourceLabel: 'RBI', source: 'Reserve Bank of India -- the Policy Repo Rate is published on rbi.org.in\'s own homepage ("Current Rates" widget) and DBIE (data.rbi.org.in/DBIE), both static HTML/browsable-UI pages, never a JSON/CSV/REST feed. Re-confirmed live 2026-09-24 (5.25% rendered as a plain HTML table, no API call behind it).',
    sourceUrl: 'https://www.rbi.org.in/',
    statusNote: 'No stable API/feed exists, only a browsable HTML page -- this app does not scrape rendered web pages even from an official source, to avoid a fragile dependency that breaks silently on any page redesign.'
  },
  {
    key: 'indiaGsec10y', label: 'India 10-Year G-Sec Yield', category: 'Rates', status: 'Licensing Required',
    sourceLabel: 'FBIL / CCIL', source: 'Financial Benchmarks India Ltd (FBIL), the RBI-authorised administrator of the 10-Year G-Sec par yield benchmark -- FBIL\'s own published FAQ requires every user, including the 7-day-lagged tier, to register an organization, submit a certified turnover statement and execute a signed Benchmark License Agreement. CCIL (the alternative venue) explicitly prohibits automated/commercial use of its published data without written permission and returns HTTP 403 to unauthenticated automated requests (both re-confirmed live 2026-09-24).',
    sourceUrl: 'https://www.fbil.org.in/',
    statusNote: 'A signed license agreement (FBIL) or written permission (CCIL) is required for automated use -- this app has neither and does not implement it without that authorization.'
  },
  {
    key: 'pmiManufacturing', label: 'Manufacturing PMI', category: 'Growth', status: 'Licensing Required',
    sourceLabel: 'S&P Global', source: 'S&P Global -- the sole producer of the India Manufacturing PMI (formerly IHS Markit). No government source exists for PMI at all; S&P Global\'s own PMI data/API product is commercial-only with no free tier (re-confirmed 2026-09-24).',
    sourceUrl: 'https://www.pmi.spglobal.com/',
    statusNote: 'Commercial product, no free/public API -- would require a paid S&P Global data license.'
  },
  {
    key: 'pmiServices', label: 'Services PMI', category: 'Growth', status: 'Licensing Required',
    sourceLabel: 'S&P Global', source: 'S&P Global -- the sole producer of the India Services PMI (formerly IHS Markit). Same commercial-only position as Manufacturing PMI above (re-confirmed 2026-09-24).',
    sourceUrl: 'https://www.pmi.spglobal.com/',
    statusNote: 'Commercial product, no free/public API -- would require a paid S&P Global data license.'
  },
  {
    key: 'bankingLiquidity', label: 'Banking System Liquidity', category: 'Rates', status: 'Not Programmatically Available',
    sourceLabel: 'RBI', source: 'Reserve Bank of India -- system (Net LAF) liquidity is published in RBI\'s Weekly Statistical Supplement (wss.rbi.org.in) and DBIE (data.rbi.org.in/DBIE), both portal/manual-export only. Re-confirmed live 2026-09-24: neither exposes a CSV export link or a documented API.',
    sourceUrl: 'https://wss.rbi.org.in/',
    statusNote: 'No stable API/feed exists, portal/manual-export only. The intended concept is Net LAF (system) liquidity, not a single market-quoted rate.'
  },
  {
    key: 'crudeOilIndianBasket', label: 'India Crude Oil (Indian Basket)', category: 'Commodity', status: 'Not Programmatically Available',
    sourceLabel: 'PPAC', source: 'Petroleum Planning & Analysis Cell (PPAC), Ministry of Petroleum & Natural Gas -- publishes the daily Indian Basket crude oil price ($/bbl) at ppac.gov.in/prices/international-prices-of-crude-oil. Re-confirmed live 2026-09-24: the page\'s price table is populated client-side by JavaScript (absent from the raw HTML response) and its "Download Historical/Current Report" links are JavaScript-triggered actions, not stable direct file URLs -- no CSV/JSON endpoint found.',
    sourceUrl: 'https://ppac.gov.in/prices/international-prices-of-crude-oil',
    statusNote: 'PPAC\'s own price page requires JavaScript execution to populate and offers no stable downloadable file URL -- not reachable by this app\'s plain-HTTP fetch mechanism (no browser automation).'
  },
  {
    key: 'crudeOilMcx', label: 'India Crude Oil (MCX)', category: 'Commodity', status: 'Licensing Required',
    sourceLabel: 'MCX', source: 'Multi Commodity Exchange of India (MCX) -- Crude Oil futures settlement/market data. MCX\'s own bhavcopy/market-data pages block unauthenticated automated requests (HTTP 403, re-confirmed live 2026-09-24); live/delayed MCX data is distributed only through MCX-authorized market-data vendors (e.g. TrueData, APIdatafeed), which require a paid subscription or brokerage relationship.',
    sourceUrl: 'https://www.mcxindia.com/',
    statusNote: 'Requires an MCX-authorized paid data-vendor subscription -- this app has none. Never substituted with WTI/Brent/Indian Basket under an MCX label.'
  },
  {
    key: 'naturalGasMcx', label: 'India Natural Gas (MCX)', category: 'Commodity', status: 'Licensing Required',
    sourceLabel: 'MCX', source: 'Multi Commodity Exchange of India (MCX) -- Natural Gas futures settlement/market data. Same access position as MCX Crude Oil above: MCX blocks unauthenticated automated access, and live/delayed data requires an MCX-authorized paid vendor.',
    sourceUrl: 'https://www.mcxindia.com/',
    statusNote: 'Requires an MCX-authorized paid data-vendor subscription -- this app has none. Never substituted with Henry Hub under an MCX label.'
  }
];

// Periodic / Policy indicators (2026-09-09 re-verification task): neither
// has a live API, but both have a clear, current, officially-published
// figure -- shown as a dated one-time reading (data/watchlist/macro.mjs's
// buildMacroSnapshot() merges these into a `periodic` array, status
// "Periodic"), never presented as a continuously-updating market price and
// never given a DMA/trend/daily-change (an annual/event-cadence figure has
// no daily series to compute one from). Each `value`/`period`/`asOfDate`
// here must be manually refreshed at the next official publication (next
// Union Budget for defenceBudget; next PIB ethanol-blending update for
// ethanolBlending) -- there is no automated refresh path for either.
export const PERIODIC_MACRO_INDICATORS = [
  {
    key: 'defenceBudget',
    label: 'Union Defence Budget (total allocation)',
    category: 'Sector-specific',
    value: 784678,
    unit: '₹ crore',
    period: 'FY 2026-27 (Budget Estimates)',
    asOfDate: '2026-02-01',
    sourceLabel: 'Union Budget 2026-27 (Ministry of Finance)',
    source: 'Union Budget 2026-27, Ministry of Finance (Demand for Grants, Ministry of Defence) — figure cross-checked against PRS Legislative Research\'s "Demand for Grants 2026-27 Analysis: Defence"',
    sourceUrl: 'https://prsindia.org/budgets/parliament/demand-for-grants-2026-27-analysis-defence'
  },
  {
    key: 'ethanolBlending',
    label: 'Ethanol Blending Rate (petrol)',
    category: 'Sector-specific',
    value: 20,
    unit: '%',
    period: 'ESY 2025-26',
    asOfDate: '2026-07-05',
    sourceLabel: 'PIB (Ministry of Petroleum & Natural Gas)',
    source: 'Press Information Bureau, Ministry of Petroleum & Natural Gas — "Ethanol Blending in India: Policy Evolution, Key Milestones and Frequently Raised Concerns"',
    sourceUrl: 'https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/jul/doc202675912001.pdf'
  }
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

// Gold ₹/10g (Macro IA redesign): a pure unit-conversion of two already-
// fetched Yahoo tickers (gold USD/troy-oz + USD/INR), NOT an independently
// sourced Indian gold price -- India Gold Rate (goldIndia/GOLDBEES.NS above)
// remains the one genuine NSE-traded proxy. 1 troy ounce = 31.1034768 grams
// (the standard, undisputed conversion factor -- not rounded here, only at
// display time, per this app's "don't round intermediate values" convention).
// Returns null (never a fabricated number) if either input isn't a real,
// finite quote -- e.g. one leg's fetch failed/is Unavailable.
const TROY_OUNCE_GRAMS = 31.1034768;
export function goldInrPer10g(goldUsdPerOz, usdInr) {
  if (!Number.isFinite(goldUsdPerOz) || !Number.isFinite(usdInr)) return null;
  return goldUsdPerOz * usdInr * (10 / TROY_OUNCE_GRAMS);
}

// Crude Oil ₹/bbl and Natural Gas ₹/MMBtu (2026-09-23 commodity/currency
// presentation revision): the same "pure unit conversion of two already-
// fetched Yahoo tickers, not an independently sourced Indian price" pattern
// as goldInrPer10g above, minus the troy-ounce-to-gram step (crude/gas need
// no unit-of-measure conversion, only currency conversion). Returns null
// (never a fabricated number) if either input isn't a real, finite quote.
export function usdToInr(usdValue, usdInr) {
  if (!Number.isFinite(usdValue) || !Number.isFinite(usdInr)) return null;
  return usdValue * usdInr;
}

// RUB/INR cross-rate (2026-09-23, same task): RUB has no direct Yahoo
// `RUBINR=X` ticker (confirmed live, HTTP 404). Derived instead from two
// already-fetched USD legs: usdInr (1 USD = X INR) and usdRub (1 USD = Y
// RUB) give 1 RUB = usdInr/usdRub INR. Returns null (never fabricated) if
// either leg isn't a real, finite, non-zero quote.
export function crossRateInr(usdInr, usdForeign) {
  if (!Number.isFinite(usdInr) || !Number.isFinite(usdForeign) || usdForeign === 0) return null;
  return usdInr / usdForeign;
}

import { MACRO_INDICATORS, UNAVAILABLE_MACRO_INDICATORS, PERIODIC_MACRO_INDICATORS, INDIA_INDEX_INDICATORS, US_INDEX_INDICATORS, WORLD_INDEX_INDICATORS, CURRENCY_INDICATORS, CROSS_RATE_INDICATORS, goldInrPer10g, usdToInr, crossRateInr } from '../providers/macroProvider.mjs';
import { getCachedMacroQuote } from '../providers/index.mjs';
import { trendLabel } from '../providers/yahooQuoteProvider.mjs';
import { macroCache, benchmarkCache } from './diskCache.mjs';
import { number } from '../util.mjs';
import { MARKET_REGIME } from '../decision/config.mjs';
import { classifyMarketRegime } from '../decision/marketRegime.mjs';
import { getCpiPublicSnapshot, getIipPublicSnapshot } from '../integrations/mospiProvider.mjs';
import { getPowerDemandSnapshot, NPP_DASHBOARD_URL } from '../providers/nppProvider.mjs';

// Independent of any watchlist's own refresh cycle -- see diskCache.mjs's
// macroCache. Deliberately coarser than the 2min in-memory de-dupe layer in
// data/providers/index.mjs: macro series move slowly, so there is no benefit
// to re-fetching on every dashboard load the way a per-company quote would.
const TTL_MS = Number(process.env.MACRO_CACHE_TTL_MS) || 30 * 60 * 1000;

function directionFrom(changePct) {
  if (!Number.isFinite(changePct)) return 'N/A';
  if (changePct > MARKET_REGIME.directionChangePctThreshold) return 'Rising';
  if (changePct < -MARKET_REGIME.directionChangePctThreshold) return 'Falling';
  return 'Flat';
}

// Trend Parameters (2026-09-07): dma20/50/100/200 and trend are read straight
// off fetchMacroQuote()'s already-computed fields -- same real 1y daily-close
// history every equity DMA in this app is calculated from (yahooQuoteProvider
// .mjs's fetchQuote()), no second calculation path. A period stays null
// (renders blank, never fabricated) until fetchQuote() itself has enough
// trading days for that average -- same "N/A until enough history exists"
// rule the equity Trend table already follows.
// `displayScale` (VND/INR only, 2026-09-23): multiplies the fetched price and
// every DMA by the same factor before rounding, so a genuinely tiny per-unit
// rate (~0.0037) displays as a meaningful "per 1,000" figure instead of
// rounding to 0.00 -- never a silently-changed denominator, the unit label
// (`def.unit`) always discloses the scale applied.
const scaled = (value, scale) => Number.isFinite(value) ? value * scale : value;
function toIndicator(def, bundle, status) {
  const quote = bundle?.quote;
  const scale = def.displayScale || 1;
  return {
    key: def.key, label: def.label, category: def.category, unit: def.unit, country: def.country, status,
    value: number(scaled(quote?.price, scale), 4), changePct: number(quote?.changePct), oneYearChangePct: number(quote?.oneYearChangePct),
    direction: directionFrom(quote?.changePct), asOf: bundle?.fetchedAt ?? null,
    trend: quote?.trend || 'N/A',
    dma20: number(scaled(quote?.twentyDayAverage, scale), 4), dma50: number(scaled(quote?.fiftyDayAverage, scale), 4),
    dma100: number(scaled(quote?.hundredDayAverage, scale), 4), dma200: number(scaled(quote?.twoHundredDayAverage, scale), 4)
  };
}

// Periodic/Policy indicators (2026-09-09 re-verification task): a pure,
// zero-I/O mapping over macroProvider.mjs's static PERIODIC_MACRO_INDICATORS
// -- no fetch, no cache, since the value itself is a manually-curated,
// dated reading (the next Union Budget / next PIB ethanol update), not
// something re-fetched on a schedule. Deliberately carries no changePct/
// trend/DMA fields at all (not even null placeholders matching
// toIndicator()'s shape) so the India Macro table's periodic-indicators
// rendering can't accidentally be pointed at the market-indicator row
// template and imply a daily price series that doesn't exist for an
// annual/event-cadence figure.
export function toPeriodicIndicator(def) {
  return {
    key: def.key, label: def.label, category: def.category, status: 'Periodic',
    value: def.value, unit: def.unit, period: def.period, asOfDate: def.asOfDate,
    sourceLabel: def.sourceLabel, source: def.source, sourceUrl: def.sourceUrl
  };
}

// Cache-first, background-refresh-if-stale -- same "read cache, fetch only
// when actually stale, fall back to a stale cache entry on a failed fetch
// rather than blanking a card that had real data a moment ago" shape as
// research.mjs's loadBenchmarkQuote(), just on the macro namespace's own TTL
// instead of a watchlist's networkPass.
async function loadIndicator(def) {
  const cached = await macroCache.read(def.key);
  if (cached && !macroCache.isStale(cached, TTL_MS)) return toIndicator(def, cached, 'Live');
  try {
    const quote = await getCachedMacroQuote(def.ticker);
    if (!quote) throw new Error('No data returned');
    const bundle = { key: def.key, ticker: def.ticker, fetchedAt: new Date().toISOString(), quote };
    await macroCache.write(def.key, bundle);
    return toIndicator(def, bundle, 'Live');
  } catch {
    if (cached) return toIndicator(def, cached, 'Delayed');
    return toIndicator(def, null, 'Unavailable');
  }
}

// CPI Inflation (2026-09-08 CPI-without-credentials task): public,
// unauthenticated (data/integrations/mospiProvider.mjs's
// getCpiPublicSnapshot() -- never reads a credential, works with zero MoSPI
// account configured), so it is merged directly into the main `indicators`
// array below rather than `configGated` -- per the task's own explicit
// requirement, it appears "alongside the other India indicators" with the
// same Indicator/Category/Value/Change/1Y Change/Direction/Status/As of/
// Trend presentation model (toIndicator()'s shape above), not the separate
// credential-gated table IIP still uses.
//
// Two fields are honestly left blank rather than fabricated: `changePct`
// (no second data point is retrievable from the unauthenticated response --
// see mospiProvider.mjs's own top comment on why filters/date-selection
// don't work without a token) and `trend`/DMA (a single period-over-period
// reading has no daily price series to compute a moving average from, same
// disclosed limitation IIP already carries). `oneYearChangePct` is instead
// MoSPI's own directly-supplied Year-on-Year `inflation` field --
// exactly the "Year-on-Year CPI Inflation" this feature asked for, read
// as-is rather than recomputed (see findCpiRecord()'s own comment on why:
// this app cannot independently reconstruct a 12-months-prior data point
// from an unauthenticated, filter-less response).
async function loadCpiIndicator() {
  const snapshot = await getCpiPublicSnapshot();
  const oneYearChangePct = number(snapshot.inflationYoY, 2);
  return {
    key: 'cpiInflation', label: 'CPI Inflation (Consumer Food Price Index)', category: 'Inflation', unit: 'Index',
    status: snapshot.status,
    value: number(snapshot.index, 2), changePct: null, oneYearChangePct,
    direction: directionFrom(oneYearChangePct), asOf: snapshot.fetchedAt ?? null,
    trend: 'N/A', dma20: null, dma50: null, dma100: null, dma200: null,
    period: snapshot.period ?? null, sector: snapshot.sector ?? null, seriesLabel: snapshot.seriesLabel ?? null,
    sourceLabel: 'MoSPI', source: 'MoSPI eSankhyiki API (public, unauthenticated) — Consumer Food Price Index', sourceUrl: 'https://api.mospi.gov.in'
  };
}

// IIP (2026-09-09 independent investigation): same public/unauthenticated,
// no-daily-series treatment as CPI above, arrived at independently (see
// data/integrations/mospiProvider.mjs's PUBLIC_DATASETS comment and
// docs/authoritative/system.md §3.10 for the live-tested basis) -- not
// copied from the CPI conclusion without separately verifying IIP's own
// endpoint. `oneYearChangePct` is MoSPI's own directly-supplied Year-on-Year
// `growth_rate` field for the General/Overall IIP series (standard IIP
// press-release convention), used as-is rather than recomputed, for the
// same reason CPI's inflationYoY is: this app cannot independently
// reconstruct a 12-months-prior data point from a filter-less,
// unauthenticated response. `changePct`/`trend`/DMA stay blank, not
// fabricated -- IIP is a monthly reporting-period index, not a daily-priced
// instrument, so a daily moving average would be a meaningless, invented
// figure (per this task's own explicit instruction not to fake DMA values
// for a monthly series).
async function loadIipIndicator() {
  const snapshot = await getIipPublicSnapshot();
  const oneYearChangePct = number(snapshot.growthYoY, 2);
  return {
    key: 'iip', label: 'Index of Industrial Production (IIP)', category: 'Growth', unit: 'Index',
    status: snapshot.status,
    value: number(snapshot.index, 2), changePct: null, oneYearChangePct,
    direction: directionFrom(oneYearChangePct), asOf: snapshot.fetchedAt ?? null,
    trend: 'N/A', dma20: null, dma50: null, dma100: null, dma200: null,
    period: snapshot.period ?? null, baseYear: snapshot.baseYear ?? null, seriesLabel: snapshot.seriesLabel ?? null,
    sourceLabel: 'MoSPI', source: 'MoSPI eSankhyiki API (public, unauthenticated) — General Index of Industrial Production', sourceUrl: 'https://api.mospi.gov.in'
  };
}

// All-India Power Demand (2026-09-24 Future Integration audit, non-MoSPI
// sources task): the one indicator promoted out of UNAVAILABLE_MACRO_
// INDICATORS this task -- see data/providers/nppProvider.mjs's own top
// comment for the National Power Portal finding. Shares CPI/IIP's exact
// pattern (public, unauthenticated, merged directly into the main
// `indicators` array below, not a separate credential-gated table): `source`/
// `sourceUrl` are carried through explicitly (unlike CPI/IIP, which predate
// the Source-column requirement) so the India Macro -> Macro Indicators
// table's Source column names NPP for this row same as every other. No
// changePct/trend/DMA -- a ~4-minute intraday demand reading has no
// established daily-close series in this app to compute a moving average
// from (same disclosed limitation as CPI/IIP's monthly index).
async function loadPowerDemandIndicator() {
  const snapshot = await getPowerDemandSnapshot();
  return {
    key: 'powerDemand', label: 'All-India Power Demand (Demand Met)', category: 'Sector-specific', unit: snapshot.unit || 'MW',
    status: snapshot.status,
    value: number(snapshot.value, 0), changePct: null, oneYearChangePct: null,
    direction: 'N/A', asOf: snapshot.observedAt ?? null,
    trend: 'N/A', dma20: null, dma50: null, dma100: null, dma200: null,
    sourceLabel: 'NPP', source: 'National Power Portal (NPP), Ministry of Power', sourceUrl: NPP_DASHBOARD_URL
  };
}

// Generalized derived-indicator builder (2026-09-23 commodity/currency
// presentation revision): every "not directly fetched, computed from 2 real
// already-fetched indicators" row in this app -- India Gold Rate ₹/10g,
// Crude Oil (WTI) ₹/bbl, Natural Gas (Henry Hub) ₹/MMBtu, RUB/INR (via a USD
// cross-rate) -- shares the identical `toIndicator()`-shaped row so all four
// render through the exact same indicatorRow()/table machinery as every
// fetched indicator, `calculated: true` mapping to the existing fetched-vs-
// derived `.derived` styling (never a semantic color, never a duplicate
// calculation path). Status/asOf are derived honestly from the real inputs
// passed in: Live only if every input resolved Live this cycle, Unavailable
// (value left null, never fabricated) if any input never resolved at all or
// the computed value itself is non-finite, Delayed otherwise. Replaces the
// narrower, gold-only toDerivedGoldIndicator() this function supersedes.
function toDerivedIndicator({ key, label, category, unit }, inputs, value, decimals = 2) {
  const anyUnavailable = inputs.some(i => i?.status === 'Unavailable') || value == null;
  const allLive = inputs.every(i => i?.status === 'Live');
  const status = anyUnavailable ? 'Unavailable' : (allLive ? 'Live' : 'Delayed');
  const asOf = inputs.map(i => i?.asOf).filter(Boolean).sort().at(-1) ?? null;
  return {
    key, label, category, unit, status,
    value: number(value, decimals), changePct: null, oneYearChangePct: null,
    direction: 'N/A', asOf, trend: 'N/A', dma20: null, dma50: null, dma100: null, dma200: null,
    calculated: true
  };
}

// Builds the watchlist-independent macro snapshot: the original 7 market
// indicators + CPI + IIP + All-India Power Demand (all three public/
// unauthenticated readings -- CPI/IIP from MoSPI, Power Demand from NPP --
// merged directly into `indicators`; see loadCpiIndicator()/
// loadIipIndicator()/loadPowerDemandIndicator() above), plus (Macro IA
// redesign) Indian Indices (NIFTY/BANKNIFTY/MIDCAP/SENSEX), US major
// indices, World indices (Asia/Europe), 2 Periodic/Policy indicators (Union
// defence budget, ethanol blending rate -- dated one-time readings, not
// fetched -- see toPeriodicIndicator() above), the disclosed list of
// indicators with no legitimate programmatic source (each carrying its own
// source/statusNote, 2026-09-24), a Data Quality rollup (Live/Delayed/
// Unavailable/Periodic/Future Integration counts, covering every fetched row
// including the new ones), and a market regime read.
//
// Commodity/currency presentation revision (2026-09-23): India Macro's
// Commodities table now shows only derived INR figures (Gold ₹/10g, Crude
// Oil (WTI) ₹/bbl, Natural Gas (Henry Hub) ₹/MMBtu, plus the pre-existing
// genuinely NSE-traded India Gold Rate ETF) -- the raw USD-denominated Gold/
// Crude/Natural Gas prices moved to a new US Macro -> Commodities group
// instead of appearing under an India label a second time (see
// macroProvider.mjs's MACRO_INDICATORS comment). A new India Macro ->
// Currencies group holds 12 currencies vs. INR (USD/INR reused by reference,
// never refetched, as the one canonical FX input every India-commodity
// derivation above also uses -- CLAUDE.md's "no duplicate calculations"
// applied to a shared upstream fetch, not just a shared formula).
//
// `indicators` keeps its original flat shape/contract (every row, any
// source) unchanged -- classifyMarketRegime() below, committeePack.mjs's
// macroChanges(), and script.js's renderMorningBriefing()/Data Quality cards
// all read it directly and must keep working unchanged; the new currency and
// derived-commodity rows are appended to it too, same precedent as every
// prior group addition here. `groups` is a purely additive bucketing of the
// SAME row objects (by reference) for the Macro workspace's per-page tables
// to read directly.
export async function buildMacroSnapshot() {
  const [marketIndicators, indiaIndexIndicators, usIndexIndicators, worldIndexIndicators, currencyIndicators, crossRateIndicators, cpiIndicator, iipIndicator, powerDemandIndicator] = await Promise.all([
    Promise.all(MACRO_INDICATORS.map(loadIndicator)),
    Promise.all(INDIA_INDEX_INDICATORS.map(loadIndicator)),
    Promise.all(US_INDEX_INDICATORS.map(loadIndicator)),
    Promise.all(WORLD_INDEX_INDICATORS.map(loadIndicator)),
    Promise.all(CURRENCY_INDICATORS.map(loadIndicator)),
    Promise.all(CROSS_RATE_INDICATORS.map(loadIndicator)),
    loadCpiIndicator(),
    loadIipIndicator(),
    loadPowerDemandIndicator()
  ]);
  const byKeyPre = Object.fromEntries(marketIndicators.map(i => [i.key, i]));
  const byKeyCurrency = Object.fromEntries(currencyIndicators.map(i => [i.key, i]));
  const byKeyCrossRate = Object.fromEntries(crossRateIndicators.map(i => [i.key, i]));

  const goldInrIndicator = toDerivedIndicator(
    { key: 'goldInrPer10g', label: 'Gold (derived, ₹/10g)', category: 'Commodity', unit: '₹/10g' },
    [byKeyPre.gold, byKeyPre.usdInr], goldInrPer10g(byKeyPre.gold?.value, byKeyPre.usdInr?.value));
  const crudeOilInrIndicator = toDerivedIndicator(
    { key: 'crudeOilInrPerBbl', label: 'Crude Oil (WTI) (derived, ₹/bbl)', category: 'Commodity', unit: '₹/bbl' },
    [byKeyPre.crudeOilWti, byKeyPre.usdInr], usdToInr(byKeyPre.crudeOilWti?.value, byKeyPre.usdInr?.value));
  const naturalGasInrIndicator = toDerivedIndicator(
    { key: 'naturalGasInrPerMmbtu', label: 'Natural Gas (Henry Hub) (derived, ₹/MMBtu)', category: 'Commodity', unit: '₹/MMBtu' },
    [byKeyPre.naturalGas, byKeyPre.usdInr], usdToInr(byKeyPre.naturalGas?.value, byKeyPre.usdInr?.value));
  const rubInrIndicator = toDerivedIndicator(
    { key: 'rubInr', label: 'Russian Ruble (RUB, derived via USD cross-rate)', category: 'Currency', unit: '₹' },
    [byKeyPre.usdInr, byKeyCrossRate.usdRub], crossRateInr(byKeyPre.usdInr?.value, byKeyCrossRate.usdRub?.value), 4);

  const indicators = [
    ...marketIndicators, ...indiaIndexIndicators, ...usIndexIndicators, ...worldIndexIndicators, ...currencyIndicators,
    cpiIndicator, iipIndicator, powerDemandIndicator, goldInrIndicator, crudeOilInrIndicator, naturalGasInrIndicator, rubInrIndicator
  ];
  // Each def already carries its own status/source/sourceUrl/statusNote
  // (macroProvider.mjs's UNAVAILABLE_MACRO_INDICATORS, 2026-09-24 audit) --
  // spread through as-is rather than overwritten with one generic status, so
  // the Periodic/Policy table's Source column and status badge can disclose
  // the real authoritative provider and access-limitation reason per row.
  const unavailable = UNAVAILABLE_MACRO_INDICATORS.map(def => ({ ...def, value: null, changePct: null, oneYearChangePct: null, direction: 'N/A', asOf: null }));
  const periodic = PERIODIC_MACRO_INDICATORS.map(toPeriodicIndicator);
  const byKey = Object.fromEntries(indicators.map(i => [i.key, i]));

  const groups = {
    // Exact required order: NIFTY, BANKNIFTY, MIDCAP, SENSEX, India VIX.
    // India VIX itself is still fetched via the original MACRO_INDICATORS
    // array (unchanged ticker/key), so it's pulled in here by key rather
    // than moved, to avoid touching its existing cache entry/key.
    indiaIndices: [...indiaIndexIndicators, byKey.indiaVix].filter(Boolean),
    // India Macro -> Commodities (revised 2026-09-23): derived INR figures
    // only, plus the pre-existing India Gold Rate ETF (a genuine NSE market
    // price, unrelated to the derivations, clearly distinguished from them
    // by carrying no `calculated` flag) -- the raw USD Gold/Crude/Natural Gas
    // prices moved to `usCommodities` below, not duplicated here.
    indiaCommodities: [goldInrIndicator, crudeOilInrIndicator, naturalGasInrIndicator, byKey.goldIndia].filter(Boolean),
    indiaMacroIndicators: [cpiIndicator, iipIndicator, powerDemandIndicator],
    // India Macro -> Currencies (new 2026-09-23): 1 unit of foreign currency
    // = INR, in the exact required order. USD/INR is the same fetched object
    // already used above for every India-commodity derivation -- spliced in
    // by reference, never refetched, so there is exactly one canonical
    // USD/INR value across this entire snapshot. RUB is the one derived
    // (cross-rate) row; every other currency is a direct fetched quote.
    currencies: [
      byKey.usdInr, byKeyCurrency.gbpInr, byKeyCurrency.eurInr, byKeyCurrency.chfInr,
      byKeyCurrency.audInr, byKeyCurrency.cadInr, byKeyCurrency.aedInr, rubInrIndicator,
      byKeyCurrency.cnyInr, byKeyCurrency.sgdInr, byKeyCurrency.thbInr, byKeyCurrency.vndInr
    ].filter(Boolean),
    usIndices: usIndexIndicators,
    usRates: [byKey.usTreasury10y].filter(Boolean),
    // US Macro -> Commodities (new 2026-09-23): the raw, unconverted USD
    // source prices -- Gold/Crude Oil (WTI)/Natural Gas (Henry Hub) -- same
    // fetched objects the India Macro derivations above consume as inputs,
    // shown here without any INR conversion applied.
    usCommodities: [byKey.gold, byKey.crudeOilWti, byKey.naturalGas].filter(Boolean),
    worldAsia: worldIndexIndicators.filter(i => WORLD_INDEX_INDICATORS.find(d => d.key === i.key)?.region === 'Asia'),
    worldEurope: worldIndexIndicators.filter(i => WORLD_INDEX_INDICATORS.find(d => d.key === i.key)?.region === 'Europe')
  };

  // Nifty 50 trend for the regime classifier: reused from whichever India
  // watchlist last refreshed (research.mjs's loadBenchmarkQuote already
  // fetches/caches ^NSEI) -- never fetched again here. A fresh install with
  // no India watchlist refreshed yet just degrades to fewer regime inputs,
  // the same confidence-gating every other engine in this app already does.
  const niftyBundle = await benchmarkCache.read('^NSEI');
  const benchmarkTrend = niftyBundle?.quote
    ? trendLabel(niftyBundle.quote.regularMarketPrice, niftyBundle.quote.fiftyDayAverage, niftyBundle.quote.twoHundredDayAverage)
    : null;

  const regime = classifyMarketRegime({ indiaVix: byKey.indiaVix, usTreasury10y: byKey.usTreasury10y, usdInr: byKey.usdInr, crudeOilWti: byKey.crudeOilWti, benchmarkTrend });

  return {
    generatedAt: new Date().toISOString(),
    indicators, unavailable, periodic, groups,
    dataQuality: {
      live: indicators.filter(i => i.status === 'Live').length,
      delayed: indicators.filter(i => i.status === 'Delayed').length,
      unavailable: indicators.filter(i => i.status === 'Unavailable').length,
      futureIntegration: unavailable.length,
      // Added 2026-09-09 alongside PERIODIC_MACRO_INDICATORS -- a periodic/
      // policy reading is real and officially sourced, not a data-quality
      // problem, so it gets its own bucket rather than being folded into
      // `live` (which the UI documents as "fetched within the last 30
      // minutes," untrue for an annual figure) or `futureIntegration`
      // (which means "no source exists at all," no longer true for either).
      periodic: periodic.length
      // No `credentialsRequired` bucket as of 2026-09-09 -- IIP (the last
      // credential-gated macro indicator) was independently investigated and
      // proven public, so no macro indicator in this app is ever gated on a
      // MoSPI credential today. Removed rather than left at a permanent 0,
      // per CLAUDE.md's "don't leave stale messaging from the previous
      // architecture."
    },
    regime
  };
}

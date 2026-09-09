import { MACRO_INDICATORS, UNAVAILABLE_MACRO_INDICATORS, MOSPI_MACRO_INDICATORS } from '../providers/macroProvider.mjs';
import { getCachedMacroQuote } from '../providers/index.mjs';
import { trendLabel } from '../providers/yahooQuoteProvider.mjs';
import { macroCache, benchmarkCache } from './diskCache.mjs';
import { number } from '../util.mjs';
import { MARKET_REGIME } from '../decision/config.mjs';
import { classifyMarketRegime } from '../decision/marketRegime.mjs';
import { getDatasetSnapshot, getCpiPublicSnapshot } from '../integrations/mospiProvider.mjs';

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
function toIndicator(def, bundle, status) {
  const quote = bundle?.quote;
  return {
    key: def.key, label: def.label, category: def.category, unit: def.unit, status,
    value: number(quote?.price, 4), changePct: number(quote?.changePct), oneYearChangePct: number(quote?.oneYearChangePct),
    direction: directionFrom(quote?.changePct), asOf: bundle?.fetchedAt ?? null,
    trend: quote?.trend || 'N/A',
    dma20: number(quote?.twentyDayAverage, 4), dma50: number(quote?.fiftyDayAverage, 4),
    dma100: number(quote?.hundredDayAverage, 4), dma200: number(quote?.twoHundredDayAverage, 4)
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

// IIP (2026-09-08): a fundamentally different shape from the 7 market
// indicators above -- a period-over-period economic reading, not a priced
// instrument, so it deliberately carries no changePct/DMA/trend fields (see
// system.md §3.10's "no meaningless DMA on economic indicators" rule).
// Status comes from data/integrations/mospiProvider.mjs's per-dataset
// getDatasetSnapshot(), which is itself gated on the credential stored by
// the Configuration → Integrations page -- never a fixed disclosure like
// UNAVAILABLE_MACRO_INDICATORS below. CPI moved off this credential-gated
// path (2026-09-08 follow-on, see loadCpiIndicator() below) -- this function
// now serves IIP only.
async function loadMospiIndicator(def) {
  const snapshot = await getDatasetSnapshot(def.key);
  return {
    key: def.key, label: def.label, category: def.category, status: snapshot.status,
    value: number(snapshot.value, 2), period: snapshot.period ?? null, asOf: snapshot.asOf
  };
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
    period: snapshot.period ?? null, sector: snapshot.sector ?? null, seriesLabel: snapshot.seriesLabel ?? null
  };
}

// Builds the watchlist-independent macro snapshot: 7 real market indicators
// + CPI (see macroProvider.mjs/loadCpiIndicator() above -- CPI is public,
// always-on, 2026-09-08), the disclosed list of indicators with no data
// source, the 1 remaining MoSPI-backed (credential-gated) economic indicator
// (IIP), a Data Quality rollup (Live/Delayed/Unavailable/Future Integration
// counts -- the Dashboard's Macro Intelligence panel renders these labels
// directly, nothing is relabeled client-side), and a market regime read.
export async function buildMacroSnapshot() {
  const [marketIndicators, cpiIndicator, configGated] = await Promise.all([
    Promise.all(MACRO_INDICATORS.map(loadIndicator)),
    loadCpiIndicator(),
    Promise.all(MOSPI_MACRO_INDICATORS.map(loadMospiIndicator))
  ]);
  const indicators = [...marketIndicators, cpiIndicator];
  const unavailable = UNAVAILABLE_MACRO_INDICATORS.map(def => ({ ...def, status: 'Future Integration', value: null, changePct: null, oneYearChangePct: null, direction: 'N/A', asOf: null }));
  const byKey = Object.fromEntries(indicators.map(i => [i.key, i]));

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
    indicators, unavailable, configGated,
    dataQuality: {
      live: indicators.filter(i => i.status === 'Live').length + configGated.filter(i => i.status === 'Live').length,
      delayed: indicators.filter(i => i.status === 'Delayed').length + configGated.filter(i => i.status === 'Delayed').length,
      unavailable: indicators.filter(i => i.status === 'Unavailable').length + configGated.filter(i => i.status === 'Unavailable').length,
      futureIntegration: unavailable.length,
      // Configuration-gated (MoSPI IIP only, 2026-09-08: CPI moved off this
      // bucket entirely -- see loadCpiIndicator() above): distinct from the
      // always-on Future Integration bucket above -- IIP has a real, working
      // provider that just needs the user's own credential (Configuration →
      // Integrations) to start returning Live data.
      credentialsRequired: configGated.filter(i => i.status === 'Credentials Required' || i.status === 'Token Expired' || i.status === 'Authentication Failed').length
    },
    regime
  };
}

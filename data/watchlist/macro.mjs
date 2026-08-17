import { MACRO_INDICATORS, UNAVAILABLE_MACRO_INDICATORS } from '../providers/macroProvider.mjs';
import { getCachedMacroQuote } from '../providers/index.mjs';
import { trendLabel } from '../providers/yahooQuoteProvider.mjs';
import { macroCache, benchmarkCache } from './diskCache.mjs';
import { number } from '../util.mjs';
import { MARKET_REGIME } from '../decision/config.mjs';
import { classifyMarketRegime } from '../decision/marketRegime.mjs';

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

function toIndicator(def, bundle, status) {
  const quote = bundle?.quote;
  return {
    key: def.key, label: def.label, category: def.category, unit: def.unit, status,
    value: number(quote?.price, 4), changePct: number(quote?.changePct), oneYearChangePct: number(quote?.oneYearChangePct),
    direction: directionFrom(quote?.changePct), asOf: bundle?.fetchedAt ?? null
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

// Builds the watchlist-independent macro snapshot: 6 real indicators (see
// macroProvider.mjs), the disclosed list of indicators with no data source,
// a Data Quality rollup (Live/Delayed/Unavailable/Future Integration counts
// -- the Dashboard's Macro Intelligence panel renders these labels directly,
// nothing is relabeled client-side), and a market regime read.
export async function buildMacroSnapshot() {
  const indicators = await Promise.all(MACRO_INDICATORS.map(loadIndicator));
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
    indicators, unavailable,
    dataQuality: {
      live: indicators.filter(i => i.status === 'Live').length,
      delayed: indicators.filter(i => i.status === 'Delayed').length,
      unavailable: indicators.filter(i => i.status === 'Unavailable').length,
      futureIntegration: unavailable.length
    },
    regime
  };
}

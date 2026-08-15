import { TtlCache, memoize } from '../cache.mjs';
import { fetchFundamentals as screenerFetch } from './screenerProvider.mjs';
import { fetchFundamentals as notConfiguredFetch } from './notConfiguredProvider.mjs';
import { fetchQuote } from './yahooQuoteProvider.mjs';

// The entire integration surface for a future paid data API: implement
// fetchFundamentals(symbol) against the same normalized shape (see
// screenerProvider.mjs's doc comment) in a new provider module, then add it
// here. Nothing in data/analytics, data/scoring, server.mjs, or the frontend
// needs to change.
const fundamentalsCache = new TtlCache(Number(process.env.SCREENER_CACHE_TTL_MS) || 60 * 60 * 1000);
const cachedScreenerFetch = memoize(fundamentalsCache, screenerFetch);

export function getFundamentalsProvider(market) {
  return market === 'India' ? cachedScreenerFetch : notConfiguredFetch;
}

// Yahoo quotes weren't cached at all before Phase 1; a short TTL cuts
// redundant hits on rapid repeat queries without meaningfully staling price.
const quoteCache = new TtlCache(2 * 60 * 1000);
export const getCachedQuote = memoize(quoteCache, fetchQuote);

export async function getCachedQuotes(symbols) {
  const settled = await Promise.allSettled(symbols.map(getCachedQuote));
  return settled.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value);
}

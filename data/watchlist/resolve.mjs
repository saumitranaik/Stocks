import { clean, request } from '../util.mjs';

// Direct market classifier for a single Yahoo search/quote result. Replaces
// server.mjs's old isInSelectedMarket(quote, targetMarket) comparison --
// that function answered "does this quote belong to the market the user
// already picked"; a watchlist has no single selected market (companies
// resolve their own market individually), so this answers "what market is
// this quote in" directly. Same underlying exchange/region heuristics.
export function classifyMarket(quote) {
  const symbol = String(quote.symbol || '');
  const exchange = String(quote.exchange || quote.exchDisp || '').toUpperCase();
  const region = String(quote.region || '').toUpperCase();
  const quoteMarket = String(quote.market || '').toUpperCase();
  if (/\.NS$|\.BO$/.test(symbol) || /NSE|BSE|NSI|BOM/.test(exchange)) return 'India';
  if (region === 'US' || quoteMarket === 'US_MARKET' || /NMS|NYQ|NCM|NGM|NAS|PCX|ASE|AMEX|BTS|USA/.test(exchange)) return 'United States';
  return 'Global';
}

// Autocomplete candidates for the "Add company" box. No persistence, no
// fundamentals fetch -- just Yahoo's public symbol-search endpoint (the
// same one the old sector-preset fallback used), filtered to equities.
export async function searchCompanies(query) {
  const trimmed = clean(query);
  if (!trimmed) return [];
  const data = await (await request(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(trimmed)}&quotesCount=10&newsCount=0`)).json();
  return (data.quotes || [])
    .filter(q => q.quoteType === 'EQUITY' && q.symbol)
    .map(q => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      exchange: q.exchDisp || q.exchange || null,
      market: classifyMarket(q)
    }));
}

import { number } from '../util.mjs';

// Relative Strength = stock's trailing-1y return minus a benchmark index's
// trailing-1y return (both from the same chart-endpoint oneYearReturnPct
// field yahooQuoteProvider.mjs computes for any symbol, index or equity).
// No configured benchmark for "Global" watchlists (no single defensible
// index spans every exchange) -- benchmarkSymbolFor returns null there and
// the caller skips the fetch entirely rather than picking an arbitrary index.
export function benchmarkSymbolFor(market) {
  if (market === 'India') return '^NSEI';
  if (market === 'United States') return '^GSPC';
  return null;
}
export function relativeStrengthPct(stockReturnPct, benchmarkReturnPct) {
  return Number.isFinite(stockReturnPct) && Number.isFinite(benchmarkReturnPct) ? number(stockReturnPct - benchmarkReturnPct) : null;
}

// Heuristic support/resistance, not literal pivot-point/order-book levels
// (this data source has no order-book depth): support is the nearest of
// {50DMA, 200DMA, 52W low} that sits below CMP; resistance is the 52W high
// when CMP is still below it. `atHigh` flags CMP at/above the 52W high, where
// "resistance" isn't a meaningful concept from this data.
export function supportResistance(quote) {
  const price = quote?.regularMarketPrice;
  if (!Number.isFinite(price)) return { support: null, resistance: null, atHigh: false };
  const below = [quote.fiftyDayAverage, quote.twoHundredDayAverage, quote.fiftyTwoWeekLow].filter(v => Number.isFinite(v) && v < price);
  const support = below.length ? number(Math.max(...below)) : null;
  const aboveHigh = Number.isFinite(quote.fiftyTwoWeekHigh) && quote.fiftyTwoWeekHigh > price;
  return { support, resistance: aboveHigh ? number(quote.fiftyTwoWeekHigh) : null, atHigh: Number.isFinite(quote.fiftyTwoWeekHigh) && price >= quote.fiftyTwoWeekHigh };
}

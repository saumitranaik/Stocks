import { request, average, clamp } from '../util.mjs';

// Wilder's RSI over the full available close history (chart endpoint gives
// up to 1y daily closes), seeded from the first 14 periods.
export function rsi14(closes, period = 14) {
  if (closes.length <= period) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
export function trendLabel(price, fifty, twoHundred) {
  if (!Number.isFinite(price) || !Number.isFinite(fifty) || !Number.isFinite(twoHundred)) return 'N/A';
  if (price > fifty && fifty > twoHundred) return 'Uptrend';
  if (price < fifty && fifty < twoHundred) return 'Downtrend';
  return 'Sideways';
}
export function momentumLabel(rsi) {
  if (!Number.isFinite(rsi)) return 'N/A';
  if (rsi >= 60) return 'Strong';
  if (rsi >= 45) return 'Neutral';
  return 'Weak';
}
export function volumeTrendLabel(volume, avgVolume) {
  if (!Number.isFinite(volume) || !Number.isFinite(avgVolume) || avgVolume === 0) return 'N/A';
  const ratio = volume / avgVolume;
  if (ratio >= 1.2) return 'Above average';
  if (ratio <= 0.8) return 'Below average';
  return 'Average';
}

// Standard 12/26/9 EMA MACD. Needs >= 35 closes (26 to seed the slow EMA,
// plus 9 more so the signal line itself has settled) or every field is null
// rather than computed off a too-short, unrepresentative window.
function ema(values, period) {
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  const out = [prev];
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}
export function macd(closes) {
  if (closes.length < 35) return { macdLine: null, signalLine: null, histogram: null };
  const ema12 = ema(closes, 12); // ema12[j] aligns to closes[11 + j]
  const ema26 = ema(closes, 26); // ema26[j] aligns to closes[25 + j]
  const diff = ema26.map((slow, j) => ema12[j + 14] - slow); // both aligned to closes[25 + j]
  const signal = ema(diff, 9);
  const macdLine = diff.at(-1), signalLine = signal.at(-1);
  return { macdLine: number2(macdLine), signalLine: number2(signalLine), histogram: number2(macdLine - signalLine) };
}
const number2 = (v) => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;

// Yahoo's old multi-symbol quote endpoint often returns HTTP 401 without a
// browser cookie/crumb. The chart endpoint is public and supplies the live
// price plus the technical fields needed for the dashboard.
export async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false`;
  const data = await (await request(url)).json();
  const result = data.chart?.result?.[0];
  if (!result?.meta) return null;
  const meta = result.meta;
  const quoteBlock = result.indicators?.quote?.[0] || {};
  const closes = (quoteBlock.close || []).filter(Number.isFinite);
  const volumes = (quoteBlock.volume || []).filter(Number.isFinite);
  // Open/high/low/close/volume kept index-aligned (nulls kept, not filtered)
  // so the technical scorecard (ADX/ATR/OBV/A-D/volume profile -- see
  // data/analytics/technicalScorecard.mjs) can zip them together by day.
  // Same daily bars the close/volume series above already come from, so
  // this adds zero new network calls.
  const ohlcv = {
    open: quoteBlock.open || [], high: quoteBlock.high || [], low: quoteBlock.low || [],
    close: quoteBlock.close || [], volume: quoteBlock.volume || []
  };
  const recent = closes.at(-1) ?? meta.regularMarketPrice;
  const movingAverage = (days) => closes.slice(-days).reduce((sum, value, _, list) => sum + value / list.length, 0);
  // closes[0] is the oldest close in the requested 1y range -- not exactly
  // 365 days back (holidays/listing history can shorten the window), so this
  // is "return over the available trailing-year window," not a calendar-
  // exact figure. Same caveat applies wherever this feeds Relative Strength.
  const oneYearReturnPct = closes.length >= 2 && closes[0] > 0 ? ((recent - closes[0]) / closes[0]) * 100 : null;
  return {
    symbol, shortName: meta.shortName, longName: meta.longName,
    currency: meta.currency, regularMarketPrice: recent,
    regularMarketChangePercent: meta.chartPreviousClose ? ((recent - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : null,
    twentyDayAverage: closes.length >= 20 ? movingAverage(20) : null,
    fiftyDayAverage: closes.length >= 50 ? movingAverage(50) : null,
    hundredDayAverage: closes.length >= 100 ? movingAverage(100) : null,
    twoHundredDayAverage: closes.length >= 200 ? movingAverage(200) : null,
    fiftyTwoWeekHigh: Math.max(...closes), fiftyTwoWeekLow: Math.min(...closes),
    regularMarketVolume: meta.regularMarketVolume || null,
    rsi14: rsi14(closes),
    macd: macd(closes),
    oneYearReturnPct,
    avgVolume20: volumes.length ? average(volumes.slice(-20)) : null,
    ohlcv
  };
}

// Longer-range weekly series, fetched only when a company's cache bundle is
// (re)built (see loadCompanyBundle in data/watchlist/research.mjs) -- never
// on the cache-only startup/switch paint. Powers beta, correlation, multi-
// timeframe trend and historical P/E-P/B percentile reconstruction, none of
// which are derivable from the 1y daily window fetchQuote() already has.
// Weekly interval keeps a 5y payload small (~260 points vs. ~1250 daily).
export async function fetchPriceHistory(symbol, range = '5y', interval = '1wk') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const data = await (await request(url)).json();
  const result = data.chart?.result?.[0];
  if (!result?.meta) return null;
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = timestamps
    .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter(p => Number.isFinite(p.close));
  return { symbol, range, interval, points };
}

// 0-100 technical-trend signal: pure price-structure (moving-average
// alignment, distance from 52-week high). Feeds the scoring engine's
// "Technical trend" factor, separate from momentum/volume below.
export function technicalTrendSignal(quote) {
  const price = quote.regularMarketPrice;
  const signals = [];
  if (Number.isFinite(price) && quote.fiftyDayAverage > 0) signals.push(clamp(50 + (price / quote.fiftyDayAverage - 1) * 220, 0, 100));
  if (Number.isFinite(price) && quote.twoHundredDayAverage > 0) signals.push(clamp(50 + (price / quote.twoHundredDayAverage - 1) * 150, 0, 100));
  if (Number.isFinite(price) && quote.fiftyTwoWeekHigh > 0) signals.push(clamp(100 - (1 - price / quote.fiftyTwoWeekHigh) * 140, 0, 100));
  return signals.length ? average(signals) : null;
}

// 0-100 momentum/volume signal: RSI, daily move, and volume vs. its 20-day
// average. Feeds the scoring engine's "Momentum & volume" factor.
export function momentumVolumeSignal(quote) {
  const signals = [];
  if (Number.isFinite(quote.rsi14)) signals.push(clamp(quote.rsi14, 0, 100));
  if (Number.isFinite(quote.regularMarketChangePercent)) signals.push(clamp(50 + quote.regularMarketChangePercent * 4, 0, 100));
  if (Number.isFinite(quote.regularMarketVolume) && quote.avgVolume20 > 0) signals.push(clamp(50 + (quote.regularMarketVolume / quote.avgVolume20 - 1) * 40, 0, 100));
  return signals.length ? average(signals) : null;
}

export async function fetchQuotes(symbols) {
  const settled = await Promise.allSettled(symbols.map(fetchQuote));
  return settled.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value);
}

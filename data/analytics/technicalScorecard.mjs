import { number, clamp, average } from '../util.mjs';

// All indicators below reuse the same daily OHLCV bars fetchQuote() already
// pulls in its single 1y chart-endpoint call (see ohlcv on the quote object)
// -- this whole module adds zero new network calls. Bars with a null in any
// of open/high/low/close/volume are dropped so every formula below can
// assume clean, index-aligned arrays.
function cleanBars(ohlcv) {
  if (!ohlcv) return [];
  const { open = [], high = [], low = [], close = [], volume = [] } = ohlcv;
  const bars = [];
  for (let i = 0; i < close.length; i++) {
    if ([open[i], high[i], low[i], close[i], volume[i]].every(Number.isFinite)) {
      bars.push({ open: open[i], high: high[i], low: low[i], close: close[i], volume: volume[i] });
    }
  }
  return bars;
}

// Wilder's smoothing: seed with a simple average of the first `period`
// values, then roll forward with the standard (prev*(period-1)+value)/period
// recurrence -- same smoothing style already used for RSI (yahooQuoteProvider.mjs).
function wilderSmooth(values, period) {
  if (values.length < period) return [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [prev];
  for (let i = period; i < values.length; i++) { prev = (prev * (period - 1) + values[i]) / period; out.push(prev); }
  return out;
}

// Average True Range (14): Wilder-smoothed true range.
export function atr14(bars) {
  if (bars.length < 15) return null;
  const tr = bars.slice(1).map((bar, i) => Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - bars[i].close),
    Math.abs(bar.low - bars[i].close)
  ));
  const smoothed = wilderSmooth(tr, 14);
  return smoothed.length ? number(smoothed.at(-1)) : null;
}

// Average Directional Index (14): Wilder's DI+/DI-/DX, then a Wilder-smoothed
// average of DX. Returns { adx, diPlus, diMinus } so callers can show trend
// direction (DI+ > DI-) alongside trend strength (ADX magnitude).
export function adx14(bars) {
  if (bars.length < 29) return { adx: null, diPlus: null, diMinus: null };
  const plusDm = [], minusDm = [], tr = [];
  for (let i = 1; i < bars.length; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  }
  const smoothTr = wilderSmooth(tr, 14), smoothPlusDm = wilderSmooth(plusDm, 14), smoothMinusDm = wilderSmooth(minusDm, 14);
  const len = Math.min(smoothTr.length, smoothPlusDm.length, smoothMinusDm.length);
  if (!len) return { adx: null, diPlus: null, diMinus: null };
  const dx = [];
  for (let i = 0; i < len; i++) {
    const diPlus = smoothTr[i] > 0 ? (smoothPlusDm[i] / smoothTr[i]) * 100 : 0;
    const diMinus = smoothTr[i] > 0 ? (smoothMinusDm[i] / smoothTr[i]) * 100 : 0;
    dx.push({ diPlus, diMinus, dx: diPlus + diMinus > 0 ? (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100 : 0 });
  }
  const adxSeries = wilderSmooth(dx.map(d => d.dx), 14);
  const last = dx.at(-1);
  return { adx: adxSeries.length ? number(adxSeries.at(-1)) : null, diPlus: number(last.diPlus), diMinus: number(last.diMinus) };
}

// On-Balance Volume: cumulative running total, direction from day-over-day
// close change. Reported as the final level plus a short trend read (final
// vs. its own trailing-20-bar average) since the raw cumulative number has
// no intrinsic scale to compare across stocks.
export function onBalanceVolume(bars) {
  if (bars.length < 2) return { value: null, trend: 'N/A' };
  const series = [0];
  for (let i = 1; i < bars.length; i++) {
    const prev = series[i - 1];
    series.push(bars[i].close > bars[i - 1].close ? prev + bars[i].volume : bars[i].close < bars[i - 1].close ? prev - bars[i].volume : prev);
  }
  const recentAvg = average(series.slice(-20));
  const value = series.at(-1);
  return { value: number(value, 0), trend: recentAvg == null ? 'N/A' : value > recentAvg ? 'Rising' : value < recentAvg ? 'Falling' : 'Flat' };
}

// Accumulation/Distribution line: standard money-flow-multiplier formula.
// Same reporting shape as OBV above (level + trend read).
export function accumulationDistribution(bars) {
  if (bars.length < 2) return { value: null, trend: 'N/A' };
  let running = 0;
  const series = [];
  for (const bar of bars) {
    const range = bar.high - bar.low;
    const mfm = range > 0 ? ((bar.close - bar.low) - (bar.high - bar.close)) / range : 0;
    running += mfm * bar.volume;
    series.push(running);
  }
  const recentAvg = average(series.slice(-20));
  const value = series.at(-1);
  return { value: number(value, 0), trend: recentAvg == null ? 'N/A' : value > recentAvg ? 'Accumulation' : value < recentAvg ? 'Distribution' : 'Flat' };
}

// Volume profile: daily-close-bucketed volume histogram (a proxy for true
// intraday tick volume profile, which this data source doesn't expose -- see
// metricRegistry.mjs). Returns the 10 price buckets across the trailing
// window plus the point of control (highest-volume bucket).
export function volumeProfile(bars, buckets = 10) {
  if (bars.length < buckets) return { buckets: [], pointOfControl: null };
  const closes = bars.map(b => b.close);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  if (!(hi > lo)) return { buckets: [], pointOfControl: null };
  const width = (hi - lo) / buckets;
  const volumes = Array(buckets).fill(0);
  for (const bar of bars) {
    const idx = clamp(Math.floor((bar.close - lo) / width), 0, buckets - 1);
    volumes[idx] += bar.volume;
  }
  const totalVolume = volumes.reduce((a, b) => a + b, 0) || 1;
  const rows = volumes.map((volume, i) => ({ priceLow: number(lo + i * width), priceHigh: number(lo + (i + 1) * width), volume, sharePct: number((volume / totalVolume) * 100) }));
  const pointOfControl = rows.reduce((best, row) => (!best || row.volume > best.volume ? row : best), null);
  return { buckets: rows, pointOfControl };
}

// Moving-average alignment on an arbitrary close series -- same 3-state
// trend read as yahooQuoteProvider.mjs's trendLabel(), just parameterized so
// it can run on weekly/monthly closes too (multi-timeframe trend below), not
// only the daily series that function was written for.
function alignmentTrend(closes, fast, slow) {
  if (closes.length < slow) return 'N/A';
  const fastMa = average(closes.slice(-fast)), slowMa = average(closes.slice(-slow));
  const price = closes.at(-1);
  if (price > fastMa && fastMa > slowMa) return 'Uptrend';
  if (price < fastMa && fastMa < slowMa) return 'Downtrend';
  return 'Sideways';
}

// Multi-timeframe trend: daily reuses the existing 50/200-DMA read passed in
// by the caller (no need to recompute); weekly/monthly derive their own
// moving-average alignment off the longer weekly priceHistory series (~10
// weeks/40 weeks approximate the 50/200-day window at weekly granularity for
// "weekly", ~4/52 weeks approximate a 1-month/1-year window for "monthly").
// `confirmationCount` (0-3) is how many of the 3 timeframes agree with the
// dominant direction; `confirmationStrength` bands that count into a label
// ("Conflicting" -- all 3 resolved but no 2 agree -- is distinguished from
// "Weak," where at least one timeframe couldn't be computed at all).
export function multiTimeframeTrend(dailyTrend, weeklyCloses) {
  const weekly = alignmentTrend(weeklyCloses, 10, 40);
  const monthly = alignmentTrend(weeklyCloses, 4, 52);
  const states = [dailyTrend, weekly, monthly];
  const upCount = states.filter(t => t === 'Uptrend').length;
  const downCount = states.filter(t => t === 'Downtrend').length;
  const aligned = upCount >= 2 ? 'Uptrend' : downCount >= 2 ? 'Downtrend' : 'Mixed';
  const confirmationCount = Math.max(upCount, downCount);
  const confirmationStrength = confirmationCount === 3 ? 'Strong' : confirmationCount === 2 ? 'Partial'
    : states.every(t => t !== 'N/A') ? 'Conflicting' : 'Weak';
  return { daily: dailyTrend, weekly, monthly, aligned, confirmationCount, confirmationStrength };
}

// ADX interpretation bands -- Wilder's own convention (<20 no trend, 20-25
// developing, 25-50 strong, >50 very strong/potentially extended), not an
// in-house threshold.
export function adxInterpretation(adx) {
  if (!Number.isFinite(adx)) return 'N/A';
  if (adx < 20) return 'No trend';
  if (adx < 25) return 'Developing trend';
  if (adx < 50) return 'Strong trend';
  return 'Very strong trend';
}

// ATR normalized to price (%) -- makes ATR comparable across stocks with very
// different price levels. volatilityScore already divides by price
// internally; this surfaces that ratio as its own labeled, comparable field.
export function atrPctOf(atr, price) {
  return Number.isFinite(atr) && Number.isFinite(price) && price > 0 ? number((atr / price) * 100) : null;
}

// Where current price sits relative to the volume profile's point of control
// (the highest-volume price bucket) -- a support/resistance read off real
// volume concentration, not a fabricated pivot level.
export function priceVsPointOfControl(price, pointOfControl) {
  if (!Number.isFinite(price) || !pointOfControl) return 'N/A';
  if (price > pointOfControl.priceHigh) return 'Above point of control (support below)';
  if (price < pointOfControl.priceLow) return 'Below point of control (resistance above)';
  return 'At point of control';
}

// Volume-weighted momentum: daily returns over the trailing 20 bars, weighted
// by that day's share of total volume -- gives more weight to moves
// confirmed by higher participation than a simple average return would.
export function volumeWeightedMomentum(bars) {
  if (bars.length < 21) return null;
  const recent = bars.slice(-21);
  const totalVolume = recent.slice(1).reduce((sum, b) => sum + b.volume, 0);
  if (!(totalVolume > 0)) return null;
  let weightedReturn = 0;
  for (let i = 1; i < recent.length; i++) {
    const ret = recent[i - 1].close > 0 ? (recent[i].close - recent[i - 1].close) / recent[i - 1].close : 0;
    weightedReturn += ret * (recent[i].volume / totalVolume);
  }
  return Math.round(clamp(50 + weightedReturn * 100 * 15, 0, 100));
}

// Trend persistence: R^2 of an ordinary-least-squares line fit through the
// trailing 50 closes -- a real statistic (coefficient of determination), not
// invented for this app. Near 100 = a smooth, persistent trend; near 0 =
// choppy/directionless price action, independent of which way it's trending.
export function trendPersistenceScore(bars) {
  const closes = bars.slice(-50).map(b => b.close);
  if (closes.length < 20) return null;
  const xs = closes.map((_, i) => i);
  const meanX = average(xs), meanY = average(closes);
  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < closes.length; i++) { ssXY += (xs[i] - meanX) * (closes[i] - meanY); ssXX += (xs[i] - meanX) ** 2; ssYY += (closes[i] - meanY) ** 2; }
  if (!(ssXX > 0) || !(ssYY > 0)) return null;
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  return Math.round(clamp(r * r * 100, 0, 100));
}

// Breakout quality: like breakoutProbability above, but weighted toward
// corroborating volume and trend strength rather than proximity to
// resistance alone -- a "quality" breakout needs participation (volume) and
// a directional trend (ADX), not just price sitting near a level.
export function breakoutQualityScore({ adx, volume, avgVolume20, atHigh, resistance, price }) {
  const parts = [];
  if (Number.isFinite(volume) && avgVolume20 > 0) parts.push({ score: clamp(50 + (volume / avgVolume20 - 1) * 80, 0, 100), weight: 2 });
  if (Number.isFinite(adx)) parts.push({ score: clamp(adx * 2.2, 0, 100), weight: 1.5 });
  if (atHigh) parts.push({ score: 90, weight: 1 });
  else if (Number.isFinite(resistance) && Number.isFinite(price) && resistance > price) parts.push({ score: clamp(100 - ((resistance - price) / price) * 400, 0, 100), weight: 1 });
  if (!parts.length) return null;
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  return Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight);
}

// Volatility-adjusted momentum: the existing momentumScore's deviation from
// neutral (50), scaled down as ATR% rises -- a Sharpe-ratio-style read
// (momentum per unit of volatility), so two stocks with the same raw
// momentum score but very different volatility don't read as equally
// attractive.
export function volatilityAdjustedMomentum(momentumScore, atrPctValue) {
  if (!Number.isFinite(momentumScore)) return null;
  const vol = Number.isFinite(atrPctValue) && atrPctValue > 0 ? atrPctValue : 3;
  const deviation = (momentumScore - 50) / clamp(vol / 2, 0.5, 6);
  return Math.round(clamp(50 + deviation, 0, 100));
}

// Institutional accumulation: blends OBV/A-D trend direction, DI+ dominance
// and up-day volume share into one "smart money" style heuristic (higher =
// accumulation, lower = distribution). Not a real institutional order-flow
// feed -- this app has no such data source.
export function institutionalAccumulationScore({ obvTrend, accDistTrend, diPlus, diMinus, bars }) {
  const parts = [];
  if (obvTrend === 'Rising') parts.push(75); else if (obvTrend === 'Falling') parts.push(25);
  if (accDistTrend === 'Accumulation') parts.push(75); else if (accDistTrend === 'Distribution') parts.push(25);
  if (Number.isFinite(diPlus) && Number.isFinite(diMinus) && diPlus + diMinus > 0) parts.push(clamp((diPlus / (diPlus + diMinus)) * 100, 0, 100));
  const recent = bars.slice(-20);
  if (recent.length >= 2) {
    const upDayVolume = recent.slice(1).filter((b, i) => b.close > recent[i].close).reduce((s, b) => s + b.volume, 0);
    const totalVolume = recent.slice(1).reduce((s, b) => s + b.volume, 0);
    if (totalVolume > 0) parts.push(clamp((upDayVolume / totalVolume) * 100, 0, 100));
  }
  return parts.length ? Math.round(average(parts)) : null;
}

// Technical regime: a single qualitative label combining trend strength
// (ADX), directional alignment across timeframes, and volatility -- a
// screening summary, not a statistical regime-detection model.
export function technicalRegime({ adx, multiTimeframe, volatilityScore, trendStrengthScore }) {
  if (!Number.isFinite(adx) && !multiTimeframe) return 'N/A';
  const strongTrend = Number.isFinite(adx) && adx >= 30;
  const highVol = Number.isFinite(volatilityScore) && volatilityScore >= 70;
  const aligned = multiTimeframe?.aligned;
  if (highVol && strongTrend) return 'Volatile Breakout';
  if (aligned === 'Uptrend' && strongTrend) return 'Strong Uptrend';
  if (aligned === 'Uptrend') return 'Uptrend';
  if (aligned === 'Downtrend' && strongTrend) return 'Strong Downtrend';
  if (aligned === 'Downtrend') return 'Downtrend';
  if (Number.isFinite(trendStrengthScore) && trendStrengthScore < 40 && !strongTrend) return 'Range-bound';
  return 'Mixed';
}

// Signal confidence: blends how many of the core technical indicators
// resolved (ADX/RSI/MACD/OBV) with multi-timeframe agreement -- same
// "confidence is data completeness + corroboration" pattern already used for
// the DCF/recommendation confidence bands elsewhere in this app.
export function technicalSignalConfidence({ adx, rsi, macdHistogram, obvTrend, confirmationStrength }) {
  const resolved = [adx, rsi, macdHistogram].filter(Number.isFinite).length + (obvTrend && obvTrend !== 'N/A' ? 1 : 0);
  const completenessPct = (resolved / 4) * 100;
  const confirmationScore = { Strong: 100, Partial: 60, Conflicting: 20, Weak: 30 }[confirmationStrength] ?? 30;
  const score = average([completenessPct, confirmationScore]);
  return score == null ? 'Low' : score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
}

// In-house 0-100 screening scores (heuristic -- see metricRegistry.mjs),
// blending the indicators above with the technical fields research.mjs
// already computes (RSI, MACD, volume-vs-average, support/resistance).
export function technicalScores({ adx, atr, price, rsi, macdHistogram, volume, avgVolume20, resistance, atHigh, obvTrend, multiTimeframe }) {
  const trendSignals = [];
  if (Number.isFinite(adx)) trendSignals.push(clamp(adx * 2.2, 0, 100));
  if (multiTimeframe) trendSignals.push(multiTimeframe.aligned === 'Uptrend' ? 80 : multiTimeframe.aligned === 'Downtrend' ? 20 : 50);
  const trendStrengthScore = trendSignals.length ? Math.round(average(trendSignals)) : null;

  const momentumSignals = [];
  if (Number.isFinite(rsi)) momentumSignals.push(clamp(rsi, 0, 100));
  if (Number.isFinite(macdHistogram)) momentumSignals.push(clamp(50 + macdHistogram * 8, 0, 100));
  if (obvTrend === 'Rising') momentumSignals.push(70); else if (obvTrend === 'Falling') momentumSignals.push(30);
  const momentumScore = momentumSignals.length ? Math.round(average(momentumSignals)) : null;

  const volatilityScore = Number.isFinite(atr) && Number.isFinite(price) && price > 0 ? Math.round(clamp((atr / price) * 100 * 12, 0, 100)) : null;

  const breakoutSignals = [];
  if (atHigh) breakoutSignals.push(85);
  else if (Number.isFinite(resistance) && Number.isFinite(price) && resistance > price) breakoutSignals.push(clamp(100 - ((resistance - price) / price) * 400, 0, 100));
  if (Number.isFinite(adx)) breakoutSignals.push(clamp(adx * 2, 0, 100));
  if (Number.isFinite(volume) && avgVolume20 > 0) breakoutSignals.push(clamp(50 + (volume / avgVolume20 - 1) * 60, 0, 100));
  const breakoutProbability = breakoutSignals.length ? Math.round(average(breakoutSignals)) : null;

  return { trendStrengthScore, momentumScore, volatilityScore, breakoutProbability };
}

export { cleanBars };

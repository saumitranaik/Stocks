import { number } from '../util.mjs';
import { annualizedVolatilityPct, downsideDeviationPct } from '../analytics/priceSeries.mjs';
import { benchmarkSymbolFor } from '../analytics/technicalLevels.mjs';
import { weightedAverage } from '../analytics/portfolio.mjs';
import { PERFORMANCE_PERIODS, CAGR_PERIODS, PERFORMANCE_TOLERANCE_DAYS, SORTINO_THRESHOLD_PCT } from './config.mjs';

// Phase 7 Stage 2 -- Benchmark & Performance Engine. A pure composition/
// normalization layer, same discipline as factorEngine.mjs (§3.9): every
// input below is read off analytics this app already computes elsewhere
// (stock.beta, stock.volatilityPct, stock.maxDrawdownPct, stock.
// riskAdjustedReturnScore, the per-market benchmark quote/priceHistory
// bundle already fetched-and-cached once per market in research.mjs) --
// this module fetches nothing new and never recomputes beta, volatility or
// drawdown a second time. It adds exactly the capabilities that had no
// existing authoritative site: multi-period return measurement (1M-5Y),
// price-series CAGR, drawdown peak/trough/recovery dates, a Sortino-like
// downside-risk ratio, and the benchmark-relative/weight-aggregated
// composition of all of the above.
//
// Every figure is a "price return" (no dividend data exists in this app's
// data sources -- see DATA_LIMITATIONS in research.mjs) and every risk-
// adjusted figure is explicitly labeled "-like"/"proxy": this app has no
// conventional-methodology Sharpe/Sortino calculation (full return series,
// dividend-inclusive, standard risk-free curve), so calling either the
// official name would misrepresent it.

// -- Benchmark selection (brief §4): reuses the existing per-market lookup
// (technicalLevels.mjs's benchmarkSymbolFor -- NIFTY 50 for India, S&P 500
// for US, unavailable elsewhere) and the benchmark bundle research.mjs
// already loaded once per market (loadBenchmarkQuote) -- no new fetch, no
// second benchmark cache. --
function benchmarkInfo(market, bundle) {
  const symbol = benchmarkSymbolFor(market);
  if (!symbol) return { name: null, symbol: null, status: 'unavailable', market, reason: 'No defensible single benchmark spans every exchange for this market.' };
  if (!bundle?.quote) return { name: null, symbol, status: 'unavailable', market, reason: 'Benchmark not yet fetched/cached for this watchlist.' };
  return { name: bundle.quote.longName || bundle.quote.shortName || symbol, symbol, status: 'available', market };
}

// Timestamp-tagged, pre-sorted copy of a point series, computed exactly
// once per stock/benchmark series and reused across every period/CAGR/
// drawdown lookup below -- the same optimization priceSeries.mjs's own
// prepareSeries()/correlationFromPrepared() already established for the
// correlation matrix (see that file's doc comment: re-parsing dates and
// re-sorting the same series per lookup was measured as >90% of
// buildResearch's CPU time before that fix). Naively calling
// priceSeries.mjs's alignSeries()/nearestPoint() once per period+CAGR
// lookup here (7 lookups x stock, 8 x benchmark) would reintroduce exactly
// that anti-pattern, so this module keeps its own prepared-array variant.
function prepareAndSort(points) {
  if (!points?.length) return [];
  return [...points].map(p => ({ ms: new Date(p.date).getTime(), date: p.date, close: p.close })).sort((a, b) => a.ms - b.ms);
}

function nearestPrepared(sorted, targetMs, toleranceMs) {
  let best = null, bestDiff = Infinity;
  for (const point of sorted) {
    const diff = Math.abs(point.ms - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = point; }
  }
  return best && bestDiff <= toleranceMs ? best : null;
}

// -- Performance / cache discipline (brief §18): a watchlist's companies
// sharing a market share the exact same benchmark series, so every
// benchmark-side figure below (period returns, CAGR, volatility, drawdown)
// is computed exactly ONCE per market here and reused across every stock in
// that market -- never recomputed per-company. Call once per market
// (alongside the existing benchmarkByMarket load in research.mjs), then pass
// the result into stockPerformance() below for every stock of that market.
export function benchmarkPerformanceProfile(market, bundle) {
  const info = benchmarkInfo(market, bundle);
  const available = info.status === 'available';
  const points = bundle?.priceHistory?.points;
  const sorted = available ? prepareAndSort(points) : [];

  const periods = { '1Y': { returnPct: available && Number.isFinite(bundle?.quote?.oneYearReturnPct) ? number(bundle.quote.oneYearReturnPct) : null, status: available && Number.isFinite(bundle?.quote?.oneYearReturnPct) ? 'ok' : available ? 'insufficient-history' : 'benchmark-unavailable' } };
  for (const [key, def] of Object.entries(PERFORMANCE_PERIODS)) {
    const r = available ? periodReturnFrom(sorted, def.days, PERFORMANCE_TOLERANCE_DAYS) : { status: 'benchmark-unavailable' };
    periods[key] = { returnPct: r.status === 'ok' ? r.returnPct : null, status: r.status };
  }

  const cagr = {};
  for (const key of CAGR_PERIODS) {
    const def = PERFORMANCE_PERIODS[key];
    const c = available ? periodCagrFrom(sorted, def.days, PERFORMANCE_TOLERANCE_DAYS) : { status: 'benchmark-unavailable' };
    cagr[key] = { cagrPct: c.status === 'ok' ? c.cagrPct : null, status: c.status };
  }

  return {
    info,
    periods, cagr,
    volatilityPct: available ? annualizedVolatilityPct(points) : null,
    drawdown: available ? drawdownDetail(sorted) : null
  };
}

// Locates the (startPoint, endPoint) pair for a calendar-day lookback window
// from the latest available observation, over an already-prepareAndSort()'d
// array -- shared by the return% and CAGR calculations below so both use
// the identical located window (same start date), not two independently-
// tolerance-matched dates. Returns null (never an extrapolated/stretched
// guess) when the series doesn't reach back far enough within toleranceDays
// of the exact target date.
function locateWindow(sorted, days, toleranceDays) {
  if (!sorted.length) return null;
  const endPoint = sorted.at(-1);
  if (!(endPoint.close > 0)) return null;
  const targetMs = endPoint.ms - days * 86400000;
  const startPoint = nearestPrepared(sorted, targetMs, toleranceDays * 86400000);
  if (!startPoint || !(startPoint.close > 0)) return null;
  return { startPoint, endPoint };
}

function periodReturnFrom(sorted, days, toleranceDays) {
  const window = locateWindow(sorted, days, toleranceDays);
  if (!window) return { status: 'insufficient-history', returnPct: null, startDate: null, endDate: null };
  const { startPoint, endPoint } = window;
  return { status: 'ok', returnPct: number(((endPoint.close - startPoint.close) / startPoint.close) * 100), startDate: startPoint.date, endDate: endPoint.date };
}

// CAGR = (End/Start)^(1/years) - 1, using the *actual* elapsed time between
// the located observations (not an assumed exact integer year count) --
// per the Stage 2 brief's explicit instruction.
function periodCagrFrom(sorted, days, toleranceDays) {
  const window = locateWindow(sorted, days, toleranceDays);
  if (!window) return { status: 'insufficient-history', cagrPct: null, years: null };
  const { startPoint, endPoint } = window;
  const years = (endPoint.ms - startPoint.ms) / (365.25 * 86400000);
  if (!(years > 0.5) || !(startPoint.close > 0)) return { status: 'insufficient-history', cagrPct: null, years: null };
  const cagr = (endPoint.close / startPoint.close) ** (1 / years) - 1;
  return { status: 'ok', cagrPct: number(cagr * 100), years: number(years, 2) };
}

// Max drawdown WITH peak/trough/recovery dates -- priceSeries.mjs's
// maxDrawdownPct() (reused for the plain magnitude everywhere else in this
// app) returns only the number, so this is a genuinely new capability, not
// a second implementation of the magnitude: it tracks the same running-peak
// algorithm but also records where the worst episode's peak/trough sit and
// scans forward from the trough for the first later close that recovers the
// pre-drawdown peak. No recovery date is fabricated when the series ends
// still underwater. Takes an already-prepareAndSort()'d array.
function drawdownDetail(sorted) {
  if (!sorted.length) return { maxDrawdownPct: null, peakDate: null, troughDate: null, recovered: null, recoveryDate: null, status: 'insufficient-history' };
  let runningPeak = sorted[0].close, runningPeakDate = sorted[0].date;
  let worst = 0, worstPeak = runningPeak, worstPeakDate = runningPeakDate, troughDate = null, troughMs = null;
  for (const point of sorted) {
    if (point.close > runningPeak) { runningPeak = point.close; runningPeakDate = point.date; }
    const drawdown = runningPeak > 0 ? (point.close - runningPeak) / runningPeak : 0;
    if (drawdown < worst) { worst = drawdown; worstPeak = runningPeak; worstPeakDate = runningPeakDate; troughDate = point.date; troughMs = point.ms; }
  }
  if (troughDate == null) return { maxDrawdownPct: number(worst * 100), peakDate: null, troughDate: null, recovered: null, recoveryDate: null, status: 'ok' };
  let recoveryDate = null;
  for (const point of sorted) {
    if (point.ms <= troughMs) continue;
    if (point.close >= worstPeak) { recoveryDate = point.date; break; }
  }
  return { maxDrawdownPct: number(worst * 100), peakDate: worstPeakDate, troughDate, recovered: recoveryDate != null, recoveryDate, status: 'ok' };
}

// Proxy Sortino: (trailing-1y price return - the disclosed per-market
// risk-free-rate assumption the DCF/WACC and proxy-Sharpe figures already
// use) / annualized downside deviation. Same numerator convention as
// portfolio.mjs's riskAdjustedReturnScore (proxy Sharpe) so the two are
// directly comparable -- only the denominator's risk definition differs.
function sortinoLikeFrom(oneYearReturnPct, downsideDevPct, riskFreeRatePct) {
  if (!Number.isFinite(oneYearReturnPct) || !Number.isFinite(downsideDevPct) || downsideDevPct <= 0) return null;
  return number((oneYearReturnPct - (riskFreeRatePct ?? 0)) / downsideDevPct, 3);
}

// Per-stock performance profile. Every *Value/*Pct argument (beta,
// volatility, max drawdown, proxy Sharpe, risk-free assumption) is read off
// fields research.mjs has already computed for this stock this same pass --
// this function computes none of them a second time. `benchmarkProfile` is
// computed ONCE per market by benchmarkPerformanceProfile() above and
// reused across every stock sharing that market (see the performance-
// discipline note there) -- this function does no benchmark-side
// computation of its own.
export function stockPerformance({ stockPoints, benchmarkProfile, oneYearReturnPct, betaValue, volatilityPct, maxDrawdownPct, sharpeLike, riskFreeRatePct }) {
  const benchmark = benchmarkProfile.info;
  const benchmarkAvailable = benchmark.status === 'available';
  const sorted = prepareAndSort(stockPoints);

  const periods = {
    // 1Y reuses the existing daily-quote-derived return (the same figure
    // already powering stock.relativeStrengthPct elsewhere in this payload)
    // rather than a second, slightly different weekly-series-derived 1Y
    // figure -- one source of truth per app-wide "single computation site"
    // rule, not two competing 1-year numbers in the same response.
    '1Y': {
      stockReturnPct: Number.isFinite(oneYearReturnPct) ? number(oneYearReturnPct) : null,
      benchmarkReturnPct: benchmarkProfile.periods['1Y'].returnPct,
      excessReturnPct: Number.isFinite(oneYearReturnPct) && Number.isFinite(benchmarkProfile.periods['1Y'].returnPct) ? number(oneYearReturnPct - benchmarkProfile.periods['1Y'].returnPct) : null,
      status: !Number.isFinite(oneYearReturnPct) ? 'insufficient-history' : benchmarkProfile.periods['1Y'].status,
      source: 'Trailing 1-year daily close series (same figure this app already surfaces as Relative Strength).'
    }
  };
  for (const [key, def] of Object.entries(PERFORMANCE_PERIODS)) {
    const stockR = periodReturnFrom(sorted, def.days, PERFORMANCE_TOLERANCE_DAYS);
    const benchR = benchmarkProfile.periods[key];
    periods[key] = {
      stockReturnPct: stockR.status === 'ok' ? stockR.returnPct : null,
      benchmarkReturnPct: benchR.status === 'ok' ? benchR.returnPct : null,
      excessReturnPct: stockR.status === 'ok' && benchR.status === 'ok' ? number(stockR.returnPct - benchR.returnPct) : null,
      status: stockR.status !== 'ok' ? 'insufficient-history' : !benchmarkAvailable ? 'benchmark-unavailable' : benchR.status === 'ok' ? 'ok' : 'benchmark-insufficient-history',
      source: 'Weekly 5-year price history series (same series used for beta/volatility/drawdown below).'
    };
  }

  const cagr = {};
  for (const key of CAGR_PERIODS) {
    const def = PERFORMANCE_PERIODS[key];
    const stockC = periodCagrFrom(sorted, def.days, PERFORMANCE_TOLERANCE_DAYS);
    const benchC = benchmarkProfile.cagr[key];
    cagr[key] = {
      stockCagrPct: stockC.status === 'ok' ? stockC.cagrPct : null,
      benchmarkCagrPct: benchC.status === 'ok' ? benchC.cagrPct : null,
      excessCagrPct: stockC.status === 'ok' && benchC.status === 'ok' ? number(stockC.cagrPct - benchC.cagrPct) : null,
      years: stockC.status === 'ok' ? stockC.years : null,
      status: stockC.status !== 'ok' ? 'insufficient-history' : !benchmarkAvailable ? 'benchmark-unavailable' : benchC.status === 'ok' ? 'ok' : 'benchmark-insufficient-history'
    };
  }

  const stockDrawdown = drawdownDetail(sorted);
  const downsideDevPct = downsideDeviationPct(stockPoints, SORTINO_THRESHOLD_PCT);
  const sortinoLike = sortinoLikeFrom(oneYearReturnPct, downsideDevPct, riskFreeRatePct);

  return {
    benchmark,
    returnType: 'Price return -- dividends not included; not a total-shareholder-return figure.',
    periods,
    cagr,
    risk: {
      volatility: {
        stockPct: Number.isFinite(volatilityPct) ? volatilityPct : null,
        benchmarkPct: Number.isFinite(benchmarkProfile.volatilityPct) ? benchmarkProfile.volatilityPct : null,
        observationFrequency: 'weekly', annualizationFactor: 52,
        status: Number.isFinite(volatilityPct) ? 'ok' : 'insufficient-history'
      },
      beta: {
        value: Number.isFinite(betaValue) ? betaValue : null,
        observationFrequency: 'weekly', lookbackNote: 'Trailing overlapping weekly stock/benchmark observations, ~1-2 years in practice (see dcf.mjs beta()) -- reused as-is, not recomputed here.',
        status: Number.isFinite(betaValue) ? 'ok' : 'insufficient-history'
      },
      maxDrawdown: {
        stockPct: Number.isFinite(maxDrawdownPct) ? maxDrawdownPct : null,
        stockPeakDate: stockDrawdown.peakDate, stockTroughDate: stockDrawdown.troughDate,
        stockRecovered: stockDrawdown.recovered, stockRecoveryDate: stockDrawdown.recoveryDate,
        benchmarkPct: benchmarkProfile.drawdown?.maxDrawdownPct ?? null,
        status: Number.isFinite(maxDrawdownPct) ? 'ok' : 'insufficient-history'
      }
    },
    riskAdjusted: {
      sharpeLike: {
        value: Number.isFinite(sharpeLike) ? sharpeLike : null,
        riskFreeRatePct: riskFreeRatePct ?? null,
        methodology: 'Proxy Sharpe (this app\'s existing riskAdjustedReturnScore -- see metricRegistry.mjs): (trailing-1y price return - the disclosed per-market risk-free-rate assumption) / annualized realized volatility. Not a conventional Sharpe ratio.',
        status: Number.isFinite(sharpeLike) ? 'ok' : 'insufficient-history'
      },
      sortinoLike: {
        value: Number.isFinite(sortinoLike) ? sortinoLike : null,
        downsideDeviationPct: Number.isFinite(downsideDevPct) ? downsideDevPct : null,
        riskFreeRatePct: riskFreeRatePct ?? null,
        methodology: 'Proxy Sortino: (trailing-1y price return - the same disclosed risk-free-rate assumption) / annualized downside deviation (weekly returns below 0%, annualized the same weekly x sqrt(52) convention as realized volatility). Not a conventional Sortino ratio.',
        status: Number.isFinite(sortinoLike) ? 'ok' : 'insufficient-history'
      }
    },
    coverage: {
      weeklyPointsAvailable: stockPoints?.length ?? 0,
      dataSource: 'Yahoo Finance public chart feed, weekly interval, up to 5-year range -- the same series this app already uses for beta/volatility/drawdown/correlation.'
    }
  };
}

// Watchlist-level performance: weight-aggregates the per-stock performance
// objects above using the exact same illustrative weight vector every other
// portfolio aggregate in this app uses (resolveWeights) -- reuses
// portfolio.mjs's weightedAverage rather than a new averaging formula.
// Volatility and beta are NOT weighted averages of the per-stock figures;
// they reuse the already-computed real portfolio-level figures
// (portfolio.mjs's portfolioVolatilityPct/portfolioBeta, correlation-aware)
// passed in by the caller. Max drawdown has no equivalent real portfolio-
// level primitive in this app (would require a synthetic date-aligned
// portfolio index) and is disclosed as a diversification-blind weighted
// average of each holding's own drawdown, not a synthetic-index figure.
export function portfolioPerformance(stocks, weights, portfolioBetaValue, portfolioVolatilityPctValue, portfolioSharpeLike) {
  const resolved = stocks.map((stock, i) => ({ stock, weight: weights[i] })).filter(({ stock }) => !stock.unresolved && stock.performance);
  if (!resolved.length) return null;

  const weightByMarket = new Map();
  for (const { stock, weight } of resolved) weightByMarket.set(stock.market, (weightByMarket.get(stock.market) || 0) + weight);
  const totalWeight = [...weightByMarket.values()].reduce((a, b) => a + b, 0) || 1;
  const benchmarks = [...weightByMarket.entries()].map(([market, weight]) => {
    const info = resolved.find(({ stock }) => stock.market === market)?.stock.performance.benchmark;
    return { market, symbol: info?.symbol ?? null, name: info?.name ?? null, status: info?.status ?? 'unavailable', weightPct: number((weight / totalWeight) * 100) };
  });

  const periods = {};
  for (const key of ['1M', '3M', '6M', '1Y', '3Y', '5Y']) {
    const portfolioReturnPct = weightedAverage(resolved.map(({ stock, weight }) => [stock.performance.periods[key]?.stockReturnPct, weight]));
    const benchmarkReturnPct = weightedAverage(resolved.map(({ stock, weight }) => [stock.performance.periods[key]?.benchmarkReturnPct, weight]));
    periods[key] = {
      portfolioReturnPct, benchmarkReturnPct,
      excessReturnPct: Number.isFinite(portfolioReturnPct) && Number.isFinite(benchmarkReturnPct) ? number(portfolioReturnPct - benchmarkReturnPct) : null,
      status: Number.isFinite(portfolioReturnPct) ? 'ok' : 'insufficient-history'
    };
  }

  const cagr = {};
  for (const key of CAGR_PERIODS) {
    const portfolioCagrPct = weightedAverage(resolved.map(({ stock, weight }) => [stock.performance.cagr[key]?.stockCagrPct, weight]));
    const benchmarkCagrPct = weightedAverage(resolved.map(({ stock, weight }) => [stock.performance.cagr[key]?.benchmarkCagrPct, weight]));
    cagr[key] = {
      portfolioCagrPct, benchmarkCagrPct,
      excessCagrPct: Number.isFinite(portfolioCagrPct) && Number.isFinite(benchmarkCagrPct) ? number(portfolioCagrPct - benchmarkCagrPct) : null,
      status: Number.isFinite(portfolioCagrPct) ? 'ok' : 'insufficient-history'
    };
  }

  const maxDrawdownPct = weightedAverage(resolved.map(({ stock, weight }) => [stock.performance.risk.maxDrawdown.stockPct, weight]));

  return {
    benchmarks,
    weightingAssumption: 'Illustrative target weight (resolveWeights) -- the same weight vector every other portfolio aggregate in this app uses, not real brokerage holdings. Where holdings span more than one market, each holding is compared to its own market benchmark and the portfolio figure below is the weight-aggregated result, not a single blended index.',
    returnType: 'Price return -- dividends not included.',
    periods, cagr,
    risk: {
      volatilityPct: Number.isFinite(portfolioVolatilityPctValue) ? portfolioVolatilityPctValue : null,
      volatilityMethodology: Number.isFinite(portfolioVolatilityPctValue)
        ? 'Real portfolio-variance decomposition (weights x volatility x correlation) -- the same calculation positionRiskContribution() uses, not a correlation-blind weighted average.'
        : 'Unavailable -- needs the correlation matrix to have resolved (>=10 overlapping weekly price points per holding).',
      beta: Number.isFinite(portfolioBetaValue) ? portfolioBetaValue : null,
      maxDrawdownPct: Number.isFinite(maxDrawdownPct) ? maxDrawdownPct : null,
      maxDrawdownMethodology: 'Weight-aggregated average of each holding\'s own historical maximum drawdown -- a diversification-blind approximation, not a synthetic portfolio-index drawdown (individual holdings\' troughs may not have occurred on the same date).'
    },
    riskAdjusted: {
      sharpeLike: {
        value: Number.isFinite(portfolioSharpeLike) ? portfolioSharpeLike : null,
        methodology: 'Weight-aggregated average of each holding\'s own proxy Sharpe ratio (portfolio.mjs\'s existing portfolioRiskAdjustedReturn).'
      }
    },
    coverage: { holdingsWithPerformance: resolved.length, totalHoldings: stocks.length }
  };
}

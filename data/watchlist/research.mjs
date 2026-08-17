import { number, average } from '../util.mjs';
import { latest } from '../analytics/series.mjs';
import { debtToEquityPct, dupontRoe, roceDecomposition } from '../analytics/dupont.mjs';
import { workingCapitalEfficiency } from '../analytics/workingCapital.mjs';
import { marginTrend, marginStability } from '../analytics/margins.mjs';
import { capitalIntensity } from '../analytics/capitalIntensity.mjs';
import { earningsQuality } from '../analytics/earningsQuality.mjs';
import { buildStockMetrics } from '../analytics/metricsTable.mjs';
import { fairValueModel } from '../analytics/valuation.mjs';
import {
  sectorAllocation, watchlistAverages, resolveWeights, portfolioDashboard, weightedSectorAllocation, positionConcentration, portfolioQuality,
  portfolioBeta, portfolioRiskAdjustedReturn, riskAdjustedReturnScore, sectorContribution, positionRiskContribution, attributionBreakdown, factorExposure,
  portfolioVolatilityPct
} from '../analytics/portfolio.mjs';
import { benchmarkSymbolFor, relativeStrengthPct, supportResistance } from '../analytics/technicalLevels.mjs';
import { beta as computeBeta, dcfValuation, dcfAssumptions } from '../analytics/dcf.mjs';
import { isFinancialSector, financialSectorValuation } from '../analytics/financialValuation.mjs';
import { peHistoricalPercentile, pbHistoricalPercentile } from '../analytics/historicalPercentiles.mjs';
import { annualizedVolatilityPct, maxDrawdownPct as computeMaxDrawdownPct, percentileRank } from '../analytics/priceSeries.mjs';
import { relativeValuation } from '../analytics/relativeValuation.mjs';
import {
  cleanBars, atr14, adx14, onBalanceVolume, accumulationDistribution, volumeProfile, multiTimeframeTrend, technicalScores,
  adxInterpretation, atrPctOf, priceVsPointOfControl, volumeWeightedMomentum, trendPersistenceScore, breakoutQualityScore,
  volatilityAdjustedMomentum, institutionalAccumulationScore, technicalRegime, technicalSignalConfidence
} from '../analytics/technicalScorecard.mjs';
import { institutionalRisk } from '../analytics/institutionalRisk.mjs';
import { correlationMatrix, rollingCorrelation } from '../analytics/correlation.mjs';
import { scenarioAnalysis, currencyExposure } from '../analytics/scenarios.mjs';
import { metricMeta } from '../metadata/metricRegistry.mjs';
import { buildRecommendation, finalizeRecommendation } from '../scoring/scoringEngine.mjs';
import { fetchQuote, fetchPriceHistory, trendLabel, momentumLabel, volumeTrendLabel } from '../providers/yahooQuoteProvider.mjs';
import { getFundamentalsProvider } from '../providers/index.mjs';
import { fetchCompanyNews } from '../news/companyNews.mjs';
import { companyCache, benchmarkCache } from './diskCache.mjs';
import { snapshotCache } from './snapshotCache.mjs';
import { updateCompaniesMetadata, pruneAlertAcknowledgements } from './store.mjs';
import { buildPortfolioIntelligence } from '../decision/index.mjs';
import { portfolioExposureMatrix } from '../decision/exposureMatrix.mjs';
import { earningsIntelligence } from '../analytics/earningsAnalytics.mjs';
import { buildEventCalendar } from '../analytics/eventCalendar.mjs';
import { buildQuantResearch } from '../quant/factorEngine.mjs';
import { stockPerformance, portfolioPerformance, benchmarkPerformanceProfile } from '../quant/performanceEngine.mjs';
import { buildForwardFramework } from '../analytics/forwardFramework.mjs';
import { researchQuality } from '../scoring/researchQuality.mjs';

// Bundle staleness for the persistent per-symbol cache. Deliberately
// coarser than the in-memory quote/fundamentals caches in data/cache.mjs
// (2min / 60min) -- this one governs "does the automatic background
// refresh bother re-fetching this company at all," not in-request
// deduplication, so it can be generous without the dashboard ever looking
// stale to a user who reloads within the window.
const TTL_MS = Number(process.env.WATCHLIST_CACHE_TTL_MS) || 30 * 60 * 1000;

const DATA_LIMITATIONS = [
  'Piotroski F-Score and Altman Z-Score are not available: both require a Current Assets/Current Liabilities split that Screener.in\'s exposed schema bundles into non-decomposable "Other Assets"/"Other Liabilities" plugs.',
  'Enterprise Value, EV/EBITDA, Cash, and Net Debt are not available for the same reason (no explicit Cash line item on this data source) -- this also blocks EV/EBITDA historical percentile and the DCF model\'s ability to bridge Enterprise Value to Equity Value via net debt (see the Valuation tab\'s DCF methodology note).',
  'Current Ratio and Quick Ratio are not available for the same reason; the Balance Sheet tab\'s "Working Capital" column shows Working Capital Days instead of a rupee figure this source cannot supply.',
  'Fundamentals (10-year financials, ownership history, ratios, sector/industry classification) are sourced from Screener.in for India only; other markets show price and technical data only.',
  'Fair Value, Target Price, Upside and Margin of Safety (the reversion heuristic) are an in-house P/E and P/B reversion to the watchlist\'s own peer average, not analyst consensus or a DCF model. The DCF fair value alongside it is a separate in-house 2-stage discounted-FCF model with disclosed risk-free-rate/equity-risk-premium/terminal-growth assumptions (no live rate feed exists) -- see the Valuation tab.',
  'DCF is gated off for banks, NBFCs, insurers and asset managers (sector/industry-matched) -- a levered-FCF model does not map to a deposit-taking/lending/underwriting balance sheet. Those stocks show a justified Price-to-Book / excess-return valuation instead (ROE, CAPM cost of equity, sustainable-growth-implied fair P/B x book value per share) -- see data/analytics/financialValuation.mjs and the Valuation tab.',
  'The Recommendation (Strong Buy .. Sell) is one unified engine used everywhere in this app -- Quality 35% / Valuation 25% / Technical 15% / Risk 15% (inverted) / Relative positioning 10%, renormalized over only the buckets that resolve. A stock cannot show Buy or better while its own composite risk score is elevated (>=65) or its own valuation is materially overvalued (>20% above modeled fair value) -- both cap the rating to Hold, and Strong Buy additionally requires High confidence; any cap applied is disclosed in `recommendation.capNote`. Confidence (High/Medium/Low) blends data completeness, whether a real intrinsic-value model resolved, how many risk categories resolved, earnings stability, and the sector valuation model\'s own confidence.',
  'Sector/peer comparisons (sector median, sector leader, sector P/E, sector premium/discount, sector ranking) are computed from this watchlist\'s own companies only -- there is no market-wide sector database in this app.',
  'Beta, DCF fair value and WACC require a computable beta (India/US only, needs sufficient overlapping price history) -- unavailable for Global watchlists and recently-listed stocks, rather than assumed at a default of 1.',
  'Business-risk revenue concentration, customer concentration and execution risk have no data source (Screener exposes no segment/customer breakdown) and are not estimated. Governance pledge % and related-party exposure have no data source for the same reason. Sector risk (regulatory/commodity/competitive/technology-disruption) is a static, disclosed qualitative lookup this project maintains, not a live feed.',
  'Risk trend is a same-visit directional read off already-computed trend inputs -- this app stores no historical risk-score time series, so it is not a multi-period trend line.',
  'Conviction is a banding of the 12-factor composite score, not a separate analyst rating.',
  'Portfolio weights are an optional, user-entered allocation target (%), not real currency holdings or share counts -- "Total portfolio value" and scenario impacts are illustrative indices, not brokerage valuations. Cash allocation is likewise an optional, user-entered target the invested weights normalize against, not a real cash balance.',
  'Scenario analysis is an illustrative stress test built from each holding\'s real leverage/interest-coverage/beta/historical-drawdown/sector/earnings-quality characteristics, not a historical backtest or a factor model. Currency shock direction/magnitude is a static, sector-keyword-matched exposure heuristic, not a disclosed FX hedge position or revenue-mix figure.',
  'Factor exposure (Value/Growth/Quality/Momentum/Size) is an in-house within-watchlist percentile tilt over already-computed metrics -- not a commercial risk-factor model (e.g. Barra/Axioma) and not benchmarked against a market-wide factor universe.',
  'Rolling correlation, correlation stability and position-level marginal risk contribution share the same ~1-2 year weekly-price-history coverage constraint as the correlation matrix above -- limited to symbols with at least 10-20 overlapping weekly price points.',
  'Relative-valuation rankings/percentiles/dispersion (sector-adjusted rank, multi-factor peer rank, sector-normalized score, watchlist percentile, relative attractiveness) are computed from this watchlist\'s own companies only, same root constraint as the existing sector median/leader figures -- there is no market-wide peer universe in this app.',
  'Earnings Intelligence (Phase 6) computes real quarter-over-quarter and year-over-year revenue/net-profit/operating-margin deltas from Screener\'s own scraped quarterly results, framed as deviation vs. this company\'s own trailing 4-quarter average -- not a beat/miss vs. analyst consensus, since no consensus-estimate data source exists. Next earnings date, days remaining, expected impact, historical earnings reaction, guidance changes, management commentary and estimate-revision signals have no data source in this app and render an explicit "Future Integration" status rather than an invented date or estimate. The Event Calendar is limited to real, dated company news items for the same reason -- dividend ex-dates, buybacks and regulatory/policy events have no dated source (Screener exposes only a trailing annual dividend payout %).',
  'News impact levels and catalyst timelines are keyword-based heuristics over the headline text, not editorial ratings or confirmed dates from the source.',
  'Benchmark & Performance (Phase 7 Stage 2) reports price returns only -- this app has no dividend/total-return data source, so period returns, CAGR and the Sharpe-like/Sortino-like ratios never include reinvested dividends and are not total-shareholder-return figures. Both risk-adjusted ratios are disclosed proxies (trailing-1y return over annualized volatility/downside deviation), not conventional-methodology Sharpe/Sortino ratios. A period/CAGR renders "insufficient history" rather than an extrapolated figure when the weekly price series does not reach back far enough within its tolerance window; a market with no defensible single benchmark (e.g. Global) renders "N/A -- benchmark unavailable" rather than a substituted index. Portfolio-level max drawdown is a diversification-blind weighted average of each holding\'s own drawdown, not a synthetic portfolio-index drawdown.',
  'The Quantitative Factor Score (Phase 7) is a distinct, more granular capability from the existing Factor Exposure tilt (Value/Growth/Quality/Momentum/Size) -- Factor Exposure is a portfolio-level, weight-aggregated within-watchlist percentile with no per-metric disclosure; the Factor Score is a per-company profile disclosing every raw sub-metric, its normalized percentile, direction, data status and confidence, sector-relative first (falling back to watchlist-relative, then to explicit "insufficient data"). Neither replaces the other, and neither replaces the Portfolio Action Score or the unified recommendation engine, which remain this app\'s primary decision-layer signals -- see data/quant/factorEngine.mjs.'
];

async function loadCompanyBundle(company, networkPass, forceSymbols) {
  const cached = await companyCache.read(company.symbol);
  // `forceSymbols` (Watchlists tab's per-company "Refresh" action) forces a
  // fetch for exactly those symbols regardless of networkPass/staleness,
  // while every other company in the watchlist follows the normal
  // none/incremental/full rule below -- a targeted refresh, not a full
  // watchlist refetch.
  const needsFetch = !!forceSymbols?.has(company.symbol) || networkPass === 'full' || (networkPass === 'incremental' && companyCache.isStale(cached, TTL_MS));
  if (!needsFetch) return { bundle: cached, stale: companyCache.isStale(cached, TTL_MS), fetched: false };
  try {
    const [quote, fundamentals, priceHistory] = await Promise.all([
      fetchQuote(company.symbol),
      getFundamentalsProvider(company.market)(company.symbol),
      fetchPriceHistory(company.symbol).catch(() => null)
    ]);
    const news = await fetchCompanyNews(company, company.market);
    const now = new Date().toISOString();
    const bundle = { symbol: company.symbol, fetchedAt: now, provider: fundamentals?.source ?? 'Unavailable', market: company.market, quote, fundamentals, priceHistory, news, newsFetchedAt: now };
    await companyCache.write(company.symbol, bundle);
    return { bundle, stale: false, fetched: true };
  } catch {
    // A transient fetch failure falls back to whatever's cached (even if
    // stale) rather than blanking a row that had real data a moment ago.
    return { bundle: cached, stale: true, fetched: false };
  }
}

async function loadBenchmarkQuote(market, networkPass) {
  const symbol = benchmarkSymbolFor(market);
  if (!symbol) return null;
  const cached = await benchmarkCache.read(symbol);
  const needsFetch = networkPass === 'full' || (networkPass === 'incremental' && benchmarkCache.isStale(cached, TTL_MS));
  if (networkPass === 'none' || !needsFetch) return cached ?? null;
  try {
    const [quote, priceHistory] = await Promise.all([fetchQuote(symbol), fetchPriceHistory(symbol).catch(() => null)]);
    const bundle = { symbol, fetchedAt: new Date().toISOString(), quote, priceHistory };
    await benchmarkCache.write(symbol, bundle);
    return bundle;
  } catch { return cached ?? null; }
}

function exchangeFromSymbol(symbol, market) {
  if (market !== 'India') return null;
  if (symbol.endsWith('.BO')) return 'BSE';
  if (symbol.endsWith('.NS')) return 'NSE';
  return null;
}

const emptyStock = (company) => ({
  symbol: company.symbol, name: company.name, sector: company.sector, industry: company.industry,
  exchange: company.exchange, market: company.market, notes: company.notes,
  currency: null, price: null, change: null, pe: null, marketCap: null, marketCapUnit: null,
  metrics: {}, fundamentals: null, fundamentalsAnalytics: null, recommendation: null, signal: 'N/A', score: 0,
  valuation: {}, dcf: { available: false, reason: 'No data fetched yet' }, financialValuation: null, relativeValuation: null,
  technicalScorecard: null, institutionalRisk: null, quantFactors: null, performance: null,
  targetWeightPct: company.targetWeightPct ?? null, effectiveWeightPct: null,
  forwardFramework: buildForwardFramework(), researchQuality: null,
  news: [], newsFetchedAt: null, fetchedAt: null, unresolved: true, stale: true
});

// Builds the full dashboard payload for one watchlist. `networkPass`
// controls how much real fetching happens this call ('none' = cache-only /
// instant, used for startup & watchlist switches; 'incremental' = only
// missing/stale companies, the automatic background refresh; 'full' =
// every company, the manual "Refresh Data" button). The returned `stocks`
// array is always in the watchlist's own order -- nothing here sorts or
// truncates it; sorted views (e.g. a Top-Opportunities ranking) are the
// frontend's job to compute from this same array without touching it.
export async function buildResearch(watchlist, { networkPass = 'none', forceSymbols } = {}) {
  const companies = watchlist.companies;
  const results = await Promise.all(companies.map(company => loadCompanyBundle(company, networkPass, forceSymbols)));

  const markets = [...new Set(companies.map(c => c.market))];
  const benchmarkEntries = await Promise.all(markets.map(async (market) => [market, await loadBenchmarkQuote(market, networkPass)]));
  const benchmarkByMarket = Object.fromEntries(benchmarkEntries);
  // -- Phase 7 Stage 2 (data/quant/performanceEngine.mjs): the benchmark-side
  // half of the Benchmark & Performance Engine (period returns/CAGR/
  // volatility/drawdown) is computed exactly ONCE per market here and reused
  // across every stock in that market below -- never recomputed per-company
  // (performance-discipline requirement; a per-stock recompute of an
  // identical NIFTY/S&P calculation was measured to regress cache-only
  // response time and was fixed before this stage shipped, see roadmap.md). --
  const benchmarkPerfByMarket = Object.fromEntries(markets.map(market => [market, benchmarkPerformanceProfile(market, benchmarkByMarket[market])]));

  // Backfill metadata a fetch just resolved (name/sector/industry/exchange)
  // that the watchlist entry didn't have yet -- applied in place on
  // `companies` so this same render reflects it, and persisted in one
  // batched read-modify-write (see updateCompaniesMetadata's doc comment:
  // N concurrent single-company writes to the same watchlist file race and
  // silently drop all but the last one).
  const patchesBySymbol = {};
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const { bundle, fetched } = results[i];
    if (!fetched || !bundle?.quote) continue;
    const patch = {};
    if (company.name === company.symbol && (bundle.quote.longName || bundle.quote.shortName)) patch.name = bundle.quote.longName || bundle.quote.shortName;
    const classification = bundle.fundamentals?.classification;
    if (!company.sector && classification?.sector) patch.sector = classification.sector;
    if (!company.industry && classification?.industry) patch.industry = classification.industry;
    if (!company.exchange) { const exch = exchangeFromSymbol(company.symbol, company.market); if (exch) patch.exchange = exch; }
    if (!Object.keys(patch).length) continue;
    Object.assign(company, patch);
    patchesBySymbol[company.symbol] = patch;
  }
  if (Object.keys(patchesBySymbol).length) {
    try { await updateCompaniesMetadata(watchlist.id, patchesBySymbol); } catch { /* best-effort persistence */ }
  }

  const rawPe = results.map(r => r.bundle?.fundamentals?.snapshot?.pe).filter(Number.isFinite);
  const industryPe = rawPe.length ? number(rawPe.reduce((a, b) => a + b, 0) / rawPe.length) : null;
  const rawPb = results.map(r => {
    const snap = r.bundle?.fundamentals?.snapshot, quote = r.bundle?.quote;
    return snap?.bookValue > 0 && Number.isFinite(quote?.regularMarketPrice) ? quote.regularMarketPrice / snap.bookValue : null;
  }).filter(Number.isFinite);
  const industryPb = rawPb.length ? number(rawPb.reduce((a, b) => a + b, 0) / rawPb.length) : null;

  const weights = resolveWeights(companies, watchlist.cashTargetPct);

  const stocks = companies.map((company, i) => {
    const { bundle, stale } = results[i];
    if (!bundle?.quote) return emptyStock(company);

    const quote = bundle.quote, fundamentals = bundle.fundamentals || {};
    const snapshot = fundamentals.snapshot || {};
    const bs = fundamentals.annual?.balanceSheet, pl = fundamentals.annual?.profitLoss, cf = fundamentals.annual?.cashFlow;
    const pb = snapshot.bookValue > 0 && Number.isFinite(quote.regularMarketPrice) ? number(quote.regularMarketPrice / snapshot.bookValue) : null;
    const metrics = buildStockMetrics(quote, fundamentals, null);
    const valuation = fairValueModel({ quote, fundamentals, industryPe, industryPb, epsCagr5: metrics.epsCagr5y, industryPeSampleSize: rawPe.length, industryPbSampleSize: rawPb.length });
    const relStrength = relativeStrengthPct(quote.oneYearReturnPct, benchmarkByMarket[company.market]?.quote?.oneYearReturnPct);
    const levels = supportResistance(quote);
    const trend = trendLabel(quote.regularMarketPrice, quote.fiftyDayAverage, quote.twoHundredDayAverage);

    // -- Market-risk / valuation-engine inputs: beta, realized volatility and
    // max drawdown are computed from the new weekly priceHistory series
    // (yahooQuoteProvider.mjs's fetchPriceHistory), against the same-market
    // benchmark's own priceHistory. Null (not a fabricated default) when the
    // benchmark or enough overlapping history isn't available -- see
    // dcf.mjs's `beta()` doc comment. --
    const benchmarkPoints = benchmarkByMarket[company.market]?.priceHistory?.points;
    const betaValue = computeBeta(bundle.priceHistory?.points, benchmarkPoints);
    const volatilityPct = annualizedVolatilityPct(bundle.priceHistory?.points);
    const maxDrawdownPct = computeMaxDrawdownPct(bundle.priceHistory?.points);
    const peHistPercentile = peHistoricalPercentile(pl, bundle.priceHistory, snapshot.pe);
    const pbHistPercentile = pbHistoricalPercentile(bs, bundle.priceHistory, snapshot, pb);

    // -- Sector-aware valuation model selection (P0-1): a levered-FCF DCF is
    // not analytically meaningful for a bank/NBFC/insurer/asset manager --
    // see financialValuation.mjs. Those stocks get a justified-P/B / excess-
    // return / cost-of-equity valuation instead; every other sector keeps
    // the existing 2-stage DCF/WACC/reverse-DCF/sensitivity engine unchanged. --
    const sectorIsFinancial = isFinancialSector(company.sector, company.industry || fundamentals?.classification?.industry);
    const dcf = sectorIsFinancial
      ? { available: false, sectorExcluded: true, reason: 'DCF not applicable for financial institutions', assumptions: dcfAssumptions(company.market) }
      : dcfValuation({ market: company.market, fundamentals, quote, betaValue, reversionFairValue: valuation.fairValue });
    const financialValuation = sectorIsFinancial
      ? financialSectorValuation({ market: company.market, fundamentals, quote, betaValue })
      : null;

    const netProfit = latest(pl, 'netProfit');
    const earningsYield = netProfit != null && snapshot.marketCap > 0 ? number((netProfit / snapshot.marketCap) * 100) : null;
    const sectorPremiumDiscountPe = null; // filled in after the sector-median pass below (relativeValuation) -- placeholder kept out of this object

    // -- Risk-adjusted return (Phase 3b): a per-stock proxy Sharpe ratio
    // reusing the trailing-1y price return already fetched and the same
    // disclosed per-market risk-free-rate assumption the DCF/WACC model
    // already uses (dcfAssumptions) -- see portfolio.mjs's doc comment. --
    const riskFreeRatePctForMarket = dcfAssumptions(company.market)?.riskFreeRatePct;
    const riskAdjReturn = riskAdjustedReturnScore(quote.oneYearReturnPct, volatilityPct, riskFreeRatePctForMarket);

    // -- Phase 7 Stage 2 Benchmark & Performance Engine
    // (data/quant/performanceEngine.mjs): pure composition over the beta/
    // volatility/max-drawdown/proxy-Sharpe/benchmark-bundle values already
    // computed above -- no new fetch, no recomputation of any of them. Adds
    // multi-period return/CAGR measurement, drawdown recovery detail and a
    // proxy Sortino ratio, all benchmark-relative using the same per-market
    // benchmark bundle (benchmarkByMarket) already loaded once above. --
    const performance = stockPerformance({
      stockPoints: bundle.priceHistory?.points, benchmarkProfile: benchmarkPerfByMarket[company.market],
      oneYearReturnPct: quote.oneYearReturnPct, betaValue, volatilityPct, maxDrawdownPct, sharpeLike: riskAdjReturn, riskFreeRatePct: riskFreeRatePctForMarket
    });

    // -- Technical scorecard: ADX/ATR/OBV/A-D/volume profile/breakout all
    // reuse the daily OHLCV fetchQuote() already pulled in one call (see
    // technicalScorecard.mjs) -- zero new network calls. Multi-timeframe
    // trend additionally uses the weekly priceHistory series. --
    const bars = cleanBars(quote.ohlcv);
    const adx = adx14(bars);
    const atr = atr14(bars);
    const obv = onBalanceVolume(bars);
    const accDist = accumulationDistribution(bars);
    const profile = volumeProfile(bars);
    const weeklyCloses = (bundle.priceHistory?.points || []).map(p => p.close);
    const timeframes = multiTimeframeTrend(trend, weeklyCloses);
    const scores = technicalScores({ adx: adx.adx, atr, price: quote.regularMarketPrice, rsi: quote.rsi14, macdHistogram: quote.macd?.histogram, volume: quote.regularMarketVolume, avgVolume20: quote.avgVolume20, resistance: levels.resistance, atHigh: levels.atHigh, obvTrend: obv.trend, multiTimeframe: timeframes });

    // -- Technical engine enhancement (Phase 3b): ADX interpretation/ATR%
    // normalization/volume-profile support-resistance read, 5 new in-house
    // 0-100 scores, a regime classification and a signal-confidence band --
    // all off the same bars/indicators already computed above, zero new
    // network calls. --
    const atrPctValue = atrPctOf(atr, quote.regularMarketPrice);
    const advancedTechnicalScores = {
      volumeWeightedMomentum: volumeWeightedMomentum(bars),
      trendPersistenceScore: trendPersistenceScore(bars),
      breakoutQualityScore: breakoutQualityScore({ adx: adx.adx, volume: quote.regularMarketVolume, avgVolume20: quote.avgVolume20, atHigh: levels.atHigh, resistance: levels.resistance, price: quote.regularMarketPrice }),
      volatilityAdjustedMomentum: volatilityAdjustedMomentum(scores.momentumScore, atrPctValue),
      institutionalAccumulationScore: institutionalAccumulationScore({ obvTrend: obv.trend, accDistTrend: accDist.trend, diPlus: adx.diPlus, diMinus: adx.diMinus, bars })
    };
    const technicalRegimeLabel = technicalRegime({ adx: adx.adx, multiTimeframe: timeframes, volatilityScore: scores.volatilityScore, trendStrengthScore: scores.trendStrengthScore });
    const signalConfidence = technicalSignalConfidence({ adx: adx.adx, rsi: quote.rsi14, macdHistogram: quote.macd?.histogram, obvTrend: obv.trend, confirmationStrength: timeframes.confirmationStrength });

    const cashConversionCycle = workingCapitalEfficiency(fundamentals.annual?.ratios)?.cashConversionCycle;
    const marginStabilityValue = marginStability(pl);
    const risk = institutionalRisk({
      interestCoverage: metrics.interestCoverage, fundamentals, betaValue, volatilityPct, maxDrawdownPct,
      peHistoricalPercentile: peHistPercentile.percentile, promoterHoldingTrend: metrics.promoterHoldingTrend,
      sector: company.sector, priceTrend: trend, cashConversionCycle, marginStabilityValue
    });

    // -- Unified recommendation engine (P0-2), pass 1: every bucket except
    // Relative positioning, which needs the full watchlist assembled first
    // (see the relativeValuation second pass below, which calls
    // finalizeRecommendation() to fold it in and produce the final rating). --
    const primaryValuationModel = dcf.available ? dcf : (financialValuation?.available ? financialValuation : null);
    const currentPrice = number(quote.regularMarketPrice);
    const valuationMarginPct = primaryValuationModel && currentPrice > 0
      ? number(((primaryValuationModel.base - currentPrice) / currentPrice) * 100)
      : (Number.isFinite(valuation.marginOfSafetyPct) ? valuation.marginOfSafetyPct : null);
    const recommendation = buildRecommendation({ quote, fundamentals, industryPe, dcf, financialValuation, institutionalRisk: risk, technicalScores: scores, valuationMarginPct });

    // Dashboard "Key risks" flags: named conditions read off fields already
    // computed above -- no new calculation, just a labeled filter so the
    // Dashboard doesn't have to re-derive thresholds the frontend can't see.
    const keyRiskFlags = {
      overvaluation: (peHistPercentile.percentile ?? 0) >= 80,
      weakBalanceSheet: (risk.categories.financial ?? 0) >= 65,
      earningsDeterioration: risk.riskTrend === 'Deteriorating' && (marginStabilityValue ?? 0) > 8,
      technicalBreakdown: (scores.trendStrengthScore ?? 100) < 35 && Number.isFinite(quote.regularMarketPrice) && quote.regularMarketPrice < (quote.fiftyDayAverage ?? Infinity) && quote.regularMarketPrice < (quote.twoHundredDayAverage ?? Infinity)
    };

    return {
      symbol: company.symbol, name: company.name || quote.longName || quote.shortName || company.symbol,
      sector: company.sector, industry: company.industry, exchange: company.exchange, market: company.market, notes: company.notes,
      currency: quote.currency, price: number(quote.regularMarketPrice), change: number(quote.regularMarketChangePercent),
      marketCap: number(snapshot.marketCap), marketCapUnit: snapshot.marketCap != null ? 'Cr' : null,
      pe: number(snapshot.pe), pb, dividendYield: number(snapshot.dividendYield),
      debtToEquity: debtToEquityPct(bs), debt: latest(bs, 'borrowings'),
      roce: number(snapshot.roce), roe: number(snapshot.roe),
      twenty: number(quote.twentyDayAverage), fifty: number(quote.fiftyDayAverage), hundred: number(quote.hundredDayAverage), twoHundred: number(quote.twoHundredDayAverage),
      high52: number(quote.fiftyTwoWeekHigh), low52: number(quote.fiftyTwoWeekLow),
      volume: quote.regularMarketVolume || null, source: fundamentals.source,
      rsi: number(quote.rsi14), macd: quote.macd || { macdLine: null, signalLine: null, histogram: null },
      trend, momentum: momentumLabel(quote.rsi14), volumeTrend: volumeTrendLabel(quote.regularMarketVolume, quote.avgVolume20),
      relativeStrengthPct: relStrength, support: levels.support, resistance: levels.resistance, atHigh: levels.atHigh,
      industryPe, industryPb, recommendation, signal: recommendation.rating,
      score: recommendation.compositeScore ?? recommendation.technicalScore ?? 0,
      valuation, earningsYield, fcfYield: metrics.fcfYield, sectorPremiumDiscountPe,
      beta: betaValue, volatilityPct, maxDrawdownPct, riskAdjustedReturnScore: riskAdjReturn, performance,
      peHistoricalPercentile: peHistPercentile.percentile, peHistory: peHistPercentile.history,
      pbHistoricalPercentile: pbHistPercentile.percentile, pbHistory: pbHistPercentile.history,
      dcf, financialValuation,
      technicalScorecard: {
        adx: adx.adx, diPlus: adx.diPlus, diMinus: adx.diMinus, adxInterpretation: adxInterpretation(adx.adx),
        atr, atrPct: atrPctValue, obv, accDist,
        volumeProfile: { ...profile, priceVsPointOfControl: priceVsPointOfControl(quote.regularMarketPrice, profile.pointOfControl) },
        timeframes, scores, advancedScores: advancedTechnicalScores, regime: technicalRegimeLabel, signalConfidence
      },
      institutionalRisk: risk, keyRiskFlags,
      targetWeightPct: company.targetWeightPct ?? null, effectiveWeightPct: weights[i] ?? null,
      fundamentals, metrics,
      fundamentalsAnalytics: {
        dupont: dupontRoe(fundamentals.annual?.profitLoss, bs, snapshot.roe),
        roce: roceDecomposition(fundamentals.annual?.profitLoss, fundamentals.annual?.ratios),
        marginTrend: marginTrend(fundamentals.annual?.profitLoss),
        marginStability: marginStabilityValue,
        workingCapital: workingCapitalEfficiency(fundamentals.annual?.ratios),
        capitalIntensity: capitalIntensity(fundamentals.annual?.profitLoss, bs),
        earningsQuality: earningsQuality(fundamentals.annual?.profitLoss, bs, fundamentals.annual?.cashFlow)
      },
      news: bundle.news || [], newsFetchedAt: bundle.newsFetchedAt || null,
      // -- Phase 6 Earnings Intelligence (data/analytics/earningsAnalytics.mjs):
      // real QoQ/YoY deltas over the already-scraped quarterly P&L series,
      // plus an explicit Future-Integration status for every calendar-
      // dependent field this app has no data source for. --
      earningsIntelligence: earningsIntelligence(fundamentals),
      // -- Foundation upgrade: forward-looking framework contracts (§6-§9) --
      // schema-only, no real data source exists for any of these four
      // concepts yet (see data/analytics/forwardFramework.mjs). --
      forwardFramework: buildForwardFramework(),
      fetchedAt: bundle.fetchedAt, stale
    };
  });

  // -- Relative valuation (sector median/leader/historical/watchlist avg,
  // scores, rankings, dispersion) needs the full stocks array already
  // assembled -- runs as a second pass and is attached back per-symbol.
  // Relative strength percentile (technical engine enhancement) is the same
  // shape of second pass: it needs every stock's relativeStrengthPct already
  // computed before a watchlist-wide percentile is meaningful. --
  const { bySymbol: relativeValuationBySymbol, valuationDispersion } = relativeValuation(stocks);
  const rsUniverse = stocks.filter(s => !s.unresolved).map(s => s.relativeStrengthPct).filter(Number.isFinite);
  for (const stock of stocks) {
    const rv = relativeValuationBySymbol.get(stock.symbol);
    if (rv) { stock.relativeValuation = rv; stock.sectorPremiumDiscountPe = rv.premiumDiscountScore; }
    stock.relativeStrengthPercentile = Number.isFinite(stock.relativeStrengthPct) && rsUniverse.length >= 3 ? percentileRank(stock.relativeStrengthPct, rsUniverse) : null;
    if (!stock.recommendation) continue;
    // -- Unified recommendation engine, pass 2: fold in Relative positioning
    // (10% weight) now that sector/watchlist peer comparison has resolved,
    // and recompose the tier/confidence/consistency read -- this is the
    // recommendation every tab renders (see scoringEngine.mjs). --
    stock.recommendation = finalizeRecommendation({
      recommendation: stock.recommendation, relativeValuationScore: rv?.relativeValuationScore ?? null,
      dcf: stock.dcf, financialValuation: stock.financialValuation, institutionalRisk: stock.institutionalRisk,
      technicalRegime: stock.technicalScorecard?.regime ?? null, peerCompleteness: rv?.peerCompleteness ?? null
    });
    stock.signal = stock.recommendation.rating;
    stock.score = stock.recommendation.compositeScore ?? stock.recommendation.technicalScore ?? 0;
    if (stock.valuation) stock.valuation.convictionLevel = stock.recommendation.confidence;
    // -- Foundation upgrade: Research Quality Gates (§13 + §18) -- runs here,
    // not in the per-stock pass above, because it reads peerCompleteness off
    // relativeValuation, which only resolves in this second pass. --
    stock.researchQuality = researchQuality(stock);
  }

  // -- Phase 7 Stage 1 quantitative factor engine (data/quant/factorEngine.mjs):
  // pure normalization/aggregation over the per-stock fields already
  // finalized above -- no new fetch, no duplicate of any existing analytics
  // calculation (see system.md §3.9). Runs after the recommendation/relative-
  // valuation second pass so technical/risk/relative-strength inputs are
  // final, same "needs the full stocks array" shape as relativeValuation()
  // above. Attached per-stock as `stock.quantFactors`, watchlist-level
  // summary attached to the returned payload as `quant`.
  const quant = buildQuantResearch(stocks);
  for (const stock of stocks) stock.quantFactors = quant.bySymbol.get(stock.symbol) || null;

  const averages = watchlistAverages(stocks);
  const allocation = sectorAllocation(stocks);
  const avgScore = Math.round(averages.score ?? 50);
  const trend = (averages.change ?? 0) >= 0 ? 'Constructive' : 'Cautious';
  const recommendationLabel = avgScore >= 70 ? 'OVERWEIGHT' : avgScore >= 55 ? 'SELECTIVE' : 'NEUTRAL';
  const sectorCount = allocation.allocation.length;

  // -- Portfolio analytics: dashboard KPIs, diversification, quality and
  // scenario analysis all use the resolved illustrative weights above.
  // Correlation reuses the raw per-symbol weekly price series still held on
  // `results` (not serialized onto the trimmed stock objects). --
  const dashboard = portfolioDashboard(stocks, weights);
  const weightedSectors = weightedSectorAllocation(stocks, weights);
  const positions = positionConcentration(stocks, weights);
  const quality = portfolioQuality(stocks, weights);
  const priceSeriesEntries = stocks.map((stock, i) => ({ symbol: stock.symbol, name: stock.name, points: results[i].bundle?.priceHistory?.points || [] }));
  const correlation = correlationMatrix(priceSeriesEntries);
  const rolling = rollingCorrelation(priceSeriesEntries);
  const scenarios = scenarioAnalysis(stocks.filter(s => !s.unresolved).map(stock => ({
    symbol: stock.symbol, name: stock.name, weight: stock.effectiveWeightPct,
    debtToEquity: stock.debtToEquity, interestCoverage: stock.metrics?.interestCoverage, beta: stock.beta, maxDrawdownPct: stock.maxDrawdownPct,
    peHistoricalPercentile: stock.peHistoricalPercentile, businessRiskScore: stock.institutionalRisk?.categories?.business,
    earningsQualityScore: stock.fundamentalsAnalytics?.earningsQuality?.score, sectorCurrencyExposure: currencyExposure(stock.sector).exposure
  })));

  // -- Portfolio analytics calibration (Phase 3b): beta, risk-adjusted
  // return, sector/position risk contribution, quality/valuation
  // attribution and factor exposure -- all pure aggregation over the
  // already-resolved illustrative weights and already-computed per-stock
  // fields above, no new fetch. --
  const volatilityBySymbol = new Map(stocks.map(stock => [stock.symbol, stock.volatilityPct]));
  const weightBySymbolForVol = new Map(stocks.map((s, i) => [s.symbol, weights[i]]));
  const portfolioBetaValue = portfolioBeta(stocks, weights);
  const portfolioRiskAdjReturn = portfolioRiskAdjustedReturn(stocks, weights);
  const portfolio = {
    weights: Object.fromEntries(stocks.map((s, i) => [s.symbol, weights[i]])),
    cashTargetPct: watchlist.cashTargetPct ?? 0,
    dashboard, sectorAllocation: weightedSectors, positionConcentration: positions,
    diversificationScore: [weightedSectors.diversificationScore, positions.diversificationScore].filter(Number.isFinite).length
      ? Math.round(average([weightedSectors.diversificationScore, positions.diversificationScore].filter(Number.isFinite))) : null,
    quality, correlation, rollingCorrelation: rolling, scenarios,
    beta: portfolioBetaValue, riskAdjustedReturn: portfolioRiskAdjReturn,
    sectorContribution: sectorContribution(stocks, weights),
    positionRiskContribution: positionRiskContribution(stocks, weights, correlation, volatilityBySymbol),
    qualityAttribution: attributionBreakdown(stocks, weights, s => s.recommendation?.compositeScore),
    valuationAttribution: attributionBreakdown(stocks, weights, s => s.recommendation?.components?.valuation?.score),
    factorExposure: factorExposure(stocks, weights),
    // -- Phase 6 Portfolio Exposure Matrix (data/decision/exposureMatrix.mjs):
    // pure composition over each stock's already-known sector plus disclosed
    // static sensitivity lookup tables -- no new fetch, no per-stock
    // recomputation. --
    exposureMatrix: portfolioExposureMatrix(stocks),
    // -- Phase 7 Stage 2 Benchmark & Performance Engine
    // (data/quant/performanceEngine.mjs): weight-aggregates the per-stock
    // `performance` objects above using the same illustrative weight vector
    // every other portfolio aggregate here uses; volatility/beta reuse the
    // already-computed real portfolio-level figures (portfolioVolatilityPct,
    // portfolioBetaValue) rather than a correlation-blind approximation. --
    performance: portfolioPerformance(
      stocks, weights, portfolioBetaValue,
      portfolioVolatilityPct(correlation?.symbols || [], weightBySymbolForVol, volatilityBySymbol, correlation),
      portfolioRiskAdjReturn
    )
  };

  // -- Dashboard executive summary: 4 status lines rolled up from fields
  // already computed above (relativeValuation premium/discount, institutional
  // risk composite, rating + upside) -- no independent calculation. --
  const resolvedStocks = stocks.filter(s => !s.unresolved);
  const avgPremiumDiscount = average(resolvedStocks.map(s => s.relativeValuation?.premiumDiscountScore).filter(Number.isFinite));
  const valuationStatus = avgPremiumDiscount == null ? 'N/A' : avgPremiumDiscount > 10 ? 'Rich vs. sector peers' : avgPremiumDiscount < -10 ? 'Cheap vs. sector peers' : 'Fairly valued vs. sector peers';
  const avgCompositeRisk = average(resolvedStocks.map(s => s.institutionalRisk?.compositeRiskScore).filter(Number.isFinite));
  const riskStatusLabel = avgCompositeRisk == null ? 'N/A' : avgCompositeRisk >= 65 ? 'Elevated' : avgCompositeRisk >= 40 ? 'Moderate' : 'Low';
  const opportunityCount = resolvedStocks.filter(s => ['Strong Buy', 'Buy'].includes(s.signal) && (s.valuation?.upsidePct ?? 0) > 0).length;
  const executiveSummary = {
    watchlistRating: recommendationLabel,
    valuationStatus, avgPremiumDiscount: avgPremiumDiscount != null ? number(avgPremiumDiscount) : null,
    riskStatus: riskStatusLabel, avgCompositeRisk: avgCompositeRisk != null ? Math.round(avgCompositeRisk) : null,
    opportunityStatus: opportunityCount > 0 ? `${opportunityCount} name${opportunityCount === 1 ? '' : 's'} rated Buy/Strong Buy with positive upside` : 'No names currently rated Buy/Strong Buy with positive upside'
  };

  // -- Phase 4 decision layer: Portfolio Action Score, change detection,
  // alerts, portfolio health and rebalancing -- all pure composition over
  // the `stocks`/`portfolio` fields already computed above
  // (data/decision/index.mjs), plus one run-over-run snapshot read/write
  // (data/watchlist/snapshotCache.mjs) so "since last refresh" means what it
  // says. Stage 3 perf fix: buildPortfolioIntelligence returns `nextSnapshot
  // = null` whenever no company genuinely advanced this request (the
  // overwhelming majority of requests -- cache-only reads), so the disk
  // write below is skipped entirely instead of rewriting an identical file
  // on every request; when it does write, it's fire-and-forget (already
  // best-effort/error-swallowed, so nothing in the response depends on it
  // completing before returning).
  const previousSnapshot = await snapshotCache.read(watchlist.id);
  const intelligencePayload = { watchlistId: watchlist.id, stocks, portfolio };
  const { intelligence, nextSnapshot, reactivatedAlertIds } = buildPortfolioIntelligence(intelligencePayload, previousSnapshot, watchlist.acknowledgedAlertIds || []);
  if (nextSnapshot) snapshotCache.write(watchlist.id, nextSnapshot).catch(() => { /* best-effort persistence */ });
  if (reactivatedAlertIds.length) { try { await pruneAlertAcknowledgements(watchlist.id, reactivatedAlertIds); } catch { /* best-effort persistence */ } }

  return {
    watchlistId: watchlist.id, watchlistName: watchlist.name, generatedAt: new Date().toISOString(),
    recommendation: recommendationLabel, score: avgScore, trend, stocks,
    averages, sectorAllocation: allocation, industryPe, industryPb, valuationDispersion,
    portfolio, executiveSummary, intelligence, metricMeta: metricMeta(),
    // -- Phase 7 Stage 1 quantitative research domain (data/quant/):
    // watchlist-level roll-up of the per-stock `quantFactors` computed above
    // -- factor leadership/weakness, per-category averages, and coverage.
    // Full per-stock detail lives on each stock's own `quantFactors`. --
    quant: { ...quant.summary, methodology: quant.methodology },
    // -- Phase 6 Portfolio Event Calendar (data/analytics/eventCalendar.mjs):
    // pure composition over every stock's already-fetched news items -- no
    // new fetch, no fabricated dates for the event types this app can't
    // source (see DATA_LIMITATIONS below). --
    eventCalendar: buildEventCalendar(stocks),
    dataLimitations: DATA_LIMITATIONS,
    summary: `${watchlist.name} tracks ${stocks.length} compan${stocks.length === 1 ? 'y' : 'ies'} across ${sectorCount} sector${sectorCount === 1 ? '' : 's'}. For India, 10-year financials, ownership history and ratios are enriched from Screener.in; prices and trend inputs come from Yahoo Finance's public chart feed. Treat the output as research support -- not investment advice -- and validate every decision against company filings.`
  };
}

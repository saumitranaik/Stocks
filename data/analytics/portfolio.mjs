import { number } from '../util.mjs';
import { percentileRank } from './priceSeries.mjs';

const avg = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? number(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
};

// Sector allocation + concentration + diversification score, over the
// watchlist's own companies (order-independent -- this is a distribution,
// not a ranking, so it never touches the canonical company order).
// Diversification score uses the actual Herfindahl-Hirschman Index (a real
// named formula for market/portfolio concentration, not invented here):
// HHI = sum(share_i^2) over sectors; diversification = (1 - HHI) x 100, so
// one all-in-one-sector watchlist scores near 0 and an evenly spread one
// scores near 100.
export function sectorAllocation(stocks) {
  const total = stocks.length;
  if (!total) return { allocation: [], topShare: null, concentrated: false, diversificationScore: null };
  const counts = new Map();
  for (const stock of stocks) {
    const sector = stock.sector || 'Unclassified';
    counts.set(sector, (counts.get(sector) || 0) + 1);
  }
  const allocation = [...counts.entries()]
    .map(([sector, count]) => ({ sector, count, sharePct: number((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
  const topShare = allocation[0].sharePct;
  const hhi = allocation.reduce((sum, entry) => sum + (entry.count / total) ** 2, 0);
  return { allocation, topShare, concentrated: topShare > 40, diversificationScore: Math.round((1 - hhi) * 100) };
}

// Watchlist-wide averages for the Dashboard's Watchlist Snapshot / Portfolio
// Health block. Each average is independently null-filtered -- a stock
// missing ROE doesn't drag the ROE average toward zero or exclude it from
// the P/E average.
export function watchlistAverages(stocks) {
  return {
    pe: avg(stocks.map(s => s.pe)),
    roe: avg(stocks.map(s => s.metrics?.roe)),
    roce: avg(stocks.map(s => s.metrics?.roce)),
    debtToEquity: avg(stocks.map(s => s.metrics?.debtToEquity)),
    revenueGrowth3y: avg(stocks.map(s => s.metrics?.revenueCagr3y)),
    change: avg(stocks.map(s => s.change)),
    score: avg(stocks.map(s => s.score))
  };
}

// Resolves the illustrative allocation weight (%) for every company in
// watchlist order. `targetWeightPct` (data/watchlist/store.mjs) is an
// optional, user-entered field -- unset companies split whatever % remains
// after the explicit ones equally, then the whole vector is normalized to
// sum to exactly `100 - cashTargetPct` (the watchlist's own optional,
// user-entered illustrative cash allocation, default 0 = fully invested,
// same "not real holdings" disclosure as targetWeightPct itself). All-unset
// degrades to plain equal-weight of the invested portion. Deterministic and
// disclosed (see metricRegistry.mjs's `targetWeightPct` entry) -- this is
// what makes portfolio value/diversification/correlation-weighted risk
// meaningful without the app storing real currency holdings.
export function resolveWeights(companies, cashTargetPct = 0) {
  if (!companies.length) return [];
  const investedTarget = Math.max(0, 100 - (Number.isFinite(cashTargetPct) ? cashTargetPct : 0));
  const explicit = companies.map(c => Number.isFinite(c.targetWeightPct) ? c.targetWeightPct : null);
  if (!explicit.some(w => w != null)) return companies.map(() => number(investedTarget / companies.length));
  const setSum = explicit.filter(w => w != null).reduce((a, b) => a + b, 0);
  const unsetCount = explicit.filter(w => w == null).length;
  const perUnset = unsetCount ? Math.max(0, investedTarget - setSum) / unsetCount : 0;
  const raw = explicit.map(w => w != null ? w : perUnset);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map(w => number((w / total) * investedTarget));
}

// Exported for reuse by data/quant/performanceEngine.mjs (Phase 7 Stage 2) --
// a generic weight-aggregation utility, not a portfolio-specific analytic.
export function weightedAverage(pairs) {
  const withValues = pairs.filter(([value]) => Number.isFinite(value));
  const weightSum = withValues.reduce((sum, [, weight]) => sum + weight, 0);
  return weightSum ? number(withValues.reduce((sum, [value, weight]) => sum + value * weight, 0) / weightSum) : null;
}

// Portfolio dashboard: total value is an illustrative index (Sigma weight x
// price), not real currency -- weights are allocation percentages, not
// disclosed holdings (see metricRegistry.mjs's `portfolioValue` entry).
// Weighted averages reuse the same accessors as watchlistAverages() above,
// just weight- instead of count-averaged.
export function portfolioDashboard(stocks, weights) {
  const resolved = stocks.map((stock, i) => ({ stock, weight: weights[i] })).filter(({ stock }) => !stock.unresolved);
  if (!resolved.length) return { totalValue: null, weightedAverages: {} };
  const totalValue = number(resolved.reduce((sum, { stock, weight }) => sum + (weight / 100) * (stock.price || 0), 0));
  return {
    totalValue,
    weightedAverages: {
      pe: weightedAverage(resolved.map(({ stock, weight }) => [stock.pe, weight])),
      roe: weightedAverage(resolved.map(({ stock, weight }) => [stock.roe, weight])),
      roce: weightedAverage(resolved.map(({ stock, weight }) => [stock.roce, weight])),
      revenueGrowth3y: weightedAverage(resolved.map(({ stock, weight }) => [stock.metrics?.revenueCagr3y, weight])),
      dividendYield: weightedAverage(resolved.map(({ stock, weight }) => [stock.dividendYield, weight])),
      fcfYield: weightedAverage(resolved.map(({ stock, weight }) => [stock.metrics?.fcfYield, weight]))
    }
  };
}

// Sector allocation by allocation weight rather than headcount -- a separate
// function from sectorAllocation() above (which the Dashboard tab already
// uses, count-based) so that tab's existing output is untouched.
export function weightedSectorAllocation(stocks, weights) {
  const resolved = stocks.map((stock, i) => ({ stock, weight: weights[i] })).filter(({ stock }) => !stock.unresolved);
  const total = resolved.reduce((sum, { weight }) => sum + weight, 0);
  if (!total) return { allocation: [], diversificationScore: null };
  const bySector = new Map();
  for (const { stock, weight } of resolved) {
    const sector = stock.sector || 'Unclassified';
    bySector.set(sector, (bySector.get(sector) || 0) + weight);
  }
  const allocation = [...bySector.entries()].map(([sector, weight]) => ({ sector, sharePct: number((weight / total) * 100) })).sort((a, b) => b.sharePct - a.sharePct);
  const hhi = allocation.reduce((sum, entry) => sum + (entry.sharePct / 100) ** 2, 0);
  return { allocation, diversificationScore: Math.round((1 - hhi) * 100) };
}

// Position-level concentration: same real HHI/effective-holdings formulas as
// sectorAllocation() above, applied to individual weights instead of sector
// buckets. `contributions` decomposes the portfolio-level hhi into each
// position's own share of it (share_i^2 / hhi) -- pure arithmetic on the
// `shares`/`hhi` this function already computes, not a new calculation --
// so a reporting consumer can show "this position accounts for X% of the
// portfolio's concentration" per holding, not just the aggregate figure.
export function positionConcentration(stocks, weights) {
  const resolved = stocks.map((stock, i) => ({ stock, weight: weights[i] })).filter(({ stock }) => !stock.unresolved);
  const total = resolved.reduce((sum, { weight }) => sum + weight, 0);
  if (!total) return { hhi: null, effectiveHoldings: null, topPositionPct: null, diversificationScore: null, contributions: [] };
  const shares = resolved.map(({ weight }) => weight / total);
  const hhi = shares.reduce((sum, share) => sum + share ** 2, 0);
  const contributions = resolved
    .map(({ stock }, i) => ({ symbol: stock.symbol, name: stock.name, weightPct: number(shares[i] * 100), hhiContributionPct: number((shares[i] ** 2 / hhi) * 100) }))
    .sort((a, b) => b.hhiContributionPct - a.hhiContributionPct);
  return { hhi: number(hhi, 4), effectiveHoldings: number(1 / hhi), topPositionPct: number(Math.max(...shares) * 100), diversificationScore: Math.round((1 - hhi) * 100), contributions };
}

// Weight-aggregated portfolio quality: no new computation, just a weighted
// roll-up of each holding's already-computed quality/valuation/technical/
// risk scores (compositeScore, the "valuation" scoring factor,
// technicalScore, and the new institutional composite risk score).
export function portfolioQuality(stocks, weights) {
  const resolved = stocks.map((stock, i) => ({ stock, weight: weights[i] })).filter(({ stock }) => !stock.unresolved);
  return {
    qualityScore: weightedAverage(resolved.map(({ stock, weight }) => [stock.recommendation?.compositeScore, weight])),
    valuationScore: weightedAverage(resolved.map(({ stock, weight }) => [stock.recommendation?.factors?.valuation?.value, weight])),
    technicalScore: weightedAverage(resolved.map(({ stock, weight }) => [stock.recommendation?.technicalScore, weight])),
    riskScore: weightedAverage(resolved.map(({ stock, weight }) => [stock.institutionalRisk?.compositeRiskScore, weight]))
  };
}

// Portfolio beta: weighted average of each holding's already-computed beta
// (real covariance of weekly returns vs. its market benchmark -- dcf.mjs),
// no new calculation of its own.
export function portfolioBeta(stocks, weights) {
  return weightedAverage(stocks.map((stock, i) => [stock.beta, weights[i]]));
}

// Weight-aggregated risk-adjusted return: each holding's own proxy Sharpe
// ratio (riskAdjustedReturnScore below) rolled up by weight -- the portfolio
// figure is only as meaningful as the per-stock inputs it averages.
export function portfolioRiskAdjustedReturn(stocks, weights) {
  return weightedAverage(stocks.map((stock, i) => [stock.riskAdjustedReturnScore, weights[i]]));
}

// Per-stock proxy Sharpe ratio: (trailing-1y price return - the disclosed
// per-market risk-free-rate assumption the DCF model already uses) /
// annualized realized volatility. An approximation -- trailing 1y price
// return only, not a full return series or total return including
// dividends -- not a rolling or ex-ante Sharpe ratio.
export function riskAdjustedReturnScore(oneYearReturnPct, volatilityPct, riskFreeRatePct) {
  if (!Number.isFinite(oneYearReturnPct) || !Number.isFinite(volatilityPct) || volatilityPct <= 0) return null;
  return number((oneYearReturnPct - (riskFreeRatePct ?? 0)) / volatilityPct, 3);
}

// Sector contribution: for each sector, its share of portfolio weight and
// its weight-normalized contribution to the portfolio-level quality/risk
// scores (contribution = sector weight share x sector's own weighted-average
// score) -- a real decomposition of the already-computed portfolioQuality()
// figures above, not an independent calculation.
export function sectorContribution(stocks, weights) {
  const resolved = stocks.map((stock, i) => ({ stock, weight: weights[i] })).filter(({ stock }) => !stock.unresolved);
  const totalWeight = resolved.reduce((sum, { weight }) => sum + weight, 0);
  if (!totalWeight) return [];
  const bySector = new Map();
  for (const entry of resolved) {
    const sector = entry.stock.sector || 'Unclassified';
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector).push(entry);
  }
  return [...bySector.entries()].map(([sector, entries]) => {
    const sectorWeight = entries.reduce((s, e) => s + e.weight, 0);
    const weightSharePct = number((sectorWeight / totalWeight) * 100);
    const avgQuality = weightedAverage(entries.map(({ stock, weight }) => [stock.recommendation?.compositeScore, weight]));
    const avgRisk = weightedAverage(entries.map(({ stock, weight }) => [stock.institutionalRisk?.compositeRiskScore, weight]));
    return {
      sector, weightSharePct, companyCount: entries.length, avgQuality, avgRisk,
      qualityContribution: Number.isFinite(avgQuality) ? number((sectorWeight / totalWeight) * avgQuality) : null,
      riskContribution: Number.isFinite(avgRisk) ? number((sectorWeight / totalWeight) * avgRisk) : null
    };
  }).sort((a, b) => b.weightSharePct - a.weightSharePct);
}

// Marginal risk contribution: a real portfolio-variance decomposition, not
// invented for this app -- portfolioVariance = SUM_i SUM_j w_i*w_j*sigma_i*
// sigma_j*rho_ij; contribution_i = w_i*sigma_i*(SUM_j w_j*sigma_j*rho_ij) /
// portfolioVolatility, normalized to % of total (component contributions sum
// to the portfolio's own volatility, a standard identity). Limited to the
// symbols the correlation matrix itself could resolve (>=10 overlapping
// weekly price points) -- same coverage constraint the matrix already
// discloses.
// Real portfolio volatility from the same variance decomposition
// positionRiskContribution() below already needs internally (portfolioVariance
// = SUM_i SUM_j w_i*w_j*sigma_i*sigma_j*rho_ij) -- extracted so the
// benchmark/performance engine (data/quant/performanceEngine.mjs, Phase 7
// Stage 2) can reuse the identical portfolio-level volatility figure rather
// than approximating it with a correlation-blind weighted average of
// individual volatilities. Same >=10-overlapping-weekly-point coverage
// constraint as the correlation matrix itself (only symbols it could
// resolve are passed in).
export function portfolioVolatilityPct(symbols, weightBySymbol, volatilityBySymbol, correlation) {
  if (!symbols?.length) return null;
  const w = symbols.map(s => (weightBySymbol.get(s) || 0) / 100);
  const sigma = symbols.map(s => { const v = volatilityBySymbol.get(s); return Number.isFinite(v) ? v / 100 : 0; });
  const n = symbols.length;
  let variance = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) variance += w[i] * w[j] * sigma[i] * sigma[j] * (i === j ? 1 : (correlation.matrix[i][j] ?? 0));
  const vol = Math.sqrt(Math.max(0, variance));
  return vol > 0 ? number(vol * 100) : null;
}

export function positionRiskContribution(stocks, weights, correlation, volatilityBySymbol) {
  const symbols = correlation?.symbols || [];
  if (!symbols.length) return [];
  const weightBySymbol = new Map(stocks.map((stock, i) => [stock.symbol, weights[i]]));
  const nameBySymbol = new Map(stocks.map(stock => [stock.symbol, stock.name]));
  const w = symbols.map(s => (weightBySymbol.get(s) || 0) / 100);
  const sigma = symbols.map(s => { const v = volatilityBySymbol.get(s); return Number.isFinite(v) ? v / 100 : 0; });
  const n = symbols.length;
  const portfolioVolPct = portfolioVolatilityPct(symbols, weightBySymbol, volatilityBySymbol, correlation);
  const portfolioVol = Number.isFinite(portfolioVolPct) ? portfolioVolPct / 100 : 0;
  if (!(portfolioVol > 0)) return [];
  const raw = symbols.map((symbol, i) => {
    let covWithPortfolio = 0;
    for (let j = 0; j < n; j++) covWithPortfolio += w[j] * sigma[j] * (i === j ? 1 : (correlation.matrix[i][j] ?? 0));
    return { symbol, name: nameBySymbol.get(symbol) || symbol, marginalContribution: w[i] * sigma[i] * covWithPortfolio / portfolioVol };
  });
  const totalContribution = raw.reduce((s, r) => s + r.marginalContribution, 0) || 1;
  return raw.map(r => ({ symbol: r.symbol, name: r.name, riskContributionPct: number((r.marginalContribution / totalContribution) * 100) })).sort((a, b) => b.riskContributionPct - a.riskContributionPct);
}

// Generic weighted-deviation-from-mean attribution: contribution_i =
// weight_i x (holding's own score - portfolio-weighted average score) --
// which holdings pull a portfolio-level score up vs. down, not just the
// portfolio-level average itself (already available from portfolioQuality()
// above). Used once for the quality score and once for the valuation score.
// `contributors` (full, symbol-sorted-by-contribution) is returned alongside
// the existing `topPositive`/`topNegative` slices -- this was already
// computed internally before being sliced down; exposing the full list lets
// a per-company report look up its own contribution without recomputing.
export function attributionBreakdown(stocks, weights, scoreAccessor) {
  const resolved = stocks.map((stock, i) => ({ stock, weight: weights[i] })).filter(({ stock }) => !stock.unresolved && Number.isFinite(scoreAccessor(stock)));
  const portfolioAverage = weightedAverage(resolved.map(({ stock, weight }) => [scoreAccessor(stock), weight]));
  if (portfolioAverage == null) return { portfolioAverage: null, topPositive: [], topNegative: [], contributors: [] };
  const contributors = resolved.map(({ stock, weight }) => ({
    symbol: stock.symbol, name: stock.name, score: number(scoreAccessor(stock)),
    contribution: number((weight / 100) * (scoreAccessor(stock) - portfolioAverage))
  })).sort((a, b) => b.contribution - a.contribution);
  return { portfolioAverage: number(portfolioAverage), topPositive: contributors.slice(0, 3), topNegative: contributors.slice(-3).reverse(), contributors };
}

// Factor exposure: 5 disclosed in-house factor tilts -- not a commercial
// Barra/Axioma-style risk-factor model (this app has no such data source) --
// each a within-watchlist percentile (percentileRank, same machinery as the
// historical P/E-P/B bands) of an already-computed metric, weight-aggregated
// to portfolio level. 50 = neutral tilt; above/below tilts toward/away from
// the factor.
const FACTOR_ACCESSORS = {
  value: { accessor: s => s.pe, invert: true, label: 'Value' },
  growth: { accessor: s => avg([s.metrics?.revenueCagr3y, s.metrics?.epsCagr5y]), invert: false, label: 'Growth' },
  quality: { accessor: s => s.recommendation?.components?.quality?.score, invert: false, label: 'Quality' },
  momentum: { accessor: s => s.technicalScorecard?.scores?.momentumScore, invert: false, label: 'Momentum' },
  size: { accessor: s => s.marketCap, invert: false, label: 'Size' }
};
export function factorExposure(stocks, weights) {
  const resolved = stocks.map((stock, i) => ({ stock, weight: weights[i] })).filter(({ stock }) => !stock.unresolved);
  if (!resolved.length) return {};
  const result = {};
  for (const [factor, { accessor, invert, label }] of Object.entries(FACTOR_ACCESSORS)) {
    const universe = resolved.map(({ stock }) => accessor(stock)).filter(Number.isFinite);
    const perStock = resolved.map(({ stock, weight }) => {
      const value = accessor(stock);
      const pct = Number.isFinite(value) ? percentileRank(value, universe) : null;
      return [pct == null ? null : (invert ? 100 - pct : pct), weight];
    });
    const exposure = weightedAverage(perStock);
    result[factor] = { label, exposure: exposure != null ? Math.round(exposure) : null };
  }
  return result;
}

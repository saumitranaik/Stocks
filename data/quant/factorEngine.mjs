import { number } from '../util.mjs';
import { percentileRank } from '../analytics/priceSeries.mjs';
import { FACTOR_SCORE_WEIGHTS, NORMALIZATION, FACTOR_CONFIDENCE, LEADERSHIP_MIN_DEVIATION } from './config.mjs';

// Phase 7 Stage 1 -- institutional factor framework. Per-stock raw
// sub-metrics for 6 factor categories (Value/Quality/Growth/Momentum/Risk/
// Size), each normalized to a 0-100 sector-relative (or, below
// NORMALIZATION.minSectorPeers, watchlist-relative) percentile via the same
// percentileRank() machinery data/analytics/priceSeries.mjs already uses for
// historical P/E-P/B percentiles, and the same direction-inversion
// convention data/analytics/portfolio.mjs's factorExposure() already
// established (100 - percentile for "lower is better" metrics, e.g. P/E,
// beta, volatility). Every raw input below is read straight off the
// already-computed research payload -- this module performs no new fetch
// and no independent recalculation of any raw figure, only normalization
// and aggregation, per system.md's single-computation-site rule (§8).
//
// This is a materially distinct capability from data/analytics/portfolio.mjs's
// existing factorExposure(): that function is a portfolio-level, weight-
// aggregated tilt over 5 factors with no raw-value/percentile/confidence/
// coverage disclosure per sub-metric. This module is the full per-stock
// institutional factor profile Phase 7 requires (raw value + normalized
// score + percentile + direction + data status + confidence per sub-metric,
// plus a composite Factor Score with per-category contribution, leadership
// and coverage). Both remain in the research payload -- `portfolio.
// factorExposure` is untouched; this attaches as `stock.quantFactors` and a
// watchlist-level `quant` summary -- answering different questions over
// overlapping raw inputs, not a duplicate computation of the same one (see
// metricRegistry.mjs's `quantFactorScore` entry for the full disclosure).
//
// Per the Phase 7 brief's binding product rule: this Factor Score never
// overrides or averages into the Portfolio Action Score or the unified
// recommendation engine, which remain this app's primary decision-layer
// signals -- a later stage's UI surfaces the two side by side when they
// disagree, rather than blending them into one opaque number here.

const FACTOR_METRIC_DEFS = {
  value: [
    { key: 'pe', label: 'P/E', accessor: s => s.pe, invert: true },
    { key: 'pb', label: 'P/B', accessor: s => s.pb, invert: true },
    { key: 'earningsYield', label: 'Earnings yield', accessor: s => s.earningsYield, invert: false },
    { key: 'fcfYield', label: 'FCF yield', accessor: s => s.fcfYield, invert: false },
    { key: 'evEbitda', label: 'EV/EBITDA', accessor: () => null, invert: true, unavailable: 'No Enterprise Value data source -- this app\'s data source exposes no explicit Cash/Net-Debt line item (see metricRegistry.mjs\'s evEbitdaPercentile entry).' }
  ],
  quality: [
    { key: 'roe', label: 'ROE', accessor: s => s.roe, invert: false },
    { key: 'roce', label: 'ROCE', accessor: s => s.roce, invert: false },
    { key: 'marginStability', label: 'Margin stability', accessor: s => s.fundamentalsAnalytics?.marginStability, invert: true },
    { key: 'earningsQuality', label: 'Earnings quality', accessor: s => s.fundamentalsAnalytics?.earningsQuality?.score, invert: false }
  ],
  growth: [
    { key: 'revenueCagr3y', label: 'Revenue CAGR (3y)', accessor: s => s.metrics?.revenueCagr3y, invert: false },
    { key: 'epsCagr5y', label: 'EPS CAGR (5y)', accessor: s => s.metrics?.epsCagr5y, invert: false },
    { key: 'ebitdaGrowth', label: 'EBITDA growth', accessor: () => null, invert: false, unavailable: 'No EBITDA line item exposed by this app\'s data source.' },
    { key: 'fcfGrowth', label: 'FCF growth', accessor: () => null, invert: false, unavailable: 'Only the latest year\'s free cash flow is available (see fcfYield) -- no multi-year FCF series to compute a growth rate from.' }
  ],
  momentum: [
    { key: 'priceMomentum', label: 'Price momentum', accessor: s => s.technicalScorecard?.scores?.momentumScore, invert: false },
    { key: 'relativeStrength', label: 'Relative strength vs. benchmark', accessor: s => s.relativeStrengthPct, invert: false },
    { key: 'trendPersistence', label: 'Trend persistence', accessor: s => s.technicalScorecard?.advancedScores?.trendPersistenceScore, invert: false },
    { key: 'volumeConfirmation', label: 'Institutional accumulation (volume confirmation)', accessor: s => s.technicalScorecard?.advancedScores?.institutionalAccumulationScore, invert: false }
  ],
  risk: [
    { key: 'volatility', label: 'Realized volatility (annualized)', accessor: s => s.volatilityPct, invert: true },
    { key: 'beta', label: 'Beta', accessor: s => s.beta, invert: true },
    { key: 'maxDrawdown', label: 'Max drawdown', accessor: s => s.maxDrawdownPct, invert: false },
    { key: 'compositeRisk', label: 'Composite institutional risk', accessor: s => s.institutionalRisk?.compositeRiskScore, invert: true },
    { key: 'financialRisk', label: 'Financial risk', accessor: s => s.institutionalRisk?.categories?.financial, invert: true },
    { key: 'businessRisk', label: 'Business risk', accessor: s => s.institutionalRisk?.categories?.business, invert: true },
    { key: 'sectorRiskCategory', label: 'Sector risk', accessor: s => s.institutionalRisk?.categories?.sector, invert: true },
    { key: 'governanceRisk', label: 'Governance risk', accessor: s => s.institutionalRisk?.categories?.governance, invert: true }
  ],
  size: [
    { key: 'marketCap', label: 'Market capitalization', accessor: s => s.marketCap, invert: false }
  ]
};

const FACTOR_LABELS = { value: 'Value', quality: 'Quality', growth: 'Growth', momentum: 'Momentum', risk: 'Risk', size: 'Size' };

// Sector-first, watchlist-fallback peer selection -- the same two-tier
// scoping relativeValuation.mjs already applies, made explicit here per
// sub-metric rather than once for the whole stock (a stock's sector may have
// enough peers for some metrics' universes and not others once missing
// values are filtered out below).
function peerUniverseFor(stock, resolvedStocks) {
  const sectorPeers = resolvedStocks.filter(s => s.sector && s.sector === stock.sector);
  if (sectorPeers.length >= NORMALIZATION.minSectorPeers) return { peers: sectorPeers, scope: 'sector' };
  if (resolvedStocks.length >= NORMALIZATION.minWatchlistPeers) return { peers: resolvedStocks, scope: 'watchlist' };
  return { peers: [], scope: 'none' };
}

function normalizeMetric(def, stock, peers) {
  const direction = def.invert ? 'lower-better' : 'higher-better';
  if (def.unavailable) {
    return { key: def.key, label: def.label, value: null, normalizedScore: null, percentile: null, direction, status: 'unavailable', reason: def.unavailable };
  }
  const value = def.accessor(stock);
  if (!Number.isFinite(value)) {
    return { key: def.key, label: def.label, value: null, normalizedScore: null, percentile: null, direction, status: 'insufficient-data', reason: 'Not reported for this company.' };
  }
  const universe = peers.map(def.accessor).filter(Number.isFinite);
  if (universe.length < NORMALIZATION.minWatchlistPeers) {
    return { key: def.key, label: def.label, value, normalizedScore: null, percentile: null, direction, status: 'insufficient-data', reason: `Fewer than ${NORMALIZATION.minWatchlistPeers} peers report this metric in the current normalization scope.` };
  }
  const percentile = percentileRank(value, universe);
  const normalizedScore = percentile == null ? null : (def.invert ? number(100 - percentile, 0) : percentile);
  return { key: def.key, label: def.label, value, normalizedScore, percentile, direction, status: 'available' };
}

function categoryScore(metrics) {
  const resolved = metrics.filter(m => Number.isFinite(m.normalizedScore));
  if (!resolved.length) return null;
  return number(resolved.reduce((sum, m) => sum + m.normalizedScore, 0) / resolved.length, 1);
}

// Builds the full per-stock factor profile for one watchlist. Pure function
// over the already-assembled `stocks` array (called from research.mjs after
// the recommendation/relative-valuation second pass resolves, so technical,
// risk and relative-strength fields are all final) -- no I/O, no mutation of
// its input.
export function buildQuantResearch(stocks) {
  const resolvedStocks = stocks.filter(s => !s.unresolved);
  const bySymbol = new Map();

  for (const stock of resolvedStocks) {
    const { peers, scope } = peerUniverseFor(stock, resolvedStocks);
    const factors = {};
    let resolvedCategories = 0;
    for (const [factorKey, defs] of Object.entries(FACTOR_METRIC_DEFS)) {
      const metrics = defs.map(def => normalizeMetric(def, stock, peers));
      const score = categoryScore(metrics);
      if (score != null) resolvedCategories++;
      factors[factorKey] = { label: FACTOR_LABELS[factorKey], score, metrics };
    }

    const resolvedEntries = Object.entries(factors).filter(([, f]) => Number.isFinite(f.score));
    const weightSum = resolvedEntries.reduce((sum, [key]) => sum + (FACTOR_SCORE_WEIGHTS[key] || 0), 0);
    const rawFactorScore = weightSum > 0
      ? number(resolvedEntries.reduce((sum, [key, f]) => sum + f.score * (FACTOR_SCORE_WEIGHTS[key] || 0), 0) / weightSum, 1)
      : null;

    const contribution = {};
    for (const [key, f] of resolvedEntries) {
      contribution[key] = weightSum > 0 ? number((f.score * (FACTOR_SCORE_WEIGHTS[key] || 0)) / weightSum, 1) : null;
    }

    const deviations = resolvedEntries.map(([key, f]) => ({ key, label: FACTOR_LABELS[key], deviation: number(f.score - 50, 1) }));
    const strongestPositiveFactor = deviations.filter(d => d.deviation >= LEADERSHIP_MIN_DEVIATION).sort((a, b) => b.deviation - a.deviation)[0] || null;
    const strongestNegativeFactor = deviations.filter(d => d.deviation <= -LEADERSHIP_MIN_DEVIATION).sort((a, b) => a.deviation - b.deviation)[0] || null;

    const coveragePct = number((resolvedCategories / 6) * 100, 0);
    const resolvedCategoryShare = resolvedCategories / 6;
    const meetsCoverageFloor = resolvedCategoryShare >= FACTOR_CONFIDENCE.minResolvedCategoryShare;
    const confidence = !meetsCoverageFloor ? null
      : (coveragePct >= FACTOR_CONFIDENCE.highCoveragePct && scope === 'sector') ? 'High'
        : coveragePct >= FACTOR_CONFIDENCE.mediumCoveragePct ? 'Medium' : 'Low';

    bySymbol.set(stock.symbol, {
      factors,
      factorScore: meetsCoverageFloor ? rawFactorScore : null,
      contribution, coveragePct, confidence,
      strongestPositiveFactor, strongestNegativeFactor,
      normalizationScope: scope, peerCount: peers.length,
      capNote: meetsCoverageFloor ? null : `Factor Score withheld: fewer than half of the 6 factor categories resolved (${resolvedCategories}/6).`
    });
  }

  const scored = [...bySymbol.entries()].filter(([, v]) => Number.isFinite(v.factorScore));
  const strongest = scored.length ? scored.reduce((best, cur) => cur[1].factorScore > best[1].factorScore ? cur : best) : null;
  const weakest = scored.length ? scored.reduce((worst, cur) => cur[1].factorScore < worst[1].factorScore ? cur : worst) : null;
  const nameOf = (symbol) => resolvedStocks.find(s => s.symbol === symbol)?.name || symbol;

  const factorAverages = {};
  for (const key of Object.keys(FACTOR_METRIC_DEFS)) {
    const values = resolvedStocks.map(s => bySymbol.get(s.symbol)?.factors?.[key]?.score).filter(Number.isFinite);
    factorAverages[key] = { label: FACTOR_LABELS[key], average: values.length ? number(values.reduce((a, b) => a + b, 0) / values.length, 1) : null };
  }

  return {
    bySymbol,
    summary: {
      factorLeadership: strongest ? { symbol: strongest[0], name: nameOf(strongest[0]), factorScore: strongest[1].factorScore } : null,
      factorWeakness: weakest ? { symbol: weakest[0], name: nameOf(weakest[0]), factorScore: weakest[1].factorScore } : null,
      factorAverages,
      coverage: { companiesScored: scored.length, companiesTotal: resolvedStocks.length }
    },
    methodology: 'Institutional 6-factor framework (Value/Quality/Growth/Momentum/Risk/Size). Each sub-metric is normalized to a 0-100 percentile against same-sector peers within this watchlist (falling back to the full watchlist below 4 sector peers, and to explicit "insufficient data" below 3 peers even at watchlist scope -- there is no market-wide peer database in this app, the same constraint already disclosed on relativeValuation.mjs and portfolio.mjs\'s factorExposure()). A category score is the average of its resolved sub-metrics\' normalized scores; the composite Factor Score is a weighted blend of the 6 category scores (weights in data/quant/config.mjs, an uncalibrated disclosed heuristic), renormalized over whichever categories resolve, and withheld entirely when fewer than half resolve. Distinct from, and does not replace, the existing portfolio-level factorExposure() tilt or the Portfolio Action Score / recommendation engine.'
  };
}

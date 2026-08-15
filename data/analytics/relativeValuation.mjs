import { number, clamp, average } from '../util.mjs';
import { timeSeries } from './series.mjs';
import { percentileRank } from './priceSeries.mjs';

// Peer universe for every comparison below is *this watchlist's own
// companies sharing a sector tag* -- there is no market-wide sector
// database anywhere in this app (same root constraint industryPe already
// has); "sector median"/"sector leader" are watchlist-scoped, not a true
// market sector benchmark. Disclosed via metricMeta, not presented as a
// market-wide relative-value screen.
const METRIC_ACCESSORS = {
  pe: s => s.pe, pb: s => s.pb, peg: s => s.metrics?.peg,
  roe: s => s.roe, roce: s => s.roce,
  revenueCagr3y: s => s.metrics?.revenueCagr3y, epsCagr3y: s => s.metrics?.epsCagr3y,
  dividendYield: s => s.dividendYield
};
const HIGHER_BETTER = new Set(['roe', 'roce', 'revenueCagr3y', 'epsCagr3y', 'dividendYield']);
const VALUATION_METRICS = ['pe', 'pb', 'peg'];

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return number(clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2);
}
function stdDev(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const mean = average(clean);
  return Math.sqrt(clean.reduce((s, v) => s + (v - mean) ** 2, 0) / clean.length);
}

// The one metric with a real multi-year series already parsed elsewhere
// (Screener's ratios table) -- every other metric here has no historical
// series this data source exposes, so "historical average" renders N/A for
// them rather than being approximated from a single trailing CAGR figure.
function historicalRoceAverage(stock) {
  const values = timeSeries(stock.fundamentals?.annual?.ratios, 'rocePct').map(([, v]) => v);
  return values.length ? number(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

// Multi-factor peer score: Value (inverted P/E-P/B-PEG -- cheaper scores
// higher), Quality (ROE/ROCE), Growth (revenue/EPS CAGR), each a
// within-sector percentile (percentileRank -- the same percentile machinery
// already used for historical P/E-P/B bands) so all three sit on a common
// 0-100 scale before this disclosed 40/35/25 blend.
const MULTI_FACTOR_WEIGHTS = { value: 40, quality: 35, growth: 25 };
function factorPercentile(stock, peers, accessor, invert) {
  const value = accessor(stock);
  if (!Number.isFinite(value)) return null;
  const history = peers.map(accessor).filter(Number.isFinite);
  const pct = percentileRank(value, history);
  return pct == null ? null : (invert ? 100 - pct : pct);
}
function multiFactorScore(stock, peers) {
  const value = [factorPercentile(stock, peers, METRIC_ACCESSORS.pe, true), factorPercentile(stock, peers, METRIC_ACCESSORS.pb, true), factorPercentile(stock, peers, METRIC_ACCESSORS.peg, true)].filter(Number.isFinite);
  const quality = [factorPercentile(stock, peers, METRIC_ACCESSORS.roe, false), factorPercentile(stock, peers, METRIC_ACCESSORS.roce, false)].filter(Number.isFinite);
  const growth = [factorPercentile(stock, peers, METRIC_ACCESSORS.revenueCagr3y, false), factorPercentile(stock, peers, METRIC_ACCESSORS.epsCagr3y, false)].filter(Number.isFinite);
  const parts = [];
  if (value.length) parts.push({ score: average(value), weight: MULTI_FACTOR_WEIGHTS.value });
  if (quality.length) parts.push({ score: average(quality), weight: MULTI_FACTOR_WEIGHTS.quality });
  if (growth.length) parts.push({ score: average(growth), weight: MULTI_FACTOR_WEIGHTS.growth });
  if (!parts.length) return null;
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  return Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight);
}

// Sector-normalized valuation score: a continuous z-score of P/E-P/B-PEG vs.
// sector peers (lower multiple -> higher score), distinct from
// relativeValuationScore's coarser beat/miss-the-median count below -- mapped
// through a clamped linear transform (z of 0 -> 50; roughly +-2 standard
// deviations spans the full 0-100 range).
function sectorNormalizedScore(stock, peers) {
  const zScores = VALUATION_METRICS.map(key => {
    const values = peers.map(METRIC_ACCESSORS[key]).filter(Number.isFinite);
    const value = METRIC_ACCESSORS[key](stock);
    const mean = average(values), sd = stdDev(values);
    if (!Number.isFinite(value) || mean == null || !sd) return null;
    return -((value - mean) / sd); // cheaper (lower multiple) => higher score
  }).filter(Number.isFinite);
  if (!zScores.length) return null;
  return Math.round(clamp(50 + average(zScores) * 25, 0, 100));
}

// Valuation dispersion: spread of P/E across each sector's own watchlist
// peers -- flags whether a sector's peer group is tightly bunched or widely
// scattered, context the single sector-median figure alone doesn't convey.
function dispersionFor(peers) {
  const values = peers.map(METRIC_ACCESSORS.pe).filter(Number.isFinite);
  if (values.length < 2) return { mean: null, median: null, stdDev: null, min: null, max: null, coefficientOfVariation: null, sampleSize: values.length };
  const mean = average(values), sd = stdDev(values);
  return {
    mean: number(mean), median: median(values), stdDev: sd != null ? number(sd) : null,
    min: number(Math.min(...values)), max: number(Math.max(...values)),
    coefficientOfVariation: sd != null && mean ? number((sd / mean) * 100) : null, sampleSize: values.length
  };
}

// Historical premium/discount band: the range of implied P/E this stock has
// itself traded at historically, reusing the per-fiscal-year reconstruction
// historicalPercentiles.mjs already builds for the percentile read
// (`stock.peHistory`, previously only its `.percentile` sibling was
// consumed) -- so today's valuation can be read against the stock's *own*
// historical range, not only today's single sector-median snapshot.
function historicalValuationBand(stock) {
  const values = (stock.peHistory || []).map(h => h.impliedPe).filter(Number.isFinite);
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const med = pick(0.5);
  return {
    min: number(sorted[0]), p25: number(pick(0.25)), median: number(med), p75: number(pick(0.75)), max: number(sorted.at(-1)),
    currentPe: Number.isFinite(stock.pe) ? number(stock.pe) : null,
    positionVsOwnHistoryPct: Number.isFinite(stock.pe) && med ? number(((stock.pe - med) / med) * 100) : null
  };
}

export function relativeValuation(stocks) {
  const resolved = stocks.filter(s => !s.unresolved);
  const bySector = new Map();
  for (const stock of resolved) {
    const sector = stock.sector || 'Unclassified';
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector).push(stock);
  }
  // Ranked by ROCE (falling back to ROE) rather than the recommendation
  // score: this module runs before the unified recommendation engine's final
  // pass resolves (it needs relativeValuationScore as one of that engine's
  // own inputs -- see scoringEngine.mjs), and a fundamentals-based leader
  // read ("best returns-on-capital performer") is a defensible, independent
  // basis for "sector leader" in its own right, not just a workaround.
  const qualityProxy = (s) => Number.isFinite(s.roce) ? s.roce : (Number.isFinite(s.roe) ? s.roe : -Infinity);
  const sectorLeader = new Map([...bySector].map(([sector, peers]) => [sector, peers.reduce((best, s) => (!best || qualityProxy(s) > qualityProxy(best)) ? s : best, null)]));
  const watchlistMedians = Object.fromEntries(Object.keys(METRIC_ACCESSORS).map(key => [key, median(resolved.map(METRIC_ACCESSORS[key]))]));
  const watchlistRankBySymbol = new Map([...resolved].sort((a, b) => qualityProxy(b) - qualityProxy(a)).map((s, i) => [s.symbol, i + 1]));

  // Pass 1: per-stock comparison table + core scores -- needs only its own
  // sector's peer group, independent of any other stock's result.
  const core = new Map();
  for (const stock of resolved) {
    const sector = stock.sector || 'Unclassified';
    const peers = bySector.get(sector);
    const sectorMedians = Object.fromEntries(Object.keys(METRIC_ACCESSORS).map(key => [key, median(peers.map(METRIC_ACCESSORS[key]))]));
    const leader = sectorLeader.get(sector);
    const sectorRank = [...peers].sort((a, b) => qualityProxy(b) - qualityProxy(a)).findIndex(s => s.symbol === stock.symbol) + 1;

    const comparison = Object.keys(METRIC_ACCESSORS).map(key => ({
      key, value: METRIC_ACCESSORS[key](stock), sectorMedian: sectorMedians[key],
      sectorLeader: leader ? METRIC_ACCESSORS[key](leader) : null,
      historicalAverage: key === 'roce' ? historicalRoceAverage(stock) : null,
      watchlistAverage: watchlistMedians[key]
    }));

    const beats = comparison.filter(({ key, value, sectorMedian }) => {
      if (!Number.isFinite(value) || !Number.isFinite(sectorMedian)) return null;
      return HIGHER_BETTER.has(key) ? value > sectorMedian : value < sectorMedian;
    }).filter(v => v !== null);
    const decided = comparison.filter(({ key, value, sectorMedian }) => Number.isFinite(value) && Number.isFinite(sectorMedian) && (HIGHER_BETTER.has(key) || VALUATION_METRICS.includes(key)));
    const relativeValuationScore = decided.length ? Math.round((beats.length / decided.length) * 100) : null;

    const deviations = VALUATION_METRICS.map(key => {
      const value = METRIC_ACCESSORS[key](stock), med = sectorMedians[key];
      return Number.isFinite(value) && Number.isFinite(med) && med !== 0 ? ((value - med) / med) * 100 : null;
    }).filter(Number.isFinite);
    const premiumDiscountScore = deviations.length ? number(deviations.reduce((a, b) => a + b, 0) / deviations.length) : null;

    core.set(stock.symbol, {
      comparison, relativeValuationScore, premiumDiscountScore,
      sectorRank, sectorPeerCount: peers.length, watchlistRank: watchlistRankBySymbol.get(stock.symbol) ?? null, watchlistCount: resolved.length,
      multiFactorPeerScore: multiFactorScore(stock, peers),
      sectorNormalizedValuationScore: sectorNormalizedScore(stock, peers),
      historicalValuationBand: historicalValuationBand(stock)
    });
  }

  // Pass 2: sector-adjusted/multi-factor ranks, watchlist-wide percentile and
  // the attractiveness composite -- each needs every sector-mate's (or the
  // whole watchlist's) pass-1 scores already resolved.
  const valuationDispersion = Object.fromEntries([...bySector].map(([sector, peers]) => [sector, dispersionFor(peers)]));
  const allPremiumDiscount = resolved.map(s => core.get(s.symbol)?.premiumDiscountScore).filter(Number.isFinite);

  const bySymbol = new Map();
  for (const stock of resolved) {
    const entry = core.get(stock.symbol);
    const sector = stock.sector || 'Unclassified';
    const peerEntries = bySector.get(sector).map(s => core.get(s.symbol));
    const sectorValuationRank = [...peerEntries].sort((a, b) => (a.premiumDiscountScore ?? Infinity) - (b.premiumDiscountScore ?? Infinity)).findIndex(e => e === entry) + 1;
    const multiFactorPeerRank = [...peerEntries].sort((a, b) => (b.multiFactorPeerScore ?? -Infinity) - (a.multiFactorPeerScore ?? -Infinity)).findIndex(e => e === entry) + 1;
    const watchlistValuationPercentile = Number.isFinite(entry.premiumDiscountScore) && allPremiumDiscount.length >= 3
      ? number(100 - percentileRank(entry.premiumDiscountScore, allPremiumDiscount), 0) : null;
    const attractivenessParts = [entry.relativeValuationScore, entry.sectorNormalizedValuationScore, entry.multiFactorPeerScore].filter(Number.isFinite);
    const relativeAttractivenessScore = attractivenessParts.length ? Math.round(average(attractivenessParts)) : null;

    bySymbol.set(stock.symbol, { ...entry, sectorValuationRank, multiFactorPeerRank, watchlistValuationPercentile, relativeAttractivenessScore });
  }
  return { bySymbol, valuationDispersion };
}

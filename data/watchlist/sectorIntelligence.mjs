import * as store from './store.mjs';
import { buildResearch } from './research.mjs';
import { sectorRiskTags } from '../analytics/institutionalRisk.mjs';
import { number, average } from '../util.mjs';

// Cross-watchlist orchestration (Phase 6) -- the one deliberate exception to
// this app's otherwise strictly single-watchlist-scoped research flow
// (system.md §5's data flow). Reads every watchlist's own already-cached
// buildResearch() output (networkPass:'none', so this never triggers a new
// fetch -- pure I/O reuse, zero new network calls) and groups the resulting
// companies by their own `sector` field. Every per-sector figure below is an
// average of fields buildResearch() already computed for each stock -- no
// new analytics engine, matching the "single computation site" rule.
export async function buildSectorIntelligence() {
  const index = await store.listWatchlists();
  const researches = await Promise.all(index.watchlists.map(async (w) => {
    try {
      const watchlist = await store.getWatchlist(w.id);
      return await buildResearch(watchlist, { networkPass: 'none' });
    } catch { return null; }
  }));

  // Dedupe by symbol -- the same company can legitimately appear in more
  // than one watchlist (e.g. a bank held in both "Core Portfolio" and
  // "Banking"). First occurrence wins, in the user's own watchlist order, so
  // a sector's company count reflects distinct real companies, not
  // double-weighted duplicates.
  const seen = new Set();
  const stocks = [];
  for (const research of researches) {
    if (!research) continue;
    for (const stock of research.stocks) {
      if (stock.unresolved) continue;
      const key = stock.symbol.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      stocks.push(stock);
    }
  }

  const bySector = new Map();
  for (const stock of stocks) {
    const sector = stock.sector || 'Unclassified';
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector).push(stock);
  }

  const sectors = [...bySector.entries()]
    .map(([sector, entries]) => buildSectorCard(sector, entries))
    .sort((a, b) => b.companyCount - a.companyCount);

  return {
    generatedAt: new Date().toISOString(),
    companyCount: stocks.length,
    watchlistCount: researches.filter(Boolean).length,
    sectors,
    dataLimitations: [
      'A company held in more than one watchlist is counted once, attributed to the first watchlist (in your own saved watchlist order) that carries it -- not double-weighted.',
      'Coverage is limited to companies you have actually added to a watchlist -- there is no market-wide sector database in this app (system.md TD-10), so a sector with nothing added anywhere does not appear here at all.',
      'Reads each watchlist\'s already-cached research (cache-only) -- this never triggers a new fetch, so it reflects whatever is on disk at the time, the same as every other cache-only view in this app.',
      'Earnings momentum is a trailing 5-year EPS CAGR average, not a quarter-level surprise/deviation figure -- see the Dashboard\'s Earnings & Events sub-tab for the real quarterly deltas, which are per-company, not sector-aggregated.'
    ]
  };
}

function ratingTally(entries) {
  const counts = {};
  for (const stock of entries) {
    const rating = stock.signal || 'N/A';
    counts[rating] = (counts[rating] || 0) + 1;
  }
  return counts;
}

function buildSectorCard(sector, entries) {
  const compositeScores = entries.map(s => s.recommendation?.compositeScore);
  const valuationScores = entries.map(s => s.recommendation?.components?.valuation?.score);
  const technicalScores = entries.map(s => s.technicalScorecard?.scores?.trendStrengthScore);
  const riskScores = entries.map(s => s.institutionalRisk?.compositeRiskScore);
  const relativeStrength = entries.map(s => s.relativeStrengthPct);
  const epsCagr5y = entries.map(s => s.metrics?.epsCagr5y);
  const sectorTags = sectorRiskTags(sector); // reuse existing static regulatory/commodity/competitive/tech-disruption lookup -- no new table

  return {
    sector, companyCount: entries.length, companies: entries.map(s => s.symbol),
    avgCompositeScore: round(average(compositeScores)),
    avgValuationScore: round(average(valuationScores)),
    avgTechnicalScore: round(average(technicalScores)),
    avgRiskScore: round(average(riskScores)),
    avgRelativeStrengthPct: number(average(relativeStrength)),
    avgEpsCagr5yPct: number(average(epsCagr5y)),
    ratingCounts: ratingTally(entries),
    regulatorySensitivity: sectorTags?.regulatory ?? null,
    commoditySensitivity: sectorTags?.commodity ?? null,
    sectorTagsMatched: sectorTags?.matched ?? false
  };
}
const round = (v) => Number.isFinite(v) ? Math.round(v) : null;

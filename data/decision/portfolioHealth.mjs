import { HEALTH_WEIGHTS } from './config.mjs';

// Portfolio Health Score: a weighted blend of already-computed portfolio
// fields (payload.portfolio, built by data/analytics/portfolio.mjs) --
// quality, diversification, risk (inverted), technical strength and sector
// balance. Nothing here is recomputed; this only composes existing figures.
// `previousPortfolioSnapshot` is the persisted `.portfolio` slice from
// data/cache/watchlistSnapshots/<id>.json (data/watchlist/snapshotCache.mjs)
// -- used only to read `healthHistory` for the trend line and prior score;
// deciding whether/when to append a new history point is
// index.mjs's buildPortfolioIntelligence's job, not this function's (this
// function is called on every request, including cache-only ones, but is
// only persisted back into the snapshot on a genuine data refresh).
export function portfolioHealthScore(payload, previousPortfolioSnapshot) {
  const portfolio = payload?.portfolio;
  if (!portfolio) return null;

  const sectorBalance = portfolio.sectorAllocation?.diversificationScore;
  const riskInverted = Number.isFinite(portfolio.quality?.riskScore) ? 100 - portfolio.quality.riskScore : null;

  const parts = [
    { key: 'quality', label: 'Portfolio quality', weight: HEALTH_WEIGHTS.quality, score: portfolio.quality?.qualityScore },
    { key: 'diversification', label: 'Diversification', weight: HEALTH_WEIGHTS.diversification, score: portfolio.diversificationScore },
    { key: 'risk', label: 'Risk (inverted)', weight: HEALTH_WEIGHTS.risk, score: riskInverted },
    { key: 'technical', label: 'Technical strength', weight: HEALTH_WEIGHTS.technical, score: portfolio.quality?.technicalScore },
    { key: 'sectorBalance', label: 'Sector balance', weight: HEALTH_WEIGHTS.sectorBalance, score: sectorBalance }
  ].filter(part => Number.isFinite(part.score));
  if (!parts.length) return null;

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = Math.round(parts.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight);

  const history = Array.isArray(previousPortfolioSnapshot?.healthHistory) ? previousPortfolioSnapshot.healthHistory : [];
  const lastScore = history.length ? history[history.length - 1].healthScore : null;
  const trend = lastScore == null ? 'N/A' : score > lastScore + 2 ? 'Improving' : score < lastScore - 2 ? 'Deteriorating' : 'Stable';

  const contributors = parts
    .map(part => ({ key: part.key, label: part.label, score: part.score }))
    .sort((a, b) => a.score - b.score); // weakest first -- most actionable

  return { score, trend, contributors, history };
}

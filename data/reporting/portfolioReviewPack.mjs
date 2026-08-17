// -- Portfolio Review Pack (Phase 5) -----------------------------------------
// Pure selection/derivation over an already-built `research` payload
// (buildResearch(), data/watchlist/research.mjs) for the whole watchlist --
// same "no analytic recomputed here" discipline as data/reporting/
// researchReport.mjs (the per-company report), applied at portfolio scope.
// Every figure below is read straight off research.portfolio/
// research.intelligence/research.averages/research.executiveSummary, already
// computed once per watchlist by buildResearch()'s watchlist-level pass and
// the Phase 4 decision layer (data/decision/index.mjs). No new fetch, no new
// computation -- the only work this file does is attach each company's name
// to the symbol-keyed decision-layer lists, a pure lookup against
// research.stocks.

function nameLookup(research) {
  const bySymbol = new Map((research.stocks || []).map(s => [s.symbol, s.name]));
  return (symbol) => bySymbol.get(symbol) || symbol;
}

function portfolioSummary(research) {
  const p = research.portfolio || {};
  return {
    companyCount: (research.stocks || []).filter(s => !s.unresolved).length,
    totalValue: p.dashboard?.totalValue ?? null,
    weightedAverages: p.dashboard?.weightedAverages ?? null,
    beta: p.beta ?? null,
    riskAdjustedReturn: p.riskAdjustedReturn ?? null,
    quality: p.quality ?? null,
    cashTargetPct: p.cashTargetPct ?? 0,
    watchlistRating: research.executiveSummary?.watchlistRating ?? null,
    trend: research.trend ?? null
  };
}

function valuationSummary(research) {
  return {
    averages: research.averages ?? null,
    valuationStatus: research.executiveSummary?.valuationStatus ?? null,
    avgPremiumDiscount: research.executiveSummary?.avgPremiumDiscount ?? null,
    valuationDispersion: research.valuationDispersion ?? null,
    industryPe: research.industryPe ?? null,
    industryPb: research.industryPb ?? null
  };
}

// Concentration analysis pairs the weighted sector/position breakdowns
// (Stage 1 widened positionConcentration to also expose each holding's own
// share of the portfolio-level HHI) with the risk-side decomposition that
// naturally goes with "how concentrated, and how risky as a result" --
// marginal risk contribution and factor exposure, both already computed.
function concentrationAndRisk(research) {
  const p = research.portfolio || {};
  return {
    sectorAllocation: p.sectorAllocation ?? null,
    positionConcentration: p.positionConcentration ?? null,
    diversificationScore: p.diversificationScore ?? null,
    positionRiskContribution: p.positionRiskContribution ?? [],
    factorExposure: p.factorExposure ?? null,
    riskStatus: research.executiveSummary?.riskStatus ?? null,
    avgCompositeRisk: research.executiveSummary?.avgCompositeRisk ?? null
  };
}

function sectorPositioning(research) {
  return research.portfolio?.sectorContribution ?? [];
}

function topOpportunities(research, name) {
  return (research.intelligence?.opportunities || []).map(o => ({ ...o, name: name(o.symbol) }));
}

function topRisks(research, name) {
  return (research.intelligence?.riskMonitor || []).map(r => ({ ...r, name: name(r.symbol) }));
}

function portfolioHealth(research) {
  return research.intelligence?.health ?? { score: null, trend: 'N/A', contributors: [], history: [] };
}

function actionPriorities(research, name) {
  return (research.intelligence?.actionRequired || []).map(a => ({ ...a, name: name(a.symbol) }));
}

function rebalancingRecommendations(research, name) {
  return (research.intelligence?.rebalancing || []).map(r => ({ ...r, name: name(r.symbol) }));
}

// Builds the full portfolio-level review pack model. `research` is the
// already-built buildResearch() payload for the watchlist (cache-only,
// networkPass:'none' -- see server.mjs). This function performs no I/O and
// recomputes no analytic itself.
export function buildPortfolioReviewPack(research) {
  const name = nameLookup(research);
  return {
    generatedAt: new Date().toISOString(),
    watchlistId: research.watchlistId, watchlistName: research.watchlistName,
    metricMeta: research.metricMeta,
    portfolioSummary: portfolioSummary(research),
    valuationSummary: valuationSummary(research),
    concentrationAndRisk: concentrationAndRisk(research),
    sectorPositioning: sectorPositioning(research),
    topOpportunities: topOpportunities(research, name),
    topRisks: topRisks(research, name),
    health: portfolioHealth(research),
    actionPriorities: actionPriorities(research, name),
    rebalancing: rebalancingRecommendations(research, name),
    dataLimitations: research.dataLimitations
  };
}

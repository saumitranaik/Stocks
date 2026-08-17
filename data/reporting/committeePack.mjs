// -- Weekly Investment Committee Pack (Phase 6) -----------------------------
// Structurally the Portfolio Review Pack (data/reporting/portfolioReviewPack.mjs)
// extended with macro/sector context and a change-categorized view over the
// existing per-company diff (data/decision/changeDetection.mjs) -- same
// "pure derivation, zero new computation" discipline. "Weekly" means "since
// this watchlist's own last genuine data refresh" (the same run-over-run
// window change-detection.mjs already tracks), not a guaranteed 7-calendar-
// day window -- refresh cadence is user-driven in this single-user local
// tool, not a scheduled job. macroSnapshot/sectorIntelligence are the same
// cache-first, watchlist-independent builders the Macro/Sector Intelligence
// dashboard sub-tabs already use (data/watchlist/macro.mjs,
// data/watchlist/sectorIntelligence.mjs) -- reused here, not recomputed.

function nameLookup(research) {
  const bySymbol = new Map((research.stocks || []).map(s => [s.symbol, s.name]));
  return (symbol) => bySymbol.get(symbol) || symbol;
}

const VALUATION_FIELDS = new Set(['fairValue', 'targetPrice', 'premiumDiscountScore', 'watchlistRank']);
const RISK_FIELDS = new Set(['compositeRiskScore', 'debtTrendPct', 'financialRiskCategory', 'businessRiskCategory', 'marketRiskCategory', 'sectorRiskCategory', 'governanceRiskCategory']);

// Buckets the existing per-company field-level diff (already computed by
// data/decision/changeDetection.mjs, attached at research.intelligence.
// changes) into Valuation / Risk / Other -- pure categorization by field
// name, not a new diff.
function categorizedChanges(research, name) {
  const bySymbol = research.intelligence?.changes?.bySymbol || {};
  const valuation = [], risk = [], other = [];
  for (const [symbol, entry] of Object.entries(bySymbol)) {
    for (const change of entry.changes || []) {
      const row = { symbol, name: name(symbol), ...change };
      if (VALUATION_FIELDS.has(change.field)) valuation.push(row);
      else if (RISK_FIELDS.has(change.field)) risk.push(row);
      else other.push(row);
    }
  }
  return { valuation, risk, other, summary: research.intelligence?.changes?.summary || [] };
}

function thesisChanges(research, name) {
  const thesis = research.intelligence?.thesis || {};
  return Object.entries(thesis)
    .filter(([, t]) => t?.status && t.status !== 'Intact')
    .map(([symbol, t]) => ({ symbol, name: name(symbol), ...t }));
}

function macroChanges(macroSnapshot) {
  if (!macroSnapshot) return null;
  return {
    regime: macroSnapshot.regime,
    indicators: (macroSnapshot.indicators || []).map(i => ({ label: i.label, category: i.category, direction: i.direction, changePct: i.changePct, status: i.status })),
    dataQuality: macroSnapshot.dataQuality
  };
}

function sectorChanges(sectorIntelligence) {
  if (!sectorIntelligence) return null;
  return { generatedAt: sectorIntelligence.generatedAt, topSectors: (sectorIntelligence.sectors || []).slice(0, 8) };
}

// research/macroSnapshot/sectorIntelligence are each already-built payloads
// (buildResearch() cache-only, buildMacroSnapshot(), buildSectorIntelligence()
// -- see server.mjs's route) -- this function performs no I/O and recomputes
// no analytic itself.
export function buildCommitteePack(research, macroSnapshot, sectorIntelligence) {
  const name = nameLookup(research);
  return {
    generatedAt: new Date().toISOString(),
    watchlistId: research.watchlistId, watchlistName: research.watchlistName,
    metricMeta: research.metricMeta,
    portfolioChanges: categorizedChanges(research, name),
    macroChanges: macroChanges(macroSnapshot),
    sectorChanges: sectorChanges(sectorIntelligence),
    thesisChanges: thesisChanges(research, name),
    valuationSummary: {
      averages: research.averages ?? null,
      valuationStatus: research.executiveSummary?.valuationStatus ?? null,
      avgPremiumDiscount: research.executiveSummary?.avgPremiumDiscount ?? null
    },
    riskSummary: {
      riskStatus: research.executiveSummary?.riskStatus ?? null,
      avgCompositeRisk: research.executiveSummary?.avgCompositeRisk ?? null,
      health: research.intelligence?.health ?? { score: null, trend: 'N/A', contributors: [], history: [] }
    },
    recommendedActions: (research.intelligence?.actionRequired || []).map(a => ({ ...a, name: name(a.symbol) })),
    rebalancing: (research.intelligence?.rebalancing || []).map(r => ({ ...r, name: name(r.symbol) })),
    dataLimitations: [
      ...(research.dataLimitations || []),
      '"Weekly" means since this watchlist\'s own last genuine data refresh (the same run-over-run window data/decision/changeDetection.mjs already tracks) -- refresh cadence is user-driven in this single-user local tool, not a scheduled weekly job, so this may reflect more or less than 7 calendar days.',
      'Macro and sector sections show current state plus each indicator\'s own trailing-window change (already computed by the Macro/Sector Intelligence panels) -- not a dedicated week-over-week snapshot diff, which this app does not yet persist for macro/sector data.'
    ]
  };
}

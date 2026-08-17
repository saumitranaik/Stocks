import { number, precisionForConfidence } from '../util.mjs';
import { timeSeries } from '../analytics/series.mjs';
import { companyCache } from '../watchlist/diskCache.mjs';

// -- Institutional research report model (Phase 3d) --------------------------
// Pure selection/derivation over an already-built `research` payload (as
// returned by buildResearch(), data/watchlist/research.mjs) for one target
// company. No analytic is recomputed here -- every figure below is read
// straight off the unified research model (dcf.mjs, financialValuation.mjs,
// relativeValuation.mjs, technicalScorecard.mjs, institutionalRisk.mjs,
// scoringEngine.mjs, metricsTable.mjs, companyNews.mjs), which is the single
// source of truth every tab in the main app already renders from. The one
// piece of genuinely new data this module reads is the raw weekly price
// series for the chart set below, pulled directly from the same on-disk
// cache research.mjs itself reads (data/watchlist/diskCache.mjs) -- not a new
// network call, just a second read of data already fetched for the dashboard.

const METRIC_LABELS = {
  pe: 'P/E', pb: 'P/B', peg: 'PEG', roe: 'ROE', roce: 'ROCE',
  revenueCagr3y: 'Revenue growth (3Y)', epsCagr3y: 'EPS growth (3Y)', dividendYield: 'Dividend yield'
};

// The primary valuation model this stock resolved to -- DCF for ordinary
// sectors, the justified-P/B model for financial institutions (see
// financialValuation.mjs's sector gate), or neither if both are unavailable.
// Never both at once (research.mjs only computes financialValuation when the
// sector gate excludes DCF), so this is a straight fallback chain, not a
// choice between two live models.
function primaryValuationModel(stock) {
  if (stock.dcf?.available) return { source: 'dcf', ...stock.dcf };
  if (stock.financialValuation?.available) return { source: 'financialValuation', ...stock.financialValuation };
  return null;
}

// Directional read off an already-parsed chronological [period, value] series
// (revenue, profit, margin, ROCE) -- first-to-last % change, +/-3% treated as
// noise ("Stable"). Presentation only: uses the same `timeSeries()` helper
// every other analytics module already reads these rows through, not a new
// calculation. `improvingIfUp=false` for series where a rise is unfavorable
// (none currently used that way here, kept for clarity at call sites).
function trendDirection(pairs, { improvingIfUp = true, thresholdPct = 3 } = {}) {
  const values = (pairs || []).map(([, v]) => v).filter(Number.isFinite);
  if (values.length < 2) return 'N/A';
  const first = values[0], last = values.at(-1);
  if (!first) return 'N/A';
  const changePct = ((last - first) / Math.abs(first)) * 100;
  if (Math.abs(changePct) < thresholdPct) return 'Stable';
  return (changePct > 0) === improvingIfUp ? 'Improving' : 'Deteriorating';
}

function coverHeader(stock, research) {
  return {
    name: stock.name, symbol: stock.symbol, sector: stock.sector, industry: stock.industry,
    exchange: stock.exchange, market: stock.market, currency: stock.currency,
    price: stock.price, signal: stock.signal, generatedAt: research.generatedAt,
    watchlistName: research.watchlistName
  };
}

// Precision-confidence coupling (foundation upgrade, §10/§17): every
// valuation model in this app now discloses its own confidenceBand (DCF/
// financialValuation already did; valuation.mjs's P/E-P/B reversion
// heuristic gained one as part of this upgrade). This report is the one
// place that number is actually shown to a reader, so precisionForConfidence
// is applied here -- presentation only, never touching the underlying
// figure `stock.valuation`/`stock.dcf`/`stock.financialValuation` still
// carry at full precision for every other consumer (the main dashboard,
// the decision layer's own valuationMarginPct calculation, etc.).
function resolvedConfidenceBand(stock, model) {
  return model?.confidenceBand ?? stock.valuation?.confidenceBand ?? null;
}

function executiveSummary(stock, model) {
  const rec = stock.recommendation || {};
  const confidenceBand = resolvedConfidenceBand(stock, model);
  const fairValue = precisionForConfidence(model?.base ?? stock.valuation?.fairValue ?? null, confidenceBand);
  const targetPrice = precisionForConfidence(stock.valuation?.targetPrice ?? null, confidenceBand);
  const upsideToTargetPct = targetPrice != null && stock.price > 0 ? number(((targetPrice - stock.price) / stock.price) * 100) : null;
  const upsideToFairValuePct = fairValue != null && stock.price > 0 ? number(((fairValue - stock.price) / stock.price) * 100) : null;
  const overallView = rec.rating
    ? `${rec.rating}${rec.confidence ? ` (${rec.confidence} confidence)` : ''}${rec.primaryDriver ? ` — primary driver: ${rec.primaryDriver}.` : '.'}${rec.capNote ? ` ${rec.capNote}` : ''}`
    : 'Insufficient data for an institutional rating.';
  return {
    rating: rec.rating ?? null, confidence: rec.confidence ?? null, primaryDriver: rec.primaryDriver ?? null, capNote: rec.capNote ?? null,
    currentPrice: stock.price, currency: stock.currency, fairValue, targetPrice, upsideToTargetPct, upsideToFairValuePct,
    valuationConfidenceBand: confidenceBand,
    investmentHorizon: '12 months', overallView
  };
}

// "Why own" / "Why avoid" bullets from the unified recommendation engine's
// own 5 bucket scores (scoringEngine.mjs) -- a bucket at/above 60 is a
// positive contributor, below 40 a drag, using that engine's own bucket
// labels. No new thresholds beyond what the engine itself already applies
// (60/70/80 and 30/45 are the same tier boundaries ratings.mjs uses).
function whyOwnAvoid(stock) {
  const components = stock.recommendation?.components || {};
  const own = [], avoid = [];
  for (const bucket of Object.values(components)) {
    if (bucket.score == null) continue;
    if (bucket.score >= 60) own.push(`${bucket.label} scores ${bucket.score}/100 — a positive contributor to the overall rating.`);
    else if (bucket.score < 40) avoid.push(`${bucket.label} scores ${bucket.score}/100 — a drag on the overall rating.`);
  }
  return { own, avoid };
}

function investmentThesis(stock) {
  const factors = stock.recommendation?.factors || {};
  const { own, avoid } = whyOwnAvoid(stock);
  return {
    businessQuality: {
      score: factors.businessQuality?.value ?? null,
      dupont: stock.fundamentalsAnalytics?.dupont ?? null,
      roceDecomposition: stock.fundamentalsAnalytics?.roce ?? null,
      earningsQuality: stock.fundamentalsAnalytics?.earningsQuality ?? null
    },
    growthDrivers: {
      revenueCagr3y: stock.metrics?.revenueCagr3y ?? null, revenueCagr5y: stock.metrics?.revenueCagr5y ?? null,
      epsCagr3y: stock.metrics?.epsCagr3y ?? null, epsCagr5y: stock.metrics?.epsCagr5y ?? null,
      profitCagr3y: stock.metrics?.profitCagr3y ?? null, profitCagr5y: stock.metrics?.profitCagr5y ?? null
    },
    competitivePosition: {
      sectorRank: stock.relativeValuation?.sectorRank ?? null, sectorPeerCount: stock.relativeValuation?.sectorPeerCount ?? null,
      multiFactorPeerRank: stock.relativeValuation?.multiFactorPeerRank ?? null,
      sectorTags: stock.institutionalRisk?.sector ?? null
    },
    valuationOpportunity: {
      marginOfSafetyPct: stock.valuation?.marginOfSafetyPct ?? null,
      premiumDiscountScore: stock.relativeValuation?.premiumDiscountScore ?? null,
      relativeAttractivenessScore: stock.relativeValuation?.relativeAttractivenessScore ?? null
    },
    keyRisks: { categories: stock.institutionalRisk?.categories ?? null, flags: stock.keyRiskFlags ?? null },
    whyOwn: own, whyAvoid: avoid
  };
}

function metricsDashboard(stock) {
  const pl = stock.fundamentals?.annual?.profitLoss, ratios = stock.fundamentals?.annual?.ratios;
  const debtTrendPct = stock.institutionalRisk?.financial?.debtTrendPct;
  const promoterTrend = stock.metrics?.promoterHoldingTrend;
  return {
    company: stock.name, sector: stock.sector, industry: stock.industry,
    cmp: stock.price, currency: stock.currency, marketCap: stock.marketCap, marketCapUnit: stock.marketCapUnit,
    pe: stock.pe, pb: stock.pb, evEbitda: null,
    roe: stock.roe, roce: stock.roce,
    revenueGrowth3y: stock.metrics?.revenueCagr3y, epsGrowth3y: stock.metrics?.epsCagr3y,
    debtToEquity: stock.debtToEquity, dividendYield: stock.dividendYield,
    indicators: {
      overallRisk: stock.institutionalRisk?.riskTrend ?? 'N/A',
      revenue: trendDirection(timeSeries(pl, 'sales')),
      profit: trendDirection(timeSeries(pl, 'netProfit')),
      margin: trendDirection(stock.fundamentalsAnalytics?.marginTrend?.operatingMargin || []),
      roce: trendDirection(timeSeries(ratios, 'rocePct')),
      leverage: debtTrendPct == null ? 'N/A' : debtTrendPct > 5 ? 'Deteriorating' : debtTrendPct < -5 ? 'Improving' : 'Stable',
      promoterHolding: promoterTrend == null ? 'N/A' : promoterTrend > 0.5 ? 'Improving' : promoterTrend < -0.5 ? 'Deteriorating' : 'Stable'
    }
  };
}

function valuationAnalysis(stock, model) {
  const confidenceBand = resolvedConfidenceBand(stock, model);
  return {
    primaryModelSource: model?.source ?? null,
    currentPrice: stock.price,
    fairValue: precisionForConfidence(model?.base ?? stock.valuation?.fairValue ?? null, confidenceBand),
    targetPrice: precisionForConfidence(stock.valuation?.targetPrice ?? null, confidenceBand),
    marginOfSafetyPct: stock.valuation?.marginOfSafetyPct ?? null,
    bull: precisionForConfidence(model?.bull ?? null, confidenceBand), base: precisionForConfidence(model?.base ?? null, confidenceBand), bear: precisionForConfidence(model?.bear ?? null, confidenceBand),
    valuationConfidenceBand: confidenceBand,
    sensitivity: stock.dcf?.sensitivity ?? null,
    reverseImpliedGrowthPct: stock.dcf?.reverseImpliedGrowthPct ?? null,
    peHistoricalPercentile: stock.peHistoricalPercentile ?? null, peHistory: stock.peHistory ?? null,
    pbHistoricalPercentile: stock.pbHistoricalPercentile ?? null,
    historicalValuationBand: stock.relativeValuation?.historicalValuationBand ?? null,
    sectorPremiumDiscountPe: stock.sectorPremiumDiscountPe ?? null,
    premiumDiscountScore: stock.relativeValuation?.premiumDiscountScore ?? null,
    methodology: model?.methodology ?? stock.valuation?.methodology ?? null,
    reasonUnavailable: model ? null : (stock.dcf?.reason || stock.financialValuation?.reason || 'Valuation model unavailable')
  };
}

// marginTrend() (margins.mjs) returns raw [period, value] tuples, same shape
// as timeSeries() itself -- mapped to {period, value} here so the chart
// renderer (report.js's sparklineSvg) can read it the same way as every
// other series below, instead of silently rendering "no data".
function mapTuples(pairs) { return (pairs || []).map(([period, value]) => ({ period, value })); }

function financialQuality(stock) {
  const pl = stock.fundamentals?.annual?.profitLoss;
  const rawMarginTrend = stock.fundamentalsAnalytics?.marginTrend;
  return {
    revenueTrend: timeSeries(pl, 'sales').map(([period, value]) => ({ period, value })),
    profitTrend: timeSeries(pl, 'netProfit').map(([period, value]) => ({ period, value })),
    marginTrend: rawMarginTrend ? { operatingMargin: mapTuples(rawMarginTrend.operatingMargin), netMargin: mapTuples(rawMarginTrend.netMargin) } : null,
    marginStability: stock.fundamentalsAnalytics?.marginStability ?? null,
    cashFlowQuality: stock.fundamentalsAnalytics?.earningsQuality ?? null,
    balanceSheetQuality: {
      debtToEquity: stock.debtToEquity, capitalStructure: stock.metrics?.capitalStructure,
      interestCoverage: stock.metrics?.interestCoverage, workingCapital: stock.fundamentalsAnalytics?.workingCapital ?? null
    },
    capitalAllocationQuality: {
      capitalIntensity: stock.fundamentalsAnalytics?.capitalIntensity ?? null,
      roceDecomposition: stock.fundamentalsAnalytics?.roce ?? null,
      capitalAllocationRisk: stock.institutionalRisk?.governance?.capitalAllocationRisk ?? null
    }
  };
}

function technicalOutlook(stock) {
  const ts = stock.technicalScorecard || {};
  return {
    trend: stock.trend, momentum: stock.momentum, volumeTrend: stock.volumeTrend,
    relativeStrengthPct: stock.relativeStrengthPct, relativeStrengthPercentile: stock.relativeStrengthPercentile ?? null,
    support: stock.support, resistance: stock.resistance,
    technicalScore: stock.recommendation?.components?.technical?.score ?? null,
    scores: ts.scores ?? null, advancedScores: ts.advancedScores ?? null,
    regime: ts.regime ?? null, signalConfidence: ts.signalConfidence ?? null
  };
}

function riskAnalysis(stock) {
  const risk = stock.institutionalRisk || {};
  return {
    categories: risk.categories ?? null, compositeRiskScore: risk.compositeRiskScore ?? null, riskTrend: risk.riskTrend ?? null,
    detail: { financial: risk.financial ?? null, business: risk.business ?? null, market: risk.market ?? null, sector: risk.sector ?? null, governance: risk.governance ?? null }
  };
}

function peerComparison(stock) {
  const rv = stock.relativeValuation;
  if (!rv) return null;
  return {
    comparison: (rv.comparison || []).map(row => ({ ...row, label: METRIC_LABELS[row.key] || row.key })),
    sectorRank: rv.sectorRank, sectorPeerCount: rv.sectorPeerCount,
    watchlistRank: rv.watchlistRank, watchlistCount: rv.watchlistCount,
    sectorValuationRank: rv.sectorValuationRank, multiFactorPeerRank: rv.multiFactorPeerRank, multiFactorPeerScore: rv.multiFactorPeerScore,
    relativeAttractivenessScore: rv.relativeAttractivenessScore, watchlistValuationPercentile: rv.watchlistValuationPercentile
  };
}

// News catalysts are already shaped exactly for this by companyNews.mjs
// (title/source/date/url/impact/signalStrength/catalystType/expectedTimeline
// -- 7-category taxonomy: Earnings/Valuation/Industry/Regulatory/Technical/
// Management/Capital allocation, Phase 5); the one addition here is a single
// synthesized "Technical" catalyst row off the technical regime/signal-
// confidence read, timeline "Ongoing" -- never a fabricated event date (this
// app has no earnings-calendar data source). `signalStrength` is a disclosed
// heuristic proxy (impact + recency), never a statistical probability -- see
// metricRegistry.mjs's `catalystSignalStrength` entry.
function catalysts(stock) {
  const news = (stock.news || []).map(n => ({
    title: n.title, source: n.source, date: n.date, url: n.url,
    impact: n.impact, signalStrength: n.signalStrength ?? null, catalystType: n.catalystType, expectedTimeline: n.expectedTimeline
  }));
  const ts = stock.technicalScorecard;
  const technical = ts?.regime ? [{
    title: `Technical regime: ${ts.regime}`, source: 'In-house technical scorecard', date: null, url: null,
    impact: ts.signalConfidence || 'N/A', signalStrength: ts.signalConfidence || null, catalystType: 'Technical', expectedTimeline: 'Ongoing'
  }] : [];
  return [...news, ...technical];
}

// Bull/Base/Bear valuation scenario, read from the primary valuation model
// resolved above, plus this company's own row inside the portfolio-level
// 5-scenario stress test (data/analytics/scenarios.mjs, already computed
// once per watchlist at research.portfolio.scenarios) -- no new stress-test
// math, just this one company's angle on figures already computed for the
// whole watchlist.
function scenarioAnalysis(stock, model, research) {
  const confidenceBand = resolvedConfidenceBand(stock, model);
  const bull = precisionForConfidence(model?.bull ?? null, confidenceBand), base = precisionForConfidence(model?.base ?? null, confidenceBand), bear = precisionForConfidence(model?.bear ?? null, confidenceBand);
  const bullUpsidePct = bull != null && stock.price > 0 ? number(((bull - stock.price) / stock.price) * 100) : null;
  const bearDownsidePct = bear != null && stock.price > 0 ? number(((bear - stock.price) / stock.price) * 100) : null;
  const stressTests = (research.portfolio?.scenarios || []).map(scenario => {
    const perStock = (scenario.perStock || []).find(p => p.symbol === stock.symbol);
    return { key: scenario.key, label: scenario.label, description: scenario.description, impactPct: perStock?.impactPct ?? null };
  });
  return {
    modelSource: model?.source ?? null,
    currentPrice: stock.price,
    bull, base, bear, bullUpsidePct, bearDownsidePct,
    methodology: model?.methodology ?? null,
    stressTests
  };
}

// WACC/growth/sensitivity/confidence-driver breakdown behind the target
// price -- every field read straight off the DCF (or, for banks/NBFCs, the
// Justified P/B) model already resolved above; no new modeling. The
// financial-sector model has no WACC×terminal-growth sensitivity grid (only
// a fixed ±2pp ROE bull/bear band) and this DCF model discounts reported FCF
// directly rather than a decomposed revenue-growth-plus-margin assumption --
// both are disclosed explicitly here rather than fabricated (CLAUDE.md:
// never estimate a figure this app doesn't actually model).
function targetPriceRationale(stock, model) {
  const isFinancialSector = model?.source === 'financialValuation';
  const marginContext = mapTuples(stock.fundamentalsAnalytics?.marginTrend?.operatingMargin);
  return {
    modelSource: model?.source ?? null,
    wacc: !isFinancialSector ? (stock.dcf?.wacc ?? null) : null,
    costOfEquityPct: isFinancialSector ? (stock.financialValuation?.costOfEquityPct ?? null) : (stock.dcf?.wacc?.costOfEquityPct ?? null),
    growthAssumptionPct: isFinancialSector ? (stock.financialValuation?.sustainableGrowthPct ?? null) : (stock.dcf?.growth1Pct ?? null),
    reverseImpliedGrowthPct: stock.dcf?.reverseImpliedGrowthPct ?? null,
    sensitivity: !isFinancialSector ? (stock.dcf?.sensitivity ?? null) : null,
    sensitivityUnavailableReason: isFinancialSector
      ? 'The financial-sector (Justified P/B) model flexes ROE by a fixed ±2pp band for its Bull/Bear cases rather than a WACC × terminal-growth grid — no sensitivity grid is produced for banks/NBFCs/insurers/asset managers.'
      : null,
    valuationConfidenceScore: model?.valuationConfidenceScore ?? null, confidenceBand: model?.confidenceBand ?? null,
    marginAssumptionNote: 'This model does not decompose growth into a separate margin assumption — it discounts reported free cash flow (or, for financial institutions, applies reported ROE) directly. The historical operating-margin trend below is shown for context only, not as a forward modeling input.',
    marginContext,
    methodology: model?.methodology ?? null
  };
}

// Reads Phase 5's thesis-tracking classification (data/decision/
// thesisTracking.mjs, already computed once per watchlist as
// research.intelligence.thesis) -- pure passthrough, no new classification
// logic in the reporting layer itself. `breakers` (foundation upgrade, §14)
// is the same passthrough pattern applied to thesisTracking.mjs's new
// structured thesisBreakers list.
function thesisTrackingSection(research, stock) {
  const entry = research.intelligence?.thesis?.[stock.symbol];
  return entry
    ? { status: entry.status, reasons: entry.reasons, breakers: entry.breakers || [] }
    : { status: 'N/A', reasons: ['Thesis tracking unavailable for this company.'], breakers: [] };
}

// -- Company Quality vs. Stock Attractiveness (foundation upgrade, §4) -----
// Pure passthrough of scoringEngine.mjs's already-computed additive scores --
// the primary rating/compositeScore section (executiveSummary above) is
// completely unchanged by this section's existence.
function companyQualitySection(stock) {
  const rec = stock.recommendation || {};
  return {
    companyQuality: rec.companyQuality || { score: null, label: 'N/A' },
    stockAttractiveness: rec.stockAttractiveness || { score: null, label: 'N/A' },
    fundamentalView: rec.fundamentalView || { score: null, label: 'N/A' },
    marketView: rec.marketView || { score: null, label: 'N/A' },
    actionGuidance: rec.actionGuidance || 'N/A'
  };
}

// -- Segment, Capacity & Forward Estimates (foundation upgrade, §6-§9) -----
// Pure passthrough of data/analytics/forwardFramework.mjs's schema-only
// contracts, plus the Research Quality Gates read (§13/§18) and evidence-
// hierarchy summary (§3) -- every field explicitly discloses its own
// unavailability rather than fabricating a figure this app cannot source.
function forwardOutlookSection(stock) {
  return {
    forwardFramework: stock.forwardFramework || null,
    researchQuality: stock.researchQuality || null
  };
}

// This company's own row inside every already-computed portfolio-level
// figure: allocation weight, quality/valuation attribution (Stage 1 widened
// qualityAttribution/valuationAttribution to expose the full per-company
// `contributors` list, not just the top/bottom 3), marginal risk
// contribution, diversification impact (Stage 1's new
// positionConcentration.contributions), and the Portfolio Action Score's own
// recommendation for this position -- nothing computed here, only looked up.
function portfolioContext(research, stock) {
  const portfolio = research.portfolio || {};
  const qualityRow = (portfolio.qualityAttribution?.contributors || []).find(c => c.symbol === stock.symbol) || null;
  const valuationRow = (portfolio.valuationAttribution?.contributors || []).find(c => c.symbol === stock.symbol) || null;
  const riskRow = (portfolio.positionRiskContribution || []).find(c => c.symbol === stock.symbol) || null;
  const concentrationRow = (portfolio.positionConcentration?.contributions || []).find(c => c.symbol === stock.symbol) || null;
  const action = research.intelligence?.actionScores?.[stock.symbol] || null;
  return {
    weightPct: portfolio.weights?.[stock.symbol] ?? null,
    qualityContribution: qualityRow?.contribution ?? null,
    valuationContribution: valuationRow?.contribution ?? null,
    riskContributionPct: riskRow?.riskContributionPct ?? null,
    diversificationImpactPct: concentrationRow?.hhiContributionPct ?? null,
    actionScore: action?.score ?? null, actionLabel: action?.label ?? null, actionCapNote: action?.capNote ?? null
  };
}

// Explicit "why this rating/action" breakdown -- the unified recommendation
// engine's own 5 bucket scores plus the Portfolio Action Score's 6 bucket
// scores (adds Portfolio Fit), both already computed; this section only
// presents them side by side instead of leaving the reader to piece them
// together from the Thesis and Portfolio Context sections above.
function explainability(research, stock) {
  const c = stock.recommendation?.components || {};
  const action = research.intelligence?.actionScores?.[stock.symbol] || null;
  return {
    rating: stock.recommendation?.rating ?? null, primaryDriver: stock.recommendation?.primaryDriver ?? null, capNote: stock.recommendation?.capNote ?? null,
    recommendationComponents: {
      quality: c.quality?.score ?? null, valuation: c.valuation?.score ?? null,
      technical: c.technical?.score ?? null, risk: c.risk?.score ?? null,
      relativePositioning: c.relativePositioning?.score ?? null
    },
    actionLabel: action?.label ?? null, actionCapNote: action?.capNote ?? null,
    actionComponents: action?.components ?? null
  };
}

function finalVerdict(stock, model, execSummary, research) {
  const confidenceBand = resolvedConfidenceBand(stock, model);
  const bear = precisionForConfidence(model?.bear ?? null, confidenceBand), base = precisionForConfidence(model?.base ?? null, confidenceBand) ?? execSummary.fairValue;
  const downsideToBearPct = bear != null && stock.price > 0 ? number(((bear - stock.price) / stock.price) * 100) : null;
  const riskRewardRatio = Number.isFinite(execSummary.upsideToTargetPct) && Number.isFinite(downsideToBearPct) && downsideToBearPct !== 0
    ? number(Math.abs(execSummary.upsideToTargetPct / downsideToBearPct)) : null;
  const monitoringTriggers = (research.intelligence?.alerts || [])
    .filter(a => a.symbol === stock.symbol)
    .map(a => ({ severity: a.severity, message: a.message }));
  return {
    rating: stock.recommendation?.rating ?? null, confidence: stock.recommendation?.confidence ?? null,
    idealEntryZone: (bear != null && base != null) ? { low: number(Math.min(bear, base)), high: number(Math.max(bear, base)) } : null,
    fairValue: execSummary.fairValue, targetPrice: execSummary.targetPrice,
    riskReward: { upsideToTargetPct: execSummary.upsideToTargetPct, downsideToBearPct, ratio: riskRewardRatio },
    thesisStatus: research.intelligence?.thesis?.[stock.symbol]?.status ?? null,
    monitoringTriggers
  };
}

// Raw series for the report's charts. `research.stocks[i]` deliberately
// doesn't carry the full daily/weekly price series (keeps the main dashboard
// payload small) or a raw revenue/profit array (only CAGR summaries) --
// price comes from one direct read of the same on-disk cache research.mjs
// itself populates (data/watchlist/diskCache.mjs), zero new network calls;
// revenue/profit/ROCE come straight from the fundamentals rows already
// embedded on the stock object, via the same timeSeries() helper every other
// analytics module already reads them through.
function buildChartSeries(stock, cachedBundle) {
  const pl = stock.fundamentals?.annual?.profitLoss, ratios = stock.fundamentals?.annual?.ratios;
  const pricePoints = cachedBundle?.priceHistory?.points || [];
  return {
    price: pricePoints.map(p => ({ date: p.date, value: p.close })),
    revenue: timeSeries(pl, 'sales').map(([period, value]) => ({ period, value })),
    profit: timeSeries(pl, 'netProfit').map(([period, value]) => ({ period, value })),
    operatingMargin: (stock.fundamentalsAnalytics?.marginTrend?.operatingMargin || []).map(([period, value]) => ({ period, value })),
    roce: timeSeries(ratios, 'rocePct').map(([period, value]) => ({ period, value })),
    currentRoe: stock.roe ?? null
  };
}

// Builds the full single-company institutional report model. `research` is
// the already-built buildResearch() payload for the company's watchlist
// (cache-only, networkPass:'none' -- see server.mjs) -- this function does
// not fetch or recompute any analytic itself, only one supplementary
// disk-cache read for chart series (see buildChartSeries above).
export async function buildCompanyReport(research, symbol) {
  const stock = research.stocks?.find(s => s.symbol === symbol);
  if (!stock) return { error: `No company with symbol "${symbol}" in this watchlist.` };
  if (stock.unresolved) return { error: `${stock.name || symbol} has no cached data yet — refresh the watchlist before generating a report.` };

  const model = primaryValuationModel(stock);
  const execSummary = executiveSummary(stock, model);
  const cachedBundle = await companyCache.read(symbol).catch(() => null);

  return {
    generatedAt: new Date().toISOString(),
    watchlistId: research.watchlistId, watchlistName: research.watchlistName,
    metricMeta: research.metricMeta,
    cover: coverHeader(stock, research),
    executiveSummary: execSummary,
    companyQuality: companyQualitySection(stock),
    thesis: investmentThesis(stock),
    thesisTracking: thesisTrackingSection(research, stock),
    metricsDashboard: metricsDashboard(stock),
    valuationAnalysis: valuationAnalysis(stock, model),
    targetPriceRationale: targetPriceRationale(stock, model),
    financialQuality: financialQuality(stock),
    forwardOutlook: forwardOutlookSection(stock),
    technicalOutlook: technicalOutlook(stock),
    riskAnalysis: riskAnalysis(stock),
    scenarioAnalysis: scenarioAnalysis(stock, model, research),
    portfolioContext: portfolioContext(research, stock),
    explainability: explainability(research, stock),
    peerComparison: peerComparison(stock),
    catalysts: catalysts(stock),
    finalVerdict: finalVerdict(stock, model, execSummary, research),
    charts: buildChartSeries(stock, cachedBundle),
    dataLimitations: research.dataLimitations
  };
}

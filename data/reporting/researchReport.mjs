import { number } from '../util.mjs';
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

function executiveSummary(stock, model) {
  const rec = stock.recommendation || {};
  const fairValue = model?.base ?? stock.valuation?.fairValue ?? null;
  const targetPrice = stock.valuation?.targetPrice ?? null;
  const upsideToTargetPct = targetPrice != null && stock.price > 0 ? number(((targetPrice - stock.price) / stock.price) * 100) : null;
  const upsideToFairValuePct = fairValue != null && stock.price > 0 ? number(((fairValue - stock.price) / stock.price) * 100) : null;
  const overallView = rec.rating
    ? `${rec.rating}${rec.confidence ? ` (${rec.confidence} confidence)` : ''}${rec.primaryDriver ? ` — primary driver: ${rec.primaryDriver}.` : '.'}${rec.capNote ? ` ${rec.capNote}` : ''}`
    : 'Insufficient data for an institutional rating.';
  return {
    rating: rec.rating ?? null, confidence: rec.confidence ?? null, primaryDriver: rec.primaryDriver ?? null, capNote: rec.capNote ?? null,
    currentPrice: stock.price, currency: stock.currency, fairValue, targetPrice, upsideToTargetPct, upsideToFairValuePct,
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
  return {
    primaryModelSource: model?.source ?? null,
    currentPrice: stock.price,
    fairValue: model?.base ?? stock.valuation?.fairValue ?? null,
    targetPrice: stock.valuation?.targetPrice ?? null,
    marginOfSafetyPct: stock.valuation?.marginOfSafetyPct ?? null,
    bull: model?.bull ?? null, base: model?.base ?? null, bear: model?.bear ?? null,
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
// (title/source/date/url/impact/catalystType/expectedTimeline); the one
// addition here is a single synthesized "Technical" catalyst row off the
// technical regime/signal-confidence read, timeline "Ongoing" -- never a
// fabricated event date (this app has no earnings-calendar data source).
function catalysts(stock) {
  const news = (stock.news || []).map(n => ({
    title: n.title, source: n.source, date: n.date, url: n.url,
    impact: n.impact, catalystType: n.catalystType, expectedTimeline: n.expectedTimeline
  }));
  const ts = stock.technicalScorecard;
  const technical = ts?.regime ? [{
    title: `Technical regime: ${ts.regime}`, source: 'In-house technical scorecard', date: null, url: null,
    impact: ts.signalConfidence || 'N/A', catalystType: 'Technical', expectedTimeline: 'Ongoing'
  }] : [];
  return [...news, ...technical];
}

function finalVerdict(stock, model, execSummary) {
  const bear = model?.bear ?? null, base = model?.base ?? execSummary.fairValue;
  const downsideToBearPct = bear != null && stock.price > 0 ? number(((bear - stock.price) / stock.price) * 100) : null;
  const riskRewardRatio = Number.isFinite(execSummary.upsideToTargetPct) && Number.isFinite(downsideToBearPct) && downsideToBearPct !== 0
    ? number(Math.abs(execSummary.upsideToTargetPct / downsideToBearPct)) : null;
  return {
    rating: stock.recommendation?.rating ?? null, confidence: stock.recommendation?.confidence ?? null,
    idealEntryZone: (bear != null && base != null) ? { low: number(Math.min(bear, base)), high: number(Math.max(bear, base)) } : null,
    fairValue: execSummary.fairValue, targetPrice: execSummary.targetPrice,
    riskReward: { upsideToTargetPct: execSummary.upsideToTargetPct, downsideToBearPct, ratio: riskRewardRatio }
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
    thesis: investmentThesis(stock),
    metricsDashboard: metricsDashboard(stock),
    valuationAnalysis: valuationAnalysis(stock, model),
    financialQuality: financialQuality(stock),
    technicalOutlook: technicalOutlook(stock),
    riskAnalysis: riskAnalysis(stock),
    peerComparison: peerComparison(stock),
    catalysts: catalysts(stock),
    finalVerdict: finalVerdict(stock, model, execSummary),
    charts: buildChartSeries(stock, cachedBundle),
    dataLimitations: research.dataLimitations
  };
}

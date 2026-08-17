import { ALERT_THRESHOLDS, ALERT_LIFECYCLE } from './config.mjs';

// Stable id (symbol|type) so acknowledgement persists across re-renders and
// refreshes -- see data/watchlist/store.mjs's setAlertAcknowledged. Type
// strings are unique across every condition/transition rule below (verified
// by inspection -- no two rules below ever share a `type`, and each
// condition branch is if/else-if, so a symbol can never emit the same alert
// id twice in one pass) -- duplicate prevention is structural, not a
// runtime check. `detectedAt` here is a request-time placeholder; data/
// decision/index.mjs's applyLifecycle() below overwrites it with the real
// persisted first-detected time before the alert reaches a response.
function alert(symbol, category, type, severity, message, confidence = 'Medium') {
  return { id: `${symbol}|${type}`, symbol, category, type, severity, message, tier: 'Heuristic', confidence, detectedAt: new Date().toISOString() };
}

const SEVERITY_ORDER = ['Low', 'Medium', 'High', 'Critical'];
function bumpSeverity(severity) {
  const idx = SEVERITY_ORDER.indexOf(severity);
  return idx < 0 ? severity : SEVERITY_ORDER[Math.min(idx + 1, SEVERITY_ORDER.length - 1)];
}

// Stage 3 alert lifecycle refinement: stamps each alert's true
// first-detected time (persisted run-over-run in data/cache/
// watchlistSnapshots/<id>.json's `alertLifecycle.firing`, populated by
// data/decision/index.mjs only on a genuine data refresh) in place of the
// request-time placeholder the generators above produce, and escalates
// severity one tier once an alert has been continuously firing for
// ALERT_LIFECYCLE.escalateAfterDays. An id absent from `previousFiring` is
// either brand new or a genuine re-trigger after having cleared -- either
// way its detectedAt resets to now, which is also how index.mjs tells a
// re-trigger apart from a still-firing acknowledged alert. Pure function
// over the alert list + the previous firing map; no I/O.
export function applyLifecycle(alerts, previousFiring, now = new Date()) {
  const nowMs = now.getTime();
  return alerts.map(a => {
    const firstDetectedAt = previousFiring?.[a.id] || a.detectedAt;
    const ageMs = nowMs - new Date(firstDetectedAt).getTime();
    const severity = ageMs >= ALERT_LIFECYCLE.escalateAfterDays * 24 * 60 * 60 * 1000 ? bumpSeverity(a.severity) : a.severity;
    return { ...a, detectedAt: firstDetectedAt, severity };
  });
}

// Standing-threshold conditions -- evaluated fresh every request, no history
// needed. These keep firing (same alert id) for as long as the underlying
// condition holds, which is intentional: acknowledging one suppresses it
// until the condition actually clears (see index.mjs's filtering by
// acknowledgedAlertIds).
export function generateConditionAlerts(stock) {
  if (!stock || stock.unresolved) return [];
  const t = ALERT_THRESHOLDS;
  const alerts = [];

  const mos = stock.valuation?.marginOfSafetyPct;
  if (Number.isFinite(mos) && mos <= t.valuation.marginOfSafetyCriticalPct) {
    alerts.push(alert(stock.symbol, 'valuation', 'marginOfSafetyCritical', 'Critical', `${stock.symbol}: price is ${Math.abs(mos).toFixed(0)}% above modeled fair value -- critical margin-of-safety breach.`));
  } else if (Number.isFinite(mos) && mos <= t.valuation.marginOfSafetyHighPct) {
    alerts.push(alert(stock.symbol, 'valuation', 'marginOfSafetyHigh', 'High', `${stock.symbol}: price is ${Math.abs(mos).toFixed(0)}% above modeled fair value.`));
  }

  // Stage 3: graduated severity -- a P/E sitting above 97% of its own
  // history is a materially stronger signal than merely above 90%.
  const pePct = stock.peHistoricalPercentile;
  if (Number.isFinite(pePct) && pePct >= t.valuation.percentileExtremeCriticalHigh) {
    alerts.push(alert(stock.symbol, 'valuation', 'pePercentileExtremeHigh', 'Critical', `${stock.symbol}: P/E at the ${Math.round(pePct)}th percentile of its own history -- among the most expensive it has ever been.`));
  } else if (Number.isFinite(pePct) && pePct >= t.valuation.percentileExtremeHigh) {
    alerts.push(alert(stock.symbol, 'valuation', 'pePercentileExtremeHigh', 'Medium', `${stock.symbol}: P/E at the ${Math.round(pePct)}th percentile of its own history -- historically expensive.`));
  } else if (Number.isFinite(pePct) && pePct <= t.valuation.percentileExtremeCriticalLow) {
    alerts.push(alert(stock.symbol, 'valuation', 'pePercentileExtremeLow', 'Critical', `${stock.symbol}: P/E at the ${Math.round(pePct)}th percentile of its own history -- among the cheapest it has ever been.`));
  } else if (Number.isFinite(pePct) && pePct <= t.valuation.percentileExtremeLow) {
    alerts.push(alert(stock.symbol, 'valuation', 'pePercentileExtremeLow', 'Medium', `${stock.symbol}: P/E at the ${Math.round(pePct)}th percentile of its own history -- historically cheap.`));
  }

  // Stage 3: graduated severity -- 70/30 stays the textbook Medium trigger,
  // 80/20 graduates to High rather than treating every overbought/oversold
  // reading the same regardless of how extreme it is.
  const rsi = stock.rsi;
  if (Number.isFinite(rsi) && rsi >= t.technical.rsiExtremeOverbought) {
    alerts.push(alert(stock.symbol, 'technical', 'rsiOverbought', 'High', `${stock.symbol}: RSI at ${Math.round(rsi)} -- deeply overbought.`));
  } else if (Number.isFinite(rsi) && rsi >= t.technical.rsiOverbought) {
    alerts.push(alert(stock.symbol, 'technical', 'rsiOverbought', 'Medium', `${stock.symbol}: RSI at ${Math.round(rsi)} -- overbought.`));
  } else if (Number.isFinite(rsi) && rsi <= t.technical.rsiExtremeOversold) {
    alerts.push(alert(stock.symbol, 'technical', 'rsiOversold', 'High', `${stock.symbol}: RSI at ${Math.round(rsi)} -- deeply oversold.`));
  } else if (Number.isFinite(rsi) && rsi <= t.technical.rsiOversold) {
    alerts.push(alert(stock.symbol, 'technical', 'rsiOversold', 'Medium', `${stock.symbol}: RSI at ${Math.round(rsi)} -- oversold.`));
  }

  // Stage 3: added a Critical tier well above the existing mirrored 65
  // cap-trigger (never moved -- scoringEngine.mjs's RISK_ELEVATED_THRESHOLD
  // depends on it) for genuinely extreme composite risk.
  const riskScore = stock.institutionalRisk?.compositeRiskScore;
  if (Number.isFinite(riskScore) && riskScore >= t.risk.compositeCriticalThreshold) {
    alerts.push(alert(stock.symbol, 'risk', 'compositeRiskElevated', 'Critical', `${stock.symbol}: composite risk score ${riskScore}/100 -- critically elevated (caps the recommendation to Hold or below).`));
  } else if (Number.isFinite(riskScore) && riskScore >= t.risk.compositeCapThreshold) {
    alerts.push(alert(stock.symbol, 'risk', 'compositeRiskElevated', 'High', `${stock.symbol}: composite risk score ${riskScore}/100 -- elevated (caps the recommendation to Hold or below).`));
  }

  return alerts;
}

export function generatePortfolioConditionAlerts(portfolio) {
  if (!portfolio) return [];
  const t = ALERT_THRESHOLDS.portfolio;
  const alerts = [];

  // Stage 3: graduated severity -- a single-sector-themed watchlist (e.g.
  // Banking, seeded single-sector by design) sitting near 100% concentrated
  // reads as more severe than one just over the base 40% threshold. This
  // isn't suppressed for themed watchlists (the app has no way to know a
  // concentration is "intentional" vs. accidental, and 100% sector exposure
  // is real, disclosable information either way) -- just proportional.
  const topSector = portfolio.sectorAllocation?.allocation?.[0];
  if (topSector && Number.isFinite(topSector.sharePct) && topSector.sharePct >= t.sectorConcentrationCriticalPct) {
    alerts.push(alert('PORTFOLIO', 'portfolio', 'sectorConcentration', 'Critical', `Portfolio: ${topSector.sector} is ${Math.round(topSector.sharePct)}% of allocated weight -- critically concentrated.`));
  } else if (topSector && Number.isFinite(topSector.sharePct) && topSector.sharePct >= t.sectorConcentrationHighPct) {
    alerts.push(alert('PORTFOLIO', 'portfolio', 'sectorConcentration', 'High', `Portfolio: ${topSector.sector} is ${Math.round(topSector.sharePct)}% of allocated weight -- heavily concentrated.`));
  } else if (topSector && Number.isFinite(topSector.sharePct) && topSector.sharePct >= t.sectorConcentrationPct) {
    alerts.push(alert('PORTFOLIO', 'portfolio', 'sectorConcentration', 'Medium', `Portfolio: ${topSector.sector} is ${Math.round(topSector.sharePct)}% of allocated weight -- concentrated.`));
  }
  const topPosition = portfolio.positionConcentration?.topPositionPct;
  if (Number.isFinite(topPosition) && topPosition >= t.positionConcentrationCriticalPct) {
    alerts.push(alert('PORTFOLIO', 'portfolio', 'positionConcentration', 'Critical', `Portfolio: largest single position is ${Math.round(topPosition)}% of allocated weight -- critically concentrated.`));
  } else if (Number.isFinite(topPosition) && topPosition >= t.positionConcentrationHighPct) {
    alerts.push(alert('PORTFOLIO', 'portfolio', 'positionConcentration', 'High', `Portfolio: largest single position is ${Math.round(topPosition)}% of allocated weight.`));
  } else if (Number.isFinite(topPosition) && topPosition >= t.positionConcentrationPct) {
    alerts.push(alert('PORTFOLIO', 'portfolio', 'positionConcentration', 'Medium', `Portfolio: largest single position is ${Math.round(topPosition)}% of allocated weight.`));
  }

  return alerts;
}

// Crossing/transition events -- need the previous-vs-current diff (see
// changeDetection.mjs's diffCompany). Each rule below maps one diff field to
// an alert category/type/severity/message; fields with no rule (e.g.
// confidence, primaryDriver) are informational-only in the "what changed"
// summary and never become an alert on their own, EXCEPT where explicitly
// disclosed (confidence is Low severity, since a confidence change alone is
// rarely actionable but is still worth surfacing).
const TRANSITION_ALERT_RULES = {
  rating: (change) => {
    const buySide = ['Strong Buy', 'Buy', 'Accumulate'];
    const crossedSide = buySide.includes(change.from) !== buySide.includes(change.to);
    return { category: 'risk', type: 'recommendationChanged', severity: crossedSide ? 'High' : 'Medium', message: (symbol) => `${symbol}: recommendation changed from ${change.from} to ${change.to}.` };
  },
  confidence: (change) => ({ category: 'risk', type: 'confidenceChanged', severity: 'Low', message: (symbol) => `${symbol}: recommendation confidence changed from ${change.from} to ${change.to}.` }),
  fairValue: (change) => {
    if (!Number.isFinite(change.from) || change.from === 0) return null;
    const pct = ((change.to - change.from) / Math.abs(change.from)) * 100;
    const severity = Math.abs(pct) >= ALERT_THRESHOLDS.valuation.fairValueChangePctHigh ? 'High' : Math.abs(pct) >= ALERT_THRESHOLDS.valuation.fairValueChangePctMedium ? 'Medium' : null;
    if (!severity) return null;
    return { category: 'valuation', type: 'fairValueChanged', severity, message: (symbol) => `${symbol}: fair value moved ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% since last refresh.` };
  },
  targetPrice: (change) => {
    if (!Number.isFinite(change.from) || change.from === 0) return null;
    const pct = ((change.to - change.from) / Math.abs(change.from)) * 100;
    // Stage 3: graduated severity, mirrors fairValueChangePctHigh's tiering.
    const severity = Math.abs(pct) >= ALERT_THRESHOLDS.valuation.targetPriceChangePctHigh ? 'High' : Math.abs(pct) >= ALERT_THRESHOLDS.valuation.targetPriceChangePctMedium ? 'Medium' : null;
    if (!severity) return null;
    return { category: 'valuation', type: 'targetPriceChanged', severity, message: (symbol) => `${symbol}: target price moved ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% since last refresh.` };
  },
  premiumDiscountScore: (change) => ({ category: 'valuation', type: 'sectorPremiumDiscountShift', severity: 'Medium', message: (symbol) => `${symbol}: sector premium/discount shifted from ${change.from.toFixed(0)} to ${change.to.toFixed(0)} since last refresh.` }),
  compositeRiskScore: (change) => {
    const delta = change.to - change.from;
    if (delta < ALERT_THRESHOLDS.risk.compositeDeteriorationMedium) return null;
    const severity = delta >= ALERT_THRESHOLDS.risk.compositeDeteriorationHigh ? 'High' : 'Medium';
    return { category: 'risk', type: 'riskDeteriorated', severity, message: (symbol) => `${symbol}: composite risk score rose ${delta.toFixed(0)} points since last refresh.` };
  },
  financialRiskCategory: (change) => {
    const delta = change.to - change.from;
    const severity = delta >= ALERT_THRESHOLDS.risk.categoryIncreaseThreshold * ALERT_THRESHOLDS.risk.categoryIncreaseHighMultiplier ? 'High' : 'Medium';
    return { category: 'risk', type: 'financialRiskIncreased', severity, message: (symbol) => `${symbol}: financial risk category rose ${delta.toFixed(0)} points since last refresh.` };
  },
  // Stage 3: now graduated the same way financialRiskCategory already was
  // (an inconsistency -- these two used a flat Medium regardless of how
  // large the jump was, while financialRiskCategory right above graduated).
  governanceRiskCategory: (change) => {
    const delta = change.to - change.from;
    const severity = delta >= ALERT_THRESHOLDS.risk.categoryIncreaseThreshold * ALERT_THRESHOLDS.risk.categoryIncreaseHighMultiplier ? 'High' : 'Medium';
    return { category: 'risk', type: 'governanceRiskIncreased', severity, message: (symbol) => `${symbol}: governance risk category rose ${delta.toFixed(0)} points since last refresh.` };
  },
  sectorRiskCategory: (change) => {
    const delta = change.to - change.from;
    const severity = delta >= ALERT_THRESHOLDS.risk.categoryIncreaseThreshold * ALERT_THRESHOLDS.risk.categoryIncreaseHighMultiplier ? 'High' : 'Medium';
    return { category: 'risk', type: 'sectorRiskIncreased', severity, message: (symbol) => `${symbol}: sector risk category rose ${delta.toFixed(0)} points since last refresh.` };
  },
  debtTrendPct: (change) => {
    const delta = change.to - change.from;
    const severity = delta >= ALERT_THRESHOLDS.risk.leverageIncreaseHighPctPoints ? 'High' : 'Medium';
    return { category: 'risk', type: 'leverageIncreased', severity, message: (symbol) => `${symbol}: reported 3y debt growth rose from ${change.from.toFixed(0)}% to ${change.to.toFixed(0)}% since last refresh.` };
  },
  technicalRegime: (change) => {
    const breakoutRegimes = ['Volatile Breakout', 'Strong Uptrend'];
    const breakdownRegimes = ['Strong Downtrend', 'Downtrend'];
    if (breakoutRegimes.includes(change.to) && !breakoutRegimes.includes(change.from)) {
      return { category: 'technical', type: 'breakoutConfirmation', severity: 'High', message: (symbol) => `${symbol}: technical regime confirmed a breakout (${change.from} -> ${change.to}).` };
    }
    if (breakdownRegimes.includes(change.to) && !breakdownRegimes.includes(change.from)) {
      return { category: 'technical', type: 'breakdownConfirmation', severity: 'High', message: (symbol) => `${symbol}: technical regime confirmed a breakdown (${change.from} -> ${change.to}).` };
    }
    return { category: 'technical', type: 'regimeChanged', severity: 'Medium', message: (symbol) => `${symbol}: technical regime changed from ${change.from} to ${change.to}.` };
  },
  relativeStrengthPercentile: (change) => ({ category: 'technical', type: 'relativeStrengthAcceleration', severity: 'Medium', message: (symbol) => `${symbol}: relative strength percentile rose from ${Math.round(change.from)} to ${Math.round(change.to)} since last refresh.` }),
  priceAboveFifty: (change) => ({ category: 'technical', type: change.to ? 'crossedAbove50DMA' : 'crossedBelow50DMA', severity: 'Medium', message: (symbol) => `${symbol}: price crossed ${change.to ? 'above' : 'below'} its 50-day moving average.` }),
  priceAboveTwoHundred: (change) => ({ category: 'technical', type: change.to ? 'crossedAbove200DMA' : 'crossedBelow200DMA', severity: 'High', message: (symbol) => `${symbol}: price crossed ${change.to ? 'above' : 'below'} its 200-day moving average.` }),
  rsiZone: (change) => {
    if (change.to !== 'overbought' && change.to !== 'oversold') return null; // only alert entering an extreme, not leaving one -- the standing condition alert already covers "still extreme"
    return { category: 'technical', type: change.to === 'overbought' ? 'rsiEnteredOverbought' : 'rsiEnteredOversold', severity: 'Medium', message: (symbol) => `${symbol}: RSI entered ${change.to} territory.` };
  },
  macdSign: (change) => ({ category: 'technical', type: change.to > 0 ? 'macdCrossedBullish' : 'macdCrossedBearish', severity: 'Medium', message: (symbol) => `${symbol}: MACD histogram crossed ${change.to > 0 ? 'positive' : 'negative'}.` })
};

export function generateTransitionAlerts(stock, diff) {
  if (!stock || !diff || diff.isBaseline || !diff.changes?.length) return [];
  const alerts = [];
  for (const change of diff.changes) {
    const rule = TRANSITION_ALERT_RULES[change.field];
    if (!rule) continue;
    const built = rule(change);
    if (!built) continue;
    alerts.push(alert(stock.symbol, built.category, built.type, built.severity, built.message(stock.symbol)));
  }
  return alerts;
}

export function generatePortfolioTransitionAlerts(portfolio, previousPortfolioSnapshot) {
  if (!portfolio || !previousPortfolioSnapshot) return [];
  const t = ALERT_THRESHOLDS.portfolio;
  const alerts = [];

  // Stage 3: graduated severity on all three (previously flat Medium).
  const prevCorr = previousPortfolioSnapshot.recentAvgCorrelation, currCorr = portfolio.rollingCorrelation?.recentAvgCorrelation;
  if (Number.isFinite(prevCorr) && Number.isFinite(currCorr) && (currCorr - prevCorr) >= t.correlationIncreaseThreshold) {
    const severity = (currCorr - prevCorr) >= t.correlationIncreaseHighThreshold ? 'High' : 'Medium';
    alerts.push(alert('PORTFOLIO', 'portfolio', 'correlationIncrease', severity, `Portfolio: average pairwise correlation rose from ${prevCorr.toFixed(2)} to ${currCorr.toFixed(2)} since last refresh.`));
  }

  const prevBeta = previousPortfolioSnapshot.beta, currBeta = portfolio.beta;
  if (Number.isFinite(prevBeta) && Number.isFinite(currBeta) && (currBeta - prevBeta) >= t.betaIncreaseThreshold) {
    const severity = (currBeta - prevBeta) >= t.betaIncreaseHighThreshold ? 'High' : 'Medium';
    alerts.push(alert('PORTFOLIO', 'portfolio', 'betaIncrease', severity, `Portfolio: beta rose from ${prevBeta.toFixed(2)} to ${currBeta.toFixed(2)} since last refresh.`));
  }

  const prevDiv = previousPortfolioSnapshot.diversificationScore, currDiv = portfolio.diversificationScore;
  if (Number.isFinite(prevDiv) && Number.isFinite(currDiv) && (prevDiv - currDiv) >= t.diversificationDropPts) {
    const severity = (prevDiv - currDiv) >= t.diversificationDropHighPts ? 'High' : 'Medium';
    alerts.push(alert('PORTFOLIO', 'portfolio', 'diversificationDeteriorated', severity, `Portfolio: diversification score fell from ${prevDiv} to ${currDiv} since last refresh.`));
  }

  return alerts;
}

// Single source of truth for every tunable constant the decision layer
// (data/decision/*.mjs) uses -- no threshold, weight, score band or rule
// constant may be hard-coded in actionScore.mjs, changeDetection.mjs,
// alerts.mjs, portfolioHealth.mjs, rebalancing.mjs or index.mjs. Every value
// below is a disclosed heuristic (same class of limitation as the existing
// recommendation/risk/factor-exposure engines' own uncalibrated coefficients
// -- see docs/governance/roadmap.md TD-11): none of it is empirically
// calibrated against real outcomes. A later calibration pass changes only
// this file, never the modules that read it.

export const ACTION_SCORE_WEIGHTS = {
  quality: 25, valuation: 20, technical: 15, risk: 15,
  relativePositioning: 10, portfolioFit: 15
};

// Evaluated top-down; the first band whose `min` the score meets or exceeds
// wins.
export const ACTION_SCORE_BANDS = [
  { min: 80, label: 'Add aggressively' },
  { min: 65, label: 'Add' },
  { min: 45, label: 'Hold' },
  { min: 25, label: 'Reduce' },
  { min: 0, label: 'Exit' }
];

export const PORTFOLIO_FIT = {
  underweightDriftPct: 3, // effectiveWeightPct this far below targetWeightPct scores "room to add"
  overweightDriftPct: 3, // effectiveWeightPct this far above targetWeightPct scores "crowded"
  highCorrelationThreshold: 0.7 // mirrors correlation.mjs's own highlyCorrelated threshold
};

export const ALERT_THRESHOLDS = {
  valuation: {
    marginOfSafetyCriticalPct: -20, // mirrors scoringEngine.mjs's MATERIAL_OVERVALUATION_PCT cap trigger -- never move this without updating scoringEngine.mjs too
    marginOfSafetyHighPct: -10,
    fairValueChangePctMedium: 10,
    fairValueChangePctHigh: 20,
    targetPriceChangePctMedium: 10,
    targetPriceChangePctHigh: 20, // mirrors fairValueChangePctHigh -- Stage 3 calibration: was single-tier (always Medium)
    percentileExtremeHigh: 90,
    percentileExtremeLow: 10,
    percentileExtremeCriticalHigh: 97, // Stage 3: second tier above the existing 90/10 -- P/E sitting above 97% of its own history is a materially stronger signal than "above 90%"
    percentileExtremeCriticalLow: 3,
    premiumDiscountShiftPts: 15
  },
  technical: {
    rsiOverbought: 70,
    rsiOversold: 30,
    rsiExtremeOverbought: 80, // Stage 3: second tier above the standard 70/30 RSI bands -- 70/30 stays the textbook Medium trigger, >=80/<=20 graduates to High
    rsiExtremeOversold: 20,
    breakoutQualityHigh: 70,
    relativeStrengthAccelerationPts: 15
  },
  risk: {
    compositeDeteriorationMedium: 10,
    compositeDeteriorationHigh: 20,
    compositeCapThreshold: 65, // mirrors scoringEngine.mjs's RISK_ELEVATED_THRESHOLD -- never move this without updating scoringEngine.mjs too
    compositeCriticalThreshold: 85, // Stage 3: third tier well above the mirrored 65 cap-trigger, for genuinely extreme composite risk
    categoryIncreaseThreshold: 10,
    categoryIncreaseHighMultiplier: 2, // categoryIncreaseThreshold x this = High severity -- Stage 3: now applied uniformly to financial/business/market/sector/governance risk-category alerts (previously only financialRiskCategory used it)
    leverageIncreasePctPoints: 5,
    leverageIncreaseHighPctPoints: 15
  },
  portfolio: {
    sectorConcentrationPct: 40, // mirrors portfolio.mjs's sectorAllocation() >40% flag
    sectorConcentrationHighPct: 65, // Stage 3: graduated tiers -- a single-sector-themed watchlist (e.g. Banking) sitting near 100% should read as more severe than one just over 40%
    sectorConcentrationCriticalPct: 85,
    positionConcentrationPct: 20,
    positionConcentrationHighPct: 35,
    positionConcentrationCriticalPct: 50,
    correlationIncreaseThreshold: 0.15,
    correlationIncreaseHighThreshold: 0.30,
    betaIncreaseThreshold: 0.10,
    betaIncreaseHighThreshold: 0.25,
    diversificationDropPts: 10,
    diversificationDropHighPts: 20
  }
};

export const REBALANCING = {
  weightDriftPct: 3
};

export const HEALTH_HISTORY_MAX_ENTRIES = 30;

export const HEALTH_WEIGHTS = {
  quality: 30, diversification: 25, risk: 20, technical: 15, sectorBalance: 10
};

// Stage 3 calibration: Action Score has no minimum-signal-coverage floor --
// when only 1-2 of the 6 buckets resolve, the score renormalizes 100% onto
// whichever did, so a single strong/weak signal can produce a confident-
// looking "Add aggressively"/"Exit" label. Mirrors scoringEngine.mjs's own
// confidence-gated rating caps (Strong Buy requires High confidence): below
// this resolved-weight share, actionScore.mjs caps the label to Hold and
// discloses why via a capNote (same disclosed-cap convention as
// recommendation.capNote -- see system.md §4.2).
export const ACTION_SCORE = {
  minResolvedWeightShare: 0.5
};

// Stage 3 alert lifecycle refinement: how long an alert can stay
// continuously firing before it escalates one severity tier
// (Low -> Medium -> High -> Critical, capped). Evaluated against the
// alert's persisted first-detected timestamp (data/watchlist/
// snapshotCache.mjs's `alertLifecycle.firing`), which only advances on a
// genuine data refresh -- same cadence as every other run-over-run figure
// in this app. A disclosed heuristic, not a compliance SLA: 7 days is a
// reasonable "this has been sitting unresolved for a while" bar for a
// single-user tool checked periodically, not empirically calibrated (same
// TD-11-class limitation as every other constant in this file).
export const ALERT_LIFECYCLE = {
  escalateAfterDays: 7
};

// Phase 5 thesis tracking (data/decision/thesisTracking.mjs): classifies a
// company's investment thesis as Intact/Improving/Weakening/Broken by
// blending already-computed run-over-run deltas (rating tier movement,
// composite risk direction, technical crossing/regime direction, relative-
// valuation rank movement) -- same weighted-blend-plus-hard-trigger pattern
// as ACTION_SCORE/ALERT_THRESHOLDS above, not a new analytics engine. Same
// TD-11-class disclosure: none of this is empirically calibrated.
export const THESIS_TRACKING = {
  weights: {
    ratingRank: 3, // dominant signal -- a rating-tier move is the strongest evidence the thesis itself changed
    compositeRisk: 1,
    technical: 1,
    relativeValuation: 1
  },
  // |net weighted signal| at or below this classifies as Intact (mixed or
  // negligible movement, not a real directional read).
  neutralBandScore: 1,
  // A rating downgrade of this many tiers or more (via scoring/ratings.mjs's
  // TIER_ORDER) is a hard "Broken" trigger regardless of the net blended
  // score -- mirrors ALERT_THRESHOLDS' own hard-threshold-plus-magnitude
  // style rather than letting one strong technical/risk signal offset a real
  // multi-tier downgrade.
  brokenRatingDowngradeTiers: 2
};

// Phase 6 market regime classification (data/decision/marketRegime.mjs):
// thresholds for reading India VIX level and macro-indicator direction off
// the macro snapshot (data/watchlist/macro.mjs). Same disclosed-heuristic,
// uncalibrated-constant convention as every other block in this file -- a
// rule-based read, not a statistical regime-detection model.
export const MARKET_REGIME = {
  vixRiskOffLevel: 20,
  vixRiskOnLevel: 13,
  directionChangePctThreshold: 0.15 // |change%| below this reads "Flat" for a macro indicator's direction
};

// Phase 6 exposure matrix (data/decision/exposureMatrix.mjs): weights for
// rolling up each company's per-sensitivity tag (data/analytics/
// exposureRules.mjs) into a portfolio-level weighted exposure read. Same
// uncalibrated-constant disclosure as the rest of this file.
export const EXPOSURE_MATRIX = {
  highSensitivityThreshold: 65,
  moderateSensitivityThreshold: 40
};

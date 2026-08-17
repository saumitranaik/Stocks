// -- Forward-looking foundation schemas (§6, §7, §8, §9) --------------------
// Contracts/schemas only, not real calculations -- no data source for any of
// these four concepts exists anywhere in this app today, and this module
// does not pretend otherwise. Each builder returns the same shape every
// "Future Integration"-class field in this codebase already uses
// (data/analytics/earningsAnalytics.mjs, data/providers/macroProvider.mjs):
// `available: false` plus a disclosed `reason` and the field-level `schema`
// a future data-source integration would populate, so that integration is a
// matter of filling in real values against an already-agreed shape, not a
// redesign. Pure, no I/O -- consistent with every other data/analytics/
// module (system.md §4).

export function forwardEstimateFramework() {
  return {
    available: false,
    reason: 'No forward-estimate model exists in this app — no analyst-consensus feed and no independent forecasting engine has been built yet (see docs/governance/roadmap.md domain 03, item 03.13).',
    schema: { metric: null, period: null, managementGuidance: null, systemEstimate: null, actual: null, variancePct: null, status: null }
  };
}

export function managementCredibilityFramework() {
  return {
    available: false,
    reason: 'No management-guidance data source exists in this app (no investor-presentation/concall/transcript feed is integrated) — guidance-vs-actual delivery tracking cannot be computed (see docs/governance/roadmap.md domain 03, item 03.14).',
    // status: one of Delivered / Mostly delivered / Partially delivered / Missed / Not yet measurable
    schema: { guidanceMetric: null, guidancePeriod: null, guidanceValue: null, actualValue: null, variancePct: null, deliveryStatus: null }
  };
}

export function segmentEconomicsFramework() {
  return {
    available: false,
    reason: 'Screener.in exposes no segment/business-unit revenue or EBITDA breakdown for this company (dataCompleteness.segments is false at the source, see data/providers/screenerProvider.mjs) — segment-level economics cannot be computed (see docs/governance/roadmap.md domain 03, item 03.15).',
    schema: { segment: null, revenue: null, revenueSharePct: null, revenueGrowthPct: null, ebitda: null, ebitdaMarginPct: null, capacity: null, utilizationPct: null, capex: null, strategicImportance: null }
  };
}

export function capacityUtilizationFramework() {
  return {
    available: false,
    reason: 'No capacity/utilization data source exists in this app — not exposed by Screener.in or any other integrated provider (see docs/governance/roadmap.md domain 03, item 03.16).',
    schema: { segment: null, installedCapacity: null, utilizationPct: null, realizationPerUnit: null, revenuePotential: null }
  };
}

// Single per-stock attachment point (data/watchlist/research.mjs) -- one
// object, four named sub-frameworks, so a future data-source integration has
// one place to fill in rather than four independent attachment sites.
export function buildForwardFramework() {
  return {
    forwardEstimates: forwardEstimateFramework(),
    managementCredibility: managementCredibilityFramework(),
    segmentEconomics: segmentEconomicsFramework(),
    capacityUtilization: capacityUtilizationFramework()
  };
}

// Evidence hierarchy (A-F): a provenance classification layered ON TOP OF
// the existing Sourced/Calculated/Heuristic tier (see metricRegistry.mjs) --
// it never replaces that contract. `tier` answers "how was this figure
// produced"; `evidenceTier` answers "how authoritative is the underlying
// source" -- a Calculated figure built on an audited filing (e.g. P/B from
// reported book value) is higher-provenance than a Heuristic figure built on
// this project's own assumption constants (e.g. WACC), even though today's
// tier field alone can't distinguish that.
//
//   A -- Audited/company filing, exchange or regulatory source
//   B -- Company management guidance / investor presentation / concall
//   C -- High-quality independent research (e.g. a named third-party report)
//   D -- Reputable financial/news source
//   E -- Derived calculation (deterministic arithmetic on higher-tier inputs)
//   F -- System heuristic / estimation (this project's own judgment call)
//
// No B or C source exists anywhere in this app today (no investor-
// presentation/concall feed, no third-party research integration) -- that is
// a real, disclosed gap, not filled with an invented mapping. Every entry
// below is a *default*, keyed off the existing `tier`; metricRegistry.mjs
// overrides it per-metric only where the default would be wrong for that
// specific figure (e.g. a DCF fair value is `heuristic` tier but many steps
// of arithmetic away from a raw sourced input, so it stays F, not E).
export const EVIDENCE_TIERS = {
  A: 'Audited / company filing / exchange / regulatory source',
  B: 'Management guidance / investor presentation / concall',
  C: 'High-quality independent research',
  D: 'Reputable financial / news source',
  E: 'Derived calculation',
  F: 'System heuristic / estimation'
};

// Default evidence tier for a metric that has no explicit override, based on
// its existing Sourced/Calculated/Heuristic classification. `isNews: true`
// selects D instead of A for a `sourced` metric that's actually a news
// headline (Google News RSS), not a filing.
export function defaultEvidenceTier(tier, { isNews = false } = {}) {
  if (tier === 'sourced') return isNews ? 'D' : 'A';
  if (tier === 'calculated') return 'E';
  if (tier === 'heuristic') return 'F';
  return null;
}

export function evidenceLabel(evidenceTierKey) {
  return EVIDENCE_TIERS[evidenceTierKey] || null;
}

import { actionScore, portfolioFitScore } from './actionScore.mjs';
import { diffCompany, hasAdvanced, extractSnapshotFields } from './changeDetection.mjs';
import { generateConditionAlerts, generateTransitionAlerts, generatePortfolioConditionAlerts, generatePortfolioTransitionAlerts, applyLifecycle } from './alerts.mjs';
import { portfolioHealthScore } from './portfolioHealth.mjs';
import { rebalancingSuggestions } from './rebalancing.mjs';
import { thesisStatus, thesisBreakers } from './thesisTracking.mjs';
import { HEALTH_HISTORY_MAX_ENTRIES } from './config.mjs';

// Single orchestration entrypoint for the Phase 4 decision layer -- called
// once from data/watchlist/research.mjs's buildResearch(), same pattern as
// the existing scoring-engine call. Reads only fields already computed by
// data/analytics/* and data/scoring/* (plus the persisted run-over-run
// snapshot); performs no I/O and recomputes nothing.
//
// Stage 3: this is a single pass over `stocks` that produces everything --
// the response-shaped `intelligence` object, the snapshot to persist next
// (`nextSnapshot`, null when nothing genuinely advanced -- see below), and
// any alert ids that need pruning from the watchlist's acknowledged list
// (`reactivatedAlertIds`). Previously this was two separate top-level
// functions (buildPortfolioIntelligence + deriveNextSnapshot) called back
// to back from research.mjs, each looping over `stocks` and each calling
// portfolioHealthScore() independently -- a real (if cheap) duplicate
// computation. Folding them into one pass fixes that and is also what
// makes the alert-lifecycle bookkeeping below possible without a second
// alert-generation pass.
export function buildPortfolioIntelligence(payload, previousSnapshot, acknowledgedAlertIds = []) {
  const stocks = payload.stocks || [];
  const previousCompanies = previousSnapshot?.companies || {};
  const previousFiring = previousSnapshot?.alertLifecycle?.firing || {};
  // A snapshot written before Stage 3 (or one that predates this
  // watchlist's very first genuine refresh) has no `alertLifecycle` key at
  // all -- that's a missing baseline, not evidence that "nothing was
  // firing." Treating it as an empty firing set would read every
  // already-acknowledged, still-firing alert as a brand-new re-trigger on
  // the first request after upgrade and incorrectly un-suppress it. Until a
  // real baseline exists, fall back to the pre-Stage-3 behavior (an
  // acknowledged id stays suppressed, full stop); the migration write below
  // establishes the baseline so this only ever applies once per watchlist.
  const hasLifecycleBaseline = !!previousSnapshot?.alertLifecycle;
  const previouslyFiringIds = new Set(Object.keys(previousFiring));
  const acknowledged = new Set(acknowledgedAlertIds);

  const actionScores = {};
  const changesBySymbol = {};
  const changesSummary = [];
  const rawAlerts = [];
  const nextCompanies = {};
  const thesis = {};
  let anyAdvanced = false;

  for (const stock of stocks) {
    if (stock.unresolved) continue;

    const fit = portfolioFitScore(stock, payload.portfolio);
    const action = actionScore(stock, fit);
    if (action) actionScores[stock.symbol] = action;

    const previous = previousCompanies[stock.symbol] || null;
    const diff = diffCompany(previous, stock);
    changesBySymbol[stock.symbol] = { hasChanges: diff.hasChanges, changes: diff.changes };
    for (const change of diff.changes) changesSummary.push(`${stock.symbol}: ${change.label} ${change.from} -> ${change.to}`);

    // Phase 5 thesis tracking: reuses the same previous/current snapshot-
    // field objects diffCompany() just computed above -- no new I/O, no
    // second pass over stocks. `breakers` (foundation upgrade, §14) is
    // additive alongside the existing status/reasons -- see
    // thesisTracking.mjs's thesisBreakers() doc comment.
    thesis[stock.symbol] = { ...thesisStatus(previous, diff.current), breakers: thesisBreakers({ stock, previous, current: diff.current }) };

    rawAlerts.push(...generateConditionAlerts(stock), ...generateTransitionAlerts(stock, diff));

    // A company's persisted snapshot entry only advances when its own
    // fetchedAt is newer than what's stored -- i.e. only on a genuine
    // refetch, never a cache-only re-render (see changeDetection.mjs's
    // hasAdvanced doc comment). Condition/transition alerts above are a
    // pure function of the stock's own fields, which themselves only
    // change on a genuine refetch -- so a cache-only render always
    // reproduces byte-identical alerts to the last genuine refresh, which
    // is what makes it safe to only persist alertLifecycle on the same
    // anyAdvanced cadence below (nothing is lost between refreshes).
    if (hasAdvanced(previous, stock)) {
      anyAdvanced = true;
      nextCompanies[stock.symbol] = extractSnapshotFields(stock);
    } else {
      nextCompanies[stock.symbol] = previous || extractSnapshotFields(stock);
    }
  }

  rawAlerts.push(
    ...generatePortfolioConditionAlerts(payload.portfolio),
    ...generatePortfolioTransitionAlerts(payload.portfolio, previousSnapshot?.portfolio || null)
  );

  // Stage 3 alert lifecycle: stamp real first-detected times + severity
  // escalation (alerts.mjs's applyLifecycle), then split into "still
  // suppressed" vs. "reactivated" -- an acknowledged id that wasn't firing
  // as of the last genuine refresh is a genuine re-trigger (the condition
  // cleared and came back), not a still-open acknowledged alert, so it is
  // not suppressed and gets pruned from the watchlist's acknowledged list
  // (research.mjs does the actual store write for reactivatedAlertIds).
  const lifecycleAlerts = applyLifecycle(rawAlerts, previousFiring);
  const reactivatedAlertIds = hasLifecycleBaseline
    ? lifecycleAlerts.filter(a => acknowledged.has(a.id) && !previouslyFiringIds.has(a.id)).map(a => a.id)
    : [];
  const alerts = lifecycleAlerts.filter(a => !acknowledged.has(a.id) || (hasLifecycleBaseline && !previouslyFiringIds.has(a.id)));

  const resolvedStocks = stocks.filter(s => !s.unresolved);

  const urgencyOf = (label) => ({ 'Add aggressively': 0, Exit: 0, Add: 1, Reduce: 1, Hold: 2 }[label] ?? 2);
  const actionRequired = resolvedStocks
    .filter(s => actionScores[s.symbol])
    .map(s => ({ symbol: s.symbol, label: actionScores[s.symbol].label, score: actionScores[s.symbol].score, rationale: s.recommendation?.primaryDriver || null }))
    .sort((a, b) => urgencyOf(a.label) - urgencyOf(b.label) || Math.abs(b.score - 50) - Math.abs(a.score - 50));

  const opportunities = resolvedStocks
    .filter(s => ['Add aggressively', 'Add'].includes(actionScores[s.symbol]?.label) && (s.valuation?.upsidePct ?? 0) > 0)
    .map(s => ({ symbol: s.symbol, reason: `Action Score ${actionScores[s.symbol].score} (${actionScores[s.symbol].label}), ${Math.round(s.valuation.upsidePct)}% upside to target.` }));

  const riskMonitor = resolvedStocks
    .filter(s => (s.institutionalRisk?.compositeRiskScore ?? 0) >= 65 || s.institutionalRisk?.riskTrend === 'Deteriorating')
    .map(s => ({ symbol: s.symbol, reason: s.institutionalRisk?.riskTrend === 'Deteriorating' ? 'Composite risk trend: Deteriorating.' : `Composite risk score ${s.institutionalRisk.compositeRiskScore}/100 -- elevated.` }));

  // Computed exactly once now (see the doc comment above the function).
  const health = portfolioHealthScore(payload, previousSnapshot?.portfolio || null);
  const rebalancing = rebalancingSuggestions(payload, actionScores);

  const intelligence = {
    actionScores, actionRequired, opportunities, riskMonitor,
    changes: { bySymbol: changesBySymbol, summary: changesSummary },
    alerts,
    health: health || { score: null, trend: 'N/A', contributors: [], history: previousSnapshot?.portfolio?.healthHistory || [] },
    rebalancing,
    thesis
  };

  // Pure derivation of the snapshot to persist next. `null` when nothing
  // genuinely advanced this request -- every company's fetchedAt and the
  // portfolio/health/alert-lifecycle figures derived from it are then
  // guaranteed byte-identical to what's already on disk (see the
  // anyAdvanced reasoning above), so data/watchlist/research.mjs can skip
  // the disk write entirely on a cache-only render instead of rewriting an
  // identical file every single request. This was the dominant cost behind
  // the 185-300ms regression the Stage 1+2 validation ledger flagged
  // (against the pre-Phase-4 40-80ms cache-only baseline) -- the write
  // itself carried zero new information on the overwhelming majority of
  // requests (startup paint, watchlist switch, every mutation's re-render).
  // `!hasLifecycleBaseline` is the one-time migration case: nothing about
  // the company/portfolio data itself changed, but this watchlist's
  // snapshot predates alert-lifecycle tracking, so it needs exactly one
  // write to establish the `alertLifecycle` baseline (companies/portfolio
  // carried forward unchanged, not rebuilt) -- every request after that one
  // has a real baseline and reverts to the anyAdvanced-only gating above.
  let nextSnapshot = null;
  if (anyAdvanced) {
    let healthHistory = Array.isArray(previousSnapshot?.portfolio?.healthHistory) ? [...previousSnapshot.portfolio.healthHistory] : [];
    if (health?.score != null) {
      healthHistory.push({ fetchedAt: new Date().toISOString(), healthScore: health.score });
      if (healthHistory.length > HEALTH_HISTORY_MAX_ENTRIES) healthHistory = healthHistory.slice(-HEALTH_HISTORY_MAX_ENTRIES);
    }
    const portfolio = payload.portfolio;
    const portfolioSnapshot = {
      beta: portfolio?.beta ?? null,
      diversificationScore: portfolio?.diversificationScore ?? null,
      compositeRiskScoreAvg: portfolio?.quality?.riskScore ?? null,
      topSectorSharePct: portfolio?.sectorAllocation?.allocation?.[0]?.sharePct ?? null,
      recentAvgCorrelation: portfolio?.rollingCorrelation?.recentAvgCorrelation ?? null,
      healthScore: health?.score ?? null,
      healthHistory
    };
    const firing = Object.fromEntries(lifecycleAlerts.map(a => [a.id, a.detectedAt]));
    nextSnapshot = {
      watchlistId: payload.watchlistId, savedAt: new Date().toISOString(),
      companies: nextCompanies, portfolio: portfolioSnapshot,
      alertLifecycle: { firing }
    };
  } else if (!hasLifecycleBaseline) {
    const firing = Object.fromEntries(lifecycleAlerts.map(a => [a.id, a.detectedAt]));
    nextSnapshot = {
      watchlistId: payload.watchlistId, savedAt: new Date().toISOString(),
      companies: nextCompanies, portfolio: previousSnapshot?.portfolio || null,
      alertLifecycle: { firing }
    };
  }

  return { intelligence, nextSnapshot, reactivatedAlertIds };
}

import { REBALANCING, ALERT_THRESHOLDS } from './config.mjs';

// Rule-based rebalancing suggestions -- purely a composition of already-
// computed fields (Portfolio Action Score, weight drift, sector allocation,
// quality/valuation attribution, position risk contribution). No optimizer,
// no new analytics: a suggestion to consider, not a trade instruction.
export function rebalancingSuggestions(payload, actionScoresBySymbol) {
  const portfolio = payload?.portfolio;
  const stocks = payload?.stocks || [];
  const suggestions = [];

  const concentratedSector = portfolio?.sectorAllocation?.allocation?.[0];
  const isSectorConcentrated = !!(concentratedSector && Number.isFinite(concentratedSector.sharePct) && concentratedSector.sharePct >= ALERT_THRESHOLDS.portfolio.sectorConcentrationPct);

  for (const stock of stocks) {
    if (stock.unresolved) continue;
    const action = actionScoresBySymbol[stock.symbol];
    if (!action) continue;

    const target = stock.targetWeightPct, effective = stock.effectiveWeightPct;
    const drift = Number.isFinite(target) && Number.isFinite(effective) ? effective - target : null;

    if (['Add aggressively', 'Add'].includes(action.label) && Number.isFinite(drift) && drift <= -REBALANCING.weightDriftPct) {
      suggestions.push({ symbol: stock.symbol, action: 'Increase weight', rationale: `Action Score ${action.score} (${action.label}), allocation ${Math.abs(Math.round(drift))}pp below target.` });
    }
    if (['Reduce', 'Exit'].includes(action.label) && Number.isFinite(effective) && effective > 0) {
      suggestions.push({ symbol: stock.symbol, action: action.label === 'Exit' ? 'Exit position' : 'Reduce weight', rationale: `Action Score ${action.score} (${action.label}).` });
    }
    if (isSectorConcentrated && stock.sector === concentratedSector.sector && ['Reduce', 'Hold'].includes(action.label)) {
      suggestions.push({ symbol: stock.symbol, action: 'Diversify sector', rationale: `${stock.sector} is ${Math.round(concentratedSector.sharePct)}% of allocated weight; not a top Action Score name in that sector.` });
    }
  }

  for (const laggard of portfolio?.qualityAttribution?.topNegative || []) {
    if (laggard.contribution < 0) suggestions.push({ symbol: laggard.symbol, action: 'Improve quality', rationale: `Largest negative contributor to portfolio quality score (${laggard.contribution}).` });
  }
  for (const contributor of (portfolio?.positionRiskContribution || []).slice(0, 2)) {
    if (contributor.riskContributionPct >= 25) suggestions.push({ symbol: contributor.symbol, action: 'Reduce risk', rationale: `Contributes ${Math.round(contributor.riskContributionPct)}% of total portfolio risk.` });
  }

  return suggestions;
}

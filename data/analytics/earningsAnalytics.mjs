import { timeSeries } from './series.mjs';
import { number } from '../util.mjs';

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// Real quarter-over-quarter / year-over-year deltas over Screener's own
// scraped quarterly P&L series (fundamentals.quarterly.profitLoss -- already
// fetched for every India company by the existing provider, previously
// unused anywhere downstream -- see system.md §3.3). "Deviation vs. trailing
// average" is the honest substitute for what the Phase 6 brief calls an
// earnings "surprise": this app has no analyst-consensus-estimate data
// source, so a deviation vs. this company's own trailing 4-quarter average
// is disclosed as exactly that -- never presented as a beat/miss vs. Street
// expectations.
export function quarterlyEarningsAnalytics(quarterlyProfitLoss) {
  if (!quarterlyProfitLoss?.periods?.length) return null;
  const revenue = timeSeries(quarterlyProfitLoss, 'sales');
  const netProfit = timeSeries(quarterlyProfitLoss, 'netProfit');
  const opm = timeSeries(quarterlyProfitLoss, 'opmPct');
  if (revenue.length < 2) return null;

  const deltaFor = (series, quartersBack) => series.length > quartersBack ? pctChange(series.at(-1)?.[1], series.at(-1 - quartersBack)?.[1]) : null;
  const trailingAverage = (series, quarters = 4) => {
    const window = series.slice(-1 - quarters, -1).map(([, v]) => v).filter(Number.isFinite); // excludes the latest quarter itself
    return window.length ? window.reduce((a, b) => a + b, 0) / window.length : null;
  };

  const marginDeltaPts = (series, quartersBack) => series.length > quartersBack && Number.isFinite(series.at(-1)?.[1]) && Number.isFinite(series.at(-1 - quartersBack)?.[1])
    ? number(series.at(-1)[1] - series.at(-1 - quartersBack)[1]) : null;

  return {
    latestPeriod: revenue.at(-1)?.[0] ?? null,
    revenue: {
      latest: number(revenue.at(-1)?.[1]), qoqPct: number(deltaFor(revenue, 1)), yoyPct: number(deltaFor(revenue, 4)),
      deviationVsTrailingAvgPct: number(pctChange(revenue.at(-1)?.[1], trailingAverage(revenue)))
    },
    netProfit: {
      latest: number(netProfit.at(-1)?.[1]), qoqPct: number(deltaFor(netProfit, 1)), yoyPct: number(deltaFor(netProfit, 4)),
      deviationVsTrailingAvgPct: number(pctChange(netProfit.at(-1)?.[1], trailingAverage(netProfit)))
    },
    operatingMargin: { latestPct: number(opm.at(-1)?.[1]), qoqDeltaPts: marginDeltaPts(opm, 1), yoyDeltaPts: marginDeltaPts(opm, 4) }
  };
}

// Per-company Earnings Intelligence card: the quarterly deltas above (real,
// calculated) plus every calendar-dependent field the Phase 6 brief asks for
// that this app has no data source for (next earnings date, days remaining,
// expected impact, historical earnings reaction, guidance changes,
// management commentary, estimate-revision signals) -- explicit "Future
// Integration" status, never estimated or fabricated. Same Data Quality
// convention as data/watchlist/macro.mjs's Macro Intelligence panel.
export function earningsIntelligence(fundamentals) {
  const quarterly = quarterlyEarningsAnalytics(fundamentals?.quarterly?.profitLoss);
  return {
    quarterly,
    dataStatus: quarterly ? 'Live' : 'Unavailable',
    calendar: {
      nextEarningsDate: null, daysRemaining: null, expectedImpact: null,
      historicalReaction: null, guidanceChanges: null, managementCommentary: null, estimateRevisionSignals: null,
      status: 'Future Integration'
    }
  };
}

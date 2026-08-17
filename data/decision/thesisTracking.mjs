import { TIER_ORDER } from '../scoring/ratings.mjs';
import { THESIS_TRACKING, ALERT_THRESHOLDS } from './config.mjs';

// Bullish/bearish regime buckets -- reuses alerts.mjs's own breakout/
// breakdown regime lists (data/decision/alerts.mjs's TRANSITION_ALERT_RULES.
// technicalRegime) so this module doesn't invent a second, possibly
// inconsistent, regime taxonomy.
const BULLISH_REGIMES = ['Volatile Breakout', 'Strong Uptrend'];
const BEARISH_REGIMES = ['Strong Downtrend', 'Downtrend'];

const rank = (rating) => { const i = TIER_ORDER.indexOf(rating); return i === -1 ? null : i; }; // lower rank = better rating

// -1/0/+1 read on the technical picture, blending whichever of regime /
// moving-average position / RSI zone / MACD sign are available on both
// sides of the comparison -- no single field is required, matching the
// null-guarded style changeDetection.mjs already uses for these same
// fields.
function technicalDirection(previous, current) {
  const votes = [];
  if (previous?.technicalRegime != null && current?.technicalRegime != null) {
    if (BULLISH_REGIMES.includes(current.technicalRegime) && !BULLISH_REGIMES.includes(previous.technicalRegime)) votes.push(1);
    else if (BEARISH_REGIMES.includes(current.technicalRegime) && !BEARISH_REGIMES.includes(previous.technicalRegime)) votes.push(-1);
  }
  if (previous?.priceAboveFifty != null && current?.priceAboveFifty != null && previous.priceAboveFifty !== current.priceAboveFifty) {
    votes.push(current.priceAboveFifty ? 1 : -1);
  }
  if (previous?.priceAboveTwoHundred != null && current?.priceAboveTwoHundred != null && previous.priceAboveTwoHundred !== current.priceAboveTwoHundred) {
    votes.push(current.priceAboveTwoHundred ? 1.5 : -1.5); // 200-DMA crossing is a stronger signal than 50-DMA, same weighting alerts.mjs gives it (High vs Medium severity)
  }
  if (Number.isFinite(previous?.macdSign) && Number.isFinite(current?.macdSign) && previous.macdSign !== current.macdSign) {
    votes.push(current.macdSign > 0 ? 1 : -1);
  }
  if (!votes.length) return { direction: 0, note: null };
  const sum = votes.reduce((a, b) => a + b, 0);
  const direction = Math.sign(sum);
  const note = direction > 0 ? 'Technical picture improved (regime/moving-average/MACD signals turned more bullish).'
    : direction < 0 ? 'Technical picture weakened (regime/moving-average/MACD signals turned more bearish).' : null;
  return { direction, note };
}

// Single-source classification of a company's investment thesis, given its
// current and previous run-over-run snapshot-field objects (both already
// computed by changeDetection.mjs's extractSnapshotFields -- see
// data/decision/index.mjs, which passes exactly the objects it already has
// in scope for its own diff -- no new I/O, no new fetch, no recomputation of
// any underlying analytic).
export function thesisStatus(previous, current) {
  if (!previous) return { status: 'Intact', reasons: ['Baseline — no prior snapshot yet to compare the thesis against.'] };

  const reasons = [];
  let score = 0;

  const fromRank = rank(previous.rating), toRank = rank(current.rating);
  let ratingDowngradeTiers = 0;
  if (fromRank != null && toRank != null && fromRank !== toRank) {
    const delta = fromRank - toRank; // positive = improved (moved toward Strong Buy)
    score += Math.sign(delta) * THESIS_TRACKING.weights.ratingRank;
    ratingDowngradeTiers = delta < 0 ? -delta : 0;
    reasons.push(`Recommendation moved from ${previous.rating} to ${current.rating}.`);
  }

  if (Number.isFinite(previous.compositeRiskScore) && Number.isFinite(current.compositeRiskScore) && previous.compositeRiskScore !== current.compositeRiskScore) {
    const delta = previous.compositeRiskScore - current.compositeRiskScore; // positive = risk fell (good)
    score += Math.sign(delta) * THESIS_TRACKING.weights.compositeRisk;
    reasons.push(`Composite risk score moved from ${previous.compositeRiskScore} to ${current.compositeRiskScore}.`);
  }

  const tech = technicalDirection(previous, current);
  if (tech.direction !== 0) {
    score += tech.direction * THESIS_TRACKING.weights.technical;
    reasons.push(tech.note);
  }

  const fromValRank = previous.watchlistRank ?? previous.sectorRank, toValRank = current.watchlistRank ?? current.sectorRank;
  if (Number.isFinite(fromValRank) && Number.isFinite(toValRank) && fromValRank !== toValRank) {
    const delta = fromValRank - toValRank; // positive = rank improved (lower number = better)
    score += Math.sign(delta) * THESIS_TRACKING.weights.relativeValuation;
    reasons.push(`Relative valuation rank moved from ${fromValRank} to ${toValRank}.`);
  }

  const criticalRiskNow = Number.isFinite(current.compositeRiskScore) && current.compositeRiskScore >= ALERT_THRESHOLDS.risk.compositeCriticalThreshold;
  const criticalRiskBefore = Number.isFinite(previous.compositeRiskScore) && previous.compositeRiskScore >= ALERT_THRESHOLDS.risk.compositeCriticalThreshold;

  if (ratingDowngradeTiers >= THESIS_TRACKING.brokenRatingDowngradeTiers) {
    return { status: 'Broken', reasons: [`Recommendation downgraded ${ratingDowngradeTiers} tiers (${previous.rating} → ${current.rating}) — a move this large invalidates the prior thesis rather than merely weakening it.`, ...reasons.filter((_, i) => i > 0)] };
  }
  if (current.rating === 'Sell' && previous.rating !== 'Sell') {
    return { status: 'Broken', reasons: [`Recommendation fell to Sell (from ${previous.rating}).`, ...reasons.filter((_, i) => i > 0)] };
  }
  if (criticalRiskNow && !criticalRiskBefore) {
    return { status: 'Broken', reasons: [`Composite risk score crossed into critical territory (${current.compositeRiskScore}/100).`, ...reasons] };
  }

  if (!reasons.length) return { status: 'Intact', reasons: ['No material change since the last refresh.'] };
  if (score > THESIS_TRACKING.neutralBandScore) return { status: 'Improving', reasons };
  if (score < -THESIS_TRACKING.neutralBandScore) return { status: 'Weakening', reasons };
  return { status: 'Intact', reasons: reasons.length ? reasons : ['Signals since the last refresh were mixed or negligible — no clear directional read.'] };
}

// -- Thesis breakers (foundation upgrade, §14) ------------------------------
// Surfaces the classifier's own hard "Broken" triggers above, plus two more
// generic, already-computed-data-backed conditions, as a structured, named
// list -- additive alongside thesisStatus()'s existing status/reasons, no
// change to the blended-score logic itself. Every condition here is
// reusable across companies and backed by a field this app already
// computes; nothing speculative or company-specific is invented. `stock` is
// the live per-company object (data/watchlist/research.mjs's payload), so
// point-in-time conditions (risk level, promoter trend, ROCE vs. cost of
// capital) don't need a prior snapshot -- only the rating-downgrade trigger
// does, using the same previous/current pair thesisStatus() itself uses.
export function thesisBreakers({ stock, previous, current }) {
  const fromRank = rank(previous?.rating), toRank = rank(current?.rating);
  const downgradeTiers = fromRank != null && toRank != null && toRank > fromRank ? toRank - fromRank : 0;

  const risk = stock.institutionalRisk?.compositeRiskScore;
  const promoterTrend = stock.metrics?.promoterHoldingTrend;
  const roce = stock.roce;
  const costOfCapital = stock.dcf?.wacc?.waccPct ?? stock.financialValuation?.costOfEquityPct ?? null;
  const costOfCapitalLabel = stock.dcf?.wacc ? 'WACC' : 'cost of equity';

  return [
    {
      condition: `Recommendation downgraded ${THESIS_TRACKING.brokenRatingDowngradeTiers}+ tiers`,
      status: downgradeTiers >= THESIS_TRACKING.brokenRatingDowngradeTiers ? 'Active' : downgradeTiers > 0 ? 'Watch' : 'Clear',
      currentReading: previous?.rating && current?.rating ? `${previous.rating} → ${current.rating}` : (current?.rating ? `No prior snapshot (current: ${current.rating})` : 'N/A')
    },
    {
      condition: 'Recommendation falls to Sell',
      status: current?.rating === 'Sell' ? 'Active' : current?.rating ? 'Clear' : 'Unavailable',
      currentReading: current?.rating ?? 'N/A'
    },
    {
      condition: `Composite risk score reaches critical territory (≥${ALERT_THRESHOLDS.risk.compositeCriticalThreshold})`,
      status: Number.isFinite(risk) ? (risk >= ALERT_THRESHOLDS.risk.compositeCriticalThreshold ? 'Active' : risk >= ALERT_THRESHOLDS.risk.compositeCapThreshold ? 'Watch' : 'Clear') : 'Unavailable',
      currentReading: Number.isFinite(risk) ? `${risk}/100` : 'N/A'
    },
    {
      condition: 'Promoter holding declining materially',
      status: Number.isFinite(promoterTrend) ? (promoterTrend <= -2 ? 'Active' : promoterTrend < 0 ? 'Watch' : 'Clear') : 'Unavailable',
      currentReading: Number.isFinite(promoterTrend) ? `${promoterTrend > 0 ? '+' : ''}${promoterTrend.toFixed(2)} pp trend` : 'No shareholding-pattern history available'
    },
    {
      condition: `ROCE falls below the modeled ${costOfCapitalLabel}`,
      status: Number.isFinite(roce) && Number.isFinite(costOfCapital) ? (roce < costOfCapital ? 'Active' : (roce - costOfCapital) < 2 ? 'Watch' : 'Clear') : 'Unavailable',
      currentReading: Number.isFinite(roce) && Number.isFinite(costOfCapital) ? `ROCE ${roce.toFixed(1)}% vs. ${costOfCapitalLabel} ${costOfCapital.toFixed(1)}%` : 'ROCE or cost-of-capital not modeled for this company'
    }
  ];
}

import { number, clamp, average } from '../util.mjs';
import { latest } from './series.mjs';

// Fair Value / Target Price / Conviction have no real named-model data
// source (no analyst consensus feed, no DCF inputs beyond what's already
// scraped) -- this is a disclosed, in-house heuristic, same precedent as
// the risk/ownership scores elsewhere in this codebase, not a claim of
// analyst-verified intrinsic value. It blends two comparable-based
// reversion values against the watchlist's own peer averages (there is no
// external peer-index data source either -- see server-side industryPe).
//
//   Fair Value  = average of whichever of these resolve:
//     - P/E reversion: latest full-year EPS x watchlist-average P/E
//     - P/B reversion: reported book value/share x watchlist-average P/B
//   Target Price = Fair Value grown one year by the stock's own 5Y EPS CAGR
//     (clamped to +/-50% so an outlier CAGR can't produce an absurd target;
//     falls back to Fair Value unchanged when no CAGR is available)
//   Upside %        = (Target Price - CMP) / CMP
//   Margin of Safety % = (Fair Value - CMP) / Fair Value
//   Conviction      = the unified recommendation engine's Confidence rating
//                      (data/scoring/scoringEngine.mjs) -- set by the caller
//                      after that engine resolves, not computed here, so
//                      this heuristic and the Recommendation badge never show
//                      two different confidence reads for the same stock.
// Confidence band for this heuristic (foundation upgrade, §10/§17) -- this
// model previously carried no confidence read at all, unlike dcf.mjs/
// financialValuation.mjs, which both already disclose one. Same >=70 High /
// >=45 Medium / else Low thresholds as those two models, for one consistent
// confidence vocabulary across all three valuation engines. Blends three
// already-known signals, nothing new fetched or estimated:
//   - completeness: how many of the two reversion components resolved
//   - sample size: how many watchlist companies the industryPe/industryPb
//     averages were themselves built from (a 2-company average is a much
//     thinner basis than a 10-company one)
//   - reversion gap: how far this stock's OWN current P/E/P/B already sits
//     from the peer average it's being reverted to. A model that assumes
//     "this stock's multiple converges to the peer average" is a much
//     bigger assumption when today's multiple is already 2x away from that
//     average than when it's close to it -- large-gap cases (e.g. a single
//     capital-goods name averaged against an unrelated IT/FMCG/realty
//     watchlist) are exactly the ones that were previously rendering an
//     unjustified "High" confidence alongside an outsized fair value.
function reversionGapScore(ownValue, peerValue) {
  if (!Number.isFinite(ownValue) || !Number.isFinite(peerValue) || ownValue <= 0 || peerValue <= 0) return null;
  const gapPct = Math.abs(ownValue / peerValue - 1) * 100;
  return clamp(100 - gapPct * 1.3, 0, 100);
}
function confidenceBandFor({ hasPe, hasPb, peSampleSize, pbSampleSize, ownPe, industryPe, ownPb, industryPb }) {
  if (!hasPe && !hasPb) return null;
  const completenessScore = (hasPe ? 50 : 0) + (hasPb ? 50 : 0);
  const relevantSamples = [hasPe ? peSampleSize : null, hasPb ? pbSampleSize : null].filter(Number.isFinite);
  const minSample = relevantSamples.length ? Math.min(...relevantSamples) : 0;
  const sampleScore = minSample >= 6 ? 100 : minSample >= 3 ? 60 : minSample >= 1 ? 30 : 0;
  const gapScores = [hasPe ? reversionGapScore(ownPe, industryPe) : null, hasPb ? reversionGapScore(ownPb, industryPb) : null].filter(Number.isFinite);
  const parts = [completenessScore, sampleScore, gapScores.length ? average(gapScores) : null].filter(Number.isFinite);
  const score = Math.round(average(parts));
  return score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
}

export function fairValueModel({ quote, fundamentals, industryPe, industryPb, epsCagr5, industryPeSampleSize, industryPbSampleSize }) {
  const snapshot = fundamentals?.snapshot || {};
  const pl = fundamentals?.annual?.profitLoss;
  const cmp = Number.isFinite(quote?.regularMarketPrice) ? quote.regularMarketPrice : null;
  const eps = latest(pl, 'epsInRs');
  const bookValue = Number.isFinite(snapshot.bookValue) ? snapshot.bookValue : null;

  const fairValuePe = eps > 0 && industryPe > 0 ? eps * industryPe : null;
  const fairValuePb = bookValue > 0 && industryPb > 0 ? bookValue * industryPb : null;
  const components = [fairValuePe, fairValuePb].filter(Number.isFinite);
  const fairValue = components.length ? number(components.reduce((a, b) => a + b, 0) / components.length) : null;

  const growth = Number.isFinite(epsCagr5) ? clamp(epsCagr5, -50, 50) / 100 : null;
  const targetPrice = fairValue != null ? number(growth != null ? fairValue * (1 + growth) : fairValue) : null;

  const upsidePct = targetPrice != null && cmp > 0 ? number(((targetPrice - cmp) / cmp) * 100) : null;
  const marginOfSafetyPct = fairValue != null && cmp > 0 ? number(((fairValue - cmp) / fairValue) * 100) : null;

  const ownPe = Number.isFinite(snapshot.pe) ? snapshot.pe : null;
  const ownPb = bookValue > 0 && cmp > 0 ? cmp / bookValue : null;
  const confidenceBand = confidenceBandFor({
    hasPe: fairValuePe != null, hasPb: fairValuePb != null, peSampleSize: industryPeSampleSize, pbSampleSize: industryPbSampleSize,
    ownPe, industryPe, ownPb, industryPb
  });

  return {
    fairValue, targetPrice, upsidePct, marginOfSafetyPct, convictionLevel: null, confidenceBand,
    methodology: 'In-house heuristic: P/E and P/B reversion to the watchlist\'s own peer average, projected one year by 5Y EPS CAGR -- not analyst-verified intrinsic value'
  };
}

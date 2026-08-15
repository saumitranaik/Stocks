import { number, clamp } from '../util.mjs';
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
export function fairValueModel({ quote, fundamentals, industryPe, industryPb, epsCagr5 }) {
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

  return { fairValue, targetPrice, upsidePct, marginOfSafetyPct, convictionLevel: null, methodology: 'In-house heuristic: P/E and P/B reversion to the watchlist\'s own peer average, projected one year by 5Y EPS CAGR -- not analyst-verified intrinsic value' };
}

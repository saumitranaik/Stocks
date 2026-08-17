import { MARKET_REGIME } from './config.mjs';

// Rule-based market regime classification -- reads the macro snapshot's own
// direction reads (India VIX level, US 10Y Treasury yield direction, USD/INR
// direction, crude oil direction) plus the Nifty 50 benchmark's own trend
// (reused from data/watchlist/macro.mjs, which reads it off the existing
// benchmark disk cache rather than fetching it again). Same disclosed-
// heuristic, rule-based-classification pattern data/analytics/
// technicalScorecard.mjs's technicalRegime() already uses at the single-
// stock level (system.md §4.3), applied at market level -- never a
// statistical regime-detection model, and confidence never exceeds Medium.
export function classifyMarketRegime({ indiaVix, usTreasury10y, usdInr, crudeOilWti, benchmarkTrend } = {}) {
  const signals = [];
  const notes = [];

  const vixLevel = indiaVix?.value;
  if (Number.isFinite(vixLevel)) {
    if (vixLevel >= MARKET_REGIME.vixRiskOffLevel) { signals.push('risk-off'); notes.push(`India VIX at ${vixLevel.toFixed(1)} (elevated).`); }
    else if (vixLevel <= MARKET_REGIME.vixRiskOnLevel) { signals.push('risk-on'); notes.push(`India VIX at ${vixLevel.toFixed(1)} (subdued).`); }
    else notes.push(`India VIX at ${vixLevel.toFixed(1)} (mid-range).`);
  }
  if (benchmarkTrend === 'Uptrend') { signals.push('risk-on'); notes.push('Nifty 50 in an uptrend (price above its 50-day and 200-day averages).'); }
  else if (benchmarkTrend === 'Downtrend') { signals.push('risk-off'); notes.push('Nifty 50 in a downtrend (price below its 50-day and 200-day averages).'); }

  if (usTreasury10y?.direction === 'Rising') { signals.push('tightening'); notes.push('US 10-Year Treasury yield rising.'); }
  else if (usTreasury10y?.direction === 'Falling') { signals.push('easing'); notes.push('US 10-Year Treasury yield falling.'); }

  if (usdInr?.direction === 'Rising') notes.push('Rupee weakening vs. USD -- a headwind for import-heavy/high-foreign-debt names, a tailwind for exporters (IT/pharma).');
  else if (usdInr?.direction === 'Falling') notes.push('Rupee strengthening vs. USD -- the reverse read.');

  if (crudeOilWti?.direction === 'Rising') notes.push('Crude oil rising -- an import-cost headwind for India and OMCs/paint/tyre input costs.');
  else if (crudeOilWti?.direction === 'Falling') notes.push('Crude oil falling -- the reverse, an import-cost tailwind.');

  if (!signals.length) return { label: 'Insufficient data', confidence: 'Low', notes };

  const count = (label) => signals.filter(s => s === label).length;
  const riskOn = count('risk-on'), riskOff = count('risk-off');
  const tightening = count('tightening'), easing = count('easing');

  let label = riskOff > riskOn ? 'Risk-off' : riskOn > riskOff ? 'Risk-on' : 'Mixed / transitional';
  if (tightening > easing) label += ', tightening bias';
  else if (easing > tightening) label += ', easing bias';

  const resolvedInputs = [Number.isFinite(vixLevel), !!benchmarkTrend, !!usTreasury10y?.direction].filter(Boolean).length;
  const confidence = resolvedInputs >= 3 ? 'Medium' : 'Low';

  return { label, confidence, notes };
}

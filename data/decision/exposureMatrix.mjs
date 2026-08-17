import { interestRateSensitivity, economicCycleSensitivity } from '../analytics/exposureRules.mjs';
import { sectorRiskTags } from '../analytics/institutionalRisk.mjs';
import { currencyExposure } from '../analytics/scenarios.mjs';
import { EXPOSURE_MATRIX } from './config.mjs';

function tierFor(score) {
  if (!Number.isFinite(score)) return 'N/A';
  if (score >= EXPOSURE_MATRIX.highSensitivityThreshold) return 'High';
  if (score >= EXPOSURE_MATRIX.moderateSensitivityThreshold) return 'Moderate';
  return 'Low';
}
const round = (v) => Number.isFinite(v) ? Math.round(v) : null;

// Per-company exposure tags -- pure composition over an already-computed
// per-stock field (sector) plus 4 disclosed static sector-sensitivity lookup
// tables: 2 new (interest-rate, economic-cycle -- data/analytics/
// exposureRules.mjs) and 2 reused as-is (regulatory/commodity from
// institutionalRisk.mjs's sectorRiskTags(), currency from scenarios.mjs's
// currencyExposure()) rather than duplicated. No new fetch; the only "work"
// is a sector-keyword lookup, same shape as data/decision/alerts.mjs reading
// ALERT_THRESHOLDS.
export function companyExposure(stock) {
  const sector = stock.sector;
  const rate = interestRateSensitivity(sector);
  const cycle = economicCycleSensitivity(sector);
  const sectorTags = sectorRiskTags(sector);
  const currency = currencyExposure(sector);

  return {
    symbol: stock.symbol,
    interestRate: { score: rate?.sensitivity ?? null, tier: tierFor(rate?.sensitivity), matched: rate?.matched ?? false },
    currency: {
      exposure: currency.exposure,
      direction: currency.exposure > 0 ? 'Benefits from rupee depreciation' : currency.exposure < 0 ? 'Hurt by rupee depreciation' : 'Neutral / predominantly domestic-facing',
      matched: currency.matched
    },
    commodity: { score: sectorTags?.commodity ?? null, tier: tierFor(sectorTags?.commodity), matched: sectorTags?.matched ?? false },
    regulatory: { score: sectorTags?.regulatory ?? null, tier: tierFor(sectorTags?.regulatory), matched: sectorTags?.matched ?? false },
    economicCycle: { score: cycle?.sensitivity ?? null, label: cycle?.label ?? 'N/A', matched: cycle?.matched ?? false }
  };
}

function weightedAvg(pairs) {
  const resolved = pairs.filter(([v, w]) => Number.isFinite(v) && Number.isFinite(w) && w > 0);
  if (!resolved.length) return null;
  const totalWeight = resolved.reduce((sum, [, w]) => sum + w, 0);
  return totalWeight > 0 ? resolved.reduce((sum, [v, w]) => sum + v * w, 0) / totalWeight : null;
}

// Portfolio-level rollup: weighted average of the per-company tags above,
// using each stock's already-resolved effectiveWeightPct (portfolio.mjs's
// resolveWeights -- the same illustrative weight vector every other
// portfolio aggregate in this app already uses). No new weight model.
export function portfolioExposureMatrix(stocks) {
  const resolved = stocks.filter(s => !s.unresolved && s.sector);
  const companies = resolved.map(companyExposure);
  const weightOf = new Map(stocks.map(s => [s.symbol, s.effectiveWeightPct]));

  const portfolioInterestRate = weightedAvg(companies.map(c => [c.interestRate.score, weightOf.get(c.symbol)]));
  const portfolioCommodity = weightedAvg(companies.map(c => [c.commodity.score, weightOf.get(c.symbol)]));
  const portfolioRegulatory = weightedAvg(companies.map(c => [c.regulatory.score, weightOf.get(c.symbol)]));
  const portfolioEconomicCycle = weightedAvg(companies.map(c => [c.economicCycle.score, weightOf.get(c.symbol)]));
  const portfolioCurrency = weightedAvg(companies.map(c => [c.currency.exposure, weightOf.get(c.symbol)]));

  return {
    companies,
    portfolio: {
      interestRate: { score: round(portfolioInterestRate), tier: tierFor(portfolioInterestRate) },
      commodity: { score: round(portfolioCommodity), tier: tierFor(portfolioCommodity) },
      regulatory: { score: round(portfolioRegulatory), tier: tierFor(portfolioRegulatory) },
      economicCycle: { score: round(portfolioEconomicCycle), tier: tierFor(portfolioEconomicCycle) },
      currency: {
        exposure: portfolioCurrency == null ? null : Math.round(portfolioCurrency * 100) / 100,
        direction: portfolioCurrency > 0.15 ? 'Net benefits from rupee depreciation' : portfolioCurrency < -0.15 ? 'Net hurt by rupee depreciation' : 'Roughly currency-neutral'
      }
    }
  };
}

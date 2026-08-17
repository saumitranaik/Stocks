// Two new static, disclosed keyword-matched sector -> sensitivity lookup
// tables (same style/location as institutionalRisk.mjs's SECTOR_RISK_RULES).
// Interest-rate and economic-cycle sensitivity have no existing table in
// this app; regulatory/commodity sensitivity reuse institutionalRisk.mjs's
// sectorRiskTags() directly and currency sensitivity reuses scenarios.mjs's
// currencyExposure() -- see data/decision/exposureMatrix.mjs, which is the
// only consumer of all four. Analyst-style judgment calls this project
// maintains, not derived from a live regulatory/rates data source (same
// disclosure as every other table of this shape).

const INTEREST_RATE_SENSITIVITY_RULES = [
  { pattern: /bank|financ|nbfc|insur/i, sensitivity: 85 },
  { pattern: /real estate|realty|construction|infra/i, sensitivity: 80 },
  { pattern: /auto/i, sensitivity: 65 },
  { pattern: /power|utilit/i, sensitivity: 60 },
  { pattern: /metal|mining|steel|cement/i, sensitivity: 55 },
  { pattern: /telecom/i, sensitivity: 50 },
  { pattern: /oil|gas|petro/i, sensitivity: 45 },
  { pattern: /\bit\b|tech|software|internet/i, sensitivity: 35 },
  { pattern: /defence|defense|aerospace/i, sensitivity: 30 },
  { pattern: /pharma|health/i, sensitivity: 30 },
  { pattern: /sugar|agri|fmcg|food/i, sensitivity: 25 }
];
const DEFAULT_INTEREST_RATE_SENSITIVITY = 45;
export function interestRateSensitivity(sector) {
  if (!sector) return null;
  const rule = INTEREST_RATE_SENSITIVITY_RULES.find(r => r.pattern.test(sector));
  return { sensitivity: rule ? rule.sensitivity : DEFAULT_INTEREST_RATE_SENSITIVITY, matched: !!rule };
}

const ECONOMIC_CYCLE_RULES = [
  { pattern: /bank|financ|nbfc|insur|auto|metal|mining|steel|cement|real estate|realty|construction|infra/i, sensitivity: 80, label: 'Cyclical' },
  { pattern: /oil|gas|petro|telecom|power|utilit/i, sensitivity: 55, label: 'Semi-cyclical' },
  { pattern: /\bit\b|tech|software|internet/i, sensitivity: 50, label: 'Semi-cyclical' },
  { pattern: /defence|defense|aerospace/i, sensitivity: 30, label: 'Defensive' },
  { pattern: /sugar|agri|fmcg|food|pharma|health/i, sensitivity: 25, label: 'Defensive' }
];
const DEFAULT_ECONOMIC_CYCLE = { sensitivity: 50, label: 'Unclassified' };
export function economicCycleSensitivity(sector) {
  if (!sector) return null;
  const rule = ECONOMIC_CYCLE_RULES.find(r => r.pattern.test(sector));
  return rule ? { sensitivity: rule.sensitivity, label: rule.label, matched: true } : { ...DEFAULT_ECONOMIC_CYCLE, matched: false };
}

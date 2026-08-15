// Working-capital efficiency is a pure passthrough of Screener's own
// `ratios` section — it's already a real time series (Debtor/Inventory/
// Payable Days, Cash Conversion Cycle, Working Capital Days), no computation
// needed or attempted here.
import { latest } from './series.mjs';

export function workingCapitalEfficiency(ratios) {
  if (!ratios) return null;
  return {
    debtorDays: latest(ratios, 'debtorDays'),
    inventoryDays: latest(ratios, 'inventoryDays'),
    payableDays: latest(ratios, 'payableDays'),
    cashConversionCycle: latest(ratios, 'cashConversionCycle'),
    workingCapitalDays: latest(ratios, 'workingCapitalDays')
  };
}

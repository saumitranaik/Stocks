import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PERIODIC_MACRO_INDICATORS, UNAVAILABLE_MACRO_INDICATORS, CURRENCY_INDICATORS, goldInrPer10g, usdToInr, crossRateInr } from '../data/providers/macroProvider.mjs';
import { toPeriodicIndicator } from '../data/watchlist/macro.mjs';

// This app's automated test layer (TD-4/02.11) is scoped to pure-math
// analytics modules; data/providers/ and data/watchlist/ are outside that
// formal scope. These cases cover the two genuinely pure pieces this
// 2026-09-09 re-verification task added (a static config array and a
// zero-I/O mapping function over it) as a voluntary addition, matching the
// precedent already set by mospiIntegration.test.mjs for a non-pure-math
// module — everything else (the live HTTP fetches in loadIndicator/
// buildMacroSnapshot) stays validated the manual way per docs/governance/
// roadmap.md §1's stated bar for I/O-touching code.

describe('macroProvider.PERIODIC_MACRO_INDICATORS', () => {
  it('carries exactly the two indicators promoted out of Future Integration this task (defence budget, ethanol blending)', () => {
    const keys = PERIODIC_MACRO_INDICATORS.map(i => i.key).sort();
    assert.deepEqual(keys, ['defenceBudget', 'ethanolBlending']);
  });

  it('every entry has a real numeric value, a unit, a period, a dated source and a source URL — never a placeholder', () => {
    for (const def of PERIODIC_MACRO_INDICATORS) {
      assert.ok(Number.isFinite(def.value), `${def.key} value must be a real number`);
      assert.ok(def.unit, `${def.key} must declare a unit`);
      assert.ok(def.period, `${def.key} must declare a reporting period`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(def.asOfDate), `${def.key} asOfDate must be an ISO date`);
      assert.ok(def.source && def.source.length > 20, `${def.key} must carry a real citation, not a stub`);
      assert.ok(/^https:\/\//.test(def.sourceUrl), `${def.key} must link to its official source`);
    }
  });

  it('matches the fresh 2026-09-09 evidence exactly (not a placeholder/guessed figure)', () => {
    const defence = PERIODIC_MACRO_INDICATORS.find(i => i.key === 'defenceBudget');
    assert.equal(defence.value, 784678);
    assert.equal(defence.period, 'FY 2026-27 (Budget Estimates)');
    const ethanol = PERIODIC_MACRO_INDICATORS.find(i => i.key === 'ethanolBlending');
    assert.equal(ethanol.value, 20);
    assert.equal(ethanol.period, 'ESY 2025-26');
  });
});

describe('macroProvider.UNAVAILABLE_MACRO_INDICATORS', () => {
  it('no longer lists ethanolPolicy or defenceBudget (promoted to Periodic 2026-09-09)', () => {
    const keys = UNAVAILABLE_MACRO_INDICATORS.map(i => i.key);
    assert.ok(!keys.includes('ethanolPolicy'));
    assert.ok(!keys.includes('defenceBudget'));
  });

  it('no longer lists powerDemand (promoted to a live NPP-sourced indicator 2026-09-24)', () => {
    const keys = UNAVAILABLE_MACRO_INDICATORS.map(i => i.key);
    assert.ok(!keys.includes('powerDemand'));
  });

  it('lists the 8 indicators re-verified as genuinely unavailable in the 2026-09-24 audit, PMI and crude oil/natural gas split into their distinct instruments', () => {
    const keys = UNAVAILABLE_MACRO_INDICATORS.map(i => i.key).sort();
    assert.deepEqual(keys, [
      'bankingLiquidity', 'crudeOilIndianBasket', 'crudeOilMcx', 'indiaGsec10y',
      'naturalGasMcx', 'pmiManufacturing', 'pmiServices', 'rbiRepoRate'
    ]);
  });

  it('every entry carries a real, non-generic Source (the actual authoritative provider), a source URL, a specific status and a statusNote explaining the access limitation', () => {
    for (const def of UNAVAILABLE_MACRO_INDICATORS) {
      assert.ok(def.sourceLabel && def.sourceLabel.length > 1, `${def.key} must carry a short sourceLabel`);
      assert.ok(!/^(government|market data|external source)$/i.test(def.sourceLabel), `${def.key} sourceLabel must not be generic`);
      assert.ok(def.source && def.source.length > 20, `${def.key} must carry a real citation, not a stub`);
      assert.ok(/^https:\/\//.test(def.sourceUrl), `${def.key} must link to its official source`);
      assert.ok(['Not Programmatically Available', 'Licensing Required'].includes(def.status), `${def.key} must carry a specific, non-generic status`);
      assert.ok(def.statusNote && def.statusNote.length > 10, `${def.key} must explain its access limitation`);
    }
  });

  it('never conflates distinct instruments (Indian Basket vs MCX crude, MCX gas vs Henry Hub)', () => {
    const basket = UNAVAILABLE_MACRO_INDICATORS.find(i => i.key === 'crudeOilIndianBasket');
    const mcxCrude = UNAVAILABLE_MACRO_INDICATORS.find(i => i.key === 'crudeOilMcx');
    const mcxGas = UNAVAILABLE_MACRO_INDICATORS.find(i => i.key === 'naturalGasMcx');
    assert.equal(basket.sourceLabel, 'PPAC');
    assert.equal(mcxCrude.sourceLabel, 'MCX');
    assert.equal(mcxGas.sourceLabel, 'MCX');
    assert.notEqual(basket.label, mcxCrude.label);
  });
});

describe('macroProvider.goldInrPer10g', () => {
  it('applies the exact troy-ounce-to-gram formula, no intermediate rounding', () => {
    const result = goldInrPer10g(2000, 83);
    assert.equal(result, 2000 * 83 * (10 / 31.1034768));
    assert.ok(Math.abs(result - 53370.24) < 0.01);
  });

  it('returns null (never a fabricated number) when either input is non-finite', () => {
    assert.equal(goldInrPer10g(null, 83), null);
    assert.equal(goldInrPer10g(2000, undefined), null);
    assert.equal(goldInrPer10g(NaN, 83), null);
    assert.equal(goldInrPer10g(2000, NaN), null);
  });

  it('never divides by zero or throws for a zero input', () => {
    assert.equal(goldInrPer10g(0, 83), 0);
    assert.equal(goldInrPer10g(2000, 0), 0);
  });
});

describe('macroProvider.usdToInr', () => {
  it('is a plain multiplication, no unit-of-measure conversion (unlike goldInrPer10g)', () => {
    assert.equal(usdToInr(80, 88), 80 * 88);
    assert.equal(usdToInr(3.5, 88), 3.5 * 88);
  });

  it('returns null (never a fabricated number) when either input is non-finite', () => {
    assert.equal(usdToInr(null, 88), null);
    assert.equal(usdToInr(80, undefined), null);
    assert.equal(usdToInr(NaN, 88), null);
  });

  it('never throws for a zero input', () => {
    assert.equal(usdToInr(0, 88), 0);
    assert.equal(usdToInr(80, 0), 0);
  });
});

describe('macroProvider.crossRateInr', () => {
  it('derives 1 unit of the cross currency in INR from two USD legs', () => {
    // 1 USD = 88 INR, 1 USD = 84 RUB -> 1 RUB = 88/84 INR
    const result = crossRateInr(88, 84);
    assert.equal(result, 88 / 84);
  });

  it('returns null (never a fabricated number) when either input is non-finite or the divisor is zero', () => {
    assert.equal(crossRateInr(null, 84), null);
    assert.equal(crossRateInr(88, undefined), null);
    assert.equal(crossRateInr(88, NaN), null);
    assert.equal(crossRateInr(88, 0), null);
  });
});

describe('macroProvider.CURRENCY_INDICATORS', () => {
  it('carries exactly the 11 direct-quote currencies (USD/RUB are handled separately)', () => {
    const codes = CURRENCY_INDICATORS.map(i => i.code).sort();
    assert.deepEqual(codes, ['AED', 'AUD', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'SGD', 'THB', 'VND'].sort());
  });

  it('every entry declares a real Yahoo <CCY>INR=X-style ticker and a code', () => {
    for (const def of CURRENCY_INDICATORS) {
      assert.ok(/INR=X$/.test(def.ticker), `${def.key} ticker must be a direct INR quote`);
      assert.ok(def.code, `${def.key} must declare a currency code`);
    }
  });

  it('VND is the one entry with a display scale (its raw INR rate is too small to round to 2dp)', () => {
    const vnd = CURRENCY_INDICATORS.find(i => i.code === 'VND');
    assert.equal(vnd.displayScale, 1000);
    assert.ok(CURRENCY_INDICATORS.filter(i => i.displayScale).length === 1);
  });
});

describe('macro.toPeriodicIndicator', () => {
  it('carries every def field through plus a fixed "Periodic" status, never a computed changePct/trend/DMA', () => {
    const def = PERIODIC_MACRO_INDICATORS.find(i => i.key === 'defenceBudget');
    const result = toPeriodicIndicator(def);
    assert.equal(result.status, 'Periodic');
    assert.equal(result.value, def.value);
    assert.equal(result.period, def.period);
    assert.equal(result.asOfDate, def.asOfDate);
    assert.equal(result.sourceUrl, def.sourceUrl);
    assert.equal('changePct' in result, false);
    assert.equal('trend' in result, false);
    assert.equal('dma20' in result, false);
  });
});

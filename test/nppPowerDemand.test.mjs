import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickLatestDemandMet, istDateString } from '../data/providers/nppProvider.mjs';

// This app's automated node:test layer (TD-4/02.11) is scoped to pure-math
// analytics modules; the live HTTP fetch in nppProvider.mjs's
// getPowerDemandSnapshot()/fetchLatestDemandMet() is outside that formal
// scope and stays validated manually (a real `GET /api/macro` against a
// scratch server, per docs/governance/roadmap.md §1) -- same precedent
// macroPeriodicIndicators.test.mjs and mospiIntegration.test.mjs already
// set. These cases cover the two genuinely pure pieces this 2026-09-24
// task added: pickLatestDemandMet() (parsing NPP's raw JSON array, shaped
// exactly like mospiProvider.mjs's findCpiRecord()/findIipRecord()) and
// istDateString() (a pure date-formatting helper).

describe('nppProvider.pickLatestDemandMet', () => {
  it('picks the row with the highest updated_on, not the last array element', () => {
    const data = [
      { updated_on: 1000, name_of_data: 'DEMAND MET', value_of_data: 100 },
      { updated_on: 3000, name_of_data: 'DEMAND MET', value_of_data: 300 },
      { updated_on: 2000, name_of_data: 'DEMAND MET', value_of_data: 200 }
    ];
    const result = pickLatestDemandMet(data);
    assert.equal(result.value, 300);
    assert.equal(result.observedAt, new Date(3000).toISOString());
  });

  it('returns null (never a fabricated reading) for an empty or non-array response', () => {
    assert.equal(pickLatestDemandMet([]), null);
    assert.equal(pickLatestDemandMet(null), null);
    assert.equal(pickLatestDemandMet(undefined), null);
    assert.equal(pickLatestDemandMet('not an array'), null);
  });

  it('skips rows with a non-finite value or timestamp instead of letting a malformed entry win', () => {
    const data = [
      { updated_on: 1000, name_of_data: 'DEMAND MET', value_of_data: 100 },
      { updated_on: 9000, name_of_data: 'DEMAND MET', value_of_data: null },
      { updated_on: null, name_of_data: 'DEMAND MET', value_of_data: 999 }
    ];
    const result = pickLatestDemandMet(data);
    assert.equal(result.value, 100);
  });

  it('returns null when every row is malformed', () => {
    const data = [
      { updated_on: null, value_of_data: 100 },
      { updated_on: 1000, value_of_data: 'not a number' }
    ];
    assert.equal(pickLatestDemandMet(data), null);
  });
});

describe('nppProvider.istDateString', () => {
  it('formats a UTC instant as its India-local (Asia/Kolkata, UTC+5:30) calendar date', () => {
    // 2026-01-15T20:00:00Z is 2026-01-16T01:30 IST -- crosses the date line.
    assert.equal(istDateString(new Date('2026-01-15T20:00:00Z')), '2026-01-16');
    // 2026-01-15T10:00:00Z is 2026-01-15T15:30 IST -- same calendar day.
    assert.equal(istDateString(new Date('2026-01-15T10:00:00Z')), '2026-01-15');
  });

  it('always returns a zero-padded YYYY-MM-DD string', () => {
    assert.match(istDateString(new Date('2026-03-05T00:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
  });
});

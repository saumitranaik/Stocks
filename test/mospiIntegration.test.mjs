import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMospiSeries, isAlreadyExistsError, findCpiRecord } from '../data/integrations/mospiProvider.mjs';
import { maskToken, isTokenExpired } from '../data/integrations/credentialStore.mjs';

// This app's automated test layer (TD-4/02.11) is scoped to pure-math
// analytics modules; data/integrations/ is a provider/I-O module outside
// that formal scope. These cases cover its two genuinely pure exports
// (parseMospiSeries has zero I/O; maskToken/isTokenExpired are simple pure
// helpers) as a voluntary addition, not a scope change to TD-4 — everything
// else in data/integrations/ (the actual HTTP calls, the credential file
// read/write) is validated the manual way (node --check + a live check),
// per docs/governance/roadmap.md §1's own stated bar for I/O-touching code.

describe('mospiProvider.parseMospiSeries', () => {
  it('returns null for an empty/unrecognized payload rather than fabricating a value', () => {
    assert.equal(parseMospiSeries(null), null);
    assert.equal(parseMospiSeries({}), null);
    assert.equal(parseMospiSeries({ message: 'No Data Found' }), null);
    assert.equal(parseMospiSeries([]), null);
  });

  it('extracts the latest record by Year/Month from a plausible array-of-records shape', () => {
    const payload = [
      { Year: 2025, Month: 3, Index: 190.2, Inflation: 4.1 },
      { Year: 2025, Month: 6, Index: 192.7, Inflation: 3.8 },
      { Year: 2024, Month: 12, Index: 188.0, Inflation: 5.0 }
    ];
    const result = parseMospiSeries(payload);
    assert.ok(result);
    assert.equal(result.value, 192.7);
    assert.equal(result.period.year, 2025);
    assert.equal(result.period.month, 6);
  });

  it('also accepts a {data: [...]} / {records: [...]} wrapper shape', () => {
    assert.equal(parseMospiSeries({ data: [{ Year: 2025, Month: 1, Index: 100 }] }).value, 100);
    assert.equal(parseMospiSeries({ records: [{ Year: 2025, Month: 1, Index: 101 }] }).value, 101);
  });

  it('returns null when no numeric value field can be found, never guessing a wrong field', () => {
    const payload = [{ Year: 2025, Month: 1, Notes: 'provisional' }];
    assert.equal(parseMospiSeries(payload), null);
  });

  it('falls back to the last record when no record carries a parseable Year', () => {
    const payload = [{ Index: 1 }, { Index: 2 }];
    const result = parseMospiSeries(payload);
    assert.equal(result.value, 2);
  });
});

describe('credentialStore.maskToken', () => {
  it('never returns the full token', () => {
    const masked = maskToken('abcdefghijklmnop');
    assert.equal(masked, 'abcd••••mnop');
    assert.ok(!masked.includes('efghijkl'));
  });
  it('handles missing/short tokens without throwing', () => {
    assert.equal(maskToken(null), null);
    assert.equal(maskToken('short'), '••••••••');
  });
});

describe('mospiProvider.isAlreadyExistsError', () => {
  it('treats a 409 status as an existing-account signal regardless of message', () => {
    assert.equal(isAlreadyExistsError({ status: 409, message: 'anything' }), true);
  });
  it('recognizes common "already exists/registered" phrasing in the error message', () => {
    assert.equal(isAlreadyExistsError({ message: 'User already exists' }), true);
    assert.equal(isAlreadyExistsError({ message: 'Email already registered' }), true);
    assert.equal(isAlreadyExistsError({ message: 'Duplicate entry for users table' }), true);
    assert.equal(isAlreadyExistsError({ message: 'account exists for this email' }), true);
  });
  it('does not flag an unrelated failure as an existing-account signal', () => {
    assert.equal(isAlreadyExistsError({ status: 400, message: 'Invalid organization name' }), false);
    assert.equal(isAlreadyExistsError({ status: 500, message: 'Internal server error' }), false);
    assert.equal(isAlreadyExistsError({}), false);
  });
});

describe('mospiProvider.findCpiRecord', () => {
  // Fixture below is the real, live-captured shape of an unauthenticated
  // GET https://api.mospi.gov.in/api/cpi/getCPIIndex response (2026-09-08
  // CPI-without-credentials task's own verification pass) -- not invented.
  const liveShapedPayload = {
    data: [
      { baseyear: '2012', year: 2025, month: 'December', state: 'All India', sector: 'Rural', group: 'Consumer Food Price', subgroup: 'Consumer Food Price-Overall', index: '198.5', inflation: '-3.03', status: 'F' },
      { baseyear: '2012', year: 2025, month: 'December', state: 'All India', sector: 'Rural', group: 'Miscellaneous', subgroup: 'Transport and Communication', index: '178.5', inflation: '1.02', status: 'F' },
      { baseyear: '2012', year: 2025, month: 'December', state: 'All India', sector: 'Rural', group: 'Fuel and Light', subgroup: 'Fuel and Light-Overall', index: '185.1', inflation: '1.54', status: 'F' },
      { baseyear: '2012', year: 2025, month: 'December', state: 'All India', sector: 'Rural', group: 'Housing', subgroup: 'Housing-Overall', index: null, inflation: null, status: 'F' }
    ],
    meta_data: { page: 1, totalRecords: 413436, totalPages: 41344, recordPerPage: 10 },
    msg: 'Data fetched successfully', statusCode: true
  };

  it('finds the Consumer Food Price-Overall record and reads MoSPI\'s own inflation field directly, without recomputing it', () => {
    const result = findCpiRecord(liveShapedPayload);
    assert.ok(result);
    assert.equal(result.index, 198.5);
    assert.equal(result.inflationYoY, -3.03);
    assert.equal(result.period.year, 2025);
    assert.equal(result.period.month, 'December');
    assert.equal(result.sector, 'Rural');
    assert.equal(result.seriesLabel, 'Consumer Food Price — Consumer Food Price-Overall');
    assert.equal(result.revisionStatus, 'F');
  });

  it('matches case-insensitively and by substring (MoSPI field casing is not guaranteed stable)', () => {
    const payload = { data: [{ year: 2025, month: 'January', sector: 'Combined', group: 'CONSUMER FOOD PRICE', subgroup: 'consumer food price - overall', index: '200', inflation: '4' }] };
    const result = findCpiRecord(payload);
    assert.ok(result);
    assert.equal(result.index, 200);
    assert.equal(result.inflationYoY, 4);
  });

  it('returns null (never a guess) when no Consumer Food Price / Overall series is present in the response', () => {
    const payload = { data: [{ year: 2025, month: 'January', group: 'Miscellaneous', subgroup: 'Health', index: '207', inflation: '3.4' }] };
    assert.equal(findCpiRecord(payload), null);
  });

  it('handles a genuine "No Data Found" / empty-data response without throwing', () => {
    assert.equal(findCpiRecord({ data: [], msg: 'No Data Found' }), null);
    assert.equal(findCpiRecord({ msg: 'No Data Found' }), null);
    assert.equal(findCpiRecord(null), null);
    assert.equal(findCpiRecord(undefined), null);
    assert.equal(findCpiRecord({}), null);
  });

  it('returns null when the matched record has neither a numeric index nor a numeric inflation value (e.g. Housing-Overall\'s null index in the live fixture, matched defensively)', () => {
    const payload = { data: [{ year: 2025, month: 'December', group: 'Consumer Food Price', subgroup: 'Consumer Food Price-Overall', index: null, inflation: null }] };
    assert.equal(findCpiRecord(payload), null);
  });

  it('accepts a record with only one of index/inflation resolving (never requires both)', () => {
    const payload = { data: [{ year: 2025, month: 'December', group: 'Consumer Food Price', subgroup: 'Consumer Food Price-Overall', index: '198.5', inflation: null }] };
    const result = findCpiRecord(payload);
    assert.equal(result.index, 198.5);
    assert.equal(result.inflationYoY, null);
  });
});

describe('credentialStore.isTokenExpired', () => {
  it('treats a credential with no token as expired', () => {
    assert.equal(isTokenExpired({ accessToken: null, expiresAt: null }), true);
  });
  it('is false before expiresAt and true after', () => {
    const credential = { accessToken: 'tok', expiresAt: new Date(Date.now() + 60000).toISOString() };
    assert.equal(isTokenExpired(credential, Date.now()), false);
    assert.equal(isTokenExpired(credential, Date.now() + 120000), true);
  });
});

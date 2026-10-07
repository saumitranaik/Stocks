import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMospiSeries, isAlreadyExistsError, findCpiRecord, findIipRecord } from '../data/integrations/mospiProvider.mjs';
import { maskToken, isTokenExpired } from '../data/integrations/credentialStore.mjs';
import { describeNetworkError, resolvePublicAgent } from '../data/integrations/mospiClient.mjs';

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

describe('mospiProvider.findIipRecord', () => {
  // Fixture below is the real, live-captured shape of an unauthenticated
  // GET https://api.mospi.gov.in/api/iip/getIIPMonthly response (2026-09-09
  // independent IIP investigation's own verification pass, curl against the
  // real MoSPI endpoint) -- not invented. Note the General/General record is
  // already first in MoSPI's own anonymous slice, unlike CPI's Consumer Food
  // Price record which sits deeper in its own fixed slice.
  const liveShapedPayload = {
    data: [
      { base_year: '2022-23', year: 2026, month: 'July', type: 'General', category: 'General', sub_category: '', index: '124.8', growth_rate: '6.7' },
      { base_year: '2022-23', year: 2026, month: 'July', type: 'Sectoral', category: 'Mining & Quarrying', sub_category: 'Fuel Minerals', index: '94.5', growth_rate: '-1.3' },
      { base_year: '2022-23', year: 2026, month: 'July', type: 'Sectoral', category: 'Manufacturing', sub_category: 'Manufacture of Food Products', index: '106.0', growth_rate: '2.6' }
    ],
    meta_data: { page: 1, totalRecords: 17110, totalPages: 1711, recordPerPage: 10 },
    msg: 'Data fetched successfully', statusCode: true
  };

  it('finds the General/General IIP record and reads MoSPI\'s own growth_rate field directly, without recomputing it', () => {
    const result = findIipRecord(liveShapedPayload);
    assert.ok(result);
    assert.equal(result.index, 124.8);
    assert.equal(result.growthYoY, 6.7);
    assert.equal(result.period.year, 2026);
    assert.equal(result.period.month, 'July');
    assert.equal(result.baseYear, '2022-23');
    assert.equal(result.seriesLabel, 'General — General');
  });

  it('never picks a Sectoral/sub-series record when a General/General record is present (no silent substitution)', () => {
    const result = findIipRecord(liveShapedPayload);
    assert.notEqual(result.seriesLabel, 'Sectoral — Mining & Quarrying — Fuel Minerals');
  });

  it('matches case-insensitively (MoSPI field casing is not guaranteed stable)', () => {
    const payload = { data: [{ year: 2025, month: 'January', type: 'GENERAL', category: 'general', index: '110', growth_rate: '3' }] };
    const result = findIipRecord(payload);
    assert.ok(result);
    assert.equal(result.index, 110);
    assert.equal(result.growthYoY, 3);
  });

  it('returns null (never a guess) when no General/General series is present in the response', () => {
    const payload = { data: [{ year: 2025, month: 'January', type: 'Sectoral', category: 'Mining & Quarrying', index: '90', growth_rate: '-2' }] };
    assert.equal(findIipRecord(payload), null);
  });

  it('handles a genuine "No Data Found" / empty-data response without throwing', () => {
    assert.equal(findIipRecord({ data: [], msg: 'No Data Found' }), null);
    assert.equal(findIipRecord({ msg: 'No Data Found' }), null);
    assert.equal(findIipRecord(null), null);
    assert.equal(findIipRecord(undefined), null);
    assert.equal(findIipRecord({}), null);
  });

  it('returns null when the matched record has neither a numeric index nor a numeric growth_rate value', () => {
    const payload = { data: [{ year: 2025, month: 'January', type: 'General', category: 'General', index: null, growth_rate: null }] };
    assert.equal(findIipRecord(payload), null);
  });

  it('accepts a record with only one of index/growth_rate resolving (never requires both)', () => {
    const payload = { data: [{ year: 2025, month: 'January', type: 'General', category: 'General', index: '124.8', growth_rate: null }] };
    const result = findIipRecord(payload);
    assert.equal(result.index, 124.8);
    assert.equal(result.growthYoY, null);
  });
});

describe('mospiClient.describeNetworkError', () => {
  // 2026-09-24 diagnosis: signup/login use plain `fetch` (no TLS workaround,
  // unlike fetchCpiPublic()/fetchIipPublic()) and Node collapses the real
  // reason into `TypeError: fetch failed` -- this turns that back into an
  // actionable message per cause, without ever weakening TLS on this path.
  it('names MoSPI\'s live-confirmed legacy-TLS-renegotiation defect specifically', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED' };
    const message = describeNetworkError(err);
    assert.match(message, /legacy TLS renegotiation/);
    assert.match(message, /MoSPI/);
    assert.doesNotMatch(message, /fetch failed/);
  });
  it('distinguishes DNS failure from a generic connection failure', () => {
    assert.match(describeNetworkError({ cause: { code: 'ENOTFOUND' } }), /DNS lookup failed/);
    assert.match(describeNetworkError({ cause: { code: 'ECONNREFUSED' } }), /connection failed/);
  });
  it('falls back to the underlying cause message for an unrecognized code', () => {
    const err = new TypeError('fetch failed');
    err.cause = { message: 'something unusual' };
    assert.match(describeNetworkError(err), /something unusual/);
  });
});

describe('mospiClient.resolvePublicAgent (MOSPI_TLS_MODE, 2026-09-24 configurable-TLS task)', () => {
  it('returns undefined (Node\'s own default, fully-secure agent) for standard mode -- never a weakened agent', () => {
    assert.equal(resolvePublicAgent('standard'), undefined);
  });
  it('returns the same legacy-renegotiation agent instance every call in legacy-renegotiation mode', () => {
    const first = resolvePublicAgent('legacy-renegotiation');
    const second = resolvePublicAgent('legacy-renegotiation');
    assert.ok(first);
    assert.equal(first, second);
  });
  it('treats an unrecognized mode as standard rather than silently weakening TLS', () => {
    assert.equal(resolvePublicAgent('bogus'), undefined);
    assert.equal(resolvePublicAgent(undefined), undefined);
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

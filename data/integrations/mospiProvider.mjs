import { MOSPI } from './config.mjs';
import { readCredential, saveToken, markVerified, recordError, clearCredential, isTokenExpired, maskToken } from './credentialStore.mjs';
import { signup, login, fetchIipMonthly, fetchCpiPublic, MospiAuthError, MospiUpstreamError } from './mospiClient.mjs';
import { mospiCache } from '../watchlist/diskCache.mjs';

// Orchestrates the MoSPI integration for both consumers: the Configuration
// page (integration-level status, config.mjs's 7-state model) and the India
// Macro panel (per-dataset CPI/IIP status, data/watchlist/macro.mjs). Owns
// the data-fetch cache; credentialStore.mjs owns the credential itself.
//
// Two datasets, two genuinely different access models (2026-09-08 CPI-
// without-credentials task) -- kept as separate lists rather than one
// DATASETS array with a per-row flag, so a future reader can't miss that
// PUBLIC_DATASETS never touches readCredential()/the token lifecycle at all:
//   - PUBLIC_DATASETS (CPI): unauthenticated, see getCpiPublicSnapshot()
//     below -- works with zero MoSPI credentials configured.
//   - CREDENTIALED_DATASETS (IIP): unchanged from the original integration,
//     gated on a valid access token via getDatasetSnapshot() below.
export const PUBLIC_DATASETS = [
  { key: 'cpiInflation', label: 'CPI Inflation (Consumer Food Price Index)' }
];
export const CREDENTIALED_DATASETS = [
  { key: 'iip', label: 'Index of Industrial Production (IIP)', fetch: fetchIip }
];
// Kept for any caller that still wants "every MoSPI dataset" in one list
// (none in this app after this change, besides getIntegrationStatus() below,
// which needs both) -- not used to gate access, since PUBLIC_DATASETS
// entries have no `fetch(token)` signature.
export const DATASETS = [...PUBLIC_DATASETS, ...CREDENTIALED_DATASETS];

// The MoSPI manuals document request parameters exhaustively but never show
// the response body's actual field names as text (only screenshots this
// audit could not read) -- so this parser is intentionally shape-detecting
// rather than hardcoded to guessed field names. It looks for a records array
// under a few plausible top-level shapes, then a numeric value under a few
// plausible field-name candidates (case-insensitive). If nothing matches, it
// returns null (Provider Unavailable / "response shape not recognized")
// rather than pick a wrong field and display it as a real value -- per
// CLAUDE.md's "never guess a sourced field". This must be confirmed against
// a real authenticated response before this integration can be trusted
// end-to-end; see the completion report's Real integration validation note.
const VALUE_FIELD_CANDIDATES = ['index', 'value', 'inflation', 'general_index', 'cpi_index', 'iip_index', 'growth'];
const PERIOD_FIELD_CANDIDATES_YEAR = ['year', 'yr'];
const PERIOD_FIELD_CANDIDATES_MONTH = ['month', 'month_code', 'mon'];

function recordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.result)) return payload.result;
  return null;
}

function findField(record, candidates) {
  const keys = Object.keys(record || {});
  for (const candidate of candidates) {
    const hit = keys.find(k => k.toLowerCase() === candidate);
    if (hit && record[hit] != null) return { key: hit, value: record[hit] };
  }
  // Loose fallback: any key that *contains* one of the candidate substrings.
  for (const candidate of candidates) {
    const hit = keys.find(k => k.toLowerCase().includes(candidate));
    if (hit && record[hit] != null) return { key: hit, value: record[hit] };
  }
  return null;
}

function latestByPeriod(records) {
  let best = null, bestScore = -Infinity;
  for (const record of records) {
    const yearField = findField(record, PERIOD_FIELD_CANDIDATES_YEAR);
    const monthField = findField(record, PERIOD_FIELD_CANDIDATES_MONTH);
    const year = Number(yearField?.value);
    const month = Number(monthField?.value) || 0;
    if (!Number.isFinite(year)) continue;
    const score = year * 100 + month;
    if (score > bestScore) { bestScore = score; best = record; }
  }
  return best || records[records.length - 1] || null;
}

// Parses a MoSPI response into { value, period } or null (shape not
// recognized -- never a fabricated number).
export function parseMospiSeries(payload) {
  const records = recordsFrom(payload);
  if (!records || records.length === 0) return null;
  const latest = latestByPeriod(records);
  if (!latest) return null;
  const valueField = findField(latest, VALUE_FIELD_CANDIDATES);
  const value = Number(valueField?.value);
  if (!Number.isFinite(value)) return null;
  const yearField = findField(latest, PERIOD_FIELD_CANDIDATES_YEAR);
  const monthField = findField(latest, PERIOD_FIELD_CANDIDATES_MONTH);
  return { value, period: { year: yearField?.value ?? null, month: monthField?.value ?? null }, fieldUsed: valueField?.key ?? null };
}

async function fetchIip(token) {
  const { data } = await fetchIipMonthly({}, token);
  return parseMospiSeries(data);
}

// ---- Public CPI (2026-09-08 CPI-without-credentials task) ----
//
// Deliberately NOT the headline "General"/all-groups CPI figure: MoSPI
// ignores every query filter for anonymous callers (live-confirmed by this
// task -- identical output regardless of which Year/Month/Group_code/
// Sector/State_code were sent), so this app cannot *select* a specific
// series/sector the way the credentialed path could -- it can only search
// whatever fixed ~10-record unfiltered slice MoSPI's server currently
// returns for anonymous requests (their own documented "first 10 records"
// behavior, see mospiClient.mjs's fetchCpiPublic()). Across repeated live
// calls during this task's verification pass, that slice consistently
// carried the Consumer Food Price Index ("Consumer Food Price" group /
// a subgroup containing "Overall") -- the one meaningful, complete,
// officially-labeled series present -- so that is what "CPI Inflation"
// means in this app today. This is explicitly NOT the same figure as the
// headline general CPI inflation MoSPI itself publishes; the label
// throughout this app says so ("CPI Inflation (Consumer Food Price
// Index)"), never bare "CPI Inflation", so nothing is misrepresented.
// Matching is case-insensitive/substring-based rather than an exact string
// equality check, since MoSPI's own field casing was observed to vary
// ("All India" vs "ALL India" across different endpoints) -- and, per
// CLAUDE.md's "never guess a sourced field", returns null (not a guess) the
// moment nothing matches.
const CPI_TARGET_GROUP_HINT = 'consumer food price';
const CPI_TARGET_SUBGROUP_HINT = 'overall';

export function findCpiRecord(payload) {
  const records = Array.isArray(payload?.data) ? payload.data : null;
  if (!records || records.length === 0) return null;
  const hit = records.find(r =>
    String(r?.group ?? '').toLowerCase().includes(CPI_TARGET_GROUP_HINT) &&
    String(r?.subgroup ?? '').toLowerCase().includes(CPI_TARGET_SUBGROUP_HINT)
  );
  if (!hit) return null;
  // hit.index/hit.inflation can be null (a real, observed MoSPI response
  // state -- see the live "Housing-Overall" fixture in this module's own
  // test file) -- Number(null) is 0, not NaN, so null must be excluded
  // *before* conversion or a genuinely missing value would silently read as
  // a real zero.
  const index = hit.index != null ? Number(hit.index) : NaN;
  const inflationYoY = hit.inflation != null ? Number(hit.inflation) : NaN;
  if (!Number.isFinite(index) && !Number.isFinite(inflationYoY)) return null;
  return {
    index: Number.isFinite(index) ? index : null,
    // MoSPI's own directly-supplied "inflation" field -- per the CPI API
    // User Manual and MoSPI's standard published CPI press-release
    // methodology, this is the Year-on-Year inflation rate (same series,
    // 12 months earlier), not month-on-month. Used as-is, per CLAUDE.md's
    // "prefer the official field over recomputing it" instruction -- this
    // app has no way to independently verify the YoY calculation without a
    // second, 12-months-prior data point, which the unauthenticated
    // response does not let it select (see this function's own top
    // comment).
    inflationYoY: Number.isFinite(inflationYoY) ? inflationYoY : null,
    period: { year: hit.year ?? null, month: hit.month ?? null },
    sector: hit.sector ?? null,
    state: hit.state ?? null,
    seriesLabel: [hit.group, hit.subgroup].filter(Boolean).join(' — '),
    // MoSPI's own P(rovisional)/F(inal) revision flag for this record.
    revisionStatus: hit.status ?? null
  };
}

// Cache-first, fetch-if-stale -- same shape as macroProvider.mjs's own
// loadIndicator()/getDatasetSnapshot() below, just never gated on a
// credential at all: this function never calls readCredential() and never
// sends an Authorization header (see mospiClient.mjs's fetchCpiPublic()).
// CPI therefore renders correctly with zero MoSPI credentials configured.
export async function getCpiPublicSnapshot() {
  const cached = await mospiCache.read('cpiInflation');
  if (cached && !mospiCache.isStale(cached, MOSPI.dataCacheTtlMs)) {
    return { status: 'Live', ...cached };
  }
  try {
    const payload = await fetchCpiPublic();
    const record = findCpiRecord(payload);
    if (!record) throw new MospiUpstreamError('MoSPI\'s unauthenticated response did not include a recognizable CPI series -- see findCpiRecord().');
    const bundle = { ...record, fetchedAt: new Date().toISOString() };
    await mospiCache.write('cpiInflation', bundle);
    return { status: 'Live', ...bundle };
  } catch (err) {
    if (cached) return { status: 'Delayed', ...cached, error: err.message };
    return { status: 'Unavailable', index: null, inflationYoY: null, period: null, sector: null, seriesLabel: null, error: err.message };
  }
}

// Integration-level status for the Configuration page. The 7-state model
// below now describes only the credentialed half of this integration (IIP)
// -- CPI's own status is always independently "live-or-not" (see
// PUBLIC_DATASETS' entry in the `datasets` array below, `authRequired:
// false`) and never gated by, or folded into, this credential state machine.
// Not Configured / Credentials Required / Configured / Connected /
// Authentication Failed / Token Expired / Provider Unavailable. "Credentials
// Required" here means the credential file has nothing usable *and* the
// last attempt (if any) wasn't an auth failure -- mirrored, in simpler form,
// on IIP's own macro-indicator status.
export async function getIntegrationStatus() {
  const credential = await readCredential();
  const hasToken = !!credential.accessToken;
  const expired = hasToken && isTokenExpired(credential);

  // Priority order matters: a token that is both expired *and* carries a
  // stale error should read "Token Expired" (the actionable, specific
  // cause) rather than a generic error state; an unverified-but-present
  // token with no error yet should never look worse ("Provider Unavailable")
  // than it is.
  let status = 'Not Configured';
  if (hasToken && expired) status = 'Token Expired';
  else if (credential.lastError && /auth|401|403|invalid|incorrect/i.test(credential.lastError)) status = 'Authentication Failed';
  else if (hasToken && credential.lastVerifiedAt && !credential.lastError) status = 'Connected';
  else if (hasToken && credential.lastError) status = 'Provider Unavailable';
  else if (hasToken) status = 'Configured';

  // Public (CPI) and credentialed (IIP) rows are built differently: a public
  // row's cache bundle carries `index`/`inflationYoY` (findCpiRecord()'s
  // shape), never `value` (parseMospiSeries()'s shape) -- so
  // `hasCachedValue` checks whichever field that dataset's own snapshot
  // function actually writes, rather than assuming one shape for both.
  const datasetStatus = await Promise.all([
    ...PUBLIC_DATASETS.map(async d => {
      const cached = await mospiCache.read(d.key);
      return {
        key: d.key, label: d.label, authRequired: false,
        lastSuccessfulFetch: cached?.fetchedAt ?? null,
        hasCachedValue: cached?.index != null || cached?.inflationYoY != null
      };
    }),
    ...CREDENTIALED_DATASETS.map(async d => {
      const cached = await mospiCache.read(d.key);
      return {
        key: d.key, label: d.label, authRequired: true,
        lastSuccessfulFetch: cached?.fetchedAt ?? null,
        hasCachedValue: cached?.value != null
      };
    })
  ]);

  return {
    providerId: MOSPI.providerId,
    providerName: MOSPI.providerName,
    providerDescription: MOSPI.providerDescription,
    manageAccountUrl: MOSPI.manageAccountUrl,
    datasets: datasetStatus,
    status,
    credentialStatus: hasToken ? 'Present' : 'Missing',
    connectedEmail: credential.email,
    tokenPreview: maskToken(credential.accessToken),
    tokenObtainedAt: credential.obtainedAt,
    tokenExpiresAt: credential.expiresAt,
    lastVerifiedAt: credential.lastVerifiedAt,
    lastError: credential.lastError
  };
}

// Per-dataset snapshot consumed by data/watchlist/macro.mjs for the
// credentialed dataset only (IIP) -- CPI now goes through
// getCpiPublicSnapshot() above instead, never through this credential-gated
// path. Cache-first, fetch-if-stale-and-credentialed -- same shape as
// macroProvider.mjs's own loadIndicator(), just gated on a valid token
// instead of always-on.
export async function getDatasetSnapshot(datasetKey) {
  const def = CREDENTIALED_DATASETS.find(d => d.key === datasetKey);
  if (!def) return null;
  const cached = await mospiCache.read(datasetKey);
  const credential = await readCredential();

  if (!credential.accessToken) {
    return { status: cached ? 'Delayed' : 'Credentials Required', value: cached?.value ?? null, period: cached?.period ?? null, asOf: cached?.fetchedAt ?? null };
  }
  if (isTokenExpired(credential)) {
    return { status: cached ? 'Delayed' : 'Token Expired', value: cached?.value ?? null, period: cached?.period ?? null, asOf: cached?.fetchedAt ?? null };
  }
  if (cached && !mospiCache.isStale(cached, MOSPI.dataCacheTtlMs)) {
    return { status: 'Live', value: cached.value, period: cached.period, asOf: cached.fetchedAt };
  }
  try {
    const parsed = await def.fetch(credential.accessToken);
    if (!parsed) throw new MospiUpstreamError('MoSPI response shape not recognized -- see parseMospiSeries()');
    const bundle = { key: datasetKey, value: parsed.value, period: parsed.period, fieldUsed: parsed.fieldUsed, fetchedAt: new Date().toISOString() };
    await mospiCache.write(datasetKey, bundle);
    await markVerified(); // a real fetch just succeeded -- integration status may now read "Connected"
    return { status: 'Live', value: bundle.value, period: bundle.period, asOf: bundle.fetchedAt };
  } catch (err) {
    const status = err instanceof MospiAuthError ? 'Authentication Failed' : (cached ? 'Delayed' : 'Unavailable');
    await recordError(err.message); // so Configuration -> Integrations reflects this without requiring a manual "Test connection" click
    return { status, value: cached?.value ?? null, period: cached?.period ?? null, asOf: cached?.fetchedAt ?? null, error: err.message };
  }
}

// ---- Setup workflow (Configuration → Integrations page). Every function
// here that takes a password uses it only for the single upstream HTTP call
// it exists to make, then lets it fall out of scope -- never written to
// credentialStore, never logged (server.mjs's route handlers must not log
// request bodies for these routes either; see the route comments). ----

// Neither MoSPI manual documents the exact response wording for "this email
// is already registered" (no error-response body is shown in either PDF) --
// this is a best-effort heuristic over the error text/status MoSPI actually
// returns, disclosed as a heuristic (not a confirmed documented contract) in
// the Configuration UI's own copy. A 409 status or an "already/duplicate/
// exists" phrase in the message is treated as an existing-account signal so
// the UI can point the user at Sign in / Password recovery instead of a
// generic failure message.
const ALREADY_EXISTS_PATTERN = /already\s*(exists?|registered|in\s*use)|duplicate|user\s*exists|account\s*exists|email\s*(exists|.*(registered|taken))/i;

// Pure (no I/O) so it's covered by this module's own unit tests, same as
// parseMospiSeries() below. Exported for that reason, not because any other
// module consumes it.
export function isAlreadyExistsError({ message, status } = {}) {
  return status === 409 || ALREADY_EXISTS_PATTERN.test(message || '');
}

// POST /api/users/usersignup per config.mjs's citations. Registration alone
// does not obtain a token -- the user still logs in afterward.
export async function registerAccount({ username, email, password, organization, purpose }) {
  try {
    await signup({ username, email, password, organization, purpose: purpose || 'View/Download the Data' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message, alreadyExists: isAlreadyExistsError(err) };
  }
}

// POST /api/login (or the WPI manual's /api/users/login fallback) -- the one
// documented way to obtain an access token. Persists only the resulting
// token/expiry/email; the password argument is never persisted.
export async function connectWithCredentials({ email, password }) {
  try {
    const { token, obtainedAt, expiresAt } = await login({ email, password });
    const record = await saveToken({ email, accessToken: token, obtainedAt, expiresAt });
    return { success: true, status: 'Configured', tokenPreview: maskToken(record.accessToken), tokenExpiresAt: record.expiresAt };
  } catch (err) {
    await recordError(err.message);
    return { success: false, error: err.message };
  }
}

// Manual-paste path (config.mjs's documented "Enter Access Token" fallback)
// for a user who already generated a token via Postman/Swagger themselves,
// per the CPI manual's own documented Postman workflow. Since this app
// cannot see MoSPI's own issue time for a pasted token, the expiry is
// assumed to start now, using the same documented 15-minute TTL -- disclosed
// in the UI as an estimate, not a value read from MoSPI.
export async function connectWithToken({ accessToken, email }) {
  const obtainedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const record = await saveToken({ email: email || null, accessToken, obtainedAt, expiresAt });
  return { success: true, status: 'Configured', tokenPreview: maskToken(record.accessToken), tokenExpiresAt: record.expiresAt };
}

export async function disconnect() {
  await clearCredential();
  return { success: true };
}

// "Test connection" action -- attempts one real dataset fetch using the
// stored token rather than a dedicated no-op endpoint (none is documented).
// Tests IIP (2026-09-08: was CPI until this task moved CPI off the
// credential-gated path entirely -- testing CPI here would no longer prove
// anything about the stored token, since getCpiPublicSnapshot() never reads
// it). Updates lastVerifiedAt/lastError as a side effect via
// getDatasetSnapshot()'s own cache write.
export async function testConnection() {
  const credential = await readCredential();
  if (!credential.accessToken) return { success: false, error: 'No token configured.' };
  if (isTokenExpired(credential)) return { success: false, error: 'Token expired.' };
  const snapshot = await getDatasetSnapshot('iip');
  if (snapshot.status === 'Live') return { success: true }; // getDatasetSnapshot() already called markVerified() on this success path
  if (snapshot.error) await recordError(snapshot.error);
  return { success: false, error: snapshot.error || `Test fetch returned status ${snapshot.status}` };
}

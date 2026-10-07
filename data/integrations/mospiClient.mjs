import https from 'node:https';
import crypto from 'node:crypto';
import { MOSPI, MOSPI_TLS_MODE } from './config.mjs';

// Thin, dependency-free HTTP layer over the documented MoSPI API platform
// (see config.mjs for source citations). Every request uses standard,
// fully-verified HTTPS via the global `fetch` -- same mechanism every other
// provider in this app already uses (data/providers/yahooQuoteProvider.mjs).
// No TLS workaround is applied here, unlike the official nso-india reference
// client (see config.mjs's comment) -- a live call against a
// misconfigured upstream server surfaces as a normal network error, handled
// the same way as any other fetch failure in this app (Provider Unavailable,
// never silently retried with weakened security).
//
// The one deliberate exception is fetchCpiPublic() at the bottom of this
// file -- see its own comment for why, and why it is scoped to exactly that
// one call rather than applied here.

export class MospiAuthError extends Error {
  constructor(message, status) { super(message); this.name = 'MospiAuthError'; this.status = status; }
}
export class MospiUpstreamError extends Error {
  constructor(message, status) { super(message); this.name = 'MospiUpstreamError'; this.status = status; }
}

// Node's global `fetch` collapses every network-level failure (DNS, TLS,
// connection refused, ...) into a generic `TypeError: fetch failed`, with the
// real reason discarded into `err.cause`. Surfacing that verbatim to the
// Configuration UI is technically true but useless -- this turns it into a
// specific, actionable message instead, without ever weakening TLS on this
// path. The live-confirmed case (2026-09-24 diagnosis) is MoSPI's own server
// requiring legacy TLS renegotiation, the exact defect fetchCpiPublic()/
// fetchIipPublic() below work around with a scoped https.Agent -- deliberately
// NOT applied here, since this function is the one that carries a real
// account password (see this file's top comment).
export function describeNetworkError(err) {
  const code = err?.cause?.code || err?.code;
  if (code === 'ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED') {
    return "MoSPI's server requires an insecure, legacy TLS renegotiation mode that this app deliberately does not enable for registration or sign-in, since that would mean sending your password over a weakened connection. This is a defect on MoSPI's own server (independently confirmed), not a problem with your account or this app's setup. CPI and IIP data are unaffected -- they use a separate public endpoint that never needs a password. Report this to MoSPI/NIC, or use \"Manual token entry\" with a token you generate yourself via MoSPI's own Postman/Swagger flow.";
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Unable to reach MoSPI: DNS lookup failed. Check network connectivity.';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') return "Unable to reach MoSPI: connection failed. MoSPI's service may be unavailable.";
  if (typeof code === 'string' && code.startsWith('ERR_TLS')) return `Unable to reach MoSPI over a secure connection (${code}).`;
  return `Unable to reach MoSPI: ${err?.cause?.message || err.message || 'unknown network error'}`;
}

async function request(path, { method = 'GET', body, token, query } = {}) {
  const url = new URL(path, MOSPI.baseUrl);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, v);
  const headers = { 'User-Agent': 'Stocks-Research-Workspace/1.0 (local, single-user)' };
  if (body) headers['Content-Type'] = 'application/json';
  // Both forms appear across MoSPI's own manuals ("Authorization" header
  // holding the raw token, per the WPI manual's screenshot description) --
  // no "Bearer " prefix is documented, so none is added here.
  if (token) headers['Authorization'] = token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MOSPI.requestTimeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw new MospiUpstreamError('MoSPI did not respond within the timeout window.');
      throw new MospiUpstreamError(describeNetworkError(err));
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (res.status === 401 || res.status === 403) {
      throw new MospiAuthError(data?.message || `MoSPI authentication failed (HTTP ${res.status})`, res.status);
    }
    if (!res.ok) {
      throw new MospiUpstreamError(data?.message || `MoSPI request failed (HTTP ${res.status})`, res.status);
    }
    return { data, raw: text, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

// Signup -- documented in both manuals as Base URL/api/users/usersignup,
// POST, JSON body {username, email, password, organization, purpose}, no
// auth required, one-time per email. The password is only ever forwarded to
// MoSPI in this single request; the caller (server.mjs route) never persists
// it, per the user's explicit instruction.
export async function signup({ username, email, password, organization, purpose }) {
  return request(MOSPI.signupPath, { method: 'POST', body: { username, email, password, organization, purpose } });
}

// Login -- tries the CPI manual's documented path first, then falls back to
// the WPI manual's path on a 404 (see config.mjs's loginPaths comment for
// why both exist). Returns { token, expiresAt }. Like signup, the password
// is used only for this one request and never stored by this module or its
// caller.
export async function login({ email, password }) {
  let lastError = null;
  for (const path of MOSPI.loginPaths) {
    try {
      const { data } = await request(path, { method: 'POST', body: { email, username: email, password } });
      const token = data?.token || data?.accessToken || data?.access_token || data?.data?.token;
      if (!token) throw new MospiUpstreamError('MoSPI login response did not contain a recognizable token field.');
      const obtainedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + MOSPI.tokenTtlMs).toISOString();
      return { token, obtainedAt, expiresAt };
    } catch (err) {
      lastError = err;
      if (err instanceof MospiUpstreamError && err.status === 404) continue; // try the other documented path
      throw err;
    }
  }
  throw lastError || new MospiUpstreamError('MoSPI login failed on every documented endpoint path.');
}

// Group/SubGroup-level CPI index + inflation, Jan 2013 onwards per the CPI
// manual §1.5.3. `params` passes through Series/Year/Month/State_code/
// Group_code/Subgroup_code/Sector/Format verbatim -- undocumented/omitted
// params are simply not filtered server-side, matching the manual's own
// "if no value is supplied ... the API will not apply a filter" behavior.
export async function fetchCpiIndex(params, token) {
  return request(MOSPI.cpiGroupPath, { query: { Format: 'JSON', ...params }, token });
}

// ---- Public, unauthenticated CPI fetch (2026-09-08 CPI-without-credentials
// task) ----
//
// MoSPI's own CPI API User Manual (config.mjs's citation) documents this,
// verbatim, in its execution-process section: "Without access token the APIs
// will fetch only the first 10 records." That is a real, live-confirmed
// platform behavior, not an assumption -- a plain unauthenticated GET
// against /api/cpi/getCPIIndex (curl, this task's own verification pass)
// returns real, current CPI/CFPI records with zero Authorization header.
// Every documented query filter (Year/Month/Group_code/Subgroup_code/
// Sector/State_code) is silently ignored by MoSPI's server for anonymous
// callers (also live-confirmed: identical output regardless of which
// filters were sent) -- they are still passed below, both because the
// manual documents them as the real contract and in case MoSPI's server
// ever starts honoring them for anonymous callers, but callers must not
// assume they take effect. See mospiProvider.mjs's findCpiRecord() for how
// the resulting fixed ~10-record slice is searched instead of filtered.
//
// A second, independent, live-confirmed MoSPI server defect makes this
// endpoint unreachable from Node's own `fetch`/https stack at all under
// standard TLS settings: `ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED`
// (MoSPI's server requires legacy/unsafe TLS renegotiation support, which
// Node -- and the request() helper above, via global fetch -- refuses by
// default per RFC 5746, since a server that never adopted secure
// renegotiation is vulnerable to a MITM plaintext-injection attack during
// renegotiation). `curl` succeeds against the same host because its TLS
// stack in this environment permits legacy renegotiation by default; Node's
// does not.
//
// This is a deliberate, narrow, user-approved exception (2026-09-08, same
// conversation that requested this feature, after the trade-off was
// explained; made runtime-configurable via MOSPI_TLS_MODE on 2026-09-24,
// still opt-in and still scoped the same way -- see config.mjs) -- NOT a
// blanket TLS downgrade for this module. It is scoped to exactly the two
// public-fetch functions that use this agent:
//   - Certificate verification stays fully on (`rejectUnauthorized` is not
//     touched, defaults true) -- only the renegotiation policy is relaxed.
//   - It is a separate https.Agent, never applied to request() above, so
//     login/signup remain completely unaffected and keep failing exactly as
//     before (still "Provider Unavailable") if ever exercised against this
//     host -- see docs/authoritative/system.md §3.10.
//
// IIP investigation (2026-09-09, independent task, per its own explicit
// instruction not to assume IIP behaves like CPI): live-tested from scratch,
// not copied from the CPI conclusion. A plain unauthenticated GET against
// /api/iip/getIIPMonthly (this app's existing endpoint, corroborated by the
// nso-india reference client -- config.mjs) returned real, current General
// IIP data with zero Authorization header -- the exact same "first 10
// records for anonymous callers" platform behavior CPI's manual documents,
// now independently confirmed for IIP too (MoSPI has no separate IIP manual,
// but the live response matches the same platform pattern). The same two
// constraints found for CPI were independently re-verified for IIP: every
// query filter is silently ignored for anonymous callers (repeated calls
// with different params returned byte-identical output), and the identical
// `ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED` TLS defect blocks Node's
// plain `fetch`/https stack (confirmed live before writing fetchIipPublic()
// below, not assumed from the CPI case) -- so the same narrow, already-
// user-approved legacyRenegotiationAgent is reused for IIP's own public
// fetch, never for login/signup/any other host.
const legacyRenegotiationAgent = new https.Agent({
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
});

// Which agent requestPublic() below hands to https.request(), driven by
// config.mjs's MOSPI_TLS_MODE (see its own comment for the full rationale).
// 'standard' (the default) returns undefined -- https.request() then falls
// back to Node's own default global agent, i.e. normal, fully-verified TLS
// with no renegotiation relaxation at all, not a second/weaker agent
// instance. Pure (no I/O), so it's covered by this module's own unit tests
// without needing a live network call to prove the mode switch works.
export function resolvePublicAgent(mode = MOSPI_TLS_MODE) {
  return mode === 'legacy-renegotiation' ? legacyRenegotiationAgent : undefined;
}

// Shared by fetchCpiPublic()/fetchIipPublic() below -- both need the exact
// same GET (differing only in path and the label used in error messages),
// with the same MOSPI_TLS_MODE-driven agent choice. One implementation, not
// two copies of the same https.request boilerplate. Deliberately separate
// from request() above -- login/signup always go through request()'s plain
// global `fetch` and never call resolvePublicAgent() or see this agent,
// regardless of MOSPI_TLS_MODE (see config.mjs's comment on that setting).
function requestPublic(path, label) {
  const url = new URL(path, MOSPI.baseUrl);
  url.searchParams.set('Format', 'JSON');
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      agent: resolvePublicAgent(),
      headers: { 'User-Agent': 'Stocks-Research-Workspace/1.0 (local, single-user)' },
      timeout: MOSPI.requestTimeoutMs
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new MospiUpstreamError(`MoSPI ${label} request failed (HTTP ${res.statusCode})`, res.statusCode));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new MospiUpstreamError(`MoSPI ${label} response was not valid JSON.`)); }
      });
    });
    req.on('timeout', () => req.destroy(new MospiUpstreamError(`MoSPI ${label} request timed out.`)));
    req.on('error', err => reject(err instanceof MospiUpstreamError ? err : new MospiUpstreamError(err.message)));
    req.end();
  });
}

export async function fetchCpiPublic() {
  return requestPublic(MOSPI.cpiGroupPath, 'CPI');
}

// IIP's own public fetch (2026-09-09 investigation, see the comment above
// legacyRenegotiationAgent for the live-tested basis) -- same shape as
// fetchCpiPublic(), same endpoint path this app already had configured
// (config.mjs's iipMonthlyPath), same fixed ~10-record anonymous slice
// behavior, same TLS workaround, independently confirmed rather than
// assumed.
export async function fetchIipPublic() {
  return requestPublic(MOSPI.iipMonthlyPath, 'IIP');
}

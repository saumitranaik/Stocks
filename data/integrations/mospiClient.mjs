import https from 'node:https';
import crypto from 'node:crypto';
import { MOSPI } from './config.mjs';

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
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
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

// Monthly Index of Industrial Production -- endpoint path corroborated by
// the official nso-india GitHub client (see config.mjs), not by a published
// user manual the way CPI/WPI each have. Callers must treat a successful
// response's *shape* as unverified until confirmed live (see
// mospiProvider.mjs's defensive parser).
export async function fetchIipMonthly(params, token) {
  return request(MOSPI.iipMonthlyPath, { query: { Format: 'JSON', ...params }, token });
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
// explained) -- NOT a blanket TLS downgrade for this module. It is scoped to
// exactly this one function/agent:
//   - Certificate verification stays fully on (`rejectUnauthorized` is not
//     touched, defaults true) -- only the renegotiation policy is relaxed.
//   - It is a separate https.Agent, never applied to request() above, so
//     login/signup/fetchIipMonthly (IIP) are completely unaffected and keep
//     failing exactly as before (still "Provider Unavailable") until MoSPI
//     fixes their server or a separate, explicitly-approved task extends
//     this exception to IIP too -- see docs/authoritative/system.md §3.10.
const legacyRenegotiationAgent = new https.Agent({
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
});

export async function fetchCpiPublic() {
  const url = new URL(MOSPI.cpiGroupPath, MOSPI.baseUrl);
  url.searchParams.set('Format', 'JSON');
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      agent: legacyRenegotiationAgent,
      headers: { 'User-Agent': 'Stocks-Research-Workspace/1.0 (local, single-user)' },
      timeout: MOSPI.requestTimeoutMs
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new MospiUpstreamError(`MoSPI CPI request failed (HTTP ${res.statusCode})`, res.statusCode));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new MospiUpstreamError('MoSPI CPI response was not valid JSON.')); }
      });
    });
    req.on('timeout', () => req.destroy(new MospiUpstreamError('MoSPI CPI request timed out.')));
    req.on('error', err => reject(err instanceof MospiUpstreamError ? err : new MospiUpstreamError(err.message)));
    req.end();
  });
}

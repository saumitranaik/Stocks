// Configuration for the MoSPI eSankhyiki integration. Originally built
// (2026-09-08) as this app's first *credentialed* external source, since
// every other data/providers/ source is free and unauthenticated (system.md
// §1.2). A same-day follow-on task re-verified the CPI half of this
// integration live and found MoSPI's own CPI API actually supports genuine
// unauthenticated access (see fetchCpiPublic() in mospiClient.mjs and
// mospiProvider.mjs's getCpiPublicSnapshot()) -- so CPI no longer needs the
// credential lifecycle below at all. IIP remains credentialed (unverified
// whether it, too, would work unauthenticated -- not tested, per that
// task's explicit instruction not to change IIP's handling without separate
// testing). See docs/authoritative/system.md §3.10 for the full,
// current architecture.
//
// Every fact below was verified against MoSPI's own official published
// material, not guessed:
//   - "MOSPI API PLATFORM CPI API USER MANUAL" (api.mospi.gov.in/API/CPI%20
//     API%20User%20Manual.pdf) — signup, login, getCPIIndex/getItemIndex.
//     §1.5.2/§1.7: "Without access token the APIs will fetch only the first
//     10 records" -- the documented basis for the unauthenticated CPI path;
//     live-confirmed (2026-09-08) via a plain unauthenticated GET.
//   - "MOSPI API PLATFORM API USER MANUAL FOR WHOLESALE PRICE INDEX (WPI)"
//     (esankhyiki.mospi.gov.in/API/WPI%20API%20User%20Manual.pdf) — same
//     platform, corroborates the signup/login contract, documents a second,
//     slightly different login path (see LOGIN_PATHS below — a real
//     inconsistency between MoSPI's own two manuals, not this app's error).
//   - github.com/nso-india/mospi-esankhyiki (nso-india = National Statistical
//     Office India's own GitHub org) — an official open-source client whose
//     source code calls the *same* api.mospi.gov.in base URL with real IIP
//     endpoint paths (/api/iip/getIIPAnnual, /api/iip/getIIPMonthly). No
//     dedicated "IIP API User Manual" PDF was found by this audit the way
//     CPI/WPI each have one — IIP's endpoint is corroborated by official GoI
//     source code, not by a published manual, and that distinction is kept
//     visible in the UI/docs rather than presented as equally documented.
//
// What was verified as NOT existing, so it is not implemented: no password-
// reset/change API or dedicated account-management portal is documented
// anywhere in either manual — MANAGE_ACCOUNT_URL below points at the one
// official surface found (the Swagger UI at the base URL itself), not an
// invented reset-flow URL.
//
// A real caveat this app deliberately does NOT work around: the official
// nso-india client disables TLS certificate verification and enables legacy
// SSL renegotiation to reach api.mospi.gov.in (a server-side misconfiguration
// signal on MoSPI's end, not this app's). This module always uses standard,
// fully-verified HTTPS — if that means a live call fails with a TLS error
// until MoSPI fixes their server, that surfaces as Provider Unavailable, not
// as a weakened security posture in this codebase.
export const MOSPI = {
  providerId: 'mospi',
  providerName: 'MoSPI eSankhyiki',
  providerDescription: 'Ministry of Statistics and Programme Implementation (Government of India) — official CPI and IIP statistics via the api.mospi.gov.in API platform.',
  baseUrl: 'https://api.mospi.gov.in',
  signupPath: '/api/users/usersignup',
  // Both paths are drawn verbatim from MoSPI's own two manuals (CPI manual:
  // /api/login; WPI manual: /api/users/login) — a genuine discrepancy in
  // MoSPI's own documentation. mospiClient.mjs tries the CPI manual's path
  // first (the manual for the exact dataset this app consumes) and falls
  // back to the WPI manual's path on a 404, rather than this app silently
  // picking one and hiding the ambiguity.
  loginPaths: ['/api/login', '/api/users/login'],
  cpiGroupPath: '/api/cpi/getCPIIndex',
  cpiItemPath: '/api/cpi/getItemIndex',
  iipAnnualPath: '/api/iip/getIIPAnnual',
  iipMonthlyPath: '/api/iip/getIIPMonthly',
  manageAccountUrl: 'https://api.mospi.gov.in',
  // Documented in the CPI manual §1.5.2: "valid for 15 minutes". No refresh-
  // token or long-lived-token mechanism is documented anywhere — this is the
  // real reason this integration cannot silently stay "Connected" the way a
  // typical API-key integration would; see credentialStore.mjs.
  tokenTtlMs: 15 * 60 * 1000,
  requestTimeoutMs: 20000,
  // Independent of macroCache's 30min TTL (data/watchlist/macro.mjs) —
  // MoSPI's own datasets (CPI/IIP) are monthly, so there is no benefit to
  // hitting the upstream API more often than this even with a valid token.
  dataCacheTtlMs: 6 * 60 * 60 * 1000
};

export const CREDENTIAL_STORE_PATH = 'data/config/mospi.local.json';

// ---- Configurable TLS mode (2026-09-24 task) ----
//
// MOSPI's own server requires legacy TLS renegotiation
// (ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED under Node's default,
// standard TLS stack -- see mospiClient.mjs's describeNetworkError()) to
// reach its public CPI/IIP endpoints at all. This is a defect on MoSPI's own
// server (also present in the official nso-india reference client, which
// works around it the same way -- config.mjs's top comment), not something
// this app can fix. Rather than hard-coding that workaround permanently, the
// TLS posture for those two calls is a runtime setting so it can be flipped
// back the moment MoSPI's server is fixed, with no code change:
//
//   MOSPI_TLS_MODE=standard              (default, secure -- normal Node TLS)
//   MOSPI_TLS_MODE=legacy-renegotiation  (explicit opt-in compatibility mode)
//
// STANDARD is the default specifically so this app never silently weakens
// TLS -- an operator who does nothing gets full, unweakened security, and
// today's live MoSPI CPI/IIP calls simply fail with a clear "Provider
// Unavailable" reason (describeNetworkError()) until they opt in.
//
// Scope: this setting affects ONLY fetchCpiPublic()/fetchIipPublic() in
// mospiClient.mjs (via requestPublic()'s resolvePublicAgent()) -- the two
// calls that were already using the narrowly-scoped legacyRenegotiationAgent
// before this setting existed. It has zero effect on login/signup/
// fetchCpiIndex() (mospiClient.mjs's request(), built on plain global
// `fetch`), which never use this agent regardless of MOSPI_TLS_MODE --
// those carry a real account password and the 2026-09-24 decision was to
// keep them on standard TLS unconditionally rather than let this setting
// (built for two public, passwordless endpoints) also govern a
// password-carrying one. It also has zero effect on any other HTTPS call in
// this app (Yahoo/Screener.in/News/MoSPI-unrelated) -- those never import
// this agent at all.
const VALID_TLS_MODES = ['standard', 'legacy-renegotiation'];
const rawTlsMode = String(process.env.MOSPI_TLS_MODE || 'standard').trim().toLowerCase();
export const MOSPI_TLS_MODE = VALID_TLS_MODES.includes(rawTlsMode) ? rawTlsMode : 'standard';

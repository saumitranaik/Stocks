import { request } from '../util.mjs';
import { macroCache } from '../watchlist/diskCache.mjs';

// All-India Power Demand (2026-09-24 Future Integration audit -- "implement
// the remaining India Macro indicators from their authoritative non-MoSPI
// sources" task): National Power Portal (NPP, npp.gov.in) -- a Government of
// India platform under the Ministry of Power, built/operated by the National
// Informatics Centre -- serves a genuine, public, unauthenticated JSON
// endpoint backing its own live "Merit Order" dashboard
// (dashBoard/gc-map-dashboard-meritchart):
//
//   GET https://npp.gov.in/dashBoard/demandmet1chartdata?date=YYYY-MM-DD
//
// returns a chronological array of { updated_on: <epoch ms>, name_of_data:
// "DEMAND MET", value_of_data: <MW> }, sampled roughly every 4 minutes
// across the day. Live-verified this session with a bare, header-less GET --
// no API key, no cookies, no session/referer requirement, standard TLS: real
// intraday all-India demand-met readings. The `date` param was confirmed
// live to resolve at least back to 2025-09-24 (a full year), far past what
// this app needs for a "latest reading" indicator. npp.gov.in's own policy
// page (npp.gov.in/help_policy) states no prior permission is required to
// link to or reuse publicly hosted information on the site.
//
// This is a genuinely new finding, not a re-confirmation of a prior one: the
// 2026-09-08/09 audits (see macroProvider.mjs's UNAVAILABLE_MACRO_INDICATORS
// comment) tested three different power-sector mechanisms and rejected all
// three -- CEA's documented psp_peak.php/psp_energy.php API (returned no
// data across 5 live attempts), Grid-India/POSOCO's own PSP reports
// (PDF-only), and NPP's separate NPDMS API (restricted to registered
// government organizations). NPP's own dashboard-backing JSON endpoint above
// was not tested in either prior pass -- it is a different mechanism from
// all three and was found this session while re-auditing the same brief with
// a wider search (an open-source project pulling the same endpoint on a
// GitHub Actions schedule surfaced its existence; the endpoint itself was
// then independently live-verified directly against npp.gov.in, not trusted
// from that third-party source).
const NPP_BASE_URL = 'https://npp.gov.in/dashBoard/demandmet1chartdata';
export const NPP_DASHBOARD_URL = 'https://npp.gov.in/dashBoard/gc-map-dashboard-meritchart';
// Real update cadence is ~4 minutes; this only bounds re-fetch frequency
// (avoid polling an official government endpoint on every dashboard load,
// CLAUDE.md/this task's own "do not aggressively poll" instruction) -- it
// never affects disclosed freshness, since `observedAt` below always carries
// NPP's own real reading timestamp regardless of when this app last fetched.
const NPP_CACHE_TTL_MS = 15 * 60 * 1000;

// Formats in Asia/Kolkata regardless of the host machine's own timezone --
// NPP's `date` query param is an India-local calendar date, not UTC, and
// this server may run in any timezone.
export function istDateString(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function fetchDemandMetForDate(dateStr) {
  const res = await request(`${NPP_BASE_URL}?date=${dateStr}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return data;
}

// Pure parsing step, factored out for unit testing (this app's automated
// node:test layer is scoped to pure-math modules; everything else is
// validated manually per docs/governance/roadmap.md §1 -- same precedent as
// mospiProvider.mjs's findCpiRecord()/findIipRecord()). Picks the max
// `updated_on` row rather than assuming array order (NPP's own ordering is
// not documented) and skips any row with a non-finite value or timestamp
// instead of letting a malformed entry win by default.
export function pickLatestDemandMet(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const latest = data.reduce((max, row) => {
    if (!Number.isFinite(row?.updated_on) || !Number.isFinite(row?.value_of_data)) return max;
    return row.updated_on > (max?.updated_on ?? -Infinity) ? row : max;
  }, null);
  if (!latest) return null;
  return { value: latest.value_of_data, observedAt: new Date(latest.updated_on).toISOString() };
}

// Tries today's IST date first (the genuinely live reading); falls back to
// yesterday only for the narrow edge case of very early morning before the
// first same-day sample exists.
async function fetchLatestDemandMet() {
  const now = new Date();
  const todayIst = istDateString(now);
  let data = await fetchDemandMetForDate(todayIst);
  let usedDate = todayIst;
  if (!data) {
    const yesterdayIst = istDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    data = await fetchDemandMetForDate(yesterdayIst);
    usedDate = yesterdayIst;
  }
  const picked = pickLatestDemandMet(data);
  if (!picked) return null;
  return { ...picked, isToday: usedDate === todayIst };
}

// Cache-first, fetch-if-stale, falls back to a stale cache entry on a failed
// fetch -- same shape as every other macro/MoSPI snapshot function in this
// app (data/watchlist/macro.mjs's loadIndicator(), data/integrations/
// mospiProvider.mjs's getCpiPublicSnapshot()/getIipPublicSnapshot()).
// Provider-isolated: every failure is caught here, so an NPP outage can
// never throw up into buildMacroSnapshot()'s Promise.all and take down any
// other Macro workspace indicator.
export async function getPowerDemandSnapshot() {
  const cached = await macroCache.read('powerDemandNpp');
  if (cached && !macroCache.isStale(cached, NPP_CACHE_TTL_MS)) {
    return { status: 'Live', ...cached };
  }
  try {
    const result = await fetchLatestDemandMet();
    if (!result) throw new Error('NPP returned no DEMAND MET readings for today or yesterday');
    const bundle = { value: result.value, unit: 'MW', observedAt: result.observedAt, fetchedAt: new Date().toISOString() };
    await macroCache.write('powerDemandNpp', bundle);
    return { status: result.isToday ? 'Live' : 'Delayed', ...bundle };
  } catch (err) {
    if (cached) return { status: 'Delayed', ...cached, error: err.message };
    return { status: 'Unavailable', value: null, unit: 'MW', observedAt: null, error: err.message };
  }
}

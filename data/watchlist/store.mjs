import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../util.mjs';
import { classifyMarket } from './resolve.mjs';

const root = join(process.cwd(), 'data', 'watchlists');
const indexFile = join(root, 'index.json');
const fileFor = (id) => join(root, `${id}.json`);

// Default watchlists a fresh checkout self-seeds on first run -- kept as
// code, not hand-authored JSON, so the app works out of the box without
// committing generated data. core-portfolio deliberately mirrors the task
// brief's own example companies; banking/power reuse the same NSE ticker
// lists the old sector-preset screen used for those sectors; defence is a
// new curated NSE defence-sector list. Only `symbol` is seeded -- name,
// exchange, sector and industry are filled in by the first real fetch
// (see research.mjs's use of updateCompanyMetadata below), never guessed.
const SEEDS = [
  { id: 'core-portfolio', name: 'Core Portfolio', symbols: ['NTPC.NS', 'TCS.NS', 'HDFCBANK.NS', 'RELIANCE.NS', 'TATAPOWER.NS', 'HAL.NS'] },
  { id: 'banking', name: 'Banking', symbols: ['HDFCBANK.NS', 'ICICIBANK.NS', 'SBIN.NS', 'KOTAKBANK.NS', 'AXISBANK.NS', 'INDUSINDBK.NS', 'BANKBARODA.NS', 'PNB.NS'] },
  { id: 'power', name: 'Power', symbols: ['PGCIL.NS', 'NTPC.NS', 'TATAPOWER.NS', 'ADANIPOWER.NS', 'TORNTPOWER.NS', 'CESC.NS', 'JSWENERGY.NS', 'NHPC.NS'] },
  { id: 'defence', name: 'Defence', symbols: ['HAL.NS', 'BEL.NS', 'BEML.NS', 'BDL.NS', 'MAZDOCK.NS', 'COCHINSHIP.NS', 'GRSE.NS'] }
];

const slugify = (name) => String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'watchlist';
const emptyCompany = (symbol, now) => ({ symbol, name: symbol, exchange: null, market: classifyMarket({ symbol }), sector: null, industry: null, notes: null, targetWeightPct: null, addedAt: now });
const sanitizeImportedCompany = (raw, now) => ({
  symbol: raw.symbol, name: raw.name || raw.symbol, exchange: raw.exchange || null, market: raw.market || classifyMarket(raw),
  sector: raw.sector || null, industry: raw.industry || null, notes: raw.notes || null,
  targetWeightPct: Number.isFinite(raw.targetWeightPct) ? Math.max(0, Math.min(100, raw.targetWeightPct)) : null, addedAt: now
});

async function readWatchlistFile(id) {
  const watchlist = JSON.parse(await readFile(fileFor(id), 'utf8'));
  // cashTargetPct is a later addition -- default to 0 (fully invested) for
  // any watchlist file written before it existed, rather than migrating
  // every file on disk.
  if (!Number.isFinite(watchlist.cashTargetPct)) watchlist.cashTargetPct = 0;
  // acknowledgedAlertIds is a later addition (Phase 4) -- default to an
  // empty list for any watchlist file written before it existed, same
  // lazy-default-on-read convention as cashTargetPct above.
  if (!Array.isArray(watchlist.acknowledgedAlertIds)) watchlist.acknowledgedAlertIds = [];
  return watchlist;
}
async function writeWatchlistFile(watchlist) {
  await writeJsonAtomic(fileFor(watchlist.id), watchlist);
}
function summaryOf(watchlist) {
  return { id: watchlist.id, name: watchlist.name, file: `${watchlist.id}.json`, companyCount: watchlist.companies.length, updatedAt: watchlist.updatedAt };
}
async function writeIndex(index) {
  index.updatedAt = new Date().toISOString();
  await writeJsonAtomic(indexFile, index);
  return index;
}

let ready;
async function ensureSeeded() {
  await mkdir(root, { recursive: true });
  try { return JSON.parse(await readFile(indexFile, 'utf8')); }
  catch { /* first run -- fall through and seed */ }
  const now = new Date().toISOString();
  const watchlists = [];
  for (const seed of SEEDS) {
    const watchlist = { id: seed.id, name: seed.name, createdAt: now, updatedAt: now, companies: seed.symbols.map(symbol => emptyCompany(symbol, now)) };
    await writeWatchlistFile(watchlist);
    watchlists.push(summaryOf(watchlist));
  }
  return writeIndex({ activeWatchlist: SEEDS[0].id, watchlists, updatedAt: now });
}
// Memoize the seed check for the process lifetime -- once seeded, every
// call just needs the current index off disk (cheap, and always fresh
// since this is a single-process local server with no other writer).
function index() {
  if (!ready) ready = ensureSeeded();
  return ready.then(async () => JSON.parse(await readFile(indexFile, 'utf8')));
}

async function syncSummary(watchlist) {
  const idx = await index();
  const entry = summaryOf(watchlist);
  const existing = idx.watchlists.findIndex(w => w.id === watchlist.id);
  if (existing >= 0) idx.watchlists[existing] = entry; else idx.watchlists.push(entry);
  await writeIndex(idx);
  return idx;
}

// Must run once before anything else touches this module: getWatchlist()
// and the mutation functions read a watchlist file directly by id without
// going through index(), so if the very first request the server handles
// isn't listWatchlists()/getActiveWatchlist() (which do trigger seeding),
// it would 404 against a data/watchlists/ directory that was never seeded.
export async function init() {
  await index();
}

export async function listWatchlists() {
  return index();
}
export async function getWatchlist(id) {
  return readWatchlistFile(id);
}
export async function getActiveWatchlist() {
  const idx = await index();
  return readWatchlistFile(idx.activeWatchlist);
}

export async function createWatchlist(name) {
  const idx = await index();
  const base = slugify(name || 'New watchlist');
  let id = base, n = 2;
  while (idx.watchlists.some(w => w.id === id)) id = `${base}-${n++}`;
  const now = new Date().toISOString();
  const watchlist = { id, name: name || 'New watchlist', createdAt: now, updatedAt: now, companies: [] };
  await writeWatchlistFile(watchlist);
  idx.watchlists.push(summaryOf(watchlist));
  idx.activeWatchlist = id;
  await writeIndex(idx);
  return watchlist;
}

export async function renameWatchlist(id, name) {
  const watchlist = await readWatchlistFile(id);
  watchlist.name = name;
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return watchlist;
}

export async function duplicateWatchlist(id, name) {
  const source = await readWatchlistFile(id);
  const idx = await index();
  const base = slugify(name || `${source.name} copy`);
  let newId = base, n = 2;
  while (idx.watchlists.some(w => w.id === newId)) newId = `${base}-${n++}`;
  const now = new Date().toISOString();
  const watchlist = { id: newId, name: name || `${source.name} copy`, createdAt: now, updatedAt: now, companies: source.companies.map(c => ({ ...c })) };
  await writeWatchlistFile(watchlist);
  idx.watchlists.push(summaryOf(watchlist));
  idx.activeWatchlist = newId;
  await writeIndex(idx);
  return watchlist;
}

export async function deleteWatchlist(id) {
  const idx = await index();
  if (idx.watchlists.length <= 1) throw new Error('Cannot delete the last remaining watchlist.');
  idx.watchlists = idx.watchlists.filter(w => w.id !== id);
  if (idx.activeWatchlist === id) idx.activeWatchlist = idx.watchlists[0].id;
  await writeIndex(idx);
  try { await unlink(fileFor(id)); } catch { /* already gone */ }
  return idx;
}

export async function setActiveWatchlist(id) {
  const idx = await index();
  if (!idx.watchlists.some(w => w.id === id)) throw new Error('Unknown watchlist.');
  idx.activeWatchlist = id;
  return writeIndex(idx);
}

// Duplicate protection: dedupe by resolved symbol, case-insensitive.
// Returns { duplicate: existingCompany } instead of mutating anything when
// the symbol is already present, so the caller can highlight the existing
// row rather than silently no-op or error.
export async function addCompany(id, company) {
  const watchlist = await readWatchlistFile(id);
  const existing = watchlist.companies.find(c => c.symbol.toUpperCase() === company.symbol.toUpperCase());
  if (existing) return { duplicate: existing, watchlist };
  const entry = { symbol: company.symbol, name: company.name || company.symbol, exchange: company.exchange || null, market: company.market || classifyMarket(company), sector: company.sector || null, industry: company.industry || null, notes: null, targetWeightPct: null, addedAt: new Date().toISOString() };
  watchlist.companies.push(entry);
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return { added: entry, watchlist };
}

export async function removeCompany(id, symbol) {
  const watchlist = await readWatchlistFile(id);
  watchlist.companies = watchlist.companies.filter(c => c.symbol.toUpperCase() !== symbol.toUpperCase());
  // Stage 3 stale-alert cleanup: an acknowledged alert id is `${symbol}|${type}`
  // (data/decision/alerts.mjs) -- once the company itself is gone, any
  // acknowledgement for it is dead weight that can never be re-earned by a
  // real alert again. Prune it here rather than leaving it to accumulate
  // forever (store.mjs previously accepted this as "harmless leftover
  // state" -- cheap to actually clean up while already touching the file).
  const upperSymbol = symbol.toUpperCase();
  watchlist.acknowledgedAlertIds = (watchlist.acknowledgedAlertIds || []).filter(alertId => !alertId.toUpperCase().startsWith(`${upperSymbol}|`));
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return watchlist;
}

export async function reorderCompanies(id, order) {
  const watchlist = await readWatchlistFile(id);
  const bySymbol = new Map(watchlist.companies.map(c => [c.symbol, c]));
  const reordered = order.map(symbol => bySymbol.get(symbol)).filter(Boolean);
  // Guard against a stale/partial order payload silently dropping companies:
  // only apply it when it's a true reordering of the same set.
  if (reordered.length !== watchlist.companies.length) throw new Error('Reorder list does not match the watchlist\'s companies.');
  watchlist.companies = reordered;
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return watchlist;
}

// Sets (or clears, with `weightPct: null`) one company's illustrative
// portfolio allocation target -- see data/analytics/portfolio.mjs's
// resolveWeights() for how unset companies split the remainder.
export async function setCompanyWeight(id, symbol, weightPct) {
  const watchlist = await readWatchlistFile(id);
  const company = watchlist.companies.find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
  if (!company) throw new Error('Company not found in this watchlist.');
  company.targetWeightPct = Number.isFinite(weightPct) ? Math.max(0, Math.min(100, weightPct)) : null;
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return watchlist;
}

// Sets (or clears, with `notes: null`) one company's free-text research note.
export async function setCompanyNotes(id, symbol, notes) {
  const watchlist = await readWatchlistFile(id);
  const company = watchlist.companies.find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
  if (!company) throw new Error('Company not found in this watchlist.');
  company.notes = notes || null;
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return watchlist;
}

// Sets the watchlist-level illustrative cash allocation target (%) --
// resolveWeights() (data/analytics/portfolio.mjs) normalizes company
// weights to sum to (100 - cashTargetPct) instead of always assuming fully
// invested. Same "illustrative, not real holdings" disclosure as
// targetWeightPct.
export async function setCashTarget(id, cashTargetPct) {
  const watchlist = await readWatchlistFile(id);
  watchlist.cashTargetPct = Number.isFinite(cashTargetPct) ? Math.max(0, Math.min(100, cashTargetPct)) : 0;
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return watchlist;
}

// Creates a new watchlist directly from an exported company list (Watchlists
// tab's Import action) -- same id-collision/slugify handling as
// createWatchlist(), but companies arrive pre-populated (symbol/name/sector/
// notes/targetWeightPct) rather than resolved one at a time via addCompany's
// autocomplete/duplicate-check flow. Invalid entries (no symbol) are dropped
// rather than failing the whole import.
export async function importWatchlist({ name, companies, cashTargetPct }) {
  const idx = await index();
  const base = slugify(name || 'Imported watchlist');
  let id = base, n = 2;
  while (idx.watchlists.some(w => w.id === id)) id = `${base}-${n++}`;
  const now = new Date().toISOString();
  const seen = new Set();
  const cleanCompanies = (Array.isArray(companies) ? companies : [])
    .filter(c => c && typeof c.symbol === 'string' && c.symbol.trim())
    .map(c => sanitizeImportedCompany({ ...c, symbol: c.symbol.trim() }, now))
    .filter(c => { const key = c.symbol.toUpperCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  const watchlist = { id, name: name || 'Imported watchlist', createdAt: now, updatedAt: now, cashTargetPct: Number.isFinite(cashTargetPct) ? Math.max(0, Math.min(100, cashTargetPct)) : 0, companies: cleanCompanies };
  await writeWatchlistFile(watchlist);
  idx.watchlists.push(summaryOf(watchlist));
  idx.activeWatchlist = id;
  await writeIndex(idx);
  return watchlist;
}

// Sets (or clears) whether a given alert id (data/decision/alerts.mjs, shape
// `${symbol}|${type}`) is acknowledged -- persisted so it stays suppressed
// across refreshes until the underlying condition stops firing. An id that
// never recurs is just harmless leftover state, same tradeoff this file
// already accepts for other small JSON arrays rather than adding a pruning
// pass.
export async function setAlertAcknowledged(id, alertId, acknowledged) {
  const watchlist = await readWatchlistFile(id);
  const set = new Set(watchlist.acknowledgedAlertIds || []);
  if (acknowledged) set.add(alertId); else set.delete(alertId);
  watchlist.acknowledgedAlertIds = [...set];
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return watchlist;
}

// Stage 3 alert lifecycle: removes specific alert ids from the watchlist's
// acknowledged list -- used when data/decision/index.mjs detects a
// "reactivated" alert (an id that was acknowledged but has genuinely
// cleared and re-fired as a new occurrence, per its alertLifecycle.firing
// bookkeeping) so the user sees it as fresh and can re-acknowledge it,
// rather than having it silently stay suppressed forever. Same batched
// read-modify-write shape as updateCompaniesMetadata below, for the same
// reason (avoid racing concurrent single-id writes).
export async function pruneAlertAcknowledgements(id, alertIds) {
  if (!alertIds?.length) return;
  const watchlist = await readWatchlistFile(id);
  const remove = new Set(alertIds);
  watchlist.acknowledgedAlertIds = (watchlist.acknowledgedAlertIds || []).filter(alertId => !remove.has(alertId));
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return watchlist;
}

// Backfills resolved metadata (name/exchange/sector/industry) discovered by
// a real fetch onto company entries that were seeded or added with only a
// symbol -- never invents these fields itself. Takes a batch (symbol ->
// patch) and does exactly one read-modify-write for the whole watchlist:
// research.mjs resolves several companies' metadata concurrently, and N
// independent single-company read-modify-writes would race each other
// (each reads the same pre-write snapshot, so all but the last writer's
// patch is silently lost) -- one batched write avoids that entirely.
export async function updateCompaniesMetadata(id, patchesBySymbol) {
  const entries = Object.entries(patchesBySymbol);
  if (!entries.length) return;
  const watchlist = await readWatchlistFile(id);
  for (const [symbol, patch] of entries) {
    const company = watchlist.companies.find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
    if (company) Object.assign(company, patch);
  }
  watchlist.updatedAt = new Date().toISOString();
  await writeWatchlistFile(watchlist);
  await syncSummary(watchlist);
  return watchlist;
}

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NSE_UNIVERSE } from '../universe/nseUniverse.mjs';

const watchlistsRoot = join(process.cwd(), 'data', 'watchlists');
const cacheRoot = join(process.cwd(), 'data', 'cache', 'companies');

async function readJsonSafe(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

// Folds one candidate record into the running index, keyed by symbol.
// Callers apply candidates in increasing order of authority (static seed ->
// cached fundamentals -> live watchlist entries) so a later, real value
// always overwrites an earlier guess, while fields only the seed carries
// (tier/aliases) survive since later sources simply don't set them.
function mergeInto(bySymbol, entry) {
  const key = entry.symbol.toUpperCase();
  const existing = bySymbol.get(key);
  if (!existing) { bySymbol.set(key, { ...entry }); return; }
  existing.name = entry.name || existing.name;
  existing.exchange = entry.exchange || existing.exchange;
  existing.market = entry.market || existing.market;
  existing.sector = entry.sector || existing.sector;
  existing.industry = entry.industry || existing.industry;
  existing.tier = existing.tier || entry.tier || null;
  if (!existing.aliases?.length && entry.aliases?.length) existing.aliases = entry.aliases;
  existing.inDataUniverse = existing.inDataUniverse || entry.inDataUniverse;
}

// Local, offline search index for the watchlist "Add a company" typeahead --
// merges three sources so autocomplete never needs a network round trip on
// keystroke: (1) the static curated NSE reference (data/universe/
// nseUniverse.mjs) for broad discoverability, (2) every company with cached
// fundamentals (real, sourced classification -- researched at some point,
// on any watchlist or not), (3) every company currently resolved on any
// saved watchlist (also real/sourced, and the freshest). Rebuilt on demand
// (cheap -- tens of small JSON files) rather than cached in memory, since
// it only runs when the frontend explicitly asks for it (once per session /
// after an add), never per keystroke.
export async function buildLocalIndex() {
  const bySymbol = new Map();

  for (const seed of NSE_UNIVERSE) {
    mergeInto(bySymbol, { symbol: seed.symbol, name: seed.name, exchange: 'NSE', market: 'India', sector: seed.sector || null, industry: seed.industry || null, tier: seed.tier || null, aliases: seed.aliases || [], inDataUniverse: false });
  }

  let cacheFiles = [];
  try { cacheFiles = await readdir(cacheRoot); } catch { /* no cache yet */ }
  for (const file of cacheFiles) {
    if (!file.endsWith('.json')) continue;
    const data = await readJsonSafe(join(cacheRoot, file));
    if (!data?.symbol) continue;
    const classification = data.fundamentals?.classification;
    mergeInto(bySymbol, {
      symbol: data.symbol,
      name: data.quote?.longName || data.quote?.shortName || data.symbol,
      exchange: /\.NS$/.test(data.symbol) ? 'NSE' : /\.BO$/.test(data.symbol) ? 'BSE' : null,
      market: data.market || null, sector: classification?.sector || null, industry: classification?.industry || null,
      tier: null, aliases: [], inDataUniverse: true
    });
  }

  let watchlistFiles = [];
  try { watchlistFiles = (await readdir(watchlistsRoot)).filter(f => f.endsWith('.json') && f !== 'index.json'); } catch { /* not seeded yet */ }
  for (const file of watchlistFiles) {
    const data = await readJsonSafe(join(watchlistsRoot, file));
    for (const c of data?.companies || []) {
      if (!c?.symbol) continue;
      mergeInto(bySymbol, { symbol: c.symbol, name: c.name || c.symbol, exchange: c.exchange || null, market: c.market || null, sector: c.sector || null, industry: c.industry || null, tier: null, aliases: [], inDataUniverse: true });
    }
  }

  return [...bySymbol.values()];
}

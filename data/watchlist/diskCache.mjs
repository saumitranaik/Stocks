import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../util.mjs';

const root = join(process.cwd(), 'data', 'cache');
const sanitize = (key) => key.replace(/[^A-Za-z0-9.-]/g, '_');

// Generic persistent JSON cache, one file per key, atomic writes (write
// .tmp then rename) so a crash mid-write can't leave a half-written,
// unparsable cache file. Used for two independent namespaces: per-symbol
// company bundles (quote + fundamentals + news, shared across every
// watchlist that includes that symbol) and per-index benchmark quotes
// (Relative Strength). Not the same thing as data/cache.mjs's in-memory
// TtlCache -- that one dies with the process; this one is what makes
// "cached data on startup" possible at all.
export function makeDiskCache(namespace) {
  const dir = join(root, namespace);
  let ensured = false;
  const ensureDir = async () => { if (!ensured) { await mkdir(dir, { recursive: true }); ensured = true; } };
  const fileFor = (key) => join(dir, `${sanitize(key)}.json`);

  return {
    async read(key) {
      try { return JSON.parse(await readFile(fileFor(key), 'utf8')); }
      catch { return null; }
    },
    async write(key, value) {
      await ensureDir();
      await writeJsonAtomic(fileFor(key), value);
    },
    isStale(bundle, ttlMs) {
      if (!bundle?.fetchedAt) return true;
      return Date.now() - new Date(bundle.fetchedAt).getTime() > ttlMs;
    }
  };
}

export const companyCache = makeDiskCache('companies');
export const benchmarkCache = makeDiskCache('benchmarks');
// Phase 6: one file per macro indicator (USD/INR, US 10Y yield, crude,
// natural gas, gold, India VIX -- see data/providers/macroProvider.mjs),
// fetched independently of any watchlist's own refresh cycle.
export const macroCache = makeDiskCache('macro');

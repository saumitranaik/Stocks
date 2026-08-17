import { makeDiskCache } from './diskCache.mjs';

// Run-over-run snapshot of the decision layer's own derived state
// (recommendation, fair value, risk score, technical regime, relative-
// valuation rank, etc.) -- one JSON file per watchlist under
// data/cache/watchlistSnapshots/. This is what makes "what changed since
// last refresh," alert transitions and portfolio-health trend possible:
// nothing else in this app persists analytics *output* run-over-run (only
// diskCache.mjs's companyCache/benchmarkCache, which store raw fetch
// *inputs*). A company's entry only advances when its own fetchedAt is
// newer than what's already stored -- see data/decision/index.mjs's
// buildPortfolioIntelligence -- so a cache-only page load or watchlist
// switch never clears the diff. The write itself is also skipped entirely
// when nothing advanced (research.mjs only calls .write() when a snapshot
// was actually produced) -- a cache-only render never touches this file.
export const snapshotCache = makeDiskCache('watchlistSnapshots');

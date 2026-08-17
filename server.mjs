import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { clean } from './data/util.mjs';
import { searchCompanies } from './data/watchlist/resolve.mjs';
import { buildLocalIndex } from './data/watchlist/searchIndex.mjs';
import * as store from './data/watchlist/store.mjs';
import { buildResearch } from './data/watchlist/research.mjs';
import { buildCompanyReport } from './data/reporting/researchReport.mjs';
import { buildPortfolioReviewPack } from './data/reporting/portfolioReviewPack.mjs';
import { buildMacroSnapshot } from './data/watchlist/macro.mjs';
import { buildSectorIntelligence } from './data/watchlist/sectorIntelligence.mjs';
import { buildCommitteePack } from './data/reporting/committeePack.mjs';

const port = process.env.PORT || 4173;
const root = process.cwd();
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Malformed JSON body.'); }
}
async function researchFor(id, networkPass, forceSymbols) {
  const watchlist = await store.getWatchlist(id);
  return buildResearch(watchlist, { networkPass, forceSymbols });
}

const routes = [
  { method: 'GET', pattern: /^\/api\/companies\/search$/, handler: async (req, res, m, url) => send(res, 200, { candidates: await searchCompanies(url.searchParams.get('q') || '') }) },
  // Local search index (data/watchlist/searchIndex.mjs): the typeahead's
  // primary data source, fetched once client-side and searched entirely in
  // the browser -- /api/companies/search above is only a fallback for
  // queries the local index comes up short on.
  { method: 'GET', pattern: /^\/api\/companies\/index$/, handler: async (req, res) => send(res, 200, { generatedAt: new Date().toISOString(), companies: await buildLocalIndex() }) },

  // Phase 6 Macro Intelligence: watchlist-independent, cache-first (own 30min
  // TTL -- see data/watchlist/macro.mjs), never triggered by a watchlist's
  // own networkPass. Includes the Market Regime read (data/decision/
  // marketRegime.mjs) since both are market-wide, not per-watchlist.
  { method: 'GET', pattern: /^\/api\/macro$/, handler: async (req, res) => send(res, 200, await buildMacroSnapshot()) },
  // Phase 6 Sector Intelligence: the one cross-watchlist read in this app --
  // cache-only across every saved watchlist (data/watchlist/
  // sectorIntelligence.mjs), never triggers a new fetch.
  { method: 'GET', pattern: /^\/api\/sector-intelligence$/, handler: async (req, res) => send(res, 200, await buildSectorIntelligence()) },

  { method: 'GET', pattern: /^\/api\/watchlists$/, handler: async (req, res) => send(res, 200, await store.listWatchlists()) },
  { method: 'POST', pattern: /^\/api\/watchlists$/, handler: async (req, res) => { const { name } = await readJsonBody(req); const watchlist = await store.createWatchlist(clean(name)); send(res, 201, { watchlist, index: await store.listWatchlists() }); } },
  { method: 'POST', pattern: /^\/api\/watchlists\/active$/, handler: async (req, res) => { const { id } = await readJsonBody(req); const index = await store.setActiveWatchlist(id); send(res, 200, { index, research: await researchFor(id, 'none') }); } },

  { method: 'PUT', pattern: /^\/api\/watchlists\/([^/]+)$/, handler: async (req, res, [, id]) => { const { name } = await readJsonBody(req); const watchlist = await store.renameWatchlist(id, clean(name)); send(res, 200, { watchlist, index: await store.listWatchlists() }); } },
  { method: 'DELETE', pattern: /^\/api\/watchlists\/([^/]+)$/, handler: async (req, res, [, id]) => { const index = await store.deleteWatchlist(id); send(res, 200, { index, research: await researchFor(index.activeWatchlist, 'none') }); } },
  { method: 'POST', pattern: /^\/api\/watchlists\/([^/]+)\/duplicate$/, handler: async (req, res, [, id]) => { const { name } = await readJsonBody(req); const watchlist = await store.duplicateWatchlist(id, clean(name)); send(res, 201, { watchlist, index: await store.listWatchlists() }); } },
  { method: 'GET', pattern: /^\/api\/watchlists\/([^/]+)\/research$/, handler: async (req, res, [, id]) => send(res, 200, await researchFor(id, 'none')) },
  // Institutional research report (Phase 3d): cache-only, same as .../research
  // above -- opening a report never triggers a fetch, it reports on whatever
  // the dashboard already has cached for that company.
  {
    method: 'GET', pattern: /^\/api\/watchlists\/([^/]+)\/report\/([^/]+)$/, handler: async (req, res, [, id, symbol]) => {
      const research = await researchFor(id, 'none');
      const report = await buildCompanyReport(research, decodeURIComponent(symbol));
      send(res, report.error ? 404 : 200, report);
    }
  },
  // Portfolio Review Pack (Phase 5): cache-only, same convention as the
  // per-company report above -- opening the pack never triggers a fetch.
  {
    method: 'GET', pattern: /^\/api\/watchlists\/([^/]+)\/portfolio-review$/, handler: async (req, res, [, id]) => {
      const research = await researchFor(id, 'none');
      send(res, 200, buildPortfolioReviewPack(research));
    }
  },
  // Weekly Investment Committee Pack (Phase 6): cache-only for the watchlist
  // research; macro/sector intelligence are their own cache-first,
  // watchlist-independent builders (may fetch if their own TTL has lapsed,
  // same as opening the Macro/Sector Intelligence dashboard sub-tabs would).
  {
    method: 'GET', pattern: /^\/api\/watchlists\/([^/]+)\/committee-pack$/, handler: async (req, res, [, id]) => {
      const [research, macroSnapshot, sectorIntel] = await Promise.all([researchFor(id, 'none'), buildMacroSnapshot(), buildSectorIntelligence()]);
      send(res, 200, buildCommitteePack(research, macroSnapshot, sectorIntel));
    }
  },
  {
    method: 'POST', pattern: /^\/api\/watchlists\/([^/]+)\/refresh$/, handler: async (req, res, [, id]) => {
      const { force, symbols } = await readJsonBody(req);
      // `symbols` (Watchlists tab's per-company "Refresh" action) force-fetches
      // exactly those companies regardless of staleness while everything else
      // in the watchlist stays cache-only -- a targeted refresh, not a full
      // watchlist refetch. `force` (the header/tab "Refresh Data" button) is
      // unchanged: every company in the watchlist refetches.
      const forceSymbols = Array.isArray(symbols) && symbols.length ? new Set(symbols) : null;
      send(res, 200, await researchFor(id, force ? 'full' : forceSymbols ? 'none' : 'incremental', forceSymbols));
    }
  },
  { method: 'POST', pattern: /^\/api\/watchlists\/import$/, handler: async (req, res) => { const body = await readJsonBody(req); const watchlist = await store.importWatchlist({ name: clean(body.name), companies: body.companies, cashTargetPct: body.cashTargetPct }); send(res, 201, { watchlist, index: await store.listWatchlists(), research: await researchFor(watchlist.id, 'none') }); } },
  { method: 'PUT', pattern: /^\/api\/watchlists\/([^/]+)\/cash-target$/, handler: async (req, res, [, id]) => { const { cashTargetPct } = await readJsonBody(req); await store.setCashTarget(id, Number(cashTargetPct)); send(res, 200, await researchFor(id, 'none')); } },

  {
    method: 'POST', pattern: /^\/api\/watchlists\/([^/]+)\/companies$/, handler: async (req, res, [, id]) => {
      const body = await readJsonBody(req);
      const symbol = clean(body.symbol);
      if (!symbol) throw new Error('A company symbol is required.');
      const result = await store.addCompany(id, { symbol, name: clean(body.name), exchange: clean(body.exchange) || null, market: clean(body.market) || null, sector: clean(body.sector) || null, industry: clean(body.industry) || null });
      // 200, not 409: this is an expected, handled outcome (the frontend
      // branches on the `duplicate` field), not an error -- a 4xx here
      // would just show up as a spurious "failed to load resource" in
      // devtools for something that isn't actually a failure.
      if (result.duplicate) { send(res, 200, { duplicate: result.duplicate, research: await researchFor(id, 'none') }); return; }
      send(res, 201, await researchFor(id, 'incremental'));
    }
  },
  { method: 'DELETE', pattern: /^\/api\/watchlists\/([^/]+)\/companies\/([^/]+)$/, handler: async (req, res, [, id, symbol]) => { await store.removeCompany(id, decodeURIComponent(symbol)); send(res, 200, await researchFor(id, 'none')); } },
  { method: 'PUT', pattern: /^\/api\/watchlists\/([^/]+)\/companies\/order$/, handler: async (req, res, [, id]) => { const { order } = await readJsonBody(req); await store.reorderCompanies(id, Array.isArray(order) ? order : []); send(res, 200, await researchFor(id, 'none')); } },
  { method: 'PUT', pattern: /^\/api\/watchlists\/([^/]+)\/companies\/([^/]+)\/weight$/, handler: async (req, res, [, id, symbol]) => { const { weightPct } = await readJsonBody(req); await store.setCompanyWeight(id, decodeURIComponent(symbol), Number.isFinite(weightPct) ? Number(weightPct) : null); send(res, 200, await researchFor(id, 'none')); } },
  { method: 'PUT', pattern: /^\/api\/watchlists\/([^/]+)\/companies\/([^/]+)\/notes$/, handler: async (req, res, [, id, symbol]) => { const { notes } = await readJsonBody(req); await store.setCompanyNotes(id, decodeURIComponent(symbol), clean(notes)); send(res, 200, await researchFor(id, 'none')); } },
  // Phase 4 decision layer: acknowledge/unacknowledge one alert (id shape
  // `${symbol}|${type}`, see data/decision/alerts.mjs) -- same mutate-then-
  // return-fresh-payload shape as every other mutation route above.
  { method: 'PUT', pattern: /^\/api\/watchlists\/([^/]+)\/alerts\/([^/]+)$/, handler: async (req, res, [, id, alertId]) => { const { acknowledged } = await readJsonBody(req); await store.setAlertAcknowledged(id, decodeURIComponent(alertId), !!acknowledged); send(res, 200, await researchFor(id, 'none')); } }
];

await store.init();

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const route = routes.find(r => r.method === req.method && r.pattern.test(url.pathname));
    if (!route) { send(res, 404, { error: 'Unknown API route.' }); return; }
    try { await route.handler(req, res, url.pathname.match(route.pattern), url); }
    catch (error) { send(res, error.message?.includes('required') ? 400 : 502, { error: error.message || 'Request failed.' }); }
    return;
  }
  const safePath = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^([.][.][\\/])+/, '');
  try { const file = await readFile(join(root, safePath)); res.writeHead(200, { 'content-type': mime[extname(safePath)] || 'application/octet-stream' }); res.end(file); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`Watchlist Research Workspace: http://localhost:${port}`));

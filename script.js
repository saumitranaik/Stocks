const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const fmt = (value) => value == null || !Number.isFinite(value) ? '' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
const pct = (value) => value == null || !Number.isFinite(value) ? '' : `${value >= 0 ? '+' : ''}${fmt(value)}%`;
const compact = (value) => value == null || !Number.isFinite(value) ? '' : new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const suffixed = (value, suffix) => value == null || !Number.isFinite(value) ? '' : `${fmt(value)}${suffix}`;
// Blank is this app's one missing-data convention everywhere a value is
// displayed -- the string "N/A" is still the internal sentinel several backend modules
// return (see data/analytics, data/decision, data/scoring), so escape()
// blanks it out here at the one point almost every displayed string passes
// through, rather than changing the backend's data contract.
const escape = (value) => { const str = String(value ?? ''); return str === 'N/A' ? '' : str.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); };
const card = (title, value, note, className = '') => `<article class="card"><h3>${title}</h3><div class="kpi ${className}">${value}</div><div class="small">${note}</div></article>`;
// Rating is computed once, server-side (data/scoring), from the same
// 12-factor institutional model every table on this page already reflects
// -- the frontend only renders it, so there is a single source of truth
// instead of duplicating rating thresholds here.
const RATING_CLASS = { 'Strong Buy': 'strong-buy', Buy: 'buy', Accumulate: 'accumulate', Hold: 'hold', Reduce: 'reduce', Sell: 'sell' };
const tagClass = (text) => RATING_CLASS[text] || 'neutral';
const signalTag = (stock) => `<span class="tag tag-lg ${tagClass(stock.signal)}">${escape(stock.signal)}</span>`;

// -- Phase 4 decision layer (payload.intelligence, data/decision/*.mjs): the
// frontend only formats what the backend already computed -- no score,
// threshold or band is invented here. Action-band and alert-severity colors
// reuse the existing rating tag palette rather than introducing new ones.
const ACTION_TAG_CLASS = { 'Add aggressively': 'strong-buy', Add: 'buy', Hold: 'hold', Reduce: 'reduce', Exit: 'sell' };
const SEVERITY_TAG_CLASS = { Critical: 'sell', High: 'reduce', Medium: 'hold', Low: 'neutral' };
// Mirrors data/decision/alerts.mjs's TRANSITION_ALERT_RULES.technicalRegime
// breakout regime set, for the Watchlists "Technical breakout" filter chip.
const BREAKOUT_REGIMES = ['Volatile Breakout', 'Strong Uptrend'];
const companyLink = (symbol, name) => `<button type="button" class="row-company-link" data-symbol="${escape(symbol)}">${escape(name)}</button>`;
// Native-tooltip explainability for an Action Score cell -- the per-instance
// bucket contributions (quality/valuation/technical/risk/relative
// positioning/portfolio fit), all already computed server-side
// (data/decision/actionScore.mjs); infoIcon('actionScore') carries the
// general methodology text from the metric registry alongside this.
function actionScoreTitle(action) {
  if (!action) return '';
  const c = action.components || {};
  const part = (label, key) => `${label} ${c[key] == null ? '' : c[key]}`;
  const base = [part('Quality', 'quality'), part('Valuation', 'valuation'), part('Technical', 'technical'), part('Risk', 'risk'), part('Relative positioning', 'relativePositioning'), part('Portfolio fit', 'portfolioFit')].join(' | ');
  // Stage 3: when actionScore.mjs's resolved-coverage cap applied, say so --
  // otherwise a capped "Hold" reads as an ordinary score instead of a
  // disclosed low-coverage cap (mirrors recommendation.capNote's convention).
  return action.capNote ? `${base} | ${action.capNote}` : base;
}
function actionScoreBadge(action) {
  if (!action) return '';
  return `<span class="tag ${ACTION_TAG_CLASS[action.label] || 'neutral'}" title="${escape(actionScoreTitle(action))}">${escape(action.label)}</span>`;
}
const fairValueGapCell = (stock) => pct(stock.valuation?.marginOfSafetyPct);

// -- Shared table standard: every comparison table on this page leads with
// Company, Sector, CMP and P/E in that order (institutional mandate). No
// table computes its own leading cells or re-sorts/truncates the rows it's
// given -- rows are always exactly the watchlist's own companies, in the
// watchlist's own order; the Recommendation tag lives on the Dashboard's
// Top Opportunities table instead of every table, per the current column
// spec (a deliberate change from the previous phase's every-table tag).
// Name cell is a button (`.row-company-link`) rather than plain text so every
// table built off this helper -- Valuation, Profitability, Balance sheet,
// Growth, Ownership, Technicals, Risk, Portfolio -- gets click-to-select for
// free from the one delegated listener in the Company context section below.
const prefixCells = (stock, opts = {}) => `<td><button type="button" class="row-company-link" data-symbol="${escape(stock.symbol)}">${escape(stock.name)}</button></td><td>${escape(stock.sector || '')}</td><td${opts.num ? ' class="num"' : ''}>${fmt(stock.price)} ${escape(stock.currency || '')}</td><td${opts.num ? ' class="num"' : ''}>${fmt(stock.pe)}</td>`;
function renderTable(selector, stocks, rowFn, opts) {
  $(`${selector} tbody`).innerHTML = stocks.length
    ? stocks.map((stock, index) => `<tr data-symbol="${escape(stock.symbol)}">${prefixCells(stock, opts)}${rowFn(stock, index)}</tr>`).join('')
    : `<tr><td colspan="20" class="small">This watchlist is empty.</td></tr>`;
}

// ---- Comparison-table column sorting (Watchlist Research): click a
// `th[data-sort]` header to sort ascending, click again for descending, a
// third click returns to the watchlist's own natural order. N/A always
// sorts to the bottom regardless of direction, matching the Watchlists tab's
// own `wlFilteredSortedStocks` convention (never mutates the canonical
// `data.stocks` array -- always sorts a copy). One shared implementation
// instead of a per-table copy; each table just supplies its own column ->
// value-accessor map (`keyFns`), keyed by the same string as that column's
// `data-sort` attribute in index.html. ----
let cmpSortState = {}; // { [tableId]: { column, dir } }
function isSortNA(value) {
  return value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value)) || value === 'N/A';
}
function sortForTable(tableId, stocks, keyFns) {
  const state = cmpSortState[tableId];
  if (!state?.column || !keyFns[state.column]) return stocks;
  const keyFn = keyFns[state.column];
  const dir = state.dir === 'desc' ? -1 : 1;
  return [...stocks].sort((a, b) => {
    const va = keyFn(a), vb = keyFn(b);
    const aNA = isSortNA(va), bNA = isSortNA(vb);
    if (aNA && bNA) return 0;
    if (aNA) return 1;
    if (bNA) return -1;
    return typeof va === 'string' || typeof vb === 'string' ? dir * String(va).localeCompare(String(vb)) : dir * (va - vb);
  });
}
function applySortIndicators(tableId) {
  const state = cmpSortState[tableId];
  $$(`#${tableId} thead th[data-sort]`).forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (state?.column && th.dataset.sort === state.column) th.classList.add(state.dir === 'desc' ? 'sorted-desc' : 'sorted-asc');
  });
}
// Binds the click handler once per table (guarded by a dataset flag, since
// render*() functions re-run on every data refresh but the <thead> itself is
// static markup, never replaced). Clicking re-renders the whole page off
// currentData, same pattern every other mutation in this app already uses
// (e.g. setOpportunitiesSort) -- simpler than threading a per-table redraw
// callback through, and cheap: this is pure DOM formatting over already-
// fetched data, no network round-trip.
function initTableSort(tableId) {
  const thead = $(`#${tableId} thead`);
  if (!thead || thead.dataset.sortBound) { applySortIndicators(tableId); return; }
  thead.dataset.sortBound = '1';
  thead.addEventListener('click', (event) => {
    const th = event.target.closest('th[data-sort]');
    if (!th) return;
    const state = cmpSortState[tableId] || (cmpSortState[tableId] = { column: null, dir: 'asc' });
    if (state.column === th.dataset.sort) {
      if (state.dir === 'asc') state.dir = 'desc';
      else { state.column = null; state.dir = 'asc'; }
    } else { state.column = th.dataset.sort; state.dir = 'asc'; }
    if (currentData) render(currentData);
  });
  applySortIndicators(tableId);
}
// Convenience wrapper for the common case: sort stocks for tableId, render
// through the given rowFn (same signature as renderTable), then wire/refresh
// the header's sort affordance. keyFns should include the standard
// Company/Sector/CMP/P/E leading columns (data-sort="company"/"sector"/
// "cmp"/"pe") plus one entry per table-specific column.
function renderSortableTable(tableId, stocks, keyFns, rowFn, opts) {
  renderTable(`#${tableId}`, sortForTable(tableId, stocks, keyFns), rowFn, opts);
  initTableSort(tableId);
}
const STANDARD_SORT_KEYS = { company: s => s.name, sector: s => s.sector || null, cmp: s => s.price, pe: s => s.pe };

// ---- Floating sticky table headers -- the deliberate exception for panels
// that mix a table with other content (KPI cards, notes, a second card).
// Bounded viewport shell (2026-09-05): most single-table panels now get a
// REAL `position:sticky` header instead (styles.css's `.sticky-thead-native`,
// paired with `.card-table-fill` giving that table's own `.scroll` wrapper
// the panel's whole bounded scroll box -- see the .tab/.subtab-root/
// .subsection/.card-table-fill rules). This clone mechanism remains only for
// tables sharing a scroll region with sibling content (e.g. Dashboard's
// Action Required table alongside its KPI grid, Portfolio's rebalancing/
// exposure tables alongside notes cards, Watchlists' company table
// alongside the summary/manage cards) -- native `position:sticky`
// cannot satisfy "sticky header relative to an ancestor further out than the
// table's own horizontal-scroll wrapper" (csswg-drafts #865: sticky is
// defeated by ANY intermediate ancestor with non-visible overflow, confirmed
// with a from-scratch repro in an earlier pass of this app), and bounding
// the table's own wrapper instead would reintroduce a second scrollbar on an
// already-scrolling panel.
//
// The clone is rebuilt from the real header's current markup + rendered
// column widths every time it's (re)shown, never hand-maintained, so it can
// never drift out of sync with a sort/re-render. Column widths are copied
// pixel-for-pixel from the real `<th>` cells (table-layout:fixed on the
// clone). Horizontal scroll syncs via `transform: translateX()` mirroring
// the real `.scroll` container's own `scrollLeft` -- no second horizontal
// scrollbar.
//
// Positioning: each table's real scrolling ancestor (the nearest
// `.subsection`/`.scroll-body` that actually owns vertical scroll, found by
// walking up the DOM once at init) is now a genuinely bounded box -- its own
// `getBoundingClientRect().top` *is* the correct "stick to here" offset, no
// CSS-var pixel-height bookkeeping needed. The clone shows once the real
// header scrolls above that offset and the table's rows still extend below
// it, and is repositioned on that ancestor's own `scroll` event (not
// `window`'s -- the window/document no longer scrolls on desktop).
//
// Accessibility: the clone lives in a wrapper marked `aria-hidden="true"`
// (screen readers never see it -- the one real, fully-labeled table is the
// only thing AT encounters) with every cell `tabIndex=-1`. A click on a
// clone header cell replays as a real click on the corresponding real `<th>`
// at the same column index, so `initTableSort`'s existing delegated listener
// -- and everything that follows from it (sort state, the full
// render(currentData) re-render) -- is the only place sort state actually
// lives. ----
let floatingHeaders = []; // [{ table, wrapper, cloneTable, scrollAncestor }]
function nearestOwnScrollAncestor(el) {
  // Walks up past pass-through wrappers (a `.subsection` that only hosts a
  // nested `.subtab-root`, or a `.card-table-fill` -- both `overflow-y:hidden`
  // in styles.css) to the element that actually owns vertical scroll for
  // this table. Falls back to `#main` (the outermost bounded viewport) if
  // none is found.
  let node = el.parentElement;
  while (node && node !== document.body) {
    if ((node.matches('.subsection,.scroll-body')) && getComputedStyle(node).overflowY === 'auto') return node;
    node = node.parentElement;
  }
  return $('#main');
}
function rebuildFloatingHeaderContent(entry) {
  const { table, cloneTable } = entry;
  if (table.offsetParent === null) return; // hidden (inactive subtab) -- rebuilt fresh once shown again
  const realThead = table.querySelector('thead');
  if (!realThead) return;
  cloneTable.innerHTML = '';
  cloneTable.className = table.className;
  const theadClone = realThead.cloneNode(true);
  // Most sticky-header tables have plain-text <th> cells, but #wl-table's
  // first header cell holds a real <input id="wl-select-all"> (bulk-select
  // checkbox) -- cloneNode(true) would duplicate that id into this aria-
  // hidden clone. Strip every id from the clone defensively so no future
  // sticky table with an id'd header control can reintroduce a duplicate.
  theadClone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  cloneTable.appendChild(theadClone);
  cloneTable.style.tableLayout = 'fixed';
  cloneTable.style.width = `${table.scrollWidth}px`;
  const realThs = $$('th', realThead);
  const cloneThs = $$('th', theadClone);
  realThs.forEach((th, i) => {
    if (!cloneThs[i]) return;
    cloneThs[i].style.width = `${th.getBoundingClientRect().width}px`;
    cloneThs[i].style.boxSizing = 'border-box';
    cloneThs[i].tabIndex = -1;
  });
}
function updateFloatingHeaderPosition(entry) {
  const { table, wrapper, cloneTable, scrollAncestor } = entry;
  const scrollBox = table.closest('.scroll');
  if (!scrollBox || table.offsetParent === null) { wrapper.classList.remove('visible'); return; }
  const realThead = table.querySelector('thead');
  const offset = Math.max(0, scrollAncestor.getBoundingClientRect().top);
  const theadRect = realThead.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const shouldShow = theadRect.top < offset && tableRect.bottom > offset + theadRect.height;
  wrapper.classList.toggle('visible', shouldShow);
  if (!shouldShow) return;
  const clipRect = scrollBox.getBoundingClientRect();
  wrapper.style.top = `${offset}px`;
  wrapper.style.left = `${clipRect.left}px`;
  wrapper.style.width = `${clipRect.width}px`;
  cloneTable.style.transform = `translateX(${-scrollBox.scrollLeft}px)`;
}
// Rebuilds every registered table's clone header content + position -- called
// wherever page layout/data can have changed underneath a floating header
// (see syncHeaderHeight()'s and applySubtabState()'s own calls into this).
function refreshFloatingHeaders() {
  floatingHeaders.forEach(entry => { rebuildFloatingHeaderContent(entry); updateFloatingHeaderPosition(entry); });
}
function initFloatingHeaders() {
  // .sticky-thead-native tables (see styles.css) are deliberately excluded --
  // they get a real position:sticky header, no clone.
  $$('table[class*="thead-sticky-"]').forEach(table => {
    const wrapper = document.createElement('div');
    wrapper.className = 'floating-thead';
    wrapper.setAttribute('aria-hidden', 'true');
    const cloneTable = document.createElement('table');
    wrapper.appendChild(cloneTable);
    document.body.appendChild(wrapper);
    wrapper.addEventListener('click', (event) => {
      const th = event.target.closest('th');
      if (!th) return;
      const index = $$('th', th.parentElement).indexOf(th);
      $$('thead th', table)[index]?.click();
    });
    const scrollAncestor = nearestOwnScrollAncestor(table);
    const entry = { table, wrapper, cloneTable, scrollAncestor };
    floatingHeaders.push(entry);
    table.closest('.scroll')?.addEventListener('scroll', () => updateFloatingHeaderPosition(entry), { passive: true });
    scrollAncestor.addEventListener('scroll', () => updateFloatingHeaderPosition(entry), { passive: true });
  });
}
initFloatingHeaders();
let floatingHeaderTicking = false;
function scheduleFloatingHeaderUpdate() {
  if (floatingHeaderTicking) return;
  floatingHeaderTicking = true;
  requestAnimationFrame(() => { floatingHeaderTicking = false; floatingHeaders.forEach(updateFloatingHeaderPosition); });
}
window.addEventListener('resize', scheduleFloatingHeaderUpdate);
// Below the 900px breakpoint the shell reverts to normal document scroll
// (styles.css's `@media(max-width:900px)` block) -- window/document IS the
// scrolling element there, so this listener is the mobile fallback; on
// desktop window never scrolls, so it simply never fires.
window.addEventListener('scroll', scheduleFloatingHeaderUpdate, { passive: true });

let watchlistIndex = null;
let currentData = null;
let opportunitiesSort = 'recommendation';
// Declared here (ahead of initSubtabs()'s eager top-level call below, and
// the sidebar's own restore-last-tab call, both of which can reach
// recaptureVisibleTableLayouts() before the script has finished executing
// top to bottom) so it's never read from its temporal dead zone. The actual
// generic table-layout engine (initTableLayout and friends) is defined
// further down, near where it replaced Watchlist Research -> Overview's
// original table-only implementation -- only this variable's *declaration*
// needs to be this early, since function declarations are hoisted already.
let tableLayouts = {}; // { [tableId]: { order, widths, defaultOrder, defaultWidths } }
const avgOf = (values) => { const v = values.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

// ---- Watchlists tab state: sort/filter/search/multi-select, all client-side
// over the same currentData.stocks array every other tab reads -- this tab
// never re-sorts or mutates that canonical array either. Reset whenever the
// active watchlist itself changes (tracked by wlLastWatchlistId), preserved
// across incremental background refreshes of the same watchlist. ----
let wlLastWatchlistId = null, wlSortColumn = null, wlSortDir = 'asc';
let wlFilterSector = '', wlFilterRecommendation = '', wlSearchQuery = '';
let wlSelected = new Set();
// Phase 4: Watchlists tab's monitoring filter chips (Add aggressively/Add/
// Hold/Reduce/Exit/High risk/High upside/Technical breakout/Recent changes)
// -- multiple chips OR together, same reset-on-watchlist-switch lifecycle as
// wlSelected/wlSortColumn above.
let wlIntelFilters = new Set();

// ---- Watchlists -> Custom: a user-configurable comparison table (field
// selector + sortable + resizable columns), sharing the same filtered/
// searched stock set as the All companies tab (wlFilteredSortedStocks) --
// no separate filter UI, no duplicate filter state. Every field below reads
// a value data/watchlist/research.mjs already computes; zero new calculation,
// zero new metricRegistry.mjs entry needed. Company/Sector/CMP/P/E are the
// same locked prefix every comparison table in this app leads with
// (prefixCells()/STANDARD_SORT_KEYS) -- not part of the field selector.
const WL_CUSTOM_FIELDS = [
  { id: 'debtToEquity', label: 'Debt / Equity', sortKey: s => s.metrics?.debtToEquity, cell: s => pct(s.metrics?.debtToEquity) },
  { id: 'roe', label: 'ROE', sortKey: s => s.roe, cell: s => pct(s.roe) },
  { id: 'roce', label: 'ROCE', sortKey: s => s.roce, cell: s => pct(s.roce) },
  { id: 'ebitdaMargin', label: 'EBITDA margin', sortKey: s => s.metrics?.ebitdaMargin, cell: s => pct(s.metrics?.ebitdaMargin) },
  // Screener.in's Operating Profit is the only margin line this data source
  // exposes (no separate D&A add-back) -- Operating margin reads the same
  // figure as EBITDA margin, same disclosed limitation as Watchlist Research
  // -> Fundamentals -> Profitability's own "EBITDA margin and operating
  // margin show the same reported figure" note.
  { id: 'operatingMargin', label: 'Operating margin', sortKey: s => s.metrics?.ebitdaMargin, cell: s => pct(s.metrics?.ebitdaMargin) },
  { id: 'netMargin', label: 'Net margin', sortKey: s => s.metrics?.netMargin, cell: s => pct(s.metrics?.netMargin) },
  { id: 'earningsYield', label: 'Earnings yield', sortKey: s => s.earningsYield, cell: s => pct(s.earningsYield) },
  { id: 'fcfYield', label: 'FCF yield', sortKey: s => s.fcfYield, cell: s => pct(s.fcfYield) },
  { id: 'promoterHolding', label: 'Promoter holding', sortKey: s => s.metrics?.promoterHolding, cell: s => pct(s.metrics?.promoterHolding) },
  { id: 'fiiHolding', label: 'FII holding', sortKey: s => s.metrics?.fiiHolding, cell: s => pct(s.metrics?.fiiHolding) },
  { id: 'diiHolding', label: 'DII holding', sortKey: s => s.metrics?.diiHolding, cell: s => pct(s.metrics?.diiHolding) },
  { id: 'revenueGrowth5y', label: 'Revenue growth 5Y', sortKey: s => s.metrics?.revenueCagr5y, cell: s => pct(s.metrics?.revenueCagr5y) },
  { id: 'ebitdaGrowth5y', label: 'EBITDA growth 5Y', sortKey: s => s.metrics?.ebitdaCagr5y, cell: s => pct(s.metrics?.ebitdaCagr5y) },
  { id: 'profitGrowth5y', label: 'Profit growth 5Y', sortKey: s => s.metrics?.profitCagr5y, cell: s => pct(s.metrics?.profitCagr5y) },
  { id: 'cagr5y', label: '5Y CAGR (price)', sortKey: s => s.performance?.cagr?.['5Y']?.stockCagrPct, cell: s => pct(s.performance?.cagr?.['5Y']?.stockCagrPct) },
  { id: 'rsi', label: 'RSI (14)', sortKey: s => s.rsi, cell: s => fmt(s.rsi) },
  // Same derived count-above-DMA reused from the Watchlist Research Trend
  // table (TREND_TABLE_SORT.dmaAlignment/dmaAlignmentLabel) -- not a new
  // calculation, the same client-side arithmetic on already-fetched DMAs.
  { id: 'dmaAlignment', label: 'DMA alignment', sortKey: s => { const dmas = [s.twenty, s.fifty, s.hundred, s.twoHundred]; return Number.isFinite(s.price) ? dmas.filter(d => Number.isFinite(d) && s.price > d).length : null; }, cell: s => dmaAlignmentLabel(s) },
  { id: 'adx', label: 'ADX', sortKey: s => s.technicalScorecard?.adx, cell: s => fmt(s.technicalScorecard?.adx) },
  { id: 'diPlus', label: 'DI+', sortKey: s => s.technicalScorecard?.diPlus, cell: s => fmt(s.technicalScorecard?.diPlus) },
  { id: 'diMinus', label: 'DI-', sortKey: s => s.technicalScorecard?.diMinus, cell: s => fmt(s.technicalScorecard?.diMinus) }
];
const WL_CUSTOM_SORT_KEYS = { ...STANDARD_SORT_KEYS, ...Object.fromEntries(WL_CUSTOM_FIELDS.map(f => [f.id, f.sortKey])) };
const WL_CUSTOM_PREFIX = [
  { id: 'company', label: 'Company' },
  { id: 'sector', label: 'Sector' },
  { id: 'cmp', label: 'CMP (Rs.)' },
  { id: 'pe', label: 'P/E' }
];
// Column order/width for this table are now owned by the generic
// initTableLayout engine (stocksApp.tableLayout.wl-custom-table.v1) -- only
// which OPTIONAL fields are shown stays a bespoke concern here, since that's
// not something the generic engine (which only reorders/resizes/persists
// whatever <th data-sort> elements already exist) models.
const WL_CUSTOM_FIELDS_KEY = 'wlCustomFields';
let wlCustomVisibleFields = new Set(WL_CUSTOM_FIELDS.map(f => f.id)); // default: every optional column shown
try {
  const savedFields = JSON.parse(localStorage.getItem(WL_CUSTOM_FIELDS_KEY) || 'null');
  if (Array.isArray(savedFields)) wlCustomVisibleFields = new Set(savedFields.filter(id => WL_CUSTOM_FIELDS.some(f => f.id === id)));
} catch { /* storage unavailable -- defaults to every column shown */ }
function saveWlCustomFields() {
  try { localStorage.setItem(WL_CUSTOM_FIELDS_KEY, JSON.stringify([...wlCustomVisibleFields])); } catch { /* storage unavailable -- selection just won't survive a reload */ }
}
// One-time migration: this table's column widths used to live under their
// own dedicated key, width-only, before column layout was generalized to
// every table -- migrate a real user's already-saved widths into the new
// shared per-table key scheme (as a widths-only layout; order falls back to
// default) so they aren't silently lost by this refactor.
(function migrateWlCustomWidthsKey() {
  const newKey = tableLayoutStorageKey('wl-custom-table');
  if (localStorage.getItem(newKey)) return;
  try {
    const legacyWidths = JSON.parse(localStorage.getItem('wlCustomColWidths') || 'null');
    if (legacyWidths && typeof legacyWidths === 'object') {
      localStorage.setItem(newKey, JSON.stringify({ version: 1, order: [], widths: legacyWidths }));
      localStorage.removeItem('wlCustomColWidths');
    }
  } catch { /* no legacy data, or storage unavailable -- nothing to migrate */ }
})();
// Toolbar/popover state (redesign, 2026-09-23): the field-visibility list
// used to render as a permanently-visible checkbox panel above the table;
// it's now a compact "Columns N/total" button opening a searchable popover,
// per the same info-icon/popover component the rest of the app already uses
// for tooltips (helpIcon()/infoIcon()). Search filters WL_CUSTOM_FIELDS by
// label only -- it never touches wlCustomVisibleFields or the table itself.
let wlCustomFieldSearch = '';
function updateWlCustomColumnsCount() {
  const total = WL_CUSTOM_FIELDS.length, visible = wlCustomVisibleFields.size;
  $('#wl-custom-columns-count').textContent = `${visible}/${total}`;
  $('#wl-custom-columns-count-popover').textContent = `${visible} / ${total}`;
  $('#wl-custom-columns-total').textContent = `${WL_CUSTOM_PREFIX.length + total} columns`;
}
function renderWlCustomFieldSelector() {
  const query = wlCustomFieldSearch.trim().toLowerCase();
  const fields = query ? WL_CUSTOM_FIELDS.filter(f => f.label.toLowerCase().includes(query)) : WL_CUSTOM_FIELDS;
  $('#wl-custom-field-selector').innerHTML = fields.length
    ? fields.map(f => `<label class="columns-item"><input type="checkbox" data-field-toggle="${f.id}" ${wlCustomVisibleFields.has(f.id) ? 'checked' : ''}><span>${escape(f.label)}</span></label>`).join('')
    : `<p class="small columns-empty">No columns match "${escape(wlCustomFieldSearch)}".</p>`;
  updateWlCustomColumnsCount();
}
$('#wl-custom-field-selector').addEventListener('change', (event) => {
  const input = event.target.closest('input[data-field-toggle]');
  if (!input) return;
  if (input.checked) wlCustomVisibleFields.add(input.dataset.fieldToggle); else wlCustomVisibleFields.delete(input.dataset.fieldToggle);
  saveWlCustomFields();
  updateWlCustomColumnsCount();
  if (currentData) render(currentData);
});
$('#wl-custom-columns-search').addEventListener('input', (event) => {
  wlCustomFieldSearch = event.target.value;
  renderWlCustomFieldSelector();
});
// Company/Sector/CMP/P/E (WL_CUSTOM_PREFIX) are never part of WL_CUSTOM_FIELDS
// at all -- they're the locked prefix every comparison table in this app
// leads with -- so Select all/Clear all (which only ever touch
// wlCustomVisibleFields) can never hide every column: the 4 locked ones
// always remain, satisfying the "never an empty table" requirement by
// construction rather than a separate minimum-columns check.
$('#wl-custom-select-all').addEventListener('click', () => {
  wlCustomVisibleFields = new Set(WL_CUSTOM_FIELDS.map(f => f.id));
  saveWlCustomFields();
  renderWlCustomFieldSelector();
  if (currentData) render(currentData);
});
$('#wl-custom-clear-all').addEventListener('click', () => {
  wlCustomVisibleFields = new Set();
  saveWlCustomFields();
  renderWlCustomFieldSelector();
  if (currentData) render(currentData);
});
// Resets the field-visibility half of "Reset layout" -- the column order/
// width half is the pre-existing generic initTableLayout(resetButtonId)
// listener bound to this same button id from renderWlCustomTable(), so a
// single click fires both and restores the complete default configuration.
$('#wl-custom-reset-columns').addEventListener('click', () => {
  wlCustomVisibleFields = new Set(WL_CUSTOM_FIELDS.map(f => f.id));
  saveWlCustomFields();
  wlCustomFieldSearch = '';
  $('#wl-custom-columns-search').value = '';
  renderWlCustomFieldSelector();
  if (currentData) render(currentData);
});
// Default anchor is bottom-left of the Columns button (CSS .columns-popover).
// That can clip off-screen once the popover got wider (300px -> 400px), so on
// each open we measure the real rendered position and flip right/above via
// these two modifier classes -- CSS alone has no way to know the button's
// on-screen position.
function positionWlCustomColumnsPopover() {
  const popover = $('#wl-custom-columns-popover');
  const btn = $('#wl-custom-columns-btn');
  popover.classList.remove('align-right', 'align-above');
  const btnRect = btn.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  // Flip left<->right / above<->below only when doing so genuinely helps --
  // i.e. there's more room on the other side -- otherwise flipping trades a
  // small, scrollable overflow for a worse, more-clipped one (confirmed live:
  // a naive "flip if it overflows" flipped the popover fully off the left
  // edge on a narrow viewport where right-aligning overflowed further left
  // than the original state overflowed right).
  const spaceRight = window.innerWidth - btnRect.left;
  const spaceLeft = btnRect.right;
  if (rect.right > window.innerWidth && spaceLeft > spaceRight) popover.classList.add('align-right');
  const spaceBelow = window.innerHeight - btnRect.bottom;
  const spaceAbove = btnRect.top;
  if (rect.bottom > window.innerHeight && spaceAbove > spaceBelow) popover.classList.add('align-above');
}
function toggleWlCustomColumnsPopover(show) {
  const popover = $('#wl-custom-columns-popover');
  const btn = $('#wl-custom-columns-btn');
  const shouldShow = show ?? popover.hidden;
  popover.hidden = !shouldShow;
  btn.setAttribute('aria-expanded', String(shouldShow));
  if (shouldShow) {
    positionWlCustomColumnsPopover();
    $('#wl-custom-columns-search').focus();
  }
}
$('#wl-custom-columns-btn').addEventListener('click', (event) => {
  event.stopPropagation();
  toggleWlCustomColumnsPopover();
});
// Click-outside/Escape-to-close, matching the popover-dismissal convention
// every dropdown in this app already uses. Checking/unchecking a column
// deliberately does NOT close the popover (no listener here reacts to the
// field-selector's own change event), so multiple columns can be toggled in
// one open/close cycle per the redesign's own explicit requirement.
document.addEventListener('click', (event) => {
  const popover = $('#wl-custom-columns-popover');
  if (popover.hidden) return;
  if (event.target.closest('#wl-custom-columns-popover') || event.target.closest('#wl-custom-columns-btn')) return;
  toggleWlCustomColumnsPopover(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') toggleWlCustomColumnsPopover(false);
});
renderWlCustomFieldSelector();
// Drag-to-resize: bound fresh after every render (the <thead> is rebuilt via
// innerHTML each time, same as every other table in this app), so there's
// never a stale listener on a removed element. click's own stopPropagation
// keeps a plain click on the handle from also registering as a sort click on
// initTableSort's delegated <thead> listener.
// Generic drag-to-resize driver for any table using the .col-resize-handle
// pattern (originally Watchlists -> Custom only; reused as-is by Watchlist
// Research -> Overview below) -- one shared pointer-event implementation
// instead of a per-table copy. Each caller keeps its own width state/
// localStorage key; onResize(key, widthPx) is just told the result once a
// drag ends. click's own stopPropagation keeps a plain click on the handle
// from also registering as a sort click on initTableSort's delegated
// <thead> listener.
function initTableColumnResize(tableId, onResize) {
  $$(`#${tableId} thead th[data-sort]`).forEach(th => {
    const handle = th.querySelector('.col-resize-handle');
    // Per-handle guard (not a one-time-per-table guard): safe to call this
    // on every render. Most tables' <thead> is static markup whose handles
    // persist forever, so this is a cheap no-op after the first call: but
    // wl-custom-table's <thead> is fully regenerated (innerHTML) on every
    // render, producing brand-new handle elements each time that still need
    // binding -- a table-level "bound once" flag would silently leave those
    // fresh handles inert after the first render.
    if (!handle || handle.dataset.resizeBound) return;
    handle.dataset.resizeBound = '1';
    handle.addEventListener('click', event => event.stopPropagation());
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = th.dataset.sort;
      const startX = event.clientX, startWidth = th.getBoundingClientRect().width;
      // A multi-row thead's real rendered width is governed by the
      // <colgroup>'s <col> (see ensureColgroup/applyTableColumnWidths above),
      // not by this th's own style.width -- kept live in sync here too, or
      // the drag would visually do nothing until the next reload/rebind.
      const col = $(`#${tableId} colgroup col[data-col-id="${key}"]`);
      const onMove = (moveEvent) => {
        const width = `${Math.max(60, Math.round(startWidth + (moveEvent.clientX - startX)))}px`;
        th.style.width = width;
        if (col) col.style.width = width;
      };
      const onUp = () => {
        onResize(key, parseInt(th.style.width, 10));
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });
}
function renderWlCustomTable(data) {
  // Same filtered/searched stock set as the All companies tab -- this view
  // doesn't duplicate filter state, only adds its own independent column sort
  // (cmpSortState['wl-custom-table'], via the shared sortForTable/
  // initTableSort mechanism every Watchlist Research table already uses).
  const stocks = sortForTable('wl-custom-table', wlFilteredSortedStocks(data), WL_CUSTOM_SORT_KEYS);
  const visibleFields = WL_CUSTOM_FIELDS.filter(f => wlCustomVisibleFields.has(f.id));
  // Every optional field here is a calculated ratio/CAGR/indicator (see
  // WL_CUSTOM_FIELDS above) -- derived, per the same fetched-vs-derived
  // convention every other table uses. The locked Company/Sector/CMP/P/E
  // prefix is fetched, left unstyled as everywhere else.
  const headCells = [
    ...WL_CUSTOM_PREFIX.map(f => `<th data-sort="${f.id}" title="${escape(f.label)}">${escape(f.label)}<span class="col-resize-handle"></span></th>`),
    ...visibleFields.map(f => `<th class="num col-derived" data-sort="${f.id}" title="${escape(f.label)}">${escape(f.label)}<span class="col-resize-handle"></span></th>`)
  ].join('');
  const table = $('#wl-custom-table');
  table.querySelector('thead').innerHTML = `<tr>${headCells}</tr>`;
  table.querySelector('tbody').innerHTML = stocks.length
    ? stocks.map(stock => `<tr data-symbol="${escape(stock.symbol)}">${prefixCells(stock, { num: true })}${visibleFields.map(f => `<td class="num derived">${f.cell(stock)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${WL_CUSTOM_PREFIX.length + visibleFields.length}" class="small">No companies match the current filter, or this watchlist is empty.</td></tr>`;
  initTableSort('wl-custom-table');
  initTableLayout('wl-custom-table', { resetButtonId: 'wl-custom-reset-columns' });
}

// ---- Company search (add-company typeahead) state: the local index fetched
// once from /api/companies/index (data/watchlist/searchIndex.mjs -- static
// NSE reference merged with every cached/watchlisted company's real
// classification), a per-browser "frequently selected" counter that nudges
// ranking toward companies this user actually adds, and the live suggestion
// list/keyboard-highlight position for the currently open dropdown. ----
let companySearchIndex = [];
let wlSearchResults = [];
let wlSearchActiveIndex = -1;
let wlSelectionFrequency = {};
try { wlSelectionFrequency = JSON.parse(localStorage.getItem('wl-search-frequency') || '{}'); } catch { /* ignore malformed/unavailable storage */ }

// ---- Sidebar primary navigation. Every sidebar item maps 1:1 to a `.tab`
// section. "Company Research" and "Watchlist Research" are each one real
// `.tab` with their own internal `.subtabs` nav (same two-level mechanism
// every other tab already uses) rather than a virtual group over several
// independent tabs -- the former "Research" virtual-group/pill-bar
// mechanism (Phase 6.5) is retired because its 6 members were split by
// analytical scope (single-company deep-dive vs. watchlist-wide comparison)
// into those two real destinations instead. ----
function activateWorkspaceTab(tabId) {
  $$('#app-sidebar .sidebar-item,.tab').forEach(element => element.classList.remove('active'));
  $(`#${tabId}`)?.classList.add('active');
  $(`#app-sidebar .sidebar-item[data-tab="${tabId}"]`)?.classList.add('active');
  if (currentData) $('#empty').hidden = currentData.stocks.length > 0 || tabId === 'watchlists';
  // Company Context (header) names/analyzes exactly one company, so it is only
  // ever shown on Company Research — every other workspace analyzes a
  // watchlist, the market, or the portfolio as a whole, and showing it there
  // falsely implied the page was about the last-selected company.
  const showCompanyContext = tabId === 'company-research';
  $('#company-context-bar').hidden = !showCompanyContext;
  $('#company-context-label').hidden = !showCompanyContext;
  // Compare is the dedicated home for Compare Mode (§2.3 IA redesign) -- landing
  // here shouldn't require first finding and clicking its own on/off toggle just
  // to see the comparison render. setCompareMode() is the canonical setter (same
  // one the toggle button calls), so this doesn't duplicate any state; it just
  // turns Compare Mode on automatically on arrival, since that's this
  // workspace's whole purpose. The button remains available to turn it back off
  // (e.g. to fall back to single-company selection elsewhere) for the rest of
  // that visit.
  if (tabId === 'compare' && !compareMode && currentData) setCompareMode(true);
  closeMobileSidebar();
  // The newly-active tab's floating-header clones (if any) need their
  // position/visibility recomputed immediately -- switching tabs changes
  // which table (if any) is even in the DOM's visible flow.
  refreshFloatingHeaders();
  // Same reason: a managed table that was hidden (0-width) at its last
  // render may have just become visible for the first time -- capture its
  // real default column widths now instead of leaving it stuck on the
  // generic fallback until the next data refresh.
  recaptureVisibleTableLayouts();
}
$$('#app-sidebar .sidebar-item[data-tab]').forEach(button => button.addEventListener('click', () => activateWorkspaceTab(button.dataset.tab)));

// ---- Sidebar collapse (desktop, persisted) + mobile drawer (no dependency,
// same show/hide-a-backdrop pattern as every other overlay in this app). ----
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sidebarCollapsed';
function closeMobileSidebar() {
  document.body.classList.remove('sidebar-open');
  $('#sidebar-backdrop').hidden = true;
  $('#sidebar-mobile-open')?.setAttribute('aria-expanded', 'false');
}
function syncSidebarCollapseGlyph(collapsed) {
  const glyph = $('#sidebar-collapse-toggle .sidebar-mono');
  if (glyph) glyph.textContent = collapsed ? '»' : '«';
  const label = $('#sidebar-collapse-toggle .sidebar-label');
  if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
}
$('#sidebar-collapse-toggle')?.addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  $('#sidebar-collapse-toggle').setAttribute('aria-pressed', String(collapsed));
  syncSidebarCollapseGlyph(collapsed);
  try { localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
});
try {
  if (localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1') {
    document.body.classList.add('sidebar-collapsed');
    $('#sidebar-collapse-toggle')?.setAttribute('aria-pressed', 'true');
    syncSidebarCollapseGlyph(true);
  }
} catch { /* storage unavailable */ }
$('#sidebar-mobile-open')?.addEventListener('click', () => {
  document.body.classList.add('sidebar-open');
  $('#sidebar-backdrop').hidden = false;
  $('#sidebar-mobile-open').setAttribute('aria-expanded', 'true');
});
$('#sidebar-mobile-close')?.addEventListener('click', closeMobileSidebar);
$('#sidebar-backdrop')?.addEventListener('click', closeMobileSidebar);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMobileSidebar(); });

// ---- Section sub-tabs: two-level navigation within a main tab. Each
// multi-section main tab gets a sticky pill-row (`.subtabs`, first child of
// the `.tab` section) controlling visibility of `.subsection` panels
// elsewhere in that tab. Panels are sometimes static (already in the DOM,
// e.g. Dashboard/Portfolio cards) and sometimes rebuilt wholesale by a
// render*() function on every company switch or data refresh (Fundamentals/
// Valuation/Technicals/Risks deep-dives) -- which is why selection state
// lives in `activeSubtabs`/localStorage rather than only on the DOM:
// applySubtabState() re-syncs freshly rendered panels to whatever was
// already selected, purely a visibility toggle with no extra computation or
// network requests. A panel's data-subtab may be a space-separated list
// (e.g. a card shared across several sub-tabs, kept out of just one). ----
const SUBTAB_STORAGE_PREFIX = 'subtab:';
const activeSubtabs = {};
// A `.tab`/`.subtab-root` may itself contain a nested `.subtab-root` (e.g.
// Company Research nests a Valuation deep-dive sub-nav inside its own
// Overview/Fundamentals/Valuation/... nav) -- `.subsection` matching is
// scoped to the *nearest* owning root via `closest`, so an outer root's
// pass never toggles a nested root's own panels (and vice versa), letting
// two levels of sub-navigation coexist without a new state mechanism.
function applySubtabState(root) {
  // Unscoped: safe because every root's own `.subtabs` bar is always one of
  // its first children, ahead of any nested root's bar in document order.
  const bar = root?.querySelector('.subtabs');
  if (!bar) return;
  const active = activeSubtabs[root.id];
  $$('button', bar).forEach(button => {
    const on = button.dataset.subtab === active;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1;
  });
  $$('.subsection', root).filter(panel => panel.closest('.tab,.subtab-root') === root)
    .forEach(panel => { panel.hidden = !panel.dataset.subtab.split(/\s+/).includes(active); });
  // Switching subtabs can show/hide a Watchlist Research comparison table
  // without firing scroll/resize -- refresh floating headers immediately so
  // a newly-visible table's header shows/hides correctly right away instead
  // of waiting for the next scroll tick.
  refreshFloatingHeaders();
  // Same visibility change can be the first time a managed table's real
  // width is measurable -- see captureDefaultWidthsIfVisible's own comment.
  recaptureVisibleTableLayouts();
}
function setActiveSubtab(root, subtabId, opts = {}) {
  activeSubtabs[root.id] = subtabId;
  try { localStorage.setItem(SUBTAB_STORAGE_PREFIX + root.id, subtabId); } catch { /* storage unavailable -- selection just won't survive a reload */ }
  applySubtabState(root);
  if (opts.focus) root.querySelector(`.subtabs button[data-subtab="${subtabId}"]`)?.focus();
}
function initSubtabs(root) {
  const bar = root.querySelector('.subtabs');
  if (!bar) return;
  const buttons = $$('button', bar);
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => setActiveSubtab(root, button.dataset.subtab));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft' ? (index - 1 + buttons.length) % buttons.length
        : event.key === 'Home' ? 0 : buttons.length - 1;
      setActiveSubtab(root, buttons[next].dataset.subtab, { focus: true });
    });
  });
  let restored;
  try { restored = localStorage.getItem(SUBTAB_STORAGE_PREFIX + root.id); } catch { /* storage unavailable */ }
  activeSubtabs[root.id] = buttons.some(button => button.dataset.subtab === restored) ? restored : buttons[0]?.dataset.subtab;
  applySubtabState(root);
}
// `.subtab-root` = a nested second-level sub-nav living inside a `.tab`
// (e.g. Company Research's Valuation/Technicals/Risks deep-dive sub-nav,
// or Fundamentals' own sub-nav now nested inside Company Research) --
// initialized the same way as a top-level `.tab`, since applySubtabState/
// setActiveSubtab only ever need `root.id` + `root`'s own `.subtabs`/
// `.subsection` descendants (scoped via `closest`, see applySubtabState).
$$('.tab,.subtab-root').forEach(initSubtabs);

// ---- Phase 3f: unified company context. One shared `activeCompanySymbol`
// replaces what used to be four independent per-tab selections (Fundamentals/
// Valuation/Technicals/Risks each tracked their own) -- `setActiveCompany` is
// the single write-point, re-rendering exactly the views that depend on
// company selection off the already-loaded `currentData` (no API calls, no
// recomputation). Compare mode (2-4 companies) is a separate, orthogonal
// toggle layered on top: when off, the same pill-selectors/tables behave
// exactly as before; when on, Valuation/Technicals/Risks call their existing
// per-company content-builder functions once per selected company instead of
// once, and Profitability's tables are simply filtered to the selected rows
// -- no new rendering logic, no change to those content-builder functions. ----
const ACTIVE_COMPANY_STORAGE_KEY = 'activeCompanyContext';
const RECENT_COMPANIES_STORAGE_KEY = 'recentCompanies';
let activeCompanySymbol = null;
let lastRenderedWatchlistId = null;
let compareMode = false;
let compareSymbols = [];
let recentCompanies = [];
try { recentCompanies = JSON.parse(localStorage.getItem(RECENT_COMPANIES_STORAGE_KEY) || '[]'); } catch { /* storage unavailable */ }

// Local fallback only -- called by each detail render function against its
// own (sometimes filtered, e.g. unresolved-excluded) stock list, same as the
// per-tab defaulting logic this replaces. Does not cascade a re-render.
function ensureActiveCompany(stocks) {
  if (!activeCompanySymbol || !stocks.some(s => s.symbol === activeCompanySymbol)) {
    activeCompanySymbol = stocks[0]?.symbol ?? null;
  }
  return activeCompanySymbol;
}
function persistActiveCompany(watchlistId, symbol) {
  try { localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, JSON.stringify({ watchlistId, symbol })); } catch { /* storage unavailable */ }
}
function loadPersistedActiveCompany() {
  try { return JSON.parse(localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || 'null'); } catch { return null; }
}
function pushRecentCompany(stock, watchlistId, watchlistName) {
  recentCompanies = recentCompanies.filter(entry => !(entry.symbol === stock.symbol && entry.watchlistId === watchlistId));
  recentCompanies.unshift({ symbol: stock.symbol, name: stock.name, watchlistId, watchlistName, ts: Date.now() });
  recentCompanies = recentCompanies.slice(0, 10);
  try { localStorage.setItem(RECENT_COMPANIES_STORAGE_KEY, JSON.stringify(recentCompanies)); } catch { /* storage unavailable */ }
}

// Lights up the active company's row/list-item everywhere it appears --
// every `renderTable`-built table (via the `data-symbol` added to each
// `<tr>`), the Watchlists table, Top Opportunities, and the Portfolio
// contribution/attribution lists (which carry `data-symbol` too, resolved by
// name since that's the only key those lists have). Pure class toggle, no
// re-render, no network requests.
function refreshActiveCompanyHighlights() {
  $$('tr[data-symbol], .allocation-row[data-symbol]').forEach(el =>
    el.classList.toggle('active-company-row', el.dataset.symbol === activeCompanySymbol));
}

// The master setter: single write-point for "which company is active,"
// shared by every tab, every table, and the header selector.
function setActiveCompany(symbol, opts = {}) {
  if (!currentData || !symbol || !currentData.stocks.some(s => s.symbol === symbol)) return;
  activeCompanySymbol = symbol;
  const stock = currentData.stocks.find(s => s.symbol === symbol);
  persistActiveCompany(watchlistIndex?.activeWatchlist, symbol);
  pushRecentCompany(stock, watchlistIndex?.activeWatchlist, currentData.watchlistName);
  renderFundamentals(currentData);
  renderValuationDetail(currentData);
  renderTechnicalDetail(currentData);
  renderRiskDetail(currentData);
  renderOwnershipDetail(currentData);
  renderCompanyResearchOverview(currentData);
  renderCompanyResearchQuality(currentData);
  renderCompanyResearchGrowth(currentData);
  renderCompanyResearchIntelligence(currentData);
  renderPortfolioAnalytics(currentData);
  renderHeaderCompanySelector();
  refreshActiveCompanyHighlights();
  renderReportsWorkspace();
  if (opts.jumpTo) activateWorkspaceTab(opts.jumpTo);
  // renderHeaderCompanySelector() above just changed #company-selector-name/
  // -meta text (company name/sector/price length varies a lot company to
  // company), which changes the header's own rendered height -- re-measure
  // for the same reason render() does (see its own comment).
  syncHeaderHeight();
}

// Compare mode: toggling a pill in Valuation/Technicals/Risks adds/removes a
// symbol from the shared `compareSymbols` list (capped at 4) instead of
// changing the single active company, and re-renders the same tabs plus
// Profitability so the comparison set stays synchronized across all of them.
function toggleCompareSymbol(symbol) {
  if (compareSymbols.includes(symbol)) compareSymbols = compareSymbols.filter(s => s !== symbol);
  else if (compareSymbols.length < 4) compareSymbols = [...compareSymbols, symbol];
  renderValuationDetail(currentData);
  renderTechnicalDetail(currentData);
  renderRiskDetail(currentData);
  renderOwnershipDetail(currentData);
  renderCompanyResearchOverview(currentData);
  renderCompanyResearchQuality(currentData);
  renderCompanyResearchGrowth(currentData);
  renderCompanyResearchIntelligence(currentData);
  if (currentData) renderProfitability(compareSymbols.length >= 2 ? currentData.stocks.filter(s => compareSymbols.includes(s.symbol)) : currentData.stocks);
  renderCompareWorkspace(currentData);
}
function setCompareMode(on) {
  compareMode = on;
  renderValuationDetail(currentData);
  renderTechnicalDetail(currentData);
  renderRiskDetail(currentData);
  renderOwnershipDetail(currentData);
  renderCompanyResearchOverview(currentData);
  renderCompanyResearchQuality(currentData);
  renderCompanyResearchGrowth(currentData);
  renderCompanyResearchIntelligence(currentData);
  if (currentData) renderProfitability(compareMode && compareSymbols.length >= 2 ? currentData.stocks.filter(s => compareSymbols.includes(s.symbol)) : currentData.stocks);
  renderCompareWorkspace(currentData);
}

// Renders a company row/column into a labelled compare grid -- shared by
// Valuation/Technicals/Risks' compare-mode branches so the grid markup isn't
// duplicated three times.
function compareGrid(stocks, contentFn, key) {
  const size = stocks.length === 2 ? 'two' : stocks.length === 3 ? 'three' : 'four';
  return `<div class="grid ${size} compare-grid">${stocks.map(stock => `<div><h4>${escape(stock.name)}</h4>${contentFn(stock)[key]}</div>`).join('')}</div>`;
}

function renderHeaderCompanySelector() {
  const button = $('#company-selector-toggle');
  const dropdown = $('#company-selector-dropdown');
  if (!button || !dropdown) return;
  const stock = currentData?.stocks.find(s => s.symbol === activeCompanySymbol);
  $('#company-selector-name').textContent = stock ? `${stock.name} (${stock.symbol})` : 'Select a company';
  $('#company-selector-meta').textContent = stock
    ? `${stock.sector || ''} · ${fmt(stock.price)} ${stock.currency || ''} · ${stock.signal || ''} · ${stock.recommendation?.confidence || ''} confidence`
    : '';
  const watchlistId = watchlistIndex?.activeWatchlist;
  const recentForThisSession = recentCompanies.filter(entry => entry.symbol !== activeCompanySymbol);
  const recentHtml = recentForThisSession.length ? `<div class="company-selector-group-label">Recent</div>${recentForThisSession.map(entry => `
    <button type="button" class="company-selector-row" data-symbol="${escape(entry.symbol)}" data-watchlist="${escape(entry.watchlistId)}">
      <span>${escape(entry.name)}</span><span class="small">${escape(entry.watchlistName || '')}</span>
    </button>`).join('')}` : '';
  const listHtml = (currentData?.stocks || []).map(s => `
    <button type="button" class="company-selector-row ${s.symbol === activeCompanySymbol ? 'active' : ''}" data-symbol="${escape(s.symbol)}" data-watchlist="${escape(watchlistId)}">
      <span>${escape(s.name)} (${escape(s.symbol)})</span>
      <span class="small">${escape(s.sector || '')} · ${fmt(s.price)} · ${escape(s.signal || '')} · ${escape(s.recommendation?.confidence || '')}</span>
    </button>`).join('');
  dropdown.innerHTML = recentHtml + `<div class="company-selector-group-label">${escape(currentData?.watchlistName || 'This watchlist')}</div>` + (listHtml || '<p class="small">This watchlist is empty.</p>');
}
async function selectFromHeaderDropdown(symbol, watchlistId) {
  $('#company-selector-dropdown').hidden = true;
  $('#company-selector-toggle').setAttribute('aria-expanded', 'false');
  if (watchlistId && watchlistId !== watchlistIndex?.activeWatchlist) {
    await switchWatchlist(watchlistId);
  }
  setActiveCompany(symbol);
}
// ---- Phase 6.5 Compare workspace: a dedicated screen for Compare Mode.
// Reuses renderCompareAwarePillSelector (already shared by Valuation/
// Technicals/Risks) for the picker and compareGrid()+the same *DetailContent
// builder functions those three tabs already call -- no new comparison
// logic, just additional render targets for the same pure functions. ----
function renderCompareWorkspace(data) {
  const stocks = (data?.stocks || []).filter(s => !s.unresolved);
  renderCompareAwarePillSelector('#compare-selector', stocks);
  // Company Research UI audit: the header's Quick Jump/Compare cluster was
  // removed as redundant (Compare Mode already has a first-class home here).
  // That removed the header's only Compare-Mode *off* switch too, so this
  // button -- previously "turn on" only, hidden once on -- is now the sole
  // on/off toggle, same functionality, one entry point instead of two.
  const enableBtn = $('#compare-enable-btn');
  if (enableBtn) { enableBtn.textContent = compareMode ? 'Turn off Compare Mode' : 'Turn on Compare Mode'; enableBtn.setAttribute('aria-pressed', String(compareMode)); }
  const compareStocks = compareMode ? compareSymbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) : [];
  const prompt = compareMode
    ? '<p class="small">Pick 2-4 companies above to compare.</p>'
    : '<p class="small">Turn on Compare Mode above, then pick 2-4 companies.</p>';
  if (compareStocks.length >= 2) {
    $('#compare-valuation').innerHTML = compareGrid(compareStocks, valuationDetailContent, 'recommendation') + compareGrid(compareStocks, valuationDetailContent, 'dcf');
    $('#compare-technical').innerHTML = compareGrid(compareStocks, technicalDetailContent, 'indicators') + compareGrid(compareStocks, technicalDetailContent, 'advancedScores');
    $('#compare-risk').innerHTML = ['financial', 'business', 'market', 'sector', 'governance'].map(key => compareGrid(compareStocks, riskDetailContent, key)).join('');
  } else {
    $('#compare-valuation').innerHTML = prompt;
    $('#compare-technical').innerHTML = prompt;
    $('#compare-risk').innerHTML = prompt;
  }
}
$('#compare-enable-btn')?.addEventListener('click', () => setCompareMode(!compareMode));

function initCompanyContextBar() {
  const toggleBtn = $('#company-selector-toggle');
  const dropdown = $('#company-selector-dropdown');
  if (toggleBtn && dropdown) {
    toggleBtn.addEventListener('click', () => {
      const opening = dropdown.hidden;
      dropdown.hidden = !opening;
      toggleBtn.setAttribute('aria-expanded', String(opening));
    });
    dropdown.addEventListener('click', (event) => {
      const row = event.target.closest('.company-selector-row');
      if (row) selectFromHeaderDropdown(row.dataset.symbol, row.dataset.watchlist);
    });
    document.addEventListener('click', (event) => {
      if (!dropdown.hidden && !event.target.closest('.company-selector')) { dropdown.hidden = true; toggleBtn.setAttribute('aria-expanded', 'false'); }
    });
  }
}
initCompanyContextBar();

// ---- Company Research one-page IA (redesign): the 7 former click-to-switch
// tabs (Overview/Fundamentals/Valuation/Quality/Ownership/Technicals/Risks)
// are now `.cr-section` elements that are all always visible in one scroll --
// `.cr-page-nav` is plain anchor-link navigation (scroll, not tab-switching),
// with a lightweight IntersectionObserver highlighting whichever section is
// currently in view, purely a visual convenience with no effect on what's
// rendered (every section renders regardless of which nav item is active).
//
// This used to watch a hardcoded `-120px` band relative to the viewport,
// unrelated to the *real* sticky offset (--header-h + this nav's own
// height) -- which routinely exceeded 120px once the company-context bar
// was showing, so a section counted as "active" while still partly hidden
// behind the sticky header/nav. Bounded viewport shell (2026-09-05): the
// nav no longer overlaps scrolling content at all (it's a fixed sibling
// above `.scroll-body`, see styles.css), so the observer's `root` is simply
// `.scroll-body` itself -- no offset compensation needed any more. Also
// fixed at the same time: this used to derive "the visible section" purely
// from each callback's own `entries` array, but IntersectionObserver only
// reports targets whose ratio just crossed a threshold, not every target
// still intersecting -- so a section that had already crossed into view
// earlier silently dropped out of consideration on the next callback,
// flipping the active link to a stale or wrong section. Fixed by tracking
// currently-intersecting sections in a persistent map instead of trusting
// one callback's entries alone. ----
let rebuildCompanyResearchNav = () => {};
function initCompanyResearchPageNav() {
  const nav = $('.cr-page-nav');
  if (!nav) return;
  const links = $$('a', nav);
  links.forEach(link => link.addEventListener('click', (event) => {
    event.preventDefault();
    $(link.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  const sections = links.map(link => $(link.getAttribute('href'))).filter(Boolean);
  if (!sections.length || typeof IntersectionObserver === 'undefined') return;
  const setActiveLink = (id) => links.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${id}`));
  const intersecting = new Map(); // section id -> boundingClientRect.top, persists across callbacks
  let observer = null;
  rebuildCompanyResearchNav = () => {
    if (observer) observer.disconnect();
    intersecting.clear();
    const root = $('#company-research .scroll-body') || null;
    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) intersecting.set(entry.target.id, entry.boundingClientRect.top);
        else intersecting.delete(entry.target.id);
      });
      if (intersecting.size) setActiveLink([...intersecting].sort((a, b) => a[1] - b[1])[0][0]);
    }, { root, rootMargin: '0px 0px -60% 0px' });
    // Default to the first section immediately, before the observer's first
    // callback lands -- without this, the very top of the page (scrollY 0,
    // Snapshot visible) briefly showed no nav item active at all, which is
    // its own version of "selected nav doesn't match visible content."
    setActiveLink(sections[0].id);
    sections.forEach(section => observer.observe(section));
  };
  rebuildCompanyResearchNav();
}
initCompanyResearchPageNav();

// One delegated listener covers every `.row-company-link` on the page --
// every `renderTable`-built table via `prefixCells`, plus the Watchlists and
// Top Opportunities tables, which use the same button class directly.
$('#main').addEventListener('click', (event) => {
  const link = event.target.closest('.row-company-link');
  if (link) setActiveCompany(link.dataset.symbol);
});

// -- Data-quality classification: every metric this app derives is tagged
// Sourced/Calculated/Heuristic server-side (data/metadata/metricRegistry.mjs,
// shipped once per payload as data.metricMeta) -- this is the one place that
// renders it, as a hover/focus info icon, so no tab hand-rolls its own
// classification text. --
const TIER_LABEL = { sourced: 'Sourced', calculated: 'Calculated', heuristic: 'Heuristic' };
function infoIcon(key) {
  const meta = currentData?.metricMeta?.[key];
  if (!meta) return '';
  return `<span class="info-icon tier-${meta.tier}" tabindex="0">&#9432;<span class="info-popover"><b>${escape(TIER_LABEL[meta.tier] || meta.tier)}</b> &middot; ${escape(meta.confidence)} confidence<div>${escape(meta.methodology)}</div></span></span>`;
}
// Generic compact help/disclaimer tooltip -- same visual component as
// infoIcon() (untiered: plain explanatory copy, not a metric-provenance
// disclosure) for context that used to live in a permanent on-page banner
// (e.g. Portfolio Analysis's transaction-ledger disclaimer). `html` is
// trusted, caller-authored copy, not user input.
function helpIcon(html) {
  return `<span class="info-icon" tabindex="0">&#9432;<span class="info-popover">${html}</span></span>`;
}

// Generic 0-100 score rendering shared by the technical scorecard and risk
// tables -- `invert` flips the color read for risk scores, where a *higher*
// number is worse rather than better.
function scoreTier(value, invert = false) {
  if (value == null) return '';
  const v = invert ? 100 - value : value;
  return v >= 65 ? 'positive' : v >= 40 ? 'amber' : 'negative';
}
function scoreText(value, invert = false) {
  return value == null ? '' : `<span class="${scoreTier(value, invert)}">${value}/100</span>`;
}
function riskCard(name, value, key) {
  if (value == null) return `<article class="card risk"><h3>${name} ${infoIcon(key)}</h3><div class="kpi"></div><div class="small">No data source configured</div></article>`;
  const tier = value > 65 ? 'high' : value > 40 ? 'medium' : '';
  return `<article class="card risk ${tier}"><h3>${name} ${infoIcon(key)}</h3><div class="kpi">${value}/100</div><div class="bar"><i style="width:${value}%"></i></div></article>`;
}

// ---- Tab renderers (Valuation / Profitability / Balance sheet / Growth /
// Ownership / Technicals / Portfolio) -- each consumes the same `stocks`
// array in the same order; none of them sort or slice it. ----
const VALUATION_TABLE_SORT = {
  ...STANDARD_SORT_KEYS,
  forwardPe: s => s.metrics?.forwardPe, pb: s => s.metrics?.pb, evEbitda: s => s.metrics?.evEbitda, peg: s => s.metrics?.peg,
  fairValue: s => s.valuation?.fairValue, targetPrice: s => s.valuation?.targetPrice, upside: s => s.valuation?.upsidePct,
  marginOfSafety: s => s.valuation?.marginOfSafetyPct, confidence: s => CONVICTION_RANK[s.valuation?.confidenceBand] || null,
  sectorPremium: s => s.sectorPremiumDiscountPe, earningsYield: s => s.earningsYield, fcfYield: s => s.fcfYield,
  sectorRank: s => s.relativeValuation?.sectorRank, relativeAttractiveness: s => s.relativeValuation?.relativeAttractivenessScore,
  peerCompleteness: s => PEER_COMPLETENESS_RANK[s.relativeValuation?.peerCompleteness] || null
};
function renderValuationTab(stocks) {
  const sorted = sortForTable('valuation-table', stocks, VALUATION_TABLE_SORT);
  renderTable('#valuation-table', sorted, stock => {
    const m = stock.metrics || {}, v = stock.valuation || {}, rv = stock.relativeValuation;
    return `<td>${fmt(m.forwardPe)}</td><td class="derived">${fmt(m.pb)}</td><td class="derived">${fmt(m.evEbitda)}</td><td class="derived">${fmt(m.peg)}</td><td class="derived">${fmt(v.fairValue)}</td><td class="derived">${fmt(v.targetPrice)}</td><td class="derived">${pct(v.upsidePct)}</td><td class="derived">${pct(v.marginOfSafetyPct)}</td><td class="derived">${escape(v.confidenceBand || '')}</td><td class="derived">${pct(stock.sectorPremiumDiscountPe)}</td><td class="derived">${pct(stock.earningsYield)}</td><td class="derived">${pct(stock.fcfYield)}</td>` +
      `<td class="derived">${rv ? `${rv.sectorRank}/${rv.sectorPeerCount}` : ''}</td><td class="num derived">${rv?.relativeAttractivenessScore == null ? '' : `${rv.relativeAttractivenessScore}/100`}</td><td class="derived">${escape(rv?.peerCompleteness || '')}</td>`;
  });
  initTableSort('valuation-table');
  initTableLayout('valuation-table', { resetButtonId: 'valuation-table-reset-columns' });
}
// ---- Generic reusable table layout: drag-to-resize + drag-to-reorder +
// persisted column order/widths + a "Reset columns" control. Generalized
// from Watchlist Research -> Overview's original implementation (the first
// table in this app to get this treatment) so every comparison table gets
// the same mechanism instead of a per-table copy. Column identity is always
// a column's existing `data-sort` id (already used for sorting) -- reorder/
// resize state never keys off DOM position, so a saved layout survives an
// added/removed/renamed column. Default order and widths are read from each
// table's own <thead> the first time it's bound (DOM order, and each th's
// natural rendered width measured before switching to a fixed layout)
// rather than hand-duplicated per table -- index.html's own markup stays
// the one source of truth for what columns exist and how wide they start.
// Persistence is one versioned localStorage key per table
// (stocksApp.tableLayout.<tableId>.v1), so no two tables ever share layout
// state and a future incompatible saved shape can be detected instead of
// misread. (tableLayouts itself is declared near the top of this file, not
// here -- see that declaration's own comment for why.)
function tableLayoutStorageKey(tableId) { return `stocksApp.tableLayout.${tableId}.v1`; }
function loadTableLayoutState(tableId, defaultOrder) {
  try {
    const raw = JSON.parse(localStorage.getItem(tableLayoutStorageKey(tableId)) || 'null');
    if (raw && typeof raw === 'object') {
      let order = defaultOrder;
      if (Array.isArray(raw.order)) {
        // Drop any id this build no longer has (a removed column), dedupe,
        // then append any id this build has that the saved layout doesn't
        // (a newly-added column) at the end, at its default width.
        const valid = [...new Set(raw.order)].filter(id => defaultOrder.includes(id));
        const missing = defaultOrder.filter(id => !valid.includes(id));
        if (valid.length) order = [...valid, ...missing];
      }
      const widths = raw.widths && typeof raw.widths === 'object'
        ? Object.fromEntries(Object.entries(raw.widths).filter(([id, w]) => defaultOrder.includes(id) && Number.isFinite(w) && w > 0))
        : {};
      return { order, widths };
    }
  } catch { /* malformed/incompatible JSON -- fall through to defaults */ }
  return { order: defaultOrder, widths: {} };
}
function saveTableLayoutState(tableId) {
  const state = tableLayouts[tableId];
  if (!state) return;
  try { localStorage.setItem(tableLayoutStorageKey(tableId), JSON.stringify({ version: 1, order: state.order, widths: state.widths })); } catch { /* storage unavailable -- layout just won't survive a reload */ }
}
// One-time migration: Overview's column layout used to live under its own
// dedicated key (and, before that, an even earlier width-only key) before
// this mechanism was generalized to every table -- migrate a real user's
// already-saved customization into the new shared per-table key scheme so
// it isn't silently lost by this refactor.
(function migrateWrOverviewLayoutKey() {
  const newKey = tableLayoutStorageKey('wr-overview-table');
  if (localStorage.getItem(newKey)) return; // already migrated, or already saved fresh under the new scheme
  try {
    const oldVersioned = JSON.parse(localStorage.getItem('stocksApp.watchlistResearch.overview.screeningMatrix.v1') || 'null');
    if (oldVersioned && typeof oldVersioned === 'object') {
      localStorage.setItem(newKey, JSON.stringify(oldVersioned));
      localStorage.removeItem('stocksApp.watchlistResearch.overview.screeningMatrix.v1');
      return;
    }
    const legacyWidths = JSON.parse(localStorage.getItem('wrOverviewColWidths') || 'null');
    if (legacyWidths && typeof legacyWidths === 'object') {
      localStorage.setItem(newKey, JSON.stringify({ version: 1, order: [], widths: legacyWidths }));
      localStorage.removeItem('wrOverviewColWidths');
    }
  } catch { /* no legacy data, or storage unavailable -- nothing to migrate */ }
})();
// Reapplies the persisted column order to the live DOM. Most tables' <thead>
// is static markup that's never rebuilt, so moving its <th> elements (by id,
// via appendChild -- which relocates rather than clones, so no listener or
// state is lost) sticks across renders on its own; the <tbody> IS rebuilt on
// every render, always back in the table's original column order, so this
// must re-run after every render to keep body cells under the header they
// belong to. Guarded by an exact cell-count check so a colspan empty-state
// fallback row is safely skipped rather than misread.
// Several tables mix sortable columns with fixed, non-reorderable ones that
// don't sit only at the edges (wl-table's leading checkbox column is first,
// but its Notes/Actions columns are last while alerts-table's Acknowledge
// column is last and profitability-table's always-blank Gross margin column
// sits in the *middle*, between CMP/P/E and EBITDA margin). Naively
// appendChild-ing only the sortable th/td's in `state.order` would silently
// leave every fixed column "behind" -- each moved element jumps to the end
// of headRow/row's children, one at a time, so an untouched fixed column
// ends up dragged toward the front instead of staying at its own position.
// `state.fullLayout` (captured once at bind time, see initTableLayout) is a
// positional template of the table's ORIGINAL column layout -- one entry per
// column, `{sortable:true, id}` or `{sortable:false, el}` (a stable direct
// element reference for the header, since a static <thead>'s th elements are
// never recreated, only moved). reorderSlots() below walks that template and
// substitutes the current `order` sequence into just the sortable slots,
// leaving every fixed slot's element in its own original relative position --
// then appending the WHOLE resulting sequence (fixed and sortable alike)
// keeps fixed columns correctly pinned regardless of how the sortable ones
// were reordered.
function reorderSlots(fullLayout, order, sortableElementFor, fixedElementFor) {
  let cursor = 0;
  return fullLayout.map((slot, i) => slot.sortable ? sortableElementFor(order[cursor++]) : fixedElementFor(slot, i));
}
function applyTableColumnOrder(tableId) {
  const state = tableLayouts[tableId];
  const headRow = $(`#${tableId} thead tr`);
  if (!headRow || !state?.fullLayout) return;
  // Looked up by data-sort id (stable regardless of DOM position), not by
  // position -- unlike tbody cells (rebuilt fresh, in original order, every
  // render), a static table's <th> elements persist and may already be in a
  // previously-reordered position by the time this runs again. Fixed th's
  // use the stable element reference captured once at bind time (also
  // position-independent, since that same element persists forever).
  const thById = Object.fromEntries($$(`#${tableId} thead th[data-sort]`).map(th => [th.dataset.sort, th]));
  reorderSlots(state.fullLayout, state.order, id => thById[id], slot => slot.el).forEach(th => { if (th) headRow.appendChild(th); });
  $$(`#${tableId} tbody tr`).forEach(row => {
    const cells = [...row.children];
    if (cells.length !== state.fullLayout.length) return;
    // A freshly-rendered row's cells ARE positionally aligned with
    // fullLayout (renderTable() always emits <td>s in the original template
    // order), so a fixed slot's cell is looked up positionally here (cells[i])
    // -- unlike the header, there's no persistent element to reference since
    // <tbody> is rebuilt from scratch on every render.
    const cellBySortId = {};
    state.fullLayout.forEach((slot, i) => { if (slot.sortable) cellBySortId[slot.id] = cells[i]; });
    reorderSlots(state.fullLayout, state.order, id => cellBySortId[id], (slot, i) => cells[i]).forEach(cell => { if (cell) row.appendChild(cell); });
  });
}
// A multi-row <thead> (a colspan group-header row above the real column
// headers -- every macro-unified-table on the Macro workspace) breaks plain
// th.style.width under table-layout:fixed: per the CSS2.1 fixed-table-layout
// algorithm, only the FIRST row's cell widths (or a <colgroup>/<col>) ever
// set a column's rendered width -- a second-row th's style.width is silently
// ignored by the renderer even though the style attribute itself is set
// correctly (confirmed live: a real drag-resize wrote the correct pixel
// value to both the th's style and the persisted layout state, but the
// column's on-screen width never changed -- a genuine gap in the existing
// resize claim for this table shape, found via live browser testing, not
// present on any single-row-thead table). A <colgroup> sidesteps the whole
// row-based lookup: one <col> per real column, in this table's fixed,
// never-reordered column order (allowReorder:false on every table this
// applies to), created once and left in place -- no reorder logic needed.
function ensureColgroup(tableId) {
  const table = $(`#${tableId}`);
  if (!table || table.querySelector('colgroup') || $$(`#${tableId} thead tr`).length < 2) return;
  const cols = $$(`#${tableId} thead th[data-sort]`).map(th => `<col data-col-id="${th.dataset.sort}">`).join('');
  table.insertAdjacentHTML('afterbegin', `<colgroup>${cols}</colgroup>`);
}
function applyTableColumnWidths(tableId) {
  const state = tableLayouts[tableId];
  if (!state) return;
  const colgroup = $(`#${tableId} colgroup`);
  $$(`#${tableId} thead th[data-sort]`).forEach(th => {
    const width = state.widths[th.dataset.sort] || state.defaultWidths[th.dataset.sort] || 120;
    th.style.width = `${width}px`;
    const col = colgroup?.querySelector(`col[data-col-id="${th.dataset.sort}"]`);
    if (col) col.style.width = `${width}px`;
  });
}
// A table on an inactive tab/subtab has display:none somewhere up its
// ancestor chain, so getBoundingClientRect() reports 0 for every column --
// capturing "default width" at bind time would silently record garbage for
// every table that isn't the one currently on screen. Deferred: widths are
// captured the first time the table is actually visible, re-attempted from
// activateWorkspaceTab()/applySubtabState() (below) each time visibility can
// have changed, same trigger these already use to refresh floating headers.
// table-layout:fixed (via the .table-layout-managed class, which also drives
// the resize-handle/lineage CSS) is deliberately not applied until real
// widths are known, so a still-hidden table keeps its normal auto layout
// rather than collapsing to the 120px fallback the moment it's shown.
function captureDefaultWidthsIfVisible(tableId) {
  const state = tableLayouts[tableId];
  const table = $(`#${tableId}`);
  if (!state || state.widthsCaptured || !table || table.offsetParent === null) return;
  $$(`#${tableId} thead th[data-sort]`).forEach(th => {
    const width = Math.round(th.getBoundingClientRect().width);
    if (width > 0) state.defaultWidths[th.dataset.sort] = width;
  });
  if (state.defaultOrder.every(id => state.defaultWidths[id] > 0)) {
    state.widthsCaptured = true;
    table.classList.add('table-layout-managed');
  }
}
function recaptureVisibleTableLayouts() {
  Object.keys(tableLayouts).forEach(tableId => {
    if (tableLayouts[tableId].widthsCaptured) return;
    captureDefaultWidthsIfVisible(tableId);
    applyTableColumnWidths(tableId);
  });
}
// Native HTML5 drag-and-drop column reorder -- no extra dependency, and
// click-to-sort keeps working on the same <th> unchanged (a plain click
// never engages a drag gesture in the browser's own drag-and-drop model).
// Bound once per table (delegated on <thead>, guarded like initTableSort/
// initTableColumnResize). Alt+ArrowLeft/Right on a focused header is a small
// keyboard-operable equivalent (this app has no other drag-and-drop
// precedent to match, so this is a minimal, additive affordance rather than
// a full parallel UI).
function initTableColumnDragGeneric(tableId) {
  const thead = $(`#${tableId} thead`);
  if (!thead) return;
  const ths = () => $$(`#${tableId} thead th[data-sort]`);
  // Marking headers draggable is idempotent and cheap, so it's safe to redo
  // on every call -- necessary for wl-custom-table, whose <thead> (and every
  // <th> in it) is fully regenerated on each render; a table-level "bound
  // once" flag would leave those fresh elements non-draggable after the
  // first render, same reasoning as initTableColumnResize's per-handle guard.
  ths().forEach(th => { th.draggable = true; th.tabIndex = 0; th.classList.add('col-draggable'); });
  if (thead.dataset.dragBound) return;
  thead.dataset.dragBound = '1';
  const clearDropMarkers = () => ths().forEach(el => el.classList.remove('col-drop-before', 'col-drop-after'));
  const moveColumn = (id, targetIndex) => {
    const state = tableLayouts[tableId];
    const order = state.order.filter(x => x !== id);
    order.splice(Math.max(0, Math.min(targetIndex, order.length)), 0, id);
    state.order = order;
    saveTableLayoutState(tableId);
    applyTableColumnOrder(tableId);
  };
  let dragId = null;
  thead.addEventListener('dragstart', (event) => {
    const th = event.target.closest('th[data-sort]');
    if (!th || event.target.closest('.col-resize-handle')) { event.preventDefault(); return; }
    dragId = th.dataset.sort;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId);
    th.classList.add('col-dragging');
  });
  thead.addEventListener('dragover', (event) => {
    const th = event.target.closest('th[data-sort]');
    if (!th || !dragId || th.dataset.sort === dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearDropMarkers();
    const before = event.clientX - th.getBoundingClientRect().left < th.getBoundingClientRect().width / 2;
    th.classList.add(before ? 'col-drop-before' : 'col-drop-after');
  });
  thead.addEventListener('drop', (event) => {
    const th = event.target.closest('th[data-sort]');
    event.preventDefault();
    clearDropMarkers();
    ths().forEach(el => el.classList.remove('col-dragging'));
    if (!th || !dragId || th.dataset.sort === dragId) { dragId = null; return; }
    const before = event.clientX - th.getBoundingClientRect().left < th.getBoundingClientRect().width / 2;
    const targetIndex = tableLayouts[tableId].order.filter(x => x !== dragId).indexOf(th.dataset.sort);
    moveColumn(dragId, before ? targetIndex : targetIndex + 1);
    dragId = null;
  });
  thead.addEventListener('dragend', () => { ths().forEach(el => el.classList.remove('col-dragging')); clearDropMarkers(); dragId = null; });
  thead.addEventListener('keydown', (event) => {
    const th = event.target.closest('th[data-sort]');
    if (!th || !event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const id = th.dataset.sort;
    const currentIndex = tableLayouts[tableId].order.indexOf(id);
    const targetIndex = event.key === 'ArrowLeft' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= tableLayouts[tableId].order.length) return;
    moveColumn(id, targetIndex);
    th.focus();
  });
}
// One call per table's render function: binds resize/drag/reset once (first
// call, guarded like initTableSort/initTableColumnResize on the same
// <thead>), then reapplies persisted order+widths on every call thereafter
// -- cheap, and necessary since <tbody> is rebuilt every render, same as
// initTableSort's own always-reapply pattern for sort indicators.
// allowReorder:false (the two Market Intelligence macro-indicator tables,
// which have a second <tr class="table-group-row"> of colspan group headers
// above the real column-header row) disables drag-reorder entirely: dragging
// a column out from under its group label would visually misalign the
// grouping, and applyTableColumnOrder's appendChild-into-headRow logic
// specifically assumes a single-row <thead> -- against a two-row one it
// would relocate the real header cells into the group row. Resize and sort
// have no such assumption and stay fully enabled.
function initTableLayout(tableId, { resetButtonId, allowReorder = true } = {}) {
  const thead = $(`#${tableId} thead`);
  const table = $(`#${tableId}`);
  if (!thead || !table) return;
  // fullLayout captures the table's ORIGINAL column template positionally --
  // one entry per <th>, sortable or fixed -- so applyTableColumnOrder can
  // keep fixed (non-data-sort) columns pinned at their own position instead
  // of being left behind by reordering the sortable ones around them (see
  // that function's own comment). Fixed slots keep a direct element
  // reference, valid forever for a static <thead> (only wl-custom-table's
  // <thead> is rebuilt per render, and it has zero fixed columns today, so
  // this reference never goes stale in practice).
  const fullLayout = $$(`#${tableId} thead th`).map(th => th.dataset.sort ? { sortable: true, id: th.dataset.sort } : { sortable: false, el: th });
  const currentIds = fullLayout.filter(slot => slot.sortable).map(slot => slot.id);
  ensureColgroup(tableId);
  if (!thead.dataset.layoutBound) {
    thead.dataset.layoutBound = '1';
    const { order, widths } = loadTableLayoutState(tableId, currentIds);
    tableLayouts[tableId] = { order, widths, defaultOrder: currentIds, defaultWidths: {}, widthsCaptured: false, fullLayout };
    if (resetButtonId) {
      $(`#${resetButtonId}`)?.addEventListener('click', () => {
        const state = tableLayouts[tableId];
        state.order = [...state.defaultOrder];
        state.widths = {};
        state.defaultWidths = {};
        state.widthsCaptured = false;
        saveTableLayoutState(tableId);
        if (allowReorder) applyTableColumnOrder(tableId);
        // Pre-existing bug, found via live UI testing while validating the
        // Macro workspace's new tables (also reproduced on sector-intel-table,
        // an existing single-row-thead table -- not introduced by the
        // colgroup mechanism above, just newly discovered by it): the manually
        // resized width was still applied to the th (and, for a multi-row
        // thead, its <col>) at the moment captureDefaultWidthsIfVisible
        // re-measured "the default" below, so Reset silently recaptured the
        // very width it was supposed to discard instead of the table's true
        // natural size. Clearing the applied width -- and dropping
        // table-layout-managed so the table returns to auto layout, exactly
        // its state the first time this table was ever bound -- before
        // recapturing fixes this for every table, not just the new ones.
        $$(`#${tableId} thead th[data-sort]`).forEach(th => { th.style.width = ''; });
        $$(`#${tableId} colgroup col`).forEach(col => { col.style.width = ''; });
        table.classList.remove('table-layout-managed');
        captureDefaultWidthsIfVisible(tableId);
        applyTableColumnWidths(tableId);
      });
    }
  } else {
    // The live set of columns can change without a full unbind/rebind --
    // wl-custom-table's user-toggleable optional fields are the one case in
    // this app today, but this reconciliation is generic (same drop-missing/
    // append-new logic loadTableLayoutState already applies at load time):
    // drop ids no longer present, append newly-shown ids at the end, and
    // re-measure default widths for the new column set since the old
    // measurements no longer describe what's on screen.
    const state = tableLayouts[tableId];
    const idsChanged = currentIds.length !== state.defaultOrder.length || !currentIds.every(id => state.defaultOrder.includes(id));
    if (idsChanged) {
      const stillValid = state.order.filter(id => currentIds.includes(id));
      const newlyShown = currentIds.filter(id => !stillValid.includes(id));
      state.order = [...stillValid, ...newlyShown];
      state.defaultOrder = currentIds;
      // Safe to take the freshly-queried fullLayout here: this branch only
      // ever fires today for wl-custom-table (the one table whose visible
      // column set can change), whose <thead> is always rebuilt in natural
      // (unreordered) order on every render, before this function reorders
      // it -- so "current DOM order" and "original template order" are the
      // same thing at this exact point, unlike a static table mid-reorder.
      state.fullLayout = fullLayout;
      state.widths = Object.fromEntries(Object.entries(state.widths).filter(([id]) => currentIds.includes(id)));
      state.defaultWidths = {};
      state.widthsCaptured = false;
    }
  }
  // Idempotent per-element/first-bind-per-table guards inside these two make
  // it safe to call them on every render regardless of which branch above
  // ran -- necessary for wl-custom-table, whose <thead> markup (and every
  // <th> in it) is fully regenerated each render.
  initTableColumnResize(tableId, (key, width) => { tableLayouts[tableId].widths[key] = width; saveTableLayoutState(tableId); });
  if (allowReorder) initTableColumnDragGeneric(tableId);
  captureDefaultWidthsIfVisible(tableId);
  applyTableColumnWidths(tableId);
  if (allowReorder) applyTableColumnOrder(tableId);
}
// Watchlist Research -> Overview: the primary screening table. Every field
// below is already computed elsewhere in this payload (recommendation,
// valuation, technical scorecard, institutional risk, decision-layer action
// score) -- this reads, never recomputes, matching the single-computation-
// site rule the rest of this app follows. Recommendation/Primary driver/
// Confidence/Composite score/Upside %/Regime/Risk score/Action/Company
// Quality/Stock Attractiveness/Fundamental View/Market View/Factor score are
// all derived/calculated output (scoring, decision or quant layer) and carry
// the `derived` class for the fetched-vs-derived tint (styles.css); Change
// (like the Company/Sector/CMP/P/E prefix) is a raw fetched field and is left
// unstyled, matching index.html's `col-derived` classification on the header.
function renderWrOverviewTable(data) {
  const actionScores = data.intelligence?.actionScores || {};
  const rows = rankAllStocks(data.stocks, opportunitiesSort);
  const keyFns = {
    ...STANDARD_SORT_KEYS, change: s => s.change, recommendation: s => RATING_RANK[s.signal] || null,
    driver: s => keyCatalystFor(s) || null, confidence: s => CONVICTION_RANK[s.recommendation?.confidence] || null,
    composite: s => s.score, upside: s => s.valuation?.upsidePct, regime: s => s.technicalScorecard?.regime || null,
    riskScore: s => s.institutionalRisk?.compositeRiskScore,
    action: s => ({ 'Add aggressively': 5, Add: 4, Hold: 3, Reduce: 2, Exit: 1 }[actionScores[s.symbol]?.label] || null),
    companyQuality: s => s.recommendation?.companyQuality?.score, stockAttractiveness: s => s.recommendation?.stockAttractiveness?.score,
    fundamentalView: s => s.recommendation?.fundamentalView?.score, marketView: s => s.recommendation?.marketView?.score,
    factorScore: s => s.quantFactors?.factorScore
  };
  const sorted = sortForTable('wr-overview-table', rows, keyFns);
  renderTable('#wr-overview-table', sorted, stock => {
    const risk = stock.institutionalRisk || {};
    const r = stock.recommendation || {}, qf = stock.quantFactors;
    const fv = r.fundamentalView || {}, mv = r.marketView || {};
    return `<td class="num">${pct(stock.change)}</td><td class="derived">${signalTag(stock)}</td><td class="derived">${escape(keyCatalystFor(stock))}</td><td class="derived">${escape(r.confidence || '')}</td>` +
      `<td class="num derived">${stock.score == null ? '' : `${fmt(stock.score)}/100`}</td><td class="num derived">${pct(stock.valuation?.upsidePct)}</td>` +
      `<td class="derived">${escape(stock.technicalScorecard?.regime || '')}</td><td class="num derived">${risk.compositeRiskScore == null ? '' : `${fmt(risk.compositeRiskScore)}/100`}</td>` +
      `<td class="derived">${actionScoreBadge(actionScores[stock.symbol])}</td>` +
      `<td class="num derived">${r.companyQuality?.score == null ? '' : `${r.companyQuality.score}/100`}</td>` +
      `<td class="num derived">${r.stockAttractiveness?.score == null ? '' : `${r.stockAttractiveness.score}/100`}</td>` +
      `<td class="derived">${escape(fv.label || '')}</td><td class="derived">${escape(mv.label || '')}</td>` +
      `<td class="num derived" title="${escape(qf?.capNote || '')}">${qf?.factorScore == null ? '' : `${qf.factorScore}/100`}</td>`;
  }, { num: true });
  initTableSort('wr-overview-table');
  initTableLayout('wr-overview-table', { resetButtonId: 'wr-overview-reset-columns' });
}
// Each of these four tabs previously drove one wide, horizontally-scrolling
// table off `stock.metrics`; they now drive several narrower ones (one per
// sub-tab) via the same renderTable()/prefixCells() helper -- same fields,
// same stocks array, just a smaller column subset per call.
const PROFITABILITY_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, ebitdaMargin: s => s.metrics?.ebitdaMargin, operatingMargin: s => s.metrics?.ebitdaMargin, netMargin: s => s.metrics?.netMargin,
  roe: s => s.metrics?.roe, roce: s => s.metrics?.roce, roa: s => s.metrics?.roa, earningsQuality: s => s.metrics?.earningsQualityScore
};
function renderProfitability(stocks) {
  const m = (stock) => stock.metrics || {};
  const sorted = sortForTable('profitability-table', stocks, PROFITABILITY_TABLE_SORT);
  renderTable('#profitability-table', sorted, stock => `<td class="num"></td><td class="num derived">${pct(m(stock).ebitdaMargin)}</td><td class="num derived">${pct(m(stock).ebitdaMargin)}</td><td class="num derived">${pct(m(stock).netMargin)}</td><td class="num">${pct(m(stock).roe)}</td><td class="num">${pct(m(stock).roce)}</td><td class="num derived">${pct(m(stock).roa)}</td><td class="num derived">${fmt(m(stock).earningsQualityScore)}</td>`, { num: true });
  initTableSort('profitability-table');
  initTableLayout('profitability-table', { resetButtonId: 'profitability-table-reset-columns' });
}
const BALANCE_SHEET_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, debt: s => s.metrics?.debt, cash: s => s.metrics?.cash, netDebt: s => s.metrics?.netDebt,
  debtToEquity: s => s.metrics?.debtToEquity, currentRatio: s => s.metrics?.currentRatio, quickRatio: s => s.metrics?.quickRatio,
  wcDays: s => s.fundamentalsAnalytics?.workingCapital?.workingCapitalDays, capitalStructure: s => s.metrics?.capitalStructure || null
};
function renderBalanceSheetTab(stocks) {
  const m = (stock) => stock.metrics || {};
  const wcDays = (stock) => stock.fundamentalsAnalytics?.workingCapital?.workingCapitalDays;
  const sorted = sortForTable('balance-sheet-table', stocks, BALANCE_SHEET_TABLE_SORT);
  renderTable('#balance-sheet-table', sorted, stock => `<td class="num">${fmt(m(stock).debt)}</td><td class="num">${fmt(m(stock).cash)}</td><td class="num">${fmt(m(stock).netDebt)}</td><td class="num derived">${pct(m(stock).debtToEquity)}</td><td class="num derived">${fmt(m(stock).currentRatio)}</td><td class="num derived">${fmt(m(stock).quickRatio)}</td><td class="num derived">${fmt(wcDays(stock))}</td><td class="derived">${escape(m(stock).capitalStructure || '')}</td>`, { num: true });
  initTableSort('balance-sheet-table');
  initTableLayout('balance-sheet-table', { resetButtonId: 'balance-sheet-table-reset-columns' });
}
const GROWTH_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, revenue3y: s => s.metrics?.revenueCagr3y, revenue5y: s => s.metrics?.revenueCagr5y,
  ebitda3y: s => s.metrics?.ebitdaCagr3y, ebitda5y: s => s.metrics?.ebitdaCagr5y, profit3y: s => s.metrics?.profitCagr3y,
  profit5y: s => s.metrics?.profitCagr5y, eps5y: s => s.metrics?.epsCagr5y, bookValue: s => s.metrics?.bookValueCagr, fcf: s => s.metrics?.fcfCagr
};
function renderGrowthTab(stocks) {
  const m = (stock) => stock.metrics || {};
  const sorted = sortForTable('growth-table', stocks, GROWTH_TABLE_SORT);
  renderTable('#growth-table', sorted, stock => `<td class="num derived">${pct(m(stock).revenueCagr3y)}</td><td class="num derived">${pct(m(stock).revenueCagr5y)}</td><td class="num derived">${pct(m(stock).ebitdaCagr3y)}</td><td class="num derived">${pct(m(stock).ebitdaCagr5y)}</td><td class="num derived">${pct(m(stock).profitCagr3y)}</td><td class="num derived">${pct(m(stock).profitCagr5y)}</td><td class="num derived">${pct(m(stock).epsCagr5y)}</td><td class="num derived">${fmt(m(stock).bookValueCagr)}</td><td class="num derived">${pct(m(stock).fcfCagr)}</td>`, { num: true });
  initTableSort('growth-table');
  initTableLayout('growth-table', { resetButtonId: 'growth-table-reset-columns' });
}
const OWNERSHIP_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, promoter: s => s.metrics?.promoterHolding, promoterTrend: s => s.metrics?.promoterHoldingTrend,
  fii: s => s.metrics?.fiiHolding, dii: s => s.metrics?.diiHolding, mf: s => s.metrics?.mutualFundHolding,
  institutional: s => s.metrics?.institutionalHolding,
  concentration: s => s.metrics?.promoterHolding != null && s.metrics?.institutionalHolding != null ? s.metrics.promoterHolding + s.metrics.institutionalHolding : null
};
function renderOwnershipTab(stocks) {
  const m = (stock) => stock.metrics || {};
  const concentration = (stock) => m(stock).promoterHolding != null && m(stock).institutionalHolding != null ? m(stock).promoterHolding + m(stock).institutionalHolding : null;
  const sorted = sortForTable('ownership-table', stocks, OWNERSHIP_TABLE_SORT);
  renderTable('#ownership-table', sorted, stock => `<td class="num">${pct(m(stock).promoterHolding)}</td><td class="derived">${pct(m(stock).promoterHoldingTrend)}</td><td class="num">${pct(m(stock).fiiHolding)}</td><td class="num">${pct(m(stock).diiHolding)}</td><td class="num">${fmt(m(stock).mutualFundHolding)}</td><td class="num derived">${pct(m(stock).institutionalHolding)}</td><td class="num derived">${pct(concentration(stock))}</td>`, { num: true });
  initTableSort('ownership-table');
  initTableLayout('ownership-table', { resetButtonId: 'ownership-table-reset-columns' });
}
// Company Research -> Ownership: no per-company deep-dive existed before
// this redesign, only the 4 comparison tables above (now on Watchlist
// Research). This reads the exact same already-computed `stock.metrics`
// ownership fields those tables use and formats them as a single-company
// card -- the same reuse pattern as fundamentalsContent/valuationDetailContent/
// technicalDetailContent/riskDetailContent, zero new calculation.
function ownershipDetailContent(stock) {
  if (!stock) return '<p class="small">No data yet.</p>';
  const m = stock.metrics || {};
  const concentration = m.promoterHolding != null && m.institutionalHolding != null ? m.promoterHolding + m.institutionalHolding : null;
  return `<article class="card">
      <h3>${escape(stock.name)} &mdash; ownership</h3>
      <div class="grid four">
        ${card('Promoter holding', pct(m.promoterHolding), `Trend ${pct(m.promoterHoldingTrend)}`, '')}
        ${card('FII holding', pct(m.fiiHolding), '', '')}
        ${card('DII holding', pct(m.diiHolding), '', '')}
        ${card('Mutual fund holding', fmt(m.mutualFundHolding), '', '')}
      </div>
      <div class="grid two">
        ${card('Institutional ownership', pct(m.institutionalHolding), 'FII + DII + mutual fund', '')}
        ${card('Ownership concentration', pct(concentration), 'Promoter + institutional holding', '')}
      </div>
    </article>`;
}
function renderOwnershipDetail(data) {
  const stocks = data.stocks.filter(s => !s.unresolved);
  const target = $('#cr-ownership-content');
  if (!target) return;
  const compareStocks = compareMode ? compareSymbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) : [];
  target.innerHTML = compareStocks.length >= 2
    ? compareGrid(compareStocks, (s) => ({ ownership: ownershipDetailContent(s) }), 'ownership')
    : ownershipDetailContent(stocks.find(s => s.symbol === activeCompanySymbol));
}
// Company Research -> Quality & Financial Health: Company Quality vs. Stock
// Attractiveness, Fundamental View/Market View, Action Guidance -- all
// already computed server-side (data/scoring/qualityAttractiveness.mjs,
// scoringEngine.mjs's buildFundamentalView/buildMarketView, attached at
// stock.recommendation.*) and, until this redesign, surfaced nowhere in the
// live dashboard (only in the standalone report). Zero new calculation --
// pure reformat of fields the payload already carries.
function companyQualityContent(stock) {
  if (!stock) return '<p class="small">No data yet.</p>';
  const r = stock.recommendation || {};
  const cq = r.companyQuality || {}, sa = r.stockAttractiveness || {}, fv = r.fundamentalView || {}, mv = r.marketView || {};
  const bandClass = (label) => label === 'Strong' || label === 'Above average' || label === 'Positive' || label === 'Favorable' ? 'positive' : label === 'Weak' || label === 'Below average' || label === 'Negative' || label === 'Unfavorable' ? 'amber' : '';
  return `<article class="card">
      <h3>Company Quality vs. Stock Attractiveness ${infoIcon('companyQualityScore')}</h3>
      <p class="small">Is this a good business, independent of price (Company Quality), vs. is the current price/setup attractive, independent of business quality (Stock Attractiveness)? Additive alongside the primary Recommendation above -- neither replaces it.</p>
      <div class="grid four">
        ${card('Company Quality', cq.score == null ? '' : `${cq.score}/100`, cq.label || '', bandClass(cq.label))}
        ${card('Stock Attractiveness', sa.score == null ? '' : `${sa.score}/100`, sa.label || '', bandClass(sa.label))}
        ${card(`Fundamental View ${infoIcon('fundamentalView')}`, escape(fv.label || ''), fv.score == null ? '' : `${fv.score}/100`, bandClass(fv.label))}
        ${card(`Market View ${infoIcon('marketView')}`, escape(mv.label || ''), escape(mv.regime || ''), bandClass(mv.label))}
      </div>
      <div class="small"><b>Action guidance ${infoIcon('actionGuidance')}:</b> ${escape(r.actionGuidance || '')}</div>
    </article>`;
}
function renderCompanyResearchQuality(data) {
  const stocks = data.stocks.filter(s => !s.unresolved);
  const target = $('#cr-quality-content');
  if (!target) return;
  const compareStocks = compareMode ? compareSymbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) : [];
  target.innerHTML = compareStocks.length >= 2
    ? compareGrid(compareStocks, (s) => ({ quality: companyQualityContent(s) }), 'quality')
    : companyQualityContent(stocks.find(s => s.symbol === activeCompanySymbol));
}
// Company Research -> Growth: no per-company growth view existed before this
// redesign, only the Watchlist Research comparison table (renderGrowthTab) --
// reads the exact same already-computed stock.metrics growth fields, zero
// new calculation, same reuse pattern as ownershipDetailContent above.
function companyGrowthContent(stock) {
  if (!stock) return '<p class="small">No data yet.</p>';
  const m = stock.metrics || {};
  return `<article class="card">
      <h3>${escape(stock.name)} &mdash; growth</h3>
      <div class="grid four">
        ${card('Revenue growth 3Y', pct(m.revenueCagr3y), '', '')}
        ${card('Revenue growth 5Y', pct(m.revenueCagr5y), '', '')}
        ${card('EBITDA growth 3Y', pct(m.ebitdaCagr3y), '', '')}
        ${card('EBITDA growth 5Y', pct(m.ebitdaCagr5y), '', '')}
      </div>
      <div class="grid four">
        ${card('Profit growth 3Y', pct(m.profitCagr3y), '', '')}
        ${card('Profit growth 5Y', pct(m.profitCagr5y), '', '')}
        ${card('EPS CAGR 5Y', pct(m.epsCagr5y), '', '')}
        ${card('FCF CAGR', pct(m.fcfCagr), '', '')}
      </div>
      <div class="grid two">
        ${card('Book value CAGR', fmt(m.bookValueCagr), '', '')}
      </div>
    </article>`;
}
function renderCompanyResearchGrowth(data) {
  const stocks = data.stocks.filter(s => !s.unresolved);
  const target = $('#cr-growth-content');
  if (!target) return;
  const compareStocks = compareMode ? compareSymbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) : [];
  target.innerHTML = compareStocks.length >= 2
    ? compareGrid(compareStocks, (s) => ({ growth: companyGrowthContent(s) }), 'growth')
    : companyGrowthContent(stocks.find(s => s.symbol === activeCompanySymbol));
}
// Company Research -> Intelligence: the explainability layer. Thesis
// tracking (data/decision/thesisTracking.mjs, attached at
// data.intelligence.thesis[symbol]), the quantitative Factor Score
// (data/quant/factorEngine.mjs, stock.quantFactors) and Research Quality
// Gates (stock.researchQuality) are all already computed server-side and
// were surfaced nowhere in the live dashboard before this redesign -- the
// Factor Score wasn't even in the standalone report. Per system.md's product
// rule (Phase 7 Stage 2), the Factor Score is explicitly disclosed as a
// distinct signal that never overrides the primary Recommendation.
function companyIntelligenceContent(stock, thesis) {
  if (!stock) return '<p class="small">No data yet.</p>';
  const qf = stock.quantFactors;
  const rq = stock.researchQuality || {};
  const factorRows = qf ? Object.entries(qf.factors || {}).map(([key, f]) => `<div class="allocation-row"><span>${escape(f.label)}</span><div class="bar"><i style="width:${f.score ?? 0}%"></i></div><span>${f.score == null ? '' : `${f.score}/100`}</span></div>`).join('') : '';
  const thesisCard = thesis ? `<article class="card">
      <h3>Thesis tracking ${infoIcon('thesisStatus')}</h3>
      <div class="rec-badges"><span class="tag ${thesis.status === 'Broken' ? 'sell' : thesis.status === 'Weakening' ? 'reduce' : thesis.status === 'Improving' ? 'buy' : 'hold'}">${escape(thesis.status)}</span></div>
      <ul>${(thesis.reasons || []).map(reason => `<li>${escape(reason)}</li>`).join('') || '<li>No reasons recorded.</li>'}</ul>
      <div class="small" style="margin-top:8px"><b>Thesis breakers ${infoIcon('thesisBreakers')}</b></div>
      ${(thesis.breakers || []).map(b => `<div class="allocation-row"><span>${escape(b.condition)}</span><span class="tag ${b.status === 'Active' ? 'sell' : b.status === 'Watch' ? 'hold' : 'neutral'}">${escape(b.status)}</span></div><div class="small">${escape(b.currentReading || '')}</div>`).join('')}
    </article>` : '<article class="card"><h3>Thesis tracking</h3><p class="small">Baseline -- no prior snapshot yet to compare the thesis against.</p></article>';
  const factorCard = `<article class="card">
      <h3>Quantitative Factor Score ${infoIcon('quantFactorScore')}</h3>
      <p class="small">Institutional 6-factor framework (Value/Quality/Growth/Momentum/Risk/Size), sector-relative percentile blend. A distinct signal from the primary Recommendation above -- never blended into it.</p>
      ${qf?.factorScore == null ? `<p class="small">${escape(qf?.capNote || 'Not available for this company.')}</p>` : `<div class="kpi">${qf.factorScore}/100</div><div class="small">Confidence: ${escape(qf.confidence || '')} &middot; Normalization scope: ${escape(qf.normalizationScope || '')} (${qf.peerCount ?? 0} peers)</div>`}
      ${factorRows}
    </article>`;
  const researchQualityCard = `<article class="card">
      <h3>Research Quality Gates ${infoIcon('researchQuality')}</h3>
      <div class="grid four">
        ${card('Data completeness', escape(rq.dataCompleteness || ''), rq.dataCompletenessPct == null ? '' : `${rq.dataCompletenessPct}%`, '')}
        ${card('Valuation completeness', escape(rq.valuationCompleteness || ''), '', '')}
        ${card('Peer completeness', escape(rq.peerCompleteness || ''), '', '')}
        ${card('Evidence quality', escape(rq.evidenceQuality || ''), '', '')}
      </div>
      <div class="small">Forecast confidence: ${escape(rq.forecastConfidence || '')}</div>
    </article>`;
  const forwardCard = `<article class="card"><h3>Forward estimates ${infoIcon('forwardFramework')}</h3><p class="small">${escape(stock.forwardFramework?.forwardEstimates?.reason || 'Not available.')}</p></article>`;
  return { thesis: thesisCard, factor: factorCard, researchQuality: researchQualityCard, forward: forwardCard };
}
function renderCompanyResearchIntelligence(data) {
  const stocks = data.stocks.filter(s => !s.unresolved);
  const target = $('#cr-intelligence-content');
  if (!target) return;
  const thesisBySymbol = data.intelligence?.thesis || {};
  const compareStocks = compareMode ? compareSymbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) : [];
  if (compareStocks.length >= 2) {
    target.innerHTML = ['thesis', 'factor', 'researchQuality', 'forward']
      .map(key => compareGrid(compareStocks, (s) => companyIntelligenceContent(s, thesisBySymbol[s.symbol]), key)).join('');
  } else {
    const stock = stocks.find(s => s.symbol === activeCompanySymbol);
    const c = stock ? companyIntelligenceContent(stock, thesisBySymbol[stock.symbol]) : null;
    target.innerHTML = c ? [c.thesis, c.factor, c.researchQuality, c.forward].join('') : '<p class="small">This watchlist is empty.</p>';
  }
}
// DMA cell shows the raw moving average plus the derived CMP-vs-DMA gap %
// (Phase 2 N/A/derivation audit: CMP and each DMA are both already on the
// stock object, so the gap is a trivial arithmetic derivation, not a new
// data source) -- same inline-derivation precedent as the risk table's own
// "downside to 200-DMA/52W low" cells just below in this file.
function dmaCell(price, dma) {
  if (!Number.isFinite(dma)) return '';
  const gapPct = Number.isFinite(price) ? pct(((price - dma) / dma) * 100) : null;
  return `${fmt(dma)}${gapPct ? ` <span class="small">(${gapPct})</span>` : ''}`;
}
// DMA alignment: how many of the 4 DMAs price currently sits above -- a
// compact derived summary rather than 4 extra table columns, so the Trend
// table stays a single-glance width.
function dmaAlignmentLabel(stock) {
  const dmas = [stock.twenty, stock.fifty, stock.hundred, stock.twoHundred];
  const known = dmas.filter(Number.isFinite);
  if (!known.length || !Number.isFinite(stock.price)) return '';
  const above = dmas.filter(d => Number.isFinite(d) && stock.price > d).length;
  return `${above}/${known.length} above`;
}
// The one wide technical scorecard table splits into six narrower ones (one
// per sub-tab) via the same renderTable()/prefixCells() helper -- same
// fields off `stock`/`technicalScorecard.scores`, just a smaller column
// subset per call. Several columns here (RSI state, current/avg volume,
// relative-strength components + benchmark identity, real volatility %,
// signal confidence, ADX interpretation) are already-computed fields that
// existed on the payload but had no Watchlist Research column before this
// redesign -- see the Watchlist Research IA audit's N/A/derivation section.
const TREND_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, trend: s => s.trend || null, dma20: s => s.twenty, dma50: s => s.fifty, dma100: s => s.hundred, dma200: s => s.twoHundred,
  dmaAlignment: s => { const dmas = [s.twenty, s.fifty, s.hundred, s.twoHundred]; return Number.isFinite(s.price) ? dmas.filter(d => Number.isFinite(d) && s.price > d).length : null; },
  trendScore: s => s.technicalScorecard?.scores?.trendStrengthScore,
  adx: s => s.technicalScorecard?.adx, diPlus: s => s.technicalScorecard?.diPlus, diMinus: s => s.technicalScorecard?.diMinus,
  support: s => s.support, resistance: s => s.resistance
};
const MOMENTUM_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, rsi: s => s.rsi, momentum: s => s.momentum || null, momentumScore: s => s.technicalScorecard?.scores?.momentumScore,
  macdLine: s => s.macd?.macdLine, signalLine: s => s.macd?.signalLine, histogram: s => s.macd?.histogram
};
const VOLUME_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, volumeTrend: s => s.volumeTrend || null, volume: s => s.volume, avgVolume20: s => s.avgVolume20,
  obv: s => s.technicalScorecard?.obv?.value, obvTrend: s => s.technicalScorecard?.obv?.trend || null,
  accDist: s => s.technicalScorecard?.accDist?.value, accDistTrend: s => s.technicalScorecard?.accDist?.trend || null
};
const RELATIVE_STRENGTH_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, stock1y: s => s.performance?.periods?.['1Y']?.stockReturnPct, benchmark1y: s => s.performance?.periods?.['1Y']?.benchmarkReturnPct,
  relativeStrength: s => s.relativeStrengthPct, benchmark: s => s.performance?.benchmark?.name || s.performance?.benchmark?.symbol || null,
  cagr3y: s => s.performance?.cagr?.['3Y']?.stockCagrPct, cagr5y: s => s.performance?.cagr?.['5Y']?.stockCagrPct,
  maxDrawdown: s => s.performance?.risk?.maxDrawdown?.stockPct, sharpeLike: s => s.performance?.riskAdjusted?.sharpeLike?.value,
  sortinoLike: s => s.performance?.riskAdjusted?.sortinoLike?.value
};
const VOLATILITY_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, volatilityPct: s => s.volatilityPct, volatilityScore: s => s.technicalScorecard?.scores?.volatilityScore,
  atr: s => s.technicalScorecard?.atr, atrPct: s => s.technicalScorecard?.atrPct
};
const SIGNALS_TABLE_SORT = {
  ...STANDARD_SORT_KEYS, breakoutScore: s => s.technicalScorecard?.scores?.breakoutProbability, regime: s => s.technicalScorecard?.regime || null,
  signalConfidence: s => CONVICTION_RANK[s.technicalScorecard?.signalConfidence] || null, adxInterpretation: s => s.technicalScorecard?.adxInterpretation || null
};
// Technicals parity pass: ADX/DI+/DI-/Support/Resistance (Trend), MACD line/
// Signal line/Histogram (Momentum), OBV/OBV trend/Accumulation-Distribution/
// its trend (Volume), ATR/ATR% (Volatility) were already computed
// server-side and shown on Company Research's per-company indicators card
// (technicalDetailContent) but had no Watchlist Research column -- every
// field below is read off the same `stock.technicalScorecard`/`stock.macd`/
// `stock.support`/`stock.resistance` that card already uses, zero new
// calculation. Placement follows the brief's own grouping (ADX = trend
// strength, so it sits in Trend rather than duplicating the Signals tab's
// existing ADX *interpretation* label -- a different, complementary read of
// the same underlying indicator, not a repeated column).
function renderTechnicalTab(stocks) {
  const scores = (stock) => stock.technicalScorecard?.scores || {};
  renderTable('#technical-table-trend', sortForTable('technical-table-trend', stocks, TREND_TABLE_SORT), stock => {
    const t = stock.technicalScorecard || {};
    return `<td class="derived">${escape(stock.trend || '')}</td><td class="num derived">${dmaCell(stock.price, stock.twenty)}</td><td class="num derived">${dmaCell(stock.price, stock.fifty)}</td><td class="num derived">${dmaCell(stock.price, stock.hundred)}</td><td class="num derived">${dmaCell(stock.price, stock.twoHundred)}</td><td class="derived">${dmaAlignmentLabel(stock)}</td><td class="num derived">${scoreText(scores(stock).trendStrengthScore)}</td>` +
      `<td class="num derived" title="${escape(t.adxInterpretation || '')}">${fmt(t.adx)}</td><td class="num derived">${fmt(t.diPlus)}</td><td class="num derived">${fmt(t.diMinus)}</td>` +
      `<td class="num derived">${fmt(stock.support)}</td><td class="num derived">${stock.atHigh ? 'At high' : fmt(stock.resistance)}</td>`;
  }, { num: true });
  initTableSort('technical-table-trend');
  initTableLayout('technical-table-trend', { resetButtonId: 'technical-table-trend-reset-columns' });
  renderTable('#technical-table-momentum', sortForTable('technical-table-momentum', stocks, MOMENTUM_TABLE_SORT), stock => {
    const macd = stock.macd || {};
    return `<td class="num derived">${fmt(stock.rsi)}</td><td class="derived">${escape(stock.momentum || '')}</td><td class="num derived">${scoreText(scores(stock).momentumScore)}</td><td class="num derived">${fmt(macd.macdLine)}</td><td class="num derived">${fmt(macd.signalLine)}</td><td class="num derived">${fmt(macd.histogram)}</td>`;
  }, { num: true });
  initTableSort('technical-table-momentum');
  initTableLayout('technical-table-momentum', { resetButtonId: 'technical-table-momentum-reset-columns' });
  renderTable('#technical-table-volume', sortForTable('technical-table-volume', stocks, VOLUME_TABLE_SORT), stock => {
    const t = stock.technicalScorecard || {};
    return `<td class="derived">${escape(stock.volumeTrend || '')}</td><td class="num">${stock.volume == null ? '' : compact(stock.volume)}</td><td class="num derived">${stock.avgVolume20 == null ? '' : compact(stock.avgVolume20)}</td>` +
      `<td class="num derived">${t.obv?.value == null ? '' : compact(t.obv.value)}</td><td class="derived">${escape(t.obv?.trend || '')}</td>` +
      `<td class="num derived">${t.accDist?.value == null ? '' : compact(t.accDist.value)}</td><td class="derived">${escape(t.accDist?.trend || '')}</td>`;
  }, { num: true });
  initTableSort('technical-table-volume');
  initTableLayout('technical-table-volume', { resetButtonId: 'technical-table-volume-reset-columns' });
  renderTable('#technical-table-relative-strength', sortForTable('technical-table-relative-strength', stocks, RELATIVE_STRENGTH_TABLE_SORT), stock => {
    const p1y = stock.performance?.periods?.['1Y'];
    const benchmark = stock.performance?.benchmark;
    const cagr3y = stock.performance?.cagr?.['3Y'], cagr5y = stock.performance?.cagr?.['5Y'];
    const dd = stock.performance?.risk?.maxDrawdown, sharpe = stock.performance?.riskAdjusted?.sharpeLike, sortino = stock.performance?.riskAdjusted?.sortinoLike;
    return `<td class="num derived">${p1y?.stockReturnPct == null ? '' : pct(p1y.stockReturnPct)}</td><td class="num derived">${p1y?.benchmarkReturnPct == null ? '' : pct(p1y.benchmarkReturnPct)}</td><td class="num derived">${pct(stock.relativeStrengthPct)}</td><td>${escape(benchmark?.name || benchmark?.symbol || '')}</td><td class="num derived">${cagr3y?.stockCagrPct == null ? '' : pct(cagr3y.stockCagrPct)}</td><td class="num derived">${cagr5y?.stockCagrPct == null ? '' : pct(cagr5y.stockCagrPct)}</td>` +
      `<td class="num derived">${dd?.stockPct == null ? '' : pct(dd.stockPct)}</td><td class="num derived">${sharpe?.value == null ? '' : fmt(sharpe.value)}</td><td class="num derived">${sortino?.value == null ? '' : fmt(sortino.value)}</td>`;
  }, { num: true });
  initTableSort('technical-table-relative-strength');
  initTableLayout('technical-table-relative-strength', { resetButtonId: 'technical-table-relative-strength-reset-columns' });
  renderTable('#technical-table-volatility', sortForTable('technical-table-volatility', stocks, VOLATILITY_TABLE_SORT), stock => {
    const t = stock.technicalScorecard || {};
    return `<td class="num derived">${stock.volatilityPct == null ? '' : pct(stock.volatilityPct)}</td><td class="num derived">${scoreText(scores(stock).volatilityScore, true)}</td><td class="num derived">${fmt(t.atr)}</td><td class="num derived">${t.atrPct == null ? '' : pct(t.atrPct)}</td>`;
  }, { num: true });
  initTableSort('technical-table-volatility');
  initTableLayout('technical-table-volatility', { resetButtonId: 'technical-table-volatility-reset-columns' });
  renderTable('#technical-table-signals', sortForTable('technical-table-signals', stocks, SIGNALS_TABLE_SORT), stock => `<td class="num derived">${scoreText(scores(stock).breakoutProbability)}</td><td class="derived">${escape(stock.technicalScorecard?.regime || '')}</td><td class="derived">${escape(stock.technicalScorecard?.signalConfidence || '')}</td><td class="derived">${escape(stock.technicalScorecard?.adxInterpretation || '')}</td>`, { num: true });
  initTableSort('technical-table-signals');
  initTableLayout('technical-table-signals', { resetButtonId: 'technical-table-signals-reset-columns' });
}
const PORTFOLIO_TABLE_SORT = { ...STANDARD_SORT_KEYS, quality: s => s.score, weight: s => s.effectiveWeightPct, bucket: s => s.score };
function renderPortfolioTab(stocks) {
  const bucketFor = (score) => score >= 70 ? 'Core' : score >= 55 ? 'Growth' : 'Satellite';
  const sorted = sortForTable('portfolio-table', stocks, PORTFOLIO_TABLE_SORT);
  renderTable('#portfolio-table', sorted, stock => `<td class="num derived">${fmt(stock.score)}/100</td><td class="num derived">${fmt(stock.effectiveWeightPct)}%</td><td class="derived">${escape(bucketFor(stock.score || 0))}</td>`, { num: true });
  initTableSort('portfolio-table');
  initTableLayout('portfolio-table', { resetButtonId: 'portfolio-table-reset-columns' });
}

// ---- Shared pill-selector component: same per-stock deep-dive pattern
// first built for the Fundamentals tab, reused for Valuation/Technicals/
// Risks so none of them invent a second selector widget. ----
function renderPillSelector(containerSelector, stocks, selectedSymbol, onSelect) {
  $(containerSelector).innerHTML = stocks.map(stock =>
    `<button type="button" class="pill ${stock.symbol === selectedSymbol ? 'active' : ''}" data-symbol="${escape(stock.symbol)}">${escape(stock.name)}</button>`
  ).join('');
  $$(`${containerSelector} .pill`).forEach(button => button.addEventListener('click', () => onSelect(button.dataset.symbol)));
}
// Same widget, but branches on compare mode: single-select (-> setActiveCompany)
// when off, multi-select up to 4 (-> toggleCompareSymbol) when on -- shared by
// Valuation/Technicals/Risks, the three compare-eligible deep-dive tabs.
function renderCompareAwarePillSelector(containerSelector, stocks) {
  if (compareMode) {
    $(containerSelector).innerHTML = stocks.map(stock =>
      `<button type="button" class="pill ${compareSymbols.includes(stock.symbol) ? 'active' : ''}" data-symbol="${escape(stock.symbol)}">${escape(stock.name)}</button>`
    ).join('');
    $$(`${containerSelector} .pill`).forEach(button => button.addEventListener('click', () => toggleCompareSymbol(button.dataset.symbol)));
  } else {
    renderPillSelector(containerSelector, stocks, activeCompanySymbol, (symbol) => setActiveCompany(symbol));
  }
}
const clampPct = (v) => Math.max(0, Math.min(100, v));

// ---- Valuation deep-dive: DCF (Bull/Base/Bear + sensitivity), historical
// P/E-P/B percentile, relative valuation vs. sector/watchlist peers. ----
function fairValueBand(dcf, price) {
  const values = { Bear: dcf.bear, Base: dcf.base, Bull: dcf.bull, CMP: price };
  const finite = Object.values(values).filter(Number.isFinite);
  if (finite.length < 2) return '';
  const lo = Math.min(...finite) * 0.95, hi = Math.max(...finite) * 1.05;
  const markers = Object.entries(values).filter(([, v]) => Number.isFinite(v)).map(([label, v]) =>
    `<div class="band-marker${label === 'CMP' ? ' cmp' : ''}" style="left:${clampPct(((v - lo) / (hi - lo)) * 100)}%"><i></i><span>${escape(label)}<br>${fmt(v)}</span></div>`
  ).join('');
  return `<div class="band">${markers}</div>`;
}
function sensitivityTable(sensitivity) {
  if (!sensitivity?.length) return '<p class="small">Not available.</p>';
  const header = `<tr><th>WACC \\ Terminal growth</th>${sensitivity[0].row.map(cell => `<th class="num">${fmt(cell.terminalGrowthPct)}%</th>`).join('')}</tr>`;
  const body = sensitivity.map(row => `<tr><th scope="row">${fmt(row.waccPct)}%</th>${row.row.map(cell => `<td class="num">${fmt(cell.fairValue)}</td>`).join('')}</tr>`).join('');
  return `<div class="scroll"><table class="tech-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
}
function percentileBar(label, percentile, key) {
  return `<div class="allocation-row"><span>${escape(label)} ${infoIcon(key)}</span><div class="bar"><i style="width:${percentile ?? 0}%"></i></div><span>${percentile == null ? '' : percentile + 'th pct'}</span></div>`;
}
const RV_LABELS = { pe: 'P/E', pb: 'P/B', peg: 'PEG', roe: 'ROE', roce: 'ROCE', revenueCagr3y: 'Revenue growth 3Y', epsCagr3y: 'EPS growth 3Y', dividendYield: 'Dividend yield' };
const RV_FORMAT = { roe: pct, roce: pct, revenueCagr3y: pct, epsCagr3y: pct, dividendYield: pct };
function relativeValuationTable(rv) {
  if (!rv) return '<p class="small">Not available.</p>';
  const rows = rv.comparison.map(row => {
    const f = RV_FORMAT[row.key] || fmt;
    return `<tr><th scope="row">${escape(RV_LABELS[row.key] || row.key)}</th><td class="num">${f(row.value)}</td><td class="num">${f(row.sectorMedian)}</td><td class="num">${f(row.sectorLeader)}</td><td class="num">${row.historicalAverage == null ? '' : f(row.historicalAverage)}</td><td class="num">${f(row.watchlistAverage)}</td></tr>`;
  }).join('');
  return `<div class="scroll"><table class="tech-table"><thead><tr><th>Metric</th><th class="num">This stock</th><th class="num">Sector median</th><th class="num">Sector leader</th><th class="num">Historical avg</th><th class="num">Watchlist avg</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
// Recommendation summary card: the same rating/confidence/primary-driver the
// Top Opportunities badge shows, plus the 5-bucket breakdown and any
// consistency cap applied -- shown once at the top of the Valuation
// deep-dive so this tab can never silently disagree with the rest of the app.
function recommendationSummaryCard(stock) {
  const r = stock.recommendation;
  if (!r) return '';
  const buckets = Object.values(r.components || {}).map(b => card(b.label, b.score == null ? '' : `${b.score}/100`, `Weight ${b.weight}%`, '')).join('');
  return `<article class="card">
      <h3>Recommendation ${infoIcon('compositeScore')}</h3>
      <div class="rec-badges">${signalTag(stock)} <span class="tag ${r.confidence === 'High' ? 'buy' : r.confidence === 'Medium' ? 'hold' : 'neutral'}">${escape(r.confidence || '')} confidence</span></div>
      <div class="small">Primary driver: ${escape(r.primaryDriver || '')}${r.compositeScore != null ? ` &middot; Composite score ${r.compositeScore}/100` : ''}</div>
      ${r.capNote ? `<div class="notice amber">${escape(r.capNote)}</div>` : ''}
      <div class="grid five">${buckets}</div>
    </article>`;
}
function financialValuationCard(fv, price) {
  if (!fv?.available) {
    return `<article class="card"><h3>DCF valuation ${infoIcon('dcfFairValue')}</h3><p class="small"><b>DCF not applicable for financial institutions.</b> Alternative valuation: justified Price-to-Book / excess-return model. Not available: ${escape(fv?.reason || 'insufficient data')}.</p>
      <p class="small">${escape(fv?.methodology || '')}</p></article>`;
  }
  return `<article class="card">
      <h3>Financial-sector valuation &mdash; Bull / Base / Bear ${infoIcon('financialSectorValuation')}</h3>
      <p class="small"><b>DCF not applicable for financial institutions.</b> Shown instead: a justified Price-to-Book / excess-return valuation.</p>
      ${fairValueBand(fv, price)}
      <div class="grid four">
        ${card('Bear', fmt(fv.bear), 'Downside scenario', 'amber')}
        ${card('Base', fmt(fv.base), 'Central estimate', 'blue')}
        ${card('Bull', fmt(fv.bull), 'Upside scenario', 'positive')}
        ${card('Current price', fmt(price), '', '')}
      </div>
      <div class="grid four">
        ${card('Cost of equity', pct(fv.costOfEquityPct), `Risk-free ${pct(fv.assumptions?.riskFreeRatePct)}, ERP ${pct(fv.assumptions?.equityRiskPremiumPct)}`, '')}
        ${card('ROE', pct(fv.roePct), `Justified P/B ${fmt(fv.justifiedPB)}x on book value ${fmt(fv.bookValuePerShare)}`, '')}
        ${card('Sustainable growth (g)', pct(fv.sustainableGrowthPct), fv.payoutPct == null ? 'Payout ratio unavailable -- terminal-growth assumption used' : `From ${pct(fv.payoutPct)} payout ratio`, '')}
        ${card('Valuation confidence', fv.valuationConfidenceScore == null ? '' : `${fv.valuationConfidenceScore}/100`, fv.confidenceBand || '', fv.confidenceBand === 'High' ? 'positive' : fv.confidenceBand === 'Medium' ? 'amber' : '')}
      </div>
      <p class="small">${escape(fv.methodology || '')}</p>
    </article>`;
}
// Returns a {recommendation, dcf, reverseDcf, sensitivity, relative,
// percentile} fragment map -- one per Valuation deep-dive sub-tab -- instead
// of one concatenated string. The DCF card's sensitivity table and reverse-
// DCF stat were previously two sub-blocks glued inside the main DCF card;
// they're pulled out into their own fragments here (same markup, no new
// computation) since Sensitivity and Reverse DCF are each their own sub-tab.
function valuationDetailContent(stock) {
  if (!stock) return { recommendation: '', dcf: '<p class="small">No data yet.</p>', reverseDcf: '', sensitivity: '', relative: '', percentile: '' };
  const dcf = stock.dcf || {}, rv = stock.relativeValuation;
  const notApplicableCard = (title, key, reason) => `<article class="card"><h3>${escape(title)} ${infoIcon(key)}</h3><p class="small">${escape(reason)}</p></article>`;
  let dcfCard, reverseDcfCard, sensitivityCard;
  if (dcf.sectorExcluded) {
    dcfCard = financialValuationCard(stock.financialValuation, stock.price);
    reverseDcfCard = notApplicableCard('Reverse DCF', 'dcfFairValue', 'Not applicable for financial institutions -- a levered free cash flow model doesn\'t map to their balance sheets. See the DCF sub-tab for the alternative Price-to-Book / excess-return model used instead.');
    sensitivityCard = notApplicableCard('Sensitivity', 'dcfFairValue', 'Not applicable for financial institutions (no DCF fair value to sensitize).');
  } else if (!dcf.available) {
    const reason = `Not available: ${escape(dcf.reason || 'insufficient data')}.`;
    dcfCard = `<article class="card"><h3>DCF valuation ${infoIcon('dcfFairValue')}</h3><p class="small">${reason}</p></article>`;
    reverseDcfCard = `<article class="card"><h3>Reverse DCF ${infoIcon('dcfFairValue')}</h3><p class="small">${reason}</p></article>`;
    sensitivityCard = `<article class="card"><h3>Sensitivity ${infoIcon('dcfFairValue')}</h3><p class="small">${reason}</p></article>`;
  } else {
    dcfCard = `<article class="card">
        <h3>DCF valuation &mdash; Bull / Base / Bear ${infoIcon('dcfFairValue')}</h3>
        ${fairValueBand(dcf, stock.price)}
        <div class="grid four">
          ${card('Bear', fmt(dcf.bear), 'Downside scenario', 'amber')}
          ${card('Base', fmt(dcf.base), 'Central estimate', 'blue')}
          ${card('Bull', fmt(dcf.bull), 'Upside scenario', 'positive')}
          ${card('Current price', fmt(stock.price), '', '')}
        </div>
        <div class="grid four">
          ${card('WACC', pct(dcf.wacc?.waccPct), `Cost of equity ${pct(dcf.wacc?.costOfEquityPct)}, cost of debt ${pct(dcf.wacc?.costOfDebtPct)}`, '')}
          ${card('Terminal growth', pct(dcf.assumptions?.terminalGrowthPct), `Risk-free ${pct(dcf.assumptions?.riskFreeRatePct)}, ERP ${pct(dcf.assumptions?.equityRiskPremiumPct)}`, '')}
          ${card('Valuation confidence', dcf.valuationConfidenceScore == null ? '' : `${dcf.valuationConfidenceScore}/100`, dcf.confidenceBand || '', dcf.confidenceBand === 'High' ? 'positive' : dcf.confidenceBand === 'Medium' ? 'amber' : '')}
        </div>
        <p class="small">${escape(dcf.methodology || '')}</p>
      </article>`;
    reverseDcfCard = `<article class="card">
        <h3>Reverse DCF implied growth ${infoIcon('dcfFairValue')}</h3>
        <div class="grid four">${card('Implied growth rate', pct(dcf.reverseImpliedGrowthPct), 'Growth rate that justifies the current price', '')}</div>
        <p class="small">Solves the same DCF model backwards from today's price instead of forward from an assumed growth rate -- the growth the market is already paying for.</p>
      </article>`;
    sensitivityCard = `<article class="card">
        <h3>Sensitivity: fair value by WACC &times; terminal growth ${infoIcon('dcfFairValue')}</h3>
        ${sensitivityTable(dcf.sensitivity)}
      </article>`;
  }
  const percentileCard = `<article class="card">
      <h3>Historical valuation percentile ${infoIcon('peHistoricalPercentile')}</h3>
      ${percentileBar('P/E percentile', stock.peHistoricalPercentile, 'peHistoricalPercentile')}
      ${percentileBar('P/B percentile', stock.pbHistoricalPercentile, 'pbHistoricalPercentile')}
      <p class="small">Reconstructed from real reported EPS/book value against the nearest available historical price &mdash; an approximation, not exact fiscal-year-end closes. EV/EBITDA percentile is not available (Enterprise Value is unavailable app-wide).</p>
    </article>`;
  function historicalBandDisplay(band) {
    if (!band) return '<p class="small">Not available.</p>';
    return `<div class="small">Historical implied P/E range: ${fmt(band.min)}&ndash;${fmt(band.max)} (25th ${fmt(band.p25)}, median ${fmt(band.median)}, 75th ${fmt(band.p75)}). Current P/E ${fmt(band.currentPe)} is ${band.positionVsOwnHistoryPct == null ? '' : `${pct(band.positionVsOwnHistoryPct)} vs. its own historical median`}.</div>`;
  }
  const rvCard = `<article class="card">
      <h3>Relative valuation ${infoIcon('relativeValuationScore')}</h3>
      <div class="grid four">
        ${card('Relative valuation score', rv?.relativeValuationScore == null ? '' : `${rv.relativeValuationScore}/100`, 'Share of metrics beating sector median', '')}
        ${card('Premium/discount', rv?.premiumDiscountScore == null ? '' : pct(rv.premiumDiscountScore), 'Avg deviation from sector median P/E-P/B-PEG', '')}
        ${card('Sector rank', rv ? `${rv.sectorRank}/${rv.sectorPeerCount}` : '', 'By ROCE/ROE within this watchlist\'s same-sector peers', '')}
        ${card('Watchlist rank', rv ? `${rv.watchlistRank}/${rv.watchlistCount}` : '', 'By ROCE/ROE within the full watchlist', '')}
      </div>
      <div class="grid four">
        ${card(`Peer tier ${infoIcon('peerTier')}`, rv?.peerTier || '', `${rv?.peerCount ?? 0} real peer(s) in this watchlist`, '')}
        ${card(`Peer completeness ${infoIcon('peerCompleteness')}`, rv?.peerCompleteness || '', rv?.peerInsufficiencyReason || '', rv?.peerCompleteness === 'Strong' ? 'positive' : rv?.peerCompleteness === 'Weak' || rv?.peerCompleteness === 'Unavailable' ? 'amber' : '')}
      </div>
      <div class="grid four">
        ${card(`Sector-adjusted valuation rank ${infoIcon('sectorValuationRank')}`, rv ? `${rv.sectorValuationRank}/${rv.sectorPeerCount}` : '', 'Cheapest-vs-sector-median first', '')}
        ${card(`Multi-factor peer rank ${infoIcon('multiFactorPeerScore')}`, rv ? `${rv.multiFactorPeerRank}/${rv.sectorPeerCount}` : '', rv?.multiFactorPeerScore == null ? '' : `Score ${rv.multiFactorPeerScore}/100 (Value 40% / Quality 35% / Growth 25%)`, '')}
        ${card(`Sector-normalized score ${infoIcon('sectorNormalizedValuationScore')}`, rv?.sectorNormalizedValuationScore == null ? '' : `${rv.sectorNormalizedValuationScore}/100`, 'Continuous z-score vs. sector peers', '')}
        ${card(`Watchlist percentile ${infoIcon('watchlistValuationPercentile')}`, rv?.watchlistValuationPercentile == null ? '' : `${rv.watchlistValuationPercentile}th`, 'Cheapness percentile across the watchlist', '')}
      </div>
      <div class="grid two">
        ${card(`Relative attractiveness score ${infoIcon('relativeAttractivenessScore')}`, rv?.relativeAttractivenessScore == null ? '' : `${rv.relativeAttractivenessScore}/100`, 'Blend of relative valuation, sector-normalized and multi-factor peer scores', (rv?.relativeAttractivenessScore ?? 0) >= 65 ? 'positive' : (rv?.relativeAttractivenessScore ?? 100) < 40 ? 'amber' : '')}
        <div class="card"><div class="small"><b>Historical valuation band ${infoIcon('historicalValuationBand')}</b></div>${historicalBandDisplay(rv?.historicalValuationBand)}</div>
      </div>
      ${relativeValuationTable(rv)}
    </article>`;
  return { recommendation: recommendationSummaryCard(stock), dcf: dcfCard, reverseDcf: reverseDcfCard, sensitivity: sensitivityCard, relative: rvCard, percentile: percentileCard };
}
function renderValuationDispersion(data) {
  const entries = Object.entries(data.valuationDispersion || {});
  $('#valuation-dispersion-info').innerHTML = infoIcon('valuationDispersion');
  $('#valuation-dispersion').innerHTML = entries.length ? `<table class="tech-table"><thead><tr><th>Sector</th><th class="num">Sample</th><th class="num">Mean P/E</th><th class="num">Median P/E</th><th class="num">Std. dev.</th><th class="num">Min</th><th class="num">Max</th><th class="num">Coeff. of variation</th></tr></thead><tbody>${
    entries.map(([sector, d]) => `<tr><th scope="row">${escape(sector)}</th><td class="num">${d.sampleSize}</td><td class="num">${fmt(d.mean)}</td><td class="num">${fmt(d.median)}</td><td class="num">${fmt(d.stdDev)}</td><td class="num">${fmt(d.min)}</td><td class="num">${fmt(d.max)}</td><td class="num">${d.coefficientOfVariation == null ? '' : `${fmt(d.coefficientOfVariation)}%`}</td></tr>`).join('')
  }</tbody></table>` : '<p class="small">Not available.</p>';
}
function renderValuationDetail(data) {
  const stocks = data.stocks.filter(s => !s.unresolved);
  ensureActiveCompany(stocks);
  // Company Research UI audit: the top-of-page "Company" pill-row switcher
  // (#valuation-selector) was removed as a duplicate of the header's own
  // company-selector dropdown (#company-selector-toggle) -- same function,
  // two widgets. That header dropdown remains the one company switcher for
  // this workspace; nothing here renders into #valuation-selector anymore.
  $('#valuation-info').innerHTML = infoIcon('dcfFairValue');
  const empty = '<p class="small">This watchlist is empty.</p>';
  const compareStocks = compareMode ? compareSymbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) : [];
  if (compareStocks.length >= 2) {
    $('#valuation-recommendation').innerHTML = compareGrid(compareStocks, valuationDetailContent, 'recommendation');
    $('#valuation-detail-dcf').innerHTML = compareGrid(compareStocks, valuationDetailContent, 'dcf');
    $('#valuation-detail-reverse-dcf').innerHTML = compareGrid(compareStocks, valuationDetailContent, 'reverseDcf');
    $('#valuation-detail-sensitivity').innerHTML = compareGrid(compareStocks, valuationDetailContent, 'sensitivity');
    $('#valuation-detail-relative').innerHTML = compareGrid(compareStocks, valuationDetailContent, 'relative');
    $('#valuation-detail-historical').innerHTML = compareGrid(compareStocks, valuationDetailContent, 'percentile');
  } else {
    const c = stocks.length ? valuationDetailContent(stocks.find(s => s.symbol === activeCompanySymbol)) : null;
    $('#valuation-recommendation').innerHTML = c ? c.recommendation : empty;
    $('#valuation-detail-dcf').innerHTML = c ? c.dcf : empty;
    $('#valuation-detail-reverse-dcf').innerHTML = c ? c.reverseDcf : empty;
    $('#valuation-detail-sensitivity').innerHTML = c ? c.sensitivity : empty;
    $('#valuation-detail-relative').innerHTML = c ? c.relative : empty;
    $('#valuation-detail-historical').innerHTML = c ? c.percentile : empty;
  }
  renderValuationDispersion(data);
}

// Company Research -> Overview: a small single-company summary card off
// fields already computed elsewhere in the payload (price/signal/
// confidence/sector/key metrics) -- pure presentation, same reuse pattern
// as recommendationSummaryCard above, not a second calculation.
// Extended (IA redesign) to cover the full "Investment Snapshot" field list --
// Recommendation/Confidence/Composite/Upside/Primary Driver/Regime/Risk
// score/Action -- all already computed elsewhere in this payload
// (`data.intelligence.actionScores`, `stock.technicalScorecard.regime`,
// `stock.institutionalRisk.compositeRiskScore` -- the same fields
// renderWrOverviewTable already reads), so this stays a pure reformat.
function companyOverviewContent(stock, actionScores = {}) {
  if (!stock) return '<p class="small">This watchlist is empty.</p>';
  const r = stock.recommendation || {};
  return `<article class="card">
      <h3>${escape(stock.name)} <span class="small">(${escape(stock.symbol)})</span></h3>
      <div class="rec-badges">${signalTag(stock)} <span class="tag ${r.confidence === 'High' ? 'buy' : r.confidence === 'Medium' ? 'hold' : 'neutral'}">${escape(r.confidence || '')} confidence</span></div>
      <div class="grid four">
        ${card('CMP', `${fmt(stock.price)} ${escape(stock.currency || '')}`, escape(stock.sector || ''), '')}
        ${card('Composite score', r.compositeScore == null ? '' : `${r.compositeScore}/100`, '', '')}
        ${card('Upside to target', pct(stock.valuation?.upsidePct), '', '')}
        ${card('Primary driver', escape(r.primaryDriver || ''), '', '')}
      </div>
      <div class="grid four">
        ${card('Regime', escape(stock.technicalScorecard?.regime || ''), '', '')}
        ${card('Risk score', stock.institutionalRisk?.compositeRiskScore == null ? '' : `${stock.institutionalRisk.compositeRiskScore}/100`, '', '')}
        ${card('Action', actionScoreBadge(actionScores[stock.symbol]), '', '')}
      </div>
      ${r.capNote ? `<div class="notice amber">${escape(r.capNote)}</div>` : ''}
    </article>`;
}
// "Key Investment Metrics" -- one flagship metric per Valuation/Quality/
// Growth/Technical/Risk domain, answering "why research this company"
// without duplicating the decision-oriented Snapshot card above (different
// analytical purpose: a fundamentals-style scan vs. the model's own read).
function companyKeyMetricsContent(stock) {
  if (!stock) return '';
  const m = stock.metrics || {};
  return `<article class="card">
      <h3>Key investment metrics</h3>
      <div class="grid five">
        ${card('P/E', fmt(stock.pe), 'Valuation', '')}
        ${card('ROE', pct(m.roe), 'Quality', '')}
        ${card('Revenue growth 5Y', pct(m.revenueCagr5y), 'Growth', '')}
        ${card('Trend', escape(stock.trend || ''), 'Technical', '')}
        ${card('Risk trend', escape(stock.institutionalRisk?.riskTrend || ''), 'Risk', '')}
      </div>
    </article>`;
}
function renderCompanyResearchOverview(data) {
  const stocks = data.stocks.filter(s => !s.unresolved);
  const target = $('#cr-overview-content');
  const keyMetricsTarget = $('#cr-key-metrics-content');
  if (!target) return;
  const actionScores = data.intelligence?.actionScores || {};
  const compareStocks = compareMode ? compareSymbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) : [];
  if (compareStocks.length >= 2) {
    target.innerHTML = compareGrid(compareStocks, (s) => ({ overview: companyOverviewContent(s, actionScores) }), 'overview');
    if (keyMetricsTarget) keyMetricsTarget.innerHTML = compareGrid(compareStocks, (s) => ({ metrics: companyKeyMetricsContent(s) }), 'metrics');
  } else {
    const stock = stocks.find(s => s.symbol === activeCompanySymbol);
    target.innerHTML = companyOverviewContent(stock, actionScores);
    if (keyMetricsTarget) keyMetricsTarget.innerHTML = companyKeyMetricsContent(stock);
  }
}

// ---- Technical deep-dive: ADX/ATR/OBV/A-D, MACD, support/resistance,
// multi-timeframe trend, volume profile. ----
// Returns a {indicators, multiTimeframe, advancedScores, volumeProfile}
// fragment map -- these four cards are each assigned whole to their closest-
// matching Technicals sub-tab (Momentum/Trend/Signals/Volume respectively);
// none of their internals are split apart.
function technicalDetailContent(stock) {
  const empty = '<p class="small">No data yet.</p>';
  if (!stock) return { indicators: empty, multiTimeframe: empty, advancedScores: empty, volumeProfile: empty, relativePerformance: empty };
  const t = stock.technicalScorecard || {}, tf = t.timeframes || {}, vp = t.volumeProfile || {}, macd = stock.macd || {}, adv = t.advancedScores || {};
  const indicators = `
    <article class="card">
      <h3>${escape(stock.name)} &mdash; indicators ${infoIcon('adx')}</h3>
      <div class="grid four">
        ${card('ADX (14)', fmt(t.adx), `${escape(t.adxInterpretation || '')} &middot; DI+ ${fmt(t.diPlus)} / DI- ${fmt(t.diMinus)}`, '')}
        ${card('ATR (14)', fmt(t.atr), `ATR % of price: ${t.atrPct == null ? '' : pct(t.atrPct)}`, '')}
        ${card('OBV', t.obv?.value == null ? '' : compact(t.obv.value), t.obv?.trend || '', '')}
        ${card('Accumulation/Distribution', t.accDist?.value == null ? '' : compact(t.accDist.value), t.accDist?.trend || '', '')}
      </div>
      <div class="grid four">
        ${card('MACD line', fmt(macd.macdLine), '', '')}
        ${card('Signal line', fmt(macd.signalLine), '', '')}
        ${card('Histogram', fmt(macd.histogram), '', '')}
        ${card('Support / Resistance', `${fmt(stock.support)} / ${stock.atHigh ? 'At high' : fmt(stock.resistance)}`, 'Heuristic off real levels', '')}
      </div>
    </article>`;
  const multiTimeframe = `
    <article class="card">
      <h3>Multi-timeframe trend ${infoIcon('multiTimeframeTrend')}</h3>
      <div class="grid four">
        ${card('Daily', escape(tf.daily || ''), '', '')}
        ${card('Weekly', escape(tf.weekly || ''), '', '')}
        ${card('Monthly', escape(tf.monthly || ''), '', '')}
        ${card('Aligned read', escape(tf.aligned || ''), `Confirmation: ${tf.confirmationCount ?? ''}/3 (${escape(tf.confirmationStrength || '')})`, tf.aligned === 'Uptrend' ? 'positive' : tf.aligned === 'Downtrend' ? 'amber' : '')}
      </div>
    </article>`;
  const advancedScores = `
    <article class="card">
      <h3>Advanced scores ${infoIcon('technicalScores')}</h3>
      <div class="grid four">
        ${card('Volume-weighted momentum', scoreText(adv.volumeWeightedMomentum), '', '')}
        ${card('Trend persistence', scoreText(adv.trendPersistenceScore), 'R² of a trailing-50-close linear fit', '')}
        ${card('Breakout quality', scoreText(adv.breakoutQualityScore), 'Volume + ADX-confirmed breakout read', '')}
        ${card('Volatility-adjusted momentum', scoreText(adv.volatilityAdjustedMomentum), 'Momentum per unit of ATR%', '')}
      </div>
      <div class="grid two">
        ${card('Institutional accumulation', scoreText(adv.institutionalAccumulationScore), 'OBV/A-D trend + DI+ dominance + up-day volume share', '')}
        ${card('Technical regime', escape(t.regime || ''), 'ADX + multi-timeframe alignment + volatility', /uptrend/i.test(t.regime || '') ? 'positive' : /downtrend/i.test(t.regime || '') ? 'amber' : '')}
      </div>
      <div class="small">Signal confidence: <b>${escape(t.signalConfidence || '')}</b>${vp.priceVsPointOfControl && vp.priceVsPointOfControl !== 'N/A' ? ` &middot; ${escape(vp.priceVsPointOfControl)}` : ''}</div>
    </article>`;
  const volumeProfile = `
    <article class="card">
      <h3>Volume profile ${infoIcon('volumeProfile')}</h3>
      <p class="small">Point of control: ${vp.pointOfControl ? `${fmt(vp.pointOfControl.priceLow)}&ndash;${fmt(vp.pointOfControl.priceHigh)} (${fmt(vp.pointOfControl.sharePct)}% of volume)` : ''}</p>
      <div class="scroll">${(vp.buckets || []).slice().reverse().map(b => `<div class="allocation-row"><span>${fmt(b.priceLow)}&ndash;${fmt(b.priceHigh)}</span><div class="bar"><i style="width:${b.sharePct}%"></i></div><span>${fmt(b.sharePct)}%</span></div>`).join('') || '<p class="small">Not available.</p>'}</div>
    </article>`;
  // Full benchmark & performance detail (Phase 7 Stage 2, data/quant/
  // performanceEngine.mjs) -- shipped backend-only until now beyond the
  // trailing-1Y figure already on the Watchlist Research Relative-strength
  // table. Everything below is already computed; this is the first UI
  // consumer of the 3Y/5Y CAGR, drawdown detail and Sharpe-like/Sortino-like
  // proxy ratios.
  const perf = stock.performance || {};
  const cagr3y = perf.cagr?.['3Y'], cagr5y = perf.cagr?.['5Y'], dd = perf.risk?.maxDrawdown, sharpe = perf.riskAdjusted?.sharpeLike, sortino = perf.riskAdjusted?.sortinoLike;
  const relativePerformance = `
    <article class="card">
      <h3>Relative performance ${infoIcon('benchmarkPerformance')}</h3>
      <div class="grid four">
        ${card('3Y CAGR', cagr3y?.stockCagrPct == null ? '' : pct(cagr3y.stockCagrPct), cagr3y?.benchmarkCagrPct == null ? '' : `Benchmark ${pct(cagr3y.benchmarkCagrPct)}`, '')}
        ${card('5Y CAGR', cagr5y?.stockCagrPct == null ? '' : pct(cagr5y.stockCagrPct), cagr5y?.benchmarkCagrPct == null ? '' : `Benchmark ${pct(cagr5y.benchmarkCagrPct)}`, '')}
        ${card('Max drawdown', dd?.stockPct == null ? '' : pct(dd.stockPct), dd?.stockRecovered == null ? '' : dd.stockRecovered ? 'Recovered' : 'Not yet recovered', '')}
        ${card('Sortino-like', sortino?.value == null ? '' : fmt(sortino.value), 'Proxy -- not a conventional-methodology ratio', '')}
      </div>
      <div class="small">Sharpe-like: ${sharpe?.value == null ? '' : fmt(sharpe.value)} (this app's existing proxy risk-adjusted return, reused as-is). Returns are price returns -- dividends not included, not a total-shareholder-return figure.</div>
    </article>`;
  return { indicators, multiTimeframe, advancedScores, volumeProfile, relativePerformance };
}
function renderTechnicalDetail(data) {
  const stocks = data.stocks.filter(s => !s.unresolved);
  ensureActiveCompany(stocks);
  renderCompareAwarePillSelector('#technical-selector', stocks);
  const empty = '<p class="small">This watchlist is empty.</p>';
  const compareStocks = compareMode ? compareSymbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) : [];
  if (compareStocks.length >= 2) {
    $('#technical-detail-multi-timeframe').innerHTML = compareGrid(compareStocks, technicalDetailContent, 'multiTimeframe');
    $('#technical-detail-indicators').innerHTML = compareGrid(compareStocks, technicalDetailContent, 'indicators');
    $('#technical-detail-relative-performance').innerHTML = compareGrid(compareStocks, technicalDetailContent, 'relativePerformance');
    $('#technical-detail-volume-profile').innerHTML = compareGrid(compareStocks, technicalDetailContent, 'volumeProfile');
    $('#technical-detail-advanced-scores').innerHTML = compareGrid(compareStocks, technicalDetailContent, 'advancedScores');
  } else {
    const c = stocks.length ? technicalDetailContent(stocks.find(s => s.symbol === activeCompanySymbol)) : null;
    $('#technical-detail-multi-timeframe').innerHTML = c ? c.multiTimeframe : empty;
    $('#technical-detail-indicators').innerHTML = c ? c.indicators : empty;
    $('#technical-detail-relative-performance').innerHTML = c ? c.relativePerformance : empty;
    $('#technical-detail-volume-profile').innerHTML = c ? c.volumeProfile : empty;
    $('#technical-detail-advanced-scores').innerHTML = c ? c.advancedScores : empty;
  }
}

// ---- Risk deep-dive: full 5-category sub-item breakdown per stock. ----
// Returns a {financial, business, market, sector, governance} fragment map
// -- these five cards already matched the 5-category risk framework 1:1, so
// this is a mechanical return-as-object split, not a new grouping.
function riskDetailContent(stock) {
  const empty = '<p class="small">No data yet.</p>';
  if (!stock) return { financial: empty, business: empty, market: empty, sector: empty, governance: empty };
  const r = stock.institutionalRisk || {};
  const fin = r.financial || {}, mkt = r.market || {}, sec = r.sector || {}, gov = r.governance || {};
  const financial = `
    <article class="card">
      <h3>Financial risk ${infoIcon('financialRisk')}</h3>
      <div class="grid four">
        ${card('Interest coverage', suffixed(fin.interestCoverage, 'x'), '', '')}
        ${card('Debt service risk', scoreText(fin.debtServiceRisk, true), '', '')}
        ${card('Refinancing risk', scoreText(fin.refinancingRisk, true), '', '')}
        ${card('Liquidity risk', scoreText(fin.liquidityRisk, true), '', '')}
      </div>
    </article>`;
  const business = `
    <article class="card">
      <h3>Business risk ${infoIcon('businessRisk')}</h3>
      <div class="grid four">
        ${card('Margin risk', scoreText(r.business?.marginRisk, true), '', '')}
        ${card('Revenue concentration', '', 'No data source configured', '')}
        ${card('Customer concentration', '', 'No data source configured', '')}
        ${card('Execution risk', '', 'No data source configured', '')}
      </div>
    </article>`;
  const market = `
    <article class="card">
      <h3>Market risk ${infoIcon('marketRisk')}</h3>
      <div class="grid four">
        ${card('Beta', fmt(mkt.beta), '', '')}
        ${card('Volatility (annualized)', pct(mkt.volatilityPct), '', '')}
        ${card('Max drawdown', pct(mkt.maxDrawdownPct), '', '')}
        ${card('Valuation compression risk', scoreText(mkt.valuationCompressionRisk, true), '', '')}
      </div>
    </article>`;
  const sector = `
    <article class="card">
      <h3>Sector risk ${infoIcon('sectorRisk')}</h3>
      <div class="grid four">
        ${card('Regulatory', scoreText(sec.regulatory, true), sec.matched ? '' : 'Generic baseline (sector not classified)', '')}
        ${card('Commodity', scoreText(sec.commodity, true), '', '')}
        ${card('Competitive', scoreText(sec.competitive, true), '', '')}
        ${card('Technology disruption', scoreText(sec.techDisruption, true), '', '')}
      </div>
    </article>`;
  const governance = `
    <article class="card">
      <h3>Governance risk ${infoIcon('governanceRisk')}</h3>
      <div class="grid four">
        ${card('Promoter change', scoreText(gov.promoterChangeRisk, true), '', '')}
        ${card('Pledge', '', 'No data source configured', '')}
        ${card('Capital allocation', scoreText(gov.capitalAllocationRisk, true), '', '')}
        ${card('Related-party exposure', '', 'No data source configured', '')}
      </div>
    </article>`;
  return { financial, business, market, sector, governance };
}
function renderRiskDetail(data) {
  const stocks = data.stocks.filter(s => !s.unresolved);
  ensureActiveCompany(stocks);
  renderCompareAwarePillSelector('#risk-selector', stocks);
  const empty = '<p class="small">This watchlist is empty.</p>';
  const compareStocks = compareMode ? compareSymbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) : [];
  if (compareStocks.length >= 2) {
    $('#risk-detail-financial').innerHTML = compareGrid(compareStocks, riskDetailContent, 'financial');
    $('#risk-detail-business').innerHTML = compareGrid(compareStocks, riskDetailContent, 'business');
    $('#risk-detail-market').innerHTML = compareGrid(compareStocks, riskDetailContent, 'market');
    $('#risk-detail-sector').innerHTML = compareGrid(compareStocks, riskDetailContent, 'sector');
    $('#risk-detail-governance').innerHTML = compareGrid(compareStocks, riskDetailContent, 'governance');
  } else {
    const c = stocks.length ? riskDetailContent(stocks.find(s => s.symbol === activeCompanySymbol)) : null;
    $('#risk-detail-financial').innerHTML = c ? c.financial : empty;
    $('#risk-detail-business').innerHTML = c ? c.business : empty;
    $('#risk-detail-market').innerHTML = c ? c.market : empty;
    $('#risk-detail-sector').innerHTML = c ? c.sector : empty;
    $('#risk-detail-governance').innerHTML = c ? c.governance : empty;
  }
}

// ---- Portfolio analytics: dashboard KPIs, diversification, correlation
// heat-map, quality, scenario analysis -- all pre-computed server-side
// (data/analytics/portfolio.mjs, correlation.mjs, scenarios.mjs) off the
// resolved illustrative weights; this only renders. ----
function correlationColor(r) {
  if (r == null) return 'transparent';
  const abs = Math.min(1, Math.abs(r));
  return r >= 0 ? `rgba(22,199,132,${abs})` : `rgba(255,92,92,${abs})`;
}
function renderCorrelationMatrix(corr) {
  if (!corr.symbols?.length) return '<p class="small">Not enough overlapping price history yet.</p>';
  const header = `<tr><th></th>${corr.names.map(n => `<th>${escape(n)}</th>`).join('')}</tr>`;
  const rows = corr.matrix.map((row, i) => `<tr><th scope="row">${escape(corr.names[i])}</th>${row.map(r => `<td class="num" style="background:${correlationColor(r)}">${r == null ? '' : r.toFixed(2)}</td>`).join('')}</tr>`).join('');
  return `<table class="corr-table sticky-thead-native">${header ? `<thead>${header}</thead>` : ''}<tbody>${rows}</tbody></table>`;
}
function renderPortfolioAnalytics(data) {
  const p = data.portfolio || {};
  // These attribution/contribution lists only carry a company `name`, not a
  // `symbol` -- resolved here (names are unique within a watchlist) so
  // refreshActiveCompanyHighlights() can highlight the active company's row.
  const symbolByName = new Map(data.stocks.map(s => [s.name, s.symbol]));
  const dash = p.dashboard || {}, wavg = dash.weightedAverages || {};
  $('#portfolio-kpis').innerHTML = [
    card(`Total portfolio value ${infoIcon('portfolioValue')}`, dash.totalValue == null ? '' : fmt(dash.totalValue), 'An illustrative index (weight x price), not real currency', 'blue'),
    card('Weighted avg P/E', fmt(wavg.pe), '', 'blue'),
    card('Weighted avg ROE / ROCE', `${pct(wavg.roe)} / ${pct(wavg.roce)}`, '', 'positive'),
    card('Weighted FCF yield', pct(wavg.fcfYield), '', 'positive'),
    card(`Portfolio beta ${infoIcon('portfolioBeta')}`, fmt(p.beta), 'Weighted average of each holding\'s beta', ''),
    card(`Risk-adjusted return ${infoIcon('riskAdjustedReturnScore')}`, fmt(p.riskAdjustedReturn), 'Weighted avg proxy Sharpe: (1y return &minus; risk-free rate) / volatility', '')
  ].join('');

  const sectorDiv = p.sectorAllocation || {}, posDiv = p.positionConcentration || {};
  $('#portfolio-diversification').innerHTML = [
    card(`Sector diversification ${infoIcon('diversification')}`, sectorDiv.diversificationScore == null ? '' : `${sectorDiv.diversificationScore}/100`, 'Herfindahl-based sector spread', ''),
    card('Position diversification', posDiv.diversificationScore == null ? '' : `${posDiv.diversificationScore}/100`, 'Herfindahl-based position spread', ''),
    card('Effective number of holdings', fmt(posDiv.effectiveHoldings), '1 / HHI(weights)', ''),
    card('Largest position', pct(posDiv.topPositionPct), '', (posDiv.topPositionPct ?? 0) > 30 ? 'amber' : '')
  ].join('');

  const quality = p.quality || {};
  $('#portfolio-quality').innerHTML = [
    card(`Quality score ${infoIcon('portfolioQualityScore')}`, quality.qualityScore == null ? '' : `${Math.round(quality.qualityScore)}/100`, 'Weighted composite score', ''),
    card('Valuation score', quality.valuationScore == null ? '' : `${Math.round(quality.valuationScore)}/100`, 'Weighted valuation factor', ''),
    card('Technical score', quality.technicalScore == null ? '' : `${Math.round(quality.technicalScore)}/100`, 'Weighted technical score', ''),
    card('Risk score', quality.riskScore == null ? '' : `${Math.round(quality.riskScore)}/100`, 'Weighted composite risk score', '')
  ].join('');

  // -- Portfolio analytics calibration: sector contribution, position-level
  // marginal risk contribution, factor exposure, quality/valuation
  // attribution -- all pre-computed server-side (data/analytics/portfolio.mjs);
  // this only renders. --
  const sectorContrib = p.sectorContribution || [];
  $('#sector-contribution-info').innerHTML = infoIcon('sectorContribution');
  $('#portfolio-sector-contribution').innerHTML = sectorContrib.length
    ? sectorContrib.map(s => `<div class="allocation-row"><span>${escape(s.sector)}</span><div class="bar"><i style="width:${s.weightSharePct}%"></i></div><span>${fmt(s.weightSharePct)}% &middot; Q ${fmt(s.avgQuality)} &middot; R ${fmt(s.avgRisk)}</span></div>`).join('')
    : '<p class="small">No companies yet.</p>';

  const positionRisk = p.positionRiskContribution || [];
  $('#position-risk-info').innerHTML = infoIcon('positionRiskContribution');
  $('#portfolio-position-risk').innerHTML = positionRisk.length
    ? positionRisk.map(r => `<div class="allocation-row" data-symbol="${escape(symbolByName.get(r.name) || '')}"><span>${escape(r.name)}</span><div class="bar"><i style="width:${r.riskContributionPct}%"></i></div><span>${fmt(r.riskContributionPct)}%</span></div>`).join('')
    : '<p class="small">Not enough overlapping price history yet.</p>';

  const factors = p.factorExposure || {};
  $('#factor-exposure-info').innerHTML = infoIcon('factorExposure');
  $('#portfolio-factor-exposure').innerHTML = Object.keys(factors).length
    ? Object.values(factors).map(f => `<div class="allocation-row"><span>${escape(f.label)}</span><div class="bar"><i style="width:${f.exposure ?? 0}%"></i></div><span>${f.exposure == null ? '' : `${f.exposure}/100`}</span></div>`).join('')
    : '<p class="small">Not available.</p>';

  function attributionList(attribution) {
    if (!attribution || attribution.portfolioAverage == null) return '<p class="small">Not available.</p>';
    const row = (c) => `<div class="allocation-row" data-symbol="${escape(symbolByName.get(c.name) || '')}"><span>${escape(c.name)}</span><span>${fmt(c.score)}/100 &middot; ${c.contribution >= 0 ? '+' : ''}${fmt(c.contribution)}</span></div>`;
    return `<div class="small">Portfolio average: ${fmt(attribution.portfolioAverage)}/100</div>
      <div class="small" style="margin-top:8px"><b>Top positive contributors</b></div>${(attribution.topPositive || []).map(row).join('') || '<p class="small">None.</p>'}
      <div class="small" style="margin-top:8px"><b>Top negative contributors</b></div>${(attribution.topNegative || []).map(row).join('') || '<p class="small">None.</p>'}`;
  }
  $('#portfolio-quality-attribution').innerHTML = attributionList(p.qualityAttribution);
  $('#portfolio-valuation-attribution').innerHTML = attributionList(p.valuationAttribution);

  const corr = p.correlation || {};
  $('#portfolio-correlation').innerHTML = renderCorrelationMatrix(corr);
  $('#portfolio-correlation-lists').innerHTML = `
    <article class="card"><h3>Highly correlated holdings</h3>${(corr.highlyCorrelated || []).map(x => `<div class="allocation-row"><span>${escape(x.a)} &harr; ${escape(x.b)}</span><span>${x.correlation.toFixed(2)}</span></div>`).join('') || '<p class="small">None above 0.7.</p>'}</article>
    <article class="card"><h3>Diversification opportunities</h3>${(corr.diversificationOpportunities || []).map(x => `<div class="allocation-row"><span>${escape(x.a)} &harr; ${escape(x.b)}</span><span>${x.correlation.toFixed(2)}</span></div>`).join('') || '<p class="small">Not available.</p>'}</article>`;

  const rolling = p.rollingCorrelation || {};
  $('#portfolio-rolling-correlation').innerHTML = (rolling.recentAvgCorrelation != null || rolling.longRunAvgCorrelation != null) ? `
    <h4>Rolling correlation ${infoIcon('rollingCorrelation')}</h4>
    <div class="grid three">
      ${card(`Recent avg (~${rolling.windowPoints || 26}wk)`, rolling.recentAvgCorrelation == null ? '' : rolling.recentAvgCorrelation.toFixed(2), '', '')}
      ${card('Long-run avg', rolling.longRunAvgCorrelation == null ? '' : rolling.longRunAvgCorrelation.toFixed(2), '', '')}
      ${card('Correlation stability', rolling.correlationStabilityScore == null ? '' : `${rolling.correlationStabilityScore}/100`, 'Higher = pairwise correlations haven\'t shifted much recently', '')}
    </div>` : '';

  $('#portfolio-scenarios').innerHTML = (p.scenarios || []).map(s => `
    <article class="card">
      <h3>${escape(s.label)} ${infoIcon('scenarioImpact')}</h3>
      <div class="small">${escape(s.description)}</div>
      <div class="kpi ${s.portfolioImpactPct < 0 ? 'amber' : 'positive'}">${pct(s.portfolioImpactPct)}</div>
      <div class="small">${escape(s.recoverySensitivity)}</div>
      <div class="small">Top contributors: ${s.riskContribution.slice(0, 3).map(c => escape(c.name)).join(', ') || ''}</div>
    </article>`).join('');
}

// ---- Phase 4 decision layer (Stage 2 UI): Dashboard's Portfolio Intelligence
// and Committee View sub-tabs, Portfolio's Health & Rebalancing sub-tab, and
// Risks' Alerts sub-tab -- every figure below is read from `data.intelligence`
// (data/decision/index.mjs's buildPortfolioIntelligence, already attached to
// the research payload server-side); nothing here recomputes a score,
// threshold or band, and nothing here triggers a new fetch. The Opportunity
// Monitor / Risk Monitor sub-categories are a pure client-side grouping of
// already-computed alert types/fields (data/decision/alerts.mjs's category
// and type values, and the sign of an already-computed change), not a new
// heuristic. ----
function renderPortfolioIntelligence(data) {
  const intel = data.intelligence;
  $('#pi-methodology-info').innerHTML = infoIcon('actionScore');
  if (!intel) {
    $('#pi-kpis').innerHTML = '';
    $('#pi-action-table tbody').innerHTML = '<tr><td colspan="8" class="small">Not available.</td></tr>';
    $('#pi-opportunities').innerHTML = '<p class="small">Not available.</p>';
    $('#pi-risks').innerHTML = '<p class="small">Not available.</p>';
    $('#pi-changes').innerHTML = '<p class="small">Not available.</p>';
    if ($('#wr-opportunities-content')) $('#wr-opportunities-content').innerHTML = '<p class="small">Not available.</p>';
    return;
  }
  const bySymbol = new Map(data.stocks.map(s => [s.symbol, s]));
  const alertsFor = (symbol) => intel.alerts.filter(al => al.symbol === symbol);
  const changesFor = (symbol) => intel.changes.bySymbol[symbol]?.changes || [];

  const actionable = intel.actionRequired.filter(a => a.label !== 'Hold');
  $('#pi-kpis').innerHTML = [
    card('Action Required', actionable.length, 'Names outside a Hold band', actionable.length ? 'amber' : 'positive'),
    card('Opportunities flagged', intel.opportunities.length, 'Add / Add aggressively with positive upside', 'positive'),
    card('Risk Monitor', intel.riskMonitor.length, 'Elevated or deteriorating composite risk', intel.riskMonitor.length ? 'amber' : ''),
    card('Unacknowledged alerts', intel.alerts.length, `${intel.alerts.filter(a => a.severity === 'Critical' || a.severity === 'High').length} Critical/High`, intel.alerts.some(a => a.severity === 'Critical') ? 'amber' : '')
  ].join('');

  const actionRows = intel.actionRequired.map(a => ({ ...a, stock: bySymbol.get(a.symbol) })).filter(r => r.stock);
  const actionKeyFns = {
    company: r => r.stock.name, sector: r => r.stock.sector || null,
    action: r => ({ 'Add aggressively': 5, Add: 4, Hold: 3, Reduce: 2, Exit: 1 }[r.label] || null),
    actionScore: r => r.score, confidence: r => CONVICTION_RANK[r.stock.recommendation?.confidence] || null,
    driver: r => r.rationale || null, fvGap: r => r.stock.valuation?.marginOfSafetyPct,
    riskTrend: r => r.stock.institutionalRisk?.riskTrend || null
  };
  const sortedActionRows = sortForTable('pi-action-table', actionRows, actionKeyFns);
  $('#pi-action-table tbody').innerHTML = sortedActionRows.length ? sortedActionRows.map(a => {
    const stock = a.stock;
    return `<tr data-symbol="${escape(a.symbol)}">
      <td>${companyLink(a.symbol, stock.name)}</td>
      <td>${escape(stock.sector || '')}</td>
      <td class="derived">${actionScoreBadge(intel.actionScores[a.symbol])}</td>
      <td class="num derived" title="${escape(actionScoreTitle(intel.actionScores[a.symbol]))}">${a.score}/100</td>
      <td class="derived">${escape(stock.recommendation?.confidence || '')}</td>
      <td class="derived">${escape(a.rationale || '')}</td>
      <td class="num derived">${fairValueGapCell(stock)}</td>
      <td class="derived">${escape(stock.institutionalRisk?.riskTrend || '')}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="small">No action-required names currently.</td></tr>';
  initTableSort('pi-action-table');
  initTableLayout('pi-action-table', { resetButtonId: 'pi-action-table-reset-columns' });

  const listRow = (symbol, reason) => { const s = bySymbol.get(symbol); return s ? `<div class="allocation-row" data-symbol="${escape(symbol)}"><span>${companyLink(symbol, s.name)}</span><span class="small">${escape(reason)}</span></div>` : ''; };
  const group = (label, list) => list.length ? `<div class="small" style="margin-top:10px"><b>${escape(label)}</b></div>${list.map(x => listRow(x.symbol, x.reason)).join('')}` : '';

  const undervalued = intel.opportunities.filter(o => (bySymbol.get(o.symbol)?.recommendation?.components?.valuation?.score ?? 0) >= 60);
  const improvingQuality = intel.opportunities.filter(o => alertsFor(o.symbol).some(al => al.type === 'recommendationChanged'));
  const improvingTechnicals = intel.opportunities.filter(o => alertsFor(o.symbol).some(al => ['breakoutConfirmation', 'crossedAbove50DMA', 'crossedAbove200DMA', 'macdCrossedBullish', 'relativeStrengthAcceleration'].includes(al.type)));
  const fallingRisk = intel.opportunities.filter(o => changesFor(o.symbol).some(c => c.field === 'compositeRiskScore' && c.to < c.from));
  const catalystMomentum = intel.opportunities.filter(o => (bySymbol.get(o.symbol)?.news || []).some(n => n.impact === 'High'));
  const opportunitiesHtml = [group('Undervalued', undervalued), group('Improving quality', improvingQuality), group('Improving technicals', improvingTechnicals), group('Falling risk', fallingRisk), group('Positive catalyst momentum', catalystMomentum)].join('') || '<p class="small">No opportunities currently flagged.</p>';
  $('#pi-opportunities').innerHTML = opportunitiesHtml;
  // Watchlist Research -> Opportunities reuses this same already-computed
  // Action-Score-driven opportunity list (second display location).
  if ($('#wr-opportunities-content')) $('#wr-opportunities-content').innerHTML = opportunitiesHtml;

  const risingRisk = intel.riskMonitor.filter(r => changesFor(r.symbol).some(c => c.field === 'compositeRiskScore' && c.to > c.from) || /Deteriorating/.test(r.reason));
  const deterioratingTechnicals = intel.riskMonitor.filter(r => alertsFor(r.symbol).some(al => ['breakdownConfirmation', 'crossedBelow50DMA', 'crossedBelow200DMA', 'macdCrossedBearish'].includes(al.type)));
  const governanceConcerns = data.stocks.filter(s => (s.institutionalRisk?.categories?.governance ?? 0) > 65).map(s => ({ symbol: s.symbol, reason: `Governance risk ${s.institutionalRisk.categories.governance}/100.` }));
  const valuationExcess = [...intel.riskMonitor.filter(r => alertsFor(r.symbol).some(al => ['marginOfSafetyCritical', 'marginOfSafetyHigh', 'pePercentileExtremeHigh'].includes(al.type))),
    ...data.stocks.filter(s => (s.valuation?.marginOfSafetyPct ?? 0) <= -10).map(s => ({ symbol: s.symbol, reason: `Price ${Math.abs(Math.round(s.valuation.marginOfSafetyPct))}% above modeled fair value.` }))];
  const topSector = data.portfolio?.sectorAllocation?.allocation?.[0];
  const concentrationConcerns = (topSector && topSector.sharePct >= 40) ? data.stocks.filter(s => s.sector === topSector.sector).map(s => ({ symbol: s.symbol, reason: `${topSector.sector} is ${Math.round(topSector.sharePct)}% of watchlist weight.` })) : [];
  $('#pi-risks').innerHTML = [group('Rising risk', risingRisk), group('Deteriorating technicals', deterioratingTechnicals), group('Governance concerns', governanceConcerns), group('Valuation excess', valuationExcess), group('Concentration concerns', concentrationConcerns)].join('') || '<p class="small">No risk conditions currently flagged.</p>';

  $('#pi-changes').innerHTML = intel.changes.summary.length
    ? intel.changes.summary.slice(0, 40).map(line => {
        const symbol = line.split(':')[0];
        const material = /Recommendation|Confidence|Fair value|risk score|regime/i.test(line);
        return `<div class="allocation-row" data-symbol="${escape(symbol)}"><span>${escape(line)}</span>${material ? '<span class="tag hold">Material</span>' : ''}</div>`;
      }).join('')
    : '<p class="small">No changes since the last genuine data refresh.</p>';
}

// Committee View: a presentation-quality roll-up over the same
// `data.intelligence`/`data.portfolio`/`data.sectorAllocation` fields the
// sections above and the Portfolio tab already render -- no independent
// computation. "Expected return" is a simple average of each holding's own
// already-computed upside-to-target-price (same avgOf() convention already
// used for the Watchlists summary cards), not a new return model.
function renderCommitteeView(data) {
  const intel = data.intelligence;
  const p = data.portfolio || {};
  const bySymbol = new Map(data.stocks.map(s => [s.symbol, s]));
  if (!intel) {
    ['cv-kpis', 'cv-top-opportunities', 'cv-top-risks', 'cv-sector-allocation', 'cv-concentration', 'cv-rebalancing'].forEach(id => { $(`#${id}`).innerHTML = '<p class="small">Not available.</p>'; });
    return;
  }
  const avgUpside = avgOf(data.stocks.filter(s => !s.unresolved).map(s => s.valuation?.upsidePct));
  $('#cv-kpis').innerHTML = [
    card('Portfolio beta', fmt(p.beta), "Weighted average of each holding's beta", ''),
    card('Expected return', avgUpside == null ? '' : pct(avgUpside), "Simple average of each holding's upside to Target Price", (avgUpside ?? 0) >= 0 ? 'positive' : 'amber'),
    card('Risk-adjusted outlook', fmt(p.riskAdjustedReturn), 'Weighted avg proxy Sharpe: (1y return - risk-free rate) / volatility', ''),
    card('Portfolio health', intel.health?.score == null ? '' : `${intel.health.score}/100`, intel.health?.trend || '', intel.health?.trend === 'Improving' ? 'positive' : intel.health?.trend === 'Deteriorating' ? 'amber' : '')
  ].join('');

  const listRow = (symbol, text) => { const s = bySymbol.get(symbol); return s ? `<div class="allocation-row" data-symbol="${escape(symbol)}"><span>${companyLink(symbol, s.name)}</span><span class="small">${escape(text)}</span></div>` : ''; };
  const topOpportunities = intel.actionRequired.filter(a => ['Add aggressively', 'Add'].includes(a.label)).slice(0, 5);
  $('#cv-top-opportunities').innerHTML = topOpportunities.length ? topOpportunities.map(a => listRow(a.symbol, `${a.label} · ${a.score}/100 · ${a.rationale || ''}`)).join('') : '<p class="small">None currently.</p>';
  const topRisks = intel.actionRequired.filter(a => ['Reduce', 'Exit'].includes(a.label)).slice(0, 5);
  $('#cv-top-risks').innerHTML = topRisks.length ? topRisks.map(a => listRow(a.symbol, `${a.label} · ${a.score}/100`)).join('') : '<p class="small">None currently.</p>';

  const allocation = data.sectorAllocation || { allocation: [] };
  $('#cv-sector-allocation').innerHTML = allocation.allocation.length ? allocation.allocation.map(entry => `<div class="allocation-row"><span>${escape(entry.sector)}</span><div class="bar"><i style="width:${entry.sharePct}%"></i></div><span>${fmt(entry.sharePct)}%</span></div>`).join('') : '<p class="small">No companies yet.</p>';

  const sectorDiv = p.sectorAllocation || {}, posDiv = p.positionConcentration || {};
  $('#cv-concentration').innerHTML = [
    card('Top sector share', sectorDiv.allocation?.[0] ? `${escape(sectorDiv.allocation[0].sector)}: ${fmt(sectorDiv.allocation[0].sharePct)}%` : '', sectorDiv.concentrated ? 'Concentrated (>40% of allocated weight)' : '', sectorDiv.concentrated ? 'amber' : ''),
    card('Largest position', pct(posDiv.topPositionPct), '', (posDiv.topPositionPct ?? 0) > 30 ? 'amber' : '')
  ].join('');

  $('#cv-rebalancing').innerHTML = intel.rebalancing.length ? intel.rebalancing.slice(0, 8).map(r => listRow(r.symbol, `${r.action} · ${r.rationale}`)).join('') : '<p class="small">No rebalancing suggestions currently.</p>';
}

// Portfolio Health & Rebalancing: health score/trend/contributors/history and
// the rebalancing table -- all off `data.intelligence.health`/`.rebalancing`
// (data/decision/portfolioHealth.mjs, rebalancing.mjs), no recomputation.
function renderHealthRebalancing(data) {
  $('#health-score-info').innerHTML = infoIcon('portfolioHealthScore');
  $('#rebalancing-info').innerHTML = infoIcon('rebalancingSuggestion');
  const health = data.intelligence?.health;
  if (!health || health.score == null) {
    $('#health-kpis').innerHTML = card('Portfolio health score', '', 'Not enough resolved holdings to compute.', '');
    $('#health-contributors').innerHTML = '';
    $('#health-history').innerHTML = '<p class="small">Not available.</p>';
  } else {
    $('#health-kpis').innerHTML = [
      card('Portfolio health score', `${health.score}/100`, '', health.score >= 65 ? 'positive' : health.score >= 40 ? 'amber' : 'negative'),
      card('Trend', health.trend, 'vs. the last genuine data refresh', health.trend === 'Improving' ? 'positive' : health.trend === 'Deteriorating' ? 'amber' : '')
    ].join('');
    $('#health-contributors').innerHTML = (health.contributors || []).map(c => `<div class="allocation-row"><span>${escape(c.label)}</span><div class="bar"><i style="width:${c.score}%"></i></div><span>${fmt(c.score)}/100</span></div>`).join('') || '<p class="small">Not available.</p>';
    const history = health.history || [];
    $('#health-history').innerHTML = history.length ? history.map(h => `<div class="allocation-row"><span>${new Date(h.fetchedAt).toLocaleDateString()}</span><div class="bar"><i style="width:${h.healthScore}%"></i></div><span>${h.healthScore}/100</span></div>`).join('') : '<p class="small">History accumulates after this watchlist\'s next genuine data refresh.</p>';
  }

  const bySymbol = new Map(data.stocks.map(s => [s.symbol, s]));
  const rebalancingRows = (data.intelligence?.rebalancing || []).map(r => ({ ...r, stock: bySymbol.get(r.symbol) })).filter(r => r.stock);
  const rebalancingKeyFns = {
    company: r => r.stock.name, currentWeight: r => r.stock.effectiveWeightPct, targetWeight: r => r.stock.targetWeightPct,
    action: r => r.action || null, actionScore: r => data.intelligence.actionScores[r.symbol]?.score, rationale: r => r.rationale || null
  };
  const sortedRebalancing = sortForTable('rebalancing-table', rebalancingRows, rebalancingKeyFns);
  $('#rebalancing-table tbody').innerHTML = sortedRebalancing.length ? sortedRebalancing.map(r => {
    const s = r.stock;
    return `<tr data-symbol="${escape(r.symbol)}">
      <td>${companyLink(r.symbol, s.name)}</td>
      <td class="num derived">${fmt(s.effectiveWeightPct)}%</td>
      <td class="num">${s.targetWeightPct == null ? 'Equal' : `${fmt(s.targetWeightPct)}%`}</td>
      <td class="derived">${escape(r.action)}</td>
      <td class="num derived" title="${escape(actionScoreTitle(data.intelligence.actionScores[r.symbol]))}">${data.intelligence.actionScores[r.symbol] ? `${data.intelligence.actionScores[r.symbol].score}/100` : ''}</td>
      <td class="derived">${escape(r.rationale)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="small">No rebalancing suggestions currently.</td></tr>';
  initTableSort('rebalancing-table');
  initTableLayout('rebalancing-table', { resetButtonId: 'rebalancing-table-reset-columns' });
}

// Phase 6 Portfolio Exposure Matrix: reads data.portfolio.exposureMatrix
// (data/decision/exposureMatrix.mjs), already computed server-side alongside
// the rest of the Portfolio tab's own aggregates -- pure formatting here.
const EXPOSURE_TIER_CLASS = { High: 'sell', Moderate: 'hold', Low: 'buy', 'N/A': 'neutral' };
function renderExposureMatrix(data) {
  $('#exposure-matrix-info').innerHTML = infoIcon('exposureMatrix');
  const matrix = data.portfolio?.exposureMatrix;
  if (!matrix || !matrix.companies?.length) {
    $('#exposure-portfolio-kpis').innerHTML = '';
    $('#exposure-matrix-table tbody').innerHTML = '<tr><td colspan="6" class="small">Not available.</td></tr>';
    return;
  }
  const p = matrix.portfolio || {};
  const tierCard = (label, tag) => card(label, tag?.score == null ? '' : `${tag.score}/100`, tag?.tier || '', EXPOSURE_TIER_CLASS[tag?.tier] === 'sell' ? 'amber' : '');
  $('#exposure-portfolio-kpis').innerHTML = [
    tierCard('Interest-rate sensitivity', p.interestRate),
    tierCard('Commodity sensitivity', p.commodity),
    tierCard('Regulatory sensitivity', p.regulatory),
    card('Currency exposure', p.currency?.exposure ?? '', p.currency?.direction || '', '')
  ].join('');

  const bySymbol = new Map(data.stocks.map(s => [s.symbol, s]));
  const exposureRows = matrix.companies.map(c => ({ ...c, stock: bySymbol.get(c.symbol) })).filter(r => r.stock);
  const exposureKeyFns = {
    company: r => r.stock.name, interestRate: r => r.interestRate.score, currency: r => r.currency.direction || null,
    commodity: r => r.commodity.score, regulatory: r => r.regulatory.score, economicCycle: r => r.economicCycle.label || null
  };
  const sortedExposure = sortForTable('exposure-matrix-table', exposureRows, exposureKeyFns);
  $('#exposure-matrix-table tbody').innerHTML = sortedExposure.length ? sortedExposure.map(c => {
    const stock = c.stock;
    return `<tr data-symbol="${escape(c.symbol)}">
      <td>${companyLink(c.symbol, stock.name)}</td>
      <td class="num derived"><span class="tag ${EXPOSURE_TIER_CLASS[c.interestRate.tier] || 'neutral'}">${c.interestRate.score ?? ''} &middot; ${escape(c.interestRate.tier)}</span></td>
      <td class="derived">${escape(c.currency.direction)}</td>
      <td class="num derived"><span class="tag ${EXPOSURE_TIER_CLASS[c.commodity.tier] || 'neutral'}">${c.commodity.score ?? ''} &middot; ${escape(c.commodity.tier)}</span></td>
      <td class="num derived"><span class="tag ${EXPOSURE_TIER_CLASS[c.regulatory.tier] || 'neutral'}">${c.regulatory.score ?? ''} &middot; ${escape(c.regulatory.tier)}</span></td>
      <td class="derived">${escape(c.economicCycle.label)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="small">Not available.</td></tr>';
  initTableSort('exposure-matrix-table');
  initTableLayout('exposure-matrix-table', { resetButtonId: 'exposure-matrix-table-reset-columns' });
}

// Risks tab's Alerts sub-tab: severity-filtered, client-side only (the
// backend already excludes acknowledged alerts from `data.intelligence.alerts`
// -- see data/decision/index.mjs). Acknowledging calls the Stage 1 route and
// re-renders from the fresh payload, so an acknowledged alert disappearing is
// just the normal render() cascade, not special-cased here.
let alertsSeverityFilter = '';
const ALERT_CONFIDENCE_RANK = { High: 3, Medium: 2, Low: 1 };
const ALERTS_TABLE_SORT = {
  severity: a => ({ Critical: 4, High: 3, Medium: 2, Low: 1 }[a.severity]) || null,
  company: a => a.symbol === 'PORTFOLIO' ? 'Portfolio' : a.symbol, category: a => a.category || null,
  alert: a => a.message || null, confidence: a => ALERT_CONFIDENCE_RANK[a.confidence] || null,
  time: a => a.detectedAt ? new Date(a.detectedAt).getTime() : null
};
function renderAlerts(data) {
  $('#alerts-methodology-info').innerHTML = infoIcon('alertSeverity');
  const bySymbol = new Map(data.stocks.map(s => [s.symbol, s]));
  const severityRank = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  let alerts = (data.intelligence?.alerts || [])
    .filter(a => !alertsSeverityFilter || a.severity === alertsSeverityFilter)
    .sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0) || new Date(b.detectedAt) - new Date(a.detectedAt));
  alerts = sortForTable('alerts-table', alerts, ALERTS_TABLE_SORT);
  $('#alerts-table tbody').innerHTML = alerts.length ? alerts.map(a => {
    const stock = bySymbol.get(a.symbol);
    const companyCell = stock ? companyLink(a.symbol, stock.name) : escape(a.symbol === 'PORTFOLIO' ? 'Portfolio' : a.symbol);
    return `<tr data-symbol="${escape(a.symbol)}">
      <td class="derived"><span class="tag ${SEVERITY_TAG_CLASS[a.severity] || 'neutral'}">${escape(a.severity)}</span></td>
      <td>${companyCell}</td>
      <td class="derived">${escape(a.category)}</td>
      <td class="derived">${escape(a.message)}</td>
      <td class="derived">${escape(a.confidence)}</td>
      <td>${new Date(a.detectedAt).toLocaleString()}</td>
      <td><button type="button" class="icon-btn" data-ack-alert="${escape(a.id)}">Acknowledge</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="small">No unacknowledged alerts.</td></tr>';
  initTableSort('alerts-table');
  initTableLayout('alerts-table', { resetButtonId: 'alerts-table-reset-columns' });
}
async function acknowledgeAlert(alertId) {
  const id = watchlistIndex.activeWatchlist;
  const { data } = await api(`/api/watchlists/${id}/alerts/${encodeURIComponent(alertId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acknowledged: true }) });
  render(data);
}
$('#alerts-table').addEventListener('click', (event) => {
  const button = event.target.closest('[data-ack-alert]');
  if (button) acknowledgeAlert(button.dataset.ackAlert);
});
$('#alerts-severity-filter').addEventListener('click', (event) => {
  const button = event.target.closest('.pill[data-severity]');
  if (!button) return;
  alertsSeverityFilter = button.dataset.severity;
  $$('#alerts-severity-filter .pill').forEach(p => p.classList.toggle('active', p === button));
  if (currentData) renderAlerts(currentData);
});

// ---- Fundamentals tab: per-stock selector + DuPont/ROCE decomposition +
// 10-year statement tables + shareholding trend. ----
const STATEMENT_ROWS = {
  profitLoss: [['sales', 'Sales', fmt], ['expenses', 'Expenses', fmt], ['operatingProfit', 'Operating Profit', fmt], ['opmPct', 'OPM %', pct],
    ['otherIncome', 'Other Income', fmt], ['interest', 'Interest', fmt], ['depreciation', 'Depreciation', fmt], ['profitBeforeTax', 'Profit Before Tax', fmt],
    ['taxPct', 'Tax %', pct], ['netProfit', 'Net Profit', fmt], ['epsInRs', 'EPS (Rs)', fmt], ['dividendPayoutPct', 'Dividend Payout %', pct]],
  balanceSheet: [['equityCapital', 'Equity Capital', fmt], ['reserves', 'Reserves', fmt], ['borrowings', 'Borrowings', fmt], ['otherLiabilities', 'Other Liabilities', fmt],
    ['totalLiabilities', 'Total Liabilities', fmt], ['fixedAssets', 'Fixed Assets', fmt], ['cwip', 'CWIP', fmt], ['investments', 'Investments', fmt],
    ['otherAssets', 'Other Assets', fmt], ['totalAssets', 'Total Assets', fmt]],
  cashFlow: [['cfo', 'Cash from Operations', fmt], ['cfi', 'Cash from Investing', fmt], ['cff', 'Cash from Financing', fmt], ['netCashFlow', 'Net Cash Flow', fmt],
    ['freeCashFlow', 'Free Cash Flow', fmt], ['cfoToOp', 'CFO / Operating Profit', pct]],
  ratios: [['debtorDays', 'Debtor Days', fmt], ['inventoryDays', 'Inventory Days', fmt], ['payableDays', 'Payable Days', fmt],
    ['cashConversionCycle', 'Cash Conversion Cycle', fmt], ['workingCapitalDays', 'Working Capital Days', fmt], ['rocePct', 'ROCE %', pct]]
};
const SHAREHOLDING_ROWS = [['promoters', 'Promoters', pct], ['fii', 'FII', pct], ['dii', 'DII', pct], ['government', 'Government', pct], ['public', 'Public', pct], ['shareholderCount', 'No. of Shareholders', compact]];

function periodTable(series, rowConfig) {
  if (!series || !series.periods.length) return '<p class="small">Not available for this stock.</p>';
  const header = `<tr><th>Metric</th>${series.periods.map(period => `<th class="num">${escape(period)}</th>`).join('')}</tr>`;
  const body = rowConfig.map(([key, label, formatter]) => {
    const values = series.rows[key] || [];
    return `<tr><th scope="row">${escape(label)}</th>${series.periods.map((_, i) => `<td class="num">${formatter(values[i])}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="scroll"><table class="tech-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
}
// Returns a {businessQuality, financialQuality, cashFlow, capitalAllocation,
// historicalFinancials, keyMetrics} fragment map -- one per Fundamentals
// sub-tab -- instead of one concatenated string, so renderFundamentals can
// drop each fragment into its own static .subsection container without the
// sub-tab controller needing to parse markup out of a blob.
function fundamentalsContent(stock) {
  const f = stock.fundamentals;
  if (!f) {
    const notice = `<article class="card"><h3>${escape(stock.name)}</h3><p class="small">Not yet fetched. It will appear here after the next refresh.</p></article>`;
    return { businessQuality: notice, financialQuality: notice, cashFlow: notice, capitalAllocation: notice, historicalFinancials: notice, keyMetrics: notice };
  }
  if (!f.annual) {
    const notice = `<article class="card"><h3>${escape(stock.name)}</h3><div class="tag limited-data">Limited data (${escape(f.source)})</div><p class="small">10-year financials, ratios and ownership history are sourced from Screener.in for India only in this phase. This stock's price and technical data are on the other tabs.</p></article>`;
    return { businessQuality: notice, financialQuality: notice, cashFlow: notice, capitalAllocation: notice, historicalFinancials: notice, keyMetrics: notice };
  }
  const a = stock.fundamentalsAnalytics;
  const dupont = a.dupont, roce = a.roce, wc = a.workingCapital, eq = a.earningsQuality;
  const businessQuality = `
    <article class="card">
      <h3>${escape(stock.name)} &mdash; DuPont ROE decomposition</h3>
      <div class="grid four">
        ${card('Net margin', pct(dupont.netMarginPct), 'Factor 1: Net Profit / Sales', 'blue')}
        ${card('Asset turnover', suffixed(dupont.assetTurnover, 'x'), 'Factor 2: Sales / Total Assets', 'blue')}
        ${card('Equity multiplier', suffixed(dupont.equityMultiplier, 'x'), 'Factor 3: Total Assets / Equity', 'blue')}
        ${card('DuPont ROE', pct(dupont.dupontRoePct), `Reported ROE ${pct(dupont.reportedRoePct)} (sanity cross-check)`, 'positive')}
      </div>
    </article>
    <article class="card">
      <h3>ROCE decomposition</h3>
      <div class="grid four">
        ${card('ROCE', pct(roce.rocePct), 'Reported, from ratios history', 'positive')}
        ${card('EBIT margin', pct(roce.ebitMarginPct), '(Profit before tax + Interest) / Sales', 'blue')}
        ${card('Implied capital turnover', suffixed(roce.impliedCapitalTurnover, 'x'), 'Solved residual, not independently sourced', 'amber')}
        ${card('Working capital days', fmt(wc?.workingCapitalDays), `CCC ${fmt(wc?.cashConversionCycle)}d`, '')}
      </div>
      <p class="small">${escape(roce.derivationMethod)}</p>
    </article>`;
  const financialQuality = `
    <article class="card">
      <h3>Earnings quality &amp; capital intensity</h3>
      <div class="grid four">
        ${card('Earnings quality score', fmt(eq.score), 'Project heuristic, not a named formula', eq.score >= 60 ? 'positive' : 'amber')}
        ${card('Accrual ratio', fmt(eq.accrualRatio), '(Net Profit - CFO) / Total Assets', '')}
        ${card('Capital intensity', suffixed(a.capitalIntensity, 'x'), 'Fixed Assets / Sales', '')}
        ${card('Margin stability', fmt(a.marginStability), 'Std. dev. of OPM % across history', '')}
      </div>
    </article>`;
  const cashFlow = `<article class="card"><h3>10-year Cash Flow (Rs Cr)</h3>${periodTable(f.annual.cashFlow, STATEMENT_ROWS.cashFlow)}</article>`;
  const capitalAllocation = `<article class="card"><h3>10-year Balance Sheet (Rs Cr)</h3>${periodTable(f.annual.balanceSheet, STATEMENT_ROWS.balanceSheet)}</article>`;
  const historicalFinancials = `<article class="card"><h3>10-year Profit &amp; Loss (Rs Cr)</h3>${periodTable(f.annual.profitLoss, STATEMENT_ROWS.profitLoss)}</article>`;
  const keyMetrics = `
    <article class="card"><h3>Working-capital &amp; return ratios</h3>${periodTable(f.annual.ratios, STATEMENT_ROWS.ratios)}</article>
    <article class="card"><h3>Shareholding pattern (annual, %)</h3>${periodTable(f.shareholding?.annual, SHAREHOLDING_ROWS)}</article>`;
  return { businessQuality, financialQuality, cashFlow, capitalAllocation, historicalFinancials, keyMetrics };
}
function renderFundamentals(data) {
  ensureActiveCompany(data.stocks);
  renderPillSelector('#fundamentals-selector', data.stocks, activeCompanySymbol, (symbol) => setActiveCompany(symbol));
  const stock = data.stocks.find(s => s.symbol === activeCompanySymbol);
  const empty = '<p class="small">This watchlist is empty.</p>';
  const c = stock ? fundamentalsContent(stock) : null;
  $('#fundamentals-business-quality').innerHTML = c ? c.businessQuality : empty;
  $('#fundamentals-financial-quality').innerHTML = c ? c.financialQuality : empty;
  $('#fundamentals-cash-flow').innerHTML = c ? c.cashFlow : empty;
  $('#fundamentals-capital-allocation').innerHTML = c ? c.capitalAllocation : empty;
  $('#fundamentals-historical-financials').innerHTML = c ? c.historicalFinancials : empty;
  $('#fundamentals-key-metrics').innerHTML = c ? c.keyMetrics : empty;
}

// ---- Dashboard: Executive Summary, KPI Ribbon, Top Opportunities, Recent
// News & Catalysts, Sector Allocation, Watchlist Snapshot, Key Risks,
// Upcoming Earnings & Events. Top Opportunities/Key Risks are *views* --
// independently sorted/sliced for display, never mutating data.stocks. ----
function renderDashboardKpis(data) {
  const avg = data.averages || {};
  const html =
    card('Watchlist recommendation', data.recommendation, 'Screen-derived signal across saved companies', data.recommendation === 'OVERWEIGHT' ? 'positive' : 'amber') +
    `<article class="card"><h3>Investment score</h3><div class="score"><div class="score-circle">${data.score}</div><div class="small">Composite/technical blend across the watchlist<br><br><div class="progress"><i style="width:${data.score}%"></i></div></div></div></article>` +
    card('Average P/E', fmt(avg.pe), 'Across companies with reported data', 'blue') +
    card('Market trend', data.trend, `Average daily move ${pct(avg.change)}`, (avg.change ?? 0) >= 0 ? 'positive' : 'amber');
  $('#dashboard-kpis').innerHTML = html;
  // Watchlist Research -> Overview reuses the same already-computed watchlist
  // KPIs (second display location, not a second computation).
  if ($('#wr-kpis')) $('#wr-kpis').innerHTML = html;
}

// Primary driver is computed once, server-side, by the same unified
// recommendation engine that sets the rating and confidence (the bucket
// furthest from neutral -- see scoringEngine.mjs's derivePrimaryDriver) --
// this just renders it, so Top Opportunities can never show a "key catalyst"
// that disagrees with the Recommendation/Confidence badge next to it.
function keyCatalystFor(stock) {
  return stock.recommendation?.primaryDriver || '';
}
const RATING_RANK = { 'Strong Buy': 6, Buy: 5, Accumulate: 4, Hold: 3, Reduce: 2, Sell: 1 };
const CONVICTION_RANK = { High: 3, Medium: 2, Low: 1 };
// Peer completeness is a real categorical answer (not missing data), so it
// gets a rank like any other label column rather than being pinned to the
// bottom via isSortNA's N/A handling -- "Unavailable" sorts as the lowest
// rank, but sorts, it isn't treated as absent.
const PEER_COMPLETENESS_RANK = { Strong: 4, Adequate: 3, Weak: 2, Unavailable: 1 };
const THESIS_STATUS_RANK = { Broken: 1, Weakening: 2, Intact: 3, Improving: 4 };
function rankStocks(stocks, mode) {
  const sorted = [...stocks];
  if (mode === 'upside') sorted.sort((a, b) => (b.valuation?.upsidePct ?? -Infinity) - (a.valuation?.upsidePct ?? -Infinity));
  else if (mode === 'conviction') sorted.sort((a, b) => (CONVICTION_RANK[b.valuation?.convictionLevel] || 0) - (CONVICTION_RANK[a.valuation?.convictionLevel] || 0));
  else if (mode === 'valuation') sorted.sort((a, b) => (b.recommendation?.factors?.valuation?.value ?? -1) - (a.recommendation?.factors?.valuation?.value ?? -1));
  else if (mode === 'growth') sorted.sort((a, b) => (b.recommendation?.factors?.growth?.value ?? -1) - (a.recommendation?.factors?.growth?.value ?? -1));
  else if (mode === 'quality') sorted.sort((a, b) => (b.recommendation?.compositeScore ?? -1) - (a.recommendation?.compositeScore ?? -1));
  else if (mode === 'technical') sorted.sort((a, b) => (b.recommendation?.technicalScore ?? -1) - (a.recommendation?.technicalScore ?? -1));
  else sorted.sort((a, b) => (RATING_RANK[b.signal] || 0) - (RATING_RANK[a.signal] || 0) || (b.score || 0) - (a.score || 0));
  return sorted;
}
function sortOpportunities(stocks, mode) {
  return rankStocks(stocks.filter(s => !s.unresolved), mode).slice(0, 5);
}
// Watchlist Research -> Overview's screening matrix: same ranking logic as
// Dashboard's Top Opportunities (rankStocks), but reordering the FULL
// roster in place -- table behavior, not a second Top-5 table -- rather
// than filtering to 5. Unresolved companies have nothing to rank by, so
// they're kept (never dropped) and appended after the ranked ones, in
// their original watchlist order.
function rankAllStocks(stocks, mode) {
  const resolved = stocks.filter(s => !s.unresolved);
  const unresolved = stocks.filter(s => s.unresolved);
  return [...rankStocks(resolved, mode), ...unresolved];
}
// Column sort layers on top of the existing "Sort:" (Rank by) control, same
// coexistence as Overview's ranking dropdown + column sort: opportunitiesSort
// picks the base order, a column click (if any) reorders that same row set.
const OPPORTUNITIES_TABLE_SORT = {
  company: s => s.name, sector: s => s.sector || null, cmp: s => s.price,
  recommendation: s => RATING_RANK[s.signal] || null, upside: s => s.valuation?.upsidePct,
  confidence: s => CONVICTION_RANK[s.valuation?.convictionLevel] || null, driver: s => keyCatalystFor(s) || null
};
function renderTopOpportunities(data) {
  const top = sortOpportunities(data.stocks, opportunitiesSort);
  const sorted = sortForTable('opportunities-table', top, OPPORTUNITIES_TABLE_SORT);
  const rowsHtml = sorted.length ? sorted.map(stock => `<tr data-symbol="${escape(stock.symbol)}">
      <td><button type="button" class="row-company-link" data-symbol="${escape(stock.symbol)}">${escape(stock.name)}</button></td><td>${escape(stock.sector || '')}</td><td class="num">${fmt(stock.price)} ${escape(stock.currency || '')}</td>
      <td class="derived">${signalTag(stock)}</td><td class="num derived">${pct(stock.valuation?.upsidePct)}</td><td class="derived">${escape(stock.valuation?.convictionLevel || '')}</td><td class="derived">${escape(keyCatalystFor(stock))}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="small">No data yet.</td></tr>';
  $('#opportunities-table tbody').innerHTML = rowsHtml;
  initTableSort('opportunities-table');
  initTableLayout('opportunities-table', { resetButtonId: 'opportunities-table-reset-columns' });
}

const IMPACT_CLASS = { High: 'sell', Medium: 'hold', Low: 'neutral' };
// Phase 6 News Intelligence upgrade: sentiment (data/news/companyNews.mjs)
// alongside the existing impact/catalyst tags -- items fetched before this
// stage shipped won't carry `sentiment`/`affectedThesisDriver` until their
// next real refetch (cached bundle, old shape), so both render blank rather
// than a real read, until then.
const SENTIMENT_CLASS = { Positive: 'buy', Negative: 'sell', Uncertain: 'hold', Neutral: 'neutral' };
const THESIS_DRIVER_LABEL = { businessQuality: 'Business quality', growthDrivers: 'Growth drivers', competitivePosition: 'Competitive position', valuationOpportunity: 'Valuation opportunity', keyRisks: 'Key risks' };
function renderDashboardNews(data) {
  const items = data.stocks.flatMap(stock => (stock.news || []).map(item => ({ ...item, company: stock.name })));
  items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  $('#dashboard-news').innerHTML = items.length ? items.slice(0, 20).map(item => `<div class="news-item">
      <div><a target="_blank" rel="noopener" href="${escape(item.url)}">${escape(item.title)}</a><small>${escape(item.company)} &middot; ${escape(item.source)} &middot; ${escape(item.catalystType || 'General')} &middot; ${escape(item.expectedTimeline || 'Unclassified')}${item.affectedThesisDriver ? ` &middot; Affects: ${escape(THESIS_DRIVER_LABEL[item.affectedThesisDriver] || item.affectedThesisDriver)}` : ''}</small></div>
      <div class="news-meta"><span class="tag ${IMPACT_CLASS[item.impact] || 'neutral'}">${escape(item.impact)}</span><span class="tag ${SENTIMENT_CLASS[item.sentiment] || 'neutral'}">${escape(item.sentiment || '')}</span><small>${item.date ? new Date(item.date).toLocaleDateString() : ''}</small></div>
    </div>`).join('') : '<p class="small">No recent company news was returned by the source.</p>';
}

// Phase 6 Earnings Intelligence + Event Calendar: reads
// data.stocks[].earningsIntelligence (real quarterly deltas, data/analytics/
// earningsAnalytics.mjs) and data.eventCalendar (data/analytics/
// eventCalendar.mjs) -- both already computed server-side. Pure formatting.
const IMPACT_CLASS_EI = { High: 'sell', Medium: 'hold', Low: 'buy' };
const EARNINGS_INTEL_TABLE_SORT = {
  company: s => s.name, latestPeriod: s => s.earningsIntelligence?.quarterly?.latestPeriod || null,
  revenueQoq: s => s.earningsIntelligence?.quarterly?.revenue?.qoqPct, revenueYoy: s => s.earningsIntelligence?.quarterly?.revenue?.yoyPct,
  profitQoq: s => s.earningsIntelligence?.quarterly?.netProfit?.qoqPct, profitYoy: s => s.earningsIntelligence?.quarterly?.netProfit?.yoyPct,
  marginQoq: s => s.earningsIntelligence?.quarterly?.operatingMargin?.qoqDeltaPts, marginYoy: s => s.earningsIntelligence?.quarterly?.operatingMargin?.yoyDeltaPts,
  deviation: s => s.earningsIntelligence?.quarterly?.netProfit?.deviationVsTrailingAvgPct,
  calendarStatus: s => s.earningsIntelligence?.calendar?.status || null
};
function renderEarningsIntelligence(data) {
  $('#earnings-methodology-info').innerHTML = infoIcon('earningsIntelligence');
  const eligible = sortForTable('earnings-intel-table', data.stocks.filter(s => !s.unresolved && s.earningsIntelligence), EARNINGS_INTEL_TABLE_SORT);
  $('#earnings-intel-table tbody').innerHTML = eligible.length ? eligible.map(stock => {
    const ei = stock.earningsIntelligence;
    const q = ei.quarterly;
    if (!q) return `<tr data-symbol="${escape(stock.symbol)}"><td>${companyLink(stock.symbol, stock.name)}</td><td colspan="8" class="small">No quarterly results data available.</td><td><span class="tag neutral">${escape(ei.calendar?.status || 'Future Integration')}</span></td></tr>`;
    return `<tr data-symbol="${escape(stock.symbol)}">
      <td>${companyLink(stock.symbol, stock.name)}</td>
      <td>${escape(q.latestPeriod || '')}</td>
      <td class="num derived">${pct(q.revenue.qoqPct)}</td>
      <td class="num derived">${pct(q.revenue.yoyPct)}</td>
      <td class="num derived">${pct(q.netProfit.qoqPct)}</td>
      <td class="num derived">${pct(q.netProfit.yoyPct)}</td>
      <td class="num derived">${q.operatingMargin.qoqDeltaPts == null ? '' : `${q.operatingMargin.qoqDeltaPts >= 0 ? '+' : ''}${q.operatingMargin.qoqDeltaPts}pp`}</td>
      <td class="num derived">${q.operatingMargin.yoyDeltaPts == null ? '' : `${q.operatingMargin.yoyDeltaPts >= 0 ? '+' : ''}${q.operatingMargin.yoyDeltaPts}pp`}</td>
      <td class="num derived">${pct(q.netProfit.deviationVsTrailingAvgPct)}</td>
      <td><span class="tag neutral">${escape(ei.calendar?.status || 'Future Integration')}</span></td>
    </tr>`;
  }).join('') : '<tr><td colspan="10" class="small">This watchlist is empty.</td></tr>';
  initTableSort('earnings-intel-table');
  initTableLayout('earnings-intel-table', { resetButtonId: 'earnings-intel-table-reset-columns' });

  const events = (data.eventCalendar || []).slice(0, 30);
  $('#event-calendar-list').innerHTML = events.length ? events.map(item => `<div class="news-item">
      <div><a target="_blank" rel="noopener" href="${escape(item.url)}">${escape(item.title)}</a><small>${escape(item.name)} &middot; ${escape(item.catalystType || 'General')}</small></div>
      <div class="news-meta"><span class="tag ${IMPACT_CLASS_EI[item.impact] || 'neutral'}">${escape(item.impact)}</span><small>${item.date ? new Date(item.date).toLocaleDateString() : ''}</small></div>
    </div>`).join('') : '<p class="small">No dated events found for this watchlist.</p>';
}

// Phase 6 Morning Briefing: Dashboard's default sub-tab (see initSubtabs()'s
// buttons[0] default and index.html's button order). Composes data already
// computed/fetched elsewhere on this page -- data.executiveSummary/
// intelligence/stocks (server-computed) plus the module-level macroData/
// sectorIntelData already fetched once at startup for their own sub-tabs
// (reused here, never refetched). Zero new computation.
const IMPACT_RANK = { High: 3, Medium: 2, Low: 1 };
function renderMorningBriefing(data) {
  const intel = data.intelligence;
  const regime = macroData?.regime;
  const macroRows = (macroData?.indicators || []).map(ind =>
    `<div class="allocation-row"><span>${escape(ind.label)}</span><span class="${MACRO_DIRECTION_CLASS[ind.direction] || ''}">${pct(ind.changePct)} (${escape(ind.direction)})</span></div>`
  ).join('');
  $('#mb-market-moves').innerHTML = macroData
    ? `<div class="kpi">${escape(regime?.label || '')} ${infoIcon('marketRegime')}</div><div class="small">Confidence: ${escape(regime?.confidence || '')}</div>${macroRows}`
    : '<p class="small">Not available.</p>';

  // Sector state: current-state Sector Intelligence rollup, not a day-over-
  // day delta -- no historical snapshot exists for cross-watchlist sector
  // data (a future-work gap, disclosed in sectorIntelligence.mjs's own
  // dataLimitations), so this shows "today's state," never a fabricated change.
  const topSectors = (sectorIntelData?.sectors || []).slice(0, 5);
  $('#mb-sector-state').innerHTML = topSectors.length
    ? topSectors.map(s => `<div class="allocation-row"><span>${escape(s.sector)} (${s.companyCount})</span><span>${s.avgCompositeScore == null ? '' : `${s.avgCompositeScore}/100`}</span></div>`).join('')
    : '<p class="small">Not available.</p>';

  if (!intel) {
    $('#mb-alerts').innerHTML = '<p class="small">Not available.</p>';
    $('#mb-opportunities').innerHTML = '<p class="small">Not available.</p>';
    $('#mb-risks').innerHTML = '<p class="small">Not available.</p>';
  } else {
    const bySymbol = new Map(data.stocks.map(s => [s.symbol, s]));
    const criticalHigh = intel.alerts.filter(a => a.severity === 'Critical' || a.severity === 'High');
    $('#mb-alerts').innerHTML = criticalHigh.length
      ? criticalHigh.slice(0, 8).map(a => { const s = bySymbol.get(a.symbol); return `<div class="allocation-row" data-symbol="${escape(a.symbol)}"><span>${companyLink(a.symbol, s?.name || a.symbol)}</span><span class="tag ${SEVERITY_TAG_CLASS[a.severity] || 'neutral'}">${escape(a.severity)}</span><span class="small">${escape(a.message || '')}</span></div>`; }).join('')
      : '<p class="small">No Critical/High alerts currently.</p>';

    const actionRow = (a) => { const s = bySymbol.get(a.symbol); return s ? `<div class="allocation-row" data-symbol="${escape(a.symbol)}"><span>${companyLink(a.symbol, s.name)}</span><span class="small">${actionScoreBadge(intel.actionScores[a.symbol])} ${escape(a.rationale || '')}</span></div>` : ''; };
    const topOpportunities = intel.actionRequired.filter(a => ['Add aggressively', 'Add'].includes(a.label)).slice(0, 5);
    $('#mb-opportunities').innerHTML = topOpportunities.length ? topOpportunities.map(actionRow).join('') : '<p class="small">None currently.</p>';
    const topRisks = intel.actionRequired.filter(a => ['Reduce', 'Exit'].includes(a.label)).slice(0, 5);
    $('#mb-risks').innerHTML = topRisks.length ? topRisks.map(actionRow).join('') : '<p class="small">None currently.</p>';
  }

  // Earnings today: always empty -- no earnings-calendar data source exists
  // (nextEarningsDate is always null, data/analytics/earningsAnalytics.mjs)
  // -- disclosed explicitly rather than silently showing an empty list that
  // reads as "nothing due today" when it actually means "can't know."
  $('#mb-earnings-today').innerHTML = '<p class="small">Not available &mdash; no earnings calendar data source is configured in this app (see the Earnings &amp; Events sub-tab). Dates are never estimated or fabricated.</p>';

  const newsItems = data.stocks.flatMap(stock => (stock.news || []).map(item => ({ ...item, company: stock.name })))
    .sort((a, b) => (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) || new Date(b.date || 0) - new Date(a.date || 0));
  $('#mb-top-news').innerHTML = newsItems.length ? newsItems.slice(0, 6).map(item => `<div class="news-item">
      <div><a target="_blank" rel="noopener" href="${escape(item.url)}">${escape(item.title)}</a><small>${escape(item.company)} &middot; ${escape(item.catalystType || 'General')}</small></div>
      <div class="news-meta"><span class="tag ${IMPACT_CLASS[item.impact] || 'neutral'}">${escape(item.impact)}</span><span class="tag ${SENTIMENT_CLASS[item.sentiment] || 'neutral'}">${escape(item.sentiment || '')}</span></div>
    </div>`).join('') : '<p class="small">No recent news.</p>';
}

function renderExecStatus(data) {
  const s = data.executiveSummary || {};
  $('#exec-status').innerHTML = [
    card('Watchlist rating', s.watchlistRating || '', 'Screen-derived signal across saved companies', s.watchlistRating === 'OVERWEIGHT' ? 'positive' : 'amber'),
    card('Valuation status', s.valuationStatus || '', s.avgPremiumDiscount == null ? '' : `Avg ${pct(s.avgPremiumDiscount)} vs. sector median`, ''),
    card('Risk status', s.riskStatus || '', s.avgCompositeRisk == null ? '' : `Avg composite risk ${s.avgCompositeRisk}/100`, s.riskStatus === 'Elevated' ? 'amber' : s.riskStatus === 'Low' ? 'positive' : ''),
    card('Opportunity status', s.opportunityStatus || '', '', '')
  ].join('');
}

function renderDashboardAllocation(data) {
  const allocation = data.sectorAllocation || { allocation: [] };
  const rows = allocation.allocation.map(entry => `<div class="allocation-row"><span>${escape(entry.sector)}</span><div class="bar"><i style="width:${entry.sharePct}%"></i></div><span>${fmt(entry.sharePct)}%</span></div>`).join('');
  const warning = allocation.concentrated ? `<div class="notice amber">More than 40% of this watchlist is in ${escape(allocation.allocation[0]?.sector)} (${fmt(allocation.topShare)}%). Consider diversifying.</div>` : '';
  $('#dashboard-allocation').innerHTML = warning + (rows || '<p class="small">No companies yet.</p>');
}

function renderDashboardSnapshot(data) {
  const avg = data.averages || {}, allocation = data.sectorAllocation || { allocation: [], diversificationScore: null };
  $('#dashboard-snapshot').innerHTML = [
    card('Total companies', data.stocks.length, 'Companies in this watchlist', 'blue'),
    card('Sectors represented', allocation.allocation.length, 'Distinct sectors', 'blue'),
    card('Average P/E', fmt(avg.pe), 'Across companies with reported data', 'blue'),
    card('Average ROE', pct(avg.roe), 'Across companies with reported data', 'positive'),
    card('Average ROCE', pct(avg.roce), 'Across companies with reported data', 'positive'),
    card('Average Debt/Equity', pct(avg.debtToEquity), 'Across companies with reported data', 'amber'),
    card('Average growth (Rev. 3Y)', pct(avg.revenueGrowth3y), 'Across companies with reported data', 'positive'),
    card('Diversification score', allocation.diversificationScore == null ? '' : `${allocation.diversificationScore}/100`, 'Herfindahl-based sector spread', (allocation.diversificationScore ?? 0) > 60 ? 'positive' : 'amber')
  ].join('');
}

function primaryRiskCategory(risk) {
  const entries = Object.entries(risk.categories || {}).filter(([, v]) => v != null);
  if (!entries.length) return '';
  const [key] = entries.sort((a, b) => b[1] - a[1])[0];
  return { financial: 'Financial risk', business: 'Business risk', market: 'Market risk', sector: 'Sector risk', governance: 'Governance risk' }[key] || key;
}
function renderDashboardRisks(data) {
  const eligible = data.stocks.filter(s => !s.unresolved && s.institutionalRisk?.compositeRiskScore != null);
  const top = [...eligible].sort((a, b) => b.institutionalRisk.compositeRiskScore - a.institutionalRisk.compositeRiskScore).slice(0, 5);
  $('#dashboard-risks').innerHTML = top.length ? `<table><thead><tr><th>Company</th><th>Sector</th><th>Composite risk</th><th>Primary risk category</th></tr></thead><tbody>${
    top.map(stock => { const composite = stock.institutionalRisk.compositeRiskScore; return `<tr><td>${escape(stock.name)}</td><td>${escape(stock.sector || '')}</td><td><span class="tag ${composite > 65 ? 'sell' : composite > 40 ? 'hold' : 'buy'}">${composite}/100</span></td><td>${escape(primaryRiskCategory(stock.institutionalRisk))}</td></tr>`; }).join('')
  }</tbody></table>` : '<p class="small">No data yet.</p>';
}

const RISK_FLAG_LABELS = { overvaluation: 'Overvaluation', weakBalanceSheet: 'Weak balance sheet', earningsDeterioration: 'Earnings deterioration', technicalBreakdown: 'Technical breakdown' };
function renderDashboardRiskFlags(data) {
  const rows = data.stocks.filter(s => !s.unresolved && s.keyRiskFlags).map(stock => {
    const flags = Object.entries(stock.keyRiskFlags).filter(([, v]) => v).map(([key]) => RISK_FLAG_LABELS[key]);
    return flags.length ? `<div class="allocation-row"><span>${escape(stock.name)}</span><span>${flags.map(f => `<span class="tag hold">${escape(f)}</span>`).join(' ')}</span></div>` : '';
  }).filter(Boolean);
  $('#dashboard-risk-flags').innerHTML = rows.length ? rows.join('') : '<p class="small">No named risk conditions currently flagged.</p>';
}

// ---- Phase 6 Macro Intelligence: watchlist-independent (data/watchlist/
// macro.mjs, GET /api/macro), so it is fetched once at startup (see start()
// below) rather than being part of the render(data) cascade -- nothing here
// depends on the active watchlist. Re-fetching on tab reopen is cheap: the
// server's own 30min TTL (macro.mjs) decides whether that triggers a real
// Yahoo hit or just serves the disk cache. ----
let macroData = null;
async function loadMacroIntelligence() {
  try { macroData = (await api('/api/macro')).data; }
  catch { macroData = null; }
  renderMacroIntelligence();
  renderMacroTab();
  if (currentData) renderMorningBriefing(currentData); // Morning Briefing reuses macroData -- re-render once it lands, if the watchlist already rendered first
}
const MACRO_STATUS_CLASS = { Live: 'buy', Delayed: 'hold', Unavailable: 'sell', Periodic: 'hold', 'Future Integration': 'neutral', 'Licensing Required': 'neutral', 'Not Programmatically Available': 'neutral', 'Credentials Required': 'hold', 'Token Expired': 'hold', 'Authentication Failed': 'sell', Connected: 'buy', Configured: 'hold', 'Not Configured': 'neutral', 'Provider Unavailable': 'sell' };
const MACRO_DIRECTION_CLASS = { Rising: 'positive', Falling: 'negative', Flat: '', 'N/A': '' };

// Unified indicator + trend row (2026-09-08 merge, hoisted to module scope in
// the Macro IA redesign so both renderMacroIntelligence() -- regime/data
// quality only, scoped to Market Intelligence -- and renderMacroTab() below
// -- every India/US/World indicator table on the new Macro workspace -- share
// one row-rendering/sort implementation, never a second copy). One row per
// indicator, Indicator Details/Performance columns unchanged, Trend
// Parameters columns appended on the same <tr> reusing the exact dmaCell()/
// dmaAlignmentLabel() helpers the Watchlist Research -> Technicals -> Trend
// table already uses for equities -- a macro indicator's `dma20/50/100/200`/
// `price` fields are shaped identically to a stock's `twenty/fifty/hundred/
// twoHundred`/`price`, so the same alignment-counting/gap-% logic applies
// unchanged via this adapter, not a second implementation. A monthly MoSPI
// reading (CPI/IIP) carries `period`/`seriesLabel` -- market indicators
// don't. Surfaced as a title tooltip on the Value cell (rather than a new
// column, which would apply to zero of the other rows) so the actual
// reporting period/series is genuinely visible, not just the fetch timestamp
// already shown in "As of". A `calculated:true` row (the derived Gold ₹/10g
// indicator, see data/watchlist/macro.mjs's toDerivedGoldIndicator()) also
// gets the existing `.derived` fetched-vs-derived class on its Value cell
// itself -- every other row's Value is a genuine fetched price, not derived.
const macroPeriodTitle = ind => {
  if (!ind.period?.year) return '';
  const period = `${ind.period.month ?? ''} ${ind.period.year}`.trim();
  const base = ind.baseYear ? ` (Base ${ind.baseYear}=100)` : '';
  const series = ind.seriesLabel ? ` — ${ind.seriesLabel}` : '';
  return ` title="Reporting period: ${escape(period)}${escape(base)}${escape(series)}"`;
};
// Shared by both the Macro workspace's DMA-style tables (an optional Source
// column, e.g. macro-indicators-india's CPI/IIP/Power Demand rows) and the
// Periodic/Policy table (every row) -- one canonical "Source" cell shape
// (link when a URL exists, plain text otherwise, full citation in the hover
// title) rather than two independently-drifting copies.
function macroSourceCell(ind) {
  return ind.sourceUrl
    ? `<a href="${escape(ind.sourceUrl)}" target="_blank" rel="noopener" title="${escape(ind.source || '')}">${escape(ind.sourceLabel || ind.source || '')}</a>`
    : `<span title="${escape(ind.source || '')}">${escape(ind.sourceLabel || ind.source || '')}</span>`;
}
function macroIndicatorRow(ind, { country, source } = {}) {
  const asStock = { price: ind.value, twenty: ind.dma20, fifty: ind.dma50, hundred: ind.dma100, twoHundred: ind.dma200 };
  return `
    <tr>
      ${country ? `<td>${escape(ind.country || '')}</td>` : ''}
      <td>${escape(ind.label)}</td>
      <td>${escape(ind.category)}</td>
      ${source ? `<td class="small">${macroSourceCell(ind)}</td>` : ''}
      <td class="num${ind.calculated ? ' derived' : ''}"${macroPeriodTitle(ind)}>${ind.value == null ? '' : `${fmt(ind.value)} ${escape(ind.unit || '')}`}</td>
      <td class="num">${pct(ind.changePct)}</td>
      <td class="num">${pct(ind.oneYearChangePct)}</td>
      <td class="derived"><span class="${MACRO_DIRECTION_CLASS[ind.direction] || ''}">${escape(ind.direction)}</span></td>
      <td class="derived"><span class="tag ${MACRO_STATUS_CLASS[ind.status] || 'neutral'}">${escape(ind.status)}</span></td>
      <td>${ind.asOf ? new Date(ind.asOf).toLocaleString() : ''}</td>
      <td class="derived">${escape(ind.trend || 'N/A')}</td>
      <td class="num derived">${dmaCell(ind.value, ind.dma20)}</td>
      <td class="num derived">${dmaCell(ind.value, ind.dma50)}</td>
      <td class="num derived">${dmaCell(ind.value, ind.dma100)}</td>
      <td class="num derived">${dmaCell(ind.value, ind.dma200)}</td>
      <td class="derived">${dmaAlignmentLabel(asStock)}</td>
    </tr>`;
}
// Shared by every macro-unified-table on the Macro workspace -- same row
// shape, same lineage. Sort-only (allowReorder:false wherever this is used):
// every one of these tables has a second colspan group-header row
// ("Indicator Details"/"Performance"/"Trend Parameters") that a dragged
// column would visually misalign.
const MACRO_INDICATOR_SORT = {
  country: ind => ind.country || null, label: ind => ind.label, category: ind => ind.category || null,
  source: ind => ind.sourceLabel || ind.source || null, value: ind => ind.value,
  change: ind => ind.changePct, change1y: ind => ind.oneYearChangePct,
  direction: ind => ind.direction || null, status: ind => ind.status || null,
  asOf: ind => ind.asOf ? new Date(ind.asOf).getTime() : null, trend: ind => ind.trend || null,
  dma20: ind => ind.dma20, dma50: ind => ind.dma50, dma100: ind => ind.dma100, dma200: ind => ind.dma200,
  dmaAlignment: ind => { const dmas = [ind.dma20, ind.dma50, ind.dma100, ind.dma200]; return Number.isFinite(ind.value) ? dmas.filter(d => Number.isFinite(d) && ind.value > d).length : null; }
};
// Renders one macro-unified-table (Indicator Details/Performance/Trend
// Parameters columns) from a `groups.*` bucket -- one shared helper so every
// new Macro workspace table (Indian Indices, Commodities, Macro Indicators,
// US Indices, US Rates, World Asia, World Europe) is wired identically, never
// a per-table copy-paste of sort/render/initTableLayout calls.
function renderMacroIndicatorTable(tableId, resetButtonId, rows, { country, source } = {}) {
  const sorted = sortForTable(tableId, rows || [], MACRO_INDICATOR_SORT);
  const colspan = 14 + (country ? 1 : 0) + (source ? 1 : 0);
  $(`#${tableId} tbody`).innerHTML = sorted.length
    ? sorted.map(ind => macroIndicatorRow(ind, { country, source })).join('') : `<tr><td colspan="${colspan}" class="small">Not available.</td></tr>`;
  initTableSort(tableId);
  initTableLayout(tableId, { resetButtonId, allowReorder: false });
}

function renderMacroIntelligence() {
  if (!macroData) {
    $('#macro-regime').innerHTML = '<p class="small">Not available.</p>';
    $('#macro-data-quality').innerHTML = '';
    return;
  }
  const regime = macroData.regime || {};
  $('#macro-regime').innerHTML = `
    <div class="kpi">${escape(regime.label || '')} ${infoIcon('marketRegime')}</div>
    <div class="small">Confidence: ${escape(regime.confidence || '')}</div>
    <ul>${(regime.notes || []).map(note => `<li>${escape(note)}</li>`).join('')}</ul>`;

  const dq = macroData.dataQuality || {};
  $('#macro-data-quality').innerHTML = [
    card('Live', dq.live ?? 0, 'Fetched within the last 30 minutes (CPI/IIP: within their own 6-hour cache window)', 'positive'),
    card('Delayed', dq.delayed ?? 0, 'Serving a stale cached reading (fresh fetch failed)', dq.delayed ? 'amber' : ''),
    card('Unavailable', dq.unavailable ?? 0, 'Fetch failed and no cached reading exists', dq.unavailable ? 'amber' : ''),
    card('Periodic', dq.periodic ?? 0, 'Real, officially-sourced but annual/event-cadence reading with no live feed to refresh from', dq.periodic ? 'amber' : ''),
    card('Future Integration', dq.futureIntegration ?? 0, 'No data source configured for these indicators', 'neutral')
  ].join('');
}

// Macro workspace (IA redesign, 2026-09-23): India Macro (Indian Indices /
// Commodities / Macro Indicators tabs) / US Macro / World -- extracted out of
// Market Intelligence's old macro-india/macro-us sub-tabs into their own
// top-level sidebar workspace, reading data/watchlist/macro.mjs's
// buildMacroSnapshot()'s new `groups` bucketing directly (see that file's own
// comment) instead of the retired client-side MACRO_US_KEYS split. Every
// table below reuses macroIndicatorRow()/MACRO_INDICATOR_SORT/
// renderMacroIndicatorTable() -- zero new row-rendering logic per table.
function renderMacroTab() {
  $('#macro-methodology-info-india-indices').innerHTML = infoIcon('macroIndicator');
  $('#macro-trend-methodology-info-india-indices').innerHTML = infoIcon('macroTrend');
  $('#macro-methodology-info-india-commodities').innerHTML = infoIcon('commodityInrDerived');
  $('#macro-gold-derived-info').innerHTML = infoIcon('commodityInrDerived');
  $('#macro-methodology-info-india-currencies').innerHTML = infoIcon('macroIndicator');
  $('#macro-currency-cross-rate-info').innerHTML = infoIcon('currencyCrossRateInr');
  $('#macro-cpi-methodology-info').innerHTML = infoIcon('mospiCpiIndicator');
  $('#macro-iip-methodology-info').innerHTML = infoIcon('mospiIndicator');
  $('#macro-periodic-methodology-info').innerHTML = infoIcon('periodicMacroIndicator');
  $('#macro-methodology-info-us-indices').innerHTML = infoIcon('macroIndicator');
  $('#macro-trend-methodology-info-us-indices').innerHTML = infoIcon('macroTrend');
  $('#macro-methodology-info-us-rates').innerHTML = infoIcon('macroIndicator');
  $('#macro-trend-methodology-info-us-rates').innerHTML = infoIcon('macroTrend');
  $('#macro-methodology-info-us-commodities').innerHTML = infoIcon('macroIndicator');
  $('#macro-methodology-info-world-asia').innerHTML = infoIcon('macroIndicator');
  $('#macro-methodology-info-world-europe').innerHTML = infoIcon('macroIndicator');

  const groups = macroData?.groups || {};
  renderMacroIndicatorTable('macro-indices-india', 'macro-indices-india-reset-columns', groups.indiaIndices);
  renderMacroIndicatorTable('macro-commodities-india', 'macro-commodities-india-reset-columns', groups.indiaCommodities);
  renderMacroIndicatorTable('macro-currencies-india', 'macro-currencies-india-reset-columns', groups.currencies);
  renderMacroIndicatorTable('macro-indicators-india', 'macro-indicators-india-reset-columns', groups.indiaMacroIndicators, { source: true });
  renderMacroIndicatorTable('macro-indices-us', 'macro-indices-us-reset-columns', groups.usIndices);
  renderMacroIndicatorTable('macro-rates-us', 'macro-rates-us-reset-columns', groups.usRates);
  renderMacroIndicatorTable('macro-commodities-us', 'macro-commodities-us-reset-columns', groups.usCommodities);
  renderMacroIndicatorTable('macro-world-asia', 'macro-world-asia-reset-columns', groups.worldAsia, { country: true });
  renderMacroIndicatorTable('macro-world-europe', 'macro-world-europe-reset-columns', groups.worldEurope, { country: true });

  // Periodic/Policy tab (2026-09-23 one-table-per-tab fix): the annual/event-
  // cadence readings (macroData.periodic, e.g. Union Defence Budget) and the
  // indicators with no data source at all (macroData.unavailable, "Future
  // Integration") are two statuses of the same underlying concept -- a macro
  // indicator with no live feed -- and share the same Indicator/Category/
  // Status columns, so they render as one merged table instead of two
  // separately-stacked tables in the same tab. An unavailable row simply has
  // no Value/Period/As of/Source, which the missing-data blank convention
  // (CLAUDE.md/system.md 2.6) already renders as an empty cell, not a guess.
  const MACRO_PERIODIC_SORT = {
    label: ind => ind.label, category: ind => ind.category || null, value: ind => ind.value,
    period: ind => ind.period || null, status: ind => ind.status || null,
    asOf: ind => ind.asOfDate ? new Date(ind.asOfDate).getTime() : null, source: ind => ind.sourceLabel || ind.source || null
  };
  const periodicRows = [...(macroData?.periodic || []), ...(macroData?.unavailable || [])];
  const periodic = sortForTable('macro-periodic-table', periodicRows, MACRO_PERIODIC_SORT);
  $('#macro-periodic-table tbody').innerHTML = periodic.map(ind => {
    const statusTitle = ind.statusNote ? ` title="${escape(ind.statusNote)}"` : '';
    return `<tr><td>${escape(ind.label)}</td><td>${escape(ind.category)}</td><td class="num">${ind.value == null ? '' : `${fmt(ind.value)} ${escape(ind.unit || '')}`}</td><td>${escape(ind.period || '')}</td><td class="derived"><span class="tag ${MACRO_STATUS_CLASS[ind.status] || 'neutral'}"${statusTitle}>${escape(ind.status)}</span></td><td>${ind.asOfDate ? new Date(ind.asOfDate).toLocaleDateString() : ''}</td><td class="small">${macroSourceCell(ind)}</td></tr>`;
  }).join('');
  initTableSort('macro-periodic-table');
  initTableLayout('macro-periodic-table', { resetButtonId: 'macro-periodic-table-reset-columns' });
}

// ---- Configuration -> Integrations (2026-09-08): this app's first
// credentialed external source (data/integrations/, GET /api/integrations).
// Watchlist-independent, fetched once at startup like macro/sector data
// above. Every fetch/submit handler in this block is written to never
// console.log a request body -- these forms can carry a MoSPI account
// password, which must never reach the browser console either. ----
let integrationsData = null;
async function loadIntegrations() {
  try { integrationsData = (await api('/api/integrations')).data; }
  catch { integrationsData = null; }
  renderIntegrations();
}
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString() : '—';

// The email pre-fill below is a UI convenience only (this is a single-user
// local tool -- CLAUDE.md §4 -- with no accounts of its own), never a stored
// credential; the field stays a plain editable text input and no password
// field is ever pre-filled or retained.
const MOSPI_PREFILL_EMAIL = 'saumitranaik@gmail.com';

function integrationCard(integ) {
  const statusClass = MACRO_STATUS_CLASS[integ.status] || 'neutral';
  const allDatasets = integ.datasets || [];
  const publicDatasets = allDatasets.filter(d => d.authRequired === false);
  const credentialedDatasets = allDatasets.filter(d => d.authRequired !== false);
  const datasetRow = d => `<tr><td>${escape(d.label)}</td><td>${d.lastSuccessfulFetch ? fmtDateTime(d.lastSuccessfulFetch) : 'Never'}</td><td>${d.hasCachedValue ? 'Yes' : 'No'}</td></tr>`;
  const email = escape(integ.connectedEmail || MOSPI_PREFILL_EMAIL);
  return `
  <div class="card integration-card" data-provider="${escape(integ.providerId)}">
    <div class="section-head">
      <h3>${escape(integ.providerName)}</h3>
      <span class="tag ${statusClass}">${escape(integ.status)}</span>
    </div>
    <p class="small">${escape(integ.providerDescription)}</p>

    <h4 style="margin:14px 0 6px">Public data <span class="tag buy">No credentials required</span></h4>
    <p class="small">Both datasets work automatically, with zero MoSPI account or token. CPI: MoSPI's own CPI API User Manual documents unauthenticated access as intentional platform behavior ("without access token the APIs will fetch only the first 10 records"). IIP: no dedicated manual exists, so this was independently live-tested (2026-09-09) rather than assumed from CPI's own case &mdash; it showed the exact same platform behavior. See the India Macro tab for the live values.</p>
    <table class="tech-table">
      <thead><tr><th>Dataset</th><th>Last successful fetch</th><th>Cached value available</th></tr></thead>
      <tbody>${publicDatasets.map(datasetRow).join('') || '<tr><td colspan="3" class="small">None.</td></tr>'}</tbody>
    </table>

    <h4 style="margin:18px 0 6px">Credential-gated data</h4>
    <p class="small">No MoSPI dataset in this app currently requires a credential &mdash; CPI and IIP are both public (above). The status badge above and the "Connection status"/Account/Token sections below describe this credentialed path only, kept as working infrastructure for any future MoSPI dataset that turns out to genuinely need one &mdash; they do not gate or affect the public data above in any way.</p>
    <table class="tech-table">
      <thead><tr><th>Dataset</th><th>Last successful fetch</th><th>Cached value available</th></tr></thead>
      <tbody>${credentialedDatasets.map(datasetRow).join('') || '<tr><td colspan="3" class="small">None.</td></tr>'}</tbody>
    </table>

    <h4 style="margin:18px 0 6px">Connection status</h4>
    <table class="tech-table">
      <tbody>
        <tr><td>Credential status</td><td>${escape(integ.credentialStatus)}</td></tr>
        <tr><td>Connected as</td><td>${integ.connectedEmail ? escape(integ.connectedEmail) : '—'}</td></tr>
        <tr><td>Token</td><td>${integ.tokenPreview ? escape(integ.tokenPreview) : '—'}</td></tr>
        <tr><td>Token expires</td><td>${fmtDateTime(integ.tokenExpiresAt)}</td></tr>
        <tr><td>Last verified</td><td>${fmtDateTime(integ.lastVerifiedAt)}</td></tr>
        <tr><td>TLS mode (CPI/IIP fetch)</td><td>${integ.tlsMode === 'legacy-renegotiation' ? 'Legacy compatibility (renegotiation enabled)' : 'Standard (secure)'}</td></tr>
        ${integ.lastError ? `<tr><td>Last error</td><td class="small">${escape(integ.lastError)}</td></tr>` : ''}
      </tbody>
    </table>
    <p class="small">MoSPI's own manuals document a 15-minute access-token lifetime with no refresh-token mechanism &mdash; this app never stores your MoSPI password to auto-renew it. "Connected" above is only ever set by a real successful dataset fetch, never by saving a token alone. This entire Account/Token workflow is currently optional for every dataset this app uses &mdash; CPI Inflation and IIP are both public and never need it; it exists only for a possible future credentialed MoSPI dataset.</p>
    <p class="small">TLS mode is set via the <code>MOSPI_TLS_MODE</code> environment variable (<code>standard</code>, the secure default, or <code>legacy-renegotiation</code>, a temporary compatibility exception for MoSPI's current server defect) and applies only to the public CPI/IIP fetches above &mdash; it never weakens TLS for Sign in/Register, which always use standard TLS regardless of this setting. Switching back to <code>standard</code> once MoSPI fixes its server needs a configuration change only, no code change.</p>
    <p class="small" data-integration-message></p>

    <h4 style="margin:18px 0 6px">Account</h4>
    <div class="subtabs" data-account-tabs role="tablist">
      <button type="button" data-account-tab="register" class="active">Register</button>
      <button type="button" data-account-tab="signin">Sign in</button>
      <button type="button" data-account-tab="change-password">Change password</button>
      <button type="button" data-account-tab="recovery">Password recovery</button>
    </div>

    <div data-account-panel="register">
      <p class="small">Creates a MoSPI account (one-time per email; no special characters in username/organization). Your password is sent directly to MoSPI for this one request and is never stored by this app.</p>
      <form data-form-id="signup">
        <div class="manage-row">
          <input name="username" placeholder="Username" autocomplete="username" required>
          <input name="email" type="email" placeholder="Email" autocomplete="email" required value="${email}">
          <input name="password" type="password" placeholder="Password" autocomplete="new-password" required>
          <input name="password2" type="password" placeholder="Confirm password" autocomplete="new-password" required>
          <input name="organization" placeholder="Organization" required>
        </div>
        <button type="submit">Register with MoSPI</button>
        <p class="small" data-form-status></p>
      </form>
    </div>

    <div data-account-panel="signin" hidden>
      <p class="small">Signs in to MoSPI to obtain a fresh access token (documented lifetime: 15 minutes). Your password is used only for this one request and is never stored by this app. A successful sign-in automatically runs Test connection below.</p>
      <form data-form-id="connect">
        <div class="manage-row">
          <input name="email" type="email" placeholder="Email" autocomplete="email" required value="${email}">
          <input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
        </div>
        <button type="submit">Sign in</button>
        <p class="small" data-form-status></p>
      </form>
    </div>

    <div data-account-panel="change-password" hidden>
      <p class="notice amber">MoSPI's published CPI and WPI API manuals document no password-change endpoint, so this app cannot change your MoSPI password on your own behalf &mdash; that would mean either faking the action or routing your password somewhere undocumented, neither of which this app does. Use the official MoSPI portal instead.</p>
      <a href="${escape(integ.manageAccountUrl)}" target="_blank" rel="noopener">Open official MoSPI portal &#8599;</a>
    </div>

    <div data-account-panel="recovery" hidden>
      <p class="notice amber">MoSPI's manuals document no API-based password reset/recovery endpoint. The Swagger UI at MoSPI's own API base URL is the one official surface this app's source audit found &mdash; use it to recover or manage your account directly with MoSPI.</p>
      <a href="${escape(integ.manageAccountUrl)}" target="_blank" rel="noopener">Open official MoSPI account/recovery portal &#8599;</a>
    </div>

    <h4 style="margin:18px 0 6px">Token</h4>
    <div class="manage-row">
      <button type="button" class="icon-btn" data-action="test">Test connection</button>
      <button type="button" class="icon-btn" data-action="disconnect">Disconnect</button>
      <button type="button" class="icon-btn" data-action="toggle-form" data-form="token">Manual token entry (advanced)</button>
    </div>
    <form data-form-id="token" hidden>
      <p class="small">Token normally arrives automatically via Sign in above. Already generated one yourself via MoSPI's own Postman/Swagger flow? Paste it here instead &mdash; this app can't see MoSPI's real issue time for a pasted token, so its expiry countdown is an estimate (15 minutes from now), not a value read from MoSPI.</p>
      <div class="manage-row">
        <input name="accessToken" type="password" placeholder="Access token" autocomplete="off" required>
        <input name="email" type="email" placeholder="Email (optional, for display only)" autocomplete="email" value="${email}">
      </div>
      <button type="submit">Save token</button>
      <p class="small" data-form-status></p>
    </form>
  </div>`;
}

function renderIntegrations() {
  const container = $('#integrations-list');
  if (!container) return;
  if (!integrationsData?.integrations?.length) { container.innerHTML = '<p class="small">Not available.</p>'; return; }
  container.innerHTML = integrationsData.integrations.map(integrationCard).join('');
}

function setFormStatus(form, message, isError) {
  const el = form.querySelector('[data-form-status]');
  if (el) { el.textContent = message; el.style.color = isError ? 'var(--red)' : 'var(--green)'; }
}

function setIntegrationMessage(card, message, isError) {
  const el = card.querySelector('[data-integration-message]');
  if (el) { el.textContent = message || ''; el.style.color = isError ? 'var(--red)' : 'var(--green)'; }
}

// Deliberately self-contained: reuses .subtabs' pill styling for visual
// consistency with the rest of the app, but does NOT hook into the app-wide
// .subtabs/initSubtabs mechanism (applySubtabState() above) -- that
// mechanism is wired once, at page load, over static DOM, while this card's
// markup is (re)built later from data-account-tab/data-account-panel
// attributes it never looks for, so the two never collide.
function showAccountPanel(card, panelName) {
  card.querySelectorAll('[data-account-tab]').forEach(b => b.classList.toggle('active', b.dataset.accountTab === panelName));
  card.querySelectorAll('[data-account-panel]').forEach(p => { p.hidden = p.dataset.accountPanel !== panelName; });
}

$('#integrations-list').addEventListener('click', (event) => {
  const tabBtn = event.target.closest('button[data-account-tab]');
  if (tabBtn) {
    showAccountPanel(tabBtn.closest('.integration-card'), tabBtn.dataset.accountTab);
    return;
  }
  const toggleBtn = event.target.closest('button[data-action="toggle-form"]');
  if (toggleBtn) {
    const card = toggleBtn.closest('.integration-card');
    const target = card.querySelector(`form[data-form-id="${toggleBtn.dataset.form}"]`);
    target.hidden = !target.hidden;
    return;
  }
  const testBtn = event.target.closest('button[data-action="test"]');
  if (testBtn) {
    const card = testBtn.closest('.integration-card');
    testBtn.disabled = true;
    setIntegrationMessage(card, 'Testing connection…', false);
    api('/api/integrations/mospi/test', { method: 'POST' })
      .then(({ data }) => {
        if (!data.success) throw new Error(data.error || 'Test failed.');
        setIntegrationMessage(card, 'Connected — a real dataset fetch succeeded.', false);
      })
      .catch(err => setIntegrationMessage(card, err.message || 'Test connection failed — see Last error above.', true))
      .finally(async () => { testBtn.disabled = false; await loadIntegrations(); await loadMacroIntelligence(); });
    return;
  }
  const disconnectBtn = event.target.closest('button[data-action="disconnect"]');
  if (disconnectBtn) {
    disconnectBtn.disabled = true;
    api('/api/integrations/mospi', { method: 'DELETE' })
      .finally(async () => { disconnectBtn.disabled = false; await loadIntegrations(); await loadMacroIntelligence(); });
  }
});

$('#integrations-list').addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form-id]');
  if (!form) return;
  event.preventDefault();
  const formId = form.dataset.formId;
  const card = form.closest('.integration-card');
  const fields = Object.fromEntries(new FormData(form).entries());
  const submitBtn = form.querySelector('button[type="submit"]');

  // Local-only validation (never sent anywhere) before any network call.
  if (formId === 'signup' && fields.password !== fields.password2) {
    setFormStatus(form, 'Password and confirm password do not match.', true);
    return;
  }

  submitBtn.disabled = true;
  try {
    let result;
    if (formId === 'signup') {
      const { password2, ...body } = fields;
      // apiResult(), not api(): a 409 "account already exists" response
      // needs its `alreadyExists` flag read from the body, which api()'s
      // throw-on-non-2xx behavior would otherwise discard.
      result = (await apiResult('/api/integrations/mospi/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).data;
      if (result?.success === false) {
        if (result.alreadyExists) {
          setFormStatus(form, 'An account with this email already exists on MoSPI. Use Sign in, or Password recovery if you forgot your password.', true);
          showAccountPanel(card, 'signin');
          const signinEmail = card.querySelector('[data-account-panel="signin"] input[name="email"]');
          if (signinEmail) signinEmail.value = fields.email;
          return;
        }
        throw new Error(result.error || 'Registration failed.');
      }
      setFormStatus(form, 'Account created — sign in below to connect.', false);
      form.reset();
      showAccountPanel(card, 'signin');
      const signinEmail = card.querySelector('[data-account-panel="signin"] input[name="email"]');
      if (signinEmail) signinEmail.value = fields.email;
      // Deliberately no loadIntegrations() reload here -- registration alone
      // doesn't change credential status (still Not Configured until sign-
      // in), and reloading would re-render the card from scratch, wiping out
      // the panel switch/prefill above.
      return;
    }
    if (formId === 'connect') {
      const providerId = card.dataset.provider;
      result = (await api('/api/integrations/mospi/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) })).data;
      if (result?.success === false) throw new Error(result.error || 'Sign-in failed.');
      form.reset();
      // Auto-offer/perform Test Connection right after a successful sign-in,
      // per the Configuration page's own workflow (Register → Sign in →
      // Connected → Fetch data) -- a token alone never implies "Connected".
      // Reload happens before AND after the test call, so `card` above is
      // never read again once stale -- the message below is applied to the
      // freshly re-rendered card, found by provider id, not the old node.
      await loadIntegrations();
      await loadMacroIntelligence();
      let testMessage, testFailed;
      try {
        const test = (await api('/api/integrations/mospi/test', { method: 'POST' })).data;
        testFailed = !test.success;
        testMessage = test.success ? 'Signed in and connected — a real dataset fetch succeeded.' : `Signed in, but the connection test failed: ${test.error || 'unknown error'}`;
      } catch (err) {
        testFailed = true;
        testMessage = `Signed in, but the connection test failed: ${err.message || 'unknown error'}`;
      }
      await loadIntegrations();
      await loadMacroIntelligence();
      const freshCard = document.querySelector(`.integration-card[data-provider="${providerId}"]`);
      if (freshCard) setIntegrationMessage(freshCard, testMessage, testFailed);
      return;
    }
    if (formId === 'token') {
      result = (await api('/api/integrations/mospi/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) })).data;
      if (result?.success === false) throw new Error(result.error || 'Request failed.');
      setFormStatus(form, 'Token saved — use Test connection to confirm it actually works.', false);
      form.reset();
      await loadIntegrations();
      await loadMacroIntelligence();
    }
  } catch (err) {
    setFormStatus(form, err.message || 'Request failed.', true);
  } finally {
    submitBtn.disabled = false;
  }
});

// ---- Phase 6 Sector Intelligence: cross-watchlist (data/watchlist/
// sectorIntelligence.mjs, GET /api/sector-intelligence) -- watchlist-
// independent like macro data above, fetched once at startup. ----
let sectorIntelData = null;
async function loadSectorIntelligence() {
  try { sectorIntelData = (await api('/api/sector-intelligence')).data; }
  catch { sectorIntelData = null; }
  renderSectorIntelligence();
  if (currentData) renderMorningBriefing(currentData); // Morning Briefing reuses sectorIntelData too
}
// The Phase 6 brief names these 8 sectors explicitly -- matched against this
// app's real per-company sector strings by the same keyword patterns
// data/analytics/institutionalRisk.mjs's SECTOR_RISK_RULES already uses
// server-side (kept textually identical so this coverage-gap check can never
// disagree with the sector risk tags shown in the same table), purely to
// show which of the 8 have zero coverage in your saved watchlists today.
// Never used to relabel or reclassify a real sector string. Real Screener
// sector labels don't always match a brief's plain-English name (e.g.
// defence-sector companies are labeled "Capital Goods," not "Defence" --
// see docs/governance/roadmap.md TD-1) -- a "gap" here can mean either
// "genuinely no such company added" or "added, but under a sector label this
// pattern doesn't catch," which the panel's own caption discloses.
const PRIORITY_SECTOR_PATTERNS = [
  { label: 'Banking', pattern: /bank|financ|nbfc|insur/i }, { label: 'Power', pattern: /power|utilit/i },
  { label: 'Defence', pattern: /defence|defense|aerospace/i }, { label: 'IT', pattern: /\bit\b|tech|software|internet/i },
  { label: 'Energy', pattern: /oil|gas|petro|energy/i }, { label: 'Chemicals', pattern: /chemical/i },
  { label: 'Pharma', pattern: /pharma|health/i }, { label: 'Auto', pattern: /auto/i }
];
function renderSectorIntelligence() {
  $('#sector-intel-methodology-info').innerHTML = infoIcon('sectorIntelligence');
  if (!sectorIntelData) {
    $('#sector-intel-kpis').innerHTML = '';
    $('#sector-intel-table tbody').innerHTML = '<tr><td colspan="11" class="small">Not available.</td></tr>';
    $('#sector-intel-gaps').innerHTML = '';
    return;
  }
  const sectors = sectorIntelData.sectors || [];
  $('#sector-intel-kpis').innerHTML = [
    card('Companies covered', sectorIntelData.companyCount ?? 0, 'Distinct symbols across every saved watchlist', ''),
    card('Watchlists scanned', sectorIntelData.watchlistCount ?? 0, 'Cache-only -- no new fetch triggered', ''),
    card('Sectors represented', sectors.length, 'Groups with at least 1 company', ''),
    card('Largest sector', sectors[0] ? `${escape(sectors[0].sector)} (${sectors[0].companyCount})` : '', 'By company count', '')
  ].join('');

  const sectorKeyFns = {
    sector: s => s.sector || null, companies: s => s.companyCount, composite: s => s.avgCompositeScore,
    valuation: s => s.avgValuationScore, technical: s => s.avgTechnicalScore, risk: s => s.avgRiskScore,
    relStrength: s => s.avgRelativeStrengthPct, epsCagr: s => s.avgEpsCagr5yPct,
    regulatorySens: s => s.regulatorySensitivity, commoditySens: s => s.commoditySensitivity
  };
  const sortedSectors = sortForTable('sector-intel-table', sectors, sectorKeyFns);
  $('#sector-intel-table tbody').innerHTML = sortedSectors.length ? sortedSectors.map(s => `
    <tr>
      <td>${escape(s.sector)}</td>
      <td class="num derived">${s.companyCount}</td>
      <td class="num derived">${s.avgCompositeScore == null ? '' : `${s.avgCompositeScore}/100`}</td>
      <td class="num derived">${s.avgValuationScore == null ? '' : `${s.avgValuationScore}/100`}</td>
      <td class="num derived">${s.avgTechnicalScore == null ? '' : `${s.avgTechnicalScore}/100`}</td>
      <td class="num derived">${s.avgRiskScore == null ? '' : `${s.avgRiskScore}/100`}</td>
      <td class="num derived">${pct(s.avgRelativeStrengthPct)}</td>
      <td class="num derived">${pct(s.avgEpsCagr5yPct)}</td>
      <td class="num derived">${s.regulatorySensitivity ?? ''}${s.sectorTagsMatched ? '' : ' <span class="small">(baseline)</span>'}</td>
      <td class="num derived">${s.commoditySensitivity ?? ''}</td>
      <td>${Object.entries(s.ratingCounts || {}).map(([r, n]) => `<span class="tag ${tagClass(r)}">${escape(r)} ${n}</span>`).join(' ')}</td>
    </tr>`).join('') : '<tr><td colspan="11" class="small">No companies in any saved watchlist yet.</td></tr>';
  initTableSort('sector-intel-table');
  initTableLayout('sector-intel-table', { resetButtonId: 'sector-intel-table-reset-columns' });

  const covered = (label) => sectors.some(s => PRIORITY_SECTOR_PATTERNS.find(p => p.label === label)?.pattern.test(s.sector));
  const gaps = PRIORITY_SECTOR_PATTERNS.map(p => p.label).filter(label => !covered(label));
  $('#sector-intel-gaps').innerHTML = gaps.length ? gaps.map(label => `<span class="tag neutral">${escape(label)}</span>`).join(' ') : '<p>All 8 priority sectors have at least 1 company in a saved watchlist.</p>';
}

function render(data) {
  currentData = data;
  const activeTab = $('.tab.active')?.id;
  $('#empty').hidden = data.stocks.length > 0 || activeTab === 'watchlists';
  // Company selection survives a refresh/mutation of the same watchlist (it
  // used to be wiped on every render); only an actual watchlist switch tries
  // to restore a persisted company, falling back to the first company.
  if (data.watchlistId !== lastRenderedWatchlistId) {
    lastRenderedWatchlistId = data.watchlistId;
    cmpSortState = {}; // per-table sort only makes sense against the watchlist it was set on
    const persisted = loadPersistedActiveCompany();
    activeCompanySymbol = (persisted && persisted.watchlistId === data.watchlistId && data.stocks.some(s => s.symbol === persisted.symbol))
      ? persisted.symbol
      : data.stocks[0]?.symbol ?? null;
  } else if (!data.stocks.some(s => s.symbol === activeCompanySymbol)) {
    activeCompanySymbol = data.stocks[0]?.symbol ?? null;
  }
  $('#status').textContent = `${data.watchlistName} — Updated ${new Date(data.generatedAt).toLocaleString()}`;
  // Portfolio Analysis's own context line -- Watchlist Research shows no
  // equivalent line since the global "Watchlist context" header bar already
  // names the active watchlist on every workspace; repeating it in-page here
  // too was a duplicate heading (see the Watchlist Research IA audit).
  if ($('#portfolio-watchlist-context')) $('#portfolio-watchlist-context').innerHTML = `<b>${escape(data.watchlistName)}</b> &middot; ${data.stocks.length} compan${data.stocks.length === 1 ? 'y' : 'ies'}`;
  if ($('#portfolio-disclaimer-info')) $('#portfolio-disclaimer-info').innerHTML = helpIcon('<b>Watchlist-derived, not a transaction ledger.</b> Every figure below reads the same illustrative target-weight allocation as the rest of this app &mdash; there is no buy/sell/quantity/price transaction record, cost basis, or realized/unrealized P&amp;L anywhere in this app today. <b>Transactions</b> is future, deferred functionality &mdash; not built, not faked here.');
  $('#summary').textContent = data.summary;
  $('#data-limitations').innerHTML = (data.dataLimitations || []).map(item => `<li>${escape(item)}</li>`).join('');

  renderMorningBriefing(data);
  renderExecStatus(data);
  renderDashboardKpis(data);
  renderTopOpportunities(data);
  renderDashboardNews(data);
  renderDashboardAllocation(data);
  renderDashboardSnapshot(data);

  renderFundamentals(data);
  renderValuationTab(data.stocks);
  renderValuationDetail(data);
  renderProfitability(compareMode && compareSymbols.length >= 2 ? data.stocks.filter(s => compareSymbols.includes(s.symbol)) : data.stocks);
  renderBalanceSheetTab(data.stocks);
  renderGrowthTab(data.stocks);
  renderOwnershipTab(data.stocks);
  renderOwnershipDetail(data);
  renderCompanyResearchOverview(data);
  renderCompanyResearchQuality(data);
  renderCompanyResearchGrowth(data);
  renderCompanyResearchIntelligence(data);
  renderTechnicalTab(data.stocks);
  renderTechnicalDetail(data);
  renderWrOverviewTable(data);
  renderPortfolioTab(data.stocks);
  renderPortfolioAnalytics(data);
  renderExposureMatrix(data);
  renderCompareWorkspace(data);
  renderReportsWorkspace();

  renderDashboardRisks(data);
  renderDashboardRiskFlags(data);
  renderEarningsIntelligence(data);
  const eligible = data.stocks.filter(s => !s.unresolved && s.institutionalRisk);
  const avgCategory = (key) => { const values = eligible.map(s => s.institutionalRisk.categories?.[key]).filter(v => v != null); return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null; };
  $('#risk-cards').innerHTML = [
    riskCard('Financial risk', avgCategory('financial'), 'financialRisk'), riskCard('Business risk', avgCategory('business'), 'businessRisk'),
    riskCard('Market risk', avgCategory('market'), 'marketRisk'), riskCard('Sector risk', avgCategory('sector'), 'sectorRisk'),
    riskCard('Governance risk', avgCategory('governance'), 'governanceRisk')
  ].join('');
  const thesisBySymbol = data.intelligence?.thesis || {};
  const downside200Of = (stock) => stock.price && stock.twoHundred ? (stock.twoHundred / stock.price - 1) * 100 : null;
  const downsideLowOf = (stock) => stock.price && stock.low52 ? (stock.low52 / stock.price - 1) * 100 : null;
  const riskTableSort = {
    ...STANDARD_SORT_KEYS, interestCoverage: s => s.metrics?.interestCoverage, financial: s => s.institutionalRisk?.categories?.financial,
    business: s => s.institutionalRisk?.categories?.business, market: s => s.institutionalRisk?.categories?.market,
    // "sectorRisk", not "sector" -- this table has two different "Sector"
    // columns (the company's sector, and the Sector-risk-category score);
    // "sector" stays the standard company-sector column from STANDARD_SORT_KEYS.
    sectorRisk: s => s.institutionalRisk?.categories?.sector, governance: s => s.institutionalRisk?.categories?.governance,
    downside200: s => downside200Of(s), downsideLow: s => downsideLowOf(s), composite: s => s.institutionalRisk?.compositeRiskScore,
    trend: s => s.institutionalRisk?.riskTrend || null, thesisStatus: s => THESIS_STATUS_RANK[thesisBySymbol[s.symbol]?.status] || null
  };
  const sortedRiskRows = sortForTable('risk-table', eligible, riskTableSort);
  $('#risk-table tbody').innerHTML = sortedRiskRows.length ? sortedRiskRows.map(stock => {
    const m = stock.metrics || {}, r = stock.institutionalRisk, c = r.categories || {};
    const downside200 = downside200Of(stock);
    const downsideLow = downsideLowOf(stock);
    const thesis = thesisBySymbol[stock.symbol];
    return `<tr data-symbol="${escape(stock.symbol)}">${prefixCells(stock)}<td class="derived">${suffixed(m.interestCoverage, 'x')}</td><td class="derived">${scoreText(c.financial, true)}</td><td class="derived">${scoreText(c.business, true)}</td><td class="derived">${scoreText(c.market, true)}</td><td class="derived">${scoreText(c.sector, true)}</td><td class="derived">${scoreText(c.governance, true)}</td><td class="derived">${pct(downside200)}</td><td class="derived">${pct(downsideLow)}</td><td class="derived"><span class="tag ${r.compositeRiskScore > 65 ? 'hold' : 'buy'}">${fmt(r.compositeRiskScore)}/100</span></td><td class="derived">${escape(r.riskTrend || '')}</td><td class="derived">${thesis ? `<span class="tag ${thesis.status === 'Broken' ? 'sell' : thesis.status === 'Weakening' ? 'reduce' : thesis.status === 'Improving' ? 'buy' : 'hold'}">${escape(thesis.status)}</span>` : ''}</td></tr>`;
  }).join('') : '<tr><td colspan="15" class="small">This watchlist is empty.</td></tr>';
  initTableSort('risk-table');
  initTableLayout('risk-table', { resetButtonId: 'risk-table-reset-columns' });
  renderRiskDetail(data);
  $('#risk-summary').textContent = eligible.length ? `The composite risk score for ${data.watchlistName} blends Financial, Business, Market, Sector and Governance risk for each company, shown above alongside two price-based downside scenarios (reversion to the 200-day average and to the 52-week low). Sector risk is a static, disclosed qualitative lookup, not a live feed; several Business/Governance sub-items have no data source and are not estimated -- see the deep-dive panel below. These are comparative screening indicators, not predictions.` : 'Risk analysis will appear once the watchlist has companies.';
  renderAlerts(data);

  renderPortfolioIntelligence(data);
  renderCommitteeView(data);
  renderHealthRebalancing(data);
  // Phase 6: re-render (not re-fetch) the Macro Intelligence panel here too --
  // macroData itself is watchlist-independent and fetched once in start(),
  // but its info icons read currentData.metricMeta, which may not exist yet
  // the first time loadMacroIntelligence()'s own fetch resolves (macro is a
  // lighter fetch than a watchlist's research payload and often wins the
  // race). This just re-applies already-fetched macroData to the DOM.
  renderMacroIntelligence();
  renderMacroTab();
  renderSectorIntelligence();

  renderWatchlistsTab(data);
  renderHeaderCompanySelector();
  refreshActiveCompanyHighlights();
  // render() can reflow table widths/row counts (new data, a mutation, a
  // watchlist switch) without a resize or workspace-tab switch ever firing --
  // refresh the floating-header clones and the Company Research scrollspy
  // band here, the one place every data-driven repaint funnels through, so
  // neither depends on the caller to remember.
  syncHeaderHeight();
}

// Watchlist Research -> Ranking's sort select shares the same
// `opportunitiesSort` state as Dashboard's Top Opportunities -- one ranking,
// two display locations, kept in sync both ways.
function setOpportunitiesSort(value) {
  opportunitiesSort = value;
  $('#opportunities-sort').value = value;
  if ($('#wr-ranking-sort')) $('#wr-ranking-sort').value = value;
  if (currentData) {
    renderTopOpportunities(currentData);
    renderWrOverviewTable(currentData);
  }
}
$('#opportunities-sort').addEventListener('change', () => setOpportunitiesSort($('#opportunities-sort').value));
$('#wr-ranking-sort')?.addEventListener('change', () => setOpportunitiesSort($('#wr-ranking-sort').value));

// ---- Watchlist management: switch / create / rename / duplicate / delete /
// export / import watchlists; add (autocomplete) / remove / reorder / weight
// / notes / individually-refresh companies -- all from the full-screen
// Watchlists tab (see renderWatchlistsTab below). Every mutating call gets
// back the full recomputed research payload and calls render() once, same
// pattern the old single-report flow used. ----
async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request to ${path} failed.`);
  return { data };
}
// Like api(), but never throws on a non-2xx response -- for the rare caller
// that needs a field from an *error* body (e.g. MoSPI signup's 409 response
// carries `alreadyExists`, not just a message) rather than just the thrown
// Error's text api() gives everyone else.
async function apiResult(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
function renderWatchlistSelect() {
  const options = watchlistIndex.watchlists.map(w =>
    `<option value="${escape(w.id)}" ${w.id === watchlistIndex.activeWatchlist ? 'selected' : ''}>${escape(w.name)} (${w.companyCount})</option>`
  ).join('');
  $('#watchlist-select').innerHTML = options;
  $('#wl-select').innerHTML = options;
}
function showWlNotice(text) {
  const el = $('#wl-notice');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(showWlNotice._timer);
  showWlNotice._timer = setTimeout(() => { el.hidden = true; }, 6000);
}
function highlightWlRow(symbol) {
  const row = $(`#wl-table tr[data-symbol="${CSS.escape(symbol)}"]`);
  if (!row) return;
  row.classList.add('flash');
  row.scrollIntoView({ block: 'center' });
  setTimeout(() => row.classList.remove('flash'), 1500);
}

// ---- Watchlists tab rendering: portfolio summary, filter options and the
// company table -- client-side sort/filter/search/multi-select over
// data.stocks, never mutating that canonical watchlist-order array. ----
// Phase 4: predicate for the Watchlists "monitoring" filter chips -- every
// branch reads a field data.intelligence/data.stocks already computed
// (data/decision/*.mjs); "High upside" is the one plain UI-display threshold
// (20% upside to Target Price), disclosed via the chip's own label rather
// than hidden inside a new tier.
function stockMatchesIntelFilter(stock, filter, intel) {
  switch (filter) {
    case 'Add aggressively': case 'Add': case 'Hold': case 'Reduce': case 'Exit':
      return intel?.actionScores?.[stock.symbol]?.label === filter;
    case 'High risk':
      return (stock.institutionalRisk?.compositeRiskScore ?? 0) >= 65;
    case 'High upside':
      return (stock.valuation?.upsidePct ?? 0) >= 20;
    case 'Technical breakout':
      return BREAKOUT_REGIMES.includes(stock.technicalScorecard?.regime);
    case 'Recent changes':
      return !!intel?.changes?.bySymbol?.[stock.symbol]?.hasChanges;
    default: return true;
  }
}
function wlFilteredSortedStocks(data) {
  let stocks = [...data.stocks];
  if (wlFilterSector) stocks = stocks.filter(s => (s.sector || 'Unclassified') === wlFilterSector);
  if (wlFilterRecommendation) stocks = stocks.filter(s => s.signal === wlFilterRecommendation);
  if (wlSearchQuery) {
    const q = wlSearchQuery.toLowerCase();
    stocks = stocks.filter(s => s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q));
  }
  if (wlIntelFilters.size) stocks = stocks.filter(s => [...wlIntelFilters].some(f => stockMatchesIntelFilter(s, f, data.intelligence)));
  if (wlSortColumn) {
    const dir = wlSortDir === 'asc' ? 1 : -1;
    const accessor = {
      name: s => s.name, sector: s => s.sector || null, price: s => s.price, pe: s => s.pe,
      signal: s => RATING_RANK[s.signal] || 0, confidence: s => CONVICTION_RANK[s.recommendation?.confidence] || 0,
      weight: s => s.effectiveWeightPct, marketCap: s => s.marketCap, roe: s => s.roe, roce: s => s.roce,
      growth: s => s.metrics?.revenueCagr3y, risk: s => s.institutionalRisk?.compositeRiskScore,
      updated: s => s.fetchedAt ? new Date(s.fetchedAt).getTime() : 0,
      actionScore: s => data.intelligence?.actionScores?.[s.symbol]?.score,
      action: s => ({ 'Add aggressively': 5, Add: 4, Hold: 3, Reduce: 2, Exit: 1 }[data.intelligence?.actionScores?.[s.symbol]?.label] || 0),
      fvGap: s => s.valuation?.marginOfSafetyPct,
      riskTrend: s => s.institutionalRisk?.riskTrend || null,
      techTrend: s => s.technicalScorecard?.regime || null,
      alertCount: s => (data.intelligence?.alerts || []).filter(a => a.symbol === s.symbol).length,
      lastChange: s => data.intelligence?.changes?.bySymbol?.[s.symbol]?.hasChanges ? 1 : 0
    }[wlSortColumn];
    // N/A always sorts last regardless of direction -- matches isSortNA's
    // convention (script.js's shared sortForTable) everywhere else in the app.
    stocks.sort((a, b) => {
      const av = accessor(a), bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return typeof av === 'string' ? av.localeCompare(bv) * dir : (av - bv) * dir;
    });
  }
  return stocks;
}
function wlLastUpdatedText(stock) {
  if (!stock.fetchedAt) return 'Never';
  const d = new Date(stock.fetchedAt);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${stock.stale ? ' (stale)' : ''}`;
}
function renderWlSummary(data) {
  const eligible = data.stocks.filter(s => !s.unresolved);
  const allocation = data.sectorAllocation || { allocation: [], diversificationScore: null, concentrated: false, topShare: null };
  const avgValuation = avgOf(eligible.map(s => s.relativeValuation?.premiumDiscountScore));
  const avgQuality = avgOf(eligible.map(s => s.recommendation?.compositeScore));
  const avgRisk = avgOf(eligible.map(s => s.institutionalRisk?.compositeRiskScore));
  $('#wl-summary').innerHTML = [
    card('Total companies', data.stocks.length, `${allocation.allocation.length} sector${allocation.allocation.length === 1 ? '' : 's'} represented`, 'blue'),
    card(`Diversification score ${infoIcon('diversification')}`, allocation.diversificationScore == null ? '' : `${allocation.diversificationScore}/100`, 'Herfindahl-based sector spread', ''),
    card('Average valuation', avgValuation == null ? '' : pct(avgValuation), 'Avg premium/discount vs. sector median', ''),
    card('Average quality', avgQuality == null ? '' : `${Math.round(avgQuality)}/100`, 'Avg composite recommendation score', ''),
    card('Average risk', avgRisk == null ? '' : `${Math.round(avgRisk)}/100`, 'Avg composite risk score', (avgRisk ?? 0) > 65 ? 'amber' : ''),
    card(`Cash allocation ${infoIcon('cashTargetPct')}`, `${fmt(data.portfolio?.cashTargetPct ?? 0)}%`, 'User-set illustrative target', '')
  ].join('');
  $('#wl-concentration-warning').innerHTML = allocation.concentrated ? `<div class="notice amber">More than 40% of this watchlist is in ${escape(allocation.allocation[0]?.sector)} (${fmt(allocation.topShare)}%). Consider diversifying.</div>` : '';
  $('#wl-limits-banner').hidden = data.stocks.length <= 20;
}
function renderWlFilterOptions(data) {
  const sectorSel = $('#wl-filter-sector'), recSel = $('#wl-filter-recommendation');
  const sectors = [...new Set(data.stocks.map(s => s.sector || 'Unclassified'))].sort();
  sectorSel.innerHTML = '<option value="">All sectors</option>' + sectors.map(s => `<option value="${escape(s)}">${escape(s)}</option>`).join('');
  sectorSel.value = sectors.includes(wlFilterSector) ? wlFilterSector : '';
  wlFilterSector = sectorSel.value;
  const recs = [...new Set(data.stocks.map(s => s.signal).filter(sig => sig && sig !== 'N/A'))];
  recSel.innerHTML = '<option value="">All recommendations</option>' + recs.map(r => `<option value="${escape(r)}">${escape(r)}</option>`).join('');
  recSel.value = recs.includes(wlFilterRecommendation) ? wlFilterRecommendation : '';
  wlFilterRecommendation = recSel.value;
}
function renderWlTable(data) {
  const stocks = wlFilteredSortedStocks(data);
  const naturalOrder = !wlSortColumn; // reorder (up/down) only makes sense against the watchlist's own saved order, not a column sort
  $$('#wl-table thead th[data-sort]').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === wlSortColumn) th.classList.add(wlSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  });
  $('#wl-table tbody').innerHTML = stocks.length ? stocks.map((stock) => {
    const naturalIndex = data.stocks.indexOf(stock);
    const action = data.intelligence?.actionScores?.[stock.symbol];
    const alertCount = (data.intelligence?.alerts || []).filter(a => a.symbol === stock.symbol).length;
    const changeEntry = data.intelligence?.changes?.bySymbol?.[stock.symbol];
    const lastChangeLabel = changeEntry?.hasChanges ? (changeEntry.changes[0]?.label || 'Changed') : '—';
    return `<tr data-symbol="${escape(stock.symbol)}">
      <td><input type="checkbox" class="wl-row-select" data-symbol="${escape(stock.symbol)}" ${wlSelected.has(stock.symbol) ? 'checked' : ''}></td>
      <td><button type="button" class="row-company-link" data-symbol="${escape(stock.symbol)}">${escape(stock.name)}</button></td>
      <td>${escape(stock.sector || '')}</td>
      <td class="num">${fmt(stock.price)}</td>
      <td class="num">${fmt(stock.pe)}</td>
      <td class="derived">${stock.unresolved ? '' : signalTag(stock)}</td>
      <td class="derived">${escape(stock.recommendation?.confidence || '')}</td>
      <td class="num"><input type="number" class="weight-input" min="0" max="100" step="1" placeholder="Equal" value="${stock.targetWeightPct ?? ''}" data-symbol="${escape(stock.symbol)}" title="Target allocation weight % (blank = equal-weight share of the remainder)"></td>
      <td class="num">${stock.marketCap == null ? '' : `${compact(stock.marketCap)} ${escape(stock.marketCapUnit || '')}`}</td>
      <td class="num">${pct(stock.roe)}</td>
      <td class="num">${pct(stock.roce)}</td>
      <td class="num derived">${pct(stock.metrics?.revenueCagr3y)}</td>
      <td class="num derived">${scoreText(stock.institutionalRisk?.compositeRiskScore, true)}</td>
      <td>${escape(wlLastUpdatedText(stock))}</td>
      <td class="num derived" title="${escape(actionScoreTitle(action))}">${action ? `${action.score}/100` : ''}</td>
      <td class="derived">${actionScoreBadge(action)}</td>
      <td class="num derived">${fairValueGapCell(stock)}</td>
      <td class="derived">${escape(stock.institutionalRisk?.riskTrend || '')}</td>
      <td class="derived">${escape(stock.technicalScorecard?.regime || '')}</td>
      <td class="num derived">${alertCount}</td>
      <td class="derived">${escape(lastChangeLabel)}</td>
      <td class="wl-notes-cell"><input type="text" class="wl-notes-input" placeholder="Add note" value="${escape(stock.notes || '')}" data-symbol="${escape(stock.symbol)}"></td>
      <td class="company-row-actions">
        <button type="button" class="icon-btn" data-action="refresh-one" data-symbol="${escape(stock.symbol)}" title="Refresh this company">&#8635;</button>
        ${naturalOrder ? `<button type="button" class="icon-btn" data-action="up" data-symbol="${escape(stock.symbol)}" ${naturalIndex === 0 ? 'disabled' : ''} title="Move up">&#9650;</button>
        <button type="button" class="icon-btn" data-action="down" data-symbol="${escape(stock.symbol)}" ${naturalIndex === data.stocks.length - 1 ? 'disabled' : ''} title="Move down">&#9660;</button>` : ''}
        <button type="button" class="icon-btn" data-action="report" data-symbol="${escape(stock.symbol)}" ${stock.unresolved ? 'disabled' : ''} title="Generate institutional research report">&#128196;</button>
        <button type="button" class="icon-btn" data-action="remove" data-symbol="${escape(stock.symbol)}" title="Remove">&#10005;</button>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="23" class="small">No companies match the current filter, or this watchlist is empty.</td></tr>`;
  $('#wl-select-all').checked = stocks.length > 0 && stocks.every(s => wlSelected.has(s.symbol));
  $('#wl-bulk-bar').hidden = wlSelected.size === 0;
  $('#wl-bulk-count').textContent = `${wlSelected.size} selected`;
  // Resize/reorder/persist/reset only -- this table's own bespoke sort
  // (wlSortColumn/wlSortDir, above) stays exactly as-is; the generic engine
  // only touches <th data-sort> DOM/width/order state, so it layers on
  // safely regardless of which mechanism drives row order. The leading
  // checkbox column and trailing Notes/Actions columns have no `data-sort`,
  // so they're naturally excluded and stay pinned at their current ends.
  initTableLayout('wl-table', { resetButtonId: 'wl-table-reset-columns' });
}
function renderWatchlistsTab(data) {
  if (data.watchlistId !== wlLastWatchlistId) {
    wlLastWatchlistId = data.watchlistId;
    wlSelected = new Set(); wlSortColumn = null; wlSortDir = 'asc';
    wlFilterSector = ''; wlFilterRecommendation = ''; wlSearchQuery = '';
    wlIntelFilters = new Set();
    $('#wl-search').value = '';
    $$('#wl-intel-filters .pill').forEach(p => p.classList.remove('active'));
  }
  const symbolSet = new Set(data.stocks.map(s => s.symbol));
  for (const symbol of [...wlSelected]) if (!symbolSet.has(symbol)) wlSelected.delete(symbol);

  $('#wl-active-name').textContent = data.watchlistName;
  $('#wl-rename-input').value = data.watchlistName;
  $('#wl-cash-target').value = data.portfolio?.cashTargetPct ?? 0;
  renderWlSummary(data);
  renderWlFilterOptions(data);
  renderWlTable(data);
  renderWlCustomTable(data);
}

async function switchWatchlist(id) {
  $('#status').textContent = 'Switching watchlist...';
  const { data } = await api('/api/watchlists/active', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
  watchlistIndex = data.index;
  renderWatchlistSelect();
  await loadWatchlist(id, data.research);
}

// Cache-only paint first (instant), then an incremental background refresh
// (only missing/stale companies) -- same two-step pattern used on startup,
// reused here for switch/create/duplicate/delete so an unvisited watchlist
// doesn't sit mostly blank until the user remembers to click Refresh Data.
async function loadWatchlist(id, initialData) {
  render(initialData || (await api(`/api/watchlists/${id}/research`)).data);
  $('#status').textContent = `${currentData.watchlistName} — refreshing...`;
  try {
    render((await api(`/api/watchlists/${id}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).data);
  } catch (error) {
    $('#status').textContent = `Refresh failed: ${error.message}`;
  }
}

async function start() {
  loadCompanySearchIndex(); // fire-and-forget -- runs concurrently with the research load below, not on its critical path
  loadMacroIntelligence(); // fire-and-forget -- watchlist-independent (Phase 6), not on the research load's critical path either
  loadIntegrations(); // fire-and-forget -- watchlist-independent, same as macro/sector intelligence above
  loadSectorIntelligence(); // fire-and-forget -- cross-watchlist (Phase 6), same rationale
  try {
    watchlistIndex = (await api('/api/watchlists')).data;
    renderWatchlistSelect();
    $('#status').textContent = 'Loading cached data...';
    await loadWatchlist(watchlistIndex.activeWatchlist);
  } catch (error) {
    $('#status').textContent = `Failed to load: ${error.message}`;
  }
}
start();

$('#watchlist-select').addEventListener('change', () => switchWatchlist($('#watchlist-select').value));
$('#wl-select').addEventListener('change', () => switchWatchlist($('#wl-select').value));

$('#wl-new-btn').addEventListener('click', async () => {
  const name = prompt('New watchlist name:');
  if (!name) return;
  const { data } = await api('/api/watchlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  watchlistIndex = data.index;
  renderWatchlistSelect();
  await loadWatchlist(data.watchlist.id);
});

$('#wl-rename-btn').addEventListener('click', async () => {
  const name = $('#wl-rename-input').value.trim();
  if (!name) return;
  const id = watchlistIndex.activeWatchlist;
  const { data } = await api(`/api/watchlists/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  watchlistIndex = data.index;
  renderWatchlistSelect();
  render((await api(`/api/watchlists/${id}/research`)).data);
});

$('#wl-duplicate-btn').addEventListener('click', async () => {
  const id = watchlistIndex.activeWatchlist;
  const name = prompt('Name for the duplicate:', `${currentData?.watchlistName || ''} copy`);
  if (!name) return;
  const { data } = await api(`/api/watchlists/${id}/duplicate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  watchlistIndex = data.index;
  renderWatchlistSelect();
  await loadWatchlist(data.watchlist.id);
});

$('#wl-delete-btn').addEventListener('click', async () => {
  if (!currentData || !confirm(`Delete watchlist "${currentData.watchlistName}"? This cannot be undone.`)) return;
  const id = watchlistIndex.activeWatchlist;
  const { data } = await api(`/api/watchlists/${id}`, { method: 'DELETE' });
  watchlistIndex = data.index;
  renderWatchlistSelect();
  await loadWatchlist(data.index.activeWatchlist, data.research);
});

$('#refresh-btn').addEventListener('click', async () => {
  const button = $('#refresh-btn');
  button.disabled = true; button.textContent = 'Refreshing...';
  $('#status').textContent = 'Refreshing all companies...';
  try {
    const { data } = await api(`/api/watchlists/${watchlistIndex.activeWatchlist}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: true }) });
    render(data);
  } finally { button.disabled = false; button.textContent = 'Refresh Data'; }
});

$('#wl-cash-target').addEventListener('change', async () => {
  const id = watchlistIndex.activeWatchlist;
  const { data } = await api(`/api/watchlists/${id}/cash-target`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cashTargetPct: Number($('#wl-cash-target').value) || 0 }) });
  render(data);
});

// Export serializes the persisted, portable company fields this watchlist
// actually stores (not derived research output) -- symmetric with Import
// below, which POSTs the same shape to /api/watchlists/import.
$('#wl-export-btn').addEventListener('click', () => {
  if (!currentData) return;
  const payload = {
    name: currentData.watchlistName, cashTargetPct: currentData.portfolio?.cashTargetPct ?? 0,
    companies: currentData.stocks.map(s => ({ symbol: s.symbol, name: s.name, exchange: s.exchange, market: s.market, sector: s.sector, industry: s.industry, notes: s.notes, targetWeightPct: s.targetWeightPct }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${(currentData.watchlistName || 'watchlist').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});
// Phase 5: printable Portfolio Review Pack -- a standalone page
// (portfolio-review.html/js) mirroring report.html's per-company report
// pattern at watchlist scope. Read-only navigation, same as the per-company
// "Report" launch points (Quick Jump, the Watchlists table row button).
// Phase 6.5: these 3 helpers are the single canonical way any button in this
// app opens a standalone report page -- the Reports workspace and every
// pre-existing launch point (Quick Jump, Watchlists manage row, Committee
// View, the per-row report action) all call the same 3 functions instead of
// each constructing its own window.open URL.
function openCompanyReport(symbol) {
  if (!watchlistIndex?.activeWatchlist || !symbol) return;
  window.open(`report.html?wl=${encodeURIComponent(watchlistIndex.activeWatchlist)}&symbol=${encodeURIComponent(symbol)}`, '_blank');
}
function openPortfolioReview() {
  if (!watchlistIndex?.activeWatchlist) return;
  window.open(`portfolio-review.html?wl=${encodeURIComponent(watchlistIndex.activeWatchlist)}`, '_blank');
}
function openCommitteePack() {
  if (!watchlistIndex?.activeWatchlist) return;
  window.open(`committee-pack.html?wl=${encodeURIComponent(watchlistIndex.activeWatchlist)}`, '_blank');
}
function renderReportsWorkspace() {
  const stock = currentData?.stocks.find(s => s.symbol === activeCompanySymbol);
  const label = $('#reports-active-company');
  if (label) label.textContent = stock ? `Active company: ${stock.name} (${stock.symbol})` : 'No company selected';
  const btn = $('#reports-company-report-btn');
  if (btn) btn.disabled = !stock;
}
$('#wl-portfolio-review-btn').addEventListener('click', openPortfolioReview);
$('#cv-portfolio-review-btn').addEventListener('click', openPortfolioReview);
$('#cv-committee-pack-btn').addEventListener('click', openCommitteePack);
$('#reports-company-report-btn')?.addEventListener('click', () => openCompanyReport(activeCompanySymbol));
$('#reports-portfolio-review-btn')?.addEventListener('click', openPortfolioReview);
$('#reports-committee-pack-btn')?.addEventListener('click', openCommitteePack);
$('#wl-import-btn').addEventListener('click', () => $('#wl-import-file').click());
$('#wl-import-file').addEventListener('change', async () => {
  const file = $('#wl-import-file').files[0];
  $('#wl-import-file').value = '';
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const { data } = await api('/api/watchlists/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    watchlistIndex = data.index;
    renderWatchlistSelect();
    await loadWatchlist(data.watchlist.id, data.research);
  } catch (error) {
    showWlNotice(`Import failed: ${error.message}`);
  }
});

// ---- Company table: sort (click header) / filter (sector, recommendation,
// search) / multi-select (checkbox + bulk refresh/remove) / per-row actions
// (weight, notes, individual refresh, reorder, remove). ----
$('#wl-search').addEventListener('input', () => { wlSearchQuery = $('#wl-search').value.trim(); if (currentData) renderWlTable(currentData); });
$('#wl-filter-sector').addEventListener('change', () => { wlFilterSector = $('#wl-filter-sector').value; if (currentData) renderWlTable(currentData); });
$('#wl-filter-recommendation').addEventListener('change', () => { wlFilterRecommendation = $('#wl-filter-recommendation').value; if (currentData) renderWlTable(currentData); });
$('#wl-intel-filters').addEventListener('click', (event) => {
  const button = event.target.closest('.pill[data-intel-filter]');
  if (!button) return;
  const filter = button.dataset.intelFilter;
  if (wlIntelFilters.has(filter)) wlIntelFilters.delete(filter); else wlIntelFilters.add(filter);
  button.classList.toggle('active');
  if (currentData) renderWlTable(currentData);
});

$('#wl-table thead').addEventListener('click', (event) => {
  const th = event.target.closest('th[data-sort]');
  if (!th) return;
  const column = th.dataset.sort;
  if (wlSortColumn === column) {
    if (wlSortDir === 'asc') wlSortDir = 'desc';
    else { wlSortColumn = null; wlSortDir = 'asc'; }
  } else { wlSortColumn = column; wlSortDir = 'asc'; }
  if (currentData) renderWlTable(currentData);
});

$('#wl-select-all').addEventListener('change', () => {
  if (!currentData) return;
  const checked = $('#wl-select-all').checked;
  const visible = wlFilteredSortedStocks(currentData);
  visible.forEach(s => checked ? wlSelected.add(s.symbol) : wlSelected.delete(s.symbol));
  renderWlTable(currentData);
});

$('#wl-table tbody').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, symbol } = button.dataset;
  const id = watchlistIndex.activeWatchlist;
  if (action === 'report') {
    openCompanyReport(symbol);
    return;
  }
  if (action === 'remove') {
    const { data } = await api(`/api/watchlists/${id}/companies/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    watchlistIndex.watchlists = watchlistIndex.watchlists.map(w => w.id === id ? { ...w, companyCount: data.stocks.length } : w);
    wlSelected.delete(symbol);
    render(data);
    return;
  }
  if (action === 'refresh-one') {
    button.disabled = true;
    try {
      const { data } = await api(`/api/watchlists/${id}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbols: [symbol] }) });
      render(data);
    } finally { button.disabled = false; }
    return;
  }
  if (action === 'up' || action === 'down') {
    const order = currentData.stocks.map(s => s.symbol);
    const i = order.indexOf(symbol);
    const j = action === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const { data } = await api(`/api/watchlists/${id}/companies/order`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order }) });
    render(data);
  }
});
$('#wl-table tbody').addEventListener('change', async (event) => {
  const checkbox = event.target.closest('.wl-row-select');
  if (checkbox) {
    checkbox.checked ? wlSelected.add(checkbox.dataset.symbol) : wlSelected.delete(checkbox.dataset.symbol);
    $('#wl-bulk-bar').hidden = wlSelected.size === 0;
    $('#wl-bulk-count').textContent = `${wlSelected.size} selected`;
    $('#wl-select-all').checked = wlFilteredSortedStocks(currentData).every(s => wlSelected.has(s.symbol));
    return;
  }
  const weightInput = event.target.closest('.weight-input');
  if (weightInput) {
    const id = watchlistIndex.activeWatchlist;
    const weightPct = weightInput.value === '' ? null : Number(weightInput.value);
    const { data } = await api(`/api/watchlists/${id}/companies/${encodeURIComponent(weightInput.dataset.symbol)}/weight`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weightPct }) });
    render(data);
    return;
  }
  const notesInput = event.target.closest('.wl-notes-input');
  if (notesInput) {
    const id = watchlistIndex.activeWatchlist;
    const { data } = await api(`/api/watchlists/${id}/companies/${encodeURIComponent(notesInput.dataset.symbol)}/notes`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notes: notesInput.value }) });
    render(data);
  }
});

$('#wl-bulk-refresh').addEventListener('click', async () => {
  if (!wlSelected.size) return;
  const id = watchlistIndex.activeWatchlist;
  const { data } = await api(`/api/watchlists/${id}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbols: [...wlSelected] }) });
  render(data);
});
$('#wl-bulk-remove').addEventListener('click', async () => {
  if (!wlSelected.size || !confirm(`Remove ${wlSelected.size} compan${wlSelected.size === 1 ? 'y' : 'ies'} from this watchlist?`)) return;
  const id = watchlistIndex.activeWatchlist;
  let data;
  for (const symbol of [...wlSelected]) {
    ({ data } = await api(`/api/watchlists/${id}/companies/${encodeURIComponent(symbol)}`, { method: 'DELETE' }));
  }
  wlSelected.clear();
  watchlistIndex.watchlists = watchlistIndex.watchlists.map(w => w.id === id ? { ...w, companyCount: data.stocks.length } : w);
  render(data);
});

// ---- Add company: institutional-style real-time typeahead. -------------
// Every keystroke ranks the local index (companySearchIndex, loaded once by
// loadCompanySearchIndex()) synchronously in the browser -- no network
// round trip, so results update the instant a key is pressed. A network
// fallback to /api/companies/search (Yahoo symbol search) only fires,
// 150ms-debounced, when the local pass comes up thin (<3 matches) -- e.g. a
// company outside the curated NSE reference and not yet cached/watchlisted
// anywhere. See data/watchlist/searchIndex.mjs for how the local index is
// built and why its sector/industry is display-only, never sent on add.
async function loadCompanySearchIndex() {
  try {
    const { data } = await api('/api/companies/index');
    companySearchIndex = data.companies || [];
  } catch { /* progressive enhancement -- the server fallback search still works without it */ }
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tickerCore = (symbol) => String(symbol || '').replace(/\.(NS|BO)$/i, '');
const TIER_SEARCH_BOOST = { mega: 30, large: 15, mid: 5, small: 0 };

// Ranking priority (highest wins): exact ticker > exact company name >
// ticker/name prefix > word-start-within-name / alias > substring in name,
// ticker or alias > substring in sector/industry. Within a tier, boosts
// nudge toward companies already researched locally, larger-cap names and
// companies this browser has picked before -- ties broken by shorter name.
function scoreCompanyMatch(company, query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const name = (company.name || '').toLowerCase();
  const symbolFull = (company.symbol || '').toLowerCase();
  const symbolCore = tickerCore(company.symbol).toLowerCase();
  const aliases = (company.aliases || []).map(a => a.toLowerCase());
  const sector = (company.sector || '').toLowerCase();
  const industry = (company.industry || '').toLowerCase();

  let tier;
  if (symbolCore === q || symbolFull === q || aliases.includes(q)) tier = 1000;
  else if (name === q) tier = 900;
  else if (symbolCore.startsWith(q) || symbolFull.startsWith(q)) tier = 800;
  else if (name.startsWith(q)) tier = 700;
  else if (aliases.some(a => a.startsWith(q))) tier = 650;
  else if (new RegExp(`\\b${escapeRegExp(q)}`).test(name)) tier = 600;
  else if (name.includes(q) || symbolCore.includes(q) || aliases.some(a => a.includes(q))) tier = 400;
  else if (sector.includes(q) || industry.includes(q)) tier = 250;
  else return null;

  const freq = wlSelectionFrequency[company.symbol] || 0;
  return tier + (TIER_SEARCH_BOOST[company.tier] || 0) + (company.inDataUniverse ? 20 : 0) + Math.min(freq * 8, 60) - Math.min(name.length, 40) * 0.05;
}

function rankCompanySearchResults(query, limit = 20) {
  const scored = [];
  for (const company of companySearchIndex) {
    const score = scoreCompanyMatch(company, query);
    if (score != null) scored.push({ company, score });
  }
  scored.sort((a, b) => b.score - a.score || a.company.name.localeCompare(b.company.name));
  return scored.slice(0, limit).map(s => s.company);
}

const activeWatchlistSymbols = () => new Set((currentData?.stocks || []).map(s => s.symbol.toUpperCase()));

function closeCompanySuggestions() {
  $('#wl-company-suggestions').hidden = true;
  $('#wl-company-search').setAttribute('aria-expanded', 'false');
  wlSearchResults = [];
  wlSearchActiveIndex = -1;
}

function setActiveSuggestionIndex(index) {
  const rows = $$('#wl-company-suggestions .suggestion[data-index]');
  if (!rows.length) return;
  wlSearchActiveIndex = ((index % rows.length) + rows.length) % rows.length;
  rows.forEach((row, i) => {
    row.classList.toggle('active', i === wlSearchActiveIndex);
    row.setAttribute('aria-selected', String(i === wlSearchActiveIndex));
  });
  rows[wlSearchActiveIndex].scrollIntoView({ block: 'nearest' });
}

function renderCompanySuggestions(results, query) {
  wlSearchResults = results;
  wlSearchActiveIndex = results.length ? 0 : -1;
  const box = $('#wl-company-search');
  const list = $('#wl-company-suggestions');
  if (!results.length) {
    list.innerHTML = query ? '<div class="suggestion-empty small">No matches.</div>' : '';
    list.hidden = !query;
    box.setAttribute('aria-expanded', String(!!query));
    return;
  }
  const existing = activeWatchlistSymbols();
  list.innerHTML = results.map((c, i) => {
    const already = existing.has(c.symbol.toUpperCase());
    return `<div class="suggestion${i === 0 ? ' active' : ''}${already ? ' suggestion-disabled' : ''}" role="option" id="wl-suggestion-${i}" data-index="${i}" aria-selected="${i === 0}">
      <div class="suggestion-name"><strong>${escape(c.name)}</strong><span>${escape(c.symbol)}</span></div>
      <div class="suggestion-sector">${escape(c.sector || '')}</div>
      <div class="suggestion-industry">${escape(c.industry || '')}</div>
      <div class="suggestion-meta">${already ? '<span class="tag neutral">Already in watchlist</span>' : `<span class="tag neutral">${escape(c.exchange || c.market || '')}</span>`}</div>
    </div>`;
  }).join('');
  list.hidden = false;
  box.setAttribute('aria-expanded', 'true');
}

function recordCompanySelection(symbol) {
  wlSelectionFrequency[symbol] = (wlSelectionFrequency[symbol] || 0) + 1;
  try { localStorage.setItem('wl-search-frequency', JSON.stringify(wlSelectionFrequency)); } catch { /* storage unavailable -- ranking boost just resets */ }
}

async function addCompanyFromSearch(company) {
  $('#wl-company-search').value = '';
  closeCompanySuggestions();
  $('#status').textContent = `Adding ${company.name}...`;
  const id = watchlistIndex.activeWatchlist;
  // Sector/industry are deliberately omitted here: the local index's values
  // are a best-effort search hint (see searchIndex.mjs), never authoritative
  // -- the real classification is resolved by the normal fetch/backfill path
  // in research.mjs, same "never guess" contract as every other add path.
  const payload = { symbol: company.symbol, name: company.name, exchange: company.exchange, market: company.market };
  const { data } = await api(`/api/watchlists/${id}/companies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (data.duplicate) {
    showWlNotice(`${data.duplicate.name} is already in this watchlist.`);
    render(data.research);
    highlightWlRow(data.duplicate.symbol);
    return;
  }
  recordCompanySelection(company.symbol);
  watchlistIndex.watchlists = watchlistIndex.watchlists.map(w => w.id === id ? { ...w, companyCount: data.stocks.length } : w);
  render(data);
  loadCompanySearchIndex(); // background refresh -- picks up this company's real classification once fetched
  $('#wl-company-search').focus(); // stay in the box for rapid repeated entry
}

function selectSuggestionAt(index) {
  const company = wlSearchResults[index];
  if (!company) return;
  if (activeWatchlistSymbols().has(company.symbol.toUpperCase())) {
    showWlNotice(`${company.name} is already in this watchlist.`);
    highlightWlRow(company.symbol);
    return;
  }
  addCompanyFromSearch(company);
}

let wlServerFallbackDebounce;
$('#wl-company-search').addEventListener('input', () => {
  const query = $('#wl-company-search').value.trim();
  clearTimeout(wlServerFallbackDebounce);
  if (!query) { closeCompanySuggestions(); return; }
  const localResults = rankCompanySearchResults(query);
  renderCompanySuggestions(localResults, query);
  if (localResults.length < 3) {
    wlServerFallbackDebounce = setTimeout(async () => {
      if ($('#wl-company-search').value.trim() !== query) return; // input moved on -- stale response
      const { data } = await api(`/api/companies/search?q=${encodeURIComponent(query)}`).catch(() => ({ data: {} }));
      const localSymbols = new Set(localResults.map(c => c.symbol.toUpperCase()));
      const remote = (data.candidates || [])
        .filter(c => !localSymbols.has(c.symbol.toUpperCase()))
        .map(c => ({ symbol: c.symbol, name: c.name, exchange: c.exchange, market: c.market, sector: null, industry: null, tier: null, aliases: [], inDataUniverse: false }));
      if (remote.length) renderCompanySuggestions([...localResults, ...remote], query);
    }, 150);
  }
});
$('#wl-company-search').addEventListener('keydown', (event) => {
  if ($('#wl-company-suggestions').hidden || !wlSearchResults.length) {
    if (event.key === 'Escape') closeCompanySuggestions();
    return;
  }
  if (event.key === 'ArrowDown') { event.preventDefault(); setActiveSuggestionIndex(wlSearchActiveIndex + 1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveSuggestionIndex(wlSearchActiveIndex - 1); }
  else if (event.key === 'Enter') { event.preventDefault(); if (wlSearchActiveIndex >= 0) selectSuggestionAt(wlSearchActiveIndex); }
  else if (event.key === 'Tab' && wlSearchActiveIndex >= 0) { event.preventDefault(); selectSuggestionAt(wlSearchActiveIndex); }
  else if (event.key === 'Escape') { event.preventDefault(); closeCompanySuggestions(); }
});
$('#wl-company-suggestions').addEventListener('click', (event) => {
  const row = event.target.closest('.suggestion[data-index]');
  if (!row) return;
  selectSuggestionAt(Number(row.dataset.index));
});
$('#wl-company-suggestions').addEventListener('mousemove', (event) => {
  const row = event.target.closest('.suggestion[data-index]');
  if (!row) return;
  const index = Number(row.dataset.index);
  if (index !== wlSearchActiveIndex) setActiveSuggestionIndex(index);
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.add-company')) closeCompanySuggestions();
});

// Bounded viewport shell (2026-09-05): nav bars and the header are plain
// fixed-flex siblings now, not CSS-var-driven sticky offsets, so this no
// longer measures/writes any --header-h/--subtabs-h/--wl-searchbar-h var --
// it's kept only as the one choke point that re-syncs the two things that
// still depend on real measured layout: the Company Research scrollspy band
// and the floating-header-clone positions (both read live
// getBoundingClientRect() values already, no stored var to go stale).
function syncHeaderHeight() {
  rebuildCompanyResearchNav();
  refreshFloatingHeaders();
}
window.addEventListener('resize', syncHeaderHeight);
window.addEventListener('load', syncHeaderHeight);
syncHeaderHeight();

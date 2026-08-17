const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const fmt = (value) => value == null || !Number.isFinite(value) ? 'N/A' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
const pct = (value) => value == null || !Number.isFinite(value) ? 'N/A' : `${value >= 0 ? '+' : ''}${fmt(value)}%`;
const compact = (value) => value == null || !Number.isFinite(value) ? 'N/A' : new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const suffixed = (value, suffix) => value == null || !Number.isFinite(value) ? 'N/A' : `${fmt(value)}${suffix}`;
const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
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
  const part = (label, key) => `${label} ${c[key] == null ? 'N/A' : c[key]}`;
  const base = [part('Quality', 'quality'), part('Valuation', 'valuation'), part('Technical', 'technical'), part('Risk', 'risk'), part('Relative positioning', 'relativePositioning'), part('Portfolio fit', 'portfolioFit')].join(' | ');
  // Stage 3: when actionScore.mjs's resolved-coverage cap applied, say so --
  // otherwise a capped "Hold" reads as an ordinary score instead of a
  // disclosed low-coverage cap (mirrors recommendation.capNote's convention).
  return action.capNote ? `${base} | ${action.capNote}` : base;
}
function actionScoreBadge(action) {
  if (!action) return 'N/A';
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
const prefixCells = (stock, opts = {}) => `<td><button type="button" class="row-company-link" data-symbol="${escape(stock.symbol)}">${escape(stock.name)}</button></td><td>${escape(stock.sector || 'N/A')}</td><td${opts.num ? ' class="num"' : ''}>${fmt(stock.price)} ${escape(stock.currency || '')}</td><td${opts.num ? ' class="num"' : ''}>${fmt(stock.pe)}</td>`;
function renderTable(selector, stocks, rowFn, opts) {
  $(`${selector} tbody`).innerHTML = stocks.length
    ? stocks.map((stock, index) => `<tr data-symbol="${escape(stock.symbol)}">${prefixCells(stock, opts)}${rowFn(stock, index)}</tr>`).join('')
    : `<tr><td colspan="20" class="small">This watchlist is empty.</td></tr>`;
}

let watchlistIndex = null;
let currentData = null;
let opportunitiesSort = 'recommendation';
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

// ---- Phase 6.5: sidebar primary navigation. Research (Fundamentals/
// Valuation/Profitability/Balance Sheet/Growth/Ownership) is a *virtual
// group* in the sidebar -- those 6 sections stay independent `.tab`
// elements exactly as before (own subtabs, own content, untouched); a
// slim pill-bar (#research-category-bar) picks which one is visible while
// the sidebar's single "Research" item stays highlighted. Every other
// sidebar item maps 1:1 to a `.tab` section, same mechanism the old flat
// `.tabs` nav used. ----
const RESEARCH_TABS = ['fundamentals', 'valuation', 'profitability', 'balance-sheet', 'growth', 'ownership'];
const RESEARCH_CATEGORY_STORAGE_KEY = 'researchCategory';
let activeResearchTab = null;
try { activeResearchTab = localStorage.getItem(RESEARCH_CATEGORY_STORAGE_KEY); } catch { /* storage unavailable */ }
if (!RESEARCH_TABS.includes(activeResearchTab)) activeResearchTab = RESEARCH_TABS[0];

function activateWorkspaceTab(tabId) {
  const isResearch = RESEARCH_TABS.includes(tabId);
  $$('#app-sidebar .sidebar-item,.tab').forEach(element => element.classList.remove('active'));
  $(`#${tabId}`)?.classList.add('active');
  $(`#app-sidebar .sidebar-item[data-${isResearch ? 'group' : 'tab'}="${isResearch ? 'research' : tabId}"]`)?.classList.add('active');
  $('#research-category-bar').hidden = !isResearch;
  if (isResearch) {
    activeResearchTab = tabId;
    try { localStorage.setItem(RESEARCH_CATEGORY_STORAGE_KEY, tabId); } catch { /* storage unavailable */ }
    $$('#research-category-bar button').forEach(button => button.classList.toggle('active', button.dataset.tab === tabId));
  }
  $('#main').classList.toggle('full-bleed', tabId === 'watchlists');
  if (currentData) $('#empty').hidden = currentData.stocks.length > 0 || tabId === 'watchlists';
  closeMobileSidebar();
}
$$('#app-sidebar .sidebar-item').forEach(button => button.addEventListener('click', () =>
  activateWorkspaceTab(button.dataset.group === 'research' ? activeResearchTab : button.dataset.tab)));
$$('#research-category-bar button').forEach(button => button.addEventListener('click', () => activateWorkspaceTab(button.dataset.tab)));

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
function applySubtabState(root) {
  const bar = root?.querySelector('.subtabs');
  if (!bar) return;
  const active = activeSubtabs[root.id];
  $$('button', bar).forEach(button => {
    const on = button.dataset.subtab === active;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1;
  });
  $$('.subsection', root).forEach(panel => { panel.hidden = !panel.dataset.subtab.split(/\s+/).includes(active); });
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
$$('.tab').forEach(initSubtabs);

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
  renderPortfolioAnalytics(currentData);
  renderHeaderCompanySelector();
  refreshActiveCompanyHighlights();
  renderReportsWorkspace();
  if (opts.jumpTo) activateWorkspaceTab(opts.jumpTo);
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
  if (currentData) renderProfitability(compareSymbols.length >= 2 ? currentData.stocks.filter(s => compareSymbols.includes(s.symbol)) : currentData.stocks);
  renderCompareBar();
  renderCompareWorkspace(currentData);
}
function setCompareMode(on) {
  compareMode = on;
  renderValuationDetail(currentData);
  renderTechnicalDetail(currentData);
  renderRiskDetail(currentData);
  if (currentData) renderProfitability(compareMode && compareSymbols.length >= 2 ? currentData.stocks.filter(s => compareSymbols.includes(s.symbol)) : currentData.stocks);
  renderCompareBar();
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
    ? `${stock.sector || 'N/A'} · ${fmt(stock.price)} ${stock.currency || ''} · ${stock.signal || 'N/A'} · ${stock.recommendation?.confidence || 'N/A'} confidence`
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
      <span class="small">${escape(s.sector || 'N/A')} · ${fmt(s.price)} · ${escape(s.signal || 'N/A')} · ${escape(s.recommendation?.confidence || 'N/A')}</span>
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
function renderCompareBar() {
  const toggle = $('#compare-toggle');
  const chips = $('#compare-chip-row');
  if (!toggle || !chips) return;
  toggle.classList.toggle('active', compareMode);
  toggle.setAttribute('aria-pressed', String(compareMode));
  chips.hidden = !compareMode;
  const names = compareSymbols.map(symbol => currentData?.stocks.find(s => s.symbol === symbol)?.name || symbol);
  chips.innerHTML = compareMode
    ? (names.length
        ? names.map((name, i) => `<span class="tag compare-chip">${escape(name)} <button type="button" data-remove-compare="${escape(compareSymbols[i])}" aria-label="Remove ${escape(name)}">&times;</button></span>`).join('')
        : '<span class="small">Pick 2-4 companies from a pill row on Valuation, Technicals or Risks.</span>')
    : '';
}

// ---- Phase 6.5 Compare workspace: a dedicated screen for Compare Mode.
// Reuses renderCompareAwarePillSelector (already shared by Valuation/
// Technicals/Risks) for the picker and compareGrid()+the same *DetailContent
// builder functions those three tabs already call -- no new comparison
// logic, just additional render targets for the same pure functions. ----
function renderCompareWorkspace(data) {
  const stocks = (data?.stocks || []).filter(s => !s.unresolved);
  renderCompareAwarePillSelector('#compare-selector', stocks);
  const enableBtn = $('#compare-enable-btn');
  if (enableBtn) enableBtn.hidden = compareMode;
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
$('#compare-enable-btn')?.addEventListener('click', () => setCompareMode(true));

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
  $$('#quick-jump button[data-jump]').forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.jump;
    if (target === 'report') {
      openCompanyReport(activeCompanySymbol);
    } else {
      activateWorkspaceTab(target);
    }
  }));
  $('#compare-toggle')?.addEventListener('click', () => setCompareMode(!compareMode));
  $('#compare-chip-row')?.addEventListener('click', (event) => {
    const removeSymbol = event.target.closest('[data-remove-compare]')?.dataset.removeCompare;
    if (removeSymbol) toggleCompareSymbol(removeSymbol);
  });
}
initCompanyContextBar();

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

// Generic 0-100 score rendering shared by the technical scorecard and risk
// tables -- `invert` flips the color read for risk scores, where a *higher*
// number is worse rather than better.
function scoreTier(value, invert = false) {
  if (value == null) return '';
  const v = invert ? 100 - value : value;
  return v >= 65 ? 'positive' : v >= 40 ? 'amber' : 'negative';
}
function scoreText(value, invert = false) {
  return value == null ? 'N/A' : `<span class="${scoreTier(value, invert)}">${value}/100</span>`;
}
function riskCard(name, value, key) {
  if (value == null) return `<article class="card risk"><h3>${name} ${infoIcon(key)}</h3><div class="kpi">N/A</div><div class="small">No data source configured</div></article>`;
  const tier = value > 65 ? 'high' : value > 40 ? 'medium' : '';
  return `<article class="card risk ${tier}"><h3>${name} ${infoIcon(key)}</h3><div class="kpi">${value}/100</div><div class="bar"><i style="width:${value}%"></i></div></article>`;
}

// ---- Tab renderers (Valuation / Profitability / Balance sheet / Growth /
// Ownership / Technicals / Portfolio) -- each consumes the same `stocks`
// array in the same order; none of them sort or slice it. ----
function renderValuationTab(stocks) {
  renderTable('#valuation-table', stocks, stock => {
    const m = stock.metrics || {}, v = stock.valuation || {};
    return `<td>${fmt(m.forwardPe)}</td><td>${fmt(m.pb)}</td><td>${fmt(m.evEbitda)}</td><td>${fmt(m.peg)}</td><td>${fmt(v.fairValue)}</td><td>${fmt(v.targetPrice)}</td><td>${pct(v.upsidePct)}</td><td>${pct(v.marginOfSafetyPct)}</td><td>${pct(stock.sectorPremiumDiscountPe)}</td><td>${pct(stock.earningsYield)}</td><td>${pct(stock.fcfYield)}</td>`;
  });
}
// Each of these four tabs previously drove one wide, horizontally-scrolling
// table off `stock.metrics`; they now drive several narrower ones (one per
// sub-tab) via the same renderTable()/prefixCells() helper -- same fields,
// same stocks array, just a smaller column subset per call.
function renderProfitability(stocks) {
  const m = (stock) => stock.metrics || {};
  renderTable('#profitability-table-margins', stocks, stock => `<td>N/A</td><td>${pct(m(stock).ebitdaMargin)}</td><td>${pct(m(stock).ebitdaMargin)}</td><td>${pct(m(stock).netMargin)}</td>`);
  renderTable('#profitability-table-returns', stocks, stock => `<td>${pct(m(stock).roe)}</td><td>${pct(m(stock).roce)}</td><td>${pct(m(stock).roa)}</td>`);
  renderTable('#profitability-table-dupont', stocks, stock => `<td>${pct(m(stock).roe)}</td><td>${pct(m(stock).netMargin)}</td>`);
  renderTable('#profitability-table-efficiency', stocks, stock => `<td>${pct(m(stock).roce)}</td><td>${pct(m(stock).roa)}</td>`);
  renderTable('#profitability-table-quality', stocks, stock => `<td>${fmt(m(stock).earningsQualityScore)}</td>`);
}
function renderBalanceSheetTab(stocks) {
  const m = (stock) => stock.metrics || {};
  const wcDays = (stock) => stock.fundamentalsAnalytics?.workingCapital?.workingCapitalDays;
  renderTable('#balance-sheet-table-capital-structure', stocks, stock => `<td>${fmt(m(stock).debt)}</td><td>${fmt(m(stock).cash)}</td><td>${fmt(m(stock).netDebt)}</td><td>${escape(m(stock).capitalStructure || 'N/A')}</td>`);
  renderTable('#balance-sheet-table-liquidity', stocks, stock => `<td>${fmt(m(stock).cash)}</td><td>${fmt(m(stock).currentRatio)}</td><td>${fmt(m(stock).quickRatio)}</td>`);
  renderTable('#balance-sheet-table-leverage', stocks, stock => `<td>${fmt(m(stock).debt)}</td><td>${fmt(m(stock).netDebt)}</td><td>${pct(m(stock).debtToEquity)}</td>`);
  renderTable('#balance-sheet-table-working-capital', stocks, stock => `<td>${fmt(wcDays(stock))}</td>`);
  renderTable('#balance-sheet-table-financial-resilience', stocks, stock => `<td>${pct(m(stock).debtToEquity)}</td><td>${fmt(m(stock).currentRatio)}</td><td>${fmt(m(stock).netDebt)}</td>`);
}
function renderGrowthTab(stocks) {
  const m = (stock) => stock.metrics || {};
  renderTable('#growth-table-revenue', stocks, stock => `<td>${pct(m(stock).revenueCagr3y)}</td><td>${pct(m(stock).revenueCagr5y)}</td>`);
  renderTable('#growth-table-ebitda', stocks, stock => `<td>${pct(m(stock).ebitdaCagr3y)}</td><td>${pct(m(stock).ebitdaCagr5y)}</td>`);
  renderTable('#growth-table-earnings', stocks, stock => `<td>${pct(m(stock).profitCagr3y)}</td><td>${pct(m(stock).profitCagr5y)}</td><td>${pct(m(stock).epsCagr5y)}</td>`);
  renderTable('#growth-table-cash-flow', stocks, stock => `<td>${pct(m(stock).fcfCagr)}</td>`);
  renderTable('#growth-table-long-term', stocks, stock => `<td>${pct(m(stock).revenueCagr5y)}</td><td>${pct(m(stock).ebitdaCagr5y)}</td><td>${pct(m(stock).profitCagr5y)}</td><td>${pct(m(stock).epsCagr5y)}</td><td>${fmt(m(stock).bookValueCagr)}</td><td>${pct(m(stock).fcfCagr)}</td>`);
}
function renderOwnershipTab(stocks) {
  const m = (stock) => stock.metrics || {};
  const concentration = (stock) => m(stock).promoterHolding != null && m(stock).institutionalHolding != null ? m(stock).promoterHolding + m(stock).institutionalHolding : null;
  renderTable('#ownership-table-shareholding', stocks, stock => `<td>${pct(m(stock).promoterHolding)}</td><td>${pct(m(stock).fiiHolding)}</td><td>${pct(m(stock).diiHolding)}</td><td>${fmt(m(stock).mutualFundHolding)}</td>`);
  renderTable('#ownership-table-promoter', stocks, stock => `<td>${pct(m(stock).promoterHolding)}</td><td>${pct(m(stock).promoterHoldingTrend)}</td>`);
  renderTable('#ownership-table-institutional', stocks, stock => `<td>${pct(m(stock).fiiHolding)}</td><td>${pct(m(stock).diiHolding)}</td><td>${fmt(m(stock).mutualFundHolding)}</td><td>${pct(m(stock).institutionalHolding)}</td>`);
  renderTable('#ownership-table-trends', stocks, stock => `<td>${pct(m(stock).promoterHoldingTrend)}</td><td>${pct(concentration(stock))}</td>`);
}
// The one wide technical scorecard table splits into six narrower ones (one
// per sub-tab) via the same renderTable()/prefixCells() helper -- same
// fields off `stock`/`technicalScorecard.scores`, just a smaller column
// subset per call.
function renderTechnicalTab(stocks) {
  const scores = (stock) => stock.technicalScorecard?.scores || {};
  renderTable('#technical-table-trend', stocks, stock => `<td>${escape(stock.trend || 'N/A')}</td><td class="num">${fmt(stock.twenty)}</td><td class="num">${fmt(stock.fifty)}</td><td class="num">${fmt(stock.hundred)}</td><td class="num">${fmt(stock.twoHundred)}</td><td class="num">${scoreText(scores(stock).trendStrengthScore)}</td>`, { num: true });
  renderTable('#technical-table-momentum', stocks, stock => `<td class="num">${fmt(stock.rsi)}</td><td class="num">${scoreText(scores(stock).momentumScore)}</td>`, { num: true });
  renderTable('#technical-table-volume', stocks, stock => `<td>${escape(stock.volumeTrend || 'N/A')}</td>`, { num: true });
  renderTable('#technical-table-relative-strength', stocks, stock => `<td class="num">${pct(stock.relativeStrengthPct)}</td>`, { num: true });
  renderTable('#technical-table-volatility', stocks, stock => `<td class="num">${scoreText(scores(stock).volatilityScore, true)}</td>`, { num: true });
  renderTable('#technical-table-signals', stocks, stock => `<td class="num">${scoreText(scores(stock).breakoutProbability)}</td><td>${escape(stock.technicalScorecard?.regime || 'N/A')}</td>`, { num: true });
}
function renderPortfolioTab(stocks) {
  const bucketFor = (score) => score >= 70 ? 'Core' : score >= 55 ? 'Growth' : 'Satellite';
  renderTable('#portfolio-table', stocks, stock => `<td>${fmt(stock.score)}/100</td><td>${fmt(stock.effectiveWeightPct)}%</td><td>${escape(bucketFor(stock.score || 0))}</td>`);
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
  return `<div class="allocation-row"><span>${escape(label)} ${infoIcon(key)}</span><div class="bar"><i style="width:${percentile ?? 0}%"></i></div><span>${percentile == null ? 'N/A' : percentile + 'th pct'}</span></div>`;
}
const RV_LABELS = { pe: 'P/E', pb: 'P/B', peg: 'PEG', roe: 'ROE', roce: 'ROCE', revenueCagr3y: 'Revenue growth 3Y', epsCagr3y: 'EPS growth 3Y', dividendYield: 'Dividend yield' };
const RV_FORMAT = { roe: pct, roce: pct, revenueCagr3y: pct, epsCagr3y: pct, dividendYield: pct };
function relativeValuationTable(rv) {
  if (!rv) return '<p class="small">Not available.</p>';
  const rows = rv.comparison.map(row => {
    const f = RV_FORMAT[row.key] || fmt;
    return `<tr><th scope="row">${escape(RV_LABELS[row.key] || row.key)}</th><td class="num">${f(row.value)}</td><td class="num">${f(row.sectorMedian)}</td><td class="num">${f(row.sectorLeader)}</td><td class="num">${row.historicalAverage == null ? 'N/A' : f(row.historicalAverage)}</td><td class="num">${f(row.watchlistAverage)}</td></tr>`;
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
  const buckets = Object.values(r.components || {}).map(b => card(b.label, b.score == null ? 'N/A' : `${b.score}/100`, `Weight ${b.weight}%`, '')).join('');
  return `<article class="card">
      <h3>Recommendation ${infoIcon('compositeScore')}</h3>
      <div class="rec-badges">${signalTag(stock)} <span class="tag ${r.confidence === 'High' ? 'buy' : r.confidence === 'Medium' ? 'hold' : 'neutral'}">${escape(r.confidence || 'N/A')} confidence</span></div>
      <div class="small">Primary driver: ${escape(r.primaryDriver || 'N/A')}${r.compositeScore != null ? ` &middot; Composite score ${r.compositeScore}/100` : ''}</div>
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
        ${card('Valuation confidence', fv.valuationConfidenceScore == null ? 'N/A' : `${fv.valuationConfidenceScore}/100`, fv.confidenceBand || '', fv.confidenceBand === 'High' ? 'positive' : fv.confidenceBand === 'Medium' ? 'amber' : '')}
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
          ${card('Valuation confidence', dcf.valuationConfidenceScore == null ? 'N/A' : `${dcf.valuationConfidenceScore}/100`, dcf.confidenceBand || '', dcf.confidenceBand === 'High' ? 'positive' : dcf.confidenceBand === 'Medium' ? 'amber' : '')}
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
    return `<div class="small">Historical implied P/E range: ${fmt(band.min)}&ndash;${fmt(band.max)} (25th ${fmt(band.p25)}, median ${fmt(band.median)}, 75th ${fmt(band.p75)}). Current P/E ${fmt(band.currentPe)} is ${band.positionVsOwnHistoryPct == null ? 'N/A' : `${pct(band.positionVsOwnHistoryPct)} vs. its own historical median`}.</div>`;
  }
  const rvCard = `<article class="card">
      <h3>Relative valuation ${infoIcon('relativeValuationScore')}</h3>
      <div class="grid four">
        ${card('Relative valuation score', rv?.relativeValuationScore == null ? 'N/A' : `${rv.relativeValuationScore}/100`, 'Share of metrics beating sector median', '')}
        ${card('Premium/discount', rv?.premiumDiscountScore == null ? 'N/A' : pct(rv.premiumDiscountScore), 'Avg deviation from sector median P/E-P/B-PEG', '')}
        ${card('Sector rank', rv ? `${rv.sectorRank}/${rv.sectorPeerCount}` : 'N/A', 'By ROCE/ROE within this watchlist\'s same-sector peers', '')}
        ${card('Watchlist rank', rv ? `${rv.watchlistRank}/${rv.watchlistCount}` : 'N/A', 'By ROCE/ROE within the full watchlist', '')}
      </div>
      <div class="grid four">
        ${card(`Sector-adjusted valuation rank ${infoIcon('sectorValuationRank')}`, rv ? `${rv.sectorValuationRank}/${rv.sectorPeerCount}` : 'N/A', 'Cheapest-vs-sector-median first', '')}
        ${card(`Multi-factor peer rank ${infoIcon('multiFactorPeerScore')}`, rv ? `${rv.multiFactorPeerRank}/${rv.sectorPeerCount}` : 'N/A', rv?.multiFactorPeerScore == null ? 'N/A' : `Score ${rv.multiFactorPeerScore}/100 (Value 40% / Quality 35% / Growth 25%)`, '')}
        ${card(`Sector-normalized score ${infoIcon('sectorNormalizedValuationScore')}`, rv?.sectorNormalizedValuationScore == null ? 'N/A' : `${rv.sectorNormalizedValuationScore}/100`, 'Continuous z-score vs. sector peers', '')}
        ${card(`Watchlist percentile ${infoIcon('watchlistValuationPercentile')}`, rv?.watchlistValuationPercentile == null ? 'N/A' : `${rv.watchlistValuationPercentile}th`, 'Cheapness percentile across the watchlist', '')}
      </div>
      <div class="grid two">
        ${card(`Relative attractiveness score ${infoIcon('relativeAttractivenessScore')}`, rv?.relativeAttractivenessScore == null ? 'N/A' : `${rv.relativeAttractivenessScore}/100`, 'Blend of relative valuation, sector-normalized and multi-factor peer scores', (rv?.relativeAttractivenessScore ?? 0) >= 65 ? 'positive' : (rv?.relativeAttractivenessScore ?? 100) < 40 ? 'amber' : '')}
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
    entries.map(([sector, d]) => `<tr><th scope="row">${escape(sector)}</th><td class="num">${d.sampleSize}</td><td class="num">${fmt(d.mean)}</td><td class="num">${fmt(d.median)}</td><td class="num">${fmt(d.stdDev)}</td><td class="num">${fmt(d.min)}</td><td class="num">${fmt(d.max)}</td><td class="num">${d.coefficientOfVariation == null ? 'N/A' : `${fmt(d.coefficientOfVariation)}%`}</td></tr>`).join('')
  }</tbody></table>` : '<p class="small">Not available.</p>';
}
function renderValuationDetail(data) {
  const stocks = data.stocks.filter(s => !s.unresolved);
  ensureActiveCompany(stocks);
  renderCompareAwarePillSelector('#valuation-selector', stocks);
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
  applySubtabState($('#valuation'));
  renderValuationDispersion(data);
}

// ---- Technical deep-dive: ADX/ATR/OBV/A-D, MACD, support/resistance,
// multi-timeframe trend, volume profile. ----
// Returns a {indicators, multiTimeframe, advancedScores, volumeProfile}
// fragment map -- these four cards are each assigned whole to their closest-
// matching Technicals sub-tab (Momentum/Trend/Signals/Volume respectively);
// none of their internals are split apart.
function technicalDetailContent(stock) {
  const empty = '<p class="small">No data yet.</p>';
  if (!stock) return { indicators: empty, multiTimeframe: empty, advancedScores: empty, volumeProfile: empty };
  const t = stock.technicalScorecard || {}, tf = t.timeframes || {}, vp = t.volumeProfile || {}, macd = stock.macd || {}, adv = t.advancedScores || {};
  const indicators = `
    <article class="card">
      <h3>${escape(stock.name)} &mdash; indicators ${infoIcon('adx')}</h3>
      <div class="grid four">
        ${card('ADX (14)', fmt(t.adx), `${escape(t.adxInterpretation || 'N/A')} &middot; DI+ ${fmt(t.diPlus)} / DI- ${fmt(t.diMinus)}`, '')}
        ${card('ATR (14)', fmt(t.atr), `ATR % of price: ${t.atrPct == null ? 'N/A' : pct(t.atrPct)}`, '')}
        ${card('OBV', t.obv?.value == null ? 'N/A' : compact(t.obv.value), t.obv?.trend || 'N/A', '')}
        ${card('Accumulation/Distribution', t.accDist?.value == null ? 'N/A' : compact(t.accDist.value), t.accDist?.trend || 'N/A', '')}
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
        ${card('Daily', escape(tf.daily || 'N/A'), '', '')}
        ${card('Weekly', escape(tf.weekly || 'N/A'), '', '')}
        ${card('Monthly', escape(tf.monthly || 'N/A'), '', '')}
        ${card('Aligned read', escape(tf.aligned || 'N/A'), `Confirmation: ${tf.confirmationCount ?? 'N/A'}/3 (${escape(tf.confirmationStrength || 'N/A')})`, tf.aligned === 'Uptrend' ? 'positive' : tf.aligned === 'Downtrend' ? 'amber' : '')}
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
        ${card('Technical regime', escape(t.regime || 'N/A'), 'ADX + multi-timeframe alignment + volatility', /uptrend/i.test(t.regime || '') ? 'positive' : /downtrend/i.test(t.regime || '') ? 'amber' : '')}
      </div>
      <div class="small">Signal confidence: <b>${escape(t.signalConfidence || 'N/A')}</b>${vp.priceVsPointOfControl && vp.priceVsPointOfControl !== 'N/A' ? ` &middot; ${escape(vp.priceVsPointOfControl)}` : ''}</div>
    </article>`;
  const volumeProfile = `
    <article class="card">
      <h3>Volume profile ${infoIcon('volumeProfile')}</h3>
      <p class="small">Point of control: ${vp.pointOfControl ? `${fmt(vp.pointOfControl.priceLow)}&ndash;${fmt(vp.pointOfControl.priceHigh)} (${fmt(vp.pointOfControl.sharePct)}% of volume)` : 'N/A'}</p>
      <div class="scroll">${(vp.buckets || []).slice().reverse().map(b => `<div class="allocation-row"><span>${fmt(b.priceLow)}&ndash;${fmt(b.priceHigh)}</span><div class="bar"><i style="width:${b.sharePct}%"></i></div><span>${fmt(b.sharePct)}%</span></div>`).join('') || '<p class="small">Not available.</p>'}</div>
    </article>`;
  return { indicators, multiTimeframe, advancedScores, volumeProfile };
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
    $('#technical-detail-volume-profile').innerHTML = compareGrid(compareStocks, technicalDetailContent, 'volumeProfile');
    $('#technical-detail-advanced-scores').innerHTML = compareGrid(compareStocks, technicalDetailContent, 'advancedScores');
  } else {
    const c = stocks.length ? technicalDetailContent(stocks.find(s => s.symbol === activeCompanySymbol)) : null;
    $('#technical-detail-multi-timeframe').innerHTML = c ? c.multiTimeframe : empty;
    $('#technical-detail-indicators').innerHTML = c ? c.indicators : empty;
    $('#technical-detail-volume-profile').innerHTML = c ? c.volumeProfile : empty;
    $('#technical-detail-advanced-scores').innerHTML = c ? c.advancedScores : empty;
  }
  applySubtabState($('#technical'));
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
        ${card('Revenue concentration', 'N/A', 'No data source configured', '')}
        ${card('Customer concentration', 'N/A', 'No data source configured', '')}
        ${card('Execution risk', 'N/A', 'No data source configured', '')}
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
        ${card('Pledge', 'N/A', 'No data source configured', '')}
        ${card('Capital allocation', scoreText(gov.capitalAllocationRisk, true), '', '')}
        ${card('Related-party exposure', 'N/A', 'No data source configured', '')}
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
  applySubtabState($('#risks'));
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
  const rows = corr.matrix.map((row, i) => `<tr><th scope="row">${escape(corr.names[i])}</th>${row.map(r => `<td class="num" style="background:${correlationColor(r)}">${r == null ? 'N/A' : r.toFixed(2)}</td>`).join('')}</tr>`).join('');
  return `<table class="corr-table">${header ? `<thead>${header}</thead>` : ''}<tbody>${rows}</tbody></table>`;
}
function renderPortfolioAnalytics(data) {
  const p = data.portfolio || {};
  // These attribution/contribution lists only carry a company `name`, not a
  // `symbol` -- resolved here (names are unique within a watchlist) so
  // refreshActiveCompanyHighlights() can highlight the active company's row.
  const symbolByName = new Map(data.stocks.map(s => [s.name, s.symbol]));
  const dash = p.dashboard || {}, wavg = dash.weightedAverages || {};
  $('#portfolio-kpis').innerHTML = [
    card(`Total portfolio value ${infoIcon('portfolioValue')}`, dash.totalValue == null ? 'N/A' : fmt(dash.totalValue), 'An illustrative index (weight x price), not real currency', 'blue'),
    card('Weighted avg P/E', fmt(wavg.pe), '', 'blue'),
    card('Weighted avg ROE / ROCE', `${pct(wavg.roe)} / ${pct(wavg.roce)}`, '', 'positive'),
    card('Weighted FCF yield', pct(wavg.fcfYield), '', 'positive'),
    card(`Portfolio beta ${infoIcon('portfolioBeta')}`, fmt(p.beta), 'Weighted average of each holding\'s beta', ''),
    card(`Risk-adjusted return ${infoIcon('riskAdjustedReturnScore')}`, fmt(p.riskAdjustedReturn), 'Weighted avg proxy Sharpe: (1y return &minus; risk-free rate) / volatility', '')
  ].join('');

  const sectorDiv = p.sectorAllocation || {}, posDiv = p.positionConcentration || {};
  $('#portfolio-diversification').innerHTML = [
    card(`Sector diversification ${infoIcon('diversification')}`, sectorDiv.diversificationScore == null ? 'N/A' : `${sectorDiv.diversificationScore}/100`, 'Herfindahl-based sector spread', ''),
    card('Position diversification', posDiv.diversificationScore == null ? 'N/A' : `${posDiv.diversificationScore}/100`, 'Herfindahl-based position spread', ''),
    card('Effective number of holdings', fmt(posDiv.effectiveHoldings), '1 / HHI(weights)', ''),
    card('Largest position', pct(posDiv.topPositionPct), '', (posDiv.topPositionPct ?? 0) > 30 ? 'amber' : '')
  ].join('');

  const quality = p.quality || {};
  $('#portfolio-quality').innerHTML = [
    card(`Quality score ${infoIcon('portfolioQualityScore')}`, quality.qualityScore == null ? 'N/A' : `${Math.round(quality.qualityScore)}/100`, 'Weighted composite score', ''),
    card('Valuation score', quality.valuationScore == null ? 'N/A' : `${Math.round(quality.valuationScore)}/100`, 'Weighted valuation factor', ''),
    card('Technical score', quality.technicalScore == null ? 'N/A' : `${Math.round(quality.technicalScore)}/100`, 'Weighted technical score', ''),
    card('Risk score', quality.riskScore == null ? 'N/A' : `${Math.round(quality.riskScore)}/100`, 'Weighted composite risk score', '')
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
    ? Object.values(factors).map(f => `<div class="allocation-row"><span>${escape(f.label)}</span><div class="bar"><i style="width:${f.exposure ?? 0}%"></i></div><span>${f.exposure == null ? 'N/A' : `${f.exposure}/100`}</span></div>`).join('')
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
      ${card(`Recent avg (~${rolling.windowPoints || 26}wk)`, rolling.recentAvgCorrelation == null ? 'N/A' : rolling.recentAvgCorrelation.toFixed(2), '', '')}
      ${card('Long-run avg', rolling.longRunAvgCorrelation == null ? 'N/A' : rolling.longRunAvgCorrelation.toFixed(2), '', '')}
      ${card('Correlation stability', rolling.correlationStabilityScore == null ? 'N/A' : `${rolling.correlationStabilityScore}/100`, 'Higher = pairwise correlations haven\'t shifted much recently', '')}
    </div>` : '';

  $('#portfolio-scenarios').innerHTML = (p.scenarios || []).map(s => `
    <article class="card">
      <h3>${escape(s.label)} ${infoIcon('scenarioImpact')}</h3>
      <div class="small">${escape(s.description)}</div>
      <div class="kpi ${s.portfolioImpactPct < 0 ? 'amber' : 'positive'}">${pct(s.portfolioImpactPct)}</div>
      <div class="small">${escape(s.recoverySensitivity)}</div>
      <div class="small">Top contributors: ${s.riskContribution.slice(0, 3).map(c => escape(c.name)).join(', ') || 'N/A'}</div>
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

  $('#pi-action-table tbody').innerHTML = intel.actionRequired.length ? intel.actionRequired.map(a => {
    const stock = bySymbol.get(a.symbol);
    if (!stock) return '';
    return `<tr data-symbol="${escape(a.symbol)}">
      <td>${companyLink(a.symbol, stock.name)}</td>
      <td>${escape(stock.sector || 'N/A')}</td>
      <td>${actionScoreBadge(intel.actionScores[a.symbol])}</td>
      <td class="num" title="${escape(actionScoreTitle(intel.actionScores[a.symbol]))}">${a.score}/100</td>
      <td>${escape(stock.recommendation?.confidence || 'N/A')}</td>
      <td>${escape(a.rationale || 'N/A')}</td>
      <td class="num">${fairValueGapCell(stock)}</td>
      <td>${escape(stock.institutionalRisk?.riskTrend || 'N/A')}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="small">No action-required names currently.</td></tr>';

  const listRow = (symbol, reason) => { const s = bySymbol.get(symbol); return s ? `<div class="allocation-row" data-symbol="${escape(symbol)}"><span>${companyLink(symbol, s.name)}</span><span class="small">${escape(reason)}</span></div>` : ''; };
  const group = (label, list) => list.length ? `<div class="small" style="margin-top:10px"><b>${escape(label)}</b></div>${list.map(x => listRow(x.symbol, x.reason)).join('')}` : '';

  const undervalued = intel.opportunities.filter(o => (bySymbol.get(o.symbol)?.recommendation?.components?.valuation?.score ?? 0) >= 60);
  const improvingQuality = intel.opportunities.filter(o => alertsFor(o.symbol).some(al => al.type === 'recommendationChanged'));
  const improvingTechnicals = intel.opportunities.filter(o => alertsFor(o.symbol).some(al => ['breakoutConfirmation', 'crossedAbove50DMA', 'crossedAbove200DMA', 'macdCrossedBullish', 'relativeStrengthAcceleration'].includes(al.type)));
  const fallingRisk = intel.opportunities.filter(o => changesFor(o.symbol).some(c => c.field === 'compositeRiskScore' && c.to < c.from));
  const catalystMomentum = intel.opportunities.filter(o => (bySymbol.get(o.symbol)?.news || []).some(n => n.impact === 'High'));
  $('#pi-opportunities').innerHTML = [group('Undervalued', undervalued), group('Improving quality', improvingQuality), group('Improving technicals', improvingTechnicals), group('Falling risk', fallingRisk), group('Positive catalyst momentum', catalystMomentum)].join('') || '<p class="small">No opportunities currently flagged.</p>';

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
    card('Expected return', avgUpside == null ? 'N/A' : pct(avgUpside), "Simple average of each holding's upside to Target Price", (avgUpside ?? 0) >= 0 ? 'positive' : 'amber'),
    card('Risk-adjusted outlook', fmt(p.riskAdjustedReturn), 'Weighted avg proxy Sharpe: (1y return - risk-free rate) / volatility', ''),
    card('Portfolio health', intel.health?.score == null ? 'N/A' : `${intel.health.score}/100`, intel.health?.trend || 'N/A', intel.health?.trend === 'Improving' ? 'positive' : intel.health?.trend === 'Deteriorating' ? 'amber' : '')
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
    card('Top sector share', sectorDiv.allocation?.[0] ? `${escape(sectorDiv.allocation[0].sector)}: ${fmt(sectorDiv.allocation[0].sharePct)}%` : 'N/A', sectorDiv.concentrated ? 'Concentrated (>40% of allocated weight)' : '', sectorDiv.concentrated ? 'amber' : ''),
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
    $('#health-kpis').innerHTML = card('Portfolio health score', 'N/A', 'Not enough resolved holdings to compute.', '');
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
  const rebalancing = data.intelligence?.rebalancing || [];
  $('#rebalancing-table tbody').innerHTML = rebalancing.length ? rebalancing.map(r => {
    const s = bySymbol.get(r.symbol);
    if (!s) return '';
    return `<tr data-symbol="${escape(r.symbol)}">
      <td>${companyLink(r.symbol, s.name)}</td>
      <td class="num">${fmt(s.effectiveWeightPct)}%</td>
      <td class="num">${s.targetWeightPct == null ? 'Equal' : `${fmt(s.targetWeightPct)}%`}</td>
      <td>${escape(r.action)}</td>
      <td class="num" title="${escape(actionScoreTitle(data.intelligence.actionScores[r.symbol]))}">${data.intelligence.actionScores[r.symbol] ? `${data.intelligence.actionScores[r.symbol].score}/100` : 'N/A'}</td>
      <td>${escape(r.rationale)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="small">No rebalancing suggestions currently.</td></tr>';
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
  const tierCard = (label, tag) => card(label, tag?.score == null ? 'N/A' : `${tag.score}/100`, tag?.tier || 'N/A', EXPOSURE_TIER_CLASS[tag?.tier] === 'sell' ? 'amber' : '');
  $('#exposure-portfolio-kpis').innerHTML = [
    tierCard('Interest-rate sensitivity', p.interestRate),
    tierCard('Commodity sensitivity', p.commodity),
    tierCard('Regulatory sensitivity', p.regulatory),
    card('Currency exposure', p.currency?.exposure ?? 'N/A', p.currency?.direction || 'N/A', '')
  ].join('');

  const bySymbol = new Map(data.stocks.map(s => [s.symbol, s]));
  $('#exposure-matrix-table tbody').innerHTML = matrix.companies.map(c => {
    const stock = bySymbol.get(c.symbol);
    if (!stock) return '';
    return `<tr data-symbol="${escape(c.symbol)}">
      <td>${companyLink(c.symbol, stock.name)}</td>
      <td class="num"><span class="tag ${EXPOSURE_TIER_CLASS[c.interestRate.tier] || 'neutral'}">${c.interestRate.score ?? 'N/A'} &middot; ${escape(c.interestRate.tier)}</span></td>
      <td>${escape(c.currency.direction)}</td>
      <td class="num"><span class="tag ${EXPOSURE_TIER_CLASS[c.commodity.tier] || 'neutral'}">${c.commodity.score ?? 'N/A'} &middot; ${escape(c.commodity.tier)}</span></td>
      <td class="num"><span class="tag ${EXPOSURE_TIER_CLASS[c.regulatory.tier] || 'neutral'}">${c.regulatory.score ?? 'N/A'} &middot; ${escape(c.regulatory.tier)}</span></td>
      <td>${escape(c.economicCycle.label)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="small">Not available.</td></tr>';
}

// Risks tab's Alerts sub-tab: severity-filtered, client-side only (the
// backend already excludes acknowledged alerts from `data.intelligence.alerts`
// -- see data/decision/index.mjs). Acknowledging calls the Stage 1 route and
// re-renders from the fresh payload, so an acknowledged alert disappearing is
// just the normal render() cascade, not special-cased here.
let alertsSeverityFilter = '';
function renderAlerts(data) {
  $('#alerts-methodology-info').innerHTML = infoIcon('alertSeverity');
  const bySymbol = new Map(data.stocks.map(s => [s.symbol, s]));
  const severityRank = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  const alerts = (data.intelligence?.alerts || [])
    .filter(a => !alertsSeverityFilter || a.severity === alertsSeverityFilter)
    .sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0) || new Date(b.detectedAt) - new Date(a.detectedAt));
  $('#alerts-table tbody').innerHTML = alerts.length ? alerts.map(a => {
    const stock = bySymbol.get(a.symbol);
    const companyCell = stock ? companyLink(a.symbol, stock.name) : escape(a.symbol === 'PORTFOLIO' ? 'Portfolio' : a.symbol);
    return `<tr data-symbol="${escape(a.symbol)}">
      <td><span class="tag ${SEVERITY_TAG_CLASS[a.severity] || 'neutral'}">${escape(a.severity)}</span></td>
      <td>${companyCell}</td>
      <td>${escape(a.category)}</td>
      <td>${escape(a.message)}</td>
      <td>${escape(a.confidence)}</td>
      <td>${new Date(a.detectedAt).toLocaleString()}</td>
      <td><button type="button" class="icon-btn" data-ack-alert="${escape(a.id)}">Acknowledge</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="small">No unacknowledged alerts.</td></tr>';
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
  applySubtabState($('#fundamentals'));
}

// ---- Dashboard: Executive Summary, KPI Ribbon, Top Opportunities, Recent
// News & Catalysts, Sector Allocation, Watchlist Snapshot, Key Risks,
// Upcoming Earnings & Events. Top Opportunities/Key Risks are *views* --
// independently sorted/sliced for display, never mutating data.stocks. ----
function renderDashboardKpis(data) {
  const avg = data.averages || {};
  $('#dashboard-kpis').innerHTML =
    card('Watchlist recommendation', data.recommendation, 'Screen-derived signal across saved companies', data.recommendation === 'OVERWEIGHT' ? 'positive' : 'amber') +
    `<article class="card"><h3>Investment score</h3><div class="score"><div class="score-circle">${data.score}</div><div class="small">Composite/technical blend across the watchlist<br><br><div class="progress"><i style="width:${data.score}%"></i></div></div></div></article>` +
    card('Average P/E', fmt(avg.pe), 'Across companies with reported data', 'blue') +
    card('Market trend', data.trend, `Average daily move ${pct(avg.change)}`, (avg.change ?? 0) >= 0 ? 'positive' : 'amber');
}

// Primary driver is computed once, server-side, by the same unified
// recommendation engine that sets the rating and confidence (the bucket
// furthest from neutral -- see scoringEngine.mjs's derivePrimaryDriver) --
// this just renders it, so Top Opportunities can never show a "key catalyst"
// that disagrees with the Recommendation/Confidence badge next to it.
function keyCatalystFor(stock) {
  return stock.recommendation?.primaryDriver || 'N/A';
}
const RATING_RANK = { 'Strong Buy': 6, Buy: 5, Accumulate: 4, Hold: 3, Reduce: 2, Sell: 1 };
const CONVICTION_RANK = { High: 3, Medium: 2, Low: 1 };
function sortOpportunities(stocks, mode) {
  const eligible = stocks.filter(s => !s.unresolved);
  const sorted = [...eligible];
  if (mode === 'upside') sorted.sort((a, b) => (b.valuation?.upsidePct ?? -Infinity) - (a.valuation?.upsidePct ?? -Infinity));
  else if (mode === 'conviction') sorted.sort((a, b) => (CONVICTION_RANK[b.valuation?.convictionLevel] || 0) - (CONVICTION_RANK[a.valuation?.convictionLevel] || 0));
  else if (mode === 'valuation') sorted.sort((a, b) => (b.recommendation?.factors?.valuation?.value ?? -1) - (a.recommendation?.factors?.valuation?.value ?? -1));
  else if (mode === 'growth') sorted.sort((a, b) => (b.recommendation?.factors?.growth?.value ?? -1) - (a.recommendation?.factors?.growth?.value ?? -1));
  else if (mode === 'quality') sorted.sort((a, b) => (b.recommendation?.compositeScore ?? -1) - (a.recommendation?.compositeScore ?? -1));
  else if (mode === 'technical') sorted.sort((a, b) => (b.recommendation?.technicalScore ?? -1) - (a.recommendation?.technicalScore ?? -1));
  else sorted.sort((a, b) => (RATING_RANK[b.signal] || 0) - (RATING_RANK[a.signal] || 0) || (b.score || 0) - (a.score || 0));
  return sorted.slice(0, 5);
}
function renderTopOpportunities(data) {
  const top = sortOpportunities(data.stocks, opportunitiesSort);
  $('#opportunities-table tbody').innerHTML = top.length ? top.map(stock => `<tr data-symbol="${escape(stock.symbol)}">
      <td><button type="button" class="row-company-link" data-symbol="${escape(stock.symbol)}">${escape(stock.name)}</button></td><td>${escape(stock.sector || 'N/A')}</td><td>${fmt(stock.price)} ${escape(stock.currency || '')}</td>
      <td>${signalTag(stock)}</td><td>${pct(stock.valuation?.upsidePct)}</td><td>${escape(stock.valuation?.convictionLevel || 'N/A')}</td><td>${escape(keyCatalystFor(stock))}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="small">No data yet.</td></tr>';
}

const IMPACT_CLASS = { High: 'sell', Medium: 'hold', Low: 'neutral' };
// Phase 6 News Intelligence upgrade: sentiment (data/news/companyNews.mjs)
// alongside the existing impact/catalyst tags -- items fetched before this
// stage shipped won't carry `sentiment`/`affectedThesisDriver` until their
// next real refetch (cached bundle, old shape), so both render 'N/A' rather
// than a blank cell.
const SENTIMENT_CLASS = { Positive: 'buy', Negative: 'sell', Uncertain: 'hold', Neutral: 'neutral' };
const THESIS_DRIVER_LABEL = { businessQuality: 'Business quality', growthDrivers: 'Growth drivers', competitivePosition: 'Competitive position', valuationOpportunity: 'Valuation opportunity', keyRisks: 'Key risks' };
function renderDashboardNews(data) {
  const items = data.stocks.flatMap(stock => (stock.news || []).map(item => ({ ...item, company: stock.name })));
  items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  $('#dashboard-news').innerHTML = items.length ? items.slice(0, 20).map(item => `<div class="news-item">
      <div><a target="_blank" rel="noopener" href="${escape(item.url)}">${escape(item.title)}</a><small>${escape(item.company)} &middot; ${escape(item.source)} &middot; ${escape(item.catalystType || 'General')} &middot; ${escape(item.expectedTimeline || 'Unclassified')}${item.affectedThesisDriver ? ` &middot; Affects: ${escape(THESIS_DRIVER_LABEL[item.affectedThesisDriver] || item.affectedThesisDriver)}` : ''}</small></div>
      <div class="news-meta"><span class="tag ${IMPACT_CLASS[item.impact] || 'neutral'}">${escape(item.impact)}</span><span class="tag ${SENTIMENT_CLASS[item.sentiment] || 'neutral'}">${escape(item.sentiment || 'N/A')}</span><small>${item.date ? new Date(item.date).toLocaleDateString() : 'N/A'}</small></div>
    </div>`).join('') : '<p class="small">No recent company news was returned by the source.</p>';
}

// Phase 6 Earnings Intelligence + Event Calendar: reads
// data.stocks[].earningsIntelligence (real quarterly deltas, data/analytics/
// earningsAnalytics.mjs) and data.eventCalendar (data/analytics/
// eventCalendar.mjs) -- both already computed server-side. Pure formatting.
const IMPACT_CLASS_EI = { High: 'sell', Medium: 'hold', Low: 'buy' };
function renderEarningsIntelligence(data) {
  $('#earnings-methodology-info').innerHTML = infoIcon('earningsIntelligence');
  const eligible = data.stocks.filter(s => !s.unresolved && s.earningsIntelligence);
  $('#earnings-intel-table tbody').innerHTML = eligible.length ? eligible.map(stock => {
    const ei = stock.earningsIntelligence;
    const q = ei.quarterly;
    if (!q) return `<tr data-symbol="${escape(stock.symbol)}"><td>${companyLink(stock.symbol, stock.name)}</td><td colspan="8" class="small">No quarterly results data available.</td><td><span class="tag neutral">${escape(ei.calendar?.status || 'Future Integration')}</span></td></tr>`;
    return `<tr data-symbol="${escape(stock.symbol)}">
      <td>${companyLink(stock.symbol, stock.name)}</td>
      <td>${escape(q.latestPeriod || 'N/A')}</td>
      <td class="num">${pct(q.revenue.qoqPct)}</td>
      <td class="num">${pct(q.revenue.yoyPct)}</td>
      <td class="num">${pct(q.netProfit.qoqPct)}</td>
      <td class="num">${pct(q.netProfit.yoyPct)}</td>
      <td class="num">${q.operatingMargin.qoqDeltaPts == null ? 'N/A' : `${q.operatingMargin.qoqDeltaPts >= 0 ? '+' : ''}${q.operatingMargin.qoqDeltaPts}pp`}</td>
      <td class="num">${q.operatingMargin.yoyDeltaPts == null ? 'N/A' : `${q.operatingMargin.yoyDeltaPts >= 0 ? '+' : ''}${q.operatingMargin.yoyDeltaPts}pp`}</td>
      <td class="num">${pct(q.netProfit.deviationVsTrailingAvgPct)}</td>
      <td><span class="tag neutral">${escape(ei.calendar?.status || 'Future Integration')}</span></td>
    </tr>`;
  }).join('') : '<tr><td colspan="10" class="small">This watchlist is empty.</td></tr>';

  const events = (data.eventCalendar || []).slice(0, 30);
  $('#event-calendar-list').innerHTML = events.length ? events.map(item => `<div class="news-item">
      <div><a target="_blank" rel="noopener" href="${escape(item.url)}">${escape(item.title)}</a><small>${escape(item.name)} &middot; ${escape(item.catalystType || 'General')}</small></div>
      <div class="news-meta"><span class="tag ${IMPACT_CLASS_EI[item.impact] || 'neutral'}">${escape(item.impact)}</span><small>${item.date ? new Date(item.date).toLocaleDateString() : 'N/A'}</small></div>
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
    ? `<div class="kpi">${escape(regime?.label || 'N/A')} ${infoIcon('marketRegime')}</div><div class="small">Confidence: ${escape(regime?.confidence || 'N/A')}</div>${macroRows}`
    : '<p class="small">Not available.</p>';

  // Sector state: current-state Sector Intelligence rollup, not a day-over-
  // day delta -- no historical snapshot exists for cross-watchlist sector
  // data (a future-work gap, disclosed in sectorIntelligence.mjs's own
  // dataLimitations), so this shows "today's state," never a fabricated change.
  const topSectors = (sectorIntelData?.sectors || []).slice(0, 5);
  $('#mb-sector-state').innerHTML = topSectors.length
    ? topSectors.map(s => `<div class="allocation-row"><span>${escape(s.sector)} (${s.companyCount})</span><span>${s.avgCompositeScore == null ? 'N/A' : `${s.avgCompositeScore}/100`}</span></div>`).join('')
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
      <div class="news-meta"><span class="tag ${IMPACT_CLASS[item.impact] || 'neutral'}">${escape(item.impact)}</span><span class="tag ${SENTIMENT_CLASS[item.sentiment] || 'neutral'}">${escape(item.sentiment || 'N/A')}</span></div>
    </div>`).join('') : '<p class="small">No recent news.</p>';
}

function renderExecStatus(data) {
  const s = data.executiveSummary || {};
  $('#exec-status').innerHTML = [
    card('Watchlist rating', s.watchlistRating || 'N/A', 'Screen-derived signal across saved companies', s.watchlistRating === 'OVERWEIGHT' ? 'positive' : 'amber'),
    card('Valuation status', s.valuationStatus || 'N/A', s.avgPremiumDiscount == null ? '' : `Avg ${pct(s.avgPremiumDiscount)} vs. sector median`, ''),
    card('Risk status', s.riskStatus || 'N/A', s.avgCompositeRisk == null ? '' : `Avg composite risk ${s.avgCompositeRisk}/100`, s.riskStatus === 'Elevated' ? 'amber' : s.riskStatus === 'Low' ? 'positive' : ''),
    card('Opportunity status', s.opportunityStatus || 'N/A', '', '')
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
    card('Diversification score', allocation.diversificationScore == null ? 'N/A' : `${allocation.diversificationScore}/100`, 'Herfindahl-based sector spread', (allocation.diversificationScore ?? 0) > 60 ? 'positive' : 'amber')
  ].join('');
}

function primaryRiskCategory(risk) {
  const entries = Object.entries(risk.categories || {}).filter(([, v]) => v != null);
  if (!entries.length) return 'N/A';
  const [key] = entries.sort((a, b) => b[1] - a[1])[0];
  return { financial: 'Financial risk', business: 'Business risk', market: 'Market risk', sector: 'Sector risk', governance: 'Governance risk' }[key] || key;
}
function renderDashboardRisks(data) {
  const eligible = data.stocks.filter(s => !s.unresolved && s.institutionalRisk?.compositeRiskScore != null);
  const top = [...eligible].sort((a, b) => b.institutionalRisk.compositeRiskScore - a.institutionalRisk.compositeRiskScore).slice(0, 5);
  $('#dashboard-risks').innerHTML = top.length ? `<table><thead><tr><th>Company</th><th>Sector</th><th>Composite risk</th><th>Primary risk category</th></tr></thead><tbody>${
    top.map(stock => { const composite = stock.institutionalRisk.compositeRiskScore; return `<tr><td>${escape(stock.name)}</td><td>${escape(stock.sector || 'N/A')}</td><td><span class="tag ${composite > 65 ? 'sell' : composite > 40 ? 'hold' : 'buy'}">${composite}/100</span></td><td>${escape(primaryRiskCategory(stock.institutionalRisk))}</td></tr>`; }).join('')
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
  if (currentData) renderMorningBriefing(currentData); // Morning Briefing reuses macroData -- re-render once it lands, if the watchlist already rendered first
}
const MACRO_STATUS_CLASS = { Live: 'buy', Delayed: 'hold', Unavailable: 'sell', 'Future Integration': 'neutral' };
const MACRO_DIRECTION_CLASS = { Rising: 'positive', Falling: 'negative', Flat: '', 'N/A': '' };
function renderMacroIntelligence() {
  $('#macro-methodology-info').innerHTML = infoIcon('macroIndicator');
  if (!macroData) {
    $('#macro-regime').innerHTML = '<p class="small">Not available.</p>';
    $('#macro-data-quality').innerHTML = '';
    $('#macro-indicators-table tbody').innerHTML = '<tr><td colspan="8" class="small">Not available.</td></tr>';
    $('#macro-unavailable-table tbody').innerHTML = '';
    return;
  }
  const regime = macroData.regime || {};
  $('#macro-regime').innerHTML = `
    <div class="kpi">${escape(regime.label || 'N/A')} ${infoIcon('marketRegime')}</div>
    <div class="small">Confidence: ${escape(regime.confidence || 'N/A')}</div>
    <ul>${(regime.notes || []).map(note => `<li>${escape(note)}</li>`).join('')}</ul>`;

  const dq = macroData.dataQuality || {};
  $('#macro-data-quality').innerHTML = [
    card('Live', dq.live ?? 0, 'Fetched within the last 30 minutes', 'positive'),
    card('Delayed', dq.delayed ?? 0, 'Serving a stale cached reading (fresh fetch failed)', dq.delayed ? 'amber' : ''),
    card('Unavailable', dq.unavailable ?? 0, 'Fetch failed and no cached reading exists', dq.unavailable ? 'amber' : ''),
    card('Future Integration', dq.futureIntegration ?? 0, 'No data source configured for these indicators', 'neutral')
  ].join('');

  $('#macro-indicators-table tbody').innerHTML = (macroData.indicators || []).length ? macroData.indicators.map(ind => `
    <tr>
      <td>${escape(ind.label)}</td>
      <td>${escape(ind.category)}</td>
      <td class="num">${ind.value == null ? 'N/A' : `${fmt(ind.value)} ${escape(ind.unit || '')}`}</td>
      <td class="num">${pct(ind.changePct)}</td>
      <td class="num">${pct(ind.oneYearChangePct)}</td>
      <td><span class="${MACRO_DIRECTION_CLASS[ind.direction] || ''}">${escape(ind.direction)}</span></td>
      <td><span class="tag ${MACRO_STATUS_CLASS[ind.status] || 'neutral'}">${escape(ind.status)}</span></td>
      <td>${ind.asOf ? new Date(ind.asOf).toLocaleString() : 'N/A'}</td>
    </tr>`).join('') : '<tr><td colspan="8" class="small">Not available.</td></tr>';

  $('#macro-unavailable-table tbody').innerHTML = (macroData.unavailable || []).map(ind =>
    `<tr><td>${escape(ind.label)}</td><td>${escape(ind.category)}</td><td><span class="tag neutral">${escape(ind.status)}</span></td></tr>`
  ).join('');
}

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
    card('Largest sector', sectors[0] ? `${escape(sectors[0].sector)} (${sectors[0].companyCount})` : 'N/A', 'By company count', '')
  ].join('');

  $('#sector-intel-table tbody').innerHTML = sectors.length ? sectors.map(s => `
    <tr>
      <td>${escape(s.sector)}</td>
      <td class="num">${s.companyCount}</td>
      <td class="num">${s.avgCompositeScore == null ? 'N/A' : `${s.avgCompositeScore}/100`}</td>
      <td class="num">${s.avgValuationScore == null ? 'N/A' : `${s.avgValuationScore}/100`}</td>
      <td class="num">${s.avgTechnicalScore == null ? 'N/A' : `${s.avgTechnicalScore}/100`}</td>
      <td class="num">${s.avgRiskScore == null ? 'N/A' : `${s.avgRiskScore}/100`}</td>
      <td class="num">${pct(s.avgRelativeStrengthPct)}</td>
      <td class="num">${pct(s.avgEpsCagr5yPct)}</td>
      <td class="num">${s.regulatorySensitivity ?? 'N/A'}${s.sectorTagsMatched ? '' : ' <span class="small">(baseline)</span>'}</td>
      <td class="num">${s.commoditySensitivity ?? 'N/A'}</td>
      <td>${Object.entries(s.ratingCounts || {}).map(([r, n]) => `<span class="tag ${tagClass(r)}">${escape(r)} ${n}</span>`).join(' ')}</td>
    </tr>`).join('') : '<tr><td colspan="11" class="small">No companies in any saved watchlist yet.</td></tr>';

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
    const persisted = loadPersistedActiveCompany();
    activeCompanySymbol = (persisted && persisted.watchlistId === data.watchlistId && data.stocks.some(s => s.symbol === persisted.symbol))
      ? persisted.symbol
      : data.stocks[0]?.symbol ?? null;
  } else if (!data.stocks.some(s => s.symbol === activeCompanySymbol)) {
    activeCompanySymbol = data.stocks[0]?.symbol ?? null;
  }
  $('#status').textContent = `${data.watchlistName} — Updated ${new Date(data.generatedAt).toLocaleString()}`;
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
  renderTechnicalTab(data.stocks);
  renderTechnicalDetail(data);
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
  $('#risk-table tbody').innerHTML = eligible.length ? eligible.map(stock => {
    const m = stock.metrics || {}, r = stock.institutionalRisk, c = r.categories || {};
    const downside200 = stock.price && stock.twoHundred ? (stock.twoHundred / stock.price - 1) * 100 : null;
    const downsideLow = stock.price && stock.low52 ? (stock.low52 / stock.price - 1) * 100 : null;
    return `<tr data-symbol="${escape(stock.symbol)}">${prefixCells(stock)}<td>${suffixed(m.interestCoverage, 'x')}</td><td>${scoreText(c.financial, true)}</td><td>${scoreText(c.business, true)}</td><td>${scoreText(c.market, true)}</td><td>${scoreText(c.sector, true)}</td><td>${scoreText(c.governance, true)}</td><td>${pct(downside200)}</td><td>${pct(downsideLow)}</td><td><span class="tag ${r.compositeRiskScore > 65 ? 'hold' : 'buy'}">${fmt(r.compositeRiskScore)}/100</span></td><td>${escape(r.riskTrend || 'N/A')}</td></tr>`;
  }).join('') : '<tr><td colspan="14" class="small">This watchlist is empty.</td></tr>';
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
  renderSectorIntelligence();

  renderWatchlistsTab(data);
  renderHeaderCompanySelector();
  renderCompareBar();
  refreshActiveCompanyHighlights();
}

$('#opportunities-sort').addEventListener('change', () => {
  opportunitiesSort = $('#opportunities-sort').value;
  if (currentData) renderTopOpportunities(currentData);
});

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
      name: s => s.name, sector: s => s.sector || '', price: s => s.price, pe: s => s.pe,
      signal: s => RATING_RANK[s.signal] || 0, confidence: s => CONVICTION_RANK[s.recommendation?.confidence] || 0,
      weight: s => s.effectiveWeightPct, marketCap: s => s.marketCap, roe: s => s.roe, roce: s => s.roce,
      growth: s => s.metrics?.revenueCagr3y, risk: s => s.institutionalRisk?.compositeRiskScore,
      updated: s => s.fetchedAt ? new Date(s.fetchedAt).getTime() : 0,
      actionScore: s => data.intelligence?.actionScores?.[s.symbol]?.score,
      action: s => ({ 'Add aggressively': 5, Add: 4, Hold: 3, Reduce: 2, Exit: 1 }[data.intelligence?.actionScores?.[s.symbol]?.label] || 0),
      fvGap: s => s.valuation?.marginOfSafetyPct,
      riskTrend: s => s.institutionalRisk?.riskTrend || '',
      techTrend: s => s.technicalScorecard?.regime || '',
      alertCount: s => (data.intelligence?.alerts || []).filter(a => a.symbol === s.symbol).length,
      lastChange: s => data.intelligence?.changes?.bySymbol?.[s.symbol]?.hasChanges ? 1 : 0
    }[wlSortColumn];
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
    card(`Diversification score ${infoIcon('diversification')}`, allocation.diversificationScore == null ? 'N/A' : `${allocation.diversificationScore}/100`, 'Herfindahl-based sector spread', ''),
    card('Average valuation', avgValuation == null ? 'N/A' : pct(avgValuation), 'Avg premium/discount vs. sector median', ''),
    card('Average quality', avgQuality == null ? 'N/A' : `${Math.round(avgQuality)}/100`, 'Avg composite recommendation score', ''),
    card('Average risk', avgRisk == null ? 'N/A' : `${Math.round(avgRisk)}/100`, 'Avg composite risk score', (avgRisk ?? 0) > 65 ? 'amber' : ''),
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
      <td>${escape(stock.sector || 'N/A')}</td>
      <td class="num">${fmt(stock.price)}</td>
      <td class="num">${fmt(stock.pe)}</td>
      <td>${stock.unresolved ? 'N/A' : signalTag(stock)}</td>
      <td>${escape(stock.recommendation?.confidence || 'N/A')}</td>
      <td class="num"><input type="number" class="weight-input" min="0" max="100" step="1" placeholder="Equal" value="${stock.targetWeightPct ?? ''}" data-symbol="${escape(stock.symbol)}" title="Target allocation weight % (blank = equal-weight share of the remainder)"></td>
      <td class="num">${stock.marketCap == null ? 'N/A' : `${compact(stock.marketCap)} ${escape(stock.marketCapUnit || '')}`}</td>
      <td class="num">${pct(stock.roe)}</td>
      <td class="num">${pct(stock.roce)}</td>
      <td class="num">${pct(stock.metrics?.revenueCagr3y)}</td>
      <td class="num">${scoreText(stock.institutionalRisk?.compositeRiskScore, true)}</td>
      <td>${escape(wlLastUpdatedText(stock))}</td>
      <td class="num" title="${escape(actionScoreTitle(action))}">${action ? `${action.score}/100` : 'N/A'}</td>
      <td>${actionScoreBadge(action)}</td>
      <td class="num">${fairValueGapCell(stock)}</td>
      <td>${escape(stock.institutionalRisk?.riskTrend || 'N/A')}</td>
      <td>${escape(stock.technicalScorecard?.regime || 'N/A')}</td>
      <td class="num">${alertCount}</td>
      <td>${escape(lastChangeLabel)}</td>
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
      <div class="suggestion-sector">${escape(c.sector || 'N/A')}</div>
      <div class="suggestion-industry">${escape(c.industry || 'N/A')}</div>
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

// Keeps the sticky Watchlists search bar (position:sticky, top:var(--header-h))
// pinned directly under the real header instead of a guessed pixel value --
// the header's own height changes with viewport width (title/toolbar wrap).
function syncHeaderHeight() {
  const header = document.querySelector('header');
  if (header) document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
}
window.addEventListener('resize', syncHeaderHeight);
window.addEventListener('load', syncHeaderHeight);
syncHeaderHeight();

# Roadmap

## 2026-08-14 — Phase 3f: unified company context and cross-tab synchronization

### Objective

Turn the app from 11 tabs each tracking their own state into one integrated
workspace: a single active company shared across every tab. Before this
phase, Fundamentals/Valuation/Technicals/Risks each kept an independent
per-tab `selected*Symbol` variable, all four wiped to `null` on every
`render()` (watchlist switch, refresh, add/remove/reweight/note edit) — no
other table let you click a company to select it, and Report generation only
knew a company via a URL param baked in at the moment a Watchlists row's
icon was clicked. Added: a persistent header company selector (name, ticker,
sector, price, recommendation, confidence, plus a Recent-companies group),
click-to-select in every company-listing table, Quick Jump between a
company's Fundamentals/Valuation/Technicals/Risks/Report, a 2-4 company
Compare mode, and full persistence (active company, watchlist, sub-tabs)
across reloads. No new API calls, no new server-side computation — every
figure used was already in `currentData`, loaded once per watchlist
load/refresh.

### Implementation status: done

- **Single source of truth** (`script.js`): the four independent
  `selected*Symbol` variables were removed and replaced with one
  `activeCompanySymbol`. `setActiveCompany(symbol)` is the one write-point —
  it re-renders exactly the views that depend on company selection
  (Fundamentals, Valuation, Technicals, Risks, Portfolio analytics, the
  header selector, and the active-row highlight refresh) off the
  already-loaded `currentData`, with zero API calls. `ensureActiveCompany()`
  keeps each tab's own local fallback-to-first-company behavior for the
  cases where a company is excluded from that tab's filtered list (e.g.
  `unresolved`), same as before, without corrupting the shared symbol.
  `render()` no longer blanket-resets selection on every call — it only
  re-resolves the active company (from persisted storage, else the first
  company) when the watchlist actually changed; a same-watchlist refresh or
  mutation now keeps whatever was selected, fixing a pre-existing rough edge
  where editing a note or reweighting silently reset your deep-dive
  selection back to company #1.
- **Click-to-select everywhere, via one shared function**
  (`script.js`): `prefixCells()` — the shared leading-cells helper already
  used by ~20 tables (Valuation, Profitability×5, Balance sheet×5, Growth×5,
  Ownership×4, Technicals×6, Risk, Portfolio) — now renders the Name cell as
  a `.row-company-link` button instead of plain text, and `renderTable()`
  stamps `data-symbol` on each `<tr>`. One delegated listener on `#main`
  handles every click. The Watchlists and Top Opportunities tables (which
  build their rows by hand, not through `prefixCells`) got the same button
  treatment directly, so they're covered by the same listener too — this one
  change wired "click a company in any table" across the entire app.
- **Active-company highlighting everywhere**
  (`refreshActiveCompanyHighlights()`): a pure class-toggle over
  `tr[data-symbol]`/`.allocation-row[data-symbol]`, no re-render. Lights up
  the selected row in every table via the mechanism above, plus Portfolio's
  position-risk and quality/valuation attribution lists (which only carry a
  company `name`, so `renderPortfolioAnalytics` now resolves `symbol` via a
  `name -> symbol` map built once per render).
- **Header company selector, Quick Jump, Compare toggle** (`index.html`, new
  `#company-context-bar` toolbar row; `styles.css`, new rules reusing
  `.toolbar`/`.pill`/`.suggestions`/`.tag` — no new visual language): the
  selector button + dropdown shows name/ticker/sector/price/signal/
  confidence for the active company and every company in the watchlist, plus
  a "Recent" group; picking a recent company from a different watchlist
  calls the existing `switchWatchlist()` before `setActiveCompany()`. Quick
  Jump's four tab buttons reuse the existing tab-switch handler
  (`$('.tabs button[data-tab="..."]').click()`) verbatim; its Report button
  reuses the exact `window.open('report.html?wl=...&symbol=...')` call
  already used by the Watchlists row action, just sourced from the active
  company — `report.html`/`report.js` are unmodified.
- **Compare mode** (`script.js`): a `compareMode` flag + `compareSymbols`
  list (2-4, in-memory only). Inside Valuation/Technicals/Risks, the same
  pill-selector widget (`renderCompareAwarePillSelector`) switches from
  single-select (`setActiveCompany`) to multi-select
  (`toggleCompareSymbol`) when compare is on. With 2+ companies picked, each
  `.subsection` panel Phase 3e already split out is filled by a
  `compareGrid()` helper that calls the *same, unmodified*
  `valuationDetailContent()`/`technicalDetailContent()`/`riskDetailContent()`
  functions once per selected company and lays the results out in the
  existing `.grid.two/.three/.four` CSS — no change to those three
  content-builder functions at all. Below 2 selections, every tab renders
  exactly as it did before this phase. Profitability (a table-split tab with
  no pill selector) needs no new rendering logic at all: its existing
  tables are simply called with `stocks.filter(s =>
  compareSymbols.includes(s.symbol))` instead of the full watchlist.
- **Persistence** (`script.js`): `localStorage['activeCompanyContext']`
  (`{watchlistId, symbol}`) and `localStorage['recentCompanies']` (last 10,
  deduped, most-recent-first) are new. The existing Phase 3e sub-tab
  persistence was upgraded from `sessionStorage` to `localStorage` (same
  `subtab:<tabId>` keys, two-line change) since `sessionStorage` only
  survives a same-tab reload, not a full close/reopen of the app — the
  active watchlist itself already persists server-side
  (`data/watchlists/index.json`), so no new work was needed there.
- **Scope cuts made deliberately** (confirmed with the user before
  building): no live sync between multiple simultaneously open browser
  windows (`localStorage` restore-on-reload only, matching this app's
  existing storage precedent — no `storage`-event listener exists anywhere
  in the codebase); `report.html` stays a separate `window.open` page rather
  than gaining an in-app SPA tab.

### Validation completed

Launched `node server.mjs` and drove it with Playwright (Chromium) against
`http://localhost:4173`:

- Header selector shows the active company's name/ticker/sector/price/
  signal/confidence; opening it lists every company in the active watchlist
  plus a Recent group.
- Clicking a company name in the Watchlists table updates the header
  selector, Valuation's pill row, and highlights the clicked row
  (`active-company-row` class confirmed programmatically, not just
  visually).
- Quick Jump → Valuation switches tabs and shows the same company already
  selected in Watchlists (`Oberoi Realty Limited` in both places).
- Quick Jump → Report opens `report.html?wl=sameer&symbol=OBEROIRLTY.NS` in
  a new tab — the exact watchlist + active company, no re-selection.
- Compare mode: toggled on, picked 2 companies from Valuation's pill row —
  the DCF sub-tab rendered a 2-column `compare-grid`; switching to
  Technicals' Momentum sub-tab and Profitability showed the identical
  2-company set (compare grid columns and filtered table rows both matched),
  confirming synchronization across tabs.
- Clicking "Refresh Data" (a real POST to `/api/watchlists/:id/refresh`)
  left the active company unchanged before and after — the pre-existing
  reset-to-company-#1 behavior on refresh is gone.
- Zero console/page errors across the entire run.
- `node --check script.js` passes.

### Remaining work / deferred improvements

- No live sync across multiple simultaneously open browser windows/tabs of
  the app (deliberate scope cut, see above) — only persistence-on-reload.
- Compare mode selections are not persisted across a reload (only the
  active company, watchlist and sub-tabs are) — re-picking companies to
  compare after a full reopen is expected.

### Repository governance

No new authoritative documents created; this entry is the only record of
the change, per the existing convention. No files became obsolete and
nothing moved to `archive/` — `server.mjs`, `report.html`, `report.js`, and
every `data/` module are untouched; this phase is a pure client-side
reorganization of state that already existed in `currentData`.

## 2026-08-14 — Phase 3e: two-level section sub-tab navigation

### Objective

Every main tab (Dashboard, Fundamentals, Valuation, Profitability, Balance
sheet, Growth, Ownership, Technicals, Portfolio, Risks — `Watchlists` was
excluded, it's already a single-purpose full-bleed workspace) previously
rendered as one long scrolling page of stacked cards/tables. Added a second
navigation level: a sticky row of sub-tab pill buttons directly under each
tab's header, so any section is reachable with a single click, no scrolling
past unrelated content — the institutional-terminal workspace pattern
(Bloomberg/CapIQ/FactSet) the user asked for. Pure client-side visibility
toggling: no new API calls, no re-fetching, no re-computation, and the
existing visual language (`--blue` active pills, `.card`) was reused as-is
rather than redesigned.

### Implementation status: done

- **Shared infrastructure** (`styles.css`, `script.js`): one `.subtabs`
  sticky pill-row component (reuses the `--header-h` var `syncHeaderHeight()`
  already maintains for the Watchlists search bar, so it docks right under
  the real header) and one generic JS controller
  (`initSubtabs`/`applySubtabState`/`setActiveSubtab`) — no per-tab
  special-casing. Selection state lives in an `activeSubtabs` module map +
  `sessionStorage` (`subtab:<tabId>` keys), not just the DOM, because the
  four "deep-dive" tabs below rebuild their panels' `innerHTML` on every
  company switch or data refresh; `applySubtabState(root)` is called again
  at the end of those render functions to re-hide whatever wasn't already
  selected. Buttons are `role="tab"` with roving `tabindex`/arrow-key/
  Home/End navigation; the bar is `role="tablist"`; panels are
  `role="tabpanel"`. A panel's `data-subtab` may be a space-separated list
  (used once — see Valuation below) for a panel shared across several
  sub-tabs.
- **Static tabs** (Dashboard, Portfolio, and the "Overview" portions of
  Technicals/Risks): existing cards wrapped in `<div class="subsection">` in
  `index.html` only — the containers `render()` already fills were never
  touched, so refreshes need no extra wiring. Dashboard's two-col Sector
  allocation/Watchlist snapshot pair split into two sub-tabs each showing
  one card; the Data-policy disclaimer rides along with Upcoming earnings
  (last, no cleaner home for a tab-wide footnote).
- **Column-split tables** (Profitability, Balance sheet, Growth, Ownership,
  and the Technicals scorecard): these tabs had only one wide table each, no
  existing per-section content to redistribute, so the single table split
  into several narrower `<table>`s (one per sub-tab) — same
  `renderTable()`/`prefixCells()` helper, same `stocks` array, just a
  smaller column subset per call (`renderProfitability`,
  `renderBalanceSheetTab`, `renderGrowthTab`, `renderOwnershipTab`,
  `renderTechnicalTab` in `script.js`). This is the piece that actually
  removes the horizontal scrolling those wide tables required. Some columns
  necessarily repeat across sub-tabs (e.g. Debt/equity appears under both
  Leverage and Financial resilience) since the underlying metric set is
  fixed and nothing new was fabricated to fill out six distinct sub-tabs.
- **Dynamic deep-dive tabs** (Fundamentals, Valuation, Technicals, Risks):
  `fundamentalsContent()`, `valuationDetailContent()`,
  `technicalDetailContent()`, `riskDetailContent()` changed from returning
  one concatenated HTML string to a keyed object of fragments, each assigned
  to its own static `.subsection` container id; the four `render*` callers
  now do the assignment and call `applySubtabState()` once. Card *internals*
  were never split apart — only whole existing cards were redistributed to
  their closest-matching sub-tab. Judgment calls worth flagging:
  - **Fundamentals** (Business quality / Financial quality / Cash flow /
    Capital allocation / Historical financials / Key metrics): mapped from
    DuPont+ROCE cards, Earnings quality card, the 10Y Cash Flow/Balance
    Sheet/P&L tables, and Working-capital ratios + Shareholding pattern
    respectively — there's no 1:1 source for "Capital allocation" or "Key
    metrics" specifically, so those two absorbed the closest-fit leftover
    cards (10Y Balance Sheet, and Working-capital+Shareholding).
  - **Valuation** (Overview / DCF / Reverse DCF / Sensitivity / Relative
    valuation / Historical valuation): the DCF card's embedded sensitivity
    table and reverse-DCF stat were pulled out into their own cards (same
    markup, no new computation) since Sensitivity and Reverse DCF are each
    their own sub-tab now. The Recommendation summary card is shown on all
    5 detail sub-tabs (not Overview) via a multi-id
    `data-subtab="dcf reverse-dcf sensitivity relative-valuation historical-valuation"`
    panel rather than duplicating it 5 times. The company pill-selector
    stays persistent (outside any `.subsection`) since it's an orthogonal
    "which company" control, not a section.
  - **Technicals** (Trend / Momentum / Volume / Relative strength /
    Volatility / Signals): the 4 existing deep-dive cards (Indicators,
    Multi-timeframe trend, Advanced scores, Volume profile) don't map 1:1 to
    6 sub-tabs, so each whole card went to its closest single match
    (Indicators→Momentum since MACD is its primary momentum read,
    Multi-timeframe→Trend, Advanced scores→Signals, Volume profile→Volume)
    rather than fragmenting any card's internals; Relative strength and
    Volatility are table-column-only sub-tabs.
  - **Risks** (Overview / Financial / Business / Market / Sector /
    Governance): the only clean 1:1 mapping in this feature —
    `riskDetailContent()` already returned exactly 5 cards in Financial/
    Business/Market/Sector/Governance order.

### Validation completed

Launched `node server.mjs` (an already-running instance on :4173 was reused
— `server.mjs` reads files fresh from disk per request, so it already
reflected the edits) and drove it headlessly with `playwright-core` against
the system's installed Chrome (`channel: 'chrome'`, no browser binary
download needed):

- **All 10 target tabs** show the expected sub-tab count and labels; the
  first sub-tab is active and its panel(s) visible by default on every one.
- **Switching works everywhere**: clicked the last sub-tab on each of the 10
  tabs and confirmed its panel became visible while the first sub-tab's
  panel(s) hid — verified programmatically (`hidden` attribute state), not
  just visually.
- **Session persistence**: selected "Reverse DCF" on Valuation, switched to
  Dashboard and back — Valuation restored to "Reverse DCF", not its default.
- **Sticky positioning**: on Technicals, scrolled 900px — the sub-tab bar's
  top edge tracked exactly to the header's bottom edge (`barTop ===
  headerBottom`), confirming `position:sticky` against `--header-h` is
  working, not just floating at the top of the document.
- **Keyboard navigation**: focused the first Dashboard sub-tab button,
  pressed ArrowRight — focus and selection moved to the second button
  ("KPI ribbon").
- **Mobile (390px viewport)**: both the main tab bar and the new sub-tab bar
  scroll horizontally instead of wrapping or breaking layout; buttons stay
  touch-sized.
- **Console errors**: none from this feature. One `favicon.ico` 404 appeared
  intermittently — confirmed pre-existing and unrelated (`server.mjs` has no
  favicon route and wasn't touched by this change; reproduced the same 404
  directly with `curl` against `/favicon.ico`).
- **No extra network requests**: sub-tab switching is a pure `hidden`
  attribute toggle on already-rendered DOM (`applySubtabState`); nothing in
  it calls `fetch` or touches `currentData`.
- `node --check script.js` and `node --check server.mjs` both pass.
- Screenshots taken during validation (Dashboard/KPI ribbon, Risks/Financial
  deep-dive, mobile Fundamentals) visually confirm pill styling, active-state
  highlight, and layout match the existing design language.

### Remaining work / deferred improvements

- None identified. This was scoped as a navigation-only enhancement (per the
  request) — no new metrics, data sources, or visual redesign were
  introduced, and none of the mapping judgment calls above required
  inventing data that doesn't already exist elsewhere in the app.

## 2026-08-14 — Phase 3d: institutional research reporting engine

### Objective

Phase 3c's autocomplete work explicitly scoped out and deferred the reporting
layer (see that entry's "Reporting layer: not started" below). This phase
builds it per the brief: a single-page, per-company institutional research
report generated entirely from the existing analytics engines (valuation,
recommendation, technical, portfolio, risk, relative valuation, data quality)
-- no calculation duplicated -- viewable as an interactive HTML page and
exportable as a print-quality A4 PDF. Two constraints were confirmed with the
user before implementation: (1) **zero new dependencies** -- this project has
no `package.json`/npm/build step anywhere, so no PDF library, no chart
library and no server-side rendering were introduced; and (2) **true
WYSIWYG** -- PDF export is the browser's own `window.print()` on the exact
DOM/CSS already on screen, one HTML structure and one stylesheet throughout,
`@media print` making only the minimal adjustments printing itself requires.

### Implementation status: done

- **Report model** (`data/reporting/researchReport.mjs`, new):
  `buildCompanyReport(research, symbol)` is pure selection/derivation over an
  already-built `buildResearch()` payload for one company -- every figure is
  read straight off the unified research model (`dcf.mjs`,
  `financialValuation.mjs`, `relativeValuation.mjs`, `technicalScorecard.mjs`,
  `institutionalRisk.mjs`, `scoringEngine.mjs`, `metricsTable.mjs`,
  `companyNews.mjs`); nothing is recomputed. The one new read is a single
  `companyCache.read(symbol)` (the same on-disk cache `research.mjs` itself
  populates, `data/watchlist/diskCache.mjs`) to pull the raw weekly price
  series for the price/valuation-band chart -- not a new network call, a
  second read of data already fetched for the dashboard. Produces the 11
  sections from the brief (cover, executive summary, investment thesis,
  metrics dashboard, valuation analysis, financial quality, technical
  outlook, risk analysis, peer comparison, catalysts, final verdict),
  including a small set of genuinely new presentational derivations with
  their own `metricRegistry.mjs` entries (all tagged `heuristic`):
  **investment horizon** (fixed 12 months, inherited from the existing
  Target Price model's own documented one-year-forward methodology, not an
  independent estimate), **ideal entry zone** (Bear-to-Base fair-value band
  from whichever valuation model resolved), **risk-reward summary** (upside
  to target vs. downside to the Bear case), **why own / why avoid** bullets
  (generated directly from the unified recommendation engine's own 5 bucket
  scores and labels -- a bucket at/above 60 is a positive bullet, below 40 a
  drag, no new thresholds beyond what `scoringEngine.mjs` already applies),
  and one synthesized **technical catalyst** row (regime/signal-confidence,
  timeline "Ongoing", never a fabricated date). A small number of
  Improving/Stable/Deteriorating trend indicators on the metrics dashboard
  reuse existing directional reads only where one already exists
  (`institutionalRisk.riskTrend`, the debt-trend figure inside
  `institutionalRisk.financial`, `promoterHoldingTrend`'s sign) or a
  first-to-last-point read over an already-parsed real time series (revenue,
  profit, operating margin, ROCE) -- metrics with no such series render no
  indicator rather than a fabricated one.
- **Server route** (`server.mjs`): `GET
  /api/watchlists/:id/report/:symbol`, cache-only (`networkPass: 'none'`,
  same pattern as the existing `.../research` route) -- opening a report
  never triggers a fetch, it reports on whatever the dashboard already has
  cached for that company. 404 with a disclosed reason for an unknown symbol
  or one with no cached data yet.
- **Report page** (`report.html` + `report.js`, new, sibling static files to
  `index.html`/`script.js`): a dedicated institutional "paper" theme
  (white background, navy masthead/headers, one gold accent, Georgia
  headlines over an Arial body -- no external fonts) deliberately distinct
  from the dashboard's dark terminal workspace, per the brief's Bloomberg/
  Morgan Stanley/Goldman Sachs research-note styling request -- real IB
  research PDFs are white-paper documents, not dark-themed. All CSS lives
  inline in `report.html`'s `<style>` (not a linked file), which is what
  makes "Download standalone HTML" trivial: the export is just the
  already-rendered document serialized as-is. The 10 body sections are
  native `<details open>` elements (collapsible for on-screen scanning, zero
  JS needed for the toggle itself); the cover masthead sits outside the
  collapsible set. Charts are hand-written inline SVG (one shared
  `sparklineSvg()` line-chart helper for the 5 time-series charts --
  price, revenue, profit, operating margin, net margin -- plus a CSS
  absolute-position Bear/Base/Bull valuation band reusing the main
  dashboard's existing `.band`/`.band-marker` convention, and a plain
  colored-table-cell risk heat map labeled numerically so it stays readable
  in grayscale) -- no chart library. Every displayed metric with a
  `metricRegistry.mjs` entry carries a small Sourced/Calculated/Heuristic
  badge with the full methodology in a native `title` hover tooltip.
- **WYSIWYG mechanics**: one HTML structure and stylesheet throughout;
  `@media print` only changes page geometry (`@page{size:A4;margin:0}`,
  the `.a4-sheet`'s own width/padding is otherwise identical on screen and
  in print), hides the screen-only toolbar, and adds
  `break-inside:avoid`/`page-break-inside:avoid` on KPI tiles, cards, chart
  containers and table rows. `print-color-adjust:exact` is set so tag
  colors/heat-map cells/chart fills survive printing (still requires the
  browser's own "print backgrounds" option to be enabled -- outside what
  CSS/JS can force, documented in Known limitations). **A real bug was found
  and fixed during validation**: a collapsed `<details>` section must still
  print in full, but current Chromium renders closed `<details>` content
  through an internal `::details-content` box rather than a plain
  `display:none` on a child element, so a same-specificity CSS override
  couldn't reliably reach it. Fixed with the standard, documented pattern
  (MDN/web.dev) instead of fighting the CSS internals: `beforeprint`/
  `afterprint` window-event listeners in `report.js` force every
  `.section` open for the print lifecycle and restore the prior state
  afterward -- fires identically whether printing is triggered by the
  toolbar's Print button or the browser's own Ctrl+P/File>Print, so no
  manual re-expansion is ever required before printing, per the brief.
  Verified live (Playwright): dispatching `beforeprint` on a page with one
  section manually collapsed forces it open (confirmed via a full-page print-
  media screenshot showing that section's content in full); dispatching
  `afterprint` restores the collapsed state on screen.
- **Export**: "Print / Save as PDF" calls `window.print()` directly on the
  live page -- no server rendering, no PDF library, the OS print dialog's
  "Save as PDF" is the actual PDF output. "Download HTML" clones the live,
  already-rendered `document.documentElement`, strips the screen-only
  toolbar and the `<script src="report.js">` tag, and serializes
  `outerHTML` into a downloaded file -- fully self-contained (inline CSS,
  no external references), same `Blob`/`<a download>` pattern the app's
  existing watchlist Export button already uses.
- **Entry point** (`script.js`): a new document-icon "Report" row action in
  the Watchlists tab's company table (next to the existing per-row
  Refresh/Remove actions), disabled for a company with no cached data yet,
  opening `report.html?wl=<id>&symbol=<symbol>` in a new tab via the
  existing `#wl-table tbody` click-delegation handler.

### Validation completed

- `node --check` passed for every new/modified `.mjs` file and both new
  browser-side files (`report.js`, `script.js`).
- Direct `buildCompanyReport()` calls (cache-only, no server) against one
  company from each of Banking (HDFC Bank -- financial-sector valuation
  path), Power (NTPC -- DCF path), Defence (HAL -- DCF path) and Core
  Portfolio (TCS, IT -- DCF path, the "mixed" watchlist): every field
  resolved with a sane value or an explicit N/A/unavailable reason, zero
  `undefined`/`NaN` anywhere in any of the four payloads. HDFC Bank
  correctly routed through `financialValuation` (not `dcf`) end-to-end
  across every section that touches valuation; its Financial Quality
  revenue-trend/operating-margin-trend charts correctly render "no data"
  (Screener has no "Sales"-labeled P&L line for a bank, the same class of
  data-source gap already documented app-wide) rather than fabricating a
  series -- ROE/interest-coverage/peer-comparison for the bank all resolved
  correctly regardless.
- Live HTTP: `GET /api/watchlists/{banking,power,defence,core-portfolio}
  /report/{symbol}` for the four companies above, confirmed 200 with the
  correct primary valuation model per company and, separately, confirmed
  each company's on-disk cache `fetchedAt` timestamp was byte-identical
  before and after the request -- the route never triggers a fetch.
- Full Playwright walkthrough (headless Chromium) against the running dev
  server: all four report pages render 1 masthead + 10 collapsible sections
  with real data and zero console errors/warnings; manually collapsing a
  section and then dispatching `beforeprint` force-opens it (screenshotted
  under emulated print media showing the section's full content), and
  `afterprint` restores the collapsed screen state; clicking "Print / Save
  as PDF" invokes `window.print()` with zero console errors; clicking
  "Download HTML" produces a real file which, reopened directly in a fresh
  page (`file://`), renders all 10 sections with the toolbar correctly
  stripped, zero console errors, and **exactly one network request total**
  (the file itself) -- confirming the export is genuinely self-contained.
  The new "Report" row action was also exercised end-to-end from the actual
  Watchlists-tab UI (not just direct URL navigation): clicking it for a real
  company opened `report.html` in a new tab with the correct
  watchlist/symbol query params and a correctly rendered title, zero
  console errors on the originating dashboard tab.
- **One real bug found and fixed during this validation pass**: the
  `financialQuality` section's `marginTrend` initially kept `margins.mjs`'s
  raw `[period, value]` tuple shape instead of being mapped to
  `{period, value}` objects (unlike the adjacent `revenueTrend`/
  `profitTrend`, which were mapped correctly) -- the chart renderer silently
  filtered every point out, so operating/net margin trend charts rendered
  "no data" for every company, including ones (e.g. NTPC) with a full,
  real 13-year margin series. Caught by visually inspecting a rendered
  screenshot rather than only checking for `undefined`/`NaN`, since the
  bug produced a valid-looking empty state, not a crash. Fixed in
  `researchReport.mjs` and reverified live.

### Known limitations (new in this phase, by design)

- Screen pagination is intentionally not paged-media-simulated: the report
  renders as one continuously-scrolling A4-width sheet on screen (no fake
  page-break lines drawn), and page cuts only become visible in the
  browser's own Print/Print Preview surface when `window.print()` is
  invoked -- a paged-media JS polyfill would be required to draw exact page
  boundaries on screen ahead of time, which the zero-dependency constraint
  rules out. This is standard behavior for any printable web page, not a
  deviation introduced here.
- `print-color-adjust:exact`/`-webkit-print-color-adjust:exact` are set, but
  whether tag/heat-map/chart background colors actually survive a specific
  print or Save-as-PDF job still depends on the browser's own "print
  backgrounds" option being enabled -- outside anything CSS or JS in the
  page can force.
- EV/EBITDA is shown as explicitly unavailable on the report's Metrics
  Dashboard, the same pre-existing app-wide limitation (no Cash/Net-Debt
  data source) already disclosed everywhere else in this app.
- Revenue/profit/margin trend charts render "no data" for any company whose
  fundamentals provider doesn't expose a "Sales"-labeled P&L line under this
  app's Screener-label mapping (observed for banks) -- a pre-existing
  data-source characteristic, not something this phase's chart code can
  work around without fabricating a series.

### UI changes

- New document-icon "Report" action in the Watchlists tab's per-row actions
  (`script.js`/`styles.css`'s existing `.icon-btn` pattern) -- opens the new
  standalone report page in a new tab.
- Two new static files served alongside the existing app: `report.html`,
  `report.js`. No changes to the main dashboard's tabs, layout or styling.

### Repository governance

Three new additive files (`data/reporting/researchReport.mjs`,
`report.html`, `report.js`), one new server route, a handful of new
`metricRegistry.mjs` entries and one new row-action button -- no existing
analytics module was modified, no new authoritative documentation was
created, and nothing was found to be obsolete by this pass.

### Remaining Phase 3 items (unchanged, carried forward)

Everything already carried forward in the Phase 3c entry directly below
(sector-risk lookup should also match `industry`; `PGCIL.NS` ->
`POWERGRID.NS`; fetch-failure vs. never-fetched UI state; a minimal
automated test layer for the pure-math modules; dedupe the debt-trend
calculation; extract one shared `groupBySector()`; delete dead
`pearsonCorrelation`; `card()` auto-escaping; `pctAbs()` formatter batch) is
unchanged and still pending -- none of it was in scope for this pass.

## 2026-08-14 — Phase 3c: institutional autocomplete search (P0), reporting layer scoped

### Objective

Phase 3b shipped the dedicated Watchlists tab but kept the original
"Add a company" box: a 250ms-debounced call to `/api/companies/search`
(Yahoo's public symbol-search endpoint) on every keystroke, no keyboard
navigation, no duplicate marking before you actually tried to add, and
results that only showed name/ticker/exchange. The brief called this out
as a P0 usability gap and asked for a Bloomberg/FactSet/Capital IQ/
TradingView-style real-time typeahead instead: instant per-keystroke
ranking, sector/industry/exchange on every result, full keyboard/mouse
support, and duplicate prevention with an in-dropdown "Already in
watchlist" state — built local-first so it never depends on a network
round trip while typing. Implemented that in full; the reporting-layer
half of the brief (executive memo, thesis, target price rationale,
catalysts/risks, one-page HTML/PDF export) is scoped but not started —
see "Reporting layer: not started" below.

### Implementation status: autocomplete done, validated live

- **Local search index** (`data/universe/nseUniverse.mjs`, `data/
  watchlist/searchIndex.mjs`, new `GET /api/companies/index`): a curated,
  static reference of ~140 well-known NSE tickers (name/sector/industry/
  market-cap tier/common abbreviations — e.g. "SBI" → SBIN.NS, "L&T" →
  LT.NS, "M&M" → M&M.NS) merged at request time with (a) every company
  that has cached fundamentals on disk and (b) every company currently on
  any saved watchlist — both of the latter carry real, Screener-sourced
  `sector`/`industry`, and always win over the static reference's guess
  where they overlap (verified live: the index's RELIANCE.NS/NTPC.NS
  entries match their real cached `fundamentals.classification`, not the
  seed's guess). The frontend fetches this once per session (fired
  concurrently with startup, not on the critical path) and again in the
  background after each successful add, so newly-researched classification
  feeds back into future searches. This is what makes the typeahead local-
  first: `/api/companies/search` (Yahoo network search) is now only a
  150ms-debounced fallback, and only fires when the local pass returns
  fewer than 3 matches.
- **Institutional ranking** (`script.js`): every keystroke re-scores the
  full local index synchronously in the browser (no debounce — sub-
  millisecond over ~150-300 entries) against the brief's priority order —
  exact ticker/alias > exact name > ticker/name prefix > word-start-within-
  name or alias > substring in name/ticker/alias > substring in sector/
  industry — with boosts for market-cap tier, "already researched
  locally" and this browser's own selection frequency (persisted in
  `localStorage`, nudges companies you actually pick above ones you don't
  over time). Verified against every example in the brief: "R"→"Re"→
  "Rel"→"Reli"→"Relia" narrows monotonically to Reliance Industries alone;
  "Tata" surfaces Tata Power/Steel/Motors/Consumer/TCS in that order;
  "HDFC", "Power" and "Bank" all return the expected company sets; "SBI",
  "L&T" and "M&M" resolve via their alias entries.
  Sector/industry/tier from the local index are display-only — never sent
  in the add-company payload — so the existing "never guess sector/
  industry, only the first real fetch resolves it" contract (`store.mjs`'s
  `addCompany`/`updateCompaniesMetadata`) is unchanged; the typeahead is
  purely a discovery aid.
- **Result display**: each suggestion row shows Company name, NSE ticker,
  Sector, Industry and Exchange (grid layout, sector/industry columns
  collapse under 700px so mobile keeps name/ticker/action visible).
- **Keyboard**: Up/Down moves the highlighted row (wraps), Enter adds the
  highlighted company, Escape closes the dropdown, Tab also accepts the
  highlighted company (Bloomberg-style accept-and-continue) rather than
  just blurring the field — keeps rapid repeated entry going without a
  mouse.
- **Mouse/touch**: hover highlights a row (mouse and keyboard highlight
  share the same `.active` state/scroll-into-view, so switching input
  methods mid-search stays consistent); click adds; the dropdown scrolls
  natively for long result sets; click-away closes it.
- **Duplicate prevention**: rows already in the active watchlist render
  dimmed with an "Already in watchlist" badge and are excluded from
  Enter's add action (a notice shows instead, same highlight-the-existing-
  row behavior the old post-add duplicate check already had) — verified
  live end-to-end: adding HAL to an empty scratch watchlist, then
  searching "HAL" again, shows it disabled with the badge; Enter shows the
  notice and leaves the company table at 1 row, not 2.
- **Workspace placement**: the add-company box moved out of the "Watchlist"
  management card into its own full-width bar, `position: sticky` pinned
  just under the real header (`--header-h` custom property, kept in sync
  with the header's actual rendered height via a resize listener rather
  than a guessed pixel value, since the header's own height changes with
  viewport width) — so it stays visible while scrolling the company table,
  satisfying "always visible, optimized for rapid repeated entry."

### Validation

Live Playwright run against the dev server (not just `node --check`):
progressive local narrowing on every keystroke with zero network calls
until the &lt;3-result fallback path; multi-word/sector queries (Tata,
HDFC, Power, Bank); full keyboard flow (type → ArrowDown ×2 → Enter added
the correct highlighted row, input cleared and stayed focused); duplicate
detection (disabled row, badge, blocked re-add, correct notice copy);
Escape-closes-dropdown; mouse hover-then-click add. Zero console
errors/warnings across the entire run. Test interactions ran against the
scratch "Test" watchlist (and were reverted via the same DELETE endpoints
afterward) specifically so validation never left residue in the real
Defence/Core Portfolio/Banking/Power data.

### Reporting layer: not started

The brief's second half — executive investment memo, investment thesis,
target price rationale, key catalysts/risks, earnings outlook, peer
comparison, valuation conclusion and a one-page HTML/PDF export reusing
the existing analytics (no duplicated calculations) — has not been
started. Flagging explicitly rather than shipping a partial version: it's
a distinct, similarly-sized feature (a new report-composition layer over
`data/analytics/*`, plus a print/export surface) and deserves its own
scoped pass rather than being squeezed in under an already-large
autocomplete rewrite.

## 2026-08-14 — Phase 3b: institutional Watchlists workspace, relative valuation/technical/portfolio calibration

### Objective

Per the Phase 3b brief: (1) extract the watchlist-management UI (create/
rename/duplicate/delete/add-remove-reorder-company/weight) out of the header
— where it sat above every tab, Dashboard included — into a dedicated,
full-screen **Watchlists** tab, so the Dashboard becomes a clean research/
analytics surface; and (2) deepen three existing analytics engines (relative
valuation, technical scorecard, portfolio analytics) with new institutional-
style metrics. Scoped and executed the same way Phase 2 was: one
implementation pass across the data layer, `node --check` + live
`buildResearch()` + live HTTP + a full Playwright walkthrough, every new
metric tagged Sourced/Calculated/Heuristic, zero new network calls, cache-
first startup and incremental refresh preserved throughout.

### Implementation status: done

- **Watchlists tab** (`index.html`, `script.js`, `styles.css`): a new
  second nav tab, full-bleed width (`#main.full-bleed`, toggled by the
  tab-switch handler — every other tab keeps the existing 1500px reading
  width). Contains a portfolio summary panel (total companies, sector
  allocation/diversification score reusing `sectorAllocation()`, average
  valuation/quality/risk, cash allocation, a concentration warning reusing
  the existing >40%-one-sector flag), the watchlist CRUD toolbar (switch/
  create/rename/duplicate/delete, relocated from the header unchanged) plus
  two new actions (**Export** — client-side `Blob`/`<a download>` of the
  watchlist's own persisted company fields, no new route; **Import** — file
  picker posting the same shape to a new route), a cash-target % input, the
  relocated add-company autocomplete, and the company table: leads with
  Company/Sector/CMP (Rs.)/P/E per the existing house standard, then
  Recommendation/Confidence/Weight %/Market Cap/ROE/ROCE/Growth/Risk/Last
  Updated/Notes/Actions. Adds, for the first time in this app: **client-side
  column sort** (3-state cycle per header: asc/desc/off, off falls back to
  the watchlist's own saved order so the up/down reorder buttons stay
  meaningful), **sector/recommendation filters + free-text search**, **row
  multi-select** with a bulk bar (Refresh selected / Remove selected — bulk
  refresh is one `POST .../refresh` call with a `symbols` array, bulk remove
  loops the existing single-company DELETE endpoint; no new bulk routes),
  **per-row notes** (inline text input, `change`-event-only so it doesn't
  spam the API on every keystroke) and **per-company refresh** (see below).
  The 20-company soft cap changed from a 6-second toast to a **persistent
  banner** (shown whenever the active watchlist exceeds 20 companies) with
  the brief's exact copy — still non-blocking, no hard limit anywhere.
  The header shrinks to title/status/a passive watchlist `<select>`/
  "Refresh Data" — kept, not moved, since every other tab still needs to
  know which watchlist it's showing and be able to trigger a refresh
  without a trip to the Watchlists tab first; both selects stay in sync via
  one shared `renderWatchlistSelect()`.
- **Cash allocation** (`data/watchlist/store.mjs`, `data/analytics/
  portfolio.mjs`): this app had no concept of un-invested cash before this
  phase — `resolveWeights()` always normalized company weights to sum to
  100%. Added an optional, user-entered, watchlist-level `cashTargetPct`
  (default 0 for every pre-existing watchlist file, read-time-defaulted in
  `readWatchlistFile()` rather than migrating files on disk) that
  `resolveWeights(companies, cashTargetPct)` now normalizes the *invested*
  company weights against (`100 - cashTargetPct`) instead of always 100 —
  same "illustrative allocation, not real holdings" disclosure the rest of
  portfolio weighting already carries. New `PUT .../cash-target` route/
  `store.setCashTarget()`.
- **Per-company targeted refresh** (`server.mjs`, `data/watchlist/
  research.mjs`): `POST .../refresh` now accepts an optional `symbols`
  array; `buildResearch(watchlist, { networkPass, forceSymbols })` force-
  fetches exactly those symbols regardless of staleness while every other
  company in the watchlist follows the normal none/incremental/full rule —
  a targeted refresh, not a full watchlist refetch. Verified live: forcing
  a single symbol updates only that company's `fetchedAt`.
- **Notes and Import** (`data/watchlist/store.mjs`, `server.mjs`):
  `notes` already existed on the company record (unused since the original
  watchlist-workspace phase) — added `setCompanyNotes()`/`PUT .../notes`.
  `importWatchlist()` mirrors `createWatchlist()`'s id-collision/slugify
  handling but accepts a pre-populated company list (the same shape Export
  produces) instead of resolving companies one at a time through the
  autocomplete/duplicate-check flow; invalid entries (no symbol) are
  dropped rather than failing the whole import.
- **Relative valuation refinement** (`data/analytics/relativeValuation.mjs`,
  rewritten as a two-pass module — pass 1 per-stock comparison/scores, pass
  2 rankings/percentiles that need every sector-mate's pass-1 result
  already resolved): **sector-adjusted valuation rank** (rank within sector
  by premium/discount vs. sector-median P/E-P/B-PEG, cheapest first —
  distinct from the existing ROCE/ROE-based sector rank); **multi-factor
  peer score/rank** (disclosed Value 40% / Quality 35% / Growth 25% blend of
  within-sector percentile ranks, via `percentileRank` from
  `priceSeries.mjs`); **valuation dispersion** (mean/median/std-dev/min/max/
  coefficient-of-variation of P/E per sector, new watchlist-level
  `data.valuationDispersion`, surfaced in a new Valuation-tab card);
  **historical premium/discount bands** (reuses the per-fiscal-year implied-
  P/E `history` array `historicalPercentiles.mjs` already built for the
  percentile read — previously only `.percentile` was consumed — to derive
  min/25th/median/75th/max of the stock's *own* historical P/E and where
  today's sits in it); **sector-normalized valuation score** (a continuous
  z-score of P/E-P/B-PEG vs. sector peers, distinct from the existing
  coarser beat/miss-the-median score); **watchlist percentile ranking**
  (percentile of "cheapness" across the full watchlist); **relative
  attractiveness score** (disclosed average of the three scores above — one
  headline figure). All surfaced on the existing Valuation-tab deep-dive
  card (extended, not a new panel).
- **Technical engine enhancement** (`data/analytics/
  technicalScorecard.mjs`): **ADX interpretation** (standard Wilder bands:
  No trend/Developing/Strong/Very strong trend); **ATR% normalization**
  (`atrPct`, previously only used internally inside `volatilityScore`'s
  formula, now its own labeled cross-stock-comparable field); **volume
  profile support/resistance read** (`priceVsPointOfControl`); **multi-
  timeframe confirmation** (`confirmationCount`/`confirmationStrength`
  added to the existing daily/weekly/monthly alignment read); **5 new
  0-100 scores** — volume-weighted momentum, trend persistence (R² of a
  trailing-50-close OLS fit — a real statistic, not invented), breakout
  quality (volume + ADX confirmed, stricter than the existing breakout
  probability), volatility-adjusted momentum (a Sharpe-ratio-style read),
  institutional accumulation (OBV/A-D trend + DI+ dominance + up-day volume
  share); **technical regime classification** (rule-based label: Strong/
  plain Uptrend/Downtrend, Range-bound, Volatile Breakout, Mixed); **signal
  confidence** (High/Medium/Low, same "completeness + corroboration"
  pattern as the DCF/recommendation confidence bands); **relative strength
  percentile** (watchlist-wide `percentileRank` of the existing relative-
  strength figure, computed as a second pass in `research.mjs` alongside
  the relative-valuation pass, same reason — needs every stock's figure
  resolved first). Zero new network calls — every input is the daily OHLCV/
  weekly price history already fetched. Main Technical table gained one new
  compact "Regime" column (per the project's own stated precedent of
  keeping that table curated); every other new score/label lives in the
  deep-dive panel's 2 new cards ("Advanced scores," "Signal confidence &
  regime").
- **Portfolio analytics calibration** (`data/analytics/portfolio.mjs`,
  `correlation.mjs`, `scenarios.mjs`): **portfolio beta** (weighted average
  of each holding's already-computed beta); **risk-adjusted return**
  (per-stock proxy Sharpe ratio — `(trailing-1y return − the disclosed
  per-market risk-free-rate assumption already used by the DCF/WACC model)
  ÷ annualized realized volatility` — an approximation, not a rolling/
  ex-ante Sharpe, weight-aggregated to portfolio level); **sector
  contribution** (each sector's weight share and weight-normalized
  contribution to the portfolio quality/risk scores); **position
  (marginal) risk contribution** (a real portfolio-variance decomposition —
  `contribution_i = w_i·σ_i·(Σ_j w_j·σ_j·ρ_ij) / portfolioVolatility`,
  normalized to % of total — not invented, the standard formula, limited to
  symbols the correlation matrix itself could resolve); **quality/valuation
  attribution** (generic weighted-deviation-from-mean attribution — which
  holdings pull a portfolio score up vs. down — applied once to the quality
  score and once to the valuation score, top-3 positive/negative
  contributors each); **factor exposure** (5 disclosed in-house percentile
  tilts — Value/Growth/Quality/Momentum/Size — each a within-watchlist
  percentile of an already-computed metric, weight-aggregated; explicitly
  labeled not a commercial Barra/Axioma-style factor model); **rolling
  correlation + correlation stability** (`correlation.mjs`: recent ~26-week
  vs. full-history average pairwise correlation, reusing the already-
  `prepareSeries`'d arrays sliced rather than re-parsed — preserves the
  Phase 2 correlation-matrix perf fix; stability = 100 − average absolute
  per-pair delta between the two windows). **Scenario set recalibrated to
  the brief's exact 5 names** (`scenarios.mjs`, rewritten): Interest-rate
  shock (now also weighted by interest coverage, not leverage alone),
  Sector rotation (unchanged), Earnings recession (renamed/deepened from
  "slowdown," now also weighted by earnings-quality score), Market drawdown
  (renamed from "market correction," now scaled by each stock's own real
  historical max-drawdown severity as well as beta), and a new **Currency
  shock** (replaces the old Commodity shock — a static, sector-keyword-
  matched USD-revenue-exposure heuristic, same lookup-table style/location
  as `institutionalRisk.mjs`'s existing sector-risk rules: export-heavy
  sectors like IT/Pharma benefit from rupee depreciation, import-heavy
  sectors like Oil & Gas/Metals/Auto are hurt by it, unmatched sectors
  default to neutral). All new portfolio figures surfaced via 6 new
  Portfolio-tab sections (Sector contribution, Position risk contribution,
  Factor exposure, Quality attribution, Valuation attribution, and a
  Rolling correlation sub-section under the existing correlation-matrix
  card) plus 2 new KPI tiles (Portfolio beta, Risk-adjusted return).
- **Data quality**: every field introduced above got a
  `metricRegistry.mjs` entry (tier + confidence + methodology), rendered
  through the existing `infoIcon()` popover — no new disclosure mechanism.
  `dataLimitations` grew with explicit disclosures for factor exposure
  (not a commercial factor model), currency-shock direction/magnitude
  (static keyword heuristic), rolling correlation/position-risk-
  contribution's shared price-history coverage constraint, and the
  relative-valuation additions' same watchlist-scoped-peer-universe
  limitation the existing sector median/leader figures already carry.

### Validation completed

- `node --check` passed for every new/modified `.mjs` file and `script.js`.
- Direct `buildResearch()` calls (cache-only) against all 4 seeded
  watchlists (Core Portfolio, Banking, Power, Defence): every new field
  resolves with a sane value or an explicit null/"not available" reason —
  no `undefined`/`NaN` anywhere in any payload; spot-checked portfolio beta
  (1.07–1.5 across watchlists), rolling correlation (recent vs. long-run
  pairs sensibly diverge, e.g. Power's recent 0.445 vs. long-run 0.902
  during a period the sector's pairwise correlation compressed), sector
  contribution, position risk contribution (rows sum to ~100%), the 5
  recalibrated scenario labels, and per-stock regime/signal-confidence/
  relative-attractiveness/historical-band fields.
- Live HTTP validation against a running server: `PUT .../cash-target`
  (confirmed effective weights renormalize to the invested portion, e.g.
  10% cash → weights summing to 90%), `PUT .../companies/:symbol/notes`,
  `POST .../refresh` with a `symbols` array (confirmed only the targeted
  company's `fetchedAt` advances), `POST /api/watchlists/import` (round-
  tripped a 2-company export payload into a new watchlist, then deleted
  it), all exercised and reverted afterward.
- Full Playwright walkthrough (headless Chromium; desktop 1400px, a 1800px
  pass specifically to verify full-bleed against the 1500px base container
  cap, and a 480px mobile pass) against the running server, 14 scenarios
  covering: header simplification; nav/tab order; the Watchlists tab's
  summary panel, toolbar, table columns, sort/filter/search, multi-select
  bulk actions, per-row refresh, notes persistence; Dashboard confirmed
  free of management controls; the new Valuation dispersion card and
  relative-valuation deep-dive fields; the Technical table's new Regime
  column and deep-dive's new cards; all 6 new Portfolio sections plus the
  2 new KPI tiles and the 5 recalibrated scenario names; watchlist-
  switching sync between the header and Watchlists-tab selectors; mobile
  horizontal-scroll containment (tabs and the company table scroll within
  themselves, page body does not). **14/14 passed, zero console
  errors/warnings across the entire walkthrough.** One test artifact (a
  notes-persistence check left a note on a Defence-watchlist company) was
  found and cleared afterward; no other state changes were left behind.

### Known limitations (new in this phase, by design)

- Factor exposure (Value/Growth/Quality/Momentum/Size) is an in-house
  within-watchlist percentile tilt over already-computed metrics — not a
  commercial risk-factor model (Barra/Axioma-style) and not benchmarked
  against a market-wide factor universe, since this app has no such data
  source.
- Currency shock direction/magnitude is a static, sector-keyword-matched
  exposure heuristic (same style as the existing sector-risk lookup), not a
  disclosed FX hedge position or revenue-mix figure — no company exposes
  that data on this app's sources.
- Risk-adjusted return is a proxy Sharpe ratio using trailing-1y *price*
  return only (not a full return series or total return including
  dividends) against a fixed, disclosed per-market risk-free-rate
  assumption — not a rolling or ex-ante Sharpe ratio.
- Rolling correlation, correlation stability and position-level marginal
  risk contribution share the same ~1-2 year weekly-price-history coverage
  constraint the correlation matrix already had — unavailable or degraded
  for recently-listed stocks or Global-watchlist entries.
- All new relative-valuation rankings/percentiles/dispersion remain
  watchlist-scoped peer comparisons, the same root constraint the pre-
  existing sector median/leader/`industryPe` figures already carry — a
  single-member sector legitimately produces N/A for the peer-relative
  fields (verified live: a lone-in-sector stock's multi-factor peer score
  and sector-normalized score both render N/A rather than a degenerate
  100/0).
- Cash allocation is an optional, user-entered target the invested company
  weights normalize against — not a real cash balance, and not swept into
  any portfolio-value or scenario-impact calculation beyond reducing the
  invested weight base.

### UI changes

- New **Watchlists** tab (2nd, after Dashboard) — see Implementation status
  above. Header shrinks from a 4-row toolbar/add-company/notice/manage-
  panel stack to a single row (title, status, watchlist select, Refresh
  Data).
- Dashboard unchanged in content (it already matched the brief's required
  block list before this phase) — it simply gains the vertical space the
  header used to occupy.
- Valuation tab: one new "Sector valuation dispersion" card; the existing
  Relative valuation deep-dive card gained a second stats row and a
  historical-band line.
- Technical tab: one new "Regime" column on the main table; two new cards
  on the deep-dive panel.
- Portfolio tab: two new KPI tiles; six new sections (Sector contribution,
  Position risk contribution, Factor exposure, Quality attribution,
  Valuation attribution, Rolling correlation).

### Repository governance

No new authoritative documents created. No files found to be obsolete by
this pass — every change extends an existing module/file; `archive/` and
`docs/reports/` untouched.

### Remaining Phase 3c items (unchanged, carried forward)

Everything already carried forward in the Phase 3a entry below (sector-risk
lookup should also match `industry`; `PGCIL.NS` → `POWERGRID.NS`; fetch-
failure vs. never-fetched UI state; a minimal automated test layer for the
pure-math modules; dedupe the debt-trend calculation; extract one shared
`groupBySector()`; delete dead `pearsonCorrelation`; `card()` auto-escaping;
`pctAbs()` formatter batch) is unchanged and still pending — none of it was
in scope for this pass.

## 2026-08-13 — Phase 3a: analytical integrity (sector-aware valuation engine, unified recommendation engine)

### Objective

Resolve the two P0 findings from the Phase 2 institutional audit entry directly
below: (1) DCF has no sector gate and produces a spurious fair value for
banks, and (2) the Rating/compositeScore that drives every Buy/Hold/Sell tag
has zero visibility into any Phase 2 signal (institutional risk, DCF,
technical scorecard, relative valuation). This entry scopes wider than that
audit's own Phase 3a plan (which deferred folding signals into
`compositeScore` to an explicitly-reviewed Phase 3b) — implemented per an
explicit, detailed go-ahead this session that asked for the full unified
engine now, not a display-only "signal conflict" flag. Correctness/
consistency fixes only: no new tabs, no new navigation, no expanded
authoritative documentation.

### Implementation status: done

- **Sector-aware valuation engine** (`data/analytics/financialValuation.mjs`,
  new; `data/watchlist/research.mjs`): `isFinancialSector(sector, industry)`
  regex-matches Screener's own sector/industry classification
  (`bank|nbfc|non-banking financial|insur|financ|asset management`) —
  verified against every India company in this app's cache: matches all 8
  Banking-watchlist stocks (sector `Financial Services`) and produces zero
  false positives against Power, Oil & Gas, Information Technology and
  Capital Goods sectors already in cache. Matched stocks get `dcf: {
  available: false, sectorExcluded: true, reason: 'DCF not applicable for
  financial institutions' }` instead of running the levered-FCF model at
  all, plus a new `financialValuation` field: a justified Price-to-Book /
  excess-return valuation (`Justified P/B = (ROE - g) / (Cost of Equity -
  g)`, algebraically the residual-income model expressed as a P/B multiple —
  not two unrelated models bolted together). Cost of Equity reuses the DCF
  model's own CAPM machinery and disclosed per-market risk-free-rate/ERP
  assumptions (`dcfAssumptions()`, unchanged); `g` is the sustainable growth
  rate (ROE × retention ratio from the reported dividend payout ratio,
  falling back to the disclosed terminal-growth assumption when payout is
  unavailable). Never assumes a default beta of 1 (same rule as the DCF
  model) — unavailable beta, book value or ROE each produce an explicit
  `available: false` reason instead of a fabricated fair value.
  - **Numerical-stability bug found and fixed during implementation**: the
    first version only bounded `g` below `Cost of Equity`, which is the
    classic Gordon-growth degeneracy — as `g` approaches Cost of Equity, `(ROE
    - g) / (Cost of Equity - g)` blows up. Live-verified against ICICI Bank:
    produced a fair value of ₹3,715 against a CMP of ₹1,407 (a spurious ~2.6x
    "upside," the same class of defect this phase exists to fix). Fixed with
    two independent bounds: `g` is additionally capped a few points above the
    disclosed terminal-growth assumption (a bank's sustainable growth
    shouldn't be modeled near its own cost of equity), and a minimum 2-point
    Cost-of-Equity/`g` spread is enforced, else the model returns `available:
    false` with a disclosed reason rather than a numerically unstable result.
  - Non-financial sectors are completely unchanged: same 2-stage DCF/WACC/
    reverse-DCF/sensitivity-grid engine, same `dcf.mjs`, zero modifications
    to that file.
- **Unified institutional recommendation engine**
  (`data/scoring/scoringEngine.mjs`, rewritten; `data/scoring/ratings.mjs`
  extended): replaces the Phase 1 flat 12-factor weighted average with a
  5-bucket composite — Quality 35% (the 6 fundamental factors from
  `factors.mjs`: business quality, financial strength, profitability,
  growth, cash-flow quality, balance sheet), Valuation 25% (the existing
  P/E-P/B-yield-PEG-vs-sector factor blended with a margin-of-safety score
  derived from the sector-appropriate valuation model above — DCF or
  financialValuation, whichever resolved), Technical 15% (the technical
  scorecard's trend/momentum/breakout scores, `technicalScorecard.mjs`),
  Risk 15% inverted (100 − the institutional composite risk score,
  `institutionalRisk.mjs`), Relative positioning 10% (vs. sector peers
  within the watchlist, `relativeValuation.mjs`) — renormalized over only
  the buckets that resolve, no artificial neutral default for a missing
  one, same house rule the old model already followed. One engine, computed
  once per stock in `research.mjs`, used everywhere: Dashboard, Valuation,
  Portfolio, Risk, Top Opportunities and every comparison table all read the
  same `stock.recommendation`/`stock.signal` — no other module computes a
  competing rating (confirmed by inspection: the only other rating-shaped
  read anywhere in the app, `stock.valuation.convictionLevel`, now aliases
  `recommendation.confidence` directly rather than recomputing its own band).
  - **Confidence framework** (High/Medium/Low): blends data completeness,
    whether a real intrinsic-value model resolved (DCF or
    financialValuation, vs. only the multiple-based valuation factor), how
    many of the 5 institutional risk categories resolved, earnings
    stability (the business-quality factor, itself a margin/ROCE-stability
    read) and the sector valuation model's own confidence band.
  - **Cross-signal consistency guards**, applied after the tier is computed,
    every cap disclosed in `recommendation.capNote` rather than silent: a
    stock cannot show Buy/Accumulate/Strong Buy while its own composite risk
    score is elevated (≥65, the same threshold the watchlist-level Risk
    status card already used) — capped to Hold; cannot show Buy or better
    while its own valuation is materially overvalued (>20% above the
    modeled fair value) — capped to Hold; cannot show Strong Buy without
    High confidence — capped to Buy. Unit-verified directly against
    `buildRecommendation()` with synthetic inputs: a would-be Buy (composite
    73) with a composite risk score of 80 correctly capped to Hold with the
    disclosed note; a would-be Buy with the DCF fair value 27% below CMP
    correctly capped to Hold; a would-be Strong Buy (composite 82) with only
    Medium confidence correctly capped to Buy.
  - **Circular-dependency fix**: Relative positioning needs
    `relativeValuation.mjs`'s sector/watchlist comparison, which itself used
    to rank "sector leader" and peer rank by `.score` — i.e. by the
    recommendation the new engine was trying to compute. Fixed by re-basing
    that ranking on ROCE (falling back to ROE), a fundamentals-only proxy
    that doesn't depend on the recommendation at all (and is arguably a more
    defensible basis for "sector leader" in its own right). The
    recommendation itself is computed in two passes per stock: pass 1 (all
    buckets except Relative positioning, renormalized over the remaining
    90%) runs inside the existing per-stock pass; pass 2 folds in Relative
    positioning once `relativeValuation.mjs`'s watchlist-wide pass resolves,
    and recomposes the tier/confidence/consistency read from the
    already-computed bucket scores — no factor, DCF or institutional-risk
    computation is repeated.
  - `factors.mjs` and `dcf.mjs` are unmodified — the new engine consumes
    their existing outputs rather than replacing them.

### Validation completed

- `node --check` passed for every new/modified `.mjs` file and `script.js`.
- Direct `buildResearch()` calls (cache-only, no network) against all 4
  seeded watchlists confirmed: **HDFC Bank, ICICI Bank, SBI, Kotak Mahindra,
  Axis, IndusInd, Bank of Baroda, PNB** (Banking watchlist, all sector
  `Financial Services`) all show `dcf.sectorExcluded: true` with the exact
  disclosed reason string and a real, sane `financialValuation` (no fair
  value more than ~2x off CMP after the numerical-stability fix above); an
  **industrial** company (HAL, BEL, BDL — Capital Goods/Aerospace &
  Defence), a **power** company (NTPC, Tata Power, CESC) and a **technology**
  company (TCS) all continue to run the ordinary DCF engine unmodified, with
  the same Bull/Base/Bear/WACC/sensitivity output as before this phase.
  IndusInd Bank (a real, currently-distressed name) correctly produced the
  lowest financialValuation fair value and a Sell rating — a sanity check
  that the model responds directionally to real distress, not just a
  smoke test.
- Live HTTP validation against a running server (`GET
  /api/watchlists/{banking,power,defence,core-portfolio}/research`):
  confirmed the same results end-to-end through the real API layer, plus
  `data.metricMeta.financialSectorValuation` and
  `.recommendationConfidence` present, and `data.dataLimitations` grew from
  14 to 16 entries with the two new disclosures.
- Full Playwright walkthrough against the running server (Chromium,
  headless): Banking watchlist → Valuation tab → HDFC Bank shows the new
  Recommendation card (Hold, High confidence, "weak technical trend," 5
  scored buckets) followed by the Financial-sector valuation card ("DCF not
  applicable for financial institutions," Bull/Base/Bear, Cost of equity,
  ROE, Sustainable growth, confidence) in place of the DCF card; switching
  to the Power watchlist shows the ordinary DCF card unchanged for NTPC
  alongside its own Recommendation card; Dashboard's Top Opportunities table
  renders the renamed Company/Sector/CMP/Recommendation/Upside %/
  Confidence/Primary driver columns with real values, no
  blank/undefined/NaN cells. **Zero console errors, zero failed network
  requests** across the whole walkthrough (both watchlists, all tabs
  touched).

### UI changes

- Valuation tab's per-stock deep-dive gained one new card at the top
  (Recommendation: rating badge, confidence badge, primary driver, any
  consistency-cap note, the 5 bucket scores) and, for financial-sector
  stocks only, the DCF card is replaced by the new Financial-sector
  valuation card — same visual style as the existing DCF card, not a new
  panel type.
- Top Opportunities table: "Conviction" column renamed "Confidence" (now the
  unified engine's confidence, not a separate band of the same score under
  a different name); "Key catalyst" renamed "Primary driver" and now reads
  `recommendation.primaryDriver` (the bucket furthest from neutral) instead
  of a separate ad hoc scan of the old per-factor object — the badge and the
  driver text can no longer disagree, since both come from the same engine
  call.
- Dashboard's methodology list rewritten to describe the 5-bucket engine,
  the consistency guards, and the financial-sector valuation substitution,
  replacing the stale "12-factor institutional scoring model" description.
- No new tabs, no new navigation, no layout changes beyond the one new card
  and the two renamed columns above.

### Known limitations (new in this phase, by design)

- The financial-sector valuation model is a single-stage Gordon-growth-style
  justified-P/B model using trailing ROE — it does not model ROE
  expansion/mean-reversion, so it will systematically read "overvalued" for
  a bank the market is pricing on expected future ROE improvement (verified
  live: several Banking-watchlist names came back Hold/Reduce against
  positive P/E-P/B-reversion upside for exactly this reason). This is a
  disclosed, inherent limitation of the model family, the same "Heuristic"
  tier as the DCF model it replaces, not a defect.
- The retained pre-existing `pct()` formatter bug (documented in the audit
  entry below, item P2-10: unconditional "+" prefix on non-directional
  magnitudes) now also applies to the new Cost of Equity/ROE/sustainable-
  growth/payout-ratio fields on the financial-sector valuation card, for the
  same reason WACC already had it — left as-is rather than partially fixed,
  so the eventual Phase 3c `pctAbs()` batch cleanup fixes every affected
  field consistently in one pass instead of some now and some later.
- The 20%-materially-overvalued and 65-elevated-risk consistency-cap
  thresholds are disclosed, fixed constants (matching the existing
  Dashboard-level "Elevated" risk threshold for the risk one), not
  empirically calibrated — same disclosed-heuristic-coefficient limitation
  already recorded for the rest of the scoring model in the audit entry
  below.

### Remaining Phase 3b / 3c items (unchanged, carried forward)

Everything in the audit entry directly below's Phase 3b (sector-risk lookup
should also match `industry`; `PGCIL.NS` → `POWERGRID.NS`; fetch-failure vs.
never-fetched UI state; a minimal automated test layer for the pure-math
modules) and Phase 3c (dedupe the debt-trend calculation; extract one shared
`groupBySector()`; delete dead `pearsonCorrelation`; `card()` auto-escaping;
`pctAbs()` formatter batch) is unchanged and still pending — none of it was
in scope for this pass.

## 2026-08-13 — Post–Phase 2 institutional audit and Phase 3 enhancement plan

### Status

**Phase 2 (institutional analytics upgrade): complete**, per the entry directly
below. This entry is a separate audit pass over the finished Phase 2 work,
treating the app as a going-concern institutional platform rather than a
just-shipped feature set: repository-wide code review, live calculation
validation (DCF math, correlation-matrix symmetry, weight normalization,
degenerate portfolios), an edge-case sweep (negative FCF, single-stock
watchlist, single-sector concentrated watchlist, a 10-stock watchlist),
and a performance re-measurement. No feature work was done in this pass --
findings are catalogued below and staged into a prioritized Phase 3, per the
audit brief's explicit "do not implement major new features yet."
A companion report with full evidence, severity detail and a repository
cleanup plan was produced as an artifact for this session (executive
summary, gap analysis, calculation validation, performance audit, code
quality assessment, UX consistency review) -- this entry is its
roadmap-governance record: implementation status, findings, and the
Phase 3 plan.

### Findings

**P0 -- correctness bugs, fix before adding any more analytical depth:**

1. **DCF has no sector gate and produces misleading fair values for banks.**
   Live-verified: HDFC Bank (Financial Services) returned a DCF Base fair
   value of Rs 2,280 against a CMP of Rs 725 -- an apparent ~3x "upside" --
   purely because Screener's generic Free Cash Flow line resolves as
   positive for a bank, even though a levered-FCF DCF is analytically
   invalid for a deposit-taking/lending institution (its "capital
   expenditure" and working-capital concepts don't correspond to an
   operating company's). The model has no sector exclusion, so this number
   is live for any bank/NBFC/insurer with usable reported FCF.
2. **The Rating/compositeScore that drives every Buy/Hold/Sell tag in the
   app has zero visibility into any Phase 2 signal.** `factors.mjs`'s
   `technicalTrend()` still reads the original Phase 1
   `technicalTrendSignal()`, not the new technical scorecard;
   `scoringEngine.mjs` never touches `institutionalRisk` or `dcf`. A stock
   can show "Buy" on the Dashboard while its own Risk tab shows a 65+
   composite risk score and its own DCF Bear case sits below CMP, with
   nothing in the UI reconciling the two.

**P1 -- data-integrity and coverage gaps:**

3. **Sector-risk lookup only checks `company.sector`, never `company.industry`.**
   Live-verified: all 7 stocks in the seeded Defence watchlist are
   classified by Screener under the broad sector "Capital Goods," so every
   one of them falls back to the generic default sector-risk baseline --
   the feature is silently non-differentiating for an entire seeded
   watchlist.
4. **`PGCIL.NS` is not a valid Yahoo ticker** (Power Grid trades as
   `POWERGRID.NS`; the alias only exists for the Screener.in fundamentals
   fetch, not the Yahoo quote fetch) -- confirmed live 404, this seeded
   Power-watchlist row has been blank since it was first seeded. Pre-existing,
   not introduced this phase, never previously surfaced.
5. **No retry or distinct failure state for a single failed quote fetch.**
   `LTIM.NS` (a genuinely correct ticker) 404'd consistently across 3 live
   attempts; the row renders identically to "this symbol doesn't exist,"
   with no way for a user to tell a transient fetch failure from a bad
   ticker from "never fetched yet."

**P2 -- code quality / maintainability (no behavioral risk today):**

6. Duplicated 3-year debt-trend calculation inside `institutionalRisk.mjs`
   (`financialRisk()` and `governanceRisk()` each recompute it independently).
7. Sector-grouping ("bucket stocks by sector") reimplemented independently
   three times (`portfolio.mjs` x2, `relativeValuation.mjs`).
8. `priceSeries.mjs`'s `pearsonCorrelation()` export is dead code, superseded
   by `correlationFromPrepared`/`prepareSeries` when the correlation-matrix
   perf bug was fixed during Phase 2 (see the entry below) -- no remaining
   callers anywhere.
9. `script.js`'s `card()` helper doesn't escape its own arguments -- every
   call site must remember to pre-escape dynamic text itself. Hand-audited
   every Phase 2 call site (grep sweep): none currently leak unescaped
   scraped/user content, so this is not an active vulnerability, but it's
   fragile-by-convention rather than enforced.
10. `pct()`'s unconditional "+" prefix is applied to non-directional
    magnitudes throughout the new Portfolio/Valuation/Risk panels (WACC,
    annualized volatility, position-weight %) -- e.g. "Largest position
    +16.67%," "WACC +8.73%" -- visually implying a directional figure where
    none exists.

**P3 -- disclosed modeling limitations, restated for completeness (already
labeled Heuristic in the UI, not defects):** DCF Bull/Bear band width is
clamped to a fixed [3pp, 15pp] regardless of a stock's actual historical
growth dispersion, likely understating cyclical names' real earnings-cycle
risk; none of the risk/scoring linear-heuristic coefficients (institutional
risk, the 12-factor model, technical scores) are empirically calibrated or
backtested against realized outcomes -- there is no historical-outcomes data
source in this app to calibrate against; all sector/peer comparisons remain
watchlist-scoped, not market-wide (same root cause as the pre-existing
`industryPe` limitation).

### Calculation validation completed (live, evidence-based)

- DCF math hand-verified for NTPC (Bear/Base/Bull 52.86/66.85/131.49, WACC
  8.73%, cost of equity 11.66%, cost of debt 5.09%, consistent with its
  reported leverage and Tax %).
- Negative/unavailable-FCF guard verified across 9 real companies spanning
  3 watchlists (AXISBANK, ADANIPOWER, TORNTPOWER, JSWENERGY, NHPC, BEML,
  MAZDOCK, COCHINSHIP, GRSE) -- every one renders an explicit "DCF not
  available" reason, never a fabricated or nonsensical fair value.
- Correlation matrix verified symmetric with a unit diagonal on live 6-stock
  and 9-stock queries; a deliberately single-sector 9-stock IT basket
  produced a plausible average pairwise correlation of 0.515.
- Weight normalization verified across single-override, multi-override, and
  oversubscribed (sum > 100%) cases -- all three normalize to exactly 100.00.
- Degenerate portfolios verified live: single-stock watchlist (HHI=1,
  effective holdings=1, trivial 1x1 correlation matrix, no error) and a
  fully single-sector 9-stock watchlist (sector diversification score
  correctly floors at 0 while position diversification correctly stays high
  at 89 -- the two concentration measures are properly decoupled, not
  conflated). Empty watchlist verified to return null/zero/empty throughout
  with no server error.

### Performance re-measurement

Cold server boot to first HTTP response ~460ms; cache-only watchlist load
~40-80ms across 6-10 stock watchlists (confirms the Phase 2 correlation-
matrix performance fix, documented below, holds at larger scale, not just
the size it was originally fixed against); forced full refresh ~0.8-2.4s
for 6-10 stocks (~2 network fetches/company plus one Screener fetch, in
line with Phase 2's own documented expectation); Node process memory ~40MB
working set / ~53MB private across roughly 15 refresh cycles run during
this audit, no leak signal; disk cache ~940KB, bounded by unique symbols
touched (TTL-gated re-fetch, not unbounded accumulation).

### Repository cleanup completed

Archived `reports/Sector Research Dashboard — Flow Integrity Audit.mhtml`
(a point-in-time snapshot from the 2026-08-11 pre-Phase-1 audit, superseded
by this file's own written history) into a new `archive/` folder, dated in
its filename; the now-empty `reports/` directory was removed. `run.bat`/
`killserver.bat` reviewed and confirmed accurate, kept as-is. No other
stale or dead files found at the repository root; `data/cache/` and
`data/watchlists/` are working state, left untouched. No new authoritative
documents were created, per this audit's governance constraint -- all
findings are recorded here and in the session's audit-report artifact only.

### Phase 3 plan (not yet implemented -- awaiting go-ahead)

**Phase 3a (P0, correctness, small/contained changes):**
- Sector-gate the DCF/WACC/reverse-DCF/sensitivity engine away from
  Financial Services/Banking/Insurance/NBFC, with an explicit "not
  meaningful for financial institutions" disclosure (same pattern as the
  existing EV/EBITDA block). *Estimated effort: small (~1 file, `dcf.mjs` +
  a sector-check in `research.mjs`).*
- Add a visible "signal conflict" flag wherever Rating disagrees materially
  with the institutional risk composite or the DCF Bear/Base read, without
  yet changing the composite-score formula itself. *Estimated effort:
  small-medium (research.mjs + script.js + one new badge).* Folding these
  signals directly into `compositeScore` is deferred to a separate,
  explicitly-reviewed Phase 3b, since it would change every Buy/Sell tag in
  the app -- a scoring-methodology change, not a display fix.

**Phase 3b (P1, data integrity + maintainability foundation):**
- Sector-risk lookup should also match `company.industry` (more specific
  than `sector`), fixing the Defence-watchlist gap and likely others.
- Reseed `PGCIL.NS` -> `POWERGRID.NS`; add a distinct "fetch failed" vs.
  "never fetched" state in the unresolved-row UI, with one automatic retry
  before a refresh pass gives up on a symbol.
- Stand up a minimal automated test layer for the pure-math modules
  (`dcf.mjs`, `priceSeries.mjs`, `institutionalRisk.mjs`,
  `portfolio.mjs`'s `resolveWeights`) -- these are all pure functions with
  no I/O, the cheapest possible tests to write, and exactly the modules a
  silent future regression would hurt most. This is the single biggest
  structural maintainability gap identified: **no test suite exists
  anywhere in this repository across Phase 1 or Phase 2** -- every
  validation to date has been a manual, one-time pass (`node --check` +
  live API queries + Playwright), not a regression guard. *Estimated
  effort: medium (test runner choice + ~4 files' worth of pure-function
  tests).*

**Phase 3c (P2, cleanup, low risk/low urgency):**
- Dedupe the debt-trend calculation in `institutionalRisk.mjs`; extract one
  shared `groupBySector()` helper; delete the dead `pearsonCorrelation`
  export; make `card()` escape by default with an explicit raw-HTML
  opt-out; add a `pctAbs()` formatter for non-directional magnitudes and
  apply it to WACC/volatility/position-weight displays. *Estimated effort:
  small, mechanical, batchable into one pass.*

**Deferred, needs a product decision first (not scheduled):** a market-wide
sector/peer database (needs a paid data vendor -- same conclusion reached
in Phase 1 and Phase 2, cost is the blocker, not effort) and empirical
calibration/backtesting of the heuristic scoring coefficients (needs a
historical-outcomes dataset this app has no source for).

**Risks carried into Phase 3:** the P0 DCF sector-gate and signal-conflict
work both touch fields already rendered across multiple tabs (Valuation,
Risks, Dashboard) -- needs the same live-query + Playwright validation
discipline Phase 2 used, not just `node --check`. The test-suite work
(3b) has no dependency risk but is easy to under-scope -- worth explicitly
timeboxing to the 4 pure-math modules named above rather than attempting
full-app coverage in one pass.


## 2026-08-13 — Phase 2: institutional analytics upgrade (valuation engine, relative valuation, technical scorecard, portfolio analytics, 5-category risk framework)

### Objective

Push the watchlist workspace to institutional-research depth per the Phase 2
mandate: a real (heuristic-but-honest) DCF valuation engine, a relative-
valuation/peer framework, a professional technical scorecard, real portfolio
analytics, and a 5-category institutional risk framework -- while preserving
the existing 10-tab navigation, cache-first startup, and incremental refresh,
and tagging every new metric **Sourced / Calculated / Heuristic** in the UI.
This app has no institutional data vendor (no consensus estimates, no EV/cash
data, no beta feed, no risk-free-rate feed, no market-wide sector database);
every new field below is either a real source, a disclosed formula over real
data, or a disclosed assumption/heuristic -- never fabricated data presented
as sourced.

### Implementation status: done

- **Data foundations**: `yahooQuoteProvider.mjs`'s `fetchQuote()` now also
  extracts open/high/low arrays (already present in the same 1y daily
  chart-endpoint response, zero new network calls) for ADX/ATR/OBV/A-D/volume
  profile, plus `hundredDayAverage`. A new `fetchPriceHistory(symbol,
  range='5y', interval='1wk')` is the one genuinely new network call this
  phase adds, fetched/cached alongside quote+fundamentals in
  `research.mjs`'s `loadCompanyBundle` (and for the market benchmark in
  `loadBenchmarkQuote`) -- same staleness clock as everything else, so it
  never touches the cache-only startup paint and is only fetched on
  incremental/full passes. `data/metadata/metricRegistry.mjs` is the single
  classification dictionary (tier + confidence + methodology per metric key),
  shipped once per payload as `data.metricMeta`; the frontend's `infoIcon()`
  helper (`script.js`) is the only place that renders it, as a hover/focus
  info-icon popover next to column headers and KPI titles.
- **Portfolio weighting** (confirmed with user): an optional, user-entered
  `targetWeightPct` per company (new field on the existing company shape,
  set via a small number input added to each Manage-panel company row).
  `resolveWeights()` (`data/analytics/portfolio.mjs`) has unset companies
  split whatever % remains after the explicit ones equally, then normalizes
  the whole vector to sum to exactly 100 (verified: an all-unset watchlist
  degrades to equal-weight; an oversubscribed set of explicit weights, e.g.
  50%+80%, normalizes proportionally with unset companies at 0%). New route
  `PUT /api/watchlists/:id/companies/:symbol/weight`. This is what makes
  "Total portfolio value," diversification, correlation-weighted risk
  contribution and scenario impact meaningful without the app storing real
  currency holdings -- explicitly labeled an illustrative index throughout,
  not a brokerage valuation.
- **Valuation engine** (`data/analytics/dcf.mjs`, `historicalPercentiles.mjs`):
  beta from real covariance of weekly stock/benchmark returns (null, not
  defaulted to 1, when insufficient history or no benchmark for the market);
  WACC blending CAPM cost of equity (fixed, disclosed per-market risk-free-
  rate/equity-risk-premium assumptions -- no live rate feed exists) with
  after-tax cost of debt; a 2-stage discounted-FCF model (linear taper from a
  clamped near-term growth estimate to a disclosed terminal-growth
  assumption, Gordon-growth terminal value) producing Bull/Base/Bear fair
  values; a reverse-DCF implied growth rate (binary search); a 3x3 WACC x
  terminal-growth sensitivity grid; a valuation confidence score (data
  completeness x agreement with the existing P/E-P/B reversion heuristic).
  The DCF model treats reported Free Cash Flow as an equity-cash-flow proxy
  and does not bridge Enterprise Value to Equity Value via net debt, since Net
  Debt is unavailable app-wide -- disclosed in the methodology text shown in
  the UI. Historical P/E and P/B percentile reconstruct a per-fiscal-year
  implied multiple from real reported EPS/book value against the nearest
  available historical weekly close (an approximation, not exact FY-end
  closes; P/B additionally assumes a constant share count derived from
  Equity Capital / Face Value). EV/EBITDA percentile is explicitly not
  implemented (EV itself is blocked app-wide). Sector premium/discount,
  earnings yield and FCF yield round out 3 new Valuation-tab table columns.
- **Relative valuation framework** (`data/analytics/relativeValuation.mjs`):
  compares each stock's P/E, P/B, PEG, ROE, ROCE, revenue/EPS growth and
  dividend yield against the sector median, sector leader and watchlist
  average -- all computed from **this watchlist's own same-sector peers**
  (there is no market-wide sector database anywhere in this app, same root
  constraint `industryPe` already has). "Historical average" is only
  populated for ROCE (the one metric with a real multi-year series already
  parsed from Screener's ratios table); every other metric's historical
  average renders N/A rather than being approximated from a single trailing
  CAGR. Produces a relative valuation score, a premium/discount score, and
  sector/watchlist rankings (display rankings, not a re-sort of the
  watchlist's own saved order).
- **Technical engine upgrade** (`data/analytics/technicalScorecard.mjs`):
  ADX/DI+/DI- (Wilder's smoothing, same style as the existing RSI), ATR, OBV
  and Accumulation/Distribution (with a trend read off each), a
  daily-close-bucketed volume profile (disclosed as a proxy for true
  intraday tick volume profile), multi-timeframe trend (daily reuses the
  existing 50/200-DMA read; weekly/monthly derive their own moving-average
  alignment off the new weekly price series), and four in-house 0-100
  screening scores (trend strength, momentum, volatility, breakout
  probability) -- all computed from the existing 1y daily OHLCV once
  open/high/low were extracted, **zero new network calls** for this entire
  workstream. The Technical tab's table was curated to a scorecard (Trend/
  20-50-100-200DMA/RSI/RS/Volume trend/4 scores) to stay scannable; raw
  indicator values, MACD, support/resistance, multi-timeframe detail and the
  volume-profile histogram moved to a new per-stock deep-dive panel (reusing
  the Fundamentals tab's pill-selector pattern).
- **Portfolio analytics** (`data/analytics/portfolio.mjs` extended,
  `correlation.mjs`, `scenarios.mjs` new): weighted portfolio dashboard
  (illustrative total value, weighted avg P/E/ROE/ROCE/growth/dividend/FCF
  yield); position-level HHI/effective-holdings alongside the existing
  sector HHI (both real named formulas); a full pairwise Pearson correlation
  matrix of weekly returns (rendered as a CSS-grid heat-map, no charting
  library -- consistent with the app's existing tabular-only precedent),
  with highly-correlated and diversification-opportunity pair lists;
  weight-aggregated portfolio quality (quality/valuation/technical/risk
  scores, no new calculation); 5 named scenario stress tests (rate hike,
  market correction, sector rotation, commodity shock, earnings slowdown),
  each a disclosed heuristic multiplier over a stock's real leverage/beta/
  sector/earnings-quality characteristics, aggregated by weight into
  portfolio impact %, risk contribution and a qualitative recovery-
  sensitivity label -- explicitly labeled an illustrative stress test, not a
  factor model or historical backtest.
  - **Performance bug found and fixed during implementation**: the first
    correlation-matrix implementation re-parsed every date string with `new
    Date()` inside an O(n x m) nearest-match scan, for every matrix cell,
    computing both (i,j) and (j,i) instead of one triangle -- profiled at
    >90% of `buildResearch`'s CPU time, pushing a cache-only ("none" pass)
    request from ~0.1s to ~1.1-1.3s on a 6-company watchlist, a real
    regression against the "cache-first startup" non-negotiable. Fixed by
    timestamp-tagging and sorting each symbol's series exactly once
    (`priceSeries.mjs`'s `prepareSeries`/`correlationFromPrepared`) and
    computing only the upper triangle, mirrored -- cache-only requests are
    back to ~20-40ms (verified via direct `buildResearch()` timing and via
    HTTP, both before and after the fix).
- **Institutional risk framework** (`data/analytics/institutionalRisk.mjs`):
  5 categories -- Financial (interest coverage, debt-service/refinancing
  risk from real debt trend, liquidity risk from existing working-capital
  analytics), Business (margin risk from existing margin-stability; revenue/
  customer concentration and execution risk render unavailable -- no segment/
  customer data source), Market (beta, annualized realized volatility and
  max drawdown from the new weekly price series, valuation-compression risk
  from the P/E historical percentile), Sector (a new static, disclosed,
  keyword-matched sector -> qualitative risk-tag lookup this project
  maintains, covering regulatory/commodity/competitive/technology-disruption
  exposure -- explicitly not a live feed; unmatched sectors get a flagged
  generic baseline), and Governance (promoter-holding trend is real; capital
  allocation is a heuristic blend of ROCE/debt trend; pledge % and
  related-party exposure have no data source and render unavailable). A
  composite risk score renormalizes over only the categories that resolve
  (same rule as the main scoring engine); risk trend is a same-visit
  directional read off already-computed trend inputs, not a stored
  historical score time series (this app persists no such history). This
  replaced the Risk tab's previous client-side heuristic (`script.js`'s old
  `riskCategories()`), which only covered 4 ad hoc categories -- the full
  5-category framework is now computed server-side alongside every other
  analytics module, with a new per-stock deep-dive panel for the full
  sub-item breakdown.
- **Dashboard enhancement**: a 4-tile executive-summary status row
  (Watchlist rating, Valuation status from the average sector premium/
  discount, Risk status from the average composite risk score, Opportunity
  status from the count of Buy/Strong-Buy names with positive upside); two
  new Top-Opportunities sort options (Quality, Technical strength, both
  already-computed scores); named Key-risk flags (Overvaluation, Weak
  balance sheet, Earnings deterioration, Technical breakdown) computed
  server-side per stock and surfaced as a filtered list; news items now
  carry a catalyst type and an expected-timeline bucket
  (`data/news/companyNews.mjs`, same disclosed keyword-heuristic style as
  the existing impact classifier -- never a fabricated date, consistent with
  the pre-existing "Upcoming Earnings & Events: not available" stance).

### Validation completed

- `node --check` passed for every new/modified `.mjs` and `script.js`.
- Live-queried `/api/watchlists/core-portfolio/refresh` (force, 6 India
  companies): confirmed real, sane DCF outputs (e.g. NTPC Bear/Base/Bull
  52.86/66.85/131.49 against a CMP of 344.25, WACC 8.73%, reverse-DCF implied
  growth 23.19%); confirmed the correlation matrix is symmetric with a unit
  diagonal and matches hand-checked pairs; confirmed weight normalization
  (single 50% override splits the rest 10% each summing to 100; an
  oversubscribed 50%+80% pair normalizes to 38.46/61.54 with the rest at 0,
  still summing to 100).
- Confirmed graceful degradation: a freshly created empty watchlist returns
  zero stocks, `portfolio.dashboard.totalValue: null`, an empty correlation
  matrix and a zero-impact scenario array with no server error; deleted the
  test watchlists afterward.
- Full Playwright walkthrough (desktop 1280px and mobile 480px viewports)
  against the running server: all 10 tabs render; clicked through 2+ company
  pills on each of the 3 new deep-dive panels (Valuation, Technicals, Risks)
  and confirmed each re-renders with that company's own numbers; opened the
  Manage panel, set a company's target weight via the new input, confirmed
  the effective (normalized) weight updates across the payload, then reset
  it; **zero console errors** across the entire walkthrough on both
  viewports; correlation heat-map, sensitivity grid, fair-value band,
  scenario cards and all 5 risk-category cards render with real numbers, not
  blank/undefined.
- Latency re-measured against the pre-Phase-2 baseline (~1.2s cold / ~0.1s
  warm, `roadmap.md` 2026-08-13 entry above): cache-only ("none" pass)
  requests are ~20-80ms (after the correlation-matrix perf fix above); a
  full forced refresh is ~1.5-2.4s for 6-8 companies (each company now does 2
  fetches -- quote + the new weekly price history -- instead of 1, so this
  roughly doubles cold-fetch latency as expected, but the cache-first paint
  and incremental-refresh-only-fetches-stale-companies behavior are
  unaffected, since `priceHistory` shares the same per-symbol staleness
  clock as everything else).

### Known limitations (new in this phase, by design)

- EV/EBITDA historical percentile is not available (EV itself is blocked
  app-wide, same root cause as the pre-existing EV/EBITDA/Cash/Net-Debt
  limitations).
- All sector/peer comparisons (sector median, sector leader, sector P/E,
  premium/discount, sector ranking) are scoped to this watchlist's own
  companies -- there is no market-wide sector database in this app.
- Beta, DCF fair value and WACC require a computable beta -- unavailable for
  Global watchlists (no defensible single benchmark) and for stocks with
  insufficient overlapping weekly price history (e.g. recently listed),
  rendered as an explicit "not available" reason rather than assumed at a
  default beta of 1.
- Risk-free rate, equity risk premium and terminal growth are fixed,
  disclosed per-market assumption constants (India Rf ~7.1%/ERP ~5.5%/
  terminal 4%; US Rf ~4.3%/ERP ~5%/terminal 3%), not a live rate feed --
  surfaced in the Valuation deep-dive panel, not hidden.
- Sector risk (regulatory/commodity/competitive/technology-disruption) is a
  static, keyword-matched qualitative lookup this project maintains, not a
  live regulatory or commodity data feed.
- Business-risk revenue/customer concentration and execution risk, and
  governance pledge %/related-party exposure, have no data source (Screener
  exposes no segment/customer/pledge data) and render as unavailable rather
  than estimated.
- Risk trend is a same-visit directional read off already-computed trend
  inputs, not a multi-period historical trend line (this app stores no
  historical risk-score time series).
- Portfolio weights are an optional, user-entered allocation target (%), not
  real currency holdings or share counts -- "Total portfolio value" and
  scenario $ impacts are illustrative indices, not brokerage valuations.
- Scenario analysis is an illustrative stress test built from each holding's
  real characteristics, not a historical backtest or a quantitative factor
  model.

## 2026-08-13 — Company-centric persistent watchlist workspace (replaces sector search)

### Objective

Replace the sector-first workflow (type a sector, screen a hardcoded
ticker-universe preset or Yahoo symbol search, rank, cap at 10, nothing
persists) with a company-first, persistent watchlist workspace: the user
builds their own list of companies via autocomplete, it's saved to disk as
JSON, it survives server and browser restarts, and every tab analyzes
exactly that list in the user's own order -- no tab re-ranks or re-selects
companies. Scoped down from the original brief in two directions the user
confirmed when asked: (1) the old "Top 10 stocks" (Leaders) and "News" tabs
are dropped and folded into a redesigned Dashboard tab, for exactly 10 tabs
(Dashboard, Fundamentals, Valuation, Profitability, Balance Sheet, Growth,
Ownership, Technicals, Portfolio, Risks); (2) a 20-company soft cap per
watchlist with a non-blocking warning past that, plus incremental refresh
(only fetch new/stale/manually-refreshed companies) rather than a full
re-fetch on every load.

### Implementation status: done

- **Watchlist Service** (`data/watchlist/store.mjs`): loads/saves
  `data/watchlists/index.json` and one `data/watchlists/<id>.json` per
  watchlist, atomic writes throughout (write `.tmp`, then rename --
  `writeJsonAtomic` added to `data/util.mjs` and shared with the disk
  cache). Seeds 4 default watchlists in code on first run (not hand-authored
  JSON, so a fresh checkout self-seeds): `core-portfolio` mirrors the task
  brief's own example companies (NTPC, TCS, HDFC Bank, Reliance, Tata Power,
  HAL); `banking`/`power` reuse the old sector-preset ticker lists;
  `defence` is new. CRUD for watchlists (create/rename/duplicate/delete/
  switch-active) and companies (add/remove/reorder), all persisted
  immediately -- no manual save action anywhere in the UI.
- **Symbol/sector resolution** (`data/watchlist/resolve.mjs`): autocomplete
  hits Yahoo's public symbol-search endpoint (the same one the old
  sector-preset fallback used, generalized from a sector query to a plain
  name/ticker query). `classifyMarket()` replaces the old
  `isInSelectedMarket(quote, targetMarket)` comparison with a direct
  per-quote classifier, since a watchlist has no single selected market --
  companies resolve their own market individually. Sector/industry come
  from Screener.in's classification data (India only, same as fundamentals)
  and are backfilled onto the watchlist entry after the first real fetch,
  never guessed.
- **Persistent per-symbol cache** (`data/watchlist/diskCache.mjs`,
  `data/watchlist/research.mjs`): `data/cache/companies/<symbol>.json`
  holds the last successful quote+fundamentals+news fetch, shared across
  every watchlist containing that symbol (a symbol in two lists is only
  ever fetched once). `buildResearch(watchlist, { networkPass })` drives
  three modes: `'none'` (cache-only, instant -- startup/switch paint),
  `'incremental'` (only missing/stale companies -- the automatic background
  refresh after that paint), `'full'` (every company -- the manual
  "Refresh Data" button). The returned `stocks` array is always in the
  watchlist's own order; nothing sorts or truncates it (the old `TOP_N =
  10` cap is gone -- the watchlist *is* the list).
  - **Race fixed during implementation**: the first version resolved each
    company's backfilled metadata (name/sector/industry) with N concurrent
    single-company read-modify-write calls to the same watchlist file; since
    each read the same pre-write snapshot, all but the last writer's patch
    was silently lost on disk (verified live: only 1 of 6 seeded companies'
    sectors persisted after a refresh). Fixed by batching all of a
    `buildResearch` call's metadata patches into one
    `updateCompaniesMetadata()` read-modify-write.
  - **Startup-seeding gap fixed**: `getWatchlist()`/mutation functions read
    a watchlist file directly by id without going through the
    index-seeding path, so if the very first request the server handled
    wasn't `listWatchlists()`, it 404'd against a never-seeded directory.
    Fixed with an explicit `store.init()` awaited before `.listen()`.
- **Fair Value / Target Price / Upside / Margin of Safety / Conviction**
  (`data/analytics/valuation.mjs`): these were `null` "Phase 2" stubs in
  `scoringEngine.mjs` before this phase (no real model existed). New,
  disclosed in-house heuristic (same "Heuristic:" precedent as the risk/
  ownership scores elsewhere) -- P/E and P/B reversion to the watchlist's
  own peer average, projected one year by 5Y EPS CAGR. Explicitly not
  analyst consensus or a DCF; labeled as such on the Valuation tab and in
  `dataLimitations`.
- **New technicals** (`yahooQuoteProvider.mjs`, `data/analytics/
  technicalLevels.mjs`): 20DMA, standard 12/26/9 EMA MACD, and
  `oneYearReturnPct` added to `fetchQuote()`. Relative Strength = stock's
  trailing-1y return minus a benchmark index's (`^NSEI` India, `^GSPC` US,
  `N/A` for Global -- no single defensible benchmark spans every exchange),
  fetched/cached the same way as any other symbol. Support/Resistance is a
  heuristic off real levels already computed (nearest of 50/200-DMA/52W-low
  below CMP; 52W high above CMP), not literal pivot-point math.
- **Portfolio analytics** (`data/analytics/portfolio.mjs`): sector
  allocation, >40%-one-sector concentration flag, and a diversification
  score using the actual Herfindahl-Hirschman Index (`1 - HHI`, scaled
  0-100) -- a real named formula, not invented for this app.
- **Per-company news** (`data/news/companyNews.mjs`, refactored out of
  `server.mjs`'s old sector-scoped `newsFor`): one Google News RSS query
  per company (was one combined query for the whole sector report), title-
  deduplicated, up to 5 items. Impact level (High/Medium/Low) is a
  disclosed keyword-based heuristic over the headline text, not an
  editorial rating from the source.
- **Table standard flipped**: every table's leading columns are now
  Company, Sector, CMP, P/E (was Recommendation, CMP, Company, set in the
  previous phase). The Recommendation tag itself moved off the 8 detail
  tables -- the new per-tab column lists don't include it -- and now lives
  prominently on the Dashboard's Top Opportunities table instead, which
  also supports client-side re-sorting (Recommendation/Upside/Conviction/
  Valuation/Growth) without touching the canonical `stocks` order.
- **Dashboard replaces Overview**, absorbing the old Leaders and News tabs:
  Executive Summary, KPI Ribbon, Top Opportunities, Recent News &
  Catalysts, Sector Allocation, Watchlist Snapshot (Portfolio Health),
  Key Risks, Upcoming Earnings & Events. The last one has no configured
  data source anywhere in this app (Screener's scraped fields and Yahoo's
  public chart endpoint don't expose a calendar) and ships as an explicit
  "not available" state rather than an invented date.
- **Frontend rewrite** (`script.js`, `index.html`): sector-search form
  replaced by a watchlist switcher, a debounced autocomplete "Add company"
  box (custom suggestion dropdown -- `<datalist>` can't carry structured
  exchange/sector metadata), a "Refresh Data" button, and a "Manage" panel
  (rename/duplicate/delete the current watchlist; per-company remove and
  up/down-button reorder -- plain buttons, not drag-and-drop, to stay
  dependency-free). Startup and every watchlist switch/create/duplicate/
  delete follow the same two-step pattern: cache-only paint immediately,
  then an incremental background refresh re-renders when it resolves.
  Duplicate-add returns `200` with a `duplicate` marker rather than `409`
  (verified live: a 4xx logs as a spurious "failed to load resource" in
  devtools for something that isn't actually a failure) and the frontend
  highlights the existing row instead of adding a second one.
- **Bug found and fixed via live testing**: the empty-watchlist placeholder
  (`#empty[hidden]`) stayed visible even when `hidden` was set, because
  `.empty{display:grid}`'s class-selector specificity beat the UA
  `[hidden]{display:none}` default. The previous Overview markup carried an
  explicit `.empty[hidden]{display:none}` override for exactly this reason;
  it was dropped in the index.html rewrite and is restored in `styles.css`.
- **Verified live** (Playwright against the running server, not just unit-
  level): fresh-seed startup populates real prices within seconds; sector
  resolves correctly from Screener classification and persists across a
  restart; duplicate-add is rejected and highlights the existing row with
  zero console errors; up/down reorder persists; manual refresh completes;
  switching to a never-visited watchlist now background-refreshes it too
  (all 8 companies in a fresh Banking switch resolved, not just the 1
  that happened to share a cached symbol with Core Portfolio); every tab's
  table leads with Company/Sector/CMP/P/E; zero console errors across the
  whole flow.

## 2026-08-12 — Stock Metrics split into 5 tabs; Recommendation/CMP/Company standardized across every table

### Objective

Reorganize the Phase 1 Stock Metrics tab (5 grouped card/table blocks stacked
in one tab) into 5 dedicated top-level tabs, per the institutional-dashboard
restructuring brief, and standardize every comparison table app-wide to lead
with Recommendation, CMP, Company (in that order) instead of each table
choosing its own column order. Information-architecture change only: same
dark theme, card/table CSS, and tab-switching model as Phase 1.

### Implementation status: done

- **Shared row/column model** (`script.js`): `prefixCells()` and
  `renderTable()` inject the Recommendation/CMP/Company columns for every
  table from one place, so no per-tab render function duplicates that markup
  or a table-generation loop. `signalTag()` grew a `prominent` flag (`tag-lg`
  CSS class) so the Recommendation badge in the leading column reads larger
  than the compact tags used elsewhere (e.g. inside the Overview cards).
- **Stock Metrics tab removed**; its 5 blocks became independent tabs
  (`#profitability`, `#balance-sheet`, `#growth`, `#ownership`), and its
  Valuation block was merged into the pre-existing `#valuation` tab (which
  had a different, simpler table) rather than shipping two tabs both named
  "Valuation" — the KPI card row stayed, the table became the institutional
  one, wrapped in the existing `.scroll` container.
- **Balance Sheet vs. Risk split**: Interest coverage, Piotroski F-Score and
  Altman Z-Score moved out of Balance Sheet into the Risk matrix tab
  (labeled "solvency risk indicators"), per the brief.
- **New derived fields** (`data/analytics/metricsTable.mjs`): EBITDA and net-
  profit 3Y/5Y CAGR (reusing the existing `cagrOverYears` utility already
  used for revenue/EPS), a promoter-holding period-over-period trend, and
  `publicHolding` — all real, arithmetic-only additions. Quick ratio, Mutual
  fund holding and Book value CAGR are explicit `null` (no exposed
  Current-Assets/Liabilities split, no separate MF shareholding row, no
  per-period book-value-per-share row), following the same house rule as
  the existing EV/Piotroski/Altman `null` fields.
- **Top 10 Recommended Stocks** (renamed from "Top stocks"/`#leaders`): now
  surfaces `recommendation.factors.{businessQuality,financialStrength,
  growth,valuation,technicalTrend}` and `classification`-derived Segment —
  all already computed server-side by the Phase 1 scoring engine but never
  previously surfaced in the UI. Conviction Level renders "N/A" (still
  Phase 2 in `scoringEngine.mjs`).
- **Risk matrix enhanced in place**: risk cards reorganized into a heat-map
  grid (Financial, Leverage, Liquidity, Earnings, Valuation risk computed
  from real data — Liquidity from the existing `workingCapital
  .cashConversionCycle`, Earnings from the existing `earningsQuality.score`,
  both already computed server-side for the Fundamentals tab and now reused,
  not recomputed; Regulatory/Commodity/Governance risk render as "No data
  source configured", matching `managementGovernance()`'s existing pattern
  in `factors.mjs`) plus the pre-existing Trend/Drawdown cards. Added a
  3-tier heat-map coloring (`styles.css` `.risk`/`.medium`/`.high`). The
  per-stock risk table gained two real "scenario" columns (downside to
  200-DMA, downside to 52-week low), computed directly from existing price
  fields, not a fabricated stress-test model.
- **Ownership score** (`script.js`): a standalone client-side heuristic
  (promoter + institutional holding levels), *not* added to the 12-factor
  scoring engine — doing so would have silently changed `compositeScore`/
  Rating, which was out of scope. Same "Heuristic:" precedent as the
  existing per-factor functions in `factors.mjs`.
- **Column reorder only** (no new fields) on Technical, Portfolio, and the
  Risk table's existing columns, so Recommendation/CMP/Company lead
  everywhere.

### Known limitations (unchanged from Phase 1, carried forward)

Same data-source constraints as the 2026-08-12 Phase 1 entry below (EV,
EV/EBITDA, Cash, Net Debt, Current Ratio, Piotroski, Altman Z, Segment/
geographic data, Target price/Fair value/DCF) — this entry only changes
where existing and newly-derived fields are displayed, not what the
underlying data sources can supply.

## 2026-08-12 — Phase 1: institutional data layer, 12-factor scoring engine, Stock Metrics & Fundamentals tabs

### Objective

Upgrade the dashboard from a retail-style screener toward Tier-1 institutional
equity research depth, per the institutional-transformation mandate, while
keeping the existing UX/tabs/layout unchanged. Phase 1 scope: a modular
data-provider abstraction with caching, expanded Screener.in scraping for
10-year financials/ownership history/ratios (India), a transparent 12-factor
scoring engine with an institutional 6-tier rating scale, an overhauled Stock
Metrics tab, and a new Fundamentals tab. Phase 2 (DCF/valuation models,
technical-engine upgrades, portfolio construction, risk framework) and Phase 3
(new Earnings/Ownership/Quality/Relative-Valuation tabs, export reporting) are
out of scope for this entry.

### Implementation status: done

- **Data-provider abstraction** (`data/providers/index.mjs`): every
  fundamentals provider (`screenerProvider.mjs`, `notConfiguredProvider.mjs`,
  and any future paid-API provider) resolves to one normalized shape — nulls
  where unavailable, identical key set regardless of source — so the UI and
  scoring engine never branch on market, and a paid API is a drop-in later
  without touching either. `server.mjs` was slimmed to HTTP server, sector
  presets, `tickerList()`, and orchestration; all parsing/scoring logic moved
  into `data/`.
- **Expanded Screener.in scraping** (`data/providers/screenerProvider.mjs`,
  `data/parse/screenerHtml.mjs`, `data/parse/screenerLabels.mjs`): the same
  company-page fetch already in use now also parses ~10-11 years of
  Profit & Loss, Balance Sheet, Cash Flow and Ratios tables, ~13 quarters of
  results, and quarterly + annual shareholding-pattern history — all real
  `<table class="data-table">` markup extracted by row label (shareholding
  rows keyed by their `plausible-event-classification` attribute, more
  robust than their wrapped text), not free-text regex. Zero additional HTTP
  requests per symbol versus the pre-Phase-1 scrape.
- **Two scraping bugs found and fixed during validation**: (1) some listed
  companies (e.g. AVADHSUGAR.NS) have no consolidated financials — Screener
  returns HTTP 200 for `/consolidated/` with every figure rendered as an
  empty shell rather than 404ing; `screenerProvider.mjs` now detects a blank
  consolidated parse and falls back to the standalone page (the same source
  Screener's own "View Standalone" UI link points to). (2)
  `extractDivById()` initially matched a tab button's
  `data-tab-id="quarterly-shp"` instead of the real
  `<div id="quarterly-shp">` container, since it searched for a bare
  `id="..."` substring; fixed to anchor on `<div[^>]*\bid="..."`.
- **12-factor institutional scoring engine** (`data/scoring/`): weights per
  the mandate (business quality 15, financial strength 10, profitability 10,
  growth 10, cash-flow quality 10, balance sheet 5, valuation 10, management
  & governance 10, industry position 5, risk profile 5, technical trend 5,
  momentum & volume 5). `compositeScore()` renormalizes over only the
  factors that resolve non-null — a missing factor is never defaulted to a
  neutral value, unlike the pre-Phase-1 model. Below 40% available factor
  weight, `compositeScore` is `null` and `rating` is
  `'Insufficient data for institutional score'`; a separate,
  always-computed `technicalScore` (from technical trend + momentum/volume
  only) is shown instead, labeled Low Confidence — this is a gated product
  decision, not a market-specific branch, so India automatically gets a real
  composite once/if its coverage crosses the floor, and US/Global would too
  if a fundamentals source were added for them. Ratings replace the old
  BUY/ACCUMULATE/HOLD scale with Strong Buy/Buy/Accumulate/Hold/Reduce/Sell.
- **Analytics modules** (`data/analytics/`): CAGR (null-guarded against
  negative/zero-base and near-zero-denominator artifacts — see PEG below),
  3-factor DuPont ROE decomposition (with a reported-ROE cross-check),
  working-capital efficiency (direct passthrough of Screener's own ratios
  history), capital intensity, margin trend/stability, and a project-defined
  earnings-quality heuristic (accrual ratio + CFO/operating-profit
  consistency) explicitly labeled as such, not a named external formula.
- **Piotroski F-Score and Altman Z-Score: not implemented, by design.**
  Screener's balance sheet has no Current Assets/Current Liabilities split
  (bundled into non-decomposable "Other Assets"/"Other Liabilities" plugs),
  which blocks both textbook formulas. 8 of Piotroski's 9 signals are
  technically computable from what Phase 1 now parses, but shipping an
  "8/9" score under the name "Piotroski Score" would misrepresent the
  9-signal formula to a reader — both fields render `null`, documented once
  in a top-level `data.dataLimitations` array (not repeated per stock)
  alongside the same root cause blocking EV, EV/EBITDA, Cash, Net Debt, and
  Current Ratio.
- **PEG near-zero-growth guard** (`data/analytics/metricsTable.mjs`,
  `data/scoring/factors.mjs`): found during validation — Triveni Engineering
  showed PEG 126.88 (P/E 20.3 ÷ EPS CAGR 0.16%), mathematically correct but a
  division-by-near-zero artifact, not a meaningful comparable multiple. PEG
  now requires 5-year EPS CAGR > 2% before computing, in both the Stock
  Metrics table and the valuation scoring factor.
- **Stock Metrics tab overhaul** (`index.html`, `script.js`): expanded from
  one 12-column table to 5 grouped card/table blocks (Valuation,
  Profitability, Balance sheet & risk, Growth & earnings quality, Ownership)
  covering the mandate's ~30-field institutional comparison list, sourced
  from a new `buildStockMetrics()` (`data/analytics/metricsTable.mjs`) per
  stock. Fields this data source cannot verify (EV, EV/EBITDA, forward P/E,
  cash, net debt, current ratio, Piotroski, Altman Z) render as explicit
  "N/A" columns rather than being silently omitted.
- **New Fundamentals tab** (`index.html`, `script.js`): per-stock pill
  selector defaulting to the top-ranked stock; DuPont and ROCE decomposition
  cards; earnings-quality/capital-intensity cards; 10-year Profit & Loss,
  Balance Sheet, Cash Flow, and Ratios tables (row-per-metric,
  column-per-year); annual shareholding-pattern table. Tabular only, no
  charting library, consistent with the app's no-build-step design. US/Global
  stocks show a "Limited data" card instead of empty tables.
- **Rating/tag styling** (`styles.css`): added `.strong-buy`, `.accumulate`,
  `.reduce`, `.sell` tag classes and a `.limited-data` badge alongside the
  existing `.buy`/`.hold`/`.neutral`; a `.pill-row`/`.pill` component for the
  Fundamentals tab's stock selector.
- **Overview tab**: methodology list now describes the 12-factor model and
  the 40%-completeness gating; disclaimer card surfaces
  `data.dataLimitations`.

### Validation completed

- `node --check` passed for every new/modified `.mjs` file.
- Live-queried `/api/research` for India (`Sugar & Biofuel`, 9 stocks;
  `Banking`, 8 stocks): confirmed ~10 years of real P&L/Balance
  Sheet/Cash Flow/Ratios data, quarterly + annual shareholding history, and
  `recommendation.factors` populated with real values for large-cap and
  small-cap stocks alike (including the two standalone-fallback and
  shareholding-div bugs found and fixed above). Confirmed Piotroski/Altman/
  current ratio/EV/cash/net debt are `null` with `dataLimitations` present.
- Live-queried `market=United States` (`Semiconductor`) and `market=Global`:
  confirmed price/technical fields unchanged, fundamentals fields `null`
  with `source:'Not configured'`, `compositeScore: null`,
  `rating: 'Insufficient data for institutional score'`, and a real non-null
  `technicalScore` (~15% data completeness from technical trend + momentum
  factors, which don't require fundamentals).
- Latency: cold India-sector query ~1.2s (unchanged order of magnitude from
  pre-Phase-1, since expanded parsing adds no new HTTP requests); warm
  (cached) repeat query ~0.1s.
- Confirmed the pre-existing "Pharmaceuticals India" symbol-search-fallback
  limitation (documented in the 2026-08-11 entry below) is unrelated to this
  work and unchanged.
- Full browser walkthrough via Playwright (India: Sugar & Biofuel; US:
  Semiconductor) — zero console/page errors. Verified visually: Stock
  Metrics tab's 5 blocks render real numbers for India and correct
  "Insufficient data"/"N/A" for US; Fundamentals tab's pill selector, DuPont/
  ROCE cards, and 10-year statement tables render correctly and update on
  pill click; US Fundamentals tab shows the "Limited data" card without
  errors; rating tags render with distinct styling per tier.

### Known limitations (new in this phase, by design)

- US/Global stocks have no fundamentals source in Phase 1 — Stock Metrics,
  Fundamentals, and the composite score are limited to price/technical data
  for those markets until a paid API is integrated (the provider-abstraction
  seam this phase built is designed for exactly that).
- Piotroski F-Score, Altman Z-Score, EV, EV/EBITDA, Cash, Net Debt, and
  Current Ratio are not available for any market in Phase 1 — Screener.in's
  exposed schema has no Current Assets/Current Liabilities split or explicit
  Cash line item. See `data.dataLimitations` in the API response.
- Segment/geographic/customer-concentration data and Screener's own peer
  comparison table are not integrated — both are AJAX-loaded on Screener's
  page rather than present in the initial HTML, and were out of scope for
  this phase's spike.
- Target price, fair value, DCF/reverse-DCF, and expected return are Phase 2
  — the recommendation shape carries these keys as `null` already so Phase 2
  can fill them without a response-shape change.

## 2026-08-11 — Dashboard information-architecture restructuring

### Objective

Reorganize the dashboard around a standard sector taxonomy, a consistent
stock-card metric layout, and a clean Overview/Technical split, per the
sector-dashboard restructuring brief.

### Implementation status: done

- **Sector taxonomy** (`index.html`): the sector datalist now lists exactly
  the 36 standard sectors from the brief (Banking through Diversified
  Conglomerates), replacing the old ad hoc 17-entry list. Market-scoping for
  every sector was already generic (`isInSelectedMarket()` in
  `server.mjs`, unchanged) — presets are additionally scoped per market, and
  free-text/non-preset sectors fall back to a market-filtered public symbol
  search, so no sector can return results outside the selected market.
- **Preset alignment** (`server.mjs`): renamed `sectorPresets` keys
  `utility` → `utilities` and `energy` → `oil & gas` in all three market
  blocks so they substring-match the new taxonomy's exact sector names
  (`"utilities".includes("utility")` is false — the old key silently never
  matched "Utilities" typed verbatim). 7 of the 36 sectors have curated
  per-market presets (Banking, Renewable Energy, Semiconductor, Oil & Gas,
  Power, Utilities, Sugar & Biofuel); the rest use the existing symbol-search
  fallback.
- **`&` sanitization bug fix** (`server.mjs`): `clean()` was stripping `&`
  from the `sector` query param as a blanket XSS precaution, silently
  corrupting ~6 of the 36 standard names ("Oil & Gas" → "Oil  Gas", etc.) and
  breaking preset matching for any of them. `sector` is only ever written
  via `textContent` in `script.js`, never `innerHTML`, so a bare `&` carries
  no injection risk there; `clean()` now strips only `<>"'`.
- **Data contract** (`server.mjs`): every stock object now always carries
  `price`, `signal`, `pe`, `industryPe` (previously `signal` was computed
  ad hoc in `script.js` from `score`, and `industryPe` did not exist).
  `signal` is computed once, server-side, from the same `score` every table
  already showed. `industryPe` is the sector's own average P/E across the
  screened universe (there is no separate per-industry classification data
  source), applied uniformly per stock so it reads as a genuine peer
  benchmark — `null`/"N/A" when no stock in the sector has a valid P/E.
- **Real technical indicators** (`server.mjs`): added RSI (14, Wilder's
  smoothing) and a 20-day average-volume comparison, both computed from the
  chart endpoint's existing daily close/volume history (no new data
  source). Added derived `trend` (Uptrend/Downtrend/Sideways, from
  price vs. 50/200-day averages), `momentum` (Strong/Neutral/Weak, from
  RSI), and `volumeTrend` (Above/Below/Average, from volume vs. its 20-day
  average) labels per stock.
- **Stock-card standardization** (`index.html`, `script.js`): the
  Overview-only card component (`stockCard()` in `script.js`) now renders
  Company Name → Ticker → Price → Signal → P/E → Industry P/E in that fixed
  order on every card, with Industry P/E always rendered (as "N/A" when
  absent) so P/E never appears without it. The cards previously appeared on
  every tab (`data-quick-ref` divs in `leaders`, `metrics`, `valuation`,
  `technical`, `portfolio`, `risks`, `news`); they were removed from all of
  those and now render only inside `#overview`.
- **Technical tab restructuring** (`index.html`, `script.js`): replaced the
  old `#technical-list` trend-row list with a `#technical-table`, columns
  in order: Company (row header) → Signal → Price → P/E → Industry P/E →
  RSI (14) → 50 DMA → 200 DMA → 52W High → 52W Low → Distance from 52W
  High → Trend → Momentum → Volume Trend. All numeric columns are
  right-aligned (`.tech-table .num`); Signal keeps the existing
  BUY/ACCUMULATE/HOLD color coding shared with every other table via
  `signalTag()`. No company-overview content remains on this tab.
- **Overview/Technical separation**: Overview retains company cards,
  sector KPIs, executive summary, sector-allocation lens and the data-policy
  disclaimer. Technical retains only breadth KPIs and the indicator table.
  Neither duplicates the other's markup; both read `stock.signal`,
  `stock.pe`, `stock.industryPe` from the same backend fields via the same
  `signalTag()`/`fmt()` helpers — no duplicate rendering logic.
- **Responsive**: cards and technical-table rows use the same DOM order at
  every breakpoint (no CSS reordering), so metric order (Price → Signal →
  P/E → Industry P/E on cards) is identical on desktop, tablet and mobile
  by construction.
- **Visual consistency** (`styles.css`, inline `index.html` styles): P/E and
  Industry P/E share the same `.metric-value` typography; Industry P/E adds
  `.industry-pe` (`color: var(--muted)`) as a secondary tone. Signal uses
  the existing `.tag` treatment, kept visually distinct from plain metric
  values.

### Validation completed

- `node --check` passed for `server.mjs` and `script.js`.
- Ran the server locally and queried `/api/research` directly: confirmed
  every stock object carries non-`undefined` `price`/`signal`/`pe`/
  `industryPe`/`rsi`/`trend`/`momentum`/`volumeTrend`.
- Confirmed renamed presets resolve correctly and stay market-scoped:
  India/US "Banking", Global "Semiconductor", US "Utilities", and (after
  the `&`-stripping fix) India "Oil & Gas" all returned symbol lists native
  to their market.
- Confirmed the `&`-stripping bug: before the fix, `sector=Oil %26 Gas`
  reached `tickerList()` as `"Oil  Gas"` and matched no preset; after the
  fix it round-trips as `"Oil & Gas"` in the JSON response and matches the
  `oil & gas` preset.
- Confirmed no dead selectors remain: grepped for `quick-meta`,
  `quick-signal`, `trend-list`, `trend-row` (all removed with the elements
  they styled) across `index.html`/`script.js`/`styles.css` — no matches.
- Confirmed static assets still serve (`index.html`, `script.js`,
  `styles.css` all return 200).

### Known limitation (pre-existing, unchanged by this work)

29 of the 36 taxonomy sectors have no curated ticker-universe preset and
depend on Yahoo's public symbol-search endpoint, which returns zero
results for some compound market+sector queries (confirmed directly
against the endpoint for "Metals & Mining India NSE" and "Media &
Entertainment India NSE" — both return `quotes: []`). This is the same
external-dependency limitation already documented in the entry below; the
app surfaces it as an explicit error rather than mismatched data. Adding
curated presets for the remaining sectors across all three markets was out
of scope for this restructuring (would mean hand-building on the order of
100 ticker lists) and was not requested.

## 2026-08-11 — Flow Integrity Audit remediation

### Audit findings addressed

1. **Scoring pipeline (critical).** `score()` in `server.mjs` read
   `returnOnEquity`, `profitMargins`, and `debtToEquity` directly off the
   Yahoo chart-endpoint quote object. That endpoint never returns those
   fields for any market — they only exist on the India Screener.in
   enrichment path. For US/Global stocks, 3 of the function's 5 conditions
   could structurally never fire, capping every non-India score around 64
   and making the UI's BUY threshold (`score >= 70`, see `signal()` in
   `script.js`) unreachable regardless of how strong the company was.
2. **Market-aware sector presets (high).** `tickerList()` matched sector
   keywords against a single flat `presets` object shared by every market,
   guarded only against the India-only `sugar` preset leaking elsewhere. It
   had no equivalent guard for `semiconductor`, `fintech`, `renewable
   energy`, or `banking` — so e.g. India + Semiconductor returned NVDA,
   AVGO, AMD... (US tickers) under an "India" market label, and India +
   Banking returned JPM, BAC, WFC... (US banks).
3. **API/UI contract mismatch (low).** The response included `eps`,
   `forwardPE`, `roa`, `margin`, `revenueGrowth` per stock, and `margin`/
   `growth` in `averages`. All five were computed from the same
   never-populated Yahoo fields as finding #1, so they were always `null`,
   and `script.js` never rendered any of them.

### Implementation status: done

- `server.mjs`: replaced the flat `presets`/`indiaPresets`/`usPresets`/
  `globalPresets` maps with one `sectorPresets` object keyed by market
  (`India` / `United States` / `Global`), each with its own
  semiconductor/fintech/renewable-energy/banking/power/utility/energy
  universe. `tickerList()` now looks up `sectorPresets[market]` directly —
  there is no path left for a preset to answer under the wrong market.
- `server.mjs`: replaced `score()` with a market-aware model
  (`trendSignal()` + `score()`, see the assumptions comment directly above
  them in the file). India blends 60% Screener fundamentals (ROE, ROCE,
  debt/equity) with 40% price trend; US/Global is 100% price trend (50-day
  and 200-day moving averages, distance from the 52-week high, daily
  move). Every individual signal defaults to a neutral 50 when its input is
  missing instead of being dropped or zeroed, so missing data no longer
  silently drags a score down.
- `server.mjs`: removed `eps`, `forwardPE`, `roa`, `margin`, `revenueGrowth`
  from the per-stock object, `margin`/`growth` from `averages`, and the
  now-dead `percent()` helper (Option B from the audit — there is no real
  data source for these fields outside the removed dead reads, so rendering
  them would only ever show "N/A").

### Validation completed

Ran the server locally and exercised the live API (`/api/research`) end to
end:

- **Presets are market-consistent**: India+Semiconductor → DIXON.NS,
  CGPOWER.NS, SYRMA.NS, TATAELXSI.NS, MOSCHIP.NS, SPEL.NS, KAYNES.NS;
  US+Semiconductor → NVDA, AVGO, AMD, AMAT, TXN, ADI, MU, INTC, LRCX, QCOM;
  Global+Semiconductor → NVDA, AVGO, ASML, AMD, TSM, ...; India+Banking →
  SBIN.NS, ICICIBANK.NS, AXISBANK.NS, ...; US+Banking → BAC, JPM, USB, ...;
  Global+Banking → SAN.MC, BAC, JPM, MUFG, HSBC, .... `data.market` in every
  response matched the requested market, and every symbol in every case
  belonged to that market's own exchange/universe.
- **Scoring reaches BUY/HOLD across markets**: US+Semiconductor scores now
  run up to 80 (previously capped ~64, structurally unable to reach the
  BUY threshold). India+Semiconductor scores reach 71. US/Global+Banking
  both scored into the OVERWEIGHT recommendation band.
- **Dead fields are gone**: confirmed via response inspection that
  `eps`/`forwardPE`/`roa`/`margin`/`revenueGrowth` no longer appear on
  stock objects, and `margin`/`growth` no longer appear in `averages`;
  grepped `script.js` to confirm it never referenced any of the five.
- **Partial-data resilience**: India+Semiconductor returned 7/8 requested
  symbols (one ticker's quote fetch failed) without breaking the report;
  scoring and rendering degraded gracefully.
- **Request lifecycle / re-render continuity** (`script.js`): reviewed —
  unchanged by this remediation. `AbortController` cancellation,
  `requestNumber` stale-response guarding, and the tab-state/render logic
  were not touched, and a full field-compatibility check confirms every
  field `script.js` reads still exists on the new response shape.
- `node --check` passed for both `server.mjs` and `script.js`.

### Remaining work / deferred improvements

- Sectors with no preset (e.g. Pharmaceuticals, IT Services) still depend
  on Yahoo's public symbol-search endpoint, which returned 0 results for
  some compound queries during validation (e.g. "Pharmaceuticals India
  NSE"). This is a pre-existing external-dependency limitation, unrelated
  to the three audit findings, and out of this remediation's scope — the
  app already surfaces it as an explicit error rather than mismatched
  data ("No listed securities found...").
- India's semiconductor preset is necessarily an adjacent-industry proxy
  (EMS/design/component companies) since India has no major listed fab —
  documented inline in `server.mjs` where the preset is defined.
- `pb` (price-to-book) is still sourced from `q.priceToBook` for non-India
  stocks, which the Yahoo chart endpoint never populates (same root cause
  as the removed dead fields, but `pb` *is* rendered in the UI and was not
  named in the audit's dead-field list, so it was left as-is). Non-India
  reports will show "N/A" for P/B, consistent with the app's documented
  data policy for missing source fields.

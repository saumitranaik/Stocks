# System Architecture — Watchlist Research Workspace

Status: **Authoritative**. This document is the canonical description of what the
system *is* — architecture, data flow, module boundaries, and governance rules
that shape how the codebase may evolve. It is maintained alongside the code: any
change that alters a module boundary, a data flow, an API route, or a folder's
purpose must update this document in the same change.

This document does not track project history or what's planned next — see
[`docs/governance/roadmap.md`](../governance/roadmap.md) for that. For how
Claude Code should work in this repository (load order, token budget, working
rules), see [`CLAUDE.md`](../../CLAUDE.md).

---

## 1. Overview

### 1.1 Application purpose

A company-first, persistent equity research workspace for personal portfolio
management. A user builds named **watchlists** of companies (autocomplete by
name or ticker), the app fetches public price, fundamentals, and news data for
each company, and every analysis tab — Dashboard, Watchlists, Fundamentals,
Valuation, Profitability, Balance Sheet, Growth, Ownership, Technicals,
Portfolio, Risks — analyzes exactly the companies in the active watchlist, in
the watchlist's own order. A standalone printable research report can be
generated per company. This is a single-user, single-process local tool, not a
multi-tenant service.

### 1.2 Architecture summary

- **Runtime**: dependency-free Node.js (`node:http`, `node:fs/promises`,
  `node:path`, global `fetch`). No `package.json`, no npm, no build step, no
  bundler. The frontend is a single non-module `<script>` tag — vanilla DOM,
  no framework, no virtual DOM.
- **Process model**: one Node process (`server.mjs`) serves both the static
  frontend files and a small JSON REST API under `/api/`. All state lives in
  the process's own filesystem (`data/watchlists/`, `data/cache/`) — there is
  no database.
- **Data model**: everything the UI renders traces back to one function,
  `buildResearch()` (§5), which returns a single JSON payload per
  watchlist. Every tab is a pure read/format view over that one payload
  (`currentData` in the frontend) — no tab recomputes analytics, and no
  analytic is computed twice.
- **External dependencies**: three public, unauthenticated data sources
  (Yahoo Finance chart feed, Screener.in, Google News RSS — §4.1). No API
  keys, no paid vendor integration exists yet.

### 1.3 Major modules

| Module | Responsibility |
|---|---|
| `server.mjs` | HTTP server, static file serving, the full API route table |
| `data/providers/` | External data source abstraction (fundamentals, quotes) |
| `data/parse/` | Screener.in HTML → normalized fundamentals parsing |
| `data/watchlist/` | Watchlist persistence, research orchestration, caching, symbol search |
| `data/analytics/` | Pure calculation modules (valuation, technical, portfolio, risk, series math) |
| `data/scoring/` | The unified recommendation/rating engine |
| `data/decision/` | Portfolio Action Score, alerts, portfolio health, rebalancing — pure composition over already-computed analytics/scoring output (§3.7) |
| `data/quant/` | Institutional quantitative research domain — per-stock factor profiles, benchmark/performance/backtesting (Phase 7) — pure composition/normalization over already-computed analytics/scoring output (§3.9) |
| `data/reporting/` | Per-company printable report model + Portfolio Review Pack model (both derive from research, compute nothing new) |
| `data/metadata/` | The Sourced/Calculated/Heuristic metric tier registry |
| `data/news/` | Company news fetch + heuristic classification |
| `data/universe/` | Static NSE ticker reference data for local search |
| `index.html` + `script.js` + `styles.css` | The main dashboard SPA |
| `report.html` + `report.js` | The standalone printable report page |

---

## 2. Frontend architecture

### 2.1 Structure

`index.html` (shell) + `script.js` (~1700 lines, all logic) + `styles.css`
(shared with `report.html`). No framework, no build step: `script.js` is a
plain global-scope `<script src="script.js">`. Every render is an imperative
"rebuild this DOM subtree from `currentData`" call — template-literal strings
assigned to `.innerHTML`, invoked explicitly wherever state changes. There is
no reactivity system and no virtual DOM diffing.

### 2.2 State

- **`currentData`** — the single in-memory copy of the latest `buildResearch()`
  payload for the active watchlist. Every tab-render function takes it (or a
  slice of it) as input and formats it; nothing mutates it and nothing
  recomputes analytics client-side.
- **`activeCompanySymbol`** — one shared "active company" selection across the
  whole app (Fundamentals, Valuation, Technicals, Risks, Portfolio
  attribution, the header selector, and every clickable company row all read
  and write this one value via `setActiveCompany()`). Persisted to
  `localStorage` (`activeCompanyContext`) along with a 10-entry
  most-recently-used `recentCompanies` list.
- **Compare mode** — an orthogonal `compareMode`/`compareSymbols` (2–4
  companies) toggle. When active, the same per-company content-builder
  functions used for single-company detail views are called once per selected
  company and laid out in a grid (`compareGrid()`) — no separate
  comparison-computation code path exists.
- **Sub-tab selection** — per-tab, persisted to `localStorage`
  (`subtab:<tabId>`).

### 2.3 Sidebar workspaces and sub-tabs

**Phase 6.5** (2026-08-16) replaced the original flat top-tab nav with a
persistent left sidebar (`#app-sidebar`, `.sidebar-item` buttons, collapsible
to icon-only with text monograms, off-canvas drawer below 900px). The header
lost its old `<nav class="tabs">` row and is now a slim global context bar
only — no longer flat, see below — it does not duplicate the sidebar's
navigation.

**The IA redesign** (2026-08-28, this entry) replaced Phase 6.5's 9-item
sidebar (which included a "Research" *virtual group* over 6 independent
`.tab` sections, plus standalone Technicals/Risks tabs that each silently
mixed two different analytical scopes — a watchlist-wide comparison table
and a single-company deep-dive panel, in the same screen) with a sidebar
built around 4 genuine analytical scopes, per the target information
architecture:

```
Dashboard | Watchlists | Company Research | Watchlist Research |
Portfolio (Analysis) | Reports | Market Intelligence | Compare |
Sector Research (disabled placeholder — deferred, see below)
```

**Company Research** (`#company-research`) is one real `.tab` holding
everything that analyzes **one company at a time**: a single company-switcher
pill row pinned at the top (reuses `renderCompareAwarePillSelector()`, styled
distinctly — dashed pills, its own label — from the sub-analysis subtabs
below it, so the two are never visually confused), and a top-level subtabs
bar (Overview/Fundamentals/Valuation/Quality/Ownership/Technicals/Risks).
Fundamentals moved in wholesale (it was already 100% single-company content —
no split needed). Valuation/Technicals/Risks each split: their deep-dive
panels (`#valuation-detail-*`, `#technical-detail-*`, `#risk-detail-*`) moved
here as a **nested** second-level sub-nav (a `.subtab-root` — same
`.subtabs`/`.subsection` mechanism as a top-level `.tab`, just one level
deeper); their watchlist-wide comparison tables moved to Watchlist Research
instead (see below). Two small additions, both pure presentation reuse of
already-computed fields (zero new calculation, per the single-computation-
site rule in §8): `companyOverviewContent()` (Overview) and
`ownershipDetailContent()` (Ownership — no per-company deep-dive existed
there before; the 4 Ownership comparison tables' own `stock.metrics` fields
are reformatted as a single-company card). Quality reuses
`recommendationSummaryCard()`'s already-computed output a second time (same
string, second display location).

**Watchlist Research** (`#watchlist-research`) is one real `.tab` holding
everything that compares **every company in the active watchlist**.

**Watchlist Research IA consolidation** (2026-08-29, follow-on to the split
above): a data/IA audit of this workspace (every view, field, calculation and
N/A cause, cross-referenced against `data/analytics`/`data/quant`/
`data/decision` source) found the original 8-item sub-nav (Overview/
Performance/Ranking/Valuation/Quality/Growth/Risk/Opportunities) repeated the
same Company/Sector/CMP/P/E identity columns across many separately-clicked
tables and left several already-computed fields with no comparison-table
column at all. Collapsed to the target IA's 4-item top-level sub-nav —
**Overview / Fundamentals / Technicals / Risk & Opportunity** — by nesting
the previous 8 as one level of inner `.subtab-root` navigation each (the
same nested-subtab mechanism Company Research already established, `.tab` →
`.subtab-root` → `.subtab-root`, exercised 2 levels deep for the first time
here — Fundamentals → Quality → Profitability/Balance sheet/Ownership —
verified via a live jsdom click-through, no change needed to
`applySubtabState()`/`initSubtabs()`'s existing `closest('.tab,.subtab-root')`
scoping). Every comparison table kept its exact element id and `render*()`
function — only DOM parent/nav position moved, same technique as every prior
IA relocation in this app. Ranking's separate sub-tab folded into Overview as
a "Rank by" control + its existing top-5 table (unchanged, same
`opportunitiesSort` state Dashboard's Top Opportunities already shares);
Opportunities folded into Risk & Opportunity as a third sibling next to the
pre-existing Risk Overview/Alerts nested pair, dissolving no functionality.

Two genuinely new things were added, both zero-new-calculation reads of data
this payload already computed elsewhere and simply had no Watchlist Research
column before: **Overview** gained a `#wr-overview-table` screening matrix
(Recommendation/Confidence/Composite score/Upside %/Regime/Risk score/Action,
one row per company — every figure already sourced from `stock.recommendation`
/`.valuation`/`.technicalScorecard`/`.institutionalRisk`/`data.intelligence
.actionScores`, nothing recomputed); **Technicals** gained several columns
consolidated from the prior Performance tables' underlying data that existed
on the payload but had no cell: DMA cells now show the derived CMP-vs-DMA gap
% inline plus a new "DMA alignment" column (client-side arithmetic on
already-fetched CMP/DMA values, same precedent as the Risk table's existing
inline "downside to 200-DMA" cells); RSI state (`stock.momentum`), current +
average(20D) volume (`avgVolume20` — computed since Phase 1 but never
attached to the stock object until this change, one new field in
`research.mjs`'s per-stock return + one `metricRegistry.mjs` entry), 1Y
stock/benchmark return + benchmark identity in Relative Strength (read from
`stock.performance.periods['1Y']`/`.benchmark`, Phase 7 Stage 2 output that
had shipped backend-only with no UI consumer until now), real annualized
Volatility % alongside the existing Volatility Score (`stock.volatilityPct`,
already computed for beta/DCF, not previously surfaced), and Signal
Confidence + ADX interpretation in Signals. "Breakout probability" is
relabeled **"Breakout Score"** in this workspace (display label only, the
underlying `breakoutProbability` field/formula is unchanged) — the metric
registry's own `technicalScores` entry already discloses it as "screening
scores, not statistical probabilities," so the UI label now matches the
already-disclosed methodology instead of contradicting it. The duplicate
in-page "Watchlist Research / <name> · N companies" heading this workspace
picked up from the 2026-08-28 Company Context fix was removed — the global
header's "Watchlist context" bar already names the active watchlist on every
workspace, so repeating it here was exactly the kind of duplicated context
heading that fix's own Phase 7 audit calls out.

**Company Research one-page redesign + Watchlist Research data-parity pass**
(2026-09-03): a field-level audit of every metric displayed in Company
Research and Watchlist Research (the two workspaces covered by this task,
per its own explicit brief) found six backend-computed analytical domains
that existed on every research payload but were rendered nowhere in the live
dashboard — Company Quality/Stock Attractiveness/Fundamental View/Market
View/Action Guidance (`stock.recommendation.*`), Thesis Tracking + Thesis
Breakers (`intelligence.thesis[symbol]`), Research Quality Gates
(`stock.researchQuality`), the Phase 7 Stage 1 Quantitative Factor Engine
(`stock.quantFactors` — not even surfaced in the standalone report), and
most of the Phase 7 Stage 2 Benchmark & Performance engine
(`stock.performance` — only the trailing-1Y figure had a UI consumer before
this change). Every field was already tagged in `metricRegistry.mjs`; this
change is pure UI wiring, zero new calculations, zero new registry entries.

Company Research's 7 click-to-switch top-level tabs (Overview/Fundamentals/
Valuation/Quality/Ownership/Technicals/Risks, several with their own nested
tab-switching sub-nav) are replaced with **one scrolling page per company**:
a sticky in-page anchor nav (`.cr-page-nav`, plain scroll-links with a
lightweight `IntersectionObserver` highlighting the section in view — not
tab-switching, every `.cr-section` stays in the DOM and visible at once)
over 7 sections — Snapshot, Valuation, Quality & Financial Health, Growth,
Technical Position, Risk, Intelligence. Every existing content-builder
function (`fundamentalsContent()`, `valuationDetailContent()`,
`technicalDetailContent()`, `riskDetailContent()`, `ownershipDetailContent()`)
is reused verbatim, just inserted into the new stacked layout instead of a
tab-switched panel — no information loss, same technique as every prior IA
relocation in this app. Two content gaps are filled: **Growth**
(`companyGrowthContent()` — no per-company growth view existed before, only
the Watchlist Research comparison table; reads the same `stock.metrics`
growth fields `renderGrowthTab()` already uses) and **Quality & Financial
Health**'s new `companyQualityContent()` (replaces the former "Quality" tab,
which had reused the Valuation recommendation card verbatim with no distinct
content of its own). **Intelligence** is a wholly new section
(`companyIntelligenceContent()`) surfacing Thesis Tracking/Breakers, the
Quantitative Factor Score (explicitly disclosed, per the Phase 7 product
rule, as a signal that never overrides the primary Recommendation), and
Research Quality Gates. `technicalDetailContent()` gained a fifth fragment,
Relative Performance (3Y/5Y CAGR, max-drawdown detail, Sharpe-like/
Sortino-like proxy ratios — the first UI consumer of most of
`stock.performance` beyond the existing 1Y figure). The Valuation section's
Relative Valuation card gained Peer Tier/Peer Completeness
(`stock.relativeValuation.peerTier/.peerCompleteness`, previously report-only).

Watchlist Research gained columns on 4 existing tables — no new table, per
the locked one-table-per-tab architecture (`Company | Sector | CMP | P/E`
prefix unchanged everywhere): the Overview screening matrix
(`#wr-overview-table`) gained Company Quality, Stock Attractiveness and
Factor Score; the Valuation table gained Sector rank, Relative
attractiveness score and Peer completeness; the Technicals → Relative
strength table gained 3Y/5Y CAGR; the Risk & Opportunity stock-by-stock risk
matrix gained Thesis status. Research Quality Gates and the Forward
Framework (always-unavailable schema) stayed Company-Research-only —
neither is a comparable screening metric. Files changed: `index.html`,
`script.js`, `styles.css` — no analytics/scoring/decision/quant/provider/API
change; every field read here was already computed and already registered.

**Scrolling/table-usability audit + Technicals raw-indicator parity +
Company Research UI redundancy removal** (2026-09-03, follow-on to the pass
above): fixed a sticky-hierarchy bug where a nested `.subtab-root`'s own
`.subtabs` bar shared the exact same `top:var(--header-h)` offset as the
outer nav above it, painting over it instead of docking below — a new
JS-measured `--subtabs-h` var (same pattern as `--header-h`, `script.js`'s
`syncHeaderHeight()`, now also re-run on every `activateWorkspaceTab()` call
since showing/hiding Company Research's `#company-context-bar` changes the
header's own height) plus depth-aware `top` offsets on `.subtab-root
.subtabs`/`.subtab-root .subtab-root .subtabs` make nested sticky bars stack
instead of overlap. Every Watchlist Research comparison table's `<thead>` is
now sticky too (`.thead-sticky-1/2/3`, depth-aware the same way), docking
under whichever nav bars are stacked above that specific table, without a
second inner scrollbar — the wrapping `.scroll` div still only ever produces
a horizontal one. A new generic column-sort mechanism (`sortForTable`/
`initTableSort`/`applySortIndicators`) is wired onto all 14 Watchlist
Research comparison tables: click a `th[data-sort]` header to sort
ascending/descending/back to natural order, N/A always last, re-rendering
through the existing full `render(currentData)` cascade so it composes with
Compare Mode and active-company highlighting for free. Watchlist Research's
Technicals tables gained the raw indicator columns Company Research's
per-company card already showed but had no comparison-table column: ADX/
DI+/DI-/Support/Resistance (Trend), MACD line/Signal line/Histogram
(Momentum), OBV/OBV trend/Accumulation-Distribution/its trend (Volume), ATR/
ATR % of price (Volatility) — zero new calculation, zero new
`metricRegistry.mjs` entries. Company Research's header Quick Jump row +
Compare toggle were removed (per the user's own screenshot): `
#company-context-bar` is only ever shown while already on Company Research,
so Quick Jump could never be used to jump *to* it from elsewhere, and its
destinations already exist, more completely, on the page's own
`.cr-page-nav`; Compare Mode's on/off toggle moved onto the dedicated
Compare workspace's own button (now a real toggle, not "turn on" only),
consolidating one function into one place instead of two. The top-of-page
"Company" pill-row switcher (`#valuation-selector`) and its intro paragraph
were also removed as a duplicate of the header's own `#company-selector-toggle`
dropdown, which remains the one company switcher for this workspace. Files
changed: `index.html`, `script.js`, `styles.css` — no analytics/scoring/
decision/quant/provider/API change.

**UI regression audit — Company Research nav sync, Watchlist Research sticky
headers, sort affordance** (2026-09-03, follow-on correction to the pass
above): the prior entry's sticky-header/thead claims did not hold up under
real-browser testing (its own validation note already disclosed why: no
headless-Chromium tooling was available for that pass, so pixel-level sticky
correctness was checked by "static reasoning over the CSS," not observed). A
live Puppeteer-driven-Chrome audit against a scratch server (never the user's
own dev server) found three real defects and fixed each:

1. **Header/nav desync** (`script.js`): `render(data)` (every data load,
   watchlist switch, refresh, mutation) and `setActiveCompany()` (every
   company switch) both change the header's own rendered height (`#status`
   badge text length, `#company-context-bar` content) but neither called
   `syncHeaderHeight()` — so `--header-h`/`--subtabs-h` routinely went stale
   the moment either fired, throwing off every sticky offset that depends on
   them. Both now call it. Company Research's scrollspy
   (`initCompanyResearchPageNav()`) had two further, independent bugs on top
   of that: its `IntersectionObserver` used a hardcoded `-120px` band with no
   relation to the real (150-300px+) sticky offset, so a section could read
   as "active" while still hidden behind the sticky bars; and it derived
   "the visible section" solely from each callback's own `entries`, which
   only ever contains targets whose ratio just crossed a threshold (not
   every target still intersecting per the IntersectionObserver spec) — a
   section already in view could silently drop out of consideration,
   flipping the highlight to a stale section. Fixed by tracking intersecting
   sections in a persistent map and rebuilding the observer, with a
   dynamically-measured offset, from inside `syncHeaderHeight()` itself (one
   function now keeps the CSS vars and the nav highlight in sync together)
   plus a same-tick default to the first section so scrollY 0 is never
   unhighlighted.
2. **Sticky `<thead>` provably non-functional, not just mis-offset**
   (`styles.css`): confirmed live (a controlled long-scroll test against the
   real page, not reasoning) that `position: sticky` on `thead th` inside
   `.scroll`'s `overflow-x: auto` wrapper never actually engages in real
   Chromium — the cell just tracks page scroll 1:1 forever, which is why
   headers appeared to "float" wherever the table's natural scroll position
   put them (matching the reported screenshot of a header rendering after
   several data rows). This is a known, still-open CSS spec gap
   (csswg-drafts#865): a `position: sticky` table cell is defeated by *any*
   ancestor with non-visible overflow, and `.scroll`'s horizontal-scroll
   overflow is exactly that — no combination of `border-collapse`,
   `.card`'s `overflow: hidden`, or splitting `overflow-x`/`overflow-y`
   avoided it. The one configuration confirmed (live) to work in both axes
   at once is the pattern most production data grids use for this exact
   combination: `.scroll` itself becomes the sticky cell's real, bounded
   scroll container (`max-height` reserving the tallest possible sticky-nav
   stack, `overflow-y: auto`, `overflow-x: auto` unchanged), with the header
   sticking to `top: 0` of that container instead of a page-relative offset.
   Scoped via `:has()` so every non-sticky `.scroll` table (Macro/Sector
   Intelligence, correlation matrix, etc.) is untouched. This does introduce
   one bounded internal scrollbar per Watchlist Research comparison table
   where its content exceeds the reserved height — a deliberate, verified-
   necessary exception to the prior "no second scrollbar" design note, not
   an oversight; the page itself still scrolls normally around/between
   tables, and horizontal scroll remains column-aligned with the header
   (confirmed live).
3. **Sort affordance invisible until clicked** (`styles.css`): `th[data-sort]`
   had a hover-color change and `cursor: pointer` but no glyph until a column
   was actively sorted — every sortable header now carries a dim neutral ↕ at
   rest, opaque ▲/▼ once sorted (unchanged).

No analytics/scoring/decision/quant/provider/API change; `data/watchlists/`
and `data/cache/` untouched (the scratch server used for validation shares
those files with the user's real server — the one incidental write, an
`activeWatchlist` pointer changed by testing a watchlist switch, was
reverted before finishing, confirmed via `git diff`). Files changed:
`script.js`, `styles.css`.

**Watchlist Research scrolling architecture reconsidered — floating header
clone replaces the bounded per-table scrollbox** (2026-09-03, follow-on UX/
architecture review of the pass immediately above): the prior entry's fix —
making `.scroll` itself a bounded `overflow-y:auto` container per table, so
its sticky `<thead>` had a real scrolling ancestor to clamp against — was
accepted as *working* but rejected on UX grounds: it traded one real bug
(sticky non-functional) for 14 nested vertical scroll contexts, each capped
to a fraction of the viewport, contrary to the single-page-scroll UX this app
holds to everywhere else. The review's brief required evaluating genuine
alternatives before accepting that trade, not simply re-asserting "CSS can't
do this."

Three architectures were evaluated, live, against a scratch server (Puppeteer-
driven real Chrome, never the user's own dev server, same discipline as the
prior audit):

- **Page-level sticky header, single `<table>` markup** (keep `.scroll`
  purely horizontal, put `position:sticky` back on `thead th` relative to the
  page): re-confirmed broken, and more rigorously than the prior pass — a
  from-scratch minimal repro isolated the csswg-drafts #865 gap (`position:
  sticky` on a table cell is defeated by *any* ancestor with overflow other
  than visible) and showed it holds even with `overflow-x`/`overflow-y` split
  onto separate values, even with zero overflow ancestors reachable from the
  same table at all elsewhere on the page, and even with `border-collapse:
  separate` — ruling out every variant of "just tune the CSS further" for
  this exact "single `<table>`, `.scroll` needs horizontal-only overflow"
  combination.
- **Two-table split** (header and body as separate `<table>` elements, width-
  synced, so the header sits outside the horizontal-scroll ancestor
  entirely): rejected before implementation — it would require abandoning the
  single semantic `<table>` (splitting `thead`/`tbody` across two elements
  breaks the native header/cell association a real single table gives screen
  readers for free), for no benefit over the option below.
- **Floating header clone** (selected): the real `<thead>` stays exactly
  where it is — in normal page flow, fully accessible, never sticky. A
  purely visual `position:fixed` clone of just the header row is shown only
  while the real header has scrolled above the sticky nav stack and the
  table's own rows still extend below it. `position:fixed` is not subject to
  the csswg-drafts #865 gap at all (confirmed live before committing to this
  approach) since it isn't a sticky/scroll-relative positioning scheme —
  it's a viewport coordinate the code sets directly.

Implementation (`script.js`, new code near `STANDARD_SORT_KEYS`; `styles.css`
gained `.floating-thead`/`.floating-thead.visible`, replacing the deleted
`.scroll:has(...)`/`.thead-sticky-N thead th{position:sticky}` rules):
`.scroll` reverts to purely horizontal-scrolling (no `max-height`, no
`overflow-y`) across all 14 Watchlist Research comparison tables — the
bounded per-table scrollbox is gone, restoring one natural page-level
vertical scroll. The clone is rebuilt from the real header's current markup
and rendered column widths (`table-layout:fixed`, pixel widths copied from
the real `<th>` cells) every time it is shown, never hand-maintained, so it
cannot drift out of sync with a sort/re-render the way a persistent second
copy could. Horizontal scroll syncs via `transform: translateX()` mirroring
the real `.scroll` container's own `scrollLeft` — no second horizontal
scrollbar. The depth-aware offset (1/2/3 stacked nav bars above a table,
`thead-sticky-1/2/3`) reuses the same `--header-h`/`--subtabs-h` measurement
`syncHeaderHeight()` already maintains, now also triggering
`refreshFloatingHeaders()` (covering every call site that already funnels
through it: data load, company switch, workspace switch, resize) plus a new
call from `applySubtabState()` (a subtab switch changes which table is
visible without firing resize/scroll, so the floating header for a newly-
shown table must be evaluated immediately, not on the next scroll tick).
Sorting is delegated, not duplicated: a click on a clone header cell replays
as a real `.click()` on the corresponding real `<th>` at the same column
index, so `initTableSort`'s existing delegated listener — and everything
that follows from it, including the full `render(currentData)` re-render —
remains the only place sort state actually lives. Accessibility: the clone's
wrapper is `aria-hidden="true"` (the one real, fully-labeled table is the
only thing assistive tech encounters) with every cloned cell defensively
`tabIndex=-1`.

Validated live (Puppeteer-driven real Chrome against a scratch server, each
scenario in its own isolated browser context to avoid this app's own
by-design `localStorage` subtab/company persistence leaking state between
scenarios): zero nested vertical scroll contexts remain on Watchlist Research
at three viewport heights (600/900/1400px) and at the 540px mobile
breakpoint; a table nested two `.subtab-root` levels deep (Fundamentals →
Quality → Profitability, `thead-sticky-3`) shows exactly one floating header,
correctly stacked below all three real nav bars; column alignment between
the floating clone and the real body rows measured pixel-exact both at rest
and after a horizontal scroll; clicking a floating-clone header cell sorted
the real table (verified strictly ascending/descending on a numeric column)
and the clone rebuilt itself showing the resulting sort indicator, never
desynced; switching subtabs mid-scroll correctly swapped which table's
floating header was showing with no gap or stale duplicate; a real mouse-
wheel walkthrough (25 ticks) scrolled the page naturally to its end with
never more than one floating header visible at any point; `PageDown`
advanced the page; no `.floating-thead` descendant is keyboard-focusable;
zero duplicate DOM ids; Company Research's unrelated scrollspy/nav mechanism
confirmed unaffected. `node --check script.js` clean; `node --test`: all 109
tests / 36 suites pass (no analytics/scoring/decision/quant module touched).
No incidental writes to `data/watchlists/`/`data/cache/` this pass (no
watchlist-mutating route was ever called against the scratch server).
Files changed: `script.js`, `styles.css`.

**Nested sub-navigation**: `applySubtabState()`/`initSubtabs()` now scope
`.subsection` matching to the *nearest* owning root via
`panel.closest('.tab,.subtab-root')`, so a `.subtab-root` nested inside a
`.tab`'s own subsection (e.g. Company Research → Valuation's DCF/Reverse DCF/
Sensitivity/Relative valuation/Historical valuation nav) coexists with the
outer root's own nav without one's `applySubtabState()` pass touching the
other's panels. `$$('.tab,.subtab-root').forEach(initSubtabs)` (was
`$$('.tab')`) is the only other change to this mechanism — every existing
single-level tab/sub-tab pair is unaffected.

**Header context bar** (§17 of the redesign brief): the existing two-row
toolbar (`#watchlist-bar`, `#company-context-bar`) gained explicit
"Watchlist context"/"Company context" micro-labels (`.context-row-label`) so
which selector controls what is never inferred from the controls alone —
purely additive, no control removed or moved.

**Company Context scoping correction** (2026-08-29, follow-on to the IA
redesign above): the redesign moved single-company deep-dives into Company
Research, but left `#company-context-bar` (selected company name/ticker/
sector/price/rating, Quick Jump, and the Compare toggle) rendered globally in
the header on every workspace — so Watchlist Research, Market Intelligence,
Portfolio Analysis, Dashboard, Watchlists, and Compare all visually implied
they were analyzing whichever company happened to be last-selected, even
though none of them are company-scoped. Fixed with a small conditional-
visibility change, no new component: `activateWorkspaceTab()` (`script.js`)
now toggles `hidden` on `#company-context-bar`/`#company-context-label`,
shown only when `tabId === 'company-research'` (`#company-context-bar[hidden]`
CSS added since `.toolbar`'s own `display:flex` would otherwise out-cascade
the attribute, the same pattern `.subsection[hidden]`/`#research-category-bar
[hidden]` already use). `activeCompanySymbol` and every render function that
reads it are unchanged — this is purely a visibility toggle on an
already-existing element, not a state change. Watchlist Research and
Portfolio Analysis each gained a small in-page watchlist-context line
(`#wr-watchlist-context`/`#portfolio-watchlist-context`, set from `render()`'s
own `data.watchlistName`/`data.stocks.length` — no new computation) so the
active watchlist and its company count are still visible without the
company-scoped bar; Market Intelligence gained a static "Indian Equity
Market" context line under its own `.workspace-title`. Reports/Compare/
Dashboard/Watchlists needed no content change — Reports' existing
`#reports-active-company` line and Compare's own `#compare-selector` already
gave each its own correct scope-appropriate context.

**Portfolio → "Portfolio Analysis"**: no content/route change (it was already
100% watchlist/portfolio-scoped, no company-deep-dive mixing to split) — a
`.workspace-title` heading and a `.card.disclaimer` block make explicit that
Transactions (trade date/buy-sell/quantity/price/charges/cost basis/realized-
unrealized P&L) is future, deferred functionality, not built and not faked.

**Sector Research**: a disabled sidebar entry only (`.sidebar-item-disabled`,
no `data-tab`, no section, no route, no data) — reserves the nav slot per the
target IA's explicit future-extensibility requirement without implying
market-wide coverage exists. Deferred pending a security-universe/
classification data source (`docs/governance/roadmap.md` TD-10/03.8). Sector
Intelligence (§3.8) is unrenamed and unmoved — it remains under Market
Intelligence, unchanged in meaning, since it's cross-watchlist and doesn't
fit the new single-active-watchlist-scoped Watchlist Research destination.

**Compare**/**Reports**/**Market Intelligence** are otherwise unchanged from
Phase 6.5 (Compare's `renderCompareAwarePillSelector()`+`compareGrid()`
reuse, Reports' 3 shared launch helpers, Market Intelligence's 4 relocated
sub-tabs) — Quick Jump's `data-jump` targets were updated to
`"<tab>:<subtab>"` pairs (e.g. `"company-research:cr-valuation"`) so they land
on the correct Company Research dimension, not just the workspace.

Every workspace/sub-tab is still a pure client-side visibility toggle over
already-rendered DOM — none of this redesign's changes touch an API route,
a data-flow step, or an analytics/scoring module; confirmed live (jsdom
harness against a scratch-port server) that navigating through every
workspace, every sub-tab, and every nested deep-dive sub-tab renders real
content with zero console errors and zero duplicate element ids.

**App-wide UX/data-parity consistency pass** (2026-09-04, follow-on to the
floating-header-clone/column-sort work above): a full audit (per an explicit
user brief) confirmed the floating-header-clone + column-sort standard that
commit `eaf024a` built for Watchlist Research had not been extended to
comparison tables elsewhere in the app, and found two narrow, genuine bugs
alongside it. **Extended the standard** (`sortForTable`/`initTableSort`/
`STANDARD_SORT_KEYS`-style `keyFns`, floating-header registration via the
generic `table[class*="thead-sticky-"]` selector) to 6 more tables whose row
count scales with watchlist size: Dashboard's Action Required
(`#pi-action-table`), Portfolio Analysis's screen-derived allocation
(`#portfolio-table`), Rebalancing suggestions (`#rebalancing-table`) and
Exposure Matrix (`#exposure-matrix-table`), and Market Intelligence's
Earnings Intelligence (`#earnings-intel-table`, floating header) and Sector
rollups (`#sector-intel-table`, sort only — bounded row count). Dashboard's
5-row Top Opportunities table and Market Intelligence's fixed ~6/~9-row macro
tables were audited and left alone (already have an equivalent sort control,
or too short to matter) — explicit, documented exceptions, not oversights.

The Watchlists tab's `#wl-table` — the single largest, most-used table in the
app — kept its existing bespoke 3-state sort (`wlSortColumn`/`wlSortDir`, no
defect in it, and it's entangled with the natural-order-only reorder buttons)
but gained the floating header it previously lacked. Since `#wl-table` sits
below a sticky `.wl-search-bar` rather than a `.subtabs` bar, the floating-
header offset scheme (`floatingHeaderOffset()`, `script.js`) was generalized
from a depth-number × `--subtabs-h` multiplier into a small
`FLOATING_HEADER_OFFSET_VARS` map summing whichever named CSS vars a given
`thead-sticky-*` class sits below — behaviorally identical for the existing
`thead-sticky-1/2/3` classes (N copies of `--subtabs-h` ≡ the old
multiplication), and now extensible to `thead-sticky-wl`
(`['--header-h', '--wl-searchbar-h']`), a new var measured in
`syncHeaderHeight()` the same way `--subtabs-h` already is. A real,
independent bug was found and fixed while doing this: cloning `#wl-table`'s
`<thead>` for the floating-header clone also cloned its bulk-select
checkbox's `id="wl-select-all"` into the (`aria-hidden`) clone, producing a
duplicate DOM id — `rebuildFloatingHeaderContent()` now strips every `id`
from the cloned subtree defensively. Separately, `wlFilteredSortedStocks`'s
Sector/Risk Trend/Technical Trend sort accessors used `|| ''` instead of
`|| null`, so a missing value sorted *first* ascending instead of last —
inconsistent with `isSortNA`'s N/A-always-last convention every other
sortable column in the app already follows; fixed to `|| null`.

**Company Research → Watchlist Research data-parity pass**: a field-level
audit (fundamental/technical/risk/intelligence domains, per the same brief)
found two more already-computed, already-registered fields with no
comparison-table column: `recommendation.fundamentalView`/`.marketView`
(short band labels, §4.6) — added as 2 columns on `#wr-overview-table` — and
`performance.riskAdjusted.sharpeLike`/`.sortinoLike`/`.risk.maxDrawdown`
(§3.9 Stage 2) — added as 3 columns on Watchlist Research → Technicals →
Relative strength (`#technical-table-relative-strength`). `actionGuidance`
(a full sentence) and the 1M/3M/6M performance periods (redundant with the
1Y/3Y/5Y figures already shown) were evaluated and intentionally excluded —
documented, not overlooked. Zero new calculation, zero new
`metricRegistry.mjs` entries — both additions read fields the institutional
research foundation upgrade and Phase 7 Stage 2 already computed and
registered. Files changed: `index.html`, `script.js` — no analytics/scoring/
decision/quant/provider/API change.

Validated live (Puppeteer-driven real Chrome against a scratch server, port
4187, never the user's own dev server on 4173): 37/37 assertions passed
across the Asmita watchlist (30 companies, the largest saved watchlist) and
Banking — column-sort asc/desc/natural cycles on every newly-wired table,
the Sector-sort N/A-last fix confirmed directly (N/A rows moved from first to
last), exactly one floating header visible at a time across 4 viewport sizes
(600/900/1400px desktop, 540px mobile — the mobile case needed the test to
locate the real thead's actual document position rather than assume a fixed
scroll offset, since the header/toolbar wraps into more rows at that width),
horizontal-scroll column alignment pixel-exact on `#wl-table`'s new floating
header, zero duplicate DOM ids (after the `id`-stripping fix), zero console
errors (the sole exception, `favicon.ico` 404, is the same pre-existing,
disclosed non-issue every prior validation note in this app records), and no
`NaN`/`undefined`/`null` leaking into any new cell. `node --check script.js`
clean; `node --test`: all 109 tests/36 suites pass (no analytics/scoring/
decision/quant module touched). The one incidental write during validation —
switching the scratch server's active watchlist to Asmita/Banking to exercise
each table — was reverted to its pre-session value (`defence`) before
finishing; `git diff` on every `data/watchlists/*.json` file showed only that
expected revert plus pre-existing uncommitted changes from the user's own
prior sessions (all with `addedAt`/`updatedAt` timestamps in August, weeks
before this pass).

### 2.4 Rendering pattern

`render(data)` is the one function that sets `currentData = data` and cascades
into every tab's own `render*()` function. It is called after every API
round-trip that returns a fresh research payload: startup, watchlist switch,
refresh, and every Watchlists-tab mutation (add/remove/reorder/reweight/note/
cash-target/import/duplicate/delete). Two-step loading is used everywhere a
watchlist is loaded or switched: an instant cache-only paint
(`networkPass: 'none'`), followed by a background incremental refresh that
re-renders once resolved.

### 2.5 Report view

`report.html` + `report.js` is a **separate static page**, opened via
`window.open('report.html?wl=<id>&symbol=<symbol>', '_blank')` — it shares no
runtime state with `script.js` (no shared globals, no shared render pipeline),
only the same data-tier badge convention and hand-written inline-SVG chart
helper style. It fetches `GET /api/watchlists/:id/report/:symbol`, which is
cache-only (never triggers a fetch), and renders a printable A4 "paper" theme
report distinct from the dashboard's dark terminal theme. PDF export is the
browser's own `window.print()` against the exact on-screen DOM/CSS — no PDF
library, no server-side rendering.

`portfolio-review.html` + `portfolio-review.js` (Phase 5) is the same
architecture applied at watchlist scope — a second standalone page, its own
copy of the paper-theme stylesheet and chart/formatting helpers (no shared
frontend module system exists to import them from, §1.2), fetching
`GET /api/watchlists/:id/portfolio-review` (also cache-only). Not a third
distinct pattern, just `report.html`'s own template reused for a different
scope.

---

## 3. Backend architecture

### 3.1 Server

`server.mjs` (single file, ~110 lines) is the entire HTTP layer: a manual
route table (method + regex pattern + async handler), static file serving for
everything outside `/api/`, and process startup (`await store.init()` before
`.listen()`, so the watchlist store is seeded before the first request can
race it).

### 3.2 API routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/companies/search` | Yahoo symbol-search fallback (autocomplete) |
| GET | `/api/companies/index` | Local search index (primary autocomplete data source) |
| GET | `/api/watchlists` | List all watchlists + active watchlist id |
| POST | `/api/watchlists` | Create a watchlist |
| POST | `/api/watchlists/active` | Switch active watchlist |
| PUT | `/api/watchlists/:id` | Rename a watchlist |
| DELETE | `/api/watchlists/:id` | Delete a watchlist |
| POST | `/api/watchlists/:id/duplicate` | Duplicate a watchlist |
| GET | `/api/watchlists/:id/research` | Cache-only research payload for a watchlist |
| GET | `/api/watchlists/:id/report/:symbol` | Cache-only per-company printable institutional research report |
| GET | `/api/watchlists/:id/portfolio-review` | Cache-only printable Portfolio Review Pack (Phase 5, §3.6) |
| GET | `/api/watchlists/:id/committee-pack` | Weekly Investment Committee Pack (Phase 6, §3.8) — watchlist half cache-only; macro/sector halves may trigger their own cache-first fetch on their own TTL |
| GET | `/api/macro` | Macro Intelligence snapshot + Market Regime (Phase 6, §3.8) — watchlist-independent, cache-first on its own 30min TTL |
| GET | `/api/sector-intelligence` | Sector Intelligence rollup across every saved watchlist (Phase 6, §3.8) — cache-only, the one cross-watchlist read in this app |
| POST | `/api/watchlists/:id/refresh` | Refresh (`force` = full refetch; `symbols[]` = targeted refetch; else incremental) |
| POST | `/api/watchlists/import` | Import a watchlist (same shape Export produces) |
| PUT | `/api/watchlists/:id/cash-target` | Set the watchlist's cash allocation target % |
| POST | `/api/watchlists/:id/companies` | Add a company |
| DELETE | `/api/watchlists/:id/companies/:symbol` | Remove a company |
| PUT | `/api/watchlists/:id/companies/order` | Reorder companies |
| PUT | `/api/watchlists/:id/companies/:symbol/weight` | Set a company's target weight % |
| PUT | `/api/watchlists/:id/companies/:symbol/notes` | Set a company's notes |
| PUT | `/api/watchlists/:id/alerts/:alertId` | Acknowledge/un-acknowledge a Portfolio Intelligence alert (§3.7) |

Every mutation route re-runs `researchFor(id, 'none')` (cache-only) after the
write and returns the fresh payload in the same response, so the frontend
never needs a separate re-fetch after a mutation.

### 3.3 Data providers

`data/providers/index.mjs` is the single integration point for fundamentals
data: `getFundamentalsProvider(market)` returns `screenerProvider` (via an
in-memory memoized cache) for `market === 'India'`, else
`notConfiguredProvider` — which returns the *same normalized shape* with every
field `null`, so no downstream analytics or scoring code ever has to branch on
market. **Adding a new paid/authenticated data source is a matter of
implementing `fetchFundamentals(symbol)` in this shape and registering it
here — nothing in `data/analytics`, `data/scoring`, `server.mjs`, or the
frontend needs to change.**

External sources in use today:

- **Yahoo Finance public chart feed** (`data/providers/yahooQuoteProvider.mjs`)
  — price, moving averages, RSI-14, MACD, daily OHLCV, and weekly 5-year price
  history (beta, correlation, multi-timeframe trend, historical percentile
  reconstruction). No API key; public and rate-limitable.
- **Screener.in** (`data/providers/screenerProvider.mjs`, India only) — ~10
  years of P&L/Balance Sheet/Cash Flow/Ratios, quarterly results, shareholding
  history. Scraped and parsed via `data/parse/screenerHtml.mjs` +
  `screenerLabels.mjs` into one normalized shape.
- **Google News RSS** (`data/news/companyNews.mjs`) — up to 5 recent
  deduplicated headlines per company, classified by impact/catalyst type via
  disclosed keyword rules. Phase 6 added sentiment (Positive/Negative/
  Neutral/Uncertain) and a coarse `affectedThesisDriver` mapping to the
  per-company report's own thesis buckets — same disclosed-keyword-list
  convention, no new fetch.
- **Yahoo Finance macro tickers** (`data/providers/macroProvider.mjs`, Phase
  6) — the same public chart-feed fetch every equity price already uses
  (`yahooQuoteProvider.mjs`'s `fetchQuote`), pointed at 6 non-equity tickers
  (USD/INR, US 10-Year Treasury yield, WTI crude, natural gas, gold, India
  VIX) for the Macro Intelligence panel (§3.8). No new fetch mechanism, no
  new external dependency.

### 3.4 Caching

Two independent layers:

- **In-memory** (`data/cache.mjs`, `TtlCache` + `memoize`) — dies with the
  process; used for the fundamentals fetch (60 min TTL) and in-flight
  request de-duplication.
- **On-disk** (`data/watchlist/diskCache.mjs`) — one JSON file per symbol
  under `data/cache/companies/`, plus per-index benchmark bundles under
  `data/cache/benchmarks/`. Atomic writes (temp file + rename). This is what
  makes cache-only startup instant and survives process restarts.

`buildResearch()`'s `networkPass` parameter governs staleness behavior:
`'none'` (cache-only, instant — startup paint, watchlist switch, every
mutation's re-render, report generation), `'incremental'` (only stale/missing
companies refetch — background auto-refresh), `'full'` (every company
refetches — the manual "Refresh Data" button), and an independent
`forceSymbols` set (a specific set of companies always refetch regardless of
staleness — per-company "Refresh" action) that composes with any of the three
passes above.

### 3.5 Watchlists

Persisted as `data/watchlists/index.json` (`{ activeWatchlist, watchlists:
[{id, name, file, companyCount, updatedAt}] }`) plus one JSON file per
watchlist (`{id, name, cashTargetPct, companies: [...]}`). A company record
holds only `symbol` as user-entered truth; `name`/`sector`/`industry`/
`exchange` are backfilled from the first real fetch and never guessed. All
writes are atomic (temp file + rename via `data/util.mjs`'s
`writeJsonAtomic`). Four watchlists (Core Portfolio, Banking, Power, Defence)
self-seed on first run if no `index.json` exists.

### 3.6 Reporting

`data/reporting/researchReport.mjs`'s `buildCompanyReport(research, symbol)`
is **pure selection and derivation** over an already-built `buildResearch()`
payload for one company — it recomputes nothing. Its only new I/O is a second
read of the same on-disk company cache bundle, to pull the raw weekly price
series for report charts (which the trimmed dashboard payload doesn't carry).
This is the pattern every future reporting or export feature must follow:
**never duplicate an analytics calculation — read the already-computed result
off the research payload.**

**Phase 5** extended the report to a full 15-section institutional research
note (`report.html`/`report.js`): the original 10 Phase 3d sections plus
Thesis Tracking (reads `intelligence.thesis[symbol]`, §3.7), Target Price
Rationale (WACC/growth/sensitivity/confidence, read off `stock.dcf`/
`stock.financialValuation` — explicitly discloses where a figure isn't
modeled, e.g. no forward margin assumption or no sensitivity grid for the
financial-sector model, rather than fabricating one), Scenario Analysis
(bull/base/bear plus this company's own row from the portfolio-level stress
test, `research.portfolio.scenarios`), Portfolio Context (this company's own
weight/attribution/risk-contribution/diversification-impact/action rows,
looked up from already-computed portfolio fields), and Explainability (the
recommendation engine's and Action Score's bucket breakdowns side by side).
The catalyst taxonomy (`data/news/companyNews.mjs`) was remapped to 7
categories (Earnings/Valuation/Industry/Regulatory/Technical/Management/
Capital allocation) with a disclosed `signalStrength` heuristic (impact +
recency) — deliberately not a numeric probability, since these are
keyword-classified past headlines, not a confirmed event calendar.

**Institutional research foundation upgrade** added 3 report sections (now
17 total), all pure passthrough of §4.6's new fields, no new calculation in
the reporting layer itself: **Company Quality vs. Stock Attractiveness**
(after Investment thesis), **Thesis breakers** (extending the existing
Thesis tracking section), and **Segment, Capacity & Forward Estimates** (a
combined section reading `forwardFramework`/`researchQuality`, after
Financial quality — every sub-concept renders an explicit "not available"
status, per §4.6). Separately, `executiveSummary()`/`valuationAnalysis()`/
`scenarioAnalysis()`/`finalVerdict()` now apply `precisionForConfidence()`
(`data/util.mjs`) to the fair-value/target-price/bull-base-bear figures they
display, keyed to the resolved valuation model's own `confidenceBand` — a
report-page-only presentation change (High confidence keeps today's 2-decimal
display; Medium rounds to the nearest whole unit; Low to the nearest 5). The
underlying `stock.valuation`/`stock.dcf`/`stock.financialValuation` figures
themselves are completely unchanged for every other consumer (the main
dashboard, the decision layer's `valuationMarginPct`) — this is presentation
rounding at the one place the number is actually shown to a reader, not a
new calculation.

`data/reporting/portfolioReviewPack.mjs`'s `buildPortfolioReviewPack(research)`
is the same pure-composition pattern applied at watchlist scope — a 9-section
investment-committee document (portfolio summary, valuation summary,
concentration analysis, sector positioning, top opportunities, top risks,
portfolio health, action priorities, rebalancing recommendations) reading
entirely off `research.portfolio`/`research.intelligence`, with zero new
analytics. Rendered by the standalone `portfolio-review.html`/
`portfolio-review.js` pair, which mirrors `report.html`/`report.js`'s own
WYSIWYG A4/print/PDF-export architecture (§2.5) rather than introducing a new
one. Launched from the Watchlists tab's manage row and the Dashboard's
Committee View sub-tab, both via `window.open('portfolio-review.html?wl=...')`
— the same read-only-navigation pattern the per-company report already uses.

### 3.7 Portfolio intelligence (decision layer)

`data/decision/` is a **pure composition layer** over the `stocks`/
`portfolio` fields `buildResearch()` already computed above — it performs no
I/O, no fetching, and no new analytics; it only blends and thresholds
already-computed figures. Every constant it uses (weights, score bands,
alert thresholds, the lifecycle escalation window) lives in one file,
`data/decision/config.mjs`, so calibration is a config change, not a
re-audit of the modules that read it.

- **Action Score** (`actionScore.mjs`) — a weighted blend of the
  recommendation engine's own bucket scores (Quality/Valuation/Technical/
  Risk-inverted/Relative positioning) plus a Portfolio Fit score (weight
  drift vs. target, sector concentration, correlation with the largest
  existing holding), mapped to Add aggressively/Add/Hold/Reduce/Exit.
  Capped to Hold, with a disclosed `capNote`, when fewer than half of the
  six buckets resolve — the same confidence-gating convention the main
  recommendation engine already uses (§4.2).
- **Alerts** (`alerts.mjs`) — standing-condition alerts (e.g. elevated
  composite risk, RSI extremes, sector/position concentration) and
  crossing/transition alerts (e.g. a rating change, a DMA crossover), each
  graded across 2–3 severity tiers by how far past the threshold the
  reading is, not a single fixed severity. An alert continuously firing for
  `ALERT_LIFECYCLE.escalateAfterDays` (default 7) escalates one severity
  tier; an acknowledged alert that clears and later re-fires is treated as
  a new occurrence, not suppressed forever.
- **Portfolio health** (`portfolioHealth.mjs`) and **rebalancing
  suggestions** (`rebalancing.mjs`) — likewise pure blends of already-
  computed portfolio fields; rebalancing is a rule-based read, not an
  optimizer.
- **Change detection** (`changeDetection.mjs`) — a field-level diff between
  the live stock object and a persisted run-over-run snapshot, answering
  "what changed since last refresh."
- **Thesis tracking** (`thesisTracking.mjs`, Phase 5) — classifies each
  company's investment thesis as Intact/Improving/Weakening/Broken, reusing
  the same previous/current snapshot-field pair `changeDetection.mjs` already
  computes for its own diff (no new I/O, no second pass over `stocks`). A
  weighted blend of rating-tier movement (dominant), composite risk
  direction, technical crossing/regime direction and relative-valuation rank
  movement, plus hard "Broken" triggers (a 2+ tier rating downgrade, a fall
  to Sell, or composite risk crossing into critical territory) that override
  the blended score — same threshold-plus-magnitude pattern as
  `alerts.mjs`. Weights/thresholds live in `config.mjs`'s `THESIS_TRACKING`
  block. Attached as `intelligence.thesis[symbol]`, consumed by the
  per-company report's Thesis Tracking section (§3.6).

`data/decision/index.mjs`'s `buildPortfolioIntelligence()` is the single
orchestration entrypoint, called once from `research.mjs`, in one pass over
`stocks` (alerts, health, and Action Score are each computed exactly once,
matching the single-computation-site rule in §8). It returns the
`intelligence` object attached to the research payload, plus the snapshot
to persist next.

**Persistence**: `data/watchlist/snapshotCache.mjs` is a third disk-cache
namespace (`data/cache/watchlistSnapshots/<id>.json`, one file per
watchlist) holding the run-over-run baseline — per-company recommendation/
valuation/risk/technical fields, portfolio aggregates, health history, and
which alert ids are currently firing (with their first-detected time, for
lifecycle escalation). It only advances on a **genuine** data refresh (a
company's own `fetchedAt` moving forward) — a cache-only render reproduces
the same alerts/diff deterministically from unchanged inputs, so the
persisted baseline is intentionally left untouched, and the write itself is
skipped entirely rather than rewriting an identical file (see the
performance note below).

**Performance**: cache-only `GET .../research` composes the decision layer
on every request but only *persists* it when something genuinely changed.
Measured cache-only response time is ~25–60ms across the seeded watchlists,
in line with the pre-decision-layer baseline (§7 of the roadmap, 07.4) —
an earlier version of this layer wrote the snapshot file unconditionally on
every request (including cache-only ones), which regressed cache-only
response time to 185–300ms; that write is now skipped whenever no company
advanced.

### 3.8 Market and event intelligence (Phase 6)

Phase 6 added forward-looking market/event context on top of the existing
research platform, following the same "reuse already-computed analytics,
never duplicate a calculation" discipline as §3.6/§3.7. One piece required a
genuinely new capability (cross-watchlist reads); everything else is pure
composition over data already fetched/computed elsewhere.

- **Macro Intelligence** (`data/providers/macroProvider.mjs`,
  `data/watchlist/macro.mjs`, `GET /api/macro`) — 6 real indicators sourced
  via Yahoo Finance tickers (USD/INR, US 10-Year Treasury yield, WTI crude,
  natural gas, gold, India VIX), cached on their own namespace
  (`data/cache/macro/`) and TTL (30min), independent of any watchlist's own
  refresh cycle. Every other macro indicator the Phase 6 brief named (RBI
  policy repo rate, India G-Sec yield, CPI, IIP, PMI, power demand, ethanol
  policy, defence budget, banking liquidity) has no free, unauthenticated,
  machine-readable public source this app can reach — each renders an
  explicit **Future Integration** status (a Data Quality panel shows
  Live/Delayed/Unavailable/Future Integration per indicator) rather than
  being estimated or fabricated, the same posture as TD-10's market-wide peer
  database. **Market Regime** (`data/decision/marketRegime.mjs`) is a
  disclosed rule-based classification (Risk-on/Risk-off/tightening-or-easing
  bias) blending India VIX level, the Nifty 50 benchmark's own already-
  computed trend (reused from `benchmarkCache`, never refetched) and US 10Y
  yield direction — the same pattern `technicalScorecard.mjs`'s per-stock
  `technicalRegime` already uses, applied at market level; confidence never
  exceeds Medium.
- **Sector Intelligence** (`data/watchlist/sectorIntelligence.mjs`,
  `GET /api/sector-intelligence`) — **the one cross-watchlist read in this
  app**, a deliberate exception to the otherwise strictly single-watchlist-
  scoped data flow (§5). Loops every saved watchlist's own already-cached
  `buildResearch()` output (`networkPass:'none'` — zero new fetches),
  dedupes companies appearing in more than one watchlist, and groups the
  result by each company's own `sector` field into per-sector rollups
  (composite/valuation/technical/risk score averages, relative strength, EPS
  CAGR, regulatory/commodity sensitivity reused from
  `institutionalRisk.mjs`'s `sectorRiskTags()`). Coverage is limited to
  companies actually present in a saved watchlist — there is still no
  market-wide sector database (TD-10 is unaffected; this combines the user's
  own data, not an external universe).
- **Portfolio Exposure Matrix** (`data/analytics/exposureRules.mjs`,
  `data/decision/exposureMatrix.mjs`, attached as `portfolio.exposureMatrix`
  in the research payload) — tags each company with interest-rate,
  currency, commodity, regulatory and economic-cycle sensitivity. Interest-
  rate and economic-cycle sensitivity are 2 new static keyword-matched
  sector lookup tables (same shape as `institutionalRisk.mjs`'s
  `SECTOR_RISK_RULES`); regulatory/commodity reuse `sectorRiskTags()`
  directly and currency reuses `scenarios.mjs`'s `currencyExposure()` —
  nothing is duplicated. Portfolio-level figures are a weight-aggregated
  average using each holding's already-resolved illustrative target weight.
- **Earnings Intelligence** (`data/analytics/earningsAnalytics.mjs`,
  attached per-stock as `earningsIntelligence`) — real quarter-over-quarter
  and year-over-year revenue/net-profit/operating-margin deltas computed
  from Screener's own scraped quarterly P&L series
  (`fundamentals.quarterly.profitLoss`, fetched since Phase 1 but unused
  anywhere downstream until now). "Deviation vs. trailing average" is the
  honest substitute for an earnings "surprise": this app has no analyst-
  consensus data source, so deviation is measured against the company's own
  trailing 4-quarter average, never against Street expectations. Next
  earnings date, days remaining, expected impact, historical reaction,
  guidance changes, management commentary and estimate-revision signals have
  no data source and render an explicit **Future Integration** status.
- **Portfolio Event Calendar** (`data/analytics/eventCalendar.mjs`,
  attached at the payload's top level as `eventCalendar`) — every already-
  fetched, dated company news item across the watchlist, sorted newest-
  first. Earnings dates, dividend ex-dates, buybacks and regulatory/policy
  events have no dated source (Screener exposes only a trailing annual
  dividend payout %, not a schedule) and are not included, rather than
  fabricated.
- **Morning Briefing** — the Dashboard's default sub-tab (`script.js`'s
  `renderMorningBriefing()`), composing `executiveSummary`, `intelligence`,
  the Macro/Sector Intelligence payloads (fetched once client-side, reused —
  never refetched for the briefing) and per-company news into one daily
  roll-up. Pure client-side formatting; zero new backend computation.
- **Weekly Investment Committee Pack** (`data/reporting/committeePack.mjs`,
  `committee-pack.html`/`committee-pack.js`) — structurally the Phase 5
  Portfolio Review Pack extended with macro/sector context and a
  field-categorized view (Valuation/Risk/Other) over the existing per-
  company diff (`data/decision/changeDetection.mjs`). "Weekly" means "since
  this watchlist's own last genuine data refresh" (the same run-over-run
  window `changeDetection.mjs` already tracks) — refresh cadence is user-
  driven in this single-user local tool, not a scheduled job, so this may
  reflect more or less than 7 calendar days. Macro/sector sections show
  current state plus each indicator's own trailing-window change, not a
  dedicated week-over-week snapshot diff (no such persistence exists yet for
  macro/sector data — see the roadmap's technical debt).

### 3.9 Quantitative research (Phase 7)

Phase 7 adds an institutional quantitative-research domain, `data/quant/`,
following the same discipline as `data/decision/` (§3.7): a pure composition/
normalization layer that performs no I/O and recomputes no raw figure
`data/analytics/`/`data/scoring/` already produced — it only normalizes and
aggregates already-computed fields. Staged per the phase brief; **Stage 1
(quantitative data model + factor engine) and Stage 2 (benchmark & performance
engine) are complete** — backtesting/portfolio-construction/position-sizing/
risk-budget/attribution modules are later stages, not yet built (see
`docs/governance/roadmap.md` domain 09).

- **Factor engine** (`data/quant/factorEngine.mjs`, `buildQuantResearch()`,
  called once from `research.mjs` after the recommendation/relative-valuation
  second pass resolves) — an institutional 6-factor framework (Value/
  Quality/Growth/Momentum/Risk/Size). For each stock, every named sub-metric
  (e.g. P/E, ROE, revenue CAGR, price momentum, beta, market cap — all read
  directly off already-computed `stocks[]` fields, never recomputed) is
  normalized to a 0-100 percentile against a peer universe: same-sector
  watchlist peers first, falling back to the full watchlist below
  `data/quant/config.mjs`'s `NORMALIZATION.minSectorPeers`, and to an
  explicit "insufficient data" status below `minWatchlistPeers` even at
  watchlist scope — the same watchlist-scoped-only peer constraint already
  disclosed on `relativeValuation.mjs` and `portfolio.mjs`'s `factorExposure()`
  (there is no market-wide peer database in this app). A category score
  averages its resolved sub-metrics; the composite **Factor Score** is a
  weighted blend of the 6 category scores (weights in
  `data/quant/config.mjs`, disclosed and uncalibrated — same TD-11-class
  limitation as `data/decision/config.mjs`'s own weights), renormalized over
  whichever categories resolve, and withheld (with a disclosed `capNote`)
  when fewer than half resolve — the same completeness-floor convention
  `actionScore.mjs` already uses. Attached per-stock as `stock.quantFactors`
  and, watchlist-level, as `research.quant` (factor leadership/weakness,
  per-category averages, coverage).
- **Distinct from `portfolio.factorExposure`** (§4.4): that pre-existing
  function is a lightweight, portfolio-level, weight-aggregated tilt over 5
  factors with no per-metric raw-value/percentile/confidence disclosure. The
  Stage 1 factor engine is the full per-stock institutional profile the
  Phase 7 brief requires (raw value + normalized score + percentile +
  direction + data status + confidence per sub-metric). Both remain in the
  payload, answering different questions over overlapping raw inputs — not a
  duplicate computation of the same one (`metricRegistry.mjs`'s
  `quantFactorScore` entry carries the full disclosure).
- **Benchmark & Performance engine** (`data/quant/performanceEngine.mjs`,
  Stage 2) — a single module (the phase brief's own "one clean module if
  architecturally sufficient" option; benchmark selection needed no new code
  beyond reusing `technicalLevels.mjs`'s existing `benchmarkSymbolFor()` and
  `research.mjs`'s existing per-market benchmark bundle, so a separate
  `benchmarkEngine.mjs` would have had no distinct responsibility). Computes,
  per stock and weight-aggregated per watchlist: benchmark-relative period
  returns (1M/3M/6M/1Y/3Y/5Y — 1Y reuses the existing daily-quote-derived
  `oneYearReturnPct`/`relativeStrengthPct` rather than a second, slightly
  different weekly-series-derived 1Y figure), price-series CAGR (3Y/5Y, actual
  elapsed time, not an assumed integer year count), max-drawdown peak/trough/
  recovery detail, and proxy Sharpe-like/Sortino-like risk-adjusted ratios —
  explicitly labeled "-like" throughout since this app has no dividend-
  inclusive total-return data source. It computes none of beta, volatility or
  max-drawdown *magnitude* itself — those are `stock.beta`/`stock.
  volatilityPct`/`stock.maxDrawdownPct`, already computed earlier in the same
  per-stock pass, read and reused as-is. Attached per-stock as `stock.
  performance` and watchlist-level as `portfolio.performance` (weight-
  aggregated using the same `resolveWeights` vector every other portfolio
  aggregate uses; portfolio volatility/beta reuse the real, correlation-aware
  `portfolio.mjs` figures rather than a correlation-blind average — see
  `portfolioVolatilityPct()`, extracted from `positionRiskContribution()`'s
  own internal variance decomposition so both call sites share one
  computation). Benchmark-side figures (period returns/CAGR/volatility/
  drawdown) are computed exactly once per market via
  `benchmarkPerformanceProfile()` and reused across every stock sharing that
  market — a per-stock recompute was measured to regress cache-only response
  time and was fixed before this stage shipped (see `docs/governance/
  roadmap.md`'s Phase 7 Stage 2 validation note). `data/analytics/priceSeries.
  mjs` gained one new shared primitive, `downsideDeviationPct()`, alongside
  its existing `annualizedVolatilityPct()`/`maxDrawdownPct()` siblings.
- **Product rule**: the Factor Score never overrides or averages into the
  Portfolio Action Score (§3.7) or the unified recommendation engine (§4.2),
  which remain this app's primary decision-layer signals. A later UI stage
  surfaces a disagreement between them, rather than blending it away.

---

## 4. Analytics architecture

All analytics modules (`data/analytics/*.mjs`) are pure, side-effect-free
calculation functions — no I/O, no network calls. They are called in a fixed
order from `data/watchlist/research.mjs`'s `buildResearch()` (§5). Every
figure they produce is tagged in `data/metadata/metricRegistry.mjs` (§6).

### 4.1 Valuation

- **DCF** (`dcf.mjs`) — real beta (return covariance vs. benchmark, never
  defaulted to 1), CAPM/after-tax-cost-of-debt WACC, a 2-stage Bull/Base/Bear
  DCF, reverse-DCF (binary search on implied growth), and a 3×3 sensitivity
  grid. Gated off for financial-sector companies (see below) — never produces
  a DCF fair value for a bank/NBFC.
- **Financial-sector valuation** (`financialValuation.mjs`) — a Justified
  Price/Book residual-income model for banks/NBFCs, selected instead of DCF
  whenever `isFinancialSector()` matches. Numerically bounded (a growth-rate
  cap and minimum Cost-of-Equity/growth spread) to avoid blow-up as growth
  approaches the cost of equity.
- **Fair value / target price** (`valuation.mjs`) — a disclosed heuristic:
  P/E and P/B reversion to the watchlist's own peer average, projected forward
  by the 5-year EPS CAGR. Explicitly *not* analyst consensus. Now carries its
  own `confidenceBand` (High/Medium/Low, same thresholds as DCF/
  financialValuation below), blending reversion-component completeness,
  watchlist sample size, and a **reversion-gap** read — how far this stock's
  own current P/E/P/B already sits from the peer average it's being reverted
  to (§4.6) — so a large, unjustified extrapolation (e.g. reverting a single
  capital-goods name to an unrelated multi-sector watchlist average) no
  longer reads as confidently as a well-supported one.
- **Relative valuation** (`relativeValuation.mjs`) — a two-pass module: pass 1
  computes each stock's own comparison figures, pass 2 (needing every
  sector-mate's pass-1 result) computes sector-adjusted rank, a disclosed
  multi-factor peer score (Value 40% / Quality 35% / Growth 25%), valuation
  dispersion, and historical premium/discount bands. Always watchlist-scoped
  — there is no market-wide peer universe. **Peer-framework correction
  (institutional research foundation upgrade, §4.6)**: each stock's real
  comparison-peer count (`peerCount`, self excluded) drives a `peerTier`
  (Direct = same `industry`, Sector = same `sector` only) and a
  `peerCompleteness` read (Strong ≥6 / Adequate 3–5 / Weak 1–2 / Unavailable
  0). Below 3 real peers, `relativeValuationScore`/`sectorNormalizedValuationScore`/
  `multiFactorPeerScore` render `null` with a disclosed reason instead of a
  self-comparison artifact (previously a 1-company "sector" produced a real
  but meaningless score) — the same insufficient-data floor
  `data/quant/factorEngine.mjs` already applies to its own peer-relative
  percentiles. `peerCompleteness` also feeds the unified recommendation
  engine's confidence read (§4.2).
- **Historical percentiles** (`historicalPercentiles.mjs`) — reconstructs a
  stock's own historical P/E and P/B distribution from its price and
  fundamentals history, for "where does today's multiple sit historically."

### 4.2 Recommendation (`data/scoring/scoringEngine.mjs`)

The single unified rating engine. Five weighted buckets — Quality 35%,
Valuation 25%, Technical 15%, Risk 15% (inverted), Relative positioning 10% —
renormalized over whichever buckets actually resolved (a missing bucket is
excluded, never defaulted to neutral). Computed in two passes per watchlist
(`buildRecommendation` before relative valuation resolves,
`finalizeRecommendation` after), because the Relative-positioning bucket
depends on every sector-mate's relative-valuation result. Cross-signal
consistency guards cap the rating (e.g. Buy-or-better capped to Hold if
composite risk ≥ 65 or price is >20% above modeled fair value; Strong Buy
additionally requires High confidence) — every cap is disclosed via a
human-readable `capNote`, never silently applied.

### 4.3 Technical (`technicalScorecard.mjs`, `technicalLevels.mjs`)

ADX/DI+/DI− (Wilder), ATR%, On-Balance Volume, Accumulation/Distribution,
volume profile point-of-control, multi-timeframe (daily/weekly/monthly) trend
confirmation, five 0–100 composite scores (volume-weighted momentum, trend
persistence via trailing-OLS R², breakout quality, volatility-adjusted
momentum, institutional accumulation), a rule-based regime classification, a
High/Medium/Low signal-confidence read, and relative-strength percentile vs.
the rest of the watchlist. All computed off OHLCV data already present in the
single Yahoo quote fetch — zero additional network calls beyond the one price
history fetch already needed for the valuation engine.

### 4.4 Portfolio (`portfolio.mjs`, `correlation.mjs`, `scenarios.mjs`)

Weighted-average portfolio dashboard (quality/valuation/risk, beta, a proxy
risk-adjusted return), sector allocation with a >40%-concentration flag and an
HHI-based diversification score, a full pairwise correlation matrix (with a
rolling-vs-full-history stability read), position-level marginal risk
contribution (a real portfolio-variance decomposition, not an approximation),
quality/valuation attribution (top contributors pulling the portfolio score up
or down), five disclosed in-house factor-exposure tilts (Value/Growth/
Quality/Momentum/Size — explicitly not a commercial Barra/Axioma-style
model), and five named scenario stress tests (interest-rate shock, sector
rotation, earnings recession, market drawdown, currency shock). Portfolio
weights are a user-entered illustrative allocation (optionally net of a
`cashTargetPct`), never a real brokerage holding.

### 4.5 Risk (`institutionalRisk.mjs`)

Five categories — Financial, Business, Market, Sector, Governance — each
renormalized independently over whichever inputs resolve; the composite score
renormalizes over whichever categories resolve. Sector risk is a static,
keyword-matched lookup table (not a market data feed). Business-risk
concentration and governance pledge/related-party figures are explicitly
unavailable (no data source), never estimated.

### 4.6 Institutional research foundation

A set of additive analytical lenses layered over already-computed
`data/analytics`/`data/scoring` output — none of them touch or override the
primary `recommendation.rating`/`compositeScore` (§4.2), same non-overriding
relationship `data/quant/factorEngine.mjs` already has to the recommendation
engine (§3.9).

- **Evidence hierarchy** (`data/metadata/evidenceHierarchy.mjs`) — an A–F
  provenance scale (A: audited filing/exchange/regulatory · B: management
  guidance/investor presentation · C: high-quality independent research · D:
  reputable financial/news source · E: derived calculation · F: system
  heuristic/estimation) layered on top of, never replacing, the existing
  Sourced/Calculated/Heuristic tier (§6). `metricRegistry.mjs`'s `metricMeta()`
  attaches a default evidence tier to every registry entry (derived from its
  existing tier; news-sourced entries default to D instead of A). No B or C
  source exists in this app today — a disclosed gap, not an invented mapping.
- **Company Quality vs. Stock Attractiveness** (`data/scoring/qualityAttractiveness.mjs`)
  — two named groupings over the same per-stock factor list `factors.mjs`
  already computes (`COMPANY_QUALITY_FACTOR_KEYS`: business/financial-
  strength/profitability/growth/cash-flow/balance-sheet/management/industry-
  position; `STOCK_ATTRACTIVENESS_FACTOR_KEYS`: valuation/risk-profile/
  technical-trend/momentum-volume), each a separate weighted-average score
  attached as `recommendation.companyQuality`/`.stockAttractiveness`. Answers
  "is this a good business" independently of "is this stock a good buy right
  now" — a stock can show Strong Company Quality alongside Average Stock
  Attractiveness, or the reverse.
- **Fundamental / Market / Timing separation** (`scoringEngine.mjs`) —
  `recommendation.fundamentalView` (Quality+Valuation+Risk buckets only, no
  Technical) and `.marketView` (the Technical bucket plus the technical
  regime label) are additive re-averages of the same 5 bucket scores the
  blended `rating` already uses, so a weak chart can never masquerade as a
  business-quality read. `.actionGuidance` is a small disclosed lookup
  combining the two into one sentence (e.g. "Fundamentally attractive but
  technically weak — accumulate on weakness") — never a third rating.
- **Research Quality Gates** (`data/scoring/researchQuality.mjs`) — five
  disclosed gates per stock (`stock.researchQuality`): Data completeness,
  Valuation completeness, Peer completeness (reads relativeValuation.mjs's
  `peerCompleteness`, §4.1), Forecast confidence (a fixed "not applicable"
  disclosure until a forward-estimate model exists), Evidence quality (a
  coarse blend of recommendation-bucket coverage, valuation-model resolution
  and fundamentals completeness). Confidence remains a first-class, separate-
  from-score output — `deriveConfidenceInputs()` in `scoringEngine.mjs` now
  also folds in peer-data availability once relativeValuation resolves (pass
  2), so thin-peer companies read lower confidence, not just a lower
  Relative-positioning bucket score.
- **Forward-looking foundation contracts** (`data/analytics/forwardFramework.mjs`)
  — schema-only builders for four concepts this app has no data source for:
  forward estimates (management guidance vs. system estimate vs. actual),
  management execution/credibility tracking, segment-level economics, and
  capacity/utilization economics. Each returns `{ available: false, reason,
  schema }` — the same "Future Integration" convention
  `earningsAnalytics.mjs`/`macroProvider.mjs` already established — so a
  future data-source integration has an agreed shape to fill in rather than
  a redesign. Attached per-stock as `stock.forwardFramework`; nothing here is
  computed today.
- **Thesis breakers** (`data/decision/thesisTracking.mjs`'s `thesisBreakers()`)
  — surfaces `thesisStatus()`'s own 3 hard "Broken" triggers (2+ tier rating
  downgrade, a fall to Sell, composite risk reaching critical territory) plus
  2 additional point-in-time conditions backed by already-computed data
  (promoter holding declining materially, ROCE falling below the modeled
  cost of capital) as a structured, named list (`condition`/`status`
  Active-Watch-Clear-Unavailable/`currentReading`) attached alongside the
  existing `status`/`reasons` at `intelligence.thesis[symbol].breakers` —
  additive, no change to the blended thesis-status score itself.

The per-company research report (§3.6) surfaces all of the above as new
sections (Company Quality vs. Stock Attractiveness; Thesis breakers extending
Thesis tracking; a combined Segment, Capacity & Forward Estimates section)
without altering any existing section.

### 4.7 Automated test coverage (`test/`)

An automated unit-test layer (`docs/governance/roadmap.md` TD-4/02.11,
completed 2026-08-17) now exercises the pure-math modules named in that
item's own scope: `data/analytics/dcf.mjs` (beta, WACC, the full DCF
valuation and its disclosed-unavailable-reason paths), `data/analytics/
priceSeries.mjs` (correlation, volatility, downside deviation, drawdown,
percentile rank), `data/analytics/institutionalRisk.mjs` (all 5 risk
categories, renormalization over partial input, the risk-trend direction
read), `data/analytics/portfolio.mjs`'s `resolveWeights()` and several
neighboring pure functions (`weightedAverage`, `sectorAllocation`,
`positionConcentration`, `portfolioVolatilityPct`), and their small pure
dependencies (`data/analytics/series.mjs`, `cagr.mjs`, `shares.mjs`,
`data/util.mjs`). Built on Node's built-in `node:test`/`node:assert` runner
— zero new dependency, no `package.json`, same constraint as the rest of
this app (§1.2) — run via `node --test` or `test.bat`. Test cases favor
hand-computed expected values reconciled against the module's own documented
formula (the same discipline this project's own phase validation notes use,
e.g. Phase 7's CAGR spot-checks) over snapshot-style assertions, and check
disclosed-unavailable-reason paths explicitly so a future change can't
silently start fabricating a value where one is genuinely missing. Does
**not** yet cover `data/scoring/`, `data/decision/`, `data/quant/`,
providers, or any I/O-touching module — those remain validated by the
live-check/interactive-walkthrough discipline in `docs/governance/
roadmap.md` §1 until a later roadmap item extends coverage to them.

This test layer is now wired into CI (`docs/governance/roadmap.md` 07.2,
completed 2026-08-17): `.github/workflows/ci.yml` runs on every push and pull
request, first `node --check` over every tracked `.mjs`/`.js` file, then
`node --test`. Either gate failing fails the job — no `continue-on-error`,
no suppressed exit code. GitHub-hosted, `ubuntu-latest`, Node 22.x (matching
this project's local dev Node version; no `package.json`/dependency install
step needed, same zero-dependency constraint as the test layer itself).

---

## 5. Data flow

The canonical end-to-end flow, from a watchlist load to a rendered report:

```
watchlist (data/watchlists/*.json)
  │  store.getWatchlist(id)
  ▼
research (data/watchlist/research.mjs → buildResearch)
  │  per company: load-or-fetch cache bundle (diskCache), backfill metadata
  ▼
analytics (data/analytics/*, data/scoring/*)
  │  per-stock pass: metrics table → fair value → technical scorecard →
  │  institutional risk → recommendation pass 1 → fundamentals analytics
  │  second pass: relative valuation → recommendation pass 2 (finalize) →
  │  watchlist-level aggregates (sector allocation, correlation, scenarios,
  │  factor exposure, attribution, executive summary)
  ▼
recommendation (data/scoring/scoringEngine.mjs — embedded in the pass above)
  │  one composite rating + confidence per company, in the same payload
  ▼
research payload  ──────────────────────────────►  script.js `currentData`
  │                                                    │
  │  (cache-only re-read, same payload shape)          ▼
  ▼                                              every tab render*() —
report (data/reporting/researchReport.mjs)        pure read/format, zero
  │  pure selection/derivation, zero recomputation  recomputation
  ▼
report.html / report.js  (standalone page)
  │
  ▼
portfolio (data/analytics/portfolio.mjs)
   — already computed inside the research payload above; the Portfolio tab
     and the report's peer-comparison section both read the same aggregate
     fields, never recomputed independently
```

**The governing rule this flow encodes: there is exactly one place each
analytic is computed (`buildResearch()`'s per-stock and watchlist-level
passes), and every consumer — every dashboard tab, the report page, and
future consumers (e.g. a mobile client) — must read the already-computed
result rather than reimplementing the calculation.**

**Phase 6's one exception**: `data/watchlist/sectorIntelligence.mjs` reads
*every* saved watchlist's own already-built `buildResearch()` output
(cache-only) to produce a cross-watchlist Sector Intelligence rollup (§3.8)
— the single deliberate departure from "one watchlist at a time" in this
app. It performs no new fetch and no new per-stock computation, so it does
not violate the single-computation-site rule above; it only reads the
result of that rule applied N times instead of once.

---

## 6. Canonical data sources

Every metric the app surfaces is tagged with one of three tiers in
`data/metadata/metricRegistry.mjs`, attached once per research payload as
`data.metricMeta`, and surfaced in the UI via a hover/click info-icon
(`infoIcon()` in `script.js`; the equivalent `dataTag()` with a `title`
tooltip in `report.js`). This is the single source of truth for data-quality
labeling — no tab or page maintains its own classification strings.

| Tier | Meaning | Examples |
|---|---|---|
| **Sourced** | A reported figure read directly from Screener.in/Yahoo, or entered directly by the user. Not derived. | `price`, `pe`, `roe`, `roce`, `dividendYield`, `targetWeightPct`, `cashTargetPct` |
| **Calculated** | A deterministic formula applied to sourced figures. No subjective inputs (may rely on a disclosed simplifying assumption). | `pb`, `rsi14`, `macd`, `beta`, `correlationMatrix`, `sectorRank`, `reverseDcf` |
| **Heuristic** | A disclosed in-house judgment: a scoring formula this project defined, a fixed assumption constant, or a qualitative classification. Never presented as analyst consensus or a named external model unless it genuinely is one. | `fairValue`, `wacc`, `compositeScore`, `sectorRisk`, `technicalRegime`, `scenarioImpact`, `factorExposure` |

`confidence` (High/Medium/Low) is orthogonal to tier — a Calculated figure can
still be Low confidence (e.g. built on a short history window).

**Evidence hierarchy (A–F)**: `metricMeta()` additionally attaches a
provenance classification on top of the tier above (never replacing it) —
see §4.6. Every consumer of the existing `{tier, confidence, label,
methodology}` shape is unaffected; `evidenceTier`/`evidenceLabel` are purely
additive fields on the same registry entries.

**Rule for all future work**: every new metric added anywhere in the system
must get a `metricRegistry.mjs` entry before it ships. A metric with no real
data source available renders an explicit "N/A"/"not available" — it is never
estimated to fill a gap.

---

## 7. Repository structure

```
Stocks/
├── CLAUDE.md                    — repository entry point for Claude Code (load order, working rules)
├── README.md                    — human quick-start
├── .github/workflows/ci.yml     — CI: node --check over every .mjs/.js file, then node --test (§4.7, §07.2)
├── server.mjs                   — HTTP server + full API route table
├── index.html / script.js / styles.css   — main dashboard SPA
├── report.html / report.js      — standalone printable per-company research report page (§3.6)
├── portfolio-review.html / portfolio-review.js — standalone printable Portfolio Review Pack page (Phase 5, §3.6)
├── committee-pack.html / committee-pack.js — standalone printable Weekly Investment Committee Pack page (Phase 6, §3.8)
├── run.bat / killserver.bat     — Windows start/stop helpers (no npm scripts exist)
├── data/
│   ├── analytics/                — pure calculation modules (§4), plus Phase 6's exposureRules.mjs, earningsAnalytics.mjs, eventCalendar.mjs (§3.8); forwardFramework.mjs (§4.6, schema-only forward/management/segment/capacity contracts)
│   ├── scoring/                  — the unified recommendation engine (§4.2); qualityAttractiveness.mjs, researchQuality.mjs (§4.6)
│   ├── decision/                  — Portfolio Action Score, alerts, health, rebalancing, thesis tracking (§3.7); Phase 6's marketRegime.mjs, exposureMatrix.mjs (§3.8)
│   ├── quant/                     — Phase 7 quantitative research domain: config.mjs, factorEngine.mjs (Stage 1), performanceEngine.mjs (Stage 2) (§3.9)
│   ├── reporting/                — per-company report, Portfolio Review Pack, Weekly Investment Committee Pack model builders (§3.6, §3.8)
│   ├── providers/                — external data source abstraction (§3.3), including Phase 6's macroProvider.mjs
│   ├── parse/                    — Screener.in HTML parsing (feeds screenerProvider)
│   ├── news/                     — company news fetch + classification (+ Phase 6 sentiment/affected-thesis-driver)
│   ├── metadata/                 — metricRegistry.mjs, the tier registry (§6); evidenceHierarchy.mjs, the A–F provenance layer (§4.6)
│   ├── universe/                 — static NSE ticker reference data (search seed)
│   ├── watchlist/                — store, research orchestration, disk cache, symbol search (§3.5), snapshotCache.mjs (§3.7); Phase 6's macro.mjs and sectorIntelligence.mjs (§3.8, the one cross-watchlist module)
│   ├── watchlists/                — the actual on-disk watchlist JSON data (user state)
│   ├── cache/                     — on-disk research cache (companies/, benchmarks/, watchlistSnapshots/ — §3.7; macro/ — Phase 6, §3.8)
│   ├── cache.mjs                  — in-memory TTL cache
│   └── util.mjs                   — shared low-level helpers (atomic JSON writes, fetch wrapper)
├── test/                          — automated unit tests for pure-math modules (§4a), run via `node --test`/`test.bat`
├── docs/
│   ├── authoritative/system.md    — this document
│   └── governance/
│       ├── roadmap.md             — canonical execution roadmap
│       └── audits/                — dated point-in-time audit snapshots (.mhtml)
└── archive/
    └── roadmap-history.md         — full phase-by-phase project history (pre-governance-phase changelog)
```

**Where new things belong**:
- A new calculation → `data/analytics/` (pure function, no I/O) or
  `data/scoring/` if it's part of the rating composite.
- A new alert/action/monitoring rule → `data/decision/` (§3.7), reading
  already-computed `data/analytics`/`data/scoring` output and its own
  `config.mjs` — never a new analytics calculation of its own.
- A new quantitative-research capability (factor/benchmark/performance/
  backtest/portfolio-construction/position-sizing/risk-budget/attribution)
  → `data/quant/` (§3.9), same pure-composition-over-already-computed-output
  pattern as `data/decision/`, own `config.mjs` — never a second valuation,
  technical, risk or recommendation calculation.
- A new external data source → implement the shape `data/providers/index.mjs`
  expects, register it there; never call an external API directly from
  `server.mjs`, `data/watchlist/research.mjs`, or the frontend.
- A new UI surface for existing data → a new tab/sub-tab/section in
  `script.js`/`index.html`, reading `currentData` — never a new computation.
- A new document about *why* something changed → an entry in
  `docs/governance/roadmap.md`, not a new standalone file (§8).
- A test for a pure-math module → `test/`, one `*.test.mjs` file per source
  module, using `node:test`/`node:assert` (§4.7) — never a new test
  framework or a `package.json` dependency.

---

## 8. Document hierarchy and governance rules

Three documents govern this repository. Each has one job; do not duplicate
content across them.

| Document | Answers | Audience |
|---|---|---|
| `docs/authoritative/system.md` (this file) | What *is* the system? | Anyone implementing against the current architecture |
| `docs/governance/roadmap.md` | What gets built, in what order, and what's already done? | Anyone planning or prioritizing work |
| `CLAUDE.md` | How should Claude Code work in this repository? | Claude Code, at the start of every session |

### Architectural governance rules (binding on all future work)

1. **Single computation site.** Every analytic is computed exactly once, in
   `buildResearch()`'s call chain (§5). New consumers read the result; they
   never reimplement the calculation. `researchReport.mjs` is the reference
   example.
2. **Provider abstraction is the only integration surface for new data
   sources.** New fundamentals/quote sources implement `data/providers/`'s
   existing normalized shape and register in `data/providers/index.mjs` —
   nothing else in the codebase should need to change (§3.3).
3. **Never guess a sourced field.** `name`/`sector`/`industry`/`exchange` and
   every "Sourced" tier metric are backfilled from a real fetch or left
   explicit "N/A" — never estimated to fill a gap (§3.5, §6).
4. **Every new metric is tagged.** No metric ships without a
   `metricRegistry.mjs` entry (§6).
5. **Module boundaries are stable.** `data/analytics/` stays pure
   (no I/O); `data/watchlist/` owns orchestration and persistence;
   `data/scoring/` owns rating composition; `data/decision/` and
   `data/quant/` (§3.7, §3.9) stay pure composition layers over already-
   computed `data/analytics`/`data/scoring` output — no I/O, no independent
   recalculation of a raw metric already computed elsewhere; `server.mjs`
   stays a thin route table. Do not blur these lines for a one-off feature.
6. **No document proliferation.** Rationale for a change belongs in
   `docs/governance/roadmap.md`'s completed-work ledger, not a new
   standalone markdown file. Point-in-time audit artifacts go in
   `docs/governance/audits/`, dated, never edited after the fact.
7. **This document is updated in the same change** that alters a module
   boundary, a data flow, an API route, or a folder's purpose — not
   retroactively.

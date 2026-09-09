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
  (Yahoo Finance chart feed, Screener.in, Google News RSS — §4.1), MoSPI's
  eSankhyiki API for CPI inflation (public/unauthenticated, confirmed
  2026-09-08 — §3.10), plus one credentialed exception approved 2026-09-08
  (the same MoSPI eSankhyiki API, for IIP only — §3.10). No other API keys or
  paid vendor integration exists.

### 1.3 Major modules

| Module | Responsibility |
|---|---|
| `server.mjs` | HTTP server, static file serving, the full API route table |
| `data/providers/` | External data source abstraction (fundamentals, quotes) — unauthenticated only |
| `data/integrations/` | The MoSPI eSankhyiki integration — one public/unauthenticated dataset (CPI, since 2026-09-08) and one credentialed dataset (IIP), sharing config/client code for the one upstream provider — credential lifecycle + fetch, own local credential store (§3.10) |
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

**Watchlist Research navigation/scroll redesign — reference implementation for
an app-wide IA pattern** (2026-09-05): a UX audit (per an explicit user brief,
with three annotated screenshots as the primary reference) found the root
cause of "excessive whitespace" / "controls stacking during scroll" was not
a spacing defect but an information-hierarchy one: the shared, app-wide
`<header>` (title/subtitle/badge + `#watchlist-select`/`#refresh-btn`, used
identically by every workspace) is `position:sticky;top:0` at its full
"landing page" height and never shrinks at any scroll position, on any tab;
directly beneath it, a primary `.subtabs` bar and any nested `.subtab-root
.subtabs` bar both stick using identical pill styling, reading as two
unrelated rows rather than a parent/child pair. Because `#watchlist-select`/
`#refresh-btn`/`#status` are singleton elements `script.js` wires up once and
every workspace shares (not duplicable into a Watchlist-Research-only
container without breaking every other tab's watchlist switching), the fix
gates a reusable mechanism to this one workspace instead of duplicating or
moving shared chrome: `activateWorkspaceTab()` now sets
`document.body.dataset.activeTab`, and a new rAF-throttled scroll listener
(`updateHeaderScrollState()`) toggles `body.is-scrolled` — both fully generic,
wired to zero visual effect on their own. New CSS gated on
`body[data-active-tab="watchlist-research"].is-scrolled` collapses the
existing header in place (hides the subtitle, shrinks the h1, removes the
"Watchlist context" label, pulls the toolbar onto the same row) purely by
restyling the unchanged DOM — every other workspace's header is pixel-
identical to before until it opts in the same way. Separately, three new
CSS-only modifier classes (`.subtabs-primary`/`.subtabs-secondary`/
`.subtabs-tertiary`, applied only to Watchlist Research's own nav elements in
`index.html`) give the primary Overview/Fundamentals/Technicals/Risk &
Opportunity bar a bold underline-tab treatment while nested bars (e.g.
Fundamentals → Valuation/Quality/Growth, Quality → Profitability/Balance
sheet/Ownership) render as a visually subordinate, labeled toolbar (a
`::before`-generated "SECTION ›" prefix from a new `data-section-label`
attribute) — deliberately changing only color/weight/background/box-shadow,
never container padding, button padding, font-size, or border-width, because
`--subtabs-h` (`syncHeaderHeight()`) measures one bar's height and multiplies
it by nesting depth for every level's sticky `top` offset; any height
mismatch between levels would reintroduce a gap or overlap the whole feature
exists to remove. `initSubtabs`/`applySubtabState` are unaffected (they match
on the underlying `.subtabs`/`.subsection` classes, never the new modifiers).
Scope, per the brief's own explicit instruction: implemented on Watchlist
Research only, everywhere else unchanged, structured as a reference pattern
for later app-wide rollout once approved. Files changed: `index.html`,
`script.js`, `styles.css` — no analytics/scoring/decision/quant/provider/API
change.

Validated live against a scratch server (port 4187, never the user's own dev
server; a zero-dependency Chrome DevTools Protocol driver over Node 22's
built-in `fetch`/`WebSocket` was used in place of Puppeteer, which was not
available in this session's sandbox and was not installed, preserving the
zero-dependency validation discipline every prior pass in this history
established): all 4 required scroll states captured and inspected
(landing/small-scroll/deep-scroll-into-Technicals→Momentum/back-to-top)
against the Asmita watchlist (30 companies, the largest saved watchlist, to
guarantee enough page height to actually scroll) — the header correctly
collapses (subtitle hidden, h1 27px→15px, toolbar single row) once scrolled
and correctly restores full-size at the top with no flicker or duplicate
spacing; at deep scroll, the primary bar, the "TECHNICALS ›" secondary bar,
and the floating table-header clone measured (`getBoundingClientRect()`) with
zero gap and zero overlap between all three (each docks at exactly the
bottom edge of the one above it); zero console errors/exceptions throughout;
tab/sub-tab clicks across all 4 primary sections plus one nested
Fundamentals→Quality→Balance-sheet drill-down confirmed correct panel
visibility. One functional check doubled as the required watchlist-switch
validation: switching the active watchlist via `#watchlist-select` correctly
reloaded and re-rendered; the scratch server's `activeWatchlist` was restored
to its exact pre-run value (`banking`, this session's own already-in-progress
uncommitted state, captured via `GET /api/watchlists` before the run) via the
same `POST /api/watchlists/active` route the UI uses, confirmed after the
fact with `git diff` showing no unintended change to `data/watchlists/
index.json`. `node --check` clean on every changed file; `node --test`:
109/109 unaffected (no analytics/scoring/decision/quant module touched).

**App-wide bounded-viewport shell — supersedes the document-scroll design
above** (2026-09-05, same-day follow-on): a second UX brief required the
opposite of what the entry immediately above built. That entry's own
rationale (quoted above) was to keep `html`/`body` as the *one* scrolling
surface and fake "sticky" table headers with a `position:fixed` clone,
specifically because a bounded per-table scrollbox had been tried and
rejected minutes earlier for producing 14 nested scrollbars on one long
page. The new brief's explicit, non-negotiable instruction (confirmed with
the user after flagging this exact conflict) was the reverse: the
application shell must not be the primary scroll surface at all — sidebar,
header and each page's own identity/navigation must be genuinely fixed
regions of the viewport, with only a page's own content region scrolling,
using real flex/grid layout rather than sticky-offset math or a clone.

**Shell structure** (`styles.css`, gated to `@media(min-width:901px)` —
`<900px` keeps the pre-existing off-canvas-drawer/document-scroll mobile
fallback unchanged, since mobile was explicitly out of scope for this pass):
`html`/`body` are `height:100%`, `body{overflow:hidden}`. `.app-shell`
(sidebar + `.app-main`) is `height:100vh;overflow:hidden`. `.app-main` is a
flex column (`header` then `main#main`, both filling `height:100%`). `header`
and `.sidebar` dropped `position:sticky` entirely — they're now plain,
non-scrolling flex siblings, so they never need sticky-offset math at all.
`main#main.container` is `flex:1;min-height:0;overflow-y:auto;display:flex;
flex-direction:column` — the one shared scroll viewport, though in the
common case (below) its own single child exactly fills it and it never
actually needs to scroll itself.

**Per-tab fixed/scroll split**: `.tab.active` is a flex column
(`flex:1;min-height:0`) whose fixed children (title, intro text, nav bars,
filters) keep their natural height and whose one visible `.subsection` (or,
for the 3 tabs with no sub-nav — Watchlists, Company Research, Reports — a
new `.scroll-body` wrapper div added around "everything after the fixed
nav") becomes the actual scrolling region (`flex:1;min-height:0;
overflow-y:auto`). A `.subsection` that itself just hosts one more level of
nested sub-nav (a `.subtab-root`, e.g. Watchlist Research's Fundamentals →
Quality → Profitability, 3 levels deep) is a pass-through instead
(`.subsection:has(>.subtab-root){overflow-y:visible}`) and the nested
`.subtab-root` repeats the exact same fixed-nav/scrollable-body split one
level deeper — nav bars at every level are just ordinary stacked flex
siblings now, with zero pixel-offset bookkeeping regardless of nesting
depth (the old `--header-h`/`--subtabs-h` CSS vars and their
`syncHeaderHeight()`-driven measurement are gone entirely).

**A real, easy-to-miss flexbox trap, confirmed live**: flex items shrink
below their content size by default (`flex-shrink:1`). A `.subsection`
acting as its own scroll owner (a "mixed" panel: KPI cards + a table +
notes, none individually bounded) needs its children to instead keep their
*natural* height, so the total legitimately exceeds the subsection's own
bounded height and its `overflow-y:auto` actually engages — without
`.tab.active>*,.subsection>*{flex-shrink:0}` (with the pass-through/
scroll-owning exceptions given back `flex-shrink:1` at higher specificity:
the visible `.subsection` itself, `.scroll-body`, a nested `.subtab-root`,
`.card-table-fill`), a tall card was observed silently squeezed down to fit
instead of the subsection ever scrolling — `scrollHeight === clientHeight`,
no overflow, no scrollbar, data invisibly cut off. This is exactly the kind
of defect the brief's own "avoid fragile hard-coded offsets, let flex/grid
allocate the remaining height" instruction was written to prevent, and it
would not have been caught without live measurement (`element.scrollHeight`
vs `.clientHeight`), not just visual inspection.

**Table headers — native `position:sticky` where genuinely possible, the
floating clone kept only where it's the more honest answer**: a panel whose
entire content (after any intro text) is exactly one card wrapping one
table — Watchlist Research's Profitability/Balance sheet/Ownership/Growth
and its Trend/Momentum/Volume/Relative strength/Volatility/Signals tables,
10 in total — now gets a real `position:sticky` header (new
`.sticky-thead-native` marker class), because that table's own `.scroll`
wrapper can legitimately be the panel's one bounded scroll box with nothing
else competing for the space. Two real, confirmed-live prerequisites for
this to actually work, beyond just adding `position:sticky`: (1)
`border-collapse:collapse` (this table's own default) defeats sticky on a
table cell in real Chrome regardless of the ancestor chain — needs
`border-collapse:separate;border-spacing:0`, scoped to these tables only,
not a global change to every table's border rendering; (2) `.card`'s own
pre-existing `overflow:hidden` (rounded-corner clipping) *also* defeats
sticky on a descendant table cell, even though `.card` sits further out
than the table's actual (and actually bounded/scrolling) `.scroll`
ancestor — confirmed by toggling it live, not by reasoning about the spec —
so `.card-table-fill` (the marker on these 10 cards) overrides back to
`overflow:visible`, safe because `.scroll`'s own `overflow:auto` still
clips its own internal content with a real scrollbar and nothing in this
exact-fit flex layout (h3 + `.scroll`) ever needed the rounded-corner clip.
Every other table that shares a scroll region with sibling KPI cards/notes/
a second card — Dashboard's Action Required, Portfolio's allocation/
rebalancing/exposure-matrix, Watchlists' company table, Market
Intelligence's Earnings Intelligence, Watchlist Research's own Overview/
Valuation/Risk-overview/Alerts tables — keeps the floating-header-clone
mechanism from the entry above (still the only way to get a stable header
when the real scroll owner is a panel, not the table itself, without either
losing the table's native horizontal scroll or reintroducing a second
visible scrollbar on an already-scrolling panel — a deliberate, documented
exception, not an oversight), repointed from `window`/CSS-var-summed
offsets onto each table's own real scrolling ancestor
(`entry.scrollAncestor.getBoundingClientRect().top` is now the correct
show/hide and position threshold directly, found once at init by walking up
past pass-through wrappers).

**Portfolio Analysis's disclaimer banner**: the permanent `.card.disclaimer`
block ("Watchlist-derived, not a transaction ledger...") is gone from the
layout; the same copy is now a compact `helpIcon()` (new, generic sibling of
the existing tier-specific `infoIcon()` — same `.info-icon`/`.info-popover`
component, just without a Sourced/Calculated/Heuristic tier) next to the
"Portfolio Analysis" workspace title, filled by `render()` on every load —
no information lost, no new permanent vertical chrome.

**Header density**: the previous entry's scroll-triggered header-collapse
(`body.is-scrolled`, `updateHeaderScrollState()`) is removed outright, not
just disabled — it existed to reclaim space while the header blocked a
scrolling page, which no longer happens (the header is a fixed-height
sibling above `#main`, never overlapping scrolling content). What replaces
it is simpler: the header is compact by default now, on every workspace, all
the time (`header .title h1` 27px→19px, tighter top/bottom padding) — a
smaller permanent footprint instead of a large one that sometimes shrinks.

Validated live (same zero-dependency CDP-driver discipline as the entry
above, a fresh scratch server on a different port, never the user's own dev
server): `html`/`body` never overflow at 1600×1000, 1400×900 and 1400×600
(`scrollHeight === clientHeight` on `document.documentElement` in every
case) across all 8 workspaces, zero duplicate DOM ids, zero console errors;
the 3-level-deep Watchlist Research nested nav (primary/Fundamentals-Quality
secondary/Quality-detail tertiary) measured with zero gap/overlap between
levels; all 10 native-sticky tables confirmed to hold position across a
manual `scrollTop` change (measuring the sticky `<th>` itself — an earlier
check that measured the non-sticky `<thead>` wrapper instead produced a
false failure, corrected before concluding anything); all 6 mixed-panel
floating-clone tables checked directly against `floatingHeaders` (by object
reference, not by fragile class-string matching) confirmed to genuinely
overflow their own ancestor (not silently shrunk-to-fit) and the clone
shows/positions/hides correctly against that ancestor's own bounding rect;
column sort still applies its indicator class on both a native-sticky and a
clone-based table; the Watchlists add-company autocomplete dropdown renders
uncalibrated by any ancestor `overflow`, confirming `.tab.active`/
`.subtab-root` deliberately do **not** set `overflow:hidden` themselves
(scroll ownership is already fully assigned at the leaf level, so nothing
needs those two to clip); Portfolio's disclaimer-banner removal and help-icon
content confirmed present; sidebar collapse/expand confirmed; the Company
Research anchor-nav scrollspy confirmed to scroll `.scroll-body` (not the
page) after bringing the automated browser window to the OS foreground — an
earlier check without that step showed no scroll at all, which traced to
Chrome throttling `{behavior:'smooth'}` `scrollIntoView` animations in an
unfocused window (a test-environment artifact, not a regression: `{behavior:
'instant'}` and a real, user-focused click both worked throughout). `node
--check` clean; `node --test`: 109/109 unaffected. No incidental writes to
`data/watchlists/`/`data/cache/` (confirmed via `diff` against a pre-run
snapshot of `data/watchlists/index.json`; no mutation route was ever called
against the scratch server). Files changed: `index.html`, `script.js`,
`styles.css`.

**Explicit exceptions, not oversights**: `report.html`/`report.js`,
`portfolio-review.html`/`.js` and `committee-pack.html`/`.js` remain
separate, standalone, print-oriented pages with their own long-form-reading
document scroll — untouched, per the brief's own long-form-reading
carve-out. Below 900px the shell still falls back to normal document scroll
with the existing off-canvas sidebar drawer — desktop is the primary target
and this avoids reworking an already-working mobile path for a viewport
class explicitly out of scope.

**Fixed-context regression fix — decision-context regions still scrolling
away inside a mixed `.subsection`** (2026-09-05, same-day follow-on): a
regression report with annotated screenshots (Portfolio Analysis's KPI/
summary-card area, Watchlist Research's recommendation/score/trend area)
showed the bounded-viewport shell above did not fully deliver its own stated
goal. Root cause: the shell's per-tab fixed/scroll split (above) correctly
pins each `.tab`'s title/intro/nav bars, but treats **the entire visible
`.subsection` as one scroll unit** — a `.subsection` that itself mixes a
page-level KPI/summary/recommendation grid with a detail table (e.g.
Watchlist Research Overview's `#wr-kpis` grid sitting directly beside its
screening-matrix table, Portfolio Analysis Overview's `#portfolio-kpis` grid
beside its allocation table) had no mechanism to keep the grid fixed while
only the table scrolled — both were equally direct children of the one
`overflow-y:auto` `.subsection`, so scrolling the table carried the KPI grid
away with it. This is the **desktop scrolling standard** this app now holds
to everywhere: persistent application, page, navigation and decision context
(Levels 1-4 below) remain outside the detailed-content scroll region; only
high-volume/detail content (Level 5) scrolls.

```
Level 1 — Application context     Global header, sidebar, watchlist selector, refresh
Level 2 — Page context            Page title, page description
Level 3 — Navigation              Primary / secondary / tertiary tabs
Level 4 — Decision context        KPI / summary / recommendation / score / trend cards
Level 5 — Detail work area        Tables, long lists, detailed analysis (scrolls)
```

**Fix**: reused the exact `.scroll-body` marker class the 3 no-sub-nav tabs
(Watchlists, Company Research, Reports) already use for "everything after
the fixed nav," one level deeper — a `.subsection` that mixes fixed Level-4
content with Level-5 detail now wraps only the Level-5 part in a
`.scroll-body` sibling placed after the fixed grid/context elements. One new
CSS rule generalizes the existing pass-through pattern:
`.subsection:has(>.scroll-body){overflow-y:visible}` (alongside the existing
`:has(>.subtab-root)`/`:has(>.card-table-fill)` cases), with
`.subsection>.scroll-body` added to the flex-shrink:1 exception list so the
wrapped region — not the outer `.subsection` — is the one that actually
bounds and scrolls. No JS, no pixel-offset math, no new scroll container
type: `.scroll-body` was already the shell's own answer to "wrap the
scrollable part," just previously applied only at the whole-tab level.

Applied everywhere this KPI-grid-plus-detail pattern existed: Watchlist
Research (Overview's screening matrix; Risk & Opportunity → Risk overview's
stock-by-stock matrix + institutional risk view), Portfolio Analysis
(Overview's allocation table + notes; Exposure Matrix's per-company table;
Health & Rebalancing's rebalancing-suggestions table, with the Portfolio
health/Historical health trend score cards kept fixed as Level-4 context
alongside it), Dashboard (Portfolio Intelligence's Action Required table +
Opportunity/Risk monitors + change log; Committee View's opportunity/risk/
sector/concentration/rebalancing cards), Market Intelligence (Macro
Intelligence's indicator tables, with the Market regime and Data Quality
cards kept fixed; Sector Intelligence's rollup table), and the Watchlists
tab (the "Portfolio summary" KPI card, previously inside the tab's own
`.scroll-body` alongside the company table — pulled out as a fixed sibling
before it).

Validated live (zero-dependency CDP driver over Node 22's built-in
`fetch`/WebSocket, same discipline as every prior pass in this history,
driving the system's real installed Chrome headless against a scratch
server on port 4188, never the user's own dev server): at both 1600×1000 and
a shorter 1400×600 viewport, `#wr-kpis`'/`#portfolio-kpis`' bounding rects
are pixel-identical before and after scrolling their subsection's
`.scroll-body` to its end (confirming the grid never moves while the table
genuinely does scroll); zero page-level (`html`/`body`) scroll at either
height; zero duplicate DOM ids; column sort, sidebar collapse, tab/sub-tab
navigation and watchlist data loading confirmed still functioning
end-to-end. No mutating route was ever called against the scratch server
(cache-only `GET` requests only); `git diff` after the run showed no change
to any `data/watchlists/*.json` beyond what was already uncommitted at the
start of the session. `node --check` clean on every touched file; `node
--test`: 109/109 unaffected. Files changed: `index.html`, `styles.css`.

**Global scrolling/width audit — 3 more fixed-context leaks, and a real
flex-item width bug** (2026-09-06, follow-on to the entry above): an explicit
user brief asked for a full repo-wide audit against this same Level 1-5
contract (not just the tabs already covered) plus a horizontal-width
consistency pass. Reading every `.subsection` in `index.html` against the
`:has(>.scroll-body)`/`:has(>.card-table-fill)`/`:has(>.subtab-root)` pattern
found 3 more instances the 2026-09-05 pass missed — all the same defect
(fixed context and Level 5 detail as un-wrapped flex siblings, so the whole
`.subsection` scrolled as one unit): Watchlist Research → Fundamentals →
Valuation (`wr-valuation` — the intro paragraph plus the valuation table and
the sector-dispersion card below it), Watchlist Research → Risk & Opportunity
→ Alerts (`wr-risk-alerts` — the intro paragraph and severity-filter pill row
plus the alerts table), and Market Intelligence → Earnings & Events
(`upcoming-earnings` — the intro paragraph plus the Earnings Intelligence
table, Portfolio Event Calendar card, and data-policy disclaimer). Each fixed
identically to every existing instance: wrap the Level 5 content in a
`.scroll-body` sibling placed after the fixed paragraph/filter row, no new
CSS rule needed (the existing `:has(>.scroll-body){overflow-y:visible}`
generalization already covers it). Portfolio Analysis → Health & Rebalancing
(one of the 3 named in the brief) was inspected and found already correct
from the 2026-09-05 pass — no change needed there.

**Width defect, distinct from the scroll-boundary issue**: the brief also
reported header/content width inconsistency and unnecessary centering.
Investigation found two independent causes. (1) `activateWorkspaceTab()`
toggled `full-bleed` (edge-to-edge width) only on `#main` for the Watchlists
tab, never on the header's own `.container` div — so on that one tab the
header's title/toolbar row stayed capped at 1900px while the page content
below it went edge-to-edge, a real left/right-edge mismatch between the two.
Fixed by giving the header's container div an id (`#header-container`) and
toggling `full-bleed` on both elements together. (2) A genuine, previously
undiagnosed CSS bug, confirmed live by inspecting computed styles (not
reasoning about the spec): `main#main.container` is both a flex item of
`.app-main` (`flex:1`) and carries `.container`'s own `max-width:1900px;
margin:auto` — and per the flexbox spec, an `auto` margin on a flex item's
cross axis (horizontal, since `.app-main` is `flex-direction:column`)
disables `align-items:stretch` for that item entirely, so the browser instead
shrink-to-fits the item to its own content width and only *then* distributes
the leftover space into the auto margins. Measured directly on a 1600px-wide
viewport: `#main` computed to 1205px wide with 87px auto margins each side,
on a workspace where 1380px was actually available (and the 1900px
`max-width` never even applied) — an arbitrary, content-dependent width that
varied per tab, exactly the "content centred inside a narrower container"
symptom reported. The header's own `.container` div is not a flex item
(`<header>` is the flex item; the div is an ordinary block inside it), so it
was never affected — which is why the two diverged. Fixed with one property:
`.container` gained an explicit `width:100%`, which gives the flex item a
definite cross size (stretching to fill available width) that `max-width`
then correctly caps only when available width actually exceeds 1900px —
confirmed live at both a narrow viewport (1380px available: header and main
both fill it exactly, zero gutter) and a wide one (2180px available: both
cap at 1900px and center with identical 140px margins each side). `report.
html`/`portfolio-review.html`/`committee-pack.html` do not reference
`styles.css` or the `.container` class at all (confirmed via grep) and are
unaffected, per this app's standing long-form-page exception.

Validated live: a zero-dependency Chrome DevTools Protocol driver (Node 22's
built-in `fetch`/`WebSocket`, same discipline as every prior pass in this
history) against a scratch server (port 4197, never the user's own dev
server on 4173), driving the system's real installed Chrome headless. All 3
newly-wrapped panels confirmed their fixed paragraph/filter row's
`getBoundingClientRect().top` was pixel-identical before and after scrolling
their own `.scroll-body` to its end. Header/main edge alignment confirmed at
1600px (both 220-1600, matching, full-bleed on Watchlists) and 2400px (both
360-2260, matching, centered at max-width on every other tab) viewport
widths, both before and after the `width:100%` fix (the divergence was
reproduced first, then confirmed resolved). Zero console errors (excluding
the standing `favicon.ico` 404). `node --check` clean on `script.js`/
`server.mjs`; `node --test`: 109/109 unaffected (no analytics/scoring/
decision/quant module touched). No mutating route was ever called against
the scratch server (`git status`/`git diff` on `data/watchlists/`/`data/
cache/` showed zero change after the run). Files changed: `index.html`,
`script.js`, `styles.css`.

**Layout contract** (formalizing the Level 1-5 hierarchy above as the
reusable rule for every future desktop screen and sub-tab in this app):

```
Application Shell
├── Fixed Sidebar                      (Level 1)
└── Workspace
    ├── Fixed Workspace Header/Context (Level 1 -- header, watchlist selector, refresh)
    └── Page Content Area
        ├── Fixed Page Context         (Levels 2-4)
        │   ├── Title, description     (Level 2)
        │   ├── Tabs / sub-tabs        (Level 3, nests: primary -> secondary -> tertiary)
        │   ├── Explanatory text       (Level 2/4, whichever precedes the detail region)
        │   └── KPI / summary content  (Level 4)
        └── Scroll Body                (Level 5 -- the ONLY region that scrolls)
            └── Table / detail / event / list content
```

Implementation rule, not just description: a `.subsection` (or nested
`.subtab-root`) that mixes any Level 1-4 element as a *direct sibling* of
Level 5 content must wrap the Level 5 part in a `.scroll-body` div — never
rely on the whole panel scrolling together. `:has(>.subtab-root)`/
`:has(>.card-table-fill)` turn the outer `.subsection` into a non-clipping
pass-through (safe there: a nested `.subtab-root` recursively repeats this
same fixed/scroll split one level deeper, and `.card-table-fill`'s own child
`.scroll` is directly flex-bounded, so nothing can overflow *its* box either
way). `:has(>.scroll-body)` deliberately does **not** get the same
pass-through treatment — see "Above yellow divider = fixed workspace
context..." below for why — the `.subsection` keeps its own default
`overflow-y:auto` as a contained fallback instead. A panel whose *entire*
content, after any intro text, is exactly one card wrapping one table uses
`.card-table-fill` + `.sticky-thead-native` instead (real `position:sticky`,
no wrapper needed) — see the two mechanisms compared earlier in this section.
A panel with no separate Level 1-4 content mixed in (the whole `.subsection`
is one homogeneous detail view, e.g. Portfolio Analysis's Correlation matrix,
Compare's per-metric panels) needs neither mechanism — the default
`.subsection{overflow-y:auto}` is already correct there, since there is no
separate context to keep pinned.

**Canonical horizontal alignment rule**: exactly one width policy for the
entire app shell, no per-tab exceptions. `.container` (used by both the
header's own container div and `#main`) is `width:100%;padding:20px` — no
`max-width`, no `margin:auto`, no centering, ever. The Watchlists tab (this
rule's own reference case, since it was the first screen built to use the
full available width) is not a special case any more; every workspace now
renders exactly like it: content begins immediately after the sidebar with
one consistent padding gutter, using 100% of the remaining width, and the
header's title/toolbar row shares that exact same left/right edge as the
page content below it on every tab, at every viewport width. There is no
"full-bleed" toggle any more (retired, see the dated entry below) because
there is no longer a second, narrower policy for it to toggle away from.

**Global scrolling/width audit round 2 — one universal width rule, and a
general leak-containment fix instead of per-page patches** (2026-09-06,
same-day follow-on to the audit above): a second explicit user brief, with
its own screenshots, found the previous pass's fix incomplete on both fronts
it addressed.

**Horizontal alignment**: the previous pass's `width:100%` fix correctly
stopped `#main` from shrinking to an arbitrary content-dependent width, but
left the *intentional* two-tier policy in place — every tab except
Watchlists still capped at `max-width:1900px;margin:auto`, which centers
content with a large gutter on any monitor wider than sidebar+1900px (common
on a real desktop, not exercised by this repo's own prior 1600/2400px test
viewports). The brief's explicit instruction, using the Watchlists tab's own
full-width layout as the canonical reference: **one** width policy for every
screen, not two. Fixed by deleting the cap outright — `.container` is now
`width:100%;padding:20px` with no `max-width`/`margin` at all — and retiring
the now-fully-redundant `full-bleed` toggle mechanism (`activateWorkspaceTab()`
no longer toggles any width-related class; `.container.full-bleed` is
deleted from `styles.css`) rather than leaving dead special-casing code
behind, per the brief's own "one coherent global rule, not a collection of
special-case fixes" instruction.

**Scroll boundary — a real, general leak found via a repo-wide audit at
multiple viewport heights, not just the 3 previously-checked screens**: a
comprehensive automated sweep (43 tab/sub-tab/nested-sub-tab combinations,
covering every screen named in the brief plus Dashboard/Reports/Compare for
completeness) measuring `#main`'s own `scrollHeight` vs. `clientHeight` at
each one (the general test for "did the page/main become an unintended
scroll surface" — see the validation note below) found this held (`0px`
overflow) for all 43 at a normal desktop viewport (1600x1000) and at a
narrower width alone (1280x1000), confirming the alignment fix above didn't
regress anything — but surfaced 2 real cases where `#main` genuinely
overflowed at a shorter viewport height (≤900px, common on smaller laptop
displays): Portfolio Analysis → Health & Rebalancing (a well-refreshed
watchlist's Historical health trend list, capped server-side at 30 entries
by `HEALTH_HISTORY_MAX_ENTRIES`, is taller than a typical viewport once
populated) and Market Intelligence → Macro Intelligence (the Market regime
card's data-driven notes list, `data/decision/marketRegime.mjs`, 0-5
sentences, combined with the Data Quality card, at a shorter viewport).

Root cause, confirmed by measuring each direct child's own bounding rect
(not guessed from the CSS alone): `.subsection:has(>.scroll-body)` was made
a non-clipping pass-through (`overflow-y:visible`) so `.scroll-body` would be
the one real scroll owner — correct in the common case, but when the fixed
siblings *before* `.scroll-body` (a KPI grid, or a two-col card pair) are,
combined, taller than the subsection's own flex-allocated box, `.scroll-body`
correctly shrinks to its floor (0px) but the fixed siblings (deliberately
`flex-shrink:0`, so they never lose content) cannot shrink further — so the
excess, with nothing between `.subsection` and `#main` willing to clip it
(`.tab.active`/`.subtab-root` deliberately don't, so a fixed-region dropdown/
tooltip isn't chopped), bubbled all the way up and made `#main` itself the
scroll surface, dragging the *tab's own title/subtabs nav* along with it —
worse than a merely-imperfect fixed region, since even Level 1-3 chrome
stopped staying put.

**General fix, not per-page patches**, per the brief's explicit instruction:
removed `.scroll-body` from the pass-through `:has()` selector (`styles.css`)
so `.subsection:has(>.scroll-body)` keeps its own *default*
`overflow-y:auto` instead of `visible`. This has zero effect in the
overwhelmingly common case (fixed content comfortably fits — confirmed live,
see below) and, in the edge case, contains the overflow at the `.subsection`
itself instead of leaking to `#main`: the tab-level title/subtabs nav above
the subsection never moves and `#main` never becomes a scroll surface,
though the KPI cards do lose their "stays fixed while the table scrolls"
property in that one narrow edge case — an explicit, disclosed, contained
degradation, not the previous silent architectural failure. Additionally, and
as a narrower, principled "specific component" exception the layout contract
already allows for a component whose content is genuinely unbounded (the
same class of exception as a very wide table needing its own horizontal
scroll): `#health-history` and `#macro-regime ul` each gained a
`max-height`+`overflow-y:auto` cap, since both hold a data-driven list rather
than a small fixed set of KPIs — this reduces (but, being a data-dependent
list, can't fully eliminate on its own) how much these two specific cards
can grow before the general `.subsection` fallback above would ever need to
engage.

Validated live (zero-dependency CDP driver over Node 22's built-in `fetch`/
`WebSocket`, scratch server port 4198, never the user's own dev server on
4173): the 43-path sweep re-run clean (`#main` and `document.scrollingElement`
both `0px` overflow, header/main edges identical) at 1600×1000 (normal),
1280×1000 (narrower width only), 1280×900, 1366×768 (a common real laptop
resolution) and 1280×800; only at an extreme 1280×700 did one further,
minor, disclosed case remain (Watchlists, 29px) — treated as an accepted
edge case below what "narrower desktop viewport" reasonably means, and not
fixed the same way `.tab.active` is, since making `.tab.active` itself
`overflow-y:auto` risks clipping the Watchlists add-company autocomplete
dropdown the existing "deliberately do NOT set overflow:hidden" comment
already protects. The core fixed/scroll-body contract was independently
re-confirmed at 1600×1000 on 6 representative panels (the 3 newly-fixed ones
from the prior pass, plus Health & Rebalancing, Watchlist Research Overview,
and Macro Intelligence): each fixed element's `getBoundingClientRect().top`
was pixel-identical before/after scrolling its own `.scroll-body` to its end,
and each `.scroll-body` genuinely scrolled (`scrollTop > 0` after the
attempt) — confirming the `overflow-y:auto` change did not regress the
primary "fixed stays fixed, only the detail region scrolls" behavior it was
layered on top of. The Watchlists add-company autocomplete dropdown was
re-checked directly (typed into the search box, read the suggestion
dropdown's own bounding rect) and renders unclipped, confirming the
`.tab.active`/`.subtab-root` overflow:visible behavior this fix deliberately
left untouched. `node --check` clean on `script.js`/`server.mjs`; `node
--test`: 109/109 unaffected (no analytics/scoring/decision/quant module
touched). No mutating route was ever called against the scratch server
(`git status`/`git diff` on `data/watchlists/`/`data/cache/` showed zero
change after the run). Files changed: `script.js`, `styles.css` (`index.html`
needed no change this pass).

> **Above yellow divider = fixed workspace context. Below yellow divider =
> bounded scrollable content.** Everything at Level 1-4 (sidebar, header,
> title, description, tabs/sub-tabs at every nesting depth, explanatory text,
> KPI/summary/recommendation cards) stays fixed; only Level 5 (tables, long
> lists, event calendars, history lists, matrices) scrolls, inside its own
> `.scroll-body` (or `.card-table-fill>.scroll`/`.sticky-thead-native`)
> boundary — never the page, and never `#main`.

**Watchlist Research Overview screening matrix — fixed-header regression fix**
(2026-09-06, follow-on to the "yellow divider" rule immediately above): a
screenshot-driven report showed `#wr-overview-table`'s own card — Screening
matrix title, "Rank by" dropdown, description paragraph, and the table
itself — scrolling away as one unit, i.e. entirely above the yellow divider
by this section's own definition. Root cause: this panel is the one
Watchlist Research table that mixes a KPI grid (`#wr-kpis`, Level 4) with a
*single* detail table, so the 2026-09-05 "Fixed-context regression fix"
above routed it to `.scroll-body` at the *subsection* level — correct for
keeping the KPI grid pinned, but coarser than required here: the brief
wanted the card's own title/dropdown/description pinned too, with only the
table's header+rows split at the sticky boundary, i.e. the same
`.card-table-fill`+`.sticky-thead-native` split this section already gives
the other 10 single-table Watchlist Research panels (Profitability/Balance
sheet/Ownership/Growth/Trend/Momentum/Volume/Relative strength/Volatility/
Signals). Converted `#wr-overview-table`'s card to that same mechanism
(`class="card card-table-fill"`, table `class="sticky-thead-native"`
replacing the floating-clone marker `thead-sticky-1` — this table is no
longer floating-clone-driven) instead of inventing a one-off structure for
this one screen.

That direct substitution alone reopened the exact "mixed panel can overflow"
hazard `.scroll-body`'s own pass-through exclusion (the "Global scrolling/
width audit round 2" entry above) already exists to prevent — confirmed
live: at a short viewport, `.card-table-fill`'s unconditional
`.subsection:has(>.card-table-fill){overflow-y:visible}` pass-through let
`#wr-kpis` (which never shrinks) squeeze `.scroll` down to 0-9px, both
hiding the table and (a new, distinct finding) breaking `position:sticky`
itself — Chrome cannot hold a sticky cell fully in place once its own height
exceeds its scroll container's. Fixed with two small, general refinements to
the existing rules, not a per-panel special case: (1)
`.subsection:has(>.card-table-fill)`'s pass-through now excludes a
`.subsection` that also has a `.grid` sibling
(`:not(:has(>.grid))`) — the identical structural signal (a KPI grid
sharing the subsection) `.scroll-body`'s own exclusion already keys off,
generalized to cover `.card-table-fill` too, so the other 10 no-KPI-grid
single-table panels are unaffected (confirmed: none of them has a `.grid`
sibling); (2) `.card-table-fill>.scroll` gained a `min-height:120px` floor
(roughly the sticky header row plus 2 data rows) — a floor, not a fixed
size, so it has zero effect whenever more space is actually available.

**Disclosed residual edge case**: at 1366×768 and 1280×700 specifically, the
floor can still make the fixed header content (KPI grid + card header)
combined exceed the subsection's own allocated height by 77-145px; since the
subsection is no longer a pass-through, this excess is contained at the
subsection itself (its own `overflow-y:auto` engages) rather than leaking to
`#main` — the identical accepted trade-off already disclosed above for
Health & Rebalancing/Macro Intelligence at short viewports. This is reachable
only by deliberately scrolling while hovering the fixed area itself (KPI
cards/title text), not the table — the normal interaction (scrolling while
hovering the table) always targets `.scroll` first and keeps every fixed
element pinned exactly as required, confirmed live at all 4 viewports named
in the brief (1600×1000, 1280×900, 1366×768, 1280×700): fixed elements'
`getBoundingClientRect()` pixel-identical before/after scrolling the table,
the sticky `<th>` itself (not the non-sticky `<thead>` wrapper — measuring
the wrong element here first produced a false failure, corrected before
concluding anything, the same class of mistake this document's own history
already warns about) held at a constant position throughout, column
alignment held (`theadFirstThLeft === firstRowFirstTdLeft`), and zero
`document.documentElement`/`#main` overflow in every case. Validated live via
a zero-dependency Chrome DevTools Protocol driver (Node 22's built-in
`fetch`/`WebSocket`) against a scratch server (port 4199, never the user's
own dev server on 4173); regression-checked Profitability (a `card-table-fill`
panel with no `.grid` sibling, confirming `:not(:has(>.grid))` doesn't change
its existing pass-through), Watchlist Research → Valuation
(`.scroll-body`), Portfolio Analysis, Dashboard, and the Watchlists tab's
add-company autocomplete dropdown (still unclipped) — all unaffected.
`node --check` clean; `node --test`: 109/109 unaffected (`script.js`
untouched this pass). No mutating route was called against the scratch
server; `data/watchlists/`/`data/cache/` unchanged. Files changed:
`index.html`, `styles.css`.

**Portfolio Analysis Overview allocation table — same fixed-header regression,
different shape (two-col, not KPI-grid-plus-single-card)** (2026-09-06,
follow-on to the `#wr-overview-table` fix above): a screenshot-driven report
showed the Screen-derived model allocation card's title, description
paragraph, column headers, and the sibling Portfolio construction notes card
all scrolling away together with the company rows — everything above the
yellow header/body divider by this section's own definition. Root cause: this
panel's `.scroll-body` (from the 2026-09-05 "Fixed-context regression fix")
wrapped the entire `.two-col` — both the allocation card *and* the notes
card — as one scroll unit, instead of bounding only the table's own rows.
Unlike `#wr-overview-table` (one card, one table, no sibling card), this
panel's table card sits beside a second, unrelated card in a `.two-col` grid,
so the fix needed one further generalization beyond the direct substitution
that worked there.

Converted the allocation card to the same `.card-table-fill` +
`.sticky-thead-native` mechanism (`#portfolio-table` class changed from
`thead-sticky-1` to `sticky-thead-native`) and removed the `.scroll-body`
wrapper entirely — the table's own `.scroll` is now the one bounded,
scrolling box, with the card's `h3`/description staying naturally fixed
(same flex-column mechanics as every other `card-table-fill` panel). The
notes card is left as an ordinary `.card` sibling inside the same `.two-col`;
CSS Grid's default `align-items:stretch` gives it the same row height as the
table card with nothing of its own to scroll, so it stays genuinely fixed
with no code of its own. One new general CSS rule handles the row's sizing:
`.subsection>.two-col:has(>.card-table-fill){flex:1;min-height:0}` — the same
flex:1;min-height:0 treatment `.scroll-body`/`.card-table-fill` already get
as direct children of `.subsection`, extended to a `.two-col` wrapper so it
can actually shrink into (and fill) the subsection's remaining space instead
of sizing to its own content and pushing the overflow further up. `#portfolio-
kpis` (the KPI grid above the two-col row) stays `flex-shrink:0` (the
existing default), unaffected. `script.js`'s own comment documenting which
tables remain on the floating-header-clone mechanism was updated to drop
"Portfolio's allocation" from that list (rebalancing/exposure tables are
unaffected and remain on the clone mechanism, since neither needed this
change) — no functional change to `script.js`, `initFloatingHeaders()`'s
generic `table[class*="thead-sticky-"]` selector automatically stops
registering `#portfolio-table` for a clone now that its class no longer
matches.

Validated live (zero-dependency Chrome DevTools Protocol driver, Node 22's
built-in `fetch`/`WebSocket`, driving the system's real installed Chrome
headless against a scratch server, never the user's own dev server on 4173):
at all 5 viewports named in the brief (1600×1000, 1280×900, 1366×768,
1280×800, 1280×700), against the Asmita watchlist (30 companies): the
allocation card's title, description paragraph, sticky `<th>` (not the
non-sticky `<thead>` wrapper — measuring the wrong element here first, then
correcting, is the same class of mistake this document's own history already
warns about), the notes card, and `#portfolio-kpis` all measured pixel-
identical (`getBoundingClientRect()`) before and after scrolling the table's
own `.scroll` to its end; the scroll genuinely engaged (`scrollTop > 0` after
the attempt) in every case; column alignment held
(`theadFirstThLeft === firstBodyTdLeft`); `document.documentElement`/`#main`
both measured exactly `0px` overflow before and after, at every viewport —
confirming the fix contains scrolling at the table's own `.scroll` and never
leaks to the page or `#main`. `#portfolio-table` confirmed to carry
`sticky-thead-native` (not a `thead-sticky-*` clone class) with a real
`position:sticky` computed style, and zero duplicate DOM ids app-wide.
Regression-checked at the same 5 viewports: Watchlist Research → Overview →
Screening matrix, Watchlist Research → Risk & Opportunity → Risk overview →
Stock-by-stock risk matrix, and Portfolio Analysis's own Health & Rebalancing
→ Rebalancing suggestions and Exposure Matrix → Per-company exposure (both
still on the floating-clone mechanism, untouched by this change) — each
panel's own fixed card title held position across a scroll attempt and
neither `#main` nor the page ever overflowed. Zero console errors/exceptions
throughout. `node --check` clean on `script.js`/`server.mjs`; `node --test`:
109/109 unaffected (no analytics/scoring/decision/quant module touched — this
pass is `index.html`/`styles.css`, plus one comment-only line in
`script.js`). No mutating route was ever called against the scratch server
(only page loads, tab/subtab clicks, and scroll/DOM measurement); `git diff`
on `data/watchlists/`/`data/cache/` showed zero change after the run. Files
changed: `index.html`, `styles.css`, `script.js` (comment only).

**Below-the-yellow-divider content split into sub-tabs — 4 panels that
bundled a distinct secondary analytical view inside one Level-5 scroll
region** (2026-09-07, follow-on to the "yellow divider" rule above): a UX
review asked, per panel, exactly what content lived below the fixed/scroll
boundary and whether it represented a second, distinct analytical view
crammed into the same scrolling region as the panel's primary table — the
`.subtab-root` mechanism (`system.md` §2.3 above, `applySubtabState()`/
`initSubtabs()`) already exists precisely to give such content its own
click-to-switch view instead of forcing a scroll past one table to reach an
unrelated one. Four genuine cases were found and split, each reusing the
exact nested-subtab pattern Quality/Correlation/Technicals already
established (`.tab`/`.subtab-root` → `.subtab-root`, `.subtabs-secondary`/
`.subtabs-tertiary` nav styling, `data-section-label`) — no new tab
mechanism, no per-panel one-off:

1. **Watchlist Research → Fundamentals → Valuation** (`wr-valuation`): the
   per-company valuation table and the "Sector valuation dispersion" card
   (a statistical spread-of-P/E-by-sector view, a different analytical
   question from the per-company table above it) shared one `.scroll-body`.
   Split into a new tertiary `.subtab-root#wr-valuation-detail` (Valuation /
   Sector Dispersion), matching Quality's own sibling nesting depth exactly.
   `#valuation-table` migrated from the floating-header-clone mechanism
   (`thead-sticky-2`) to `.card-table-fill`+`.sticky-thead-native` (real
   `position:sticky`), consistent with every other table that ends up alone
   in its own single-table subsection.
2. **Portfolio Analysis → Attribution** (`attribution`): 4 cards (Sector
   contribution, Position risk contribution, Portfolio quality attribution,
   Portfolio valuation attribution) in two stacked `.two-col` rows meant
   scrolling past the first pair to reach the second. Split into a new
   secondary `.subtab-root#portfolio-attribution-detail` grouped by what
   each pair actually answers: **Contribution** (how weight/risk is
   distributed — sector contribution + position-level risk contribution)
   and **Score Attribution** (which holdings drive the composite
   quality/valuation reads — both already share the same `attributionList()`
   renderer).
3. **Market Intelligence → Sector Intelligence** (`sector-intelligence`): the
   Sector rollups table (up to the full 36-sector taxonomy) and "Priority
   sectors with no coverage" (a gap-disclosure list, a different concern
   from sector performance data) shared one `.scroll-body`. Split into a new
   secondary `.subtab-root#sector-intel-detail` (Sector Rollups / Coverage
   Gaps); `#sector-intel-table` gained `.card-table-fill`+
   `.sticky-thead-native` now that it's alone in its own subsection (it had
   no sticky mechanism at all before, having been an explicit "bounded row
   count" exception to the floating-clone rollout — no longer needed once it
   is a single-table panel).
4. **Market Intelligence → Earnings & Events** (`upcoming-earnings`): the
   Earnings Intelligence table (one row per watchlist company), the
   Portfolio Event Calendar (a separate, real-news list), and the "Data
   policy" disclaimer shared one `.scroll-body`. The disclaimer was first
   (incorrectly) hoisted to fixed intro text on the assumption it was a
   short note; live measurement at a 1366×768 viewport caught this
   immediately (`#main` overflowed 1716px vs. a 580px box) because
   `#data-limitations` is actually `research.mjs`'s full `DATA_LIMITATIONS`
   list — ~18 full-sentence disclosures, genuinely substantial, not a
   footnote. Corrected to a third tab instead of a fixed element: split into
   a secondary `.subtab-root#earnings-events-detail` with three tabs —
   Earnings Intelligence / Event Calendar / Data Policy — each a
   self-contained view. `#earnings-intel-table` migrated from
   `thead-sticky-1` to `.card-table-fill`+`.sticky-thead-native` for the
   same single-table-subsection reason as above.

**General CSS fix required, not a per-panel patch**: case 3 above was the
first place in the app where a `.grid` KPI summary (`#sector-intel-kpis`)
sits directly beside a `.subtab-root` in the same `.subsection` — the exact
"mixed panel" shape the `.card-table-fill` pass-through exclusion
(`:not(:has(>.grid))`, documented above) already exists to protect against,
but that exclusion had only ever been applied to `.card-table-fill`, not
`.subtab-root`, since no prior panel combined the two. Generalized
`styles.css`'s `.subsection:has(>.subtab-root)` pass-through selector to
carry the identical `:not(:has(>.grid))` exclusion — verified against every
existing `.subtab-root` parent in the app (none has a `.grid` sibling today)
to confirm zero behavior change anywhere except this one new case.

Every existing sub-tab elsewhere in the app that mixes a Level-4 KPI/context
grid with Level-5 detail in one `.scroll-body` was re-examined against the
same "is this a second distinct view, or one homogeneous table" test and
deliberately left unsplit, per the brief's own "do not create arbitrary
tabs" instruction: Watchlist Research → Risk & Opportunity → Risk overview's
"Institutional risk view" card is one short methodology paragraph (`
#risk-summary`, ~480 characters), not a second analytical view; Market
Intelligence → Macro Intelligence's "Macro indicators"/"Not available"
tables together total only 15 rows (6 fetched + 9 disclosed-unavailable, `
data/providers/macroProvider.mjs`) and read as one available-vs-unavailable
diagnostic; Dashboard's Portfolio Intelligence and Committee View
sub-tabs are each an intentional single-scroll presentation roll-up (the
tab's own intro text says so) rather than an accidental bundling; Company
Research's one-scrolling-page-per-company architecture (§2.3 above) is a
separate, deliberate design predating and independent of this pattern.

Validated live (zero-dependency Chrome DevTools Protocol driver, Node 22's
built-in `fetch`/`WebSocket`, driving the system's real installed Chrome
headless against a scratch server on port 4321, never the user's own dev
server on 4173): 35 functional assertions at a normal desktop viewport
(default size) covering all 4 new `.subtab-root`s against the Asmita
watchlist (30 companies, the largest saved watchlist) — each new tab shows
the correct panel and hides its sibling(s) on click, every table/list still
renders real data (30 valuation rows, 18 sector rows, 30 earnings rows, the
full data-policy list, non-empty attribution/dispersion/coverage-gap
content), `#main` never overflows, zero duplicate DOM ids, zero console
errors/exceptions; a second pass at 1366×768 confirmed `#valuation-table`/
`#sector-intel-table`/`#earnings-intel-table` all carry a real computed
`position:sticky` header and column-sort still applies its indicator class
post-migration from the floating-clone mechanism — this same pass is what
caught and led to correcting the Data Policy defect above; a third pass
covered 1280×700 (this app's own previously-documented "extreme, accepted
edge case" viewport) and the 390px mobile breakpoint (document-scroll
fallback, sidebar drawer) with no crash and no horizontal overflow, and
reproduced the single ~4px `#main` overflow at 1280×700 already
class-accepted elsewhere in this document (e.g. the Watchlists tab's 29px
case at the same viewport) rather than a new defect. `node --check` clean on
`script.js`/`server.mjs`; `node --test`: 109/109 unaffected (no
analytics/scoring/decision/quant module touched — this pass is
`index.html`/`styles.css` only). No mutating route was ever called against
the scratch server (only page loads, watchlist switch via the existing
`#watchlist-select`, tab/sub-tab clicks, and DOM measurement); `git diff` on
`data/watchlists/`/`data/cache/` showed zero change after the run (the one
watchlist-switch exercised, to Asmita, is a client-side selection change
recorded server-side as an `activeWatchlist` pointer write — confirmed
reverted to this session's pre-run value after finishing, per this
document's own standing validation discipline for scratch-server runs).
Files changed: `index.html`, `styles.css`.

**Macro Intelligence — India Macro / US Macro geography split** (2026-09-07,
same-day follow-on to the "Below-the-yellow-divider" split immediately above):
that entry deliberately left Macro Intelligence's "Macro indicators"/"Not
available" table pair unsplit, since together they read as one available-vs-
unavailable diagnostic, not two distinct analytical views. A separate,
narrower brief asked for a different split of the same below-the-divider
content — by geography, not by availability — so India-specific and
US-specific/global-US-driven indicators are each on their own screen. Added
a second-level `.subtab-root#macro-geography-detail` (India Macro / US Macro,
`.subtabs-secondary`) below the still-unchanged Market regime/Data Quality
cards, reusing the exact nested-subtab mechanism the entry above already
established for Sector Intelligence/Earnings & Events — no new nav component.
Geography is a client-side lookup keyed off each indicator's own `key` field
(already present on every `macroProvider.mjs` indicator, fetched or
disclosed-unavailable) — zero backend/data/calculation change, purely which
of two tables (`#macro-indicators-table-india`/`-us`) a row's markup goes
into: **India Macro** gets USD/INR and India VIX (the 2 India-relevant
fetched indicators) plus all 9 disclosed-unavailable indicators (every one is
India-specific by definition — RBI/G-Sec/CPI/IIP/PMI/power/ethanol/defence/
banking liquidity); **US Macro** gets the other 4 fetched indicators, each
sourced via a US-benchmark ticker (US 10Y Treasury yield, WTI crude, Henry
Hub natural gas, COMEX gold). No indicator appears in both tabs. India Macro
is the default tab, matching the workspace's own "Indian Equity Market"
framing (`#market-intelligence`'s own intro line).

One CSS-architecture interaction required deliberate handling, not a direct
substitution: the generic `.subsection:has(>.subtab-root):not(:has(>.grid))`
pass-through (§2.3 above, "Below-the-yellow-divider" entry) would otherwise
apply here too, since macro's fixed siblings before the new `.subtab-root`
(Market regime, Data Quality) are plain `.card` elements, not a `.grid` — the
one structural signal that rule currently keys off. But this exact panel is
the one `system.md` already names, twice (the "Global scrolling/width audit
round 2" and "Fixed-context regression fix" entries above), as the specific
case where those two fixed cards, combined, can exceed the subsection's own
box at a short viewport — which is why `.subsection:has(>.scroll-body)` was
deliberately left off the pass-through list in the first place. Picking up
the pass-through here via `.subtab-root` would reintroduce that exact,
already-fixed overflow-to-`#main` leak. Fixed with one higher-specificity,
ID-scoped override rather than broadening the general `.grid` signal (which
would need to also match "two-or-more-cards" generically, a shape CSS can't
reliably detect): `.subsection:has(>#macro-geography-detail){overflow-y:auto}`
— the outer subsection keeps its already-validated contained-fallback
behavior exactly as before; the `.subtab-root` itself still renders correctly
(its own nav bar fixed, each India/US panel wrapped in its own genuinely
bounded/scrolling `.scroll-body`, same shape the original combined panel
already used). Files changed: `index.html`, `script.js`, `styles.css`.

Validated live (zero-dependency Chrome DevTools Protocol driver, Node 22's
built-in `fetch`/`WebSocket`, real installed Chrome headless, scratch server
port 4321, never the user's own dev server on 4173) against real cached macro
data (`GET /api/macro` read directly first: 6 Live indicators, 9 Future
Integration, confirmed before any UI check). 16 scripted assertions passed at
each of 4 viewports — 1600×1000, 1366×768, 1280×700 (the exact short-height
case the CSS override protects), and 900×700 — covering: nav order/labels,
India Macro as the default active tab on a fresh session (localStorage's
`subtab:macro-geography-detail` cleared first, to rule out a prior run's
persisted selection carrying over), India Macro's indicator table showing
exactly USD/INR + India VIX and its unavailable table showing exactly the 9
disclosed indicators, switching to US Macro showing exactly the 4 expected
indicators, 15 total rows with zero duplication, the Market regime/Data
Quality cards rendering unchanged, zero `#main` overflow, India Macro's own
`.scroll-body` genuinely bounded/scrolling while its sub-tab nav bar stays
pixel-fixed during that scroll, and zero console errors (excluding the
pre-existing, already-disclosed `favicon.ico` 404 this document records at
every prior pass). At 390×844 (mobile, <900px) the existing documented
document-scroll fallback engaged correctly (not a regression) — `#main`
overflow 0, no horizontal overflow at any tested width, same 16/16 functional
assertions pass. A full 8-workspace click-through (every sidebar tab, both new
India/US Macro states) found zero duplicate DOM ids and zero console errors
app-wide, confirming the new `#macro-geography-detail`/`#macro-indicators-
table-india`/`#macro-indicators-table-us` ids introduced no collision. `node
--check` clean on `script.js`/`server.mjs`; `node --test`: 109/109 unaffected
(no analytics/scoring/decision/quant/provider module touched). No mutating
route was ever called against the scratch server; `git diff` on
`data/watchlists/`/`data/cache/` after the session matched the pre-existing
uncommitted state from the user's own prior activity (unrelated, predating
this session, confirmed via timestamp). Scratch Chrome and the scratch server
were both terminated, and the scratch Chrome profile directory deleted,
before finishing.

**Macro Intelligence — India/US Macro promoted to peer-level tabs, supersedes
the nested geography split above; India Gold Rate integrated** (2026-09-07,
same-day follow-on): a further brief required India Macro/US Macro to behave
as fully independent views rather than a nested sub-tab pair sitting below
always-visible Market regime/Data Quality cards — clicking Market Intelligence
must show *only* Market regime + Data Quality, clicking India Macro must hide
those entirely, and clicking US Macro must hide both those and every India
indicator. The nested `#macro-geography-detail` `.subtab-root` built in the
entry immediately above is removed outright (not deprecated in place): India
Macro and US Macro are now two more buttons in `#market-intelligence`'s own
primary `.subtabs` bar, siblings of Sector Intelligence/Earnings & Events/News
& Catalysts, each backed by its own top-level `.subsection` — exactly the same
`applySubtabState()`/`initSubtabs()` mechanism every other primary-level
workspace nav already uses, zero new JS. What was the "Macro Intelligence"
button is relabeled **"Market Intelligence"** (`data-subtab="macro-intelligence"`
value kept unchanged, so no other reference — Quick Jump, `localStorage`
persistence — needed updating) and now contains *only* the Market regime and
Data Quality cards, nothing else. Market regime/Data Quality cards, the India
indicators + Future-Integration tables, and the US indicators table all keep
their exact element ids (`#macro-regime`, `#macro-data-quality`,
`#macro-indicators-table-india`, `#macro-unavailable-table`,
`#macro-indicators-table-us`) — only DOM parent/nav position moved, same
technique as every prior IA relocation in this app. One CSS simplification
falls out of this for free: the ID-scoped `.subsection:has(>#macro-geography-
detail){overflow-y:auto}` override the prior entry needed (to counteract the
generic `.subtab-root` pass-through rule) is deleted — the "Market
Intelligence" tab is now a plain leaf `.subsection` with no nested
`.subtab-root` and no `.grid` sibling, so the *default* `.subsection{overflow-
y:auto}` rule already bounds it correctly with zero special-casing; likewise
the `.scroll-body` wrapper the India/US panels previously needed (to get their
own bounded scroll region one level inside the now-removed nested root) is
gone — each is now a leaf-level `.subsection` under `.tab.active` directly,
which is already its own scroll owner by the architecture's own "default case"
(§2.3 above, "App-wide bounded-viewport shell").

**India Gold Rate** (`data/providers/macroProvider.mjs`) is a new, genuinely
real 7th `MACRO_INDICATORS` entry: `GOLDBEES.NS` (Nippon India ETF Gold BeES),
fetched via the exact same `fetchQuote()`/`.NS`-ticker path every equity price
in this app already uses — a real, unmodified, NSE-listed market price, not a
converted or estimated figure, so it is tagged `sourced`/High confidence in
`metricRegistry.mjs`'s existing `macroIndicator` entry (extended, not
duplicated — the same one entry already covering the other 6 indicators) and
renders in the India Macro table alongside USD/INR and India VIX (all three
excluded from `MACRO_US_KEYS`, so the existing India/US filter in
`renderMacroIntelligence()` needed zero logic change — the new indicator just
falls out of the same key-based split). **India Crude Oil** and **India
Natural Gas** were evaluated for the same brief and added to
`UNAVAILABLE_MACRO_INDICATORS` instead of integrated: no NSE-listed ETF (unlike
gold) or other free, unauthenticated, machine-readable India-specific proxy
exists for either — MCX futures data requires a paid/authenticated feed this
app does not have, and approximating from the existing USD-denominated
WTI/Henry-Hub tickers under an "India" label was rejected as exactly the kind
of substitution CLAUDE.md's data policy prohibits. The brief's own explicit
allowance for *authenticated* sources this time was deliberately not exercised
in this pass: this app manages no API-key/secrets infrastructure today, and
none could be provisioned without the user registering for one; a real,
unauthenticated alternative was investigated instead. The pre-existing 9
Future Integration indicators (RBI repo rate, India G-Sec yield, CPI, IIP,
PMI, power demand, ethanol policy, defence budget, banking liquidity) were
re-evaluated the same way: FRED's `fredgraph.csv` endpoint (St. Louis Fed) is
free, unauthenticated and does carry India-tagged OECD series, confirmed
directly reachable and returning real CSV data in this session — but every
candidate series checked failed this app's own Live/Delayed data-quality bar:
`INDIR3TIB01STM` is a market-determined 3-month interbank rate, not the RBI's
own policy repo rate (the two move together but are not the same measure, and
mislabeling one as the other was rejected); `INDCPIALLMINMEI` (CPI) and
`INDPROINDMISMEI` (IIP) returned real series but 18 and 31 months stale
respectively as of this session — far beyond what this app's "Delayed" status
already means elsewhere (a fresh fetch failing but a recent cached reading
still showing), so presenting either would misrepresent the status model
rather than extend it honestly. All 9 remain Future Integration, plus the 2
new India Crude Oil/Natural Gas entries (11 total) — `macroProvider.mjs`'s own
top-of-file comment now discloses this FRED investigation and its outcome
directly, so a future pass doesn't have to re-discover it from scratch.

Validated live (zero-dependency Chrome DevTools Protocol driver, Node 22's
built-in `fetch`/`WebSocket`, real installed Chrome headless, a scratch server
on port 4322, never the user's own dev server on 4173): `GET /api/macro` read
directly first — confirmed all 7 indicators (including the new India Gold
Rate) returned `"status":"Live"` with a real fetched value against the real
Yahoo endpoint (`goldIndia` = ₹125.58/unit at fetch time), and 11 Future
Integration entries including the 2 new India Crude Oil/Natural Gas rows. 34
scripted assertions passed: primary nav order/labels exactly `Market
Intelligence | India Macro | US Macro | Sector Intelligence | Earnings &
Events | News & Catalysts`; clicking Market Intelligence shows only that
panel (India/US hidden) with Market regime + Data Quality populated and
`#macro-geography-detail` confirmed absent from the DOM; clicking India Macro
shows only that panel with exactly 3 rows (USD/INR, India Gold Rate, India
VIX) in the indicators table and exactly 11 in the Future-Integration table;
clicking US Macro shows only that panel with exactly 4 rows and zero
India-labeled rows; zero duplicate DOM ids app-wide; zero horizontal overflow
and zero `#main` vertical overflow at 1600×1000, 1366×768 and 1280×700 (this
app's own previously-documented short-viewport edge case) across all three
macro tabs; the 390px mobile breakpoint showed zero horizontal overflow across
all three tabs; the 3 unaffected sibling tabs (Sector Intelligence, Earnings &
Events, News & Catalysts) each still show only their own panel with all 3
macro panels hidden; the India indicators table's `.scroll` wrapper still
carries `overflow-x:auto` (horizontal table scroll preserved); Watchlist
Research's `#wr-overview-table` (a genuinely unrelated, untouched workspace)
still rendered correctly, confirming no app-wide regression; zero console
errors/exceptions (the sole exception, `favicon.ico` 404, is the same
pre-existing, disclosed non-issue every prior validation note in this app
records). `node --check` clean on every changed `.mjs`/`.js` file plus a full
repo-wide sweep (`git ls-files "*.mjs" "*.js"`, matching the CI gate exactly);
`node --test`: all 109 tests/36 suites pass (no analytics/scoring/decision/
quant module touched — this pass is `index.html`/`script.js`/`styles.css`/
`data/providers/macroProvider.mjs`/`data/watchlist/macro.mjs`/
`data/metadata/metricRegistry.mjs` only). No mutating route was ever called
against the scratch server (only page loads, sidebar/sub-tab clicks, and a
direct `GET /api/macro`); `git diff` on `data/watchlists/` after the session
showed only the pre-existing uncommitted state already present before this
session began (confirmed against the session's own starting `git status`, not
caused by this pass); `data/cache/` gained a new, expected, regenerable
`goldIndia` cache entry from the real Yahoo fetch above. Scratch Chrome and
the scratch server were both terminated, and both scratch Chrome profile
directories deleted, before finishing. Files changed: `index.html`,
`script.js`, `styles.css`, `data/providers/macroProvider.mjs`,
`data/watchlist/macro.mjs`, `data/metadata/metricRegistry.mjs`.

**Macro Intelligence — Trend Parameters (20/50/100/200 DMA, trend, DMA
alignment) added to India Macro / US Macro** (2026-09-07, same-day follow-on
to the India Gold Rate pass above): a further brief required every live,
market-price-based macro indicator to carry the same Trend/20 DMA/50 DMA/100
DMA/200 DMA/DMA Alignment presentation the equity Technicals → Trend table
(`#technical-table-trend`, `script.js`'s `dmaCell()`/`dmaAlignmentLabel()`)
already established. Per the brief's own "reuse, don't duplicate" constraint,
this is wired entirely through the existing calculation path, not a second
technical-analysis engine: `yahooQuoteProvider.mjs`'s `fetchQuote()` already
computes `twentyDayAverage`/`fiftyDayAverage`/`hundredDayAverage`/
`twoHundredDayAverage` (simple moving averages of the real trailing daily-
close history the Yahoo chart endpoint returns) and `trendLabel()` for *any*
symbol, equity or otherwise — `macroProvider.mjs`'s `fetchMacroQuote()`
previously narrowed that response down to `price`/`changePct`/
`oneYearChangePct`/`fiftyDayAverage`/`twoHundredDayAverage` only (a deliberate
narrowing, per its own comment, since a macro card didn't need the rest yet);
it now also passes through `twentyDayAverage`/`hundredDayAverage` and calls
the same `trendLabel(price, fifty, twoHundred)` used everywhere else. `data/
watchlist/macro.mjs`'s `toIndicator()` widened to expose `trend`/`dma20`/
`dma50`/`dma100`/`dma200` on every indicator object (all `null`/`'N/A'` until
`fetchQuote()` itself has enough trading days for a given period — never
fabricated, same "blank until real" convention the equity table already
follows). `renderMacroIntelligence()` (`script.js`) builds each Trend row via
a small adapter object (`{ price: ind.value, twenty: ind.dma20, fifty:
ind.dma50, hundred: ind.dma100, twoHundred: ind.dma200 }`) passed straight
into the existing `dmaCell()`/`dmaAlignmentLabel()` — the exact same
functions, not a reimplementation, since a macro indicator's shape maps onto
a stock's DMA fields one-to-one.

**UI**: a new "Trend" `article.card` (`#macro-trend-table-india`/`-us`) sits
directly below each existing indicator table (India macro indicators / US
macro indicators), inside the same `.scroll` + `.tech-table` wrapper every
macro table already uses — no new scroll mechanism, no sticky-header
treatment (these tables are 3-7 rows, the same "too short to matter" class
`system.md`'s own prior audit already exempted the other macro tables from).
Only the 7 fetched indicators (India: USD/INR, India Gold Rate, India VIX; US:
US 10Y Treasury yield, WTI crude, Henry Hub gas, Gold) get a Trend row — the
11 Future Integration indicators have no price series to compute a trend
from and are correctly left out of this table entirely, not shown with
fabricated blanks. One new `metricRegistry.mjs` entry, `macroTrend`,
discloses the reused-calculation methodology and is surfaced via a new
`infoIcon('macroTrend')` next to each Trend card heading (`#macro-trend-
methodology-info-india`/`-us`), same `infoIcon()` component the existing
`macroIndicator` disclosure already uses.

Validated live (zero-dependency Chrome DevTools Protocol driver, Node 22's
built-in `fetch`/`WebSocket`, real installed Chrome headless, a scratch
server on port 4501, never the user's own dev server): the shared `data/
cache/macro/*.json` bundles predated this change (written before `dma20`/
`dma100`/`trend` existed on the quote shape), so they were cleared first to
force a real fetch — regenerable cache, not source, same as every prior
macro pass's disclosed cache handling — and `GET /api/macro` confirmed all 7
indicators returned real, distinct DMA values and a trend label consistent
with the DMA relationship (e.g. US 10Y Treasury yield: price 4.784 > 50 DMA
4.6334 > 200 DMA 4.3596 → "Uptrend"; India VIX: price 11.16 < 50 DMA 12.1192
< 200 DMA 14.4937 → "Downtrend"; USD/INR: price below its 50 DMA but that 50
DMA above its 200 DMA → neither condition holds → "Sideways" — the disclosed
non-monotonic case, not a bug). A DOM-level check at 4 viewports (1600×1000
default desktop, 1366×768, 1280×700, 390×844 mobile) confirmed: both Trend
tables render the exact 7-column header (Indicator/Trend/20 DMA/50 DMA/100
DMA/200 DMA/DMA Alignment); India shows exactly its 3 indicators and US
exactly its 4, with zero label overlap between the two; DMA Alignment counts
matched a manual recomputation off the same row's own DMA values (e.g. WTI
crude 4/4 above, India VIX 0/4 above); zero duplicate DOM ids app-wide; zero
console errors/exceptions; `document.documentElement` and `#main` showed zero
horizontal or vertical overflow at every viewport, including mobile where the
new table's own `.scroll` wrapper (not the page) carried the horizontal
overflow (487px measured directly), confirming the required page-contained-
horizontal-scroll behavior. `node --check` clean on every changed `.mjs`/
`.js` file plus a full repo-wide sweep matching the CI gate; `node --test`:
all 109 tests/36 suites pass (no analytics/scoring/decision/quant module
touched — this pass is `index.html`/`script.js`/`data/providers/
macroProvider.mjs`/`data/watchlist/macro.mjs`/`data/metadata/
metricRegistry.mjs` only). No mutating route was ever called against the
scratch server; `git diff` on `data/watchlists/` showed only the pre-existing
uncommitted state already present before this session began. The cleared
`data/cache/macro/*.json` files regenerated with the new, complete field set
from real Yahoo fetches — an intentional, expected refresh of regenerable
cache, not a data-loss concern. Scratch Chrome and the scratch server were
both terminated before finishing. Files changed: `index.html`, `script.js`,
`data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`, `data/
metadata/metricRegistry.mjs`.

**Macro Intelligence — India Macro / US Macro indicator + Trend tables merged
into one unified table per tab** (2026-09-08, same-day follow-on to the Trend
Parameters pass above): a further brief required the indicator table and the
Trend table under each of India Macro/US Macro to become one table, with the
14 columns visually grouped under 3 headers (Indicator Details / Performance
/ Trend Parameters (Moving Averages)) rather than presented as two tables.
This is purely a presentation merge — `renderMacroIntelligence()`'s
`indicatorRow()` builder (`script.js`) now appends the same `dmaCell()`/
`dmaAlignmentLabel()` trend cells it previously wrote to a second `<tbody>`
onto the same `<tr>` as the existing Indicator/Category/Value/Change/1Y
change/Direction/Status/As of cells; the separate `macroTrendRow()` builder
and both `#macro-trend-table-india`/`-us` `<table>`s are removed outright.
`#macro-indicators-table-india`/`-us` keep their existing element ids
unchanged (only their column count and `<thead>` grew) — no route, no
fetch, no calculation changed. The grouped header is plain semantic HTML, not
a new table-rendering mechanism: a 2-row `<thead>` where row 1 is 3 `<th>`
elements with `colspan="3"/"5"/"6"` (summing to the fixed 14-column layout)
and row 2 is the real per-column headers; a new `.table-group-row`/
`.macro-unified-table` CSS pair (`styles.css`) styles the group row
(centered, uppercase, `--panel2` background) and draws a `border-left`
divider at the fixed column positions where a new group starts (col 4 =
Performance, col 9 = Trend Parameters) via plain `nth-child` selectors on
both header rows and every body row — zero JS, zero per-cell markup change,
since the column order was already fixed. India Macro's "Not available
(Future Integration)" table is untouched and stays a separate card below the
unified table (the brief's own scope was the indicator+trend merge only; the
11 Future-Integration indicators have no price series to merge a trend
column into and would misrepresent status if forced into the same table).
Neither table gained `.sticky-thead-native`/`.floating-thead` — both remain
un-sticky, consistent with this app's own prior, still-valid "too short to
matter" exemption for macro's <=7-row tables (§2.3 above, "App-wide bounded-
viewport shell"); the brief's own "do not create a second floating/sticky
header implementation" instruction is satisfied by not touching either
mechanism at all.

Validated live (zero-dependency Chrome DevTools Protocol driver, Node 22's
built-in `fetch`/`WebSocket`, real installed Chrome headless, a scratch
server on port 4502, never the user's own dev server): `#macro-trend-table-
india`/`-us` confirmed absent from the DOM entirely (not just hidden) —
exactly one table per tab. Both `#macro-indicators-table-india`/`-us`
rendered the correct 3-group header (`colspan` 3/5/6 summing to all 14
columns) and 14 real per-column headers; India showed exactly its 3
indicators (USD/INR, India Gold Rate, India VIX) and US exactly its 4 (US
10Y Treasury yield, WTI crude, Henry Hub gas, Gold), each indicator's
Performance and Trend cells confirmed on the same `<tr>` (not a second,
separately-keyed row) by reading `tr.children` directly. DMA Alignment and
Trend classification were independently recomputed from each row's own
displayed DMA values and confirmed mathematically consistent (e.g. USD/INR:
price 94.67 below its 20/50/100 DMA but above its 200 DMA → "1/4 above",
Sideways since the 50 DMA sits above the 200 DMA; India VIX: price below all
4 DMAs → "0/4 above", Downtrend; Crude WTI: price above all 4 DMAs → "4/4
above", Uptrend). Tab independence reconfirmed with the merged markup: on
first load only the `macro-intelligence` subsection is visible (`macro-india`/
`macro-us` both `hidden`); clicking India Macro shows only `macro-india`
(`macro-intelligence`/`macro-us` hidden); clicking US Macro shows only
`macro-us` — no cross-tab bleed introduced by the merge. A 4-viewport sweep
(1600×1000 default desktop, 1366×768, 1280×700, 390×844 mobile) found zero
`document.documentElement`/`#main` horizontal or vertical overflow at every
size, while the unified table's own `.scroll` wrapper correctly carried
increasing horizontal overflow as the viewport narrowed (90px at 1600px wide
down to 1057px at 390px) — confirming the wider merged table scrolls within
its own bounded container, never the page. Zero duplicate DOM ids app-wide;
zero console errors/exceptions. `node --check` clean on `script.js` plus a
full repo-wide sweep (`git ls-files "*.mjs" "*.js"`) matching the CI gate;
`node --test`: all 109 tests/36 suites pass (no analytics/scoring/decision/
quant/provider module touched — this pass is `index.html`/`script.js`/
`styles.css` only). No mutating route was ever called against the scratch
server (only page loads and sidebar/sub-tab clicks); `git diff` on `data/
watchlists/` after the session showed only the pre-existing uncommitted
state already present before this session began. Scratch Chrome and the
scratch server were both terminated before finishing. Files changed:
`index.html`, `script.js`, `styles.css`.

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

### 2.6 Missing-data display standard

**Standard**: missing, unavailable or unverified data is displayed as a
**blank** value everywhere in the UI — tables, KPI/summary cards, tooltips,
generated report pages — unless explicit semantic text is genuinely required
(e.g. a disclosed methodology note explaining *why* a field is blank, such as
"Gross margin is left blank: this data source exposes no separate
cost-of-goods-sold line"). Never `-`, `—`, "Unknown," or "Not available" as a
generic substitute — those are still guesses at a convention nobody asked
for; blank is the one answer that never implies a value exists.

**Implementation**: the string `'N/A'` remains the internal missing-value
sentinel several backend modules return (`data/analytics`, `data/decision`,
`data/scoring`, `data/watchlist`, `data/reporting`, `data/providers`) — this
is a backend data-contract detail predating this standard, not changed by it
(changing it would ripple into the automated test suite's exact-value
assertions and every report/frontend consumer for no behavioral gain, since
the display layer already normalizes it below). Each of the 4 frontend
entry points (`script.js`, `report.js`, `portfolio-review.js`,
`committee-pack.js` — independent copies, per §1.2/§2.5's no-shared-runtime
architecture) blanks it at the one place nearly every displayed string
already passes through, its own `escape()`: `str === 'N/A' ? '' : ...`. The
4 numeric formatters each file also carries (`fmt`/`pct`/`compact`/
`suffixed`) return `''` instead of `'N/A'` for a `null`/non-finite input, for
the same reason. `isSortNA()` (`script.js`'s column-sort mechanism) treats
both `''` and the literal `'N/A'` as not-available, so blanked cells keep
sorting last exactly as before. A handful of internal-only sentinel
comparisons/lookup keys are deliberately left as the literal string `'N/A'`
— e.g. `EXPOSURE_TIER_CLASS`/`MACRO_DIRECTION_CLASS`'s `'N/A'` object keys
(mapping a real backend tier/direction value to a CSS class, never displayed
as text) and the Watchlists-tab rating-filter's `sig !== 'N/A'` (excluding
unresolved companies from a dropdown) — these compare against the backend's
real sentinel value and produce no visible "N/A" text either way, so they're
unaffected by, and orthogonal to, this display standard.

**Future work**: any new displayed field follows the same rule — read the
real value or render blank; never fabricate `-`/"Unknown"/"N/A" text. If a
new frontend file is added outside the 4 above, it needs its own equivalent
`escape()`/formatter treatment; there is no shared frontend module system to
inherit it from (§1.2).

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
| GET | `/api/integrations` | Status of every credentialed integration (§3.10) — currently just MoSPI |
| POST | `/api/integrations/mospi/signup` | Create a MoSPI account (password used once, never persisted); 409 + `alreadyExists:true` when the account already exists (best-effort detection, §3.10) |
| POST | `/api/integrations/mospi/login` | Obtain a MoSPI access token (password used once, never persisted) |
| POST | `/api/integrations/mospi/token` | Save a manually-obtained MoSPI access token |
| POST | `/api/integrations/mospi/test` | Test the stored MoSPI credential against a real dataset fetch |
| DELETE | `/api/integrations/mospi` | Disconnect (clear the stored MoSPI credential) |
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
  `data/watchlist/macro.mjs`, `GET /api/macro`) — 7 real indicators sourced
  via Yahoo Finance tickers (USD/INR, US 10-Year Treasury yield, WTI crude,
  natural gas, gold, India Gold Rate via GOLDBEES.NS, India VIX), cached on
  their own namespace (`data/cache/macro/`) and TTL (30min), independent of
  any watchlist's own refresh cycle. A 2026-09-08 feasibility audit
  re-verified every remaining indicator the Phase 6 brief named: RBI policy
  repo rate, India G-Sec yield, PMI, power demand, ethanol policy, defence
  budget and banking liquidity still have no free, unauthenticated,
  machine-readable public source this app can reach — official sources exist
  for all seven (RBI, CCIL/FBIL, Grid-India/NPP, PIB, indiabudget.gov.in) but
  publish only HTML press pages or PDF/Excel reports, CCIL's own site
  additionally prohibits automated/commercial use without written
  permission, and PMI has no government source at all (S&P Global, a paid
  commercial product) — each still renders an explicit **Future Integration**
  status rather than being estimated or fabricated, the same posture as
  TD-10's market-wide peer database. CPI inflation and IIP are the one
  exception the audit found — see §3.10, a credentialed integration, not a
  Yahoo Finance ticker. The Data Quality panel now shows
  Live/Delayed/Unavailable/Future Integration/**Credentials Required** counts
  per indicator. **Market Regime** (`data/decision/marketRegime.mjs`) is a
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

### 3.10 The MoSPI integration (`data/integrations/`, 2026-09-08; CPI moved to a public/unauthenticated path the same day — see the dated follow-on entry at the end of this section)

This app's **first** credentialed external source — every other provider in
`data/providers/` is free and unauthenticated (§1.2). A 2026-09-08 feasibility
audit of the Phase 6 Future Integration list found one genuine exception:
MoSPI (Ministry of Statistics and Programme Implementation)'s official
**eSankhyiki API** (`api.mospi.gov.in`) covers CPI inflation and IIP with a
real, documented REST API — gated behind user signup and a 15-minute access
token. The user explicitly approved crossing the "no API keys" boundary for
this one case after being shown the trade-off, rather than this being decided
unilaterally.

- **Module** (`data/integrations/`): `config.mjs` (endpoints and every source
  citation — MoSPI's own published "CPI API User Manual" and "WPI API User
  Manual" PDFs, plus the official `nso-india` GitHub organization's
  open-source client, which corroborates IIP's endpoint path even though no
  dedicated IIP manual was found), `credentialStore.mjs` (local-disk
  credential persistence), `mospiClient.mjs` (raw HTTP layer, standard
  fully-verified TLS), `mospiProvider.mjs` (status/fetch orchestration,
  consumed by both the Configuration page and `data/watchlist/macro.mjs`).
- **Credential lifecycle**: signup (`POST /api/integrations/mospi/signup`)
  and login (`POST /api/integrations/mospi/login`) each use the user's MoSPI
  password for exactly one upstream HTTP call and never persist it — only the
  resulting access token, its expiry, and the email (for display) are written
  to `data/config/mospi.local.json` (gitignored, plaintext — this is a
  single-user local tool with no OS keychain/secrets-vault integration, the
  same disclosed limitation as any local dev credential file). A manual
  "paste an existing token" path (`POST /api/integrations/mospi/token`) is
  also supported for a token generated via MoSPI's own documented
  Postman/Swagger flow. Integration status is a 7-state model: **Not
  Configured → Configured** (token stored, unverified) **→ Connected** (a
  real dataset fetch has succeeded) **→ Token Expired / Authentication
  Failed / Provider Unavailable**, surfaced on the new **Configuration →
  Integrations** page (`#configuration` tab, `GET /api/integrations`).
- **No refresh-token mechanism is documented anywhere in MoSPI's own
  manuals** — the 15-minute token cannot be silently renewed without storing
  the account password, which this app does not do. Sustained Live CPI/IIP
  data therefore requires the user to periodically reconnect; a token past
  its expiry reads **Token Expired**, never a silently stale "Live" reading.
- **Response shape caveat**: MoSPI's manuals document request parameters
  exhaustively but never show the response body's field names as text (only
  screenshots this audit could not extract). `mospiProvider.mjs`'s
  `parseMospiSeries()` is therefore shape-detecting (a few plausible
  top-level/field-name candidates) rather than hardcoded to guessed names —
  it returns nothing, rather than a wrong number, when the shape isn't
  recognized. This must be confirmed against a real authenticated response
  before the integration can be trusted end-to-end (see the roadmap's
  completed-work ledger for this audit's own disclosed validation limits).
- **A real, live-confirmed caveat, not a hypothetical one**: a direct `fetch`
  to `api.mospi.gov.in` from this app's own runtime fails with
  `ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED` under standard Node.js TLS
  settings — matching the official `nso-india` reference client's own code,
  which disables certificate verification and enables legacy SSL
  renegotiation to work around exactly this. This app deliberately does
  **not** replicate that workaround; a live call against a misconfigured
  upstream surfaces as **Provider Unavailable**, not as a weakened TLS
  posture in this codebase. Until MoSPI's server accepts standard modern TLS
  (or a documented alternative is found), a real access token may still not
  be sufficient to reach **Live** status for CPI/IIP — this is disclosed
  directly in the Configuration page copy, not hidden behind a generic error.
- **India Macro UI**: CPI/IIP render in their own "Economic indicators
  (configuration-gated)" table on the India Macro sub-tab — deliberately
  *not* the market-style DMA/Trend-Parameters table (§2.3's "no meaningless
  DMA columns" instruction) — a period-over-period reading (value + Year/
  Month), not a priced instrument.
- **Account-management workflow completion** (2026-09-08, same-day follow-on):
  the Configuration → Integrations card was reorganized into the 4-section
  workflow this feature's own brief specified — Connection status / Account /
  Token / Datasets — with the Account section split into 4 click-to-switch
  panels (Register, Sign in, Change password, Password recovery) so only one
  form is ever visible at once, reusing `.subtabs`' pill styling for visual
  consistency but deliberately **not** wired into the app-wide `initSubtabs()`
  mechanism (that mechanism is initialized once, at page load, over static
  DOM; this card's markup is rebuilt later from `data-account-tab`/
  `data-account-panel` attributes it never looks for — a self-contained
  delegated listener on `#integrations-list` owns this instead, so the two
  never collide). A second source pass (re-checking `config.mjs`'s own
  citations, confirmed still current live against `api.mospi.gov.in` — see
  the validation note below) reconfirmed neither manual documents a
  password-change or password-reset/recovery API: **Change password** and
  **Password recovery** are therefore not forms — each is a static notice
  plus a link to the one official surface found (`MOSPI.manageAccountUrl`,
  the Swagger UI at the API base URL), exactly the "don't fake a reset
  feature" rule this feature's brief stated explicitly. Registration gained a
  client-side (never transmitted) confirm-password check and a new
  `isAlreadyExistsError()` pure helper (`mospiProvider.mjs`, covered by
  `test/mospiIntegration.test.mjs`) that reads a signup failure's HTTP status/
  message for a 409 or an "already exists/registered/duplicate" phrase —
  disclosed in its own code comment as a heuristic, since neither manual
  shows an error-response body's exact wording — and on a match switches the
  UI straight to the Sign-in panel with the email carried over, instead of a
  generic failure message. A successful sign-in now automatically calls
  `POST /api/integrations/mospi/test` (no extra click) and reports the
  combined outcome, per the "Sign in → auto-offer Test Connection" workflow
  requirement; "Connected" is still set only by `markVerified()` inside that
  real dataset fetch, never by sign-in alone. The MoSPI email
  (`saumitranaik@gmail.com`, supplied by the user for this account) is
  pre-filled as an editable convenience default into the Register/Sign-in/
  manual-token email fields — never a password field, and never persisted;
  this is a plain UI default for a single-user local tool, not a stored
  credential. Files changed: `index.html` (no structural change — the
  `#integrations-list` container is unchanged), `script.js`,
  `server.mjs` (signup's failure status is now 409 when `alreadyExists` is
  set, 502 otherwise, instead of always 502), `data/integrations/
  mospiProvider.mjs`, `test/mospiIntegration.test.mjs`.

  **What this pass did *not* implement, and why**: an actual password change
  or reset/recovery API call — neither exists in MoSPI's published material,
  confirmed again in this pass (see below), so building one would mean
  inventing an undocumented endpoint or faking success, both explicitly
  disallowed. **Real live registration/sign-in against the actual MoSPI
  service was deliberately not performed** in this pass either: only an
  email was supplied for this task, never a password (correctly withheld
  from the conversation per the task's own instruction not to expose/log/
  display it) — submitting a real signup or login therefore was not this
  session's action to take; the user performs that step directly in the
  browser, where the password never has to pass through anything but the
  masked input field itself.

  **Validation**: `node --check` clean on every changed file individually
  and via the full repo-wide sweep (matching the CI gate); `node --test`:
  121/121 tests / 40 suites pass (118 pre-existing + 3 new covering
  `isAlreadyExistsError()`'s 409/phrase-match/no-false-positive cases). Live
  validation against a scratch server (port 4188, a scratch headless Chrome
  instance on its own profile/port, port 9333 — neither ever the user's own
  dev server or browser session; both torn down at the end, confirmed
  unreachable after teardown): `GET /api/integrations` showed the correct
  "Not Configured" default with no credential file present; saving a
  deliberately fake manual token correctly read "Configured" (never
  "Connected") with `lastVerifiedAt` null; calling Test Connection with that
  fake token made a real, live GET request to `api.mospi.gov.in` (read-only,
  non-mutating, safe to run without a real account) which failed at the TLS
  layer with the exact same `ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED`
  error this document's TLS-caveat paragraph above already discloses —
  reconfirming that caveat is still live and current today, not stale — and
  the integration status correctly read "Provider Unavailable" with the real
  error text, never a fabricated success; Disconnect correctly cleared the
  credential file back to "Not Configured" with the file removed from disk.
  A CDP-driven headless-Chrome walkthrough (zero-dependency, Node 22's own
  `fetch`/`WebSocket`, same technique this document's earlier Watchlist
  Research passes established) confirmed: zero duplicate DOM ids app-wide;
  exactly one Account panel visible at a time across all 4 tabs, correctly
  switching; every password/confirm-password/access-token input rendered as
  `type="password"`; the email pre-fill appearing in all 3 forms; the status
  tag reading "Not Configured" (never fabricated); Change password/Password
  recovery each rendering their notice + portal link with no form present;
  the client-side password-mismatch check firing with no network call; zero
  console errors and zero page exceptions; no horizontal or vertical
  document overflow at 1400×900 desktop or 390×844 mobile, with the
  Configuration tab and its integration card both rendering correctly on the
  mobile viewport. No incidental writes to `data/watchlists/`/`data/config/`
  — confirmed via `git status`/`git diff` before and after (only this
  session's own already-in-progress uncommitted state was present, unchanged)
  and by listing `data/config/` directly (empty both before and after).

**CPI moved to a public, unauthenticated path — IIP unchanged (2026-09-08,
same-day follow-on)**: a task specifically asked to re-verify, live, whether
CPI genuinely needs the credential lifecycle above at all, rather than assume
the original audit's conclusion. It did not — MoSPI's own **CPI API User
Manual** documents, in its execution-process section (§1.5.2/§1.7): *"Without
access token the APIs will fetch only the first 10 records"* — intentional
platform behavior, not an error condition or a bug this app exploits. A plain
unauthenticated `curl` against `GET https://api.mospi.gov.in/api/cpi/
getCPIIndex` (this app's existing, already-correct endpoint — the
`getCPIData`/`Level`-parameter endpoint shown in an earlier Swagger
screenshot this task was given was tried and confirmed to be a *different,
non-functional* endpoint: it always returns `{"error":"Please check the input
parameters passed"}` regardless of parameter combination) returned real,
current JSON records with zero `Authorization` header, live-confirmed during
this task.

- **Two real, independent constraints found by the same live testing, both
  now designed around rather than ignored**:
  1. **Every documented query filter is silently ignored for anonymous
     callers** — `Year`, `Month`, `Group_code`, `Subgroup_code`, `Sector`,
     `State_code` all produced byte-identical output regardless of what was
     sent. MoSPI serves a fixed ~10-record unfiltered slice to anonymous
     requests (their own documented "first 10 records" behavior). This means
     the credentialed path's ability to *select* the headline "General"
     (all-India, all-groups) CPI figure has no unauthenticated equivalent —
     this app cannot ask for that specific series without a token. Across
     repeated live calls, that fixed slice consistently carried the
     **Consumer Food Price Index** ("Consumer Food Price" group, an
     "…-Overall" subgroup) — the one complete, officially-labeled series
     present — so that is what "CPI Inflation" means in this app today,
     labeled everywhere as **"CPI Inflation (Consumer Food Price Index)"**,
     never bare "CPI Inflation", so nothing is misrepresented as the headline
     figure. This was an explicit, informed product decision (the user chose
     this over gating headline CPI behind the very credential this task set
     out to remove), not a silent substitution.
  2. **MoSPI's server has a live-confirmed TLS defect independent of the
     credential question**: a request from this app's actual runtime (Node's
     `fetch`, and plain `https.request` under standard settings) fails with
     `ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED` — MoSPI's server requires
     legacy/unsafe TLS renegotiation support (RFC 5746), which Node refuses
     by default because a server that never adopted secure renegotiation is
     vulnerable to a MITM plaintext-injection attack during renegotiation.
     `curl` in this task's own environment succeeds against the same host
     because its TLS stack permits legacy renegotiation by default — Node's
     does not. Per CLAUDE.md's hard gate ("do not weaken TLS verification to
     work around a misconfigured upstream server... without asking first"),
     this was put to the user explicitly, with the trade-off shown, before
     any code changed — the user approved a **narrow, scoped** exception:
     `data/integrations/mospiClient.mjs`'s `fetchCpiPublic()` uses a
     dedicated `https.Agent({ secureOptions:
     crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT })`, applied to **that one
     function only**. Certificate verification is not touched
     (`rejectUnauthorized` stays at its default `true`) — only the
     renegotiation policy is relaxed, and only for this one host. The
     existing shared `request()` helper in the same file (used by login,
     signup, and `fetchIipMonthly`) is completely untouched and still fails
     exactly as before — **IIP's own credentialed path was deliberately not
     re-tested or changed**, per this task's explicit instruction not to
     automatically extend the same conclusion to it without separate
     verification.

- **Architecture**: `data/integrations/` keeps housing both datasets — CPI's
  own config (base URL, endpoint path, citations) already lived in
  `config.mjs`/`mospiClient.mjs` alongside IIP's, and splitting them across
  `data/providers/` (unauthenticated) and `data/integrations/`
  (credentialed) purely to satisfy that boundary label would have meant
  duplicating the MoSPI base-URL/endpoint/citation config across two folders
  for one external source — worse than the alternative. This is a
  deliberate, disclosed exception to system.md §1.3's module table (updated
  above), not an oversight: `data/integrations/` today holds one
  unauthenticated dataset (CPI) and one credentialed dataset (IIP) for the
  same upstream provider.
  - `mospiClient.mjs`: new `fetchCpiPublic()` (the scoped-TLS, no-token GET
    described above), alongside the unchanged `request()`/`signup()`/
    `login()`/`fetchIipMonthly()`.
  - `mospiProvider.mjs`: new `findCpiRecord()` (defensive, case-insensitive
    search for the Consumer Food Price/…-Overall record — returns `null`,
    never a guess, when the current unfiltered slice doesn't contain it —
    caught a real bug in its own first draft: `Number(null) === 0`, not
    `NaN`, so a genuinely-missing `index`/`inflation` field would have
    silently read as a real zero without an explicit `!= null` guard,
    fixed and covered by a dedicated regression test) and
    `getCpiPublicSnapshot()` (cache-first over the `mospiCache` namespace,
    same TTL/shape discipline as every other cached fetch in this app —
    never reads `readCredential()` at all). `PUBLIC_DATASETS`/
    `CREDENTIALED_DATASETS` replace the old single `DATASETS` list so a
    future reader can't miss that the public path never touches the
    credential lifecycle; `getIntegrationStatus()`'s per-dataset rows now
    carry `authRequired: true/false` so the Configuration UI can render the
    two kinds distinctly. `testConnection()` now exercises **IIP** (was CPI)
    — testing CPI would no longer prove anything about a stored token, since
    `getCpiPublicSnapshot()` never reads one.
  - `data/providers/macroProvider.mjs`: `MOSPI_MACRO_INDICATORS` (the
    credential-gated list `data/watchlist/macro.mjs` iterates) now lists IIP
    only; CPI's label/category live directly in `macro.mjs`'s own new
    `loadCpiIndicator()`.
  - `data/watchlist/macro.mjs`: new `loadCpiIndicator()` merges CPI directly
    into the main, always-on `indicators` array (`buildMacroSnapshot()`) —
    **not** the `configGated` array IIP still uses — so it renders in the
    same "India macro indicators" table, same Indicator/Category/Value/
    Change/1Y change/Direction/Status/As of/Trend columns every other India
    indicator uses, per this task's own explicit requirement. Two fields are
    honestly left blank rather than fabricated, both already-established
    conventions elsewhere in this app: `changePct` (no second data point is
    retrievable from the filter-less unauthenticated response) and `trend`/
    the 4 DMA columns (a single period-over-period reading has no daily
    price series to average — same disclosed limitation IIP's own row
    already carried). `oneYearChangePct` is MoSPI's own directly-supplied
    Year-on-Year `inflation` field, used as-is rather than recomputed — this
    app has no way to independently reconstruct a 12-months-prior data point
    from a filter-less response, and MoSPI's own manual/press-release
    convention for this field is Year-on-Year, not month-on-month.
- **India Macro UI**: the former single "Economic indicators
  (configuration-gated)" table is now IIP-only, retitled "Economic
  indicators (credential-gated)" — CPI Inflation appears in the main India
  indicators table above it instead (with blank Change/Trend/DMA cells, per
  the above). Configuration → Integrations' MoSPI card now renders two
  visually distinct dataset tables — **"Public data" (green "No credentials
  required" badge)** listing CPI, and **"Credential-gated data"** listing IIP
  — with explicit copy stating the credential-status badge and Account/Token
  sections describe the IIP path only and do not gate the public data above.
  The Account/Token/Connection-status workflow (signup, sign-in, manual
  token) is completely unchanged — still there for IIP, or any future
  credentialed MoSPI dataset.
- **`metricRegistry.mjs`**: `macroIndicator` updated to mention CPI is now
  part of its table; new `mospiCpiIndicator` entry (Sourced/Medium — Medium
  rather than High because of the sector/series-selection limitation and
  because the unauthenticated response shape was confirmed only via this
  task's own live testing, not a published schema); `mospiIndicator`
  narrowed to describe IIP only; `mospiCredential`/`macroDataQuality`
  reworded to state they describe the IIP-only credential path.
- **Validation**: `node --check` clean on every changed file individually and
  via the full repo-wide sweep (`git ls-files "*.mjs" "*.js" | xargs -n1 node
  --check`), matching the CI gate. `node --test`: 127/127 tests / 43 suites
  pass (121 pre-existing + 6 new in `test/mospiIntegration.test.mjs`
  covering `findCpiRecord()` — a real, live-shaped fixture captured during
  this task's own verification `curl` calls; case-insensitive/substring
  matching; a genuine "No Data Found"/empty-`data` response; a matched
  record with a `null` index/inflation, which is what caught the
  `Number(null)` bug above; a record resolving only one of index/inflation).
  Live validation, all against a scratch server (port 4193) and a scratch
  headless Chrome (CDP, port 9345), neither ever the user's own dev
  server/browser session: `buildMacroSnapshot()` called directly confirmed
  `cpiInflation` reads `status: "Live"`, real `value`/`oneYearChangePct`,
  with **zero** MoSPI credential file present (`data/config/mospi.local.json`
  showed `accessToken: null` throughout) — the explicit "works with zero
  MoSPI credentials configured" requirement, confirmed directly, not
  inferred. `GET /api/integrations` confirmed the `datasets` array carries
  `cpiInflation` (`authRequired:false`, a real cached-fetch timestamp) and
  `iip` (`authRequired:true`, never fetched) as two distinct entries. A full
  browser walkthrough confirmed: the India Macro table shows a "CPI Inflation
  (Consumer Food Price Index)" row (Category "Inflation", value/1Y-change/
  direction/status/as-of all populated, Change/Trend/DMA cells correctly
  blank) alongside the 7 real market indicators; the credential-gated table
  shows IIP only, no CPI; the Configuration card renders the Public
  data/Credential-gated data split exactly as designed; zero duplicate DOM
  ids app-wide; zero console errors/exceptions; no horizontal or vertical
  overflow at 1600×1000, 1366×768, 1280×700, or 390×844 mobile (`document
  .documentElement.scrollWidth === clientWidth` and `#main`'s own scrollWidth
  === clientWidth at every size). No incidental writes to `data/watchlists/`
  (confirmed via `git status` before/after — the file this repo already had
  modified going into this task was untouched by it) — `data/cache/mospi/
  cpiInflation.json` gained a real cache entry, which is the intended,
  correct effect of this feature actually working, not an incidental
  mutation. Files changed: `data/integrations/config.mjs`,
  `data/integrations/mospiClient.mjs`, `data/integrations/mospiProvider.mjs`,
  `data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`,
  `data/metadata/metricRegistry.mjs`, `index.html`, `script.js`,
  `server.mjs` (comment only), `test/mospiIntegration.test.mjs`.

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
data source available renders blank — it is never estimated to fill a gap.
Several backend modules (`data/analytics`, `data/decision`, `data/scoring`)
still return the internal sentinel string `'N/A'` for such a metric; this is
a backend data-contract detail, not a UI convention — the display layer
(`script.js`/`report.js`/`portfolio-review.js`/`committee-pack.js`, each via
its own `escape()`) blanks that sentinel at render time (§2.6) rather than
showing the literal text "N/A" to a user.

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
│   ├── integrations/              — the MoSPI integration (§3.10): config.mjs, credentialStore.mjs, mospiClient.mjs, mospiProvider.mjs — one public/unauthenticated dataset (CPI) + one credentialed dataset (IIP)
│   ├── config/                    — local credential store (gitignored, e.g. mospi.local.json — §3.10); not user watchlist data
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
- A new **credentialed** external source (requires signup/API key/OAuth) →
  `data/integrations/` (§3.10), never `data/providers/` (that stays
  unauthenticated-only, per §1.2). Requires explicit user approval before
  starting — this app's default posture is "no API keys" and that boundary
  is not crossed unilaterally. The credential itself goes in `data/config/`
  (gitignored), never in `data/watchlists/`, never hardcoded, never logged.
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

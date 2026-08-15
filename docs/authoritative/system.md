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
| `data/reporting/` | Per-company printable report model (derives from research, computes nothing new) |
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

### 2.3 Tabs and sub-tabs

Eleven top-level tabs (flat nav, click-toggled `.active`/visibility):
Dashboard, Watchlists, Fundamentals, Valuation, Profitability, Balance Sheet,
Growth, Ownership, Technicals, Portfolio, Risks. The Watchlists tab is
full-bleed width; every other tab shares a common reading-width container.

Every tab except Watchlists (a single-purpose management workspace) has a
second navigation level: a sticky row of sub-tab pills directly under the
tab's own header, splitting what was previously one long scrolling page into
click-navigable sections (e.g. Valuation → Overview / DCF / Reverse DCF /
Sensitivity / Relative valuation / Historical valuation). Sub-tabs are a pure
client-side visibility toggle over already-rendered DOM (`applySubtabState()`)
— they trigger no new computation and no new data.

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
| GET | `/api/watchlists/:id/report/:symbol` | Cache-only per-company printable report |
| POST | `/api/watchlists/:id/refresh` | Refresh (`force` = full refetch; `symbols[]` = targeted refetch; else incremental) |
| POST | `/api/watchlists/import` | Import a watchlist (same shape Export produces) |
| PUT | `/api/watchlists/:id/cash-target` | Set the watchlist's cash allocation target % |
| POST | `/api/watchlists/:id/companies` | Add a company |
| DELETE | `/api/watchlists/:id/companies/:symbol` | Remove a company |
| PUT | `/api/watchlists/:id/companies/order` | Reorder companies |
| PUT | `/api/watchlists/:id/companies/:symbol/weight` | Set a company's target weight % |
| PUT | `/api/watchlists/:id/companies/:symbol/notes` | Set a company's notes |

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
  disclosed keyword rules.

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
  by the 5-year EPS CAGR. Explicitly *not* analyst consensus.
- **Relative valuation** (`relativeValuation.mjs`) — a two-pass module: pass 1
  computes each stock's own comparison figures, pass 2 (needing every
  sector-mate's pass-1 result) computes sector-adjusted rank, a disclosed
  multi-factor peer score (Value 40% / Quality 35% / Growth 25%), valuation
  dispersion, and historical premium/discount bands. Always watchlist-scoped
  — there is no market-wide peer universe.
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
├── server.mjs                   — HTTP server + full API route table
├── index.html / script.js / styles.css   — main dashboard SPA
├── report.html / report.js      — standalone printable per-company report page
├── run.bat / killserver.bat     — Windows start/stop helpers (no npm scripts exist)
├── data/
│   ├── analytics/                — pure calculation modules (§4)
│   ├── scoring/                  — the unified recommendation engine (§4.2)
│   ├── reporting/                — report model builder (§3.6)
│   ├── providers/                — external data source abstraction (§3.3)
│   ├── parse/                    — Screener.in HTML parsing (feeds screenerProvider)
│   ├── news/                     — company news fetch + classification
│   ├── metadata/                 — metricRegistry.mjs, the tier registry (§6)
│   ├── universe/                 — static NSE ticker reference data (search seed)
│   ├── watchlist/                — store, research orchestration, disk cache, symbol search (§3.5)
│   ├── watchlists/                — the actual on-disk watchlist JSON data (user state)
│   ├── cache/                     — on-disk research cache (companies/, benchmarks/)
│   ├── cache.mjs                  — in-memory TTL cache
│   └── util.mjs                   — shared low-level helpers (atomic JSON writes, fetch wrapper)
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
- A new external data source → implement the shape `data/providers/index.mjs`
  expects, register it there; never call an external API directly from
  `server.mjs`, `data/watchlist/research.mjs`, or the frontend.
- A new UI surface for existing data → a new tab/sub-tab/section in
  `script.js`/`index.html`, reading `currentData` — never a new computation.
- A new document about *why* something changed → an entry in
  `docs/governance/roadmap.md`, not a new standalone file (§8).

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
   `data/scoring/` owns rating composition; `server.mjs` stays a thin route
   table. Do not blur these lines for a one-off feature.
6. **No document proliferation.** Rationale for a change belongs in
   `docs/governance/roadmap.md`'s completed-work ledger, not a new
   standalone markdown file. Point-in-time audit artifacts go in
   `docs/governance/audits/`, dated, never edited after the fact.
7. **This document is updated in the same change** that alters a module
   boundary, a data flow, an API route, or a folder's purpose — not
   retroactively.

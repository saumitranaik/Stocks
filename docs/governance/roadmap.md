# Governance Roadmap — Watchlist Research Workspace

Status: **Governance**. This document is the canonical execution roadmap — what
gets built, in what order, its dependencies, and its current status. It does
not describe the system's architecture (see
[`docs/authoritative/system.md`](../authoritative/system.md)) and it does not
carry full phase-by-phase implementation narrative (see
[`archive/roadmap-history.md`](../../archive/roadmap-history.md), the complete
pre-governance-phase changelog with full validation detail for every phase
summarized in §2 below).

This document is updated whenever an item's status changes, a new item is
added, or a phase completes. It is one of the three documents
[`CLAUDE.md`](../../CLAUDE.md) instructs Claude Code to load at the start of
every session.

---

## 1. How to read this document

Every roadmap item carries five fields:

| Field | Meaning |
|---|---|
| **Priority** | P0 (blocking/critical) · P1 (high) · P2 (medium) · P3 (low/opportunistic) |
| **Dependency** | What must exist first, or "None" |
| **Status** | Completed · In progress · Not started · Deferred · Blocked |
| **Complexity** | XS/S/M/L/XL — rough implementation size, not a time estimate |
| **Validation requirement** | What must pass before the item can be marked Completed |

An automated test layer and CI gate now exist ([§4, TD-4](#4-outstanding-technical-debt-carried-forward);
07.2), but they cover only the pure-math modules named in TD-4/02.11's scope
(`system.md` §4.7) plus a repo-wide `node --check`. Everything else —
`data/scoring/`, `data/decision/`, `data/quant/`, providers, and any
I/O-touching or UI-facing code — is still validated manually: `node --check`
on every changed file, a live `buildResearch()`/HTTP check against real
cached data, and a full interactive walkthrough (Playwright) for anything
UI-facing. That is the validation bar for every item below unless a
different bar is stated or the change falls within the automated test
layer's existing coverage.

Sections: §2 completed work, §3 milestone timeline, §4 outstanding technical
debt, §5 the forward domain roadmap (01–08), §6 explicitly deferred work.

**Phase-start gate**: before picking up any item below — not just at session
start — confirm alignment against all three canonical documents:
[`CLAUDE.md`](../../CLAUDE.md) (working rules), `system.md` (does the
planned change fit an existing module boundary, or does it need one?), and
this document (is the item's stated Dependency actually satisfied? does its
Status already say something different?). An item whose Dependency isn't yet
Completed, or whose implementation would blur a module boundary in
`system.md` §8, is not ready to start regardless of its Priority.

---

## 2. Completed work

All phases below are **Completed and validated**. Full implementation detail,
validation narrative, and known-limitations disclosures for each phase live in
[`archive/roadmap-history.md`](../../archive/roadmap-history.md) — this table
is a summary index, not a replacement.

| Phase | Date | Objective | Status |
|---|---|---|---|
| Flow Integrity Audit remediation | 2026-08-11 | Fixed a scoring-pipeline defect (non-India scores capped ~64), cross-market sector-preset leakage, and dead API fields | ✅ Completed, validated |
| Dashboard IA restructuring | 2026-08-11 | Standard 36-sector taxonomy, consistent stock-card layout, Overview/Technical split, fixed `&` sanitization bug | ✅ Completed, validated |
| Phase 1 | 2026-08-12 | Institutional data-provider abstraction, expanded Screener.in scraping, 12-factor scoring engine, Stock Metrics + Fundamentals tabs | ✅ Completed, validated |
| Stock Metrics tab split | 2026-08-12 | Reorganized into 5 dedicated tabs; standardized Recommendation/CMP/Company column order everywhere | ✅ Completed, validated |
| Phase 2 | 2026-08-13 | DCF valuation engine, relative valuation, technical scorecard, real portfolio analytics, 5-category institutional risk framework | ✅ Completed, validated |
| Post-Phase-2 institutional audit | 2026-08-13 | Repo-wide review; identified the P0–P3 findings tracked as technical debt in §4 | ✅ Completed (audit pass, not a feature phase) |
| Phase 3a | 2026-08-13 | Sector-aware valuation gate (DCF excluded for financials, Justified P/B model added); unified 5-bucket recommendation engine with consistency guards | ✅ Completed, validated |
| Phase 3b | 2026-08-14 | Dedicated Watchlists tab; relative valuation/technical/portfolio analytics deepened to institutional depth; cash allocation modeling | ✅ Completed, validated (14/14 Playwright scenarios) |
| Phase 3c | 2026-08-14 | Local-first institutional autocomplete search (P0 usability gap) | ✅ Completed, validated. Reporting-layer half of the original brief explicitly deferred → became Phase 3d |
| Phase 3d | 2026-08-14 | Institutional per-company research reporting engine: report model, printable page, zero-dependency PDF export | ✅ Completed, validated |
| Phase 3e | 2026-08-14 | Two-level sub-tab navigation across all 10 analytical tabs | ✅ Completed, validated |
| Phase 3f | 2026-08-14 | Unified cross-tab company context, click-to-select, Quick Jump, Compare mode | ✅ Completed, validated |
| Governance foundation | 2026-08-14 | Established `system.md`, this document, and `CLAUDE.md` as the canonical governance/architecture framework; archived the pre-governance changelog; consolidated audit snapshots under `docs/governance/audits/` | ✅ Completed — see [validation report](./validation-report.md) |
| **Governance adoption & enforcement** | 2026-08-15 | Validated the governance foundation end-to-end against the live codebase; fixed stale `roadmap.md` cross-references left behind by the file's move (README.md and 4 analytics/scoring source comments); added an explicit phase-start gate (§1) | ✅ Completed — see [validation report §6](./validation-report.md) |
| **Phase 4 Stage 1 — Portfolio Intelligence decision layer & persistence** | 2026-08-15 | New pure `data/decision/` module (Action Score, change detection, alerts, portfolio health, rebalancing suggestions — all composition over already-computed `data/analytics`/`data/scoring` output, weights/thresholds centralized in `data/decision/config.mjs`), a new run-over-run snapshot cache (`data/watchlist/snapshotCache.mjs`, one JSON file per watchlist under `data/cache/watchlistSnapshots/`), `payload.intelligence` attached in `research.mjs`'s `buildResearch()`, and one new route `PUT /api/watchlists/:id/alerts/:alertId`. No UI (backend/persistence only, by design — a 3-stage rollout requested by the user, each stage reviewed before the next started). Documentation of this stage was deliberately deferred to land together with Stage 2 below, per the user's explicit staging instruction. | ✅ Completed, validated (`node --check` on every new/modified file; live cache-only `research` checks across Banking/Power/Defence/Core Portfolio/a mixed watchlist showed `intelligence` populating with no `NaN`/`undefined`; snapshot persistence and the new route verified directly) |
| **Phase 4 Stage 2 — Portfolio Intelligence UI integration** | 2026-08-15 | Exposed Stage 1's `payload.intelligence` through the existing tab/sub-tab architecture, company context and metadata-tier framework — no new top-level navigation, no new design system. Dashboard gained two sub-tabs (Portfolio Intelligence: Action Required/Opportunity Monitor/Risk Monitor/What changed; Committee View: presentation-quality roll-up of opportunities/risks/allocation/concentration/beta/expected return/risk-adjusted outlook/rebalancing). Portfolio gained a Health & Rebalancing sub-tab (score/trend/contributors/history + a rebalancing table). Risks gained an Alerts sub-tab (severity filter chips, acknowledge wired to Stage 1's route). Watchlists gained 7 monitoring columns (Action Score, Action, Fair Value Gap, Risk Trend, Technical Trend, Alerts, Last Change) and 9 filter chips. Every Action Score cell carries a native-tooltip bucket-contribution breakdown; `infoIcon()` methodology entries were already registered in Stage 1's `metricRegistry.mjs` update. Zero new API calls, zero new CSS classes — every visual element reuses existing cards/tags/pills/bars/tables. | ✅ Completed, validated — see this entry's own note below for the full per-item validation run |
| **Phase 4 Stage 3 — Calibration, performance, and governance finalization** | 2026-08-15 | Fixed the root cause of the Stage 1+2 performance regression (the run-over-run snapshot was being rewritten to disk on *every* request, including cache-only ones, even when byte-identical — `data/decision/index.mjs` now returns `nextSnapshot: null` when no company genuinely advanced, and `research.mjs` writes it fire-and-forget instead of blocking the response). Graduated alert severity to 2-3 magnitude-proportional tiers across every alert type in `data/decision/alerts.mjs` (previously only 3 of ~14 types graded by magnitude; fixed an inconsistency where `governanceRiskCategory`/`sectorRiskCategory` didn't graduate even though `financialRiskCategory` right next to them did). Added a resolved-signal-coverage floor to Action Score (`actionScore.mjs`, `ACTION_SCORE.minResolvedWeightShare`) — caps the label to Hold with a disclosed `capNote` when fewer than half of the 6 buckets resolve, mirroring the recommendation engine's own confidence-gated caps. Added alert lifecycle refinement: a persisted `alertLifecycle.firing` map (first-detected timestamps per alert id) in the snapshot cache drives severity escalation after `ALERT_LIFECYCLE.escalateAfterDays` (default 7) and lets an acknowledged alert that clears and later re-fires surface again instead of staying suppressed forever (`store.mjs`'s new `pruneAlertAcknowledgements`); a company's acknowledged-alert ids are now pruned when the company is removed from the watchlist (`removeCompany`). `data/decision/index.mjs` was folded from two separate top-level functions into one single-pass orchestrator, eliminating a pre-existing duplicate `portfolioHealthScore()` call. One frontend line (`script.js`'s `actionScoreTitle()`) surfaces the new `capNote` in the existing Action Score tooltip — the only UI change this stage made. This document, `system.md` (new §3.7, module/route table rows, repo map), and `CLAUDE.md` (repo map) updated in this same change, closing the intentional Stage 1/2 documentation lag. | ✅ Completed, validated — see note below |
| **Phase 5 — Institutional research and reporting platform** | 2026-08-15 | Extended the Phase 3d per-company report to a full 15-section institutional research note (Thesis Tracking, Target Price Rationale, Scenario Analysis, Portfolio Context, Explainability added; catalyst taxonomy remapped to 7 categories with a disclosed signal-strength heuristic) and added a new Portfolio Review Pack (`data/reporting/portfolioReviewPack.mjs`, `portfolio-review.html`/`.js`, `GET /api/watchlists/:id/portfolio-review`) — a 9-section investment-committee document at watchlist scope, mirroring `report.html`'s own WYSIWYG print/PDF architecture. New `data/decision/thesisTracking.mjs` classifier (Intact/Improving/Weakening/Broken) reuses `changeDetection.mjs`'s existing snapshot diff, zero new I/O. Two small additive widenings to already-computed `data/analytics/portfolio.mjs` functions (`attributionBreakdown()` now also returns the full per-company `contributors` list; `positionConcentration()` now also returns each holding's own HHI-contribution share) feed the new Portfolio Context/concentration sections. No new analytics engine, no new fetch — every new section is pure composition over the existing `buildResearch()` payload, per the phase brief's explicit constraint. | ✅ Completed, validated — see note below |
| **Phase 6 — Market intelligence, earnings, and macro integration** | 2026-08-16 | Forward-looking market/event intelligence layered on the existing research platform, staged in 6 sub-stages (each validated before the next started): **(1) Macro Intelligence** — new `data/providers/macroProvider.mjs` (6 real indicators via Yahoo Finance tickers: USD/INR, US 10Y Treasury yield, WTI crude, natural gas, gold, India VIX), `data/watchlist/macro.mjs` orchestration (own disk-cache namespace + 30min TTL, independent of watchlist refresh), `GET /api/macro`, and `data/decision/marketRegime.mjs` (disclosed rule-based Risk-on/Risk-off/liquidity-bias classifier). Every macro indicator the brief named with no free public source (RBI repo rate, India G-Sec yield, CPI, IIP, PMI, power demand, ethanol policy, defence budget, banking liquidity) renders an explicit **Future Integration** status via a Data Quality panel (Live/Delayed/Unavailable/Future Integration) — never fabricated or estimated, per the user's explicit direction. **(2) Sector Intelligence** — new `data/watchlist/sectorIntelligence.mjs`, the one deliberate cross-watchlist read in this app (cache-only across every saved watchlist, dedupes companies, groups by sector), `GET /api/sector-intelligence`. **(3) Portfolio Exposure Matrix** — `data/analytics/exposureRules.mjs` (2 new sector-sensitivity lookup tables: interest-rate, economic-cycle) + `data/decision/exposureMatrix.mjs`, reusing `sectorRiskTags()` for regulatory/commodity and `scenarios.mjs`'s `currencyExposure()` for currency rather than duplicating either; attached as `portfolio.exposureMatrix`. **(4) Earnings Intelligence + Event Calendar** — `data/analytics/earningsAnalytics.mjs` computes real QoQ/YoY revenue/net-profit/operating-margin deltas from Screener's own scraped quarterly P&L series (fetched since Phase 1, unused until now), framed as deviation vs. trailing 4-quarter average rather than a fabricated consensus "surprise"; `data/analytics/eventCalendar.mjs` composes real dated news items only. Next-earnings-date/guidance/estimate-revision fields and dividend/buyback/regulatory calendar events all render **Future Integration**/are omitted rather than invented. **(5) News Intelligence** — added sentiment (Positive/Negative/Neutral/Uncertain, keyword-based) and a coarse `affectedThesisDriver` mapping to `companyNews.mjs`. **(6) Morning Briefing + Weekly Investment Committee Pack** — Morning Briefing is now the Dashboard's default sub-tab, pure client-side composition over already-fetched data; the Committee Pack (`data/reporting/committeePack.mjs`, `committee-pack.html`/`.js`, `GET /api/watchlists/:id/committee-pack`) structurally extends the Phase 5 Portfolio Review Pack with macro/sector context and a Valuation/Risk/Other-categorized view of the existing change-detection diff. Zero new top-level navigation (brief's own constraint) — 3 new Dashboard sub-tabs, 1 new Portfolio sub-tab, 1 existing placeholder sub-tab built out, 1 existing sub-tab extended. | ✅ Completed, validated — see note below |
| **Phase 6.5 — Institutional navigation & UX restructuring** | 2026-08-16 | Replaced the flat 11-tab top nav with a persistent left sidebar (collapsible to icon-only, off-canvas drawer below 900px) holding 9 workspaces — Dashboard, Watchlists, Research, Technicals, Portfolio, Risks, Reports, Market Intelligence, Compare — and reduced the header to a slim global context bar (no duplicate nav). Pure navigation/DOM reorganization: **zero** analytics/scoring/data-flow/API changes. Dashboard trimmed 13→9 sub-tabs (Portfolio Intelligence and Committee View promoted alongside Morning Briefing; Macro Intelligence, Sector Intelligence, Earnings & Events, News & Catalysts relocated — same element ids/render functions, only DOM parent changed — to the new **Market Intelligence** workspace). **Research** is a virtual sidebar group over the untouched Fundamentals/Valuation/Profitability/Balance Sheet/Growth/Ownership sections, switched by a new category pill-bar (`#research-category-bar`) so primary navigation stays at 2 levels. **Compare** is a new dedicated workspace reusing `renderCompareAwarePillSelector()` + `compareGrid()` + the existing `valuationDetailContent()`/`technicalDetailContent()`/`riskDetailContent()` builders (already used this way on Valuation/Technicals/Risks) — no new comparison engine. **Reports** is a new consolidated launch workspace for the 3 standalone report pages, behind 3 shared helpers (`openCompanyReport()`, `openPortfolioReview()`, `openCommitteePack()`) that every pre-existing launch point (Quick Jump, Watchlists manage row, Committee View, per-row report action) now calls too, instead of each constructing its own URL — those pre-existing entry points are kept, not removed. `.container` max-width widened 1500px→1900px to use available desktop width. Files changed: `index.html`, `script.js`, `styles.css`; `docs/authoritative/system.md` §2.3 updated (navigation-model description only, no module-boundary change); `CLAUDE.md` unchanged (no new folders/modules). | ✅ Completed, validated — see note below |
| **Phase 7 Stage 1 — Quantitative data model & factor engine** | 2026-08-16 | New `data/quant/` domain (`config.mjs`, `factorEngine.mjs`), following the same pure-composition pattern as `data/decision/`: an institutional 6-factor framework (Value/Quality/Growth/Momentum/Risk/Size). Every raw sub-metric (P/E, ROE, revenue CAGR, price momentum, beta, market cap, etc.) is read off `stocks[]` fields `buildResearch()` already computes — zero new fetch, zero duplicate calculation — then normalized to a 0-100 percentile against same-sector watchlist peers (falling back to full-watchlist, then to explicit "insufficient data" below 3 peers — no market-wide peer database exists in this app, same constraint already disclosed on `relativeValuation.mjs`/`factorExposure()`). A category score averages its resolved sub-metrics; the composite Factor Score is a weighted blend of the 6 categories (weights in `data/quant/config.mjs`, disclosed/uncalibrated), renormalized over resolved categories, withheld with a `capNote` when fewer than half resolve (mirrors `actionScore.mjs`'s coverage floor). Attached as `stock.quantFactors` per company and `research.quant` at watchlist level (factor leadership/weakness, per-category averages, coverage). Explicitly documented as distinct from — not a replacement of — the pre-existing `portfolio.factorExposure` tilt, the Portfolio Action Score, and the recommendation engine (`system.md` §3.9). Backend/data-model only, no UI yet — same staged-rollout discipline as Phase 4 Stage 1. | ✅ Completed, validated — see note below |
| **Phase 7 Stage 2 — Benchmark & Performance Engine** | 2026-08-16 | New `data/quant/performanceEngine.mjs` (one module, not two — benchmark selection needed no new code beyond reusing `technicalLevels.mjs`'s existing `benchmarkSymbolFor()` and `research.mjs`'s existing per-market benchmark bundle/cache, so a separate `benchmarkEngine.mjs` would have had no distinct responsibility). Computes, per stock and weight-aggregated per watchlist: benchmark-relative period returns (1M/3M/6M/1Y/3Y/5Y — 1Y reuses the existing daily-quote-derived `oneYearReturnPct` rather than a second weekly-series-derived figure), price-series CAGR (3Y/5Y, actual elapsed time between observations, not an assumed integer year count), max-drawdown peak/trough/recovery detail, and explicitly-labeled proxy Sharpe-like/Sortino-like risk-adjusted ratios (this app has no dividend-inclusive total-return data source, so neither is presented as a conventional-methodology ratio). Reuses rather than recomputes: `stock.beta`/`stock.volatilityPct`/`stock.maxDrawdownPct` (already computed earlier in the same per-stock pass), `dcf.mjs`'s `dcfAssumptions()` risk-free-rate assumption (proxy-Sharpe/Sortino numerator), and `portfolio.mjs`'s existing `portfolioBeta`/`portfolioRiskAdjustedReturn`. Two small, non-breaking additive changes to `data/analytics/portfolio.mjs`: `weightedAverage()` exported (was module-private) for reuse by the new engine, and a new `portfolioVolatilityPct()` extracted from `positionRiskContribution()`'s own internal variance-decomposition loop (`positionRiskContribution()`'s own return shape is completely unchanged — every existing caller across `script.js`/`report.js`/`portfolio-review.js`/`researchReport.mjs`/`portfolioReviewPack.mjs`/`rebalancing.mjs` is unaffected) so the real, correlation-aware portfolio volatility figure is computed once and shared, rather than a second correlation-blind weighted-average approximation. One new shared primitive added to `data/analytics/priceSeries.mjs`: `downsideDeviationPct()`, alongside its existing `annualizedVolatilityPct()`/`maxDrawdownPct()` siblings. Attached as `stock.performance` per company and `portfolio.performance` at watchlist level; one new `metricRegistry.mjs` entry (`benchmarkPerformance`) and one new `DATA_LIMITATIONS` disclosure line in `research.mjs`. Backend/data-model only, no UI/navigation change (same staged-rollout discipline as Stage 1) — the response payload is the only new surface, read via the existing cache-only `GET /api/watchlists/:id/research` route (no new route added). | ✅ Completed, validated — see note below |
| **Institutional research foundation upgrade** | 2026-08-17 | Foundational architecture pass to strengthen the institutional research report's analytical quality (evidence model, peer framework, quality/attractiveness separation, valuation-precision/confidence coupling, research-quality gates, thesis breakers, forward-estimate contracts) — not a full roadmap implementation, per its own brief. New: `data/metadata/evidenceHierarchy.mjs` (A–F provenance scale layered on the existing Sourced/Calculated/Heuristic tier, §4.6); `data/scoring/qualityAttractiveness.mjs` (Company Quality / Stock Attractiveness split, additive on `recommendation`); `data/scoring/researchQuality.mjs` (5 Research Quality Gates per stock); `data/analytics/forwardFramework.mjs` (schema-only contracts for forward estimates/management credibility/segment economics/capacity-utilization — no data source exists for any of the four, each renders an explicit `available:false` + reason). **Corrected defects**: `relativeValuation.mjs`'s peer framework now computes a real `peerCount`/`peerTier` (Direct/Sector, using the already-scraped `industry` field)/`peerCompleteness` and withholds `relativeValuationScore`/`sectorNormalizedValuationScore`/`multiFactorPeerScore` (null + disclosed reason) below 3 real peers, instead of the previous silent self-comparison artifact (validated live against `GOODLUCK.NS`, a real 1-company-sector case — `multiFactorPeerScore`/`relativeAttractivenessScore` now correctly `null` where they previously produced a misleading score); `valuation.mjs` gained a `confidenceBand` it previously lacked entirely (unlike DCF/financialValuation), including a reversion-gap signal that catches a large, unsupported P/E-P/B-reversion extrapolation (confirmed live: `GOODLUCK.NS`'s own ₹4,486.92 target-price example dropped from a previously-unwarranted High confidence to Medium once the reversion-gap signal was added). `scoringEngine.mjs` gained additive `fundamentalView`/`marketView`/`actionGuidance` (Technical never masquerades as business quality) and now folds peer-data availability into `recommendation.confidence` (pass 2 only) — the primary `rating`/`compositeScore` computation is completely unchanged. `data/decision/thesisTracking.mjs` gained a structured `thesisBreakers` list (the existing 3 hard triggers plus 2 new point-in-time conditions: promoter-holding decline, ROCE-below-cost-of-capital) alongside the existing blended thesis status. The per-company report (`researchReport.mjs`/`report.js`) gained 2 new sections (Company Quality vs. Stock Attractiveness; Segment, Capacity & Forward Estimates) plus a Thesis Breakers extension to the existing Thesis Tracking section (17 sections total), and now applies `precisionForConfidence()` (`data/util.mjs`, new) to fair-value/target-price/bull-base-bear figures at display time only — the underlying `stock.valuation`/`.dcf`/`.financialValuation` values every other consumer reads are completely unchanged. `metricRegistry.mjs` gained 10 new entries and an additive `evidenceTier`/`evidenceLabel` on every existing entry. Zero UI (`script.js`/`index.html`) changes — backend/report-page only, matching this repo's own staged-rollout precedent (Phase 4/7 shipped backend-first). See `system.md` §4.6 for the full architecture description. | ✅ Completed, validated — see note below |
| **Automated test layer for pure-math analytics modules (TD-4/02.11)** | 2026-08-17 | The single biggest structural gap flagged repeatedly since the Post-Phase-2 audit: this app had zero automated tests. New `test/` directory (10 files: `util.test.mjs`, `series.test.mjs`, `cagr.test.mjs`, `shares.test.mjs`, `priceSeries.test.mjs`, `dcf.test.mjs`, `institutionalRisk.test.mjs`, `portfolio.test.mjs`, `helpers/fixtures.mjs`, `helpers/assert.mjs`), built on Node's built-in `node:test`/`node:assert` runner — zero new dependency, no `package.json`, the same zero-dependency constraint this app has always held. Covers the item's own named minimum (`dcf.mjs`, `priceSeries.mjs`, `institutionalRisk.mjs`, `portfolio.mjs`'s `resolveWeights`) plus their direct pure-math dependencies (`series.mjs`, `cagr.mjs`, `shares.mjs`, `data/util.mjs`) and a handful of `portfolio.mjs`'s other pure functions (`weightedAverage`, `sectorAllocation`, `positionConcentration`, `portfolioVolatilityPct`). Test cases hand-compute expected values from each module's own documented formula (the same cross-check discipline this roadmap's own phase validation notes use, e.g. Phase 7's CAGR spot-checks) rather than snapshotting current output, and explicitly assert the disclosed-unavailable-reason paths (e.g. `dcfValuation()` declining rather than assuming a default beta of 1) so a future change can't silently start fabricating a value. New `test.bat` (`node --test`) alongside the existing `run.bat`/`killserver.bat`. See `system.md` §4.7 for the full architecture note and exact coverage boundary (does not yet cover `data/scoring/`, `data/decision/`, `data/quant/`, providers, or any I/O). | ✅ Completed, validated — see note below |
| **CI Integration (07.2)** | 2026-08-17 | Wired the existing `test/` layer into a real CI gate. This repository had no `.github/workflows/` at all before this change, so 07.2's own "minimal first step" scope was implemented directly: new `.github/workflows/ci.yml`, one job (`ubuntu-latest`), triggered on every `push` and `pull_request`. Two sequential, mandatory steps — `node --check` looped over every tracked `.mjs`/`.js` file (excluding `data/cache/`, `data/watchlists/`; 82 files today), then `node --test` (109 tests / 36 suites today, not hard-coded — the gate is "all discovered tests pass"). Node 22.x via `actions/setup-node@v4` (matches the local dev Node version; no version bump). No `package.json` introduced — `actions/checkout@v4` + `actions/setup-node@v4` are the only actions used, no dependency-install step, preserving the test layer's zero-dependency design. Neither step carries `continue-on-error` or suppressed exit codes. `test.bat` (Windows developer convenience) is untouched and not used by CI. | ✅ Completed, validated — see note below |
| **Sector Research data-source investigation** | 2026-08-28 | Deep investigation (no code changes) into whether true market-wide Sector Research — a complete, enumerable equity universe + reliable sector classification, ranked and compared — can be built on this app's existing data. **Verdict: NO.** Full inventory of every company/classification data source (`data/universe/nseUniverse.mjs`'s ~160-name static, self-disclosed-non-authoritative seed; Screener.in/Yahoo lookup-by-known-symbol-only providers with no listing/enumeration endpoint; `data/watchlist/sectorIntelligence.mjs`'s existing cross-watchlist rollup); traced company-universe lineage (a company only enters the system via manual "Add a company," never discovered); reconstructed 3 real sectors from live cached data (Power: 11 real companies found but PFC.NS/RECLTD.NS/BHEL.NS/GVT&D.NS — all economically "Power" — are classified Financial Services/Capital Goods and invisible to a `sector`-field query; Financial Services: clean but bundles banks/NBFCs/insurers the user's mental model of "Banking" doesn't); Defence: **the critical finding** — 12 of 13 Defence-watchlist companies carry `sector: "Capital Goods"`, not "Defence" at all; the concept only exists at the `industry` level, and `sectorIntelligence.mjs`'s own sector-field grouping would silently merge them into a generic Capital Goods bucket with unrelated companies, confirming TD-1's still-open gap now affects 12–13 stocks, not 7). Confirms and corroborates, with concrete evidence, what `docs/governance/roadmap.md` already flagged as **TD-10/03.8** (deferred, blocked on a paid data-vendor decision, not engineering effort) and what `sectorIntelligence.mjs`'s own `dataLimitations` array already discloses. No new capability recommended for implementation yet — a security-master/universe source with query-by-classification (not just lookup-by-known-symbol) is the identified minimum gap; several architectural options assessed (market-wide vendor, NSE sectoral-index constituent files as a cheaper near-term option, GICS-style classification) for a future task once a data-source decision is made. | ✅ Completed (investigation only, no implementation) |
| **UX/IA redesign — Company Research / Watchlist Research split (Sector Research deferred)** | 2026-08-28 | Follow-on to the investigation above: redesigned the sidebar/navigation so every analytical scope the app can *correctly* support today reads as its own clear destination, without implementing the deferred Sector Research capability. Replaced Phase 6.5's "Research" virtual group (6 independent `.tab` sections, each silently mixing a watchlist-wide comparison table with a single-company deep-dive panel behind visually-identical pill rows — the root cause of the "several rows of pills" navigation ambiguity) plus standalone Technicals/Risks tabs with two real destinations: **Company Research** (`#company-research` — one company at a time; Overview/Fundamentals/Valuation/Quality/Ownership/Technicals/Risks, one company-switcher pill row pinned at the top, visually distinct from the sub-analysis nav) and **Watchlist Research** (`#watchlist-research` — every company in the active watchlist compared side by side; Overview/Performance/Ranking/Valuation/Quality/Growth/Risk/Opportunities). Every comparison table and deep-dive panel kept its existing element id and `render*()` function — only DOM parent moved, the exact technique Phase 6.5 already established for Sector Intelligence's own relocation (`system.md` §2.3) — so no analytics/scoring/provider/API code changed at all. Two small additive presentation-reuse functions (`companyOverviewContent()`, `ownershipDetailContent()`, both zero-new-calculation, formatting already-computed fields for a second display location — same pattern as the pre-existing `fundamentalsContent()`/`valuationDetailContent()`) fill the two genuine content gaps (no per-company Ownership view existed before). `applySubtabState()`/`initSubtabs()` gained one small, necessary extension (`.subsection` matching scoped to the nearest owning `.tab`/`.subtab-root` via `closest()`) to support one level of nested sub-navigation (e.g. Company Research → Valuation's own DCF/Reverse DCF/Sensitivity/Relative valuation/Historical valuation nav) — every existing single-level tab/sub-tab pair is unaffected. Sector Intelligence is unrenamed, unmoved (stays under Market Intelligence, its `dataLimitations` disclosure untouched) and not represented as market-wide, per the locked decision above. A disabled "Sector Research" sidebar entry (no route, no section, no data) reserves the future nav slot. Portfolio relabeled "Portfolio Analysis" with an explicit deferred-Transactions disclaimer (no fake ledger/P&L). Files changed: `index.html`, `script.js`, `styles.css`; `system.md` §2.3 updated in this same change (navigation-model description only — no module-boundary, API-route, or data-flow change). | ✅ Completed, validated — see note below |
| **Company Context scoping correction** | 2026-08-29 | Follow-on UX fix to the IA redesign above: that redesign correctly split Company Research from Watchlist Research, but left the header's `#company-context-bar` (selected company name/ticker/sector/price/rating, Quick Jump, Compare toggle) rendered on **every** workspace, so Watchlist Research/Market Intelligence/Portfolio Analysis/Dashboard/Watchlists/Compare all visually implied they were analyzing whichever company was last-selected, contradicting each workspace's own actual scope. Fixed with a small conditional-visibility change (no redesign, no new component, per the correction brief's own explicit constraint): `activateWorkspaceTab()` now shows `#company-context-bar`/`#company-context-label` only when the active tab is `company-research` (`[hidden]` CSS override added since `.toolbar`'s `display:flex` would otherwise out-cascade the attribute, matching the existing `.subsection[hidden]`/`#research-category-bar[hidden]` pattern); both default `hidden` in the markup since Dashboard is the default active tab. `activeCompanySymbol` and every function reading it are completely unchanged — this is a visibility toggle on an already-existing element, not a state or data-flow change. Watchlist Research and Portfolio Analysis each gained a one-line watchlist-context readout (`#wr-watchlist-context`/`#portfolio-watchlist-context`, e.g. "Power · 8 companies") set from `render()`'s own already-available `data.watchlistName`/`data.stocks.length` — zero new computation; Market Intelligence gained a static "Indian Equity Market" line under its own new `.workspace-title`. Reports/Compare/Dashboard/Watchlists needed no change (each already had its own correct scope-appropriate context — Reports' `#reports-active-company` line, Compare's own `#compare-selector`). Files changed: `index.html`, `script.js`, `styles.css`; `system.md` §2.3 updated in this same change (additive note, no module-boundary/API/data-flow change). | ✅ Completed, validated — see note below |

| **Watchlist Research IA consolidation** | 2026-08-29 | Data + information-architecture audit and redesign of Watchlist Research only (per explicit user brief), collapsing its 8-item sub-nav (Overview/Performance/Ranking/Valuation/Quality/Growth/Risk/Opportunities) to the target 4-item nav (Overview/Fundamentals/Technicals/Risk & Opportunity) by nesting the former 8 as inner sub-navigation — zero information removed, every element id/`render*()` function kept, only DOM parent/nav position moved (`system.md` §2.3). N/A audit found no field displaying N/A that could be legitimately derived from other already-available data (every current N/A traces to a genuine Screener.in data-source gap already disclosed in `metricsTable.mjs`'s own comments — no Cash/CA-CL split, no forward estimates, no per-period BVPS, no separate MF shareholding row — none fabricable). Found and surfaced several already-computed-but-never-displayed fields instead: `avgVolume20` (computed since Phase 1, never attached to the stock payload — now is, plus one new `metricRegistry.mjs` entry), `stock.momentum` (RSI state label), `stock.volatilityPct` (real annualized volatility, alongside the existing 0-100 score), and `stock.performance.periods['1Y']`/`.benchmark` (Phase 7 Stage 2 output, shipped backend-only with zero UI consumer until now) — all zero-new-calculation reads, no analytics/scoring/provider code touched. Added one new comparison table (`#wr-overview-table`, a screening matrix of Recommendation/Confidence/Composite score/Upside %/Regime/Risk score/Action) and one new derived column, DMA alignment (client-side arithmetic on already-fetched CMP/DMA values, same precedent as the pre-existing "downside to 200-DMA" inline calculation). Renamed "Breakout probability" → "Breakout Score" (label only — the underlying `breakoutProbability` field and formula are unchanged) since the metric registry already discloses it as a screening score, not a statistical probability. Ranking's own sub-tab folded into Overview as a "Rank by" control + its existing top-5 table; Opportunities folded into Risk & Opportunity as a third sibling alongside the existing Risk Overview/Alerts pair. Removed the in-page "Watchlist Research / \<name\> · N companies" heading added by the prior Company Context fix (2026-08-28) once identified as duplicating the global header's own watchlist-context bar. Files changed: `index.html`, `script.js`, `data/watchlist/research.mjs` (one new field), `data/metadata/metricRegistry.mjs` (one new entry); `system.md` §2.3 updated in this same change (navigation-model description only — no module-boundary, API-route, or analytics/scoring change). | ✅ Completed, validated — see note below |

| **Company Research one-page redesign + Watchlist Research data-parity pass** | 2026-09-03 | Field-level audit (per an explicit user brief scoped to Company Research and Watchlist Research only) traced every displayed metric plus every backend-computed field with a `metricRegistry.mjs` entry, and found 6 analytical domains computed on every research payload but rendered nowhere in the live dashboard: Company Quality/Stock Attractiveness/Fundamental View/Market View/Action Guidance, Thesis Tracking + Thesis Breakers, Research Quality Gates, and most of the Phase 7 Quantitative Factor Engine and Benchmark & Performance engine (the Factor Engine had no UI consumer at all, not even the standalone report). Replaced Company Research's 7 click-to-switch tabs with one scrolling page per company (`.cr-page-nav` sticky anchor nav + `IntersectionObserver` scrollspy, 7 sections: Snapshot/Valuation/Quality & Financial Health/Growth/Technical Position/Risk/Intelligence) — every existing content-builder function reused verbatim, zero information loss, two content gaps filled (a new per-company Growth view; the former dead "Quality" tab replaced with real Company Quality/Stock Attractiveness/Fundamental-Market View/Action Guidance content) and one wholly new Intelligence section (Thesis tracking, Quantitative Factor Score — explicitly disclosed as never overriding the primary Recommendation, per the existing Phase 7 product rule — and Research Quality Gates). Promoted the genuinely comparable subset of the same dark fields into Watchlist Research as new columns on 4 existing tables (Overview: Company Quality/Stock Attractiveness/Factor score; Valuation: Sector rank/Relative attractiveness score/Peer completeness; Technicals → Relative strength: 3Y/5Y CAGR; Risk matrix: Thesis status) — zero new tables, per the locked one-table-per-tab architecture. Zero new calculations anywhere; every field was already computed and already tagged in `metricRegistry.mjs` — pure UI wiring and IA reorganization. Files changed: `index.html`, `script.js`, `styles.css`; `system.md` §2.3 updated in the same change (navigation-model description only, no module-boundary/API/analytics change). | ✅ Completed, validated — see note below |

| **Scrolling/table-usability audit + Technicals raw-indicator parity + Company Research UI redundancy removal** | 2026-09-03 | Follow-on to the parity pass above (same explicit user brief, its remaining scrolling/table/sorting/UI-redundancy objectives), scoped to Company Research and Watchlist Research only. **Sticky-hierarchy fix**: nested `.subtab-root` sub-nav bars (e.g. Watchlist Research Fundamentals→Quality, Company Research Valuation's DCF/Reverse DCF/... nav) all shared the exact same `position:sticky;top:var(--header-h)` as the outer nav above them, so once scrolled into view a nested bar painted directly over the outer one instead of docking below it; also, `--header-h` was only ever measured on window `resize`/`load`, never on a workspace switch, so entering/leaving Company Research (the one workspace that shows/hides the header's `#company-context-bar`, changing the header's own height) left every sticky bar docked at the previous tab's now-wrong offset. Fixed with one new measured CSS var, `--subtabs-h` (one nav bar's real height, same JS-measurement pattern `--header-h` already used, now also re-measured on every `activateWorkspaceTab()` call), and depth-aware `top` offsets (`.subtab-root .subtabs`, `.subtab-root .subtab-root .subtabs`) so nested bars stack cleanly instead of overlapping. **Sticky table headers**: every Watchlist Research comparison table's `<thead>` now sticks (`position:sticky`, depth-aware `top` via new `.thead-sticky-1/2/3` classes matching how many nav bars sit above that specific table) to the page's own scroll — no second inner scrollbar, the wrapping `.scroll` div still only ever produces a horizontal one. **Column sorting**: a new shared, generic mechanism (`sortForTable`/`initTableSort`/`applySortIndicators`, `script.js`) wired onto all 14 Watchlist Research comparison tables (Overview, Valuation, Profitability, Balance sheet, Ownership, Growth, the 6 Technicals tables, the Risk matrix, Alerts) — click a `th[data-sort]` header to sort ascending, again for descending, a third click restores the watchlist's own natural/existing default order (e.g. the Overview table's "Rank by" ordering is preserved as the un-sorted state). N/A always sorts to the bottom regardless of direction; new `PEER_COMPLETENESS_RANK`/`THESIS_STATUS_RANK` rank tables added alongside the existing `RATING_RANK`/`CONVICTION_RANK` for the label columns that needed one. Sorting re-renders through the existing full `render(currentData)` cascade (same pattern every other mutation in this app already uses), so it composes correctly with Compare Mode and active-company highlighting — verified live, not just reasoned about (see validation below). **Technicals raw-indicator parity** (the brief's own concrete example): ADX/DI+/DI-/Support/Resistance (→ Trend table), MACD line/Signal line/Histogram (→ Momentum table), OBV/OBV trend/Accumulation-Distribution/its trend (→ Volume table), and ATR/ATR% of price (→ Volatility table) were already computed server-side and shown on Company Research's per-company indicators card (`technicalDetailContent`) but had no Watchlist Research column at all — every field read here is off the same `stock.technicalScorecard`/`stock.macd`/`stock.support`/`stock.resistance` that card already uses, zero new calculation, zero new `metricRegistry.mjs` entries (all were already registered). Placement follows the brief's own grouping rather than a new tab, per the locked one-table-per-tab architecture. **Company Research UI redundancy removal** (per the user's screenshot, two circled clusters): (1) the header's Quick Jump row (Fundamentals/Valuation/Technicals/Risks/Report) plus the Compare toggle — `#company-context-bar` (which holds both) is only ever shown while already on Company Research (a 2026-08-29 fix scoped it that way), so Quick Jump could never actually be used to jump *to* Company Research from elsewhere; its destinations are already covered, more completely, by the page's own `.cr-page-nav` anchor nav, and Report is already covered by the Reports workspace. Compare Mode's on/off toggle (previously the header button was the *only* off-switch; the dedicated Compare workspace's button only ever turned it on) was consolidated onto that one dedicated-workspace button, now a real toggle (`renderCompareWorkspace` updates its label/`aria-pressed` from `compareMode`) — functionality preserved, redundant entry point removed, per the brief's own explicit instruction on this point. (2) The top-of-page "Company" pill-row switcher (`#valuation-selector`, a leftover id from before the one-page merge) plus its introductory paragraph — genuinely redundant with the header's own `#company-selector-toggle` dropdown, which already does the same job and remains the one company switcher for this workspace. Dead CSS (`.quick-jump`, `.compare-chip-row`, `.company-switcher*`) and the now-orphaned `renderCompareBar()` function (its only two DOM targets were both removed) deleted alongside their markup. Files changed: `index.html`, `script.js`, `styles.css`; no analytics/scoring/decision/quant/provider/API change — every field this pass surfaces was already computed and already registered. | ✅ Completed, validated — see note below |

| **UI regression audit — Company Research nav sync, Watchlist Research sticky headers, sort affordance** | 2026-09-03 | The prior entry's sticky-header claims turned out false in a real browser — its own validation note had already disclosed why (no headless-Chromium tooling available that pass, so pixel-level sticky correctness was checked by "static reasoning over the CSS," never actually rendered). User reported the regression directly (Watchlist Research header rendering after data rows; Company Research's active nav item not matching the visible section) with a screenshot. Root-caused live against a scratch server (Puppeteer-driven real Chrome, never the user's dev server) rather than patched blind: (1) `render()`/`setActiveCompany()` change the header's own rendered height but never called `syncHeaderHeight()`, leaving `--header-h`/`--subtabs-h` stale after the first data load — both now call it. (2) Company Research's `IntersectionObserver` scrollspy used a hardcoded `-120px` band unrelated to the real (150-300px+) sticky offset, and derived "visible section" only from each callback's own `entries` (which the spec limits to just-crossed-threshold targets, not everything still intersecting) — rebuilt to track intersection in a persistent map with a dynamically-measured offset, rebuilt from `syncHeaderHeight()` itself, plus a same-tick default to the first section. (3) **The deeper finding**: `position: sticky` on `thead th` is provably non-functional in real Chromium whenever wrapped in `.scroll`'s `overflow-x:auto` (confirmed via a controlled long-scroll test — the cell tracks page scroll 1:1 forever, never clamping) — a known, still-open CSS spec gap (csswg-drafts#865), not something the previous offset-tuning could ever have fixed. No ancestor `overflow`/`border-collapse` combination avoided it while keeping horizontal scroll working. Fixed with the pattern production data grids use for this exact combination: `.scroll` becomes the sticky cell's own bounded scroll container (`max-height` + `overflow-y:auto`, `overflow-x:auto` unchanged), header sticks to that container's own `top:0` — confirmed live to keep the header pinned, rows scrolling under it, columns staying aligned through horizontal scroll, and the outer page still scrolling normally around each table. Scoped via `:has()` so no other `.scroll` table is affected. This is a deliberate, verified-necessary exception to the prior "no second scrollbar" note, not an oversight. (4) Sortable headers had no visible affordance until clicked — every `th[data-sort]` now carries a dim ↕ at rest. `system.md` §2.3 corrected in the same change (the stale "no second inner scrollbar" claim). Files changed: `script.js`, `styles.css`; no analytics/scoring/decision/quant/provider/API change. | ✅ Completed, validated — see note below |

| **Watchlist Research scrolling architecture reconsidered — floating header clone replaces the bounded scrollbox** | 2026-09-03 | User accepted the prior entry's fix as *working* but explicitly rejected the bounded-per-table-scrollbox trade-off (14 nested vertical scroll contexts instead of one page scroll) and required a genuine architecture review of alternatives before accepting it as final — not a re-assertion that "CSS can't do this." Re-verified, more rigorously than the prior pass, that plain `position:sticky` cannot satisfy "sticky header + native horizontal scroll + single page-level vertical scroll" on this markup (a from-scratch minimal repro isolated the csswg-drafts #865 gap and showed it holds even with `overflow-x`/`overflow-y` split, zero other overflow ancestors, and `border-collapse:separate`); rejected a two-`<table>` header/body split (breaks native single-table header/cell accessibility association for no benefit); selected a **floating header clone**: the real `<thead>` stays in normal page flow, fully accessible, never sticky, and a purely-visual `position:fixed` clone of the header row (not subject to the csswg-drafts #865 gap at all) shows only while the real header is scrolled above the sticky nav stack and the table's own rows still extend below it. `.scroll` reverts to purely horizontal-scrolling across all 14 tables — the bounded scrollbox and its `.thead-sticky-N thead th{position:sticky}` rule are both removed, restoring one natural page-level vertical scroll. The clone is rebuilt from the real header's live markup + pixel-copied column widths every time it's shown (never hand-maintained, cannot drift out of sync); horizontal scroll syncs via `transform:translateX()`; sort clicks on the clone replay as a real click on the corresponding real `<th>`, so `initTableSort`'s existing delegated listener remains the only place sort state lives; the clone is `aria-hidden` with defensively non-focusable cells. Validated live (Puppeteer-driven real Chrome, scratch server, isolated browser context per scenario to avoid this app's own by-design localStorage subtab-persistence leaking state between scenarios — see full detail below). Files changed: `script.js`, `styles.css`; `system.md` §2.3 updated in the same change; no analytics/scoring/decision/quant/provider/API change. | ✅ Completed, validated — see note below |

| **App-wide UX/data-parity consistency pass** | 2026-09-04 | Full end-to-end audit (per an explicit user brief) of the eaf024a floating-header-clone/column-sort standard's application-wide consistency, plus a strict Company-Research-vs-Watchlist-Research data-parity, N/A, and duplication audit across all 8 workspaces. Found the standard had not been extended past Watchlist Research: wired `sortForTable`/`initTableSort`/floating-header registration onto 6 more tables scaling with watchlist size (Dashboard's `#pi-action-table`; Portfolio Analysis's `#portfolio-table`, `#rebalancing-table`, `#exposure-matrix-table`; Market Intelligence's `#earnings-intel-table` [floating header] and `#sector-intel-table` [sort only, bounded row count]) — Dashboard's 5-row Top Opportunities table and Market Intelligence's fixed ~6/~9-row macro tables were audited and deliberately left alone (already have an equivalent sort control, or too short to matter). `#wl-table` (Watchlists, the app's single largest table) kept its working bespoke 3-state sort but gained the floating header it lacked; since it sits below a `.wl-search-bar` rather than a `.subtabs` bar, `floatingHeaderOffset()`'s depth-number×`--subtabs-h` scheme was generalized into a `FLOATING_HEADER_OFFSET_VARS` map summing named CSS vars (identical behavior for the existing `thead-sticky-1/2/3` classes, now extensible to `thead-sticky-wl` via a new `--wl-searchbar-h` var). **Two real bugs found and fixed**: cloning `#wl-table`'s `<thead>` for its floating header also cloned its bulk-select checkbox's `id="wl-select-all"`, producing a duplicate DOM id — `rebuildFloatingHeaderContent()` now strips every `id` from the cloned subtree; and `wlFilteredSortedStocks`'s Sector/Risk Trend/Technical Trend sort accessors used `\|\| ''` instead of `\|\| null`, so a missing value sorted first ascending instead of last, breaking the app's own N/A-always-last convention. **Data parity**: added `recommendation.fundamentalView`/`.marketView` (2 columns, `#wr-overview-table`) and `performance.riskAdjusted.sharpeLike`/`.sortinoLike`/`.risk.maxDrawdown` (3 columns, Technicals → Relative strength) — both already computed and registered, zero new calculation; `actionGuidance` (a full sentence) and the 1M/3M/6M performance periods (redundant with 1Y/3Y/5Y already shown) were evaluated and intentionally excluded. Files changed: `index.html`, `script.js`; `system.md` §2.3 updated in the same change; no analytics/scoring/decision/quant/provider/API change. | ✅ Completed, validated — see note below |
| **Git tracking policy — untrack regenerable cache, protect watchlists** | 2026-09-04 | Repository-hygiene audit found an uncommitted, never-applied `.gitignore` draft that ignored both `data/cache/` (correct) and `data/watchlists/` (wrong — silently hid 3 real user-created watchlists, `15-in1y.json`/`g2g.json`/`power-2.json`, from `git status`/`git add`, leaving them with no Git history despite being live, in-use, `index.json`-referenced data). `store.mjs`'s `ensureSeeded()` only self-seeds the 4 built-in defaults when `data/watchlists/index.json` is entirely absent, so these 3 user-created watchlists are not regenerable — an uncommitted `.gitignore` matching that draft would have made data loss on a fresh clone or disk loss permanent and silent. Corrected policy: `.gitignore` now ignores only `data/cache/` (82 files untracked via `git rm -r --cached`, left on disk unchanged — cache is regenerable and the app degrades gracefully without it, `system.md`/`CLAUDE.md` §3); all `data/watchlists/**` remains tracked, including the 3 previously-invisible files, now staged as new. No application code touched. | ✅ Completed, validated (`node --check`/`node --test` unaffected — no source file touched; `git check-ignore` confirmed cache ignored and all watchlists, including the 3 previously-invisible ones, not ignored) |
| **End-to-end production-readiness audit** | 2026-09-04 | Full live-browser audit (per an explicit user brief, not scoped to any single recent change) of all 8 workspaces, their sub-tabs/nested sub-tabs, navigation/state-transition behavior, the floating-header-clone/column-sort standard, and data parity — see [`docs/governance/audits/2026-09-04-e2e-production-readiness-audit.md`](./audits/2026-09-04-e2e-production-readiness-audit.md) for the full report. Puppeteer-core driving the system's real installed Chrome (scratch npm dir outside the repo) against a scratch server (port 4199). Verdict: **ready, no blocking issues**. Found and fixed one genuine defect: the Reports workspace's intro copy (`index.html`) still told users reports were "reachable from Quick Jump, the Watchlists manage row and Committee View" — Quick Jump was removed app-wide by the 2026-09-03 "Company Research UI redundancy removal" pass (confirmed via a zero-match grep for `data-jump`/`quick-jump` outside code comments) but this one line of copy was never updated to match; the other two claimed launch points were verified still real. Fixed by dropping the stale clause — copy-only, no navigation/DOM/data-flow change, so no `system.md` update needed. Three apparent defects investigated and ruled out as test-harness artifacts, not app bugs (full detail in the audit report): a scrollspy "wrong active link" result caused by the test's fixed wait being shorter than Chrome's own smooth-scroll animation; several "broken sort order" results caused by the test's own number-parser stripping decimal points; and several "floating header never appears" results caused by testing at a viewport height where the table genuinely had too little content below the sticky offset to need one. 89/89 nested-scroll-container checks clean across all 8 workspaces at 3 viewport heights + mobile width; 20/20 sortable tables passed a full asc/desc/natural cycle with N/A-last; a 25-tick real mouse-wheel walkthrough on the largest watchlist (Asmita, 30 companies) never showed more than one floating header at once. Files changed: `index.html` (1 line). | ✅ Completed, validated (`node --check` clean, `node --test` 109/109 unaffected, `git diff --check` clean; see the audit report for full validation detail and the state-mutation confirmation) |
| **IIP investigation and integration — independently confirmed public, alongside CPI** | 2026-09-09 | A dedicated investigation into MoSPI's IIP (Index of Industrial Production) API, explicitly instructed not to assume IIP behaves like CPI just because CPI turned out to be public (2026-09-08). Phase 1 review of the existing (2026-09-08) implementation found it was built entirely on assumption: `fetchIipMonthly()`'s endpoint path was corroborated only by the `nso-india` GitHub client's source code (no dedicated IIP manual exists), its response shape was never confirmed against a real response, and its credentialed code path had never been exercised against a real MoSPI token (`data/config/mospi.local.json` carried `accessToken: null` throughout this app's history). Live-tested from scratch (`curl` + direct Node scripts against `https://api.mospi.gov.in/api/iip/getIIPMonthly?Format=JSON`): returned real, current General/Overall IIP data (index 124.8, YoY growth 6.7%, July 2026, base year 2022-23) with zero `Authorization` header — a genuine answer, not the `{"data":[]}`/"No Data Found" case explicitly disqualified by this task's own completion rubric. Independently re-verified, not assumed, that (1) every query filter is silently ignored for anonymous callers (byte-identical output across differing params) and (2) the identical `ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED` TLS defect blocks Node's `fetch`/https stack, unblocked by the same already-approved, narrowly-scoped `legacyRenegotiationAgent` (certificate verification untouched) — proven live before reuse, not copied over on assumption, per CLAUDE.md's TLS-workaround gate. Unlike CPI (forced to fall back to the Consumer Food Price Index sub-series), IIP's fixed anonymous slice places the headline General/Overall record first — no sub-series substitution needed. **Outcome A**: IIP moved from `CREDENTIALED_DATASETS` to `PUBLIC_DATASETS` in `data/integrations/mospiProvider.mjs` (now `[]`, kept as working infrastructure for a future MoSPI dataset, not deleted); new `fetchIipPublic()` (`mospiClient.mjs`, sharing a refactored `requestPublic()` helper with `fetchCpiPublic()`) replaces the removed, never-verified `fetchIipMonthly()`; new `findIipRecord()`/`getIipPublicSnapshot()` mirror the CPI equivalents. `data/watchlist/macro.mjs`'s new `loadIipIndicator()` merges IIP directly into the main, always-on India Macro indicators table (same treatment as CPI: no daily change%/DMA/trend, since a monthly index has no daily price series — YoY growth read directly from MoSPI's own `growth_rate` field, never recomputed) — the former "Economic indicators (credential-gated)" table/card, the Data Quality panel's "Credentials Required" bucket, and `MOSPI_MACRO_INDICATORS` are all removed outright (not left stale at zero), since no macro indicator is credential-gated any more. Configuration → Integrations now lists both CPI and IIP under "Public data — No credentials required"; its "Credential-gated data" table and the whole Account/Token/signup/login workflow are retained (not deleted — a working, tested subsystem, kept for a possible future MoSPI dataset such as WPI) but every description was reworded so nothing implies CPI or IIP need it; `testConnection()` now returns an honest "no credentialed dataset currently configured" message instead of silently failing against a dataset list that no longer contains IIP. See `docs/authoritative/system.md` §3.10 for the full dated write-up (exact endpoint/params/response schema/citations) and §1.2/§1.3/repo-map corrections for the now-stale "one credentialed exception" framing. Files changed: `data/integrations/mospiClient.mjs`, `data/integrations/mospiProvider.mjs`, `data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`, `data/metadata/metricRegistry.mjs`, `index.html`, `script.js`, `styles.css`, `server.mjs` (comment only), `test/mospiIntegration.test.mjs`. | ✅ Completed, validated — see system.md §3.10's own dated entry for full validation detail (`node --check` clean repo-wide; `node --test` 134/134 pass, 7 new; live `buildMacroSnapshot()`/`getIntegrationStatus()`/`testConnection()` checks with zero MoSPI credentials configured; a CDP-driven headless-Chrome walkthrough at 1600×1000/1366×768/1280×700/390×844 confirmed correct rendering, zero duplicate DOM ids, zero console errors, zero failed requests, no horizontal overflow, and CPI unaffected) |
| **Watchlist Research navigation/scroll redesign — reference implementation** | 2026-09-05 | UX audit (explicit user brief, 3 annotated screenshots) found the whitespace/stacking complaints traced to an information-hierarchy defect, not a spacing one: the shared, always-`position:sticky` global `<header>` (title/subtitle/badge/watchlist selector/refresh — singleton elements every workspace shares) never shrinks at any scroll position on any tab, and the primary `.subtabs` bar plus any nested `.subtab-root .subtabs` bar shared identical pill styling, reading as two unrelated stacked rows instead of a parent/child pair. Fixed with a reusable-but-gated mechanism rather than duplicating shared chrome: `body[data-active-tab]`/`.is-scrolled` (set by `activateWorkspaceTab()`/a new rAF-throttled scroll listener) collapses the existing header in place, scoped entirely to `body[data-active-tab="watchlist-research"]` so every other workspace is pixel-unchanged until it opts in; three new modifier classes (`.subtabs-primary`/`-secondary`/`-tertiary`, applied only to Watchlist Research's own nav markup) give primary vs. nested sub-nav bars distinct color/weight/labeled-toolbar treatment while preserving exact box-height parity across levels (color/background/box-shadow only — never padding/font-size/border-width), since the existing `--subtabs-h`-times-depth sticky-offset math assumes every level is the same height. `system.md` §2.3 updated in the same change. Files changed: `index.html`, `script.js`, `styles.css` — no analytics/scoring/decision/quant/provider/API change. Per the brief's explicit scope: Watchlist Research only for now, pending review before rollout elsewhere. | ✅ Completed, validated — see `system.md` §2.3 for full validation detail |
| **App-wide bounded-viewport shell — supersedes the document-scroll design above** | 2026-09-05 | Same-day follow-on: a second explicit user brief required the *opposite* architecture from the entry directly above (sidebar/header/page-nav genuinely fixed via flex/grid, only a page's own content region scrolling — not document-level scroll with a collapsing sticky header and a `position:fixed` clone standing in for table headers). Flagged the conflict explicitly and confirmed the direction with the user before proceeding (`CLAUDE.md`'s "flag the conflict" rule) rather than silently picking one. Implemented the real bounded shell (`html`/`body{overflow:hidden}` at ≥901px, `.app-shell{height:100vh}`, header/sidebar as plain flex siblings with `position:sticky` removed entirely, `.tab.active`/`.subtab-root`/`.subsection` recursively splitting into fixed-nav + scrollable-body at every nesting level with zero pixel-offset math) and, where a panel's entire content is one card wrapping one table (10 Watchlist Research tables), converted to a genuinely native `position:sticky` header — removing the floating clone for those 10 — after confirming live that both `border-collapse:collapse` and `.card`'s own pre-existing `overflow:hidden` independently defeat sticky on a table cell in real Chrome regardless of the ancestor chain. A real flexbox trap was found and fixed live (not caught by visual inspection): flex items' default `flex-shrink:1` let a mixed panel's tall card silently squeeze down to fit instead of its `.subsection` ever actually overflowing/scrolling — fixed via explicit `flex-shrink:0` on scroll-owner children, with the pass-through/scroll-owning exceptions given `flex-shrink:1` back at higher specificity. The floating-header-clone mechanism is kept (deliberately, not an oversight) for every table that shares a scroll region with sibling KPI/notes cards, repointed from `window`/CSS-var-summed offsets onto each table's own real scrolling ancestor. Portfolio Analysis's permanent disclaimer banner became a compact `helpIcon()` (new, generic sibling of `infoIcon()`) next to its workspace title — no information lost, no new permanent chrome. The prior entry's scroll-triggered header-collapse is removed outright (no longer needed, since the header never blocks scrolling content now) and replaced with a header that's simply compact by default on every workspace. `system.md` §2.3 has the full architecture writeup, the exact native-vs-clone table classification and why, and the full live-validation detail (including two false failures traced to test-script bugs — measuring the non-sticky `<thead>` instead of the sticky `<th>`, and Chrome throttling smooth-scroll in an unfocused automated window — corrected before concluding anything, not left unresolved). Files changed: `index.html`, `script.js`, `styles.css`. Explicit exceptions: `report.html`/`portfolio-review.html`/`committee-pack.html` (separate long-form print pages, untouched) and `<900px` (existing document-scroll/off-canvas-sidebar mobile fallback, untouched — desktop is the primary target). | ✅ Completed, validated — see `system.md` §2.3 for full validation detail |
| **App-wide fixed workspace regions + missing-data blank convention** | 2026-09-05 | Two fixes from one explicit user brief, both scoped app-wide. (1) **Fixed-context regression**: the bounded-viewport shell above (same day, prior entry) treated an entire visible `.subsection` as one scroll unit, so a `.subsection` mixing a KPI/summary/recommendation grid with a detail table — Watchlist Research Overview's `#wr-kpis`/screening matrix, Portfolio Analysis Overview's `#portfolio-kpis`/allocation table, and 8 more instances across Watchlist Research (Risk overview), Portfolio Analysis (Exposure Matrix, Health & Rebalancing), Dashboard (Portfolio Intelligence, Committee View), Market Intelligence (Macro Intelligence, Sector Intelligence) and the Watchlists tab's Portfolio summary card — scrolled its KPI grid away together with the table instead of keeping it pinned. Fixed by reusing the shell's own existing `.scroll-body` marker one level deeper: the detail portion of each such `.subsection` is now wrapped in a `.scroll-body` sibling, with `.subsection:has(>.scroll-body){overflow-y:visible}` (new) making the outer `.subsection` a pass-through, same pattern as the pre-existing `:has(>.subtab-root)`/`:has(>.card-table-fill)` cases — no JS, no pixel-offset math. (2) **Missing-data blank convention**: replaced the generic "N/A" UI placeholder with a blank value everywhere it was a stand-in for missing/unverified data — 4 frontend files (`script.js`, `report.js`, `portfolio-review.js`, `committee-pack.js`), each already independent per §1.2/§2.5's no-shared-runtime architecture: each file's `escape()` now blanks the literal sentinel string `'N/A'` (`str === 'N/A' ? '' : ...`), and each file's `fmt`/`pct`/`compact`/`suffixed` formatters return `''` instead of `'N/A'` for a missing value — one change per file catches the large majority of the ~270 call sites across the 4 files without touching each individually; `isSortNA()` (`script.js`) was extended to also treat `''` as not-available so column-sort's existing N/A-always-last convention is unaffected. A handful of internal-only sentinel comparisons/lookup keys (`EXPOSURE_TIER_CLASS`/`MACRO_DIRECTION_CLASS`'s object keys, the Watchlists rating-filter's `sig !== 'N/A'`) were deliberately left alone — they compare against the backend's real sentinel value and never render literal "N/A" text either way. Explanatory copy referencing "N/A" as a concept (`index.html`'s Watchlist Research Valuation/Profitability/Technicals sub-tab notes, the Market Intelligence data-policy disclaimer) was reworded to describe the blank convention directly (e.g. "Gross margin is left blank: ..."), and `CLAUDE.md`/`system.md` §6's own "missing data renders N/A" working-rule line was updated to match — this is a UI display-layer change only; the backend's own `'N/A'` return-value sentinel (`data/analytics`, `data/decision`, `data/scoring`, `data/watchlist`, `data/reporting`, `data/providers`) is unchanged, per `system.md`'s new §2.6. See `system.md` §2.3 (scrolling fix) and §2.6 (missing-data standard, new) for the full architecture writeup. Files changed: `index.html`, `styles.css`, `script.js`, `report.js`, `portfolio-review.js`, `committee-pack.js`, `CLAUDE.md`, `docs/authoritative/system.md`. | ✅ Completed, validated — see `system.md` §2.3/§2.6 for full validation detail |
| **Global scrolling/width audit — 3 more fixed-context leaks + flex-item width bug** | 2026-09-06 | Follow-on repo-wide audit (explicit user brief) against the 2026-09-05 Level 1-5 fixed-context contract, plus a horizontal-width consistency pass. Found and fixed 3 more `.subsection`s where fixed context (intro text, filter pills) scrolled away with their own detail table because the Level 5 content was never wrapped in `.scroll-body`: Watchlist Research → Fundamentals → Valuation, Watchlist Research → Risk & Opportunity → Alerts, Market Intelligence → Earnings & Events. Portfolio Analysis → Health & Rebalancing (named in the brief) was inspected and found already correct from the prior pass. Separately found and fixed two independent width defects: `activateWorkspaceTab()` only toggled the Watchlists tab's `full-bleed` (edge-to-edge) width on `#main`, never on the header's own container, so the header's title/toolbar row and the page content diverged by ~400px on that one tab (fixed by toggling both together, `#header-container` new); and a genuine flexbox bug where `main#main.container`'s `margin:auto` (cross-axis, since `.app-main` is a column flex container) disabled `align-items:stretch` per spec, shrinking `#main` to an arbitrary content-dependent width instead of filling available space up to its `max-width:1900px` cap — confirmed live via computed styles (1205px actual vs. 1380px available on a 1600px viewport), fixed with one property (`width:100%` added to `.container`). `report.html`/`portfolio-review.html`/`committee-pack.html` don't reference `.container`/`styles.css` at all (grepped) and are unaffected. See `system.md` §2.3 for the full write-up and the new formalized "Layout contract" ASCII diagram. Files changed: `index.html`, `script.js`, `styles.css`. | ✅ Completed, validated — see `system.md` §2.3 for full validation detail |
| **Global scrolling/width audit round 2 — one universal width rule, general leak-containment fix** | 2026-09-06 | Same-day follow-on: a second brief (with its own screenshots) found round 1 left a two-tier width policy in place (every tab except Watchlists still capped at `max-width:1900px;margin:auto`, centering content with a large gutter on any monitor wider than sidebar+1900px) and found, via a new 43-path automated sweep across every screen/sub-tab/nested-sub-tab in the app at multiple viewport heights, 2 real cases (Portfolio Analysis → Health & Rebalancing, Market Intelligence → Macro Intelligence) where `#main` itself became an unintended scroll surface at a shorter (≤900px) viewport height — a general architectural leak, not a per-page defect. **Width**: deleted the `max-width`/`margin:auto` cap outright (`.container` is now `width:100%;padding:20px` everywhere, no exceptions) and retired the now-fully-redundant `full-bleed` toggle mechanism (`activateWorkspaceTab()`, `.container.full-bleed`) instead of leaving dead special-case code behind — one policy, matching the Watchlists tab's own layout, which is no longer a special case. **Scroll boundary**: root-caused to `.subsection:has(>.scroll-body){overflow-y:visible}` being a non-clipping pass-through — when the fixed siblings before `.scroll-body` (a KPI grid or two-col card pair) are combined taller than the subsection's own box, the excess had nowhere to clip and bubbled all the way to `#main`, dragging the tab's own title/nav along with it. General fix: removed `.scroll-body` from that pass-through selector so the subsection keeps its own default `overflow-y:auto` as a contained fallback — zero effect in the common case (confirmed live on 6 representative panels), and in the edge case contains the overflow at the subsection itself instead of leaking to `#main`. Two narrow, principled "specific component" exceptions (same class as a wide table needing its own scroll) were also capped since their list length is genuinely data-driven: `#health-history` (run-over-run health trend, capped at 30 entries server-side) and `#macro-regime ul` (market-regime notes, 0-5 sentences). Documents the final rule explicitly in `system.md` §2.3: "Above yellow divider = fixed workspace context. Below yellow divider = bounded scrollable content." Files changed: `script.js`, `styles.css` (`index.html` unchanged this pass). | ✅ Completed, validated — see `system.md` §2.3 for full validation detail |
| **Watchlist Research Overview screening matrix — fixed-header regression fix** | 2026-09-06 | The `.scroll-body` fix above (2026-09-05 "App-wide fixed workspace regions" entry) wrapped the *entire* Screening matrix card — title, "Rank by" dropdown, description paragraph, and table together — in one `.scroll-body`, so all four scrolled away as a unit instead of only the company rows, contradicting the Level 1-4-fixed/Level-5-scrolls contract those same docs establish. Root cause: this panel combines a KPI grid (`#wr-kpis`, Level 4) with a single detail table, which the contract routes to `.scroll-body` at the *subsection* level — but the requirement here (title/description/dropdown/column headers fixed, only rows scroll) needed the finer-grained split `.card-table-fill`+`.sticky-thead-native` already gives the other 10 single-table Watchlist Research panels (Profitability/Balance sheet/Ownership/Growth/Trend/Momentum/Volume/Relative strength/Volatility/Signals). Converted `#wr-overview-table`'s card to that same mechanism (`class="card card-table-fill"`, table `class="sticky-thead-native"` replacing the floating-clone marker `thead-sticky-1`) rather than inventing a one-off structure. Extended it correctly for this panel's KPI-grid-plus-table shape (not currently present on the other 10) via two small, general CSS refinements, not a per-panel hack: (1) `.subsection:has(>.card-table-fill)`'s pass-through now excludes a `.subsection` that also has a `.grid` sibling (`:not(:has(>.grid))`) — the same "mixed panel can overflow" hazard `.scroll-body`'s own pass-through exclusion (round 2, above) already protects against, now generalized to `.card-table-fill` too; (2) `.card-table-fill>.scroll` gained a `min-height:120px` floor (roughly the sticky header row plus 2 data rows) — without it, a short viewport squeezed `.scroll` toward 0px, which both hid the table and (confirmed live) broke `position:sticky` itself once the sticky cell's own height exceeded its shrunk scroll container's. Files changed: `index.html`, `styles.css`. | ✅ Completed, validated — see note below |
| **Portfolio Analysis Overview allocation table — fixed-header regression fix (two-col shape)** | 2026-09-06 | Same defect as the `#wr-overview-table` entry directly above, reported via a screenshot: the Screen-derived model allocation card's title, description, column headers and the sibling Portfolio construction notes card all scrolled away with the company rows, because the panel's `.scroll-body` wrapped the entire `.two-col` (both cards) as one scroll unit instead of bounding just the table's own rows. Different shape from `#wr-overview-table` (a `.two-col` pair, not one card alone), so the direct-substitution fix needed one further generalization: converted the allocation card to `.card-table-fill`+`.sticky-thead-native` (`#portfolio-table` class changed from `thead-sticky-1` to `sticky-thead-native`), removed the `.scroll-body` wrapper, and added one new general CSS rule — `.subsection>.two-col:has(>.card-table-fill){flex:1;min-height:0}` — giving the `.two-col` row the same flex:1;min-height:0 treatment `.scroll-body`/`.card-table-fill` already get as direct `.subsection` children, so it can shrink into the subsection's remaining space instead of ballooning to content size. The notes card needed no change: CSS Grid's default `align-items:stretch` gives it the same row height as the table card with nothing of its own to scroll, so it stays fixed with zero new code. `script.js`'s own comment listing which tables remain on the floating-header-clone mechanism was updated to drop "Portfolio's allocation" (no functional change — `initFloatingHeaders()`'s generic `table[class*="thead-sticky-"]` selector already stops matching once the class changed). Files changed: `index.html`, `styles.css`, `script.js` (comment only); `system.md` §2.3 updated in the same change. | ✅ Completed, validated — see note below |
| **Below-the-yellow-divider content split into sub-tabs — 4 panels** | 2026-09-07 | A UX review asked, per panel below the yellow divider, whether its Level-5 scroll region actually bundled a second, distinct analytical view rather than one homogeneous table — the existing `.subtab-root`/`applySubtabState()`/`initSubtabs()` mechanism already exists for exactly this, so no new tab system was built. Found and split 4 genuine cases, each reusing the nested-subtab pattern Quality/Correlation/Technicals already established: **Watchlist Research → Fundamentals → Valuation** (new `.subtab-root#wr-valuation-detail`: Valuation / Sector Dispersion, splitting the per-company table from the sector P/E-dispersion statistic); **Portfolio Analysis → Attribution** (new `.subtab-root#portfolio-attribution-detail`: Contribution / Score Attribution, splitting weight/risk distribution from which holdings drive the composite scores); **Market Intelligence → Sector Intelligence** (new `.subtab-root#sector-intel-detail`: Sector Rollups / Coverage Gaps, splitting sector performance data from a gap-disclosure list); **Market Intelligence → Earnings & Events** (new `.subtab-root#earnings-events-detail`: Earnings Intelligence / Event Calendar / Data Policy — the Data Policy disclaimer is `research.mjs`'s full ~18-sentence `DATA_LIMITATIONS` list, confirmed too large for fixed intro text via live measurement, so it became a third tab rather than being hoisted above the divider). Each migrated table (`#valuation-table`, `#sector-intel-table`, `#earnings-intel-table`) moved from the floating-header-clone mechanism to `.card-table-fill`+`.sticky-thead-native` now that it sits alone in its own single-table subsection. Generalized `styles.css`'s `.subsection:has(>.subtab-root)` pass-through to carry the same `:not(:has(>.grid))` exclusion `.card-table-fill`'s pass-through already had, since Sector Intelligence was the first panel combining a KPI grid with a `.subtab-root`. Several other mixed panels (Watchlist Research → Risk & Opportunity's risk-methodology paragraph, Macro Intelligence's available/unavailable indicator pair, Dashboard's Portfolio Intelligence/Committee View roll-ups) were reviewed against the same test and deliberately left unsplit — each reads as one coherent view, not two. Zero analytics/scoring/decision/quant/provider/API change. Files changed: `index.html`, `styles.css`. | ✅ Completed, validated — see `system.md` §2.3 for full validation detail |
| **Macro Intelligence — India/US Macro promoted to peer tabs; India Gold Rate integrated** | 2026-09-07 | Supersedes the nested-sub-tab row immediately below: India Macro and US Macro are now two more buttons in `#market-intelligence`'s own primary `.subtabs` bar (siblings of Sector Intelligence/Earnings & Events/News & Catalysts), each its own top-level `.subsection`, not a nested `.subtab-root` below shared Market regime/Data Quality cards — clicking Market Intelligence now shows *only* Market regime + Data Quality, clicking India Macro or US Macro hides those and each other's content entirely. The former "Macro Intelligence" button is relabeled **"Market Intelligence"** (`data-subtab` value unchanged). `#macro-geography-detail` is removed outright; every table/card keeps its exact element id, only DOM parent moved. Added a genuinely real 7th `MACRO_INDICATORS` entry, **India Gold Rate** (`GOLDBEES.NS`, Nippon India ETF Gold BeES — a real NSE-listed market price via the same `.NS`-ticker fetch path every equity already uses, confirmed live returning `"status":"Live"`). India Crude Oil and India Natural Gas were investigated and added to `UNAVAILABLE_MACRO_INDICATORS` instead (no NSE-listed ETF or other free, unauthenticated, India-specific proxy exists — MCX requires a paid feed). The pre-existing 9 Future Integration indicators were re-evaluated against FRED's free, unauthenticated `fredgraph.csv` endpoint (confirmed reachable) — every India-tagged candidate series found was either the wrong measure (interbank rate ≠ RBI repo rate) or too stale (18-31 months) to meet this app's Live/Delayed bar, so all 9 remain Future Integration, undisclosed-source reasons now recorded in `macroProvider.mjs`'s own comment. Files changed: `index.html`, `script.js`, `styles.css`, `data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`, `data/metadata/metricRegistry.mjs`. | ✅ Completed, validated — see note below |
| **Macro Intelligence — India Macro / US Macro sub-tabs (superseded same-day by the row above)** | 2026-09-07 | Below the Macro Intelligence panel's yellow divider (Market regime + Data Quality cards stay fixed, unchanged), split the single combined "Macro indicators"/"Not available" table pair into a nested `.subtab-root#macro-geography-detail` (India Macro / US Macro, `.subtabs-secondary` — same nested-subtab pattern as Sector Intelligence/Earnings & Events), reusing the app's existing sub-tab component rather than a new nav design. Geography classification is a client-side lookup keyed off each indicator's already-carried `key` field (`macroProvider.mjs`) — zero backend/data/calculation change, purely which of two tables a row renders into: **India Macro** — USD/INR, India VIX (the 2 India-relevant fetched indicators) plus all 9 disclosed-unavailable indicators (RBI repo rate, India G-Sec yield, CPI, IIP, PMI, power demand, ethanol policy, defence budget, banking liquidity — every one is India-specific by definition); **US Macro** — the remaining 4 fetched indicators, each sourced via a US-benchmark ticker (US 10Y Treasury yield, WTI crude, Henry Hub natural gas, COMEX gold). No duplication (each of the 15 indicators appears in exactly one tab); India Macro is the default tab, matching the workspace's own "Indian Equity Market" framing. One CSS-architecture nuance handled explicitly, not overlooked: converting the prior `.scroll-body` (which `system.md` §2.3's "Global scrolling/width audit round 2" entry, 2026-09-06, deliberately excludes from the generic pass-through specifically because *this exact panel's* two fixed cards — Market regime, Data Quality — can, combined, exceed the subsection's box at a short viewport) into a `.subtab-root` would otherwise pick up the generic `:not(:has(>.grid))` pass-through (macro's fixed siblings are plain `.card`s, not a `.grid`, so that exclusion doesn't catch it) and reintroduce the exact overflow-to-`#main` leak that entry fixed. Added one ID-scoped override (`.subsection:has(>#macro-geography-detail){overflow-y:auto}`, higher specificity than the generic rule) so the outer subsection keeps its already-validated contained-fallback behavior; each geography's own panel still gets a real, independently-bounded `.scroll-body`. Files changed: `index.html`, `script.js`, `styles.css`. | ✅ Completed, validated — see note below |
| **India Macro deferred-indicator re-verification — fresh evidence audit, Ethanol Blending + Defence Budget promoted to Periodic** | 2026-09-09 | Explicit user brief: "re-verify every deferred India Macro indicator with fresh live evidence — do not trust the prior (2026-09-08) audit as final." Independently re-tested all 9 then-"Future Integration" indicators this session (live HTTP fetches, official-document reads, one PDF-citation verification pass) rather than re-asserting the prior conclusion. **7 confirmed still unavailable, now with fresh evidence, not carried over**: RBI policy repo rate (RBI's own homepage renders it as static HTML sourced from FBIL; DBIE has no API; a third-party mirror at `dbie.rbihub.in` self-describes as unofficial and was excluded), India G-Sec yield (FBIL's own published FAQ, read in full, shows even the 7-day-lagged free tier requires organizational registration, a certified turnover statement and a signed Benchmark License Agreement — not achievable for this personal, single-user tool; CCIL separately prohibits automated use without written permission), PMI (S&P Global commercial-only, reconfirmed), banking system liquidity (RBI WSS/DBIE fetched live, HTML/PDF only), India Crude Oil / India Natural Gas (PPAC publishes only daily PDF press releases, historical XLS link 404s). **One genuinely new finding**: CEA (Central Electricity Authority) publishes a documented, unauthenticated public API for all-India power demand (`cea.nic.in/api/psp_peak.php`/`psp_energy.php`) — live-tested 5 times this session; returned either an explicit `"Connection failed: Connection timed out"` body on HTTP 200 or a full connection timeout on every retry. A real public API that is currently non-functional, kept Deferred per this task's own "HTTP 200 is not proof of feasibility" rule rather than wired up against a broken backend. **2 promoted to a new Periodic/Policy tier**: Ethanol Blending Rate (20% petrol blending achieved in ESY 2025-26, five years ahead of the original 2030 target — sourced directly from a PIB/Ministry of Petroleum & Natural Gas backgrounder dated 2026-07-05, PDF read in full) and Union Defence Budget (₹7,84,678 crore total allocation, FY2026-27 — sourced from the Union Budget 2026-27 Demand for Grants, cross-checked against PRS Legislative Research's own published Demand for Grants analysis). Two credentialed paths were investigated and explicitly declined after concrete evidence, not assumed: data.gov.in's Union Defence Budget datasets turned out stale/narrow (Modernisation-of-Armed-Forces estimates ending FY2019-20, a separate Defence Production series) with nothing matching the current total, so a new credential would not have solved the actual problem; FBIL's G-Sec registration (above) requires an organizational licensing process this tool cannot complete. New `PERIODIC_MACRO_INDICATORS` export (`data/providers/macroProvider.mjs`) and pure `toPeriodicIndicator()` mapper (`data/watchlist/macro.mjs`, exported for testing) — each entry is a manually-curated, dated, officially-sourced one-time reading with no changePct/trend/DMA (an annual/event-cadence figure has no daily series to compute one from), refreshed by hand only at the next official publication. New `payload.periodic` array and `dataQuality.periodic` count in `buildMacroSnapshot()`; new India Macro "Periodic / policy indicators" table (Indicator/Category/Value/Period/Status/As of/Source, Source linking to the exact official document) and a 5th Data Quality tile (`.grid.five`, new CSS rule alongside the existing `.grid.two`/`.grid.three`) — `Live`/`Delayed`/`Unavailable`/`Periodic`/`Future Integration`. One new `metricRegistry.mjs` entry (`periodicMacroIndicator`) plus updates to `macroIndicator`/`macroDataQuality`'s existing text so neither describes a now-stale 9-indicator list. Files changed: `data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`, `data/metadata/metricRegistry.mjs`, `index.html`, `script.js`, `styles.css`, `test/macroPeriodicIndicators.test.mjs` (new); `docs/authoritative/system.md` §3.8 updated in the same change. No credential added, no TLS change, no watchlist/analytics/scoring/decision/quant code touched. | ✅ Completed, validated — see note below |
| **Watchlist Research → Overview screening matrix — fetched-vs-derived data lineage + full column sort/resize/reorder/persistence (reference implementation)** | 2026-09-22 | Scoped, per explicit user brief, to `#wr-overview-table` only — no other Watchlist Research table, tab, or workspace touched. **Fetched-vs-derived classification**: the header's 18 columns were audited against their real data lineage (Company/Sector/CMP/P/E/Change read straight off `stock`'s fetched fields; the remaining 13 — Recommendation/Primary driver/Confidence/Composite score/Upside %/Regime/Risk score/Action/Company Quality/Stock Attractiveness/Fundamental View/Market View/Factor score — are all `data/scoring`/`data/decision`/`data/quant` output). Derived `<th>`s get a `col-derived` class (a solid `#1a213c` header background, distinct from fetched `<th>`'s `#10192b`, plus a small `◆` glyph and an appended tooltip sentence) and derived `<td>`s get a `derived` class (`rgba(147,130,255,.06)` tint) in `renderWrOverviewTable`'s row template — a new, deliberately off-palette indigo hue so the lineage cue never reads as this app's existing green/blue/amber/red semantic language (positive/negative, rating/action bands), which is left completely untouched. **Column sort**: already fully implemented pre-existing app infrastructure (`sortForTable`/`initTableSort`, `data-sort` on all 18 `<th>`s, `RATING_RANK`/`CONVICTION_RANK` rank maps for Recommendation/Confidence, numeric `.score` reads for Regime/Action/Fundamental View/Market View) — verified correct, not modified. **Column resize**: new for this table. Extracted the Watchlists → Custom table's existing drag-to-resize pointer-event logic into a shared `initTableColumnResize(tableId, onResize)` (script.js) — one implementation instead of a second copy — and added `initWrOverviewColumnResize()` plus a `wrOverviewColWidths`/`localStorage['wrOverviewColWidths']` width store, applied once against the table's static `<thead>` (unlike `wl-custom-table`, this table's header is never rebuilt by `render()`, so a saved width is applied on top of the markup's own default `style="width:...px"` rather than baked into a regenerated header cell). Added a `.col-resize-handle` to all 18 `<th>`s in `index.html` and `#wr-overview-table{table-layout:fixed}` (+ `overflow:hidden;text-overflow:ellipsis` on `th`/`td`, needed once a dragged width becomes authoritative) in `styles.css`. **A real regression was caught and fixed during validation, not left in**: the first CSS draft added `position:relative` to `#wr-overview-table th` (to anchor the resize handle) — an ID selector, which out-specificities `.sticky-thead-native thead th{position:sticky}` regardless of source order, silently breaking this exact table's native sticky header. Caught because the live resize-drag test's target coordinates (computed from `getBoundingClientRect()`) landed off-screen — the header was no longer sticking at scroll position 0 the way the rest of the app assumes. Fixed by dropping the redundant `position:relative` entirely: `position:sticky` is itself a valid containing block for the handle's `position:absolute`, so no replacement rule was needed. **Column reorder** (new, same-day follow-on completing the original brief's full spec): native HTML5 drag-and-drop on each `<th>` (`initWrOverviewColumnDrag`, delegated on the static `<thead>`, guarded the same way `initTableSort`/`initTableColumnResize` are) plus an Alt+ArrowLeft/Right keyboard equivalent on a focused header (this app has no other drag-and-drop precedent to match, so the keyboard path is a minimal additive affordance, not a parallel UI). Column identity is each column's existing `data-sort` id, never DOM position, so reordering can never desync sort/resize/derived-lineage state — a plain click still sorts (a drag gesture and a click are distinguished by the browser's own native drag-and-drop model, not custom logic) and the resize handle's existing `stopPropagation`/`preventDefault` on `pointerdown` keeps a resize-drag from also starting a column-drag. `applyWrOverviewColumnOrder()` re-splices the header's `<th>`s and reorders each body row's `<td>`s (by original-position → id mapping, since `renderTable()` always rebuilds `<tbody>` in the one hardcoded default order) to the persisted order after every render — a defensive cell-count guard skips the single-`<td>` empty-watchlist fallback row rather than misreading it. **Persistence, consolidated and versioned**: replaced the unversioned width-only `localStorage['wrOverviewColWidths']` key with one versioned, feature-scoped key, `stocksApp.watchlistResearch.overview.screeningMatrix.v1` (`{version, order, widths}`), with a one-time silent migration of any existing width data out of the old key. `loadWrOverviewLayout()` validates on load: an unknown column id (a future removal) is dropped, a column id missing from a saved order (a future addition) is appended at its default position/width, and any malformed/non-object/non-array JSON falls back to defaults entirely — never a broken, empty, or duplicated-column table. **Reset**: a new, deliberately unobtrusive "Reset columns" button next to the pre-existing "Rank by" control restores `WR_OVERVIEW_DEFAULT_ORDER`/`WR_OVERVIEW_DEFAULT_WIDTHS`, persists that reset immediately, and re-applies it to the live table with no page reload — sort state is left untouched by design (this table's sort was already never persisted, so "reset" only ever means layout, matching the brief's own "if sorting state is persisted" conditional). Files changed this same-day follow-on: `index.html` (Reset columns button + a short in-page usage hint), `script.js` (the reorder/persistence/reset code above), `styles.css` (`.col-draggable`/`.col-dragging`/`.col-drop-before`/`.col-drop-after`). Zero analytics/scoring/decision/quant/provider/API change; `data/metadata/metricRegistry.mjs` untouched (this is a lineage/presentation label on already-registered fields, not a new metric). | ✅ Completed, validated — see note below |

| **App-wide table standard — column resize/reorder/persistence generalized from Overview, plus data-lineage on every table** | 2026-09-23 | Generalized the entry directly above (which was explicitly scoped to `#wr-overview-table` only) into a reusable `initTableLayout(tableId, {resetButtonId, allowReorder})` engine and applied it, plus the fetched-vs-derived lineage classification, to the other 26 real comparison tables in the app — `wl-table`/`wl-custom-table` (Watchlists), `opportunities-table`/`pi-action-table` (Dashboard), `valuation-table`/`profitability-table`/`balance-sheet-table`/`ownership-table`/`growth-table`/6 `technical-table-*`/`risk-table`/`alerts-table` (Watchlist Research), `portfolio-table`/`rebalancing-table`/`exposure-matrix-table` (Portfolio Analysis), and both macro-indicator tables/`macro-periodic-table`/`macro-unavailable-table`/`sector-intel-table`/`earnings-intel-table` (Market Intelligence). Company Research, Reports, Compare and the disabled Sector Research placeholder contain no `<table>` and were left untouched. Column sort itself was already app-wide (an earlier pass, 2026-09-04); this pass is resize/reorder/persistence/lineage only. Solved two structural problems the single-table original didn't have to: (1) a table on an inactive tab/subtab is `display:none`, so capturing "default column width" at bind time would record 0 for every table not currently on screen — fixed by deferring capture to the first time a table is genuinely visible, re-attempted on every tab/subtab switch; (2) several tables mix sortable columns with fixed, non-reorderable ones that aren't only at the edges (`wl-table`'s checkbox/Notes/Actions, `profitability-table`'s always-blank Gross margin column sitting mid-row) — a naive "move only the sortable columns" reorder left fixed columns dragged out of position (caught live: Gross margin visibly jumped after a reorder); fixed with a positional template (`fullLayout`) captured once at bind time that keeps fixed columns pinned regardless of how the sortable ones are reordered. The two India/US macro-indicator tables (a second colspan group-header row above the real header) get sort+resize but not drag-reorder (`allowReorder:false`) — reordering would misalign the group labels. `wl-table` keeps its pre-existing bespoke sort untouched (resize/reorder layer on independently); `wl-custom-table` (the one table whose `<thead>` is fully rebuilt every render) required its resize/drag-bind guards to move from table-level "once" to per-element/idempotent, and gained drag-reorder for the first time, migrating its previously-separate width-only key into the same shared per-table scheme. See `system.md`'s own dated entry (end of §2) for full technical detail. Files changed: `index.html`, `script.js`, `styles.css` — no analytics/scoring/decision/quant/provider/API change; no new `metricRegistry.mjs` entries (classifying an existing field's lineage isn't a new metric). | ✅ Completed, validated — see note below |

**App-wide table standard validation detail**:
- `node --check script.js` clean; `node --test`: 140/140 pass, unaffected (presentation-layer only, no analytics/scoring/decision/quant module touched).
- Live validation (zero-dependency CDP driver, Puppeteer unavailable in this session's sandbox, against a scratch server on a different port, `data/watchlists`/cache untouched — the one active-watchlist switch made to exercise a 30-company watchlist was reverted to its exact pre-session value, confirmed via `git diff`). A first pass at the CDP driver's default ~764×485 viewport produced false negatives across the board — the whole session was silently running in the app's `<901px` mobile/document-scroll fallback rather than the desktop bounded-viewport shell; caught by checking `window.innerWidth` against unexpectedly-zero `getBoundingClientRect()` reads rather than assumed, then re-run at 1600×1000.
- All 27 tables confirmed to gain `.table-layout-managed`, a working resize handle on every sortable column, and a working reset button once genuinely visible; zero console exceptions across a full sweep of every workspace/tab/subtab.
- Fixed-column pinning verified directly, not just reasoned about: dragging `wl-table`'s Company column past P/E left the leading checkbox and trailing Notes/Actions columns exactly where they started; dragging `profitability-table`'s Earnings quality column to the front left the always-blank Gross margin column's cell correctly aligned under its own header.
- Keyboard reorder (Alt+ArrowLeft/Right) confirmed directionally correct (a synthetic-`DragEvent`-based test showed an inverted before/after drop zone, traced to the test harness's synthetic `clientX` not reaching the handler as expected, not a real app defect — the keyboard path, which doesn't depend on drag coordinates at all, confirmed the underlying reorder logic is correct).
- A resized column width and a reordered column order both survived a full page reload, `localStorage`-backed under a distinct per-table key (`Object.keys(localStorage)` confirmed isolation).
- `wl-custom-table`'s optional-field toggle confirmed to correctly reconcile a live column-set change against an existing reorder with no header/body cell-count mismatch, both when hiding and re-showing a field.
- `macro-indicators-table-india`'s header confirmed non-draggable while still sortable and resizable.

**Watchlist Research → Overview screening matrix — column reorder/persistence/reset validation detail**:
- `node --check script.js` clean; `node --test`: 140/140 pass, unaffected (no analytics/scoring/decision/quant module touched — this pass is `index.html`/`script.js`/`styles.css` only).
- Validated live with `playwright-core` driving the system's real installed Chrome headless (executablePath pointed at the local Chrome install, no browser binaries downloaded) against a scratch server (port 4199, never the user's own dev server on 4173), on the largest currently-active watchlist available (`sub-100-growth-di-crossover-setup-monthly`, 3 companies).
- **Sort**: clicking CMP (a numeric column) sorted strictly ascending, a second click strictly descending, `sorted-desc` class applied to the correct header — confirmed against the real (comma-grouped, `en-IN`-formatted) cell text, not a naively-parsed one, after an initial false failure in the validation script itself (`parseFloat` on `"1,084.3 INR"` stopping at the comma) was traced and fixed in the test, not the app.
- **Resize**: dragging `Company`'s `.col-resize-handle` by +80px grew the header from 200px→280px; the resize drag did not also trigger a sort (header carried no `sorted-*` class afterward).
- **Reorder**: dragging `Sector` past `P/E` moved both the header and every row's Sector cell together (spot-checked row 1: Company/Sector columns read correct paired values at their new positions); dragging the derived `Recommendation` column to the front confirmed its `col-derived`/`derived` classes (header tint+glyph, cell tint) moved with it, not left behind at the old position.
- **Persistence**: the saved `localStorage['stocksApp.watchlistResearch.overview.screeningMatrix.v1']` value matched the live column order/widths exactly; a full page reload restored the identical order and the resized 280px width without any further interaction.
- **Reset**: clicking "Reset columns" restored the default order and Company's width to 200px immediately (no reload needed) and persisted that default back to `localStorage`; a subsequent reload confirmed the default order stuck, not reverting to the pre-reset custom layout.
- **Keyboard reorder**: focusing the `Sector` header and pressing Alt+ArrowLeft moved it one position left, mirroring the drag mechanism's own `moveColumn()`/persistence path.
- **Regression sweep**: clicked through all 9 sidebar workspaces plus all 4 Watchlist Research sub-tabs (Overview/Fundamentals/Technicals/Risk & Opportunity) — zero duplicate DOM ids app-wide, zero console errors besides the pre-existing, already-disclosed `favicon.ico` 404 this history records at every prior pass.
- No mutating route was ever called against the scratch server (only page loads, sidebar/sub-tab clicks, and drag/click/keyboard column interactions); `git status`/`git diff` on `data/watchlists/` after the session showed no change beyond what was already uncommitted at session start. The scratch server (port 4199, found by exact PID bound to that port) was terminated by precise PID before finishing.

**India Macro deferred-indicator re-verification validation detail**:
- `node --check` clean repo-wide (every tracked `.mjs`/`.js` file); `node --test`: 140/140 pass (134 pre-existing + 6 new in `test/macroPeriodicIndicators.test.mjs`, covering `PERIODIC_MACRO_INDICATORS`'s shape/values, `UNAVAILABLE_MACRO_INDICATORS`'s corrected 7-key list, and `toPeriodicIndicator()`'s pure mapping — no analytics/scoring/decision/quant module touched).
- Live `GET /api/macro` against a scratch server (port 4199, never the user's own dev server) confirmed the real payload: `periodic` carries both new entries with the exact researched values (₹7,84,678 crore / FY2026-27; 20% / ESY 2025-26) and correct source links; `unavailable` correctly down to the 7 re-verified keys; `dataQuality.periodic: 2`; `dataQuality.live: 9` (7 market indicators + CPI + IIP, confirming no regression to the existing MoSPI integration).
- Validated live with a zero-dependency Chrome DevTools Protocol driver (Node 22's built-in `fetch`/`WebSocket`) driving the system's real installed Chrome headless (isolated scratch profile, remote-debugging port 9333) against the same scratch server, navigating via real sidebar/sub-tab clicks (not direct state injection).
- At all 4 required viewports (1600×1000, 1366×768, 1280×700, 390×844): the new "Periodic / policy indicators" table rendered exactly 2 rows with correct Indicator/Category/Value/Period/Status/As of/Source content at every size; zero duplicate DOM ids; zero horizontal overflow (`document.documentElement.scrollWidth` vs. `clientWidth`); the Data Quality panel correctly showed 5 cards (`Live 9`/`Delayed 0`/`Unavailable 0`/`Periodic 2`/`Future Integration 7`); zero console errors/exceptions captured via `Runtime.consoleAPICalled`/`Runtime.exceptionThrown`.
- Regression-checked in the same session: India Macro's main indicators table still shows exactly 5 rows (USD/INR, India Gold Rate, India VIX, CPI Inflation, IIP) with CPI/IIP unaffected; US Macro still shows exactly its 4 rows; the "Not available" table shows exactly the 7 re-verified indicators, correctly excluding ethanolPolicy/defenceBudget.
- No mutating route was ever called against the scratch server (only page loads, tab/subtab clicks, and DOM measurement); `data/watchlists/` untouched (confirmed via `git status`, zero change); `data/cache/` is gitignored so its writes (real Yahoo/MoSPI fetches during the scratch run) are not tracked and not a concern. The scratch Chrome process tree (found by its exact `chrome-profile` user-data-dir, not a name-wide match) and the scratch server (found by the exact PID bound to port 4199 via `Get-NetTCPConnection`) were each terminated by precise PID — no `taskkill /IM chrome.exe` or other process-name-wide kill was used, per this task's own explicit constraint.

**Macro Intelligence — India Macro / US Macro sub-tabs validation detail**:
- `node --check script.js`/`node --check server.mjs` clean; `node --test`: all 109 tests / 36 suites pass, unaffected (no analytics/scoring/decision/quant/provider module touched — this is a presentation/navigation-only change, confirmed by the fact `data/providers/macroProvider.mjs`/`data/watchlist/macro.mjs` were not opened for edit).
- Validated live with a zero-dependency Chrome DevTools Protocol driver (Node 22's built-in `fetch`/`WebSocket`) driving the system's real installed Chrome headless against a scratch server (port 4321, never the user's own dev server on 4173), against real cached macro data (`GET /api/macro` — 6 Live indicators + 9 Future Integration confirmed via direct API read before the UI check).
- 16/16 scripted assertions passed at each of 4 viewports (1600×1000, 1366×768, 1280×700 — the exact short-height case the CSS override above protects — and 900×700): nav shows "India Macro"/"US Macro" in that order; India Macro is the default active tab/panel on a fresh session (localStorage cleared first, to rule out a prior run's persisted selection); India Macro's indicator table shows exactly USD/INR + India VIX and its unavailable table shows exactly the 9 disclosed indicators; clicking US Macro switches the active tab/panel correctly and shows exactly the 4 expected US indicators; total rows across both tabs + the unavailable table = 15 with no duplication; the Market regime and Data Quality cards (above the divider) render unchanged; `#main` never overflows; India Macro's own `.scroll-body` is genuinely bounded and scrollable while the sub-tab nav bar itself stays pixel-fixed during that scroll; zero console errors (excluding the pre-existing, disclosed `favicon.ico` 404 this history already records at every prior pass).
- At 390×844 (mobile, <900px): confirmed the existing documented document-scroll fallback is what engages (not a regression) — `#main` overflow 0, no horizontal overflow, same 16/16 functional assertions pass.
- A full 8-workspace click-through (every sidebar tab, every Market Intelligence sub-tab including both new India/US Macro states) found zero duplicate DOM ids and zero console errors app-wide, confirming the new `#macro-geography-detail`/`#macro-indicators-table-india`/`#macro-indicators-table-us` ids introduced no collision and nothing else regressed.
- No mutating route was ever called against the scratch server (only page loads, tab/subtab clicks, and scroll/DOM measurement); `git diff` on `data/watchlists/`/`data/cache/` after the session matched the pre-existing uncommitted state from the user's own prior activity (the `sanaya` watchlist addition, timestamped hours before this session), confirmed via timestamp inspection. Scratch Chrome (headless, remote-debugging port 9333) and the scratch server (port 4321) were both terminated, and the scratch Chrome profile directory deleted, before finishing.

**Portfolio Analysis Overview allocation table fixed-header regression fix validation detail**:
- `node --check script.js`/`node --check server.mjs` clean; `node --test`: all 109 tests / 36 suites pass, unaffected (no analytics/scoring/decision/quant module touched).
- Validated live with a zero-dependency Chrome DevTools Protocol driver (Node 22's built-in `fetch`/`WebSocket`) driving the system's real installed Chrome headless against a scratch server (port 4321, never the user's own dev server), against the Asmita watchlist (30 companies).
- At all 5 viewports named in the brief (1600×1000, 1280×900, 1366×768, 1280×800, 1280×700): the allocation card's title, description paragraph, sticky `<th>`, the notes card, and `#portfolio-kpis` all measured pixel-identical (`getBoundingClientRect()`) before and after scrolling the table's own `.scroll` to its end; the scroll genuinely engaged (`scrollTop > 0`) in every case; column alignment held (`theadFirstThLeft === firstBodyTdLeft`); `document.documentElement`/`#main` both measured exactly `0px` overflow, before and after, at every viewport.
- `#portfolio-table` confirmed to carry `sticky-thead-native` (not a `thead-sticky-*` clone class) with a real `position:sticky` computed style; zero duplicate DOM ids app-wide; zero console errors/exceptions throughout.
- Regression-checked at the same 5 viewports: Watchlist Research → Overview → Screening matrix, Watchlist Research → Risk & Opportunity → Risk overview → Stock-by-stock risk matrix, and Portfolio Analysis's own Health & Rebalancing → Rebalancing suggestions and Exposure Matrix → Per-company exposure (both still on the floating-clone mechanism, untouched by this change) — each panel's own fixed card title held position across a scroll attempt and neither `#main` nor the page ever overflowed.
- No mutating route was ever called against the scratch server (only page loads, tab/subtab clicks, and scroll/DOM measurement); `git diff`/`git status` on `data/watchlists/`/`data/cache/` showed zero change after the run. Scratch Chrome (headless, remote-debugging) and the scratch server were both terminated before finishing.

**Watchlist Research Overview screening matrix fixed-header regression fix validation detail**:
- `node --check script.js`/`node --check server.mjs` clean (`index.html`/`styles.css` are not `node --check`-able; validated live instead, below); `node --test`: all 109 tests / 36 suites pass, unaffected (no analytics/scoring/decision/quant module touched — this pass is `index.html`/`styles.css` only, `script.js` untouched).
- Validated live with a zero-dependency Chrome DevTools Protocol driver (Node 22's built-in `fetch`/`WebSocket`, same discipline as every prior pass in this history) driving the system's real installed Chrome headless against a scratch server (port 4199, never the user's own dev server on 4173).
- At 1600×1000 and 1280×900 (comfortable-height desktop): the title, "Rank by" dropdown, description paragraph and column headers measured pixel-identical (`getBoundingClientRect().top`) before and after scrolling the table to its end; the sticky `<th>` itself (not the non-sticky `<thead>` wrapper — this session's own earlier debug pass first reproduced the exact "measured the wrong element" false-failure this app's history already warns about at the 2026-09-05 entry, then corrected it) held at a constant position throughout; horizontal scroll kept the sticky header and body columns pixel-aligned (`theadFirstThLeft === firstRowFirstTdLeft`); `document.documentElement`/`#main` both measured zero scroll overflow.
- At 1366×768 and 1280×700 (the brief's own two shorter-viewport cases): before the `min-height:120px` floor was added, `.scroll`'s own `clientHeight` measured 0-9px (confirmed via direct DOM measurement, not inference) — both hiding the table entirely and (confirmed live, reproduced then fixed) breaking `position:sticky` itself, since Chrome cannot hold a ~39px-tall sticky cell fully in place inside a shorter-than-itself scroll container; a controlled step-through (0/25/50/75/100% scroll) isolated exactly where the partial, non-clamped drift began. After the floor + `:not(:has(>.grid))` pass-through fix, the same fixed-elements-pixel-identical/sticky-th-constant checks above re-ran clean at all 4 required viewports (1600×1000, 1280×900, 1366×768, 1280×700) for the primary interaction (scrolling while the table itself is the scroll target, i.e. `.scroll`'s own `scrollTop`) — zero `#main`/page overflow in every case.
- **Disclosed edge-case degradation, not a defect**: at 1366×768 and 1280×700 specifically, the fixed header content (KPI grid + card header) combined with the new 120px table floor can together exceed the `.subsection`'s own allocated height (measured: 77px at 1366×768, 145px at 1280×700) — since the `:not(:has(>.grid))` fix keeps `.subsection`'s default `overflow-y:auto` rather than a pass-through, this excess is contained at the subsection itself (confirmed: `#main`/page overflow stayed exactly 0 in every measurement) rather than leaking upward, exactly the same accepted, disclosed trade-off `system.md` §2.3 already documents for Health & Rebalancing/Macro Intelligence at short viewports — a deliberate scrollbar on the subsection is only reachable by deliberately scrolling while hovering the fixed area (KPI cards/title text) rather than the table itself; a real screenshot comparison (before/after triggering that specific outer scroll) confirmed the table's own header+row scrolling and column alignment stay correct regardless.
- Regression-checked at 1600×1000: one `card-table-fill` panel with no `.grid` sibling (Profitability, to confirm the `:not(:has(>.grid))` addition doesn't change its existing pass-through), one `.scroll-body` panel (Watchlist Research → Valuation), Portfolio Analysis and Dashboard — all measured zero `#main`/page overflow, unaffected. The Watchlists tab's add-company autocomplete dropdown (`#wl-company-suggestions`) confirmed still rendering unclipped (height 38px, not zero) after the CSS change.
- No mutating route was ever called against the scratch server this pass (only page loads, tab/subtab clicks, dropdown/scroll DOM operations); `git status`/`git diff` on `data/watchlists/`/`data/cache/` showed zero change from this session. Scratch Chrome (headless, remote-debugging port 9333) and the scratch server (port 4199) were both terminated before finishing.

**UI regression audit — Company Research nav sync, Watchlist Research sticky headers, sort affordance validation detail**:
- `node --check script.js` clean; `node --test`: all 109 tests / 36 suites pass, unaffected (no analytics/scoring/decision/quant module touched — this pass is `script.js`/`styles.css` only).
- Validated with a real, installed Chrome (`puppeteer-core` driving the system browser via CDP, installed only in a scratch directory outside the repo — never added to the project, same zero-dependency discipline as every prior pass) against a second server instance on a scratch port (4183, never the user's own dev server on 4173) — not jsdom, specifically because this regression is a real-browser layout/CSS defect jsdom's absent layout engine cannot observe (the prior pass's own validation note already names this exact gap as why its sticky claims went unverified).
- **Header/nav sync**: confirmed live that `--header-h`/`--subtabs-h` now stay correct after a company switch (`companySwitchHeaderSync`: computed `--header-h` matched the header's real `offsetHeight` post-switch) and after a watchlist switch/render. Company Research scrollspy: clicking each of the 7 `.cr-page-nav` links landed the correct link `active` and the correct section heading visible below the nav (not hidden behind it) in all 7/7 cases; a continuous-scroll walkthrough of a 30-company watchlist's full ~11,250px Company Research page (13 sampled points) showed exactly one active link at every point after scroll begins, transitioning Snapshot → Valuation → Quality → Technical → Risk → Intelligence in order, never zero or multiple active links; the one genuine edge case found (scrollY 0, before the observer's first callback, showed zero active links) was fixed by defaulting to the first section immediately on (re)build.
- **Sticky table headers**: a controlled long-scroll test (an injected spacer to guarantee enough scroll range to actually cross the sticky threshold, not just eyeball a short page) proved the *prior* implementation's `thead th` never actually stuck — it tracked page scroll 1:1 through the intended offset with zero clamping, confirming the reported bug (a screenshot showing the header row rendering after several data rows) was real and reproducible, not a misreading. The fixed implementation (bounded `.scroll` + `top:0` sticky) was confirmed, live, on both a top-level table (`#wr-overview-table`, `.thead-sticky-1`) and a table nested two sticky-nav levels deep (`#technical-table-trend`, `.thead-sticky-2`): the header's `getBoundingClientRect().top` stayed constant while the table's own internal scroll moved rows underneath it; horizontal scroll (`scrollLeft`) kept the header and body columns pixel-aligned (`thLeft === rowLeft`); the outer page's own `window.scrollY` still advanced normally after the internal scroll, confirming no scroll trap. `:has(.thead-sticky-1)`/`:has(.thead-sticky-2)`/`:has(.thead-sticky-3)` scoping confirmed to leave an unrelated `.scroll` table (`#macro-indicators-table`, Market Intelligence) with its original `max-height:none` — not affected.
- **Sort affordance**: confirmed the neutral ↕ glyph renders on an unsorted `th[data-sort]` (`::after` computed content/opacity checked directly, not just visually). Re-verified the sort mechanism itself against a corrected test (the first pass's own verification script read the wrong column index): ADX ascending on the Trend table produced a strictly non-decreasing 14-value sequence, a second click reversed to strictly non-increasing, a third restored the exact pre-sort row order and cleared both sort classes; sorting the same table by P/E (a column with real N/A values in this watchlist) put both N/A rows last regardless of direction.
- Zero duplicate DOM ids; the only failed network request across the whole session was `favicon.ico` (pre-existing, unrelated to this change — this app has no favicon configured).
- State touched during validation: switching the scratch server's active watchlist (to inspect Defence/Asmita) persists to `data/watchlists/index.json`, shared with the user's real server. Reverted the `activeWatchlist` field back to `asmita` (its value at session start) before finishing; confirmed via `git diff` that no other watchlist file was altered by this session — the pre-existing uncommitted changes across `data/watchlists/*.json`/`data/cache/**` visible in `git status` all predate this session (confirmed via `addedAt`/`updatedAt` timestamps and file mtimes hours-to-weeks earlier), unrelated local activity this session did not touch.
- Not able to test on every real-world screen size/browser (only Chrome, 1600×1000, headless) — the underlying fix (bounded scroll container + `top:0` sticky) is a standard, widely-deployed CSS pattern rather than a fragile pixel-tuned one, so it is expected to hold across viewport sizes, but a live check at additional breakpoints (900px/540px, this app's own existing responsive tiers) was not performed this pass.

**Watchlist Research scrolling architecture reconsidered validation detail**:
- `node --check script.js` clean; `node --test`: all 109 tests / 36 suites pass, unaffected (no analytics/scoring/decision/quant module touched — this pass is `script.js`/`styles.css` only).
- A from-scratch minimal repro (outside the app, in the scratch directory) established the CSS ground truth before writing any implementation: `position:sticky` on `thead th` failed in every variant tested — `.scroll{overflow:auto}` (the prior bounded-box configuration's un-bounded ancestor form), `overflow-x:auto;overflow-y:visible` (split axes), a `.card{overflow:hidden}` ancestor, and — the deciding case — zero overflow ancestors anywhere on the page at all, with `border-collapse:separate`. A second repro confirmed `position:fixed`, appended outside those ancestors, stays pinned regardless (the mechanism the floating-header clone relies on). A third repro reproduced the actual production shape (header/subtabs bars + 3 realistic tables, `.scroll{overflow-x:auto}` only) and confirmed sticky fails there too, ruling out the simplest form of "Option A" cleanly rather than by inference from the isolated repros alone.
- Validated against a second server instance on a scratch port (4191, never the user's own dev server on 4173), via `puppeteer-core` driving the system's real installed Chrome (installed only in a scratch directory outside the repo, same zero-dependency discipline as every prior pass) — not jsdom, for the same reason as the prior pass (this is real-browser layout/CSS behavior jsdom cannot observe).
- **Scroll-context count**: zero elements with `overflow-y:auto|scroll` and `scrollHeight > clientHeight` found on Watchlist Research at three viewport heights (600px/900px/1400px) — down from 1 bounded scrollbox per visible table in the prior implementation.
- **Depth-aware positioning**: a table nested two `.subtab-root` levels deep (`#profitability-table`, `.thead-sticky-3`, Fundamentals → Quality → Profitability) showed exactly one floating header, positioned at `headerH + subtabsH×3` (measured: 210 + 55×3 = 375px), correctly stacked below all three real sticky nav bars (measured at top 210/265/320, each 55px tall) with zero overlap.
- **Column alignment**: sampled 6 columns' floating-clone `<th>` left edge vs. the real first body row's `<td>` left edge — exact pixel match both at rest and after setting the real `.scroll` container's `scrollLeft` to 300px (clone tracked via its `transform:translateX()` sync).
- **Sorting via the clone**: dispatching a click on the floating clone's "CMP" header cell sorted the real table (30-row CMP column verified strictly ascending afterward), set `sorted-asc` on the *real* `<th>` (confirming sort state lives only in the real DOM, not a separate clone-side state), and the clone rebuilt itself showing the same `sorted-asc` class on its own next render — confirming it cannot desync from the real header.
- **Subtab switch while scrolled**: switching from Overview to Technicals mid-scroll correctly swapped which table's floating header was showing (Overview's header disappeared, Technicals → Trend's header appeared) with no frame showing zero or two headers at once.
- **Real mouse-wheel scroll** (`page.mouse.wheel`, 25 ticks): page `scrollY` advanced naturally to the page's actual end and stayed there (not trapped inside any nested box); never more than one floating header visible across the whole walkthrough. `PageDown` also advanced the page. No `.floating-thead` descendant has `tabIndex >= 0` (no keyboard trap).
- **Mobile breakpoint** (540×900, this app's own existing tier): floating header shown, fully contained within the narrow viewport (`left ≥ 0`, `left + width ≤ innerWidth`).
- **Test-isolation finding, not a product bug**: an early pass of this validation showed the floating header failing to appear on some scenarios; root-caused to this app's own by-design `localStorage` subtab-persistence (`subtab:<tabId>`) leaking between test scenarios that shared one browser profile/origin — an earlier scenario's subtab selection (e.g. Fundamentals → Quality) was still active when a later scenario's fresh page loaded, hiding the Overview table the test expected to measure. Not an application defect (a real user reloading mid-session correctly keeps their last subtab, by design); fixed by giving each validation scenario its own isolated browser context.
- Company Research's scrollspy/nav mechanism (untouched by this change) confirmed still functional as a regression check — 7 nav links present, clicking one still sets a real `.active` link.
- Zero duplicate DOM ids (checked with a floating header actively shown). The only console message across the whole session was the pre-existing, unrelated `favicon.ico` 404 (this app has no favicon configured).
- No incidental writes to shared data this pass: confirmed via `git diff` that `data/watchlists/index.json`'s `activeWatchlist` field is unchanged (no watchlist-mutating route was ever called against the scratch server this pass, unlike the prior pass which did switch watchlists and had to revert it).

**Company Research one-page redesign + Watchlist Research data-parity pass validation detail**:
- `node --check script.js` clean (the only `.js`/`.mjs` file touched by this change).
- `node --test`: all 109 tests / 36 suites pass, unaffected (no analytics/scoring/decision/quant module touched).
- Live cache-only `GET /api/watchlists/banking/research` (second server instance, scratch port 4179, never the user's own dev server) inspected directly: `recommendation.companyQuality/.stockAttractiveness/.fundamentalView/.marketView/.actionGuidance`, `quantFactors.factorScore`, `performance.cagr['3Y'/'5Y']`, `performance.riskAdjusted.sharpeLike/.sortinoLike`, `relativeValuation.peerTier/.peerCompleteness/.sectorRank/.relativeAttractivenessScore`, `researchQuality`, `forwardFramework.forwardEstimates`, and `intelligence.thesis[symbol]` all populate with real, correctly-shaped values for a real resolved company (HDFCBANK.NS) — confirming every field path this change reads matches the actual backend shape before touching the frontend.
- A `jsdom` harness (installed in the scratch directory only, same no-`package.json` discipline as every prior phase's validation) loaded the real `index.html`/`script.js` against the scratch server: all unique `$('#id')` selectors in `script.js` resolved against `index.html` (zero misses), zero duplicate DOM ids across the whole document, zero console errors (including `unhandledrejection`) through a full walkthrough — switching to the Banking watchlist, activating Company Research, confirming all 6 new/changed section targets (`cr-overview-content`, `cr-key-metrics-content`, `cr-quality-content`, `cr-growth-content`, `cr-intelligence-content`, `technical-detail-relative-performance`) render real non-empty content (spot-checked text content: Snapshot showed "Composite score49/100 Upside to target+22.18% ... Risk score54/100 ActionHold" for HDFC Bank, Quality showed the real Company Quality/Stock Attractiveness card, Intelligence showed real Thesis tracking content), all 7 anchor-nav links resolve to an existing section and are clickable without throwing, and Watchlist Research's 4 extended tables render the correct new header/cell counts (Overview 13→16 columns, Valuation 16→19, Relative strength 8→10, Risk matrix 14→15) with real, non-N/A values in the first row (e.g. a real Sector rank "2/8", Relative attractiveness "48/100", Peer completeness "Strong", Thesis status "Intact").
- A second `jsdom` pass confirmed Compare Mode (3 companies) renders zero console errors and a `.compare-grid` in every new/changed section, including the Intelligence section's 4 independent grids (thesis/factor/research-quality/forward), matching the existing `compareGrid()` mechanism's established pattern.
- State touched during validation: the watchlist-switching walkthrough (run against the second server instance, which shares `data/watchlists/*.json` with the user's real server) left `activeWatchlist` pointing at `banking` instead of its original `asmita`; reverted via the same `POST /api/watchlists/active` route a real client would use, confirmed back to `asmita` via `git diff`. No watchlist was created, deleted, or mutated in any other way; `git diff`/mtimes confirmed the remaining uncommitted changes in `data/watchlists/{asmita,defence,test}.json` predate this session by 1+ weeks (unrelated prior user activity, not touched by this validation).
- Not re-verified with a real browser screenshot (no `chromium-cli`/Playwright available in this pass) — relied on the same jsdom-against-real-server technique this repo's own validation notes have used as the standard fallback since Phase 4.

**Scrolling/table-usability audit + Technicals raw-indicator parity + Company Research UI redundancy removal validation detail**:
- `node --check script.js` clean (the only `.js`/`.mjs` file touched this pass).
- `node --test`: all 109 tests / 36 suites pass, unaffected (no analytics/scoring/decision/quant module touched).
- Live cache-only `GET /api/watchlists/banking/research` (second server instance, scratch port 4183, never the user's own dev server) inspected directly for HDFCBANK.NS: `technicalScorecard.{adx,diPlus,diMinus,atr,atrPct,obv,accDist}`, `macd.{macdLine,signalLine,histogram}`, `support`/`resistance`/`atHigh` all populate with real, correctly-shaped, non-`NaN` values — confirming every new column's field path before touching the frontend.
- A `jsdom` harness (installed in a scratch directory outside the repo, same no-`package.json` discipline as every prior pass) loaded the real `index.html`/`script.js` against the scratch server: zero duplicate DOM ids across the whole document, zero console/window/unhandledrejection errors through the full walkthrough below.
  - **New Technicals columns**: Trend/Momentum/Volume/Volatility tables render the expected new header + cell counts (Trend 11→16 columns, Momentum 7→10, Volume 7→11, Volatility 6→8); spot-checked a real row (Apollo Micro Systems: ADX 7.14, Support 307.46, Resistance 450.05, all non-N/A).
  - **Sorting**: clicked the Trend table's ADX header three times — 1st click sorted 30 rows into strict ascending numeric ADX order (7.14 → 60.31, verified programmatically, not just visually), header gained `sorted-asc`; 2nd click reversed to strict descending, `sorted-desc`; 3rd click restored the exact original (natural watchlist) row order and cleared both classes. Repeated with the active company set beforehand — `tr.active-company-row` highlighting survived the sort-triggered re-render. Nested-table sorting (Profitability, 2 levels of `.subtab-root` deep) rendered correctly with its `thead-sticky-3` class intact.
  - **Company Research UI removal**: `#quick-jump`, `#compare-toggle`, `#compare-chip-row`, `#valuation-selector` and `.company-switcher-wrap` all confirmed absent from the live DOM post-change; `.cr-page-nav` still renders all 7 section anchors; the header's `#company-selector-toggle` dropdown opens, lists every company, and correctly drives `setActiveCompany` on click (verified switching to a second company end-to-end); on the Compare workspace, `#compare-enable-btn` correctly toggles its own label/state both ways ("Turn on" ↔ "Turn off Compare Mode") across two clicks, confirming Compare Mode's on/off functionality survived the removal of the header's separate toggle.
  - jsdom has no layout engine (`offsetHeight` is always 0), so the `--header-h`/`--subtabs-h` pixel arithmetic and the resulting stacked-sticky-header *visual* correctness could not be verified this way — verified instead by static reasoning over the CSS (each nested level's `top` offset is strictly additive and matches the number of real nav bars stacked above it) and by confirming the CSS resolves the intended selectors/values (no typo, correct `calc()` syntax). Real-browser (Playwright/`chromium-cli`) confirmation of pixel-level sticky-stacking was not available in this pass — same disclosed limitation as every prior phase's validation note when that tooling wasn't available.
- State touched during validation: none persisted — this pass only issued `GET` requests plus in-page DOM events against the scratch server instance; no watchlist-mutating route was called. The scratch server (port 4183) was stopped at the end of validation; confirmed no `server.mjs` process remained running afterward.
- `node --check` clean on `script.js`, `data/watchlist/research.mjs`, `data/metadata/metricRegistry.mjs`.
- `node --test`: all 109 tests / 36 suites pass, unaffected (no analytics/scoring module touched — the new/enriched fields are payload wiring and frontend-only derivations).
- Live cache-only `GET /api/watchlists/power/research` (second server instance, scratch port 4179, never the user's own dev server) inspected directly: `avgVolume20`, `stock.momentum`, `stock.volatilityPct`, `stock.performance.periods['1Y']`/`.benchmark`, `stock.technicalScorecard.signalConfidence`/`.adxInterpretation`, and `stock.valuation.confidenceBand` all populate with real, non-`NaN`/non-`undefined` values across all 7 resolved companies in the Power watchlist; the one pre-existing genuinely-unresolved company (`PGCIL.NS`, TD-2, unrelated to this change) correctly renders every field `undefined`/N/A, same as before this change.
- Hand-verified the new derived cells against the raw payload for `NTPC.NS`: CMP 330.9 vs. 20-DMA 340.74 renders "340.74 (-2.89%)" ((330.9-340.74)/340.74 = -2.888% ✓); DMA alignment renders "0/4 above" (price below all 4 DMAs, consistent with its "Downtrend" label); Relative Strength row renders stock +0.03%, benchmark -1.67%, relative strength +1.7% (0.03 − (−1.67) = 1.70 ✓), benchmark "NIFTY 50"; Momentum row renders RSI 34.3 → state "Weak" (< 45 threshold, per the existing `momentumLabel()` function, unmodified).
- A `jsdom` harness (installed in the scratch directory only, same no-`package.json` discipline as every prior phase's validation) loaded the real `index.html`/`script.js` against the scratch server and drove the full new nav: Overview's screening matrix and Ranking table both render 8/5 rows; Fundamentals defaults to Valuation (8 rows), clicking Quality correctly hides Valuation and shows Quality's own nested default (Profitability, 8 rows), clicking Balance sheet within Quality correctly hides Profitability and shows Balance sheet (8 rows) while the outer Valuation panel stays correctly hidden throughout — confirming the 2-level nested `.subtab-root` mechanism (exercised 2 levels deep for the first time in this app) works with zero changes to `applySubtabState()`/`initSubtabs()`; Growth renders 8 rows; Technicals' Trend/Relative strength/Signals tables render real rows including the "Breakout score" header rename; Risk & Opportunity defaults to Risk overview (7 rows, matching 7 resolved companies) and Opportunities/Alerts both render real content when clicked. Zero console errors, zero duplicate DOM ids across the whole document.
- State touched during validation (none — this pass only read via `GET`, no watchlist switch/mutation route was called) required no revert; confirmed via `git diff`/mtimes that no data file changed as a result of this session's checks.
- Not touched, per the task's explicit scope: `report.js` still uses the phrase "Breakout probability" in one line of its own institutional report page — a different, standalone page outside this task's "Watchlist Research only" boundary, flagged here as a known follow-up rather than silently expanded into.

**Company Context scoping correction validation detail**:
- `node --check script.js` clean (the only `.js`/`.mjs` file touched — this fix made zero backend changes).
- `node --test`: all 109 tests / 36 suites pass, unaffected (this fix touches no analytics/scoring module).
- A `jsdom` harness (installed in the scratch directory only, same no-`package.json` discipline as every prior phase's validation) loaded the real `index.html`/`script.js` against a second live server instance on a scratch port (4179, never the user's own dev server on 4173) and drove every sidebar workspace: confirmed `#company-context-bar`/`#company-context-label` are hidden by default (Dashboard, the default tab), stay hidden on Watchlists/Watchlist Research/Portfolio Analysis/Reports/Market Intelligence/Compare, and are shown only on Company Research (both on first visit and after navigating away and back). Confirmed `#wr-watchlist-context`/`#portfolio-watchlist-context` populate with real data ("Power · 8 companies") and update correctly on a real watchlist switch (`Power · 8 companies` → `Core Portfolio · 6 companies`, driven through the actual `#watchlist-select` `change` handler, not simulated). Zero console errors and zero duplicate DOM ids throughout. The watchlist switch performed during validation was reverted to its original value before the check exited; confirmed via `git diff`/file mtimes that no data file was left in a different state than before this session's validation began (the pre-existing uncommitted `data/watchlists/*.json`/`data/cache/**` changes visible in `git status` all predate this session by 1–12 days, per file mtimes — unrelated local user-session state, not touched by this validation).
- Not re-verified with a real browser screenshot (no `chromium-cli`/Playwright available in this pass) — relied on the same jsdom-against-real-server technique this repo's own validation notes have used as the standard fallback since Phase 4 whenever headless-Chromium tooling wasn't available.

**Phase 4 Stage 1+2 validation detail** (both stages' combined validation, run together since Stage 1 had not yet been exercised end-to-end through a UI):
- `node --check` clean on all 7 `data/decision/*.mjs` files, `data/watchlist/snapshotCache.mjs`, the modified `research.mjs`/`store.mjs`/`diskCache.mjs`/`metricRegistry.mjs`, `server.mjs`, and `script.js`.
- Live cache-only `GET /api/watchlists/:id/research` checked for Banking, Power, Defence, Core Portfolio and one mixed watchlist ("Sameer") — `intelligence` populated in every case with zero `NaN`/`undefined`, response time 185–300ms (up from the 07.4 baseline's 40–80ms cache-only figure; the added cost is one extra disk read/write per request for the snapshot cache plus the decision-layer composition pass — acceptable for a single-user local tool today, but flagged here as a real regression against the 07.4 baseline for Stage 3 to look at, e.g. whether the snapshot write can be made conditional on an actual refresh rather than attempted every cache-only read).
- No headless-browser tooling (Playwright/`chromium-cli`) is available in this Windows environment and this project is intentionally dependency-free (no `package.json`, no npm). Validated instead with a `jsdom`-based harness (installed only in a scratch directory outside the repo, never added to the project) that loads the real `index.html`/`script.js` against the real running server and drives clicks exactly as a browser would: every `$('#id')` reference in `script.js` (117 total) resolves against `index.html` with zero misses; full click-through of Dashboard → Portfolio Intelligence, Dashboard → Committee View, Portfolio → Health & Rebalancing, Risks → Alerts (including the severity filter chips and an acknowledge → disappear round-trip against the real `PUT` route), and Watchlists' new columns/filter chips — across Banking, Power, Defence, Core Portfolio and Sameer — with zero console errors captured in every run. A 375px-viewport pass (existing responsive CSS, unmodified) also produced zero errors. Alerts acknowledged during this harness run were explicitly un-acknowledged afterward via the same route so no test residue was left in the user's real watchlist data (`acknowledgedAlertIds` confirmed empty again in every touched watchlist file).
- Company-context synchronization confirmed: clicking a company link inside the new Action Required table updates the shared header company selector, same as every other table on the page.
- No `system.md`/`CLAUDE.md` changes made — neither stage altered a module boundary beyond what Stage 1 already introduced (`data/decision/`, `snapshotCache.mjs`, the new alerts route), and per the user's explicit 3-stage plan that documentation lag is intentional, deferred to Stage 3.

**Phase 4 Stage 3 validation detail**:
- `node --check` clean on all 7 `data/decision/*.mjs` files, `data/watchlist/{research,store,snapshotCache}.mjs`, `data/metadata/metricRegistry.mjs`, and `script.js`.
- **Performance**: re-measured cache-only `GET .../research` in-process (Node `fetch`/`performance.now()`, 8 requests per watchlist after warmup — the earlier curl-based method used to record 185-300ms carries ~120-150ms of its own git-bash/Windows process-spawn overhead per invocation and was not a valid comparison at this scale). Results: core-portfolio 41.6ms, banking 54.5ms, power 43.4ms, defence 43.3ms, sagar 52.0ms, sameer 24.0ms — all back within the pre-Phase-4 07.4 baseline (40-80ms cache-only), down from the 185-300ms Stage 1+2 figure. Confirmed via file mtime that a cache-only request no longer touches `data/cache/watchlistSnapshots/*.json` at all.
- **Calibration sanity check**: pulled `intelligence.alerts`/`actionScores` distributions across all 6 watchlists post-calibration. No `NaN`/`undefined` anywhere. Severity skewed toward Critical in several watchlists (e.g. Banking: 4 Critical/1 High) — inspected the underlying alerts individually and confirmed this reflects genuinely extreme real conditions in the cached data (P/E at the 0th/100th percentile of its own history, 100% single-sector concentration in the sector-themed watchlists, pre-existing >20-30% margin-of-safety breaches), not a miscalibrated threshold firing on ordinary readings. `capped` (Action Score's new resolved-coverage cap) was 0 across all 6 watchlists, as expected — every seeded watchlist has fully-fetched company data today, so the cap only matters for a partially-resolved company, which the logic was exercised against via code review rather than live data (no currently-unresolved company exists in any of the 6 watchlists to trigger it live).
- **Alert lifecycle**, tested live against the running server (Banking watchlist):
  - Acknowledge → suppressed → confirmed still suppressed on a subsequent cache-only re-GET → un-acknowledge → reappears. One bug found and fixed during this pass: a snapshot file written before Stage 3 has no `alertLifecycle` key, and treating that as "nothing was firing" broke acknowledgement entirely for any watchlist not actively refreshing (every acknowledged alert looked like a false re-trigger and was never suppressed). Fixed with a one-time migration write per watchlist (`!hasLifecycleBaseline` in `data/decision/index.mjs`) that establishes the baseline without touching company/portfolio data, after which the fast-path (`anyAdvanced`-only gating) applies normally.
  - Severity escalation: manually backdated one alert's persisted first-detected time by 8 days (`ALERT_LIFECYCLE.escalateAfterDays` default is 7) and confirmed its severity bumped High → Critical and `detectedAt` reflected the true first-detected time rather than "now."
  - Re-trigger: acknowledged an alert, manually cleared its `alertLifecycle.firing` entry to simulate the condition having resolved and recurred, confirmed the alert reappeared unsuppressed and its id was pruned from the watchlist's `acknowledgedAlertIds`.
  - `removeCompany`'s stale-alert-id prefix-prune and the new `pruneAlertAcknowledgements` batched writer were exercised directly against a disposable temp watchlist (created, tested, deleted — never touched real watchlist data).
  - A genuine targeted refresh (`POST .../refresh` with `symbols: ['DIXON.NS']`) confirmed the snapshot file's `savedAt`/`fetchedAt` actually advance on a real refetch, and a subsequent cache-only re-GET reused the same (empty, in this case) diff rather than clearing it.
- **Browser validation**: no leftover jsdom harness from Stage 1+2 existed in this session; reinstalled `jsdom` in a scratch directory (outside the repo, same no-`package.json` discipline) and re-ran the same load-real-`index.html`/`script.js`-against-the-real-server approach. All 111 unique `$('#id')` selectors in `script.js` resolved against `index.html`; Risks → Alerts rendered 6 rows with Critical/High/Medium severity tags (all covered by the existing `SEVERITY_TAG_CLASS`, so the new severity tiers needed zero frontend change); Dashboard → Portfolio Intelligence rendered its action-required rows; zero console errors (including `unhandledrejection`) throughout.
- Server console watched throughout every check above — zero errors logged.
- Any state touched during validation (acknowledgements, the temp watchlist, a manually-edited snapshot file, and — found only at the end — the active-watchlist pointer, which creating/deleting the temp watchlist had reset from `sameer` to `core-portfolio`) was reverted afterward; confirmed `git diff` on every real watchlist file shows only expected `updatedAt` bumps and the pre-existing Stage 1/2 lazy-defaulted fields, nothing else.

**Phase 5 validation detail** (staged in 3 sub-stages — decision-layer foundations, per-company report upgrade, Portfolio Review Pack + integration — each validated before the next started, same discipline as Phase 4):
- `node --check` clean on every touched/new file: `data/analytics/portfolio.mjs`, `data/scoring/ratings.mjs`, `data/decision/{config,thesisTracking,index}.mjs`, `data/news/companyNews.mjs`, `data/metadata/metricRegistry.mjs`, `data/reporting/{researchReport,portfolioReviewPack}.mjs`, `server.mjs`, `report.js`, `portfolio-review.js`, `script.js`.
- **Stage 1 (decision layer)**: live cache-only `buildResearch()` checked directly (not just over HTTP) across Core Portfolio/Banking/Power/Defence/Sameer — `intelligence.thesis` populated for every resolved company with zero `NaN`/`undefined`; `portfolio.qualityAttribution`/`.valuationAttribution` confirmed to carry the new full `contributors` array alongside the unchanged `topPositive`/`topNegative` (script.js's own consumption of those two fields re-checked to confirm it never reads `contributors`, so the widening is additive); `portfolio.positionConcentration.contributions` confirmed to sum sensibly (equal-weighted watchlists showed `hhiContributionPct` == `weightPct` per position, the expected identity when all weights are equal).
- **Catalyst taxonomy**: live-tested `fetchCompanyNews()` directly against Google News RSS for several real companies (HDFC Bank, Reliance Industries, Tata Motors, Yes Bank) — found and fixed a real pre-existing regex bug in the process: `CATALYST_TYPES`' patterns wrote `\bfirst|middle|last\b` without a grouping `(?:...)`, so only the first and last alternatives were word-boundary-anchored and every middle keyword (e.g. `ipo`) matched as a raw substring anywhere in the title, including inside unrelated source names (`"...- IndiaIPO"` was misclassified as a Capital allocation catalyst before the fix). Fixed by wrapping every pattern's alternation in `(?:...)` with `\b` only on the outside; re-verified against the same live headlines post-fix (`IndiaIPO` headline reclassified to `General`, `Q1 results` headlines correctly classified `Earnings`, etc.). This bug pre-dated Phase 5 (the same construction existed in the original 8-type taxonomy) but was fixed in the same change since it directly undermines the new institutional catalyst framework's accuracy.
- **Stage 2 (per-company report)**: live `GET /api/watchlists/:id/report/:symbol` over HTTP confirmed all 5 new top-level fields present (`thesisTracking`, `targetPriceRationale`, `scenarioAnalysis`, `portfolioContext`, `explainability`); a jsdom harness (installed in a scratch directory outside the repo, same discipline as Phase 4's own validation) loaded the real `report.html`/`report.js` against the real running server for 6 companies spanning DCF-model, financial-sector-model (banks), and no-resolved-model cases (`ADANIPOWER.NS`) — all rendered the full 15 sections with zero console errors in every case, including graceful "not available" degradation (no fabricated sensitivity grid or margin assumption) for banks and unmodeled companies.
- **Stage 3 (Portfolio Review Pack)**: live `GET /api/watchlists/:id/portfolio-review` checked across Core Portfolio/Banking/Power/Defence/Sameer — zero `NaN`/`undefined`, real portfolio figures (beta, weighted averages, health score/contributors, top opportunities/risks, action priorities, rebalancing) all populated. Same jsdom harness pattern confirmed all 9 pack sections render with zero console errors across every watchlist. A full-dashboard jsdom harness (loading real `index.html`/`script.js` against the real server, same pattern as Phase 4's own) confirmed: all `$('#id')` selectors resolve (zero misses), both new buttons (`wl-portfolio-review-btn`, `cv-portfolio-review-btn`) exist and are wired, clicking each calls `window.open('portfolio-review.html?wl=<active watchlist>')` with the correct id, and zero console errors during initial load and both clicks.
- No headless-browser tooling (Playwright/`chromium-cli`) is available in this Windows environment and this project remains intentionally dependency-free (no `package.json`, no npm) — `jsdom` was installed only in the scratch directory, never added to the project, matching the exact precedent set by Phase 4's own validation.
- Actual print/PDF rendering (as opposed to DOM/console correctness) was not re-screenshotted for the new pages — `portfolio-review.html` reuses `report.html`'s already-validated `@media print` block and `beforeprint`/`afterprint` JS handling verbatim (same CSS classes, same section chrome), so the print path relies on that prior validation rather than a fresh one. Flagged here as a known gap, same category as 04.2's "on-screen paged-media pagination" being explicitly out of scope.

**Phase 6 validation detail**:
- `node --check` clean on all 18 new/modified files: `data/providers/{macroProvider,index}.mjs`, `data/decision/{marketRegime,exposureMatrix,config}.mjs`, `data/watchlist/{macro,diskCache,sectorIntelligence,research}.mjs`, `data/analytics/{exposureRules,earningsAnalytics,eventCalendar}.mjs`, `data/news/companyNews.mjs`, `data/reporting/committeePack.mjs`, `data/metadata/metricRegistry.mjs`, `server.mjs`, `script.js`, `committee-pack.js`.
- Live checks against a second server instance on a separate port (never touching the user's own running dev server on 4173, which shares the same on-disk `data/` files): `GET /api/macro` confirmed all 6 real indicators fetched live and disk-cached under `data/cache/macro/`; `GET /api/sector-intelligence` confirmed 57 distinct companies deduped across all 8 real saved watchlists into 15 sector rollups; `GET /api/watchlists/:id/committee-pack` confirmed all 9 model sections populate. A byte-level scan of `research` payloads across all 8 real watchlists (Core Portfolio/Banking/Power/Defence/Asmita/Sagar/Sameer/Test) found zero genuine `NaN` (4 "NaN" substrings found in Asmita's payload were coincidental base64 fragments inside Google News RSS article-id URLs, confirmed by inspection, not numeric errors) and correctly-absent `earningsIntelligence` on exactly the one pre-existing unresolved company (Power watchlist's `PGCIL.NS`, TD-2 — never fetched, so no quarterly data exists to compute deltas from).
- A jsdom harness (installed in the scratch directory only, same no-`package.json` discipline as every prior phase's own validation) loading the real `index.html`/`script.js` against the real running server: confirmed zero missing `$('#id')` selectors, clicked through every top-level tab and every sub-tab (including all 3 new Dashboard sub-tabs, the new Portfolio sub-tab, and the rebuilt Earnings & Events sub-tab), switched across 4 real watchlists, confirmed Morning Briefing renders as the Dashboard's default (first, active) sub-tab with real content, and confirmed the new Weekly Committee Pack button opens `committee-pack.html?wl=<active watchlist>` — zero console errors throughout, repeated at a 375px viewport with identical results. The standalone `committee-pack.html`/`.js` page was separately loaded and confirmed to render all 8 sections with zero console errors.
- One real bug was found and fixed during this validation, not after: the Macro/Sector Intelligence panels' info icons initially read `currentData.metricMeta` before the watchlist research payload had necessarily loaded (macro/sector fetches are lighter and often resolve first), rendering blank on first paint. Fixed by also re-rendering both panels from the main `render(data)` cascade (same pattern the Phase 4 Portfolio Intelligence panel already uses), not just from their own fetch callbacks.
- A second real bug was found and fixed: the Sector Intelligence coverage-gap check's client-side "Banking" keyword pattern (`/bank/i`) did not match this app's real sector label for banks ("Financial Services"), which would have falsely reported Banking as uncovered despite 12 real bank holdings. Fixed by aligning every priority-sector pattern with the exact regexes `institutionalRisk.mjs`'s `SECTOR_RISK_RULES` already uses server-side, so the two can never disagree.
- State touched during validation was reverted: the watchlist-switching walkthrough (run against the second server instance, which shares `data/watchlists/*.json` with the user's real server) left `activeWatchlist` pointing at a different watchlist than before testing started — confirmed via `git diff` and reverted via the same `POST /api/watchlists/active` route a real client would use, back to its original value. No watchlist was created or deleted during validation; the one real-data refresh triggered (`POST .../refresh` on one symbol, to exercise the new sentiment/affected-thesis-driver fields on a fresh fetch) is a legitimate refresh, not test residue, and was left as-is.
- Not yet exercised live: a genuinely "Unavailable" macro indicator (this session's Yahoo fetches all succeeded) and a "Delayed" macro indicator (would require a fetch failure with a pre-existing stale cache entry) — both code paths were reviewed, not live-triggered. Actual print/PDF rendering of `committee-pack.html` was not re-screenshotted, for the same reason noted in the Phase 5 entry above (it reuses `report.html`'s already-validated print CSS/JS verbatim).

**Phase 6.5 validation detail**:
- `node --check` clean on `script.js` (the only `.js`/`.mjs` file touched — this phase made zero backend changes).
- No headless-browser tooling ships with this environment by default; unlike prior phases' jsdom-only fallback, a real Chromium was available this time via Playwright, installed only in the scratch directory (never added to the project — no `package.json`/npm dependency introduced here, same zero-dependency discipline). A full Playwright script drove the real `index.html`/`script.js`/`styles.css` against the real running dev server (port 4173, read-only — no watchlist mutation occurs anywhere in this phase, so no state needed reverting afterward): all 9 sidebar workspaces opened with non-empty content; the Research category bar's all 6 categories switched correctly with the sidebar's "Research" item staying highlighted; Market Intelligence's 4 relocated sub-tabs rendered their real data (macro indicators, sector rollups, earnings tables, news items) unchanged from their old Dashboard location; Reports' 3 buttons present and wired; Compare Mode enabled, 2 companies selected, and the Valuation/Technical/Risk comparison panels populated with real content (screenshotted); sidebar collapse produced a 64px icon-only rail; at a 375px viewport the header hamburger opened/closed an off-canvas drawer (backdrop-click-to-close confirmed); no horizontal overflow at 768/1280/1800px. 34/34 automated assertions passed, zero browser console errors, zero page errors, across two full runs (one before, one after a mid-validation CSS fix — see below).
- **Bug found and fixed during validation**: the new Reports workspace's "active company" label used `class="kpi small"`, and `.kpi`'s `font-size:29px;font-weight:800` rule (defined later in `styles.css` than `.small`) won the cascade, rendering the company name as oversized wrapped text instead of a small label. Fixed by dropping the `kpi` class; re-screenshotted to confirm.
- **Performance**: a dedicated network-request listener confirmed switching through all 9 sidebar workspaces plus all 6 Research categories fires **zero** HTTP requests — tab/category switching is pure DOM visibility toggling, matching the pre-Phase-6.5 baseline exactly (no regression, per the brief's explicit performance constraint).
- Not re-verified: actual print/PDF output of the 3 report pages (unchanged by this phase — only their launch points moved) and full keyboard-navigation traversal of the sidebar (structurally identical button-list pattern to the old `.tabs` nav's already-validated keyboard behavior, not independently re-tested).

**Phase 7 Stage 1 validation detail**:
- `node --check` clean on all 4 new/modified files: `data/quant/config.mjs`, `data/quant/factorEngine.mjs`, `data/watchlist/research.mjs`, `data/metadata/metricRegistry.mjs`.
- Live `buildResearch()` (direct function call, not just HTTP) checked cache-only across all 8 real saved watchlists (Core Portfolio, Banking, Power, Defence, Test, Sagar, Sameer, Asmita — 6 to 30 companies each, spanning IT/Banking/Power/Defence/FMCG/Realty/Metals/Healthcare/Auto sectors and one ETF with no sector): zero `NaN` and zero literal `undefined` in every serialized `quant`/`quantFactors` payload across all 72 real companies. Coverage-floor gating confirmed correct on real data: companies with genuinely thin fundamentals data (e.g. `TATAPOWER.NS`, `GRSE.NS`, several newly-added Asmita names) resolved only 2/6 categories and correctly had `factorScore: null` with a disclosed `capNote`, rather than a misleadingly confident score off partial coverage. Sector-vs-watchlist normalization-scope fallback confirmed live: Banking (8 same-sector peers) and Defence/Power (4+ same-sector peers) resolved every sub-metric at `sector` scope with `High` confidence; Core Portfolio and Sameer (mixed-sector, no sector with 4+ members) correctly fell back to `watchlist` scope at `Medium` confidence; the single-company Test watchlist correctly rendered `scope: 'none'`, every metric "insufficient data," `factorScore: null`.
- Spot-checked the actual arithmetic by hand against the live HTTP response for TCS.NS (Core Portfolio, watchlist-scope, 6 peers): P/E 15.9 ranked at the 60th percentile of the 6-company peer set (60% of peers have P/E ≤ 15.9), correctly inverted to a normalized score of 40 (expensive-relative-to-peers scores low on Value, "lower-better" direction disclosed) — confirms the percentile/inversion math matches `portfolio.mjs`'s pre-existing `factorExposure()` convention exactly, byte-for-byte the same formula reused, not reimplemented differently.
- `evEbitda`, `ebitdaGrowth` and `fcfGrowth` sub-metrics confirmed rendering an explicit `status: 'unavailable'` with a disclosed `reason` (no Enterprise Value/Cash/Net-Debt or multi-year FCF series in this app's data source — same root limitation already disclosed on `evEbitdaPercentile` in `metricRegistry.mjs`) rather than a fabricated or estimated value, across every watchlist.
- **Performance**: cache-only `buildResearch()` re-measured in-process (same methodology as Phase 4 Stage 3's own re-measurement — Node `performance.now()`, 8 requests after 3 warmup calls) on Core Portfolio: 38.7–45.3ms, avg 41.9ms — within the pre-existing 40–80ms cache-only baseline, no regression from adding the factor engine to the per-request composition pass.
- Live HTTP check against a second server instance on a scratch port (`GET /api/watchlists/core-portfolio/research`): confirmed `research.quant` and every `stocks[i].quantFactors` field serializes correctly over the wire, matching the direct-function-call results exactly.
- No UI changes this stage (by design, same staged-rollout discipline as Phase 4 Stage 1 — backend/data-model only); no Playwright/jsdom walkthrough needed since no DOM was touched. `docs/authoritative/system.md` (new §3.9, §1.3/§7 module tables, §8 module-boundary rule) and `CLAUDE.md` (§5 repo map) updated in this same change.

**Phase 7 Stage 2 validation detail**:
- **Audit performed before implementation** (per the stage brief's mandatory §2): confirmed live in code that the NIFTY 50/S&P 500 weekly series is already fetched once per market and disk-cached (`data/watchlist/research.mjs`'s `loadBenchmarkQuote()` → `benchmarkCache`, `data/cache/benchmarks/_NSEI.json` — 262 weekly points, ~5 years), that a real beta calculation already exists (`data/analytics/dcf.mjs`'s `beta()`, covariance/variance over aligned weekly returns), that realized volatility and max drawdown already exist (`data/analytics/priceSeries.mjs`'s `annualizedVolatilityPct()`/`maxDrawdownPct()`), and that a proxy Sharpe ratio already exists (`portfolio.mjs`'s `riskAdjustedReturnScore()`). No second fetcher, cache, beta, volatility or drawdown-magnitude implementation was created — all four are read/reused as-is; only the genuinely missing capabilities (multi-period return/CAGR, drawdown recovery dates, a Sortino-like ratio, and the benchmark-relative/weight-aggregated composition of all of these) were built.
- `node --check` clean on all 6 new/modified files: `data/quant/performanceEngine.mjs`, `data/quant/config.mjs`, `data/analytics/portfolio.mjs`, `data/analytics/priceSeries.mjs`, `data/watchlist/research.mjs`, `data/metadata/metricRegistry.mjs`.
- **Mathematical validation** (direct `buildResearch()` calls, not HTTP): CAGR cross-checked by hand against the period-return figure for 4 real companies spanning very different outcomes — TCS.NS (5Y return −33.67%, 5Y CAGR −7.89%: (1−0.0789)^5 = 0.663 → −33.7% ✓), NTPC.NS (197.85% / 24.41%: 1.2441^5 = 2.978 → 197.8% ✓), HAL.NS (793.01% / 54.99%: 1.5499^5 = 8.93 → 793% ✓), DIXON.NS (249.47% / 28.46%: 1.2846^5 = 3.4947 → 249.47% ✓ exact) — all four independently reconcile the CAGR formula against the period-return formula computed from a different code path (`periodReturnFrom` vs. `periodCagrFrom`), a genuine cross-check rather than the same code validating itself. Beta/volatility/max-drawdown values were spot-checked as unchanged from their pre-Stage-2 values (reused, not recomputed) across every sampled company.
- **Live checks across 5 real watchlists** (Core Portfolio 6, Banking 8, Power 8, Defence 7, Sameer 4 — cache-only `buildResearch()`, direct function call): zero `NaN`/`undefined`/`Infinity` in every serialized `stock.performance`/`portfolio.performance` object across all 33 companies; `performance` populated for every resolved company (Power's one pre-existing unresolved company, TD-2's `PGCIL.NS`, correctly carries `performance: null`, same pattern as its other fields). Benchmark resolved to NIFTY 50 (`^NSEI`, "available") for every company in all 5 watchlists (India-only holdings today).
- **Largest/thinnest-data watchlist** (Asmita, 30 companies): zero genuine `NaN` (6 "NaN" substring matches were coincidental base64 fragments inside Google News RSS article-id URLs, confirmed by direct inspection — the identical false-positive class already documented in the Phase 6 validation note, not a numeric error). The thinnest-history holding (`BHARATCOAL.NS`, 31 weekly points ≈ 7 months) correctly rendered 1M as `"ok"` and 5Y period/CAGR as `"insufficient-history"` with `null` values rather than an extrapolated figure — confirms the tolerance-gated `locateWindow()` refuses to stretch a short series into a long-period answer. Every `periods[key].status` across all 30 companies matched one of the 4 disclosed enum values (`ok`/`insufficient-history`/`benchmark-unavailable`/`benchmark-insufficient-history`) — zero unexpected status strings.
- **Live HTTP check** against a second server instance on a scratch port (never the user's own dev server, no watchlist mutation): `GET /api/watchlists/core-portfolio/research` confirmed `stock.performance`/`portfolio.performance`/`metricMeta.benchmarkPerformance` all serialize correctly over the wire, matching the direct-function-call results.
- **Regression checks**: Stage 1's factor engine unaffected (`research.quant`/`stock.quantFactors` still populate identically, e.g. TCS.NS `factorScore: 60.5` unchanged). `positionRiskContribution()`'s refactor (extracting `portfolioVolatilityPct()` from its internal loop) produces byte-identical output — contribution rows still sum to ~100% (100.00%, 100.02%) across Core Portfolio and Banking, and its exported shape (`[{symbol, name, riskContributionPct}]`) is completely unchanged, so every existing consumer (`script.js`, `report.js`, `portfolio-review.js`, `researchReport.mjs`, `portfolioReviewPack.mjs`, `rebalancing.mjs`) needed no changes and was not touched.
- **Performance — one real regression found and fixed during this stage's own validation, before shipping** (not after): the first implementation computed the benchmark-side period/CAGR/volatility/drawdown figures inside the per-stock loop, i.e. once per *company* instead of once per *market* — for an 8-company all-India watchlist, the NIFTY calculation was redone 8 times, violating the stage brief's own §18 performance-discipline requirement ("do not fetch NIFTY separately for every company"). Measured cache-only Core Portfolio at 76.9ms avg (vs. the 41.9ms Stage 1 baseline) before the fix. Root-caused via a micro-benchmark (isolated `stockPerformance()`/`benchmarkPerformanceProfile()` calls, 1000 iterations each, real TCS.NS/NIFTY cached data) to two issues: (1) the benchmark-side figures being recomputed per-stock instead of per-market (fixed by a new `benchmarkPerformanceProfile()`, computed once per market alongside the existing `benchmarkByMarket` load and reused across every stock sharing that market), and (2) each period/CAGR/drawdown lookup independently re-sorting and re-`Date`-parsing the same ~260-point series (7-8 times per call) — the exact anti-pattern `priceSeries.mjs`'s own `prepareSeries()`/`correlationFromPrepared()` was built to eliminate for the correlation matrix (documented in that file as ">90% of buildResearch's CPU time on a 6-company watchlist" before that earlier fix). Fixed by sorting/timestamp-tagging each series exactly once (`prepareAndSort()`) and reusing the prepared array across every lookup. Post-fix micro-benchmark: `stockPerformance()` 3.18ms → 0.34ms per call, `benchmarkPerformanceProfile()` 3.48ms → 0.40ms per call (≈9x). Post-fix re-measured cache-only averages (same 3-warmup/8-sample methodology): Core Portfolio 44.0ms (vs. 41.9ms baseline, +2.1ms), Banking 58.8ms (vs. 54.5ms Stage-3-era baseline, +4.3ms), Power 54.6ms (vs. 43.4ms, +11.2ms), Defence 53.8ms (vs. 43.3ms, +10.5ms), Sameer 32.0ms (vs. 24.0ms, +8.0ms) — a small, proportionate addition (roughly 1-1.5ms per company) for the genuinely new per-company/per-portfolio computation this stage adds, not a material degradation.
- **Data-quality/limitations disclosed**: every period return and CAGR is a price return (no dividend/total-return data source in this app); the Sharpe-like/Sortino-like ratios are explicitly labeled proxies, never presented as conventional-methodology ratios; a period/CAGR renders "insufficient history" (never extrapolated) when the weekly series doesn't reach back far enough within its ±10-calendar-day tolerance; a market with no defensible single benchmark renders "N/A — benchmark unavailable" (not exercised live this session — every current watchlist is India-only — but the code path was reviewed: `benchmarkSymbolFor()` returns `null` for `Global`, and `benchmarkPerformanceProfile()`/`stockPerformance()` correctly short-circuit every period/CAGR/volatility/drawdown/excess-return field to `null` with a `benchmark-unavailable` status in that case); portfolio-level max drawdown is disclosed as a diversification-blind weighted average of each holding's own drawdown, not a synthetic portfolio-index drawdown (no equivalent real portfolio-level primitive exists in this app, same category of simplifying-assumption disclosure as `scenarios.mjs`'s illustrative stress tests).
- No UI/navigation change this stage (by design, same staged-rollout discipline as Stage 1 — backend/data-model only, no new API route: the new fields ride the existing cache-only `GET /api/watchlists/:id/research` response). `docs/authoritative/system.md` (§3.9 extended, §7 repo-map row updated) and `CLAUDE.md` (§5 repo map) updated in this same change. No file was archived — no obsolete implementation existed to replace (this stage adds a new capability, not a rewrite).

**Institutional research foundation upgrade validation detail**:
- `node --check` clean on all 15 new/modified files: `data/metadata/{evidenceHierarchy,metricRegistry}.mjs`, `data/scoring/{qualityAttractiveness,researchQuality,factors,scoringEngine}.mjs`, `data/analytics/{relativeValuation,valuation,forwardFramework}.mjs`, `data/watchlist/research.mjs`, `data/decision/{thesisTracking,index}.mjs`, `data/reporting/researchReport.mjs`, `data/util.mjs`, `report.js`.
- Live `buildResearch()` (direct function call) checked cache-only across all 8 real saved watchlists (Core Portfolio, Banking, Power, Defence, Test, Sagar, Sameer, Asmita — 1 to 30 companies each): zero genuine `NaN`/`undefined` in every serialized payload (Asmita's 4 `"NaN"` substring matches are the same pre-existing base64 Google-News-RSS URL fragments already documented as false positives in the Phase 6/7 validation notes, re-confirmed by direct inspection, not a regression). `companyQuality`/`stockAttractiveness`/`fundamentalView`/`marketView`/`actionGuidance` populate for every resolved company with sensible, independently-varying scores (e.g. `HAL.NS`: Company Quality 79/Strong, Stock Attractiveness 71/Above average, overall rating Hold — confirms the split is not just echoing the blended rating).
- **Peer-framework correction, validated live against the named case**: `GOODLUCK.NS` (`sameer` watchlist, a genuine 1-company sector in that watchlist) now shows `peerCount: 0`, `peerCompleteness: "Unavailable"`, and `multiFactorPeerScore`/`sectorNormalizedValuationScore`/`relativeAttractivenessScore` all `null` with a disclosed `peerInsufficiencyReason` — previously these rendered a real but meaningless self-comparison score. Cross-checked against `Banking`/`Power`/`Defence`/`Sagar` (6-8 same-sector peers each): `peerCompleteness: "Strong"`, real non-null scores, unchanged in kind from pre-upgrade behavior. `Asmita` (30 companies, mixed sector sizes) exercised every band (`Strong`/`Adequate`/`Weak`/`Unavailable`) live in one watchlist.
- **Valuation confidence-band / precision correction, validated live against the named case**: `GOODLUCK.NS`'s own heuristic valuation (₹4,486.92 target price / 238.7% upside — the task brief's own named false-precision example) previously had no `confidenceBand` at all; it now computes `Medium` (down from what a naive completeness-only formula would have scored `High`, since both P/E and P/B resolved against a 5-company sample) once the reversion-gap signal (how far `GOODLUCK.NS`'s own P/E of 21.6 and P/B of 2.95 sit from the 5-company watchlist averages of 43.4 and 7.51 — a >50%/60% gap) is included. The per-company report now displays this target price rounded to the nearest whole rupee (₹4,487) rather than 2 decimal places, with the confidence band disclosed alongside — confirmed the underlying `stock.valuation.targetPrice` (4486.92) is completely unchanged for every other consumer (verified by direct inspection of the `research.mjs` payload alongside the report model).
- **Recommendation-confidence-only regression check**: compared `recommendation.rating`/`compositeScore` before/after across all 8 watchlists (Git diff of the exact bucket-composition/rating logic confirms `buildComponents()`/`composeRecommendation()`'s rating-and-score math is byte-identical to pre-upgrade; only `confidenceInputs` gained one additive, correctly-`null`-when-absent input). The only observed behavior change is `recommendation.confidence` reading one band lower for companies whose sector has fewer than 3 real peers (e.g. several Core Portfolio/Sameer/Asmita names went from a peer-blind confidence read to one that now discloses thin peer coverage) — expected and intentional per the peer-framework correction, not a defect.
- **Report generation end-to-end**: `GET /api/watchlists/:id/report/:symbol` checked over real HTTP against a second server instance on a scratch port (`PORT=4199`, never the user's own running dev server — no watchlist state mutated, both routes hit are read-only `GET`s) for `GOODLUCK.NS` — all 17 sections present including both new ones and the extended Thesis Tracking section; `companyQuality`/`thesisTracking.breakers`/`forwardOutlook` all populated with correct "not available" disclosure for the 4 forward-framework sub-concepts (no data source exists for any of them).
- **Goodluck India validation (task §23)**: the report simultaneously surfaces positive evidence (Stock Attractiveness "Above average" driven by a Valuation factor score of 89/100) and negative evidence (a `thesisBreakers` entry reading "Active" for promoter holding declining materially, a −2.44pp trend; Market View "Unfavorable"; Company Quality only "Average"; the target price's own Medium — not High — confidence band) in the same report, with no hard-coded steer toward a predetermined rating — the resolved rating (Accumulate, Medium confidence) falls out of the existing unified recommendation engine exactly as it does for every other company, unmodified by this upgrade.
- No `data/watchlists/*.json` or `data/cache/**` file was modified by any validation step (all checks were either direct in-process `buildResearch()` calls or read-only `GET` requests against a disposable scratch-port server instance); `git status` confirms no unintended state changes.
- **Browser-equivalent walkthrough** (no Playwright/Chromium available in this environment; `jsdom` installed only in the scratch directory, same zero-`package.json`-footprint discipline every prior phase's own validation used): loaded the real `report.html`/`report.js` against the real running scratch-port server for 3 real cases spanning the P/E-P/B-reversion-only model (`GOODLUCK.NS`), the financial-sector Justified-P/B model (`HDFCBANK.NS`), and an unresolved-recommendation edge case (`TATAPOWER.NS`, "Insufficient data for institutional score") — all 17 sections rendered (including both new sections and the extended Thesis Tracking section) with zero console/window errors and substantial real content (55–62KB of rendered HTML per case, not a blank page) in every case.
- Full-repository regression: generated the institutional report for all 73 resolved companies across all 8 real watchlists via direct `buildCompanyReport()` calls — zero crashes (the one non-crash "error" result is `PGCIL.NS`, the pre-existing TD-2 unresolved ticker, unrelated to this change).

**Automated test layer (TD-4/02.11) validation detail**:
- `node --check` clean on all 10 new files under `test/` (`node --check` was also re-confirmed on every source file the suite imports — no source file was modified by this item, it only adds tests against the existing, already-validated implementations).
- `node --test` (Node 22.19.0's built-in runner, invoked via `test.bat`/`node --test` with zero flags — default recursive discovery of `*.test.mjs` needs no path argument and no config file): **109 tests across 38 suites, 109 passing, 0 failing.**
- Two real defects were found in the test assertions themselves during this pass (not in the source modules) and fixed before the suite was reported green: (1) `sectorRiskTags()`'s matched-rule branch spreads the internal `SECTOR_RISK_RULES` entry directly, so the returned object also carries a `pattern` (RegExp) field alongside the 4 score fields — an incidental implementation detail, not a defect worth changing under this item's scope, so the test was corrected to assert the score fields individually instead of a whole-object `deepEqual`; (2) `positionConcentration()`'s `effectiveHoldings` is rounded to 2 decimals by `number()`, so a `0.001`-tolerance comparison against the unrounded reciprocal was too tight — widened to `0.01`.
- Every numeric assertion is either an exact hand-computed value derived from the module's own documented formula (e.g. `institutionalRisk()`'s 5 category scores and composite worked through by hand against a fully-resolved fixture; `resolveWeights()`'s equal-split, cash-target, partial-explicit, and over-allocated-rescale cases; `portfolioVolatilityPct()`'s variance-decomposition formula; `wacc()`'s CAPM+after-tax-cost-of-debt blend; `beta()`'s exact-2.0 recovery from a perfectly linear synthetic return relationship; `pearsonCorrelation()`'s exact ±1 recovery from perfectly linear synthetic price series) or a documented behavioral invariant where hand-deriving the exact figure isn't practical (`dcfValuation()`'s 10-year present-value projection isn't exported, so its `base`/`bull`/`bear`/sensitivity-grid outputs are checked for the required monotonicity — bull > base > bear; fair value falls as WACC rises; fair value rises as terminal growth rises — rather than re-implemented by hand).
- Confirmed every disclosed-unavailable-reason path this item's named modules expose is covered, not just the happy path: `dcfValuation()`'s 4 distinct `available:false` reasons (non-positive FCF, insufficient growth history, beta not computable, share count not derivable — each asserted against its own exact reason-string substring, so a future refactor that silently drops one of these disclosures would fail a test); `institutionalRisk()`'s renormalize-over-partial-input behavior (a 2-of-5-category case, composite computed only from what resolved); `resolveWeights()`'s empty-watchlist case.
- No production file was modified by this item — `git diff` outside `test/`, `test.bat`, `CLAUDE.md`, `system.md` (§4.7, §7), and this document shows nothing.
- Live check (per this document's own §1 validation bar, still required for the non-test-covered surface): started the server on a scratch port (`PORT=4198`, never the user's own running dev server) and confirmed `GET /api/watchlists` still serves the real 8 watchlists correctly — this item added no production code, so this is a smoke check that the new `test/` directory doesn't collide with `server.mjs`'s catch-all static file handler, not a regression check.
- This item was P0 and named as the single biggest structural gap since the Post-Phase-2 audit; it does **not** close TD-4/02.11's full scope by itself in the sense of covering every pure-math module in the app (`data/scoring/`, `data/decision/`, `data/quant/` remain uncovered — see `system.md` §4.7's explicit boundary) — it establishes the test *layer and convention* (zero-dependency `node:test`, one `*.test.mjs` per module, hand-computed-formula assertion discipline, one `helpers/` fixture module) for the 4 modules the item's own roadmap text named as the minimum bar, which is judged sufficient to mark 02.11/TD-4 Completed per that stated bar; extending coverage to additional modules is now a small, well-precedented follow-on rather than a new item.

**CI Integration (07.2) validation detail**:
- Repository audit before implementing: no `.github/` directory existed at all, so there was no pre-existing workflow to extend — 07.2's own text ("minimal first step") was implemented as a new single-job workflow rather than an addition to something that didn't exist. `test.bat`/`run.bat`/`killserver.bat` were confirmed as the only pre-existing automation, none of it CI.
- `.github/workflows/ci.yml`: triggers on `push` and `pull_request`; one job (`ubuntu-latest`); `actions/checkout@v4` + `actions/setup-node@v4` (`node-version: '22.x'`, matching the local dev environment's Node 22.19.0 — no version introduced without precedent); two steps, both mandatory (no `continue-on-error`, no `|| true`, no suppressed exit code): (1) `node --check` over every tracked `.mjs`/`.js` file discovered via `find`, excluding `data/cache/` and `data/watchlists/` (regenerable cache / user data, not source — consistent with `CLAUDE.md` §3's own exclusion list); (2) `node --test`, zero flags, default recursive `*.test.mjs` discovery.
- Local validation of the exact CI logic before relying on a remote run: ran the same `find`+`node --check` loop used in the workflow directly in git-bash — 82 files discovered, all clean, exit 0. Ran `node --test` directly — **109 tests / 36 suites, 109 passing, 0 failing**, matching the TD-4/02.11 baseline exactly (no drift).
- **Negative-path validation** (required by this item's own acceptance bar — "red on an intentionally broken file or a failing test"): appended a syntax error to a scratch copy of `data/util.mjs`, re-ran the same `node --check` loop — it correctly returned a non-zero exit status; reverted via `git checkout -- data/util.mjs` and re-confirmed clean. Separately, appended a deliberately-failing `node:test` case to a scratch copy of `test/util.test.mjs`, ran `node --test` — it exited 1 with `# fail 1`; reverted from a backup copy and re-ran `node --test` to confirm the suite was back to 109/109 with zero residue. Both breaking changes were transient (never committed) and are absent from the final working tree.
- YAML syntax validated (`yaml.safe_load` against the final `ci.yml` — parses cleanly).
- No remote GitHub Actions run has been observed yet — this workflow has not been pushed (per this task's explicit instruction not to commit/push). The "CI job goes green on a clean push" half of the validation requirement is therefore validated by exact local reproduction of every step the workflow runs (same commands, same working tree, same pass/fail outcomes), not yet by an actual hosted run; the user should confirm the first real Actions run after pushing.
- No production code changed. No `package.json` introduced — zero-dependency constraint (`system.md` §1.2, §4.7) preserved. `test.bat` untouched and not referenced by CI (Windows developer convenience only, per this item's own Windows-compatibility constraint).

**Sector Research data-source investigation validation detail**: investigation-only, no code changed — validation is the evidence trail itself. Read `docs/authoritative/system.md`/`docs/governance/roadmap.md` in full; read `data/universe/nseUniverse.mjs`, `data/watchlist/sectorIntelligence.mjs`, `data/watchlist/searchIndex.mjs`, `data/watchlist/resolve.mjs`, `data/watchlist/store.mjs` (`addCompany`), `data/providers/screenerProvider.mjs`/`yahooQuoteProvider.mjs` (full export surface — confirmed no listing/enumeration endpoint exists in either), `data/analytics/institutionalRisk.mjs`'s `SECTOR_RISK_RULES`. Ran a live grep of `sector`/`industry` fields across all 62 real cached companies in `data/cache/companies/*.json` (not a sample) and read 4 real watchlist JSON files (`power.json`, `power-2.json`, `banking.json`, `defence.json`) directly — the Defence-sector finding (12/13 companies carry `sector: "Capital Goods"`, not "Defence") is evidence read from the user's own real, current data, not a hypothetical.

**UX/IA redesign validation detail**:
- `node --check` clean on `script.js` (the only `.js`/`.mjs` file touched — zero backend files changed).
- `node --test` — 109/109 passing, 36 suites, unaffected (this change touches no module the suite covers).
- Structural checks before the live pass: `<section>`/`<div>` tag-balance count on the full `index.html` (8/8, 230/230); a full-file `id="..."` grep confirmed zero duplicate element ids after the DOM relocation (a real risk given several ids like `#valuation-table`/`#risk-table` needed to end up in exactly one place, not two).
- **Live end-to-end check**: started a second server instance on a scratch port (`PORT=4199`, never the user's own running dev server), installed `jsdom` in a scratch directory outside the repo (same zero-`package.json`-footprint discipline every prior phase's own validation used) and drove the real `index.html`/`script.js` against the real running scratch-port server — bridging Node's real `fetch` into the jsdom window (resolving relative URLs against the scratch server, the one piece of driver plumbing this validation needed beyond every prior phase's jsdom harness). 52 assertions covering: sidebar composition (9 items incl. the disabled Sector Research placeholder with no `data-tab`); Company Research's company-switcher pill row, all 7 dimensions, all nested deep-dive sub-navs (Valuation's DCF/Reverse DCF/Sensitivity/Relative valuation/Historical valuation confirmed to have *lost* the old "Overview" comparison-table button; Risk's deep-dive confirmed at exactly 5 buttons, no leftover Overview/Alerts), and that switching the active company via the switcher pill actually changes the deep-dive content shown (not just the active-pill highlight); Watchlist Research's all 8 sub-tabs including the nested Quality→Balance sheet group, each comparison table's row count matching the watchlist's own resolved-company count; a real watchlist switch (via the header `<select>`, dispatching a real `change` event) confirmed the roster table repopulates without error; Portfolio Analysis's relabeled title and deferred-Transactions disclaimer; Market Intelligence's Sector Intelligence disclosure text (`"no market-wide sector database"`) confirmed still present verbatim; Compare, Reports, Watchlists, and Quick Jump's new `"tab:subtab"` targets. **52/52 passed, zero console errors, zero duplicate ids** on the final run (two earlier runs surfaced 3 apparent failures that were traced to the test harness's own wrong baseline — comparing pill-selector counts, which correctly exclude unresolved companies, against the watchlist roster table's count, which correctly includes them, e.g. this watchlist's own real `PGCIL.NS` unresolved-ticker case, TD-2 — not an app defect; fixed in the harness, not the app).
- **State-mutation check** (required since the scratch-port server shares the same on-disk `data/` files as the user's real server): `git status`/`git diff` after the harness run showed `data/watchlists/index.json`'s `activeWatchlist` had moved from this session's starting value (`"power"`) to `"banking"` — the harness's own watchlist-switch step, run three times across iterations, doing exactly what a real client does. Reverted via the real `POST /api/watchlists/active` route (not a hand-edit), same remediation pattern as every prior phase's own validation; confirmed `activeWatchlist` back to `"power"` afterward. The remaining `git diff` breadth against the last commit (across nearly every watchlist/cache/snapshot file) predates this session — consistent with ordinary real usage since the last commit, not something this narrow navigation-only test run could produce, and left as-is per this repo's own established precedent that a genuine data refresh is not test residue.
- Not exercised live: on-screen paged-media print output (unchanged — no report page was touched by this redesign) and the 375px mobile drawer breakpoint (structurally unchanged sidebar-collapse mechanism from Phase 6.5, not independently re-tested this pass).

**App-wide UX/data-parity consistency pass validation detail**:
- `node --check script.js` clean (the only `.js`/`.mjs` file touched by the backend-adjacent parts of this pass — `index.html`/`script.js` were the only files modified overall).
- `node --test`: all 109 tests/36 suites pass, unaffected (no analytics/scoring/decision/quant module touched).
- Live cache-only `GET /api/watchlists/banking/research` (second server instance, scratch port 4187, never the user's own dev server on 4173) inspected directly before touching the frontend: `recommendation.fundamentalView`/`.marketView` and `performance.riskAdjusted.sharpeLike`/`.sortinoLike`/`.risk.maxDrawdown` all populate with real, sensible values (e.g. HDFCBANK.NS: Fundamental View "Neutral" 50/100, Market View "Unfavorable" 33/100 regime Downtrend; Sharpe-like -1.695, Sortino-like -2.309, max drawdown -29.87%).
- Real-browser validation: Puppeteer-core driving the system's installed Chrome (installed only in a scratch directory outside the repo, same zero-dependency discipline as every prior pass), against the same scratch-port server, each scenario in its own isolated browser context (same isolation discipline as the floating-header-clone pass, to avoid this app's own by-design `localStorage` subtab persistence leaking between scenarios). **37/37 assertions passed** across the Asmita watchlist (30 companies, the largest currently saved) and Banking:
  - `#wl-table` Sector column: full asc→desc→natural sort cycle confirmed via CSS class transitions; ascending sort confirmed to put every N/A-sector row *after* every real value (the bug fix, verified programmatically on real data, not just reasoned about).
  - `#wl-table` floating header: appears exactly once after scrolling past the real header, stays pixel-aligned with the real body columns after a 400px horizontal scroll (both measured via `getBoundingClientRect`, not eyeballed) and confirmed at 4 viewport sizes (1600×600/900/1400, 540×900 mobile) — the mobile case needed the test itself to locate the real thead's actual document-relative position rather than assume a fixed scroll offset, since the header/toolbar wraps into more rows at that width (a real layout difference, not a bug).
  - Zero duplicate DOM ids confirmed on every scenario *after* the `id`-stripping fix (before the fix, `wl-select-all` was confirmed duplicated, reproducing the bug live rather than by static reasoning).
  - Sort asc/desc/natural cycles confirmed on `#pi-action-table`, `#portfolio-table`, `#rebalancing-table`, `#exposure-matrix-table`, `#earnings-intel-table`, `#sector-intel-table`, `#wr-overview-table` (Fundamental View column), and `#technical-table-relative-strength` (Sharpe-like column).
  - `#wr-overview-table`'s Fundamental View/Market View cells and `#technical-table-relative-strength`'s Max drawdown/Sharpe-like/Sortino-like cells confirmed non-N/A on real resolved companies, with header-count/cell-count parity (no ragged rows).
  - Floating headers on `#pi-action-table` confirmed to show at most once while scrolling a 30-company watchlist.
  - Zero console/page errors across every scenario, the sole exception being `favicon.ico`'s 404 (confirmed via a response-status listener, not assumed) — the same pre-existing, disclosed non-issue every prior validation note in this document records (this app has no favicon configured).
  - No `NaN`/`undefined`/literal-`null` text found in `#wl-table`.
- **State touched during validation**: switching the scratch server's active watchlist to Asmita and Banking to exercise each table left `data/watchlists/index.json`'s `activeWatchlist` pointing at a different value; reverted to its pre-session value (`defence`) via the same `POST /api/watchlists/active` route a real client uses, confirmed via `git diff`. The remaining diffs across `data/watchlists/*.json` (new companies in Defence/Test, new watchlists Power-2/G2G/15%in1Y) all carry `addedAt`/`updatedAt` timestamps from August 2026, weeks before this session — pre-existing uncommitted state from the user's own prior activity, not touched by this pass.
- Not exercised live: print/PDF output (no report page touched by this pass) and a real-time comparison against the exact pixel offsets on a genuinely different DPI/zoom level (only 1 device-pixel-ratio tested).

**Macro Intelligence — India/US Macro peer-tab promotion + India Gold Rate validation detail**:
- `node --check` clean on every changed file (`index.html` has no check target; `script.js`, `data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`, `data/metadata/metricRegistry.mjs`) plus a full repo-wide sweep (`git ls-files "*.mjs" "*.js" | xargs -n1 node --check`), matching the CI gate exactly.
- `node --test`: all 109 tests/36 suites pass, unaffected (no analytics/scoring/decision/quant module touched).
- `GET /api/macro` read directly against a scratch server (port 4322, never the user's own dev server on 4173) before any UI check: 7 indicators all `"status":"Live"` including the new `goldIndia` (₹125.58/unit at fetch time, a real Yahoo GOLDBEES.NS quote — confirmed live, not assumed), 11 Future Integration entries (the pre-existing 9 plus the 2 new India Crude Oil/Natural Gas rows).
- Real-browser validation: a zero-dependency Chrome DevTools Protocol driver (Node 22's built-in `fetch`/`WebSocket`, real installed Chrome headless) against the same scratch server. **34 scripted assertions passed, 0 failed**:
  - Primary nav order/labels exactly `Market Intelligence | India Macro | US Macro | Sector Intelligence | Earnings & Events | News & Catalysts`.
  - Market Intelligence (default tab): only that panel visible (India/US Macro both `hidden`), Market regime + Data Quality populated, `#macro-geography-detail` confirmed absent from the DOM.
  - India Macro: only that panel visible; indicators table shows exactly 3 rows (USD/INR, India Gold Rate, India VIX); Future-Integration table shows exactly 11 rows.
  - US Macro: only that panel visible; indicators table shows exactly 4 rows; zero India-labeled rows.
  - Zero duplicate DOM ids app-wide.
  - Zero horizontal overflow and zero `#main` vertical overflow at 1600×1000, 1366×768 and 1280×700 (this app's own previously-documented short-viewport edge case) across all 3 macro tabs, plus zero horizontal overflow at the 390px mobile breakpoint.
  - The 3 unaffected sibling tabs (Sector Intelligence, Earnings & Events, News & Catalysts) each still show only their own panel with all 3 macro panels hidden.
  - India indicators table's `.scroll` wrapper still carries `overflow-x:auto` (horizontal table scroll preserved).
  - Watchlist Research's `#wr-overview-table` (a genuinely unrelated, untouched workspace) still renders correctly — no app-wide regression.
  - Zero console errors/exceptions (the sole exception, `favicon.ico` 404, is the same pre-existing, disclosed non-issue every prior validation note in this document records).
- **State touched during validation**: none — only page loads, sidebar/sub-tab clicks, and a direct `GET /api/macro` were exercised (no mutating route called). `git diff` on `data/watchlists/` after the session showed only the pre-existing uncommitted state already present before this session began (confirmed against the session's own starting `git status`). `data/cache/` gained one new, expected, regenerable `goldIndia` entry from the real Yahoo fetch above. Scratch Chrome (both driver runs) and the scratch server were terminated, and both scratch Chrome profile directories deleted, before finishing.
- Not exercised live: the FRED `fredgraph.csv` investigation (India CPI/IIP/G-Sec/repo-rate candidate series) was validated by direct `curl` against FRED's own endpoint, not through this app's UI — no FRED integration was shipped, so there was nothing app-side to browser-test for that part of the brief.

**Macro Intelligence — Trend Parameters (20/50/100/200 DMA, trend, DMA alignment) validation detail**:
- `node --check` clean on every changed file (`script.js`, `data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`, `data/metadata/metricRegistry.mjs`; `index.html` has no check target) plus a full repo-wide sweep (`git ls-files "*.mjs" "*.js" | xargs -n1 node --check`), matching the CI gate exactly.
- `node --test`: all 109 tests/36 suites pass, unaffected (no analytics/scoring/decision/quant module touched — this is pure reuse of `yahooQuoteProvider.mjs`'s already-tested `fetchQuote()`/`trendLabel()`).
- The shared `data/cache/macro/*.json` bundles predated this change and lacked the new `dma20`/`dma100`/`trend` fields; cleared first (regenerable cache, not source) to force a real fetch rather than validate against a stale cache shape.
- `GET /api/macro` read directly against a scratch server (port 4501, never the user's own dev server): all 7 fetched indicators returned real, distinct 20/50/100/200 DMA values and a trend label mathematically consistent with the DMA relationship — e.g. US 10-Year Treasury yield (price 4.784 > 50 DMA 4.6334 > 200 DMA 4.3596 → "Uptrend"), India VIX (price 11.16 < 50 DMA 12.1192 < 200 DMA 14.4937 → "Downtrend"), USD/INR (price below its 50 DMA, but that 50 DMA above its 200 DMA — neither condition holds → "Sideways", the disclosed non-monotonic case, not a bug).
- Real-browser validation: a zero-dependency Chrome DevTools Protocol driver (Node 22's built-in `fetch`/`WebSocket`, real installed Chrome headless) against the same scratch server, at 4 viewports (1600×1000 default desktop, 1366×768, 1280×700, 390×844 mobile):
  - Both `#macro-trend-table-india`/`-us` render the exact 7-column header (Indicator/Trend/20 DMA/50 DMA/100 DMA/200 DMA/DMA Alignment).
  - India shows exactly its 3 fetched indicators (USD/INR, India Gold Rate, India VIX); US shows exactly its 4 (US 10Y Treasury yield, WTI crude, Henry Hub gas, Gold); zero label overlap between the two tables.
  - DMA Alignment counts (e.g. WTI crude 4/4 above, India VIX 0/4 above) confirmed by manual recomputation off each row's own displayed DMA values, not just trusted from the UI.
  - Zero duplicate DOM ids app-wide; zero console errors/exceptions.
  - `document.documentElement` and `#main` showed zero horizontal/vertical overflow at all 4 viewports; at 390px the new table's own `.scroll` wrapper (not the page) carried the horizontal overflow (487px measured directly via `scrollWidth`/`clientWidth`), confirming the table scrolls within its own bounded wrapper rather than the page.
- **State touched during validation**: none to `data/watchlists/` (only page loads, sidebar/sub-tab clicks, and a direct `GET /api/macro` were exercised — no mutating route called; `git diff` showed only the pre-existing uncommitted state already present before this session began). `data/cache/macro/*.json` regenerated with the new, complete field set from real Yahoo fetches — an intentional, expected refresh of regenerable cache. Scratch Chrome and the scratch server were both terminated before finishing.

**Macro Intelligence — India/US Macro indicator + Trend tables merged into one unified table validation detail**:
- `node --check` clean on `script.js` (`index.html`/`styles.css` have no check target) plus a full repo-wide sweep (`git ls-files "*.mjs" "*.js" | xargs -n1 node --check`), matching the CI gate exactly.
- `node --test`: all 109 tests/36 suites pass, unaffected (no analytics/scoring/decision/quant/provider module touched — pure presentation merge of two already-rendered tables into one).
- Real-browser validation: a zero-dependency Chrome DevTools Protocol driver (Node 22's built-in `fetch`/`WebSocket`, real installed Chrome headless) against a scratch server (port 4502, never the user's own dev server):
  - `#macro-trend-table-india`/`-us` confirmed absent from the DOM entirely (`document.getElementById` returned `null`) — not merely hidden, genuinely removed — leaving exactly one table per tab.
  - Both `#macro-indicators-table-india`/`-us` render a 2-row `<thead>`: group row with `colspan` 3/5/6 (Indicator Details/Performance/Trend Parameters (Moving Averages), summing to 14) over the real 14 per-column headers.
  - India: exactly 3 rows (USD/INR, India Gold Rate, India VIX); US: exactly 4 rows (US 10-Year Treasury yield, Crude oil (WTI), Natural gas (Henry Hub), Gold) — each indicator appears exactly once, Indicator Details/Performance/Trend cells all confirmed present on the same `<tr>` (read via `tr.children`, not two separately-keyed rows).
  - DMA Alignment and Trend independently recomputed from each row's own displayed DMA values and confirmed correct: USD/INR price 94.67 below its 20/50/100 DMA, above its 200 DMA → "1/4 above" / "Sideways" (50 DMA above 200 DMA, so neither pure Uptrend nor Downtrend condition holds); India Gold Rate 3/4 above / "Uptrend"; India VIX 0/4 above / "Downtrend"; US 10Y Treasury yield and Crude oil (WTI) both 4/4 above / "Uptrend"; Natural gas and Gold both 3/4 above / "Sideways".
  - Tab independence reconfirmed with the merged markup: default load shows only `macro-intelligence` (`macro-india`/`macro-us` both `hidden`); India Macro shows only `macro-india`; US Macro shows only `macro-us` — no cross-tab bleed introduced by the merge.
  - Zero duplicate DOM ids app-wide; zero console errors/exceptions.
  - 4-viewport sweep (1600×1000 default desktop, 1366×768, 1280×700, 390×844 mobile): zero `document.documentElement`/`#main` horizontal or vertical overflow at every size; the unified table's own `.scroll` wrapper correctly carried the (increasing, as the viewport narrowed) horizontal overflow instead — 90px at 1600px wide, 1057px at 390px — confirming the wider merged table scrolls within its own bounded container, never the page.
- **State touched during validation**: none — only page loads and sidebar/sub-tab clicks were exercised (no mutating route called, no `GET /api/macro` refetch needed since the cache from the prior pass's validation was already in the new field shape); `git diff` on `data/watchlists/` showed only the pre-existing uncommitted state already present before this session began. Scratch Chrome and the scratch server were both terminated before finishing.

**Future Integration feasibility audit + MoSPI credentialed integration
architecture (2026-09-08)**: a mandatory source-feasibility audit of all 10
still-deferred India Macro indicators (data availability/authority/machine-
readability/frequency, best-source ranking, integration-feasibility
classification, historical-data feasibility per indicator — full matrix in
§4/TD-13 above) found 9 stay genuinely blocked on data access (each for a
specific, investigated reason, not a repeat finding) and one exception: CPI
inflation and IIP have a real official Government of India API (MoSPI's
eSankhyiki platform), gated behind user signup + a 15-minute access token.
Per the user's explicit direction, built out as this app's first credentialed
integration rather than left deferred outright: new `data/integrations/`
module (`config.mjs`, `credentialStore.mjs`, `mospiClient.mjs`,
`mospiProvider.mjs` — see `system.md` §3.10 for the full architecture,
credential lifecycle, and the live-confirmed TLS caveat on MoSPI's own
server), a new **Configuration → Integrations** page (`#configuration`
sidebar tab, `index.html`/`script.js`), 6 new API routes
(`/api/integrations*`), and `data/watchlist/macro.mjs` wired so CPI/IIP show
a dynamic status (Live/Delayed/Credentials Required/Token Expired/
Authentication Failed/Unavailable) instead of a fixed "Future Integration"
disclosure. The credential itself (email + access token, never the account
password) is stored in a new gitignored `data/config/mospi.local.json` —
plaintext on local disk, the disclosed, honest design for this single-user
local tool with no OS keychain/secrets-vault integration. CPI/IIP render in
their own "Economic indicators (configuration-gated)" table on India Macro,
deliberately not the market-style DMA/Trend-Parameters table (a monthly
government index is a period-over-period reading, not a priced instrument).
The other 9 indicators are unchanged — still explicit "Future Integration",
never estimated or scraped to close the gap.

**Validation**: `node --check` clean on every new/changed `.mjs`/`.js` file
individually and via a full repo-wide sweep (`git ls-files "*.mjs" "*.js" |
xargs -n1 node --check`), matching the CI gate exactly. `node --test`:
118/118 tests / 39 suites pass (109 pre-existing + 9 new in
`test/mospiIntegration.test.mjs`, covering `parseMospiSeries()`'s
shape-detection — including "never guess a wrong field, return null instead"
— and `credentialStore.mjs`'s pure `maskToken()`/`isTokenExpired()` helpers;
these are outside TD-4's formally-covered scope, added as a voluntary
extension since the functions are genuinely pure). Live validation against a
scratch server (a free local port, never the user's own dev server;
credential file deleted before and after every run): confirmed the
credentials-absent default state end-to-end (`GET /api/integrations` →
"Not Configured"; `GET /api/macro`'s `configGated` → both "Credentials
Required"; `dataQuality.futureIntegration` correctly dropped from 11→9 and a
new `credentialsRequired: 2` appeared); confirmed the manual-token-paste
route, and in doing so found and fixed a real bug this session introduced
(status read "Connected" immediately after saving an unverified token,
before any real fetch had succeeded — `credentialStore.saveToken()` was
setting `lastVerifiedAt` on every save; fixed to leave it `null` until a new
`markVerified()` is called by an actual successful dataset fetch, and the
status-priority logic in `getIntegrationStatus()` was reordered so Token
Expired/Authentication Failed/Provider Unavailable can't be masked by a
stale "Configured"); confirmed a genuine live network attempt against
`api.mospi.gov.in` with a fake token surfaces "Provider Unavailable" with a
real, disclosed error rather than any fabricated data, and separately
confirmed directly (a raw `fetch()` from this app's own runtime, not
inference from third-party code) that standard Node.js TLS settings fail
against `api.mospi.gov.in` with `ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED`
— this app does not weaken TLS verification to work around a misconfigured
upstream server, so this is disclosed as a live-confirmed limitation, not a
hypothetical one. **Real authenticated live-fetch validation was not
performed** — no real MoSPI account/token exists in this session — per the
task's own instruction not to claim live validation without a real
credential; this is stated plainly rather than implied. No headless-browser
tooling was available in this sandbox for a full interactive UI
walkthrough of the Configuration forms (masking, hidden/shown toggling,
duplicate-DOM-id check); those were verified by static HTML/JS review
(delegated event listeners scoped to the one static `#integrations-list`
container, `type="password"` on every credential field, server responses
confirmed via `curl` to never include a raw token) rather than a live click-
through — disclosed as a validation-coverage gap, not silently skipped.

**MoSPI account-management workflow completion (2026-09-08, same-day
follow-on)**: a review-then-build task on top of the entry above — inspect
what the initial integration actually implemented, confirm against MoSPI's
own manuals exactly which account-management operations are officially
supported, then build out every supported one in the Configuration UI and
handle every unsupported one honestly rather than faking it. Re-checking
`config.mjs`'s own source citations reconfirmed the initial audit's finding:
MoSPI's published CPI/WPI manuals document **signup**, **login**, and no
password-change or password-reset/recovery API of any kind. Implemented:
registration now validates a confirm-password field locally (never
transmitted) and gained a best-effort `isAlreadyExistsError()` heuristic
(409 status or "already exists/registered/duplicate" phrasing — disclosed as
a heuristic, since neither manual shows an error-response body's exact
wording) that, on a match, switches the UI straight to Sign-in with the
email carried over instead of a generic failure; a successful sign-in now
auto-runs Test Connection with no extra click; the Configuration →
Integrations card was reorganized into the 4-section workflow this task's
own brief specified (Connection status / Account / Token / Datasets), with
Account split into 4 switchable panels (Register/Sign in/Change password/
Password recovery, one visible at a time). **Not implemented, correctly**:
an actual password-change or reset/recovery API call — neither exists to
call; each of those two panels is a static notice plus a link to the one
official surface found (`MOSPI.manageAccountUrl`), never a fake form. Real
signup/login against the live service was **not** performed in this pass —
only the account email was supplied to this task, never a password (rightly
withheld from the conversation), so that step is the user's own to perform
directly in the browser. Files changed: `script.js`, `server.mjs`,
`data/integrations/mospiProvider.mjs`, `test/mospiIntegration.test.mjs`;
`system.md` §3.10 updated in the same change with the full design/validation
narrative. See `system.md` §3.10 for the complete validation detail
(scratch-server + scratch-headless-Chrome walkthrough, live TLS-caveat
reconfirmation, `node --test`: 121/121, 118 pre-existing + 3 new). No
analytics/scoring/decision/quant/provider module touched; `data/watchlists/`
and `data/config/` confirmed untouched by this pass's own testing.

**CPI moved to a public, unauthenticated path — IIP unchanged (2026-09-08,
same-day follow-on)**: re-verified live, rather than assumed, whether CPI
genuinely needs the credential lifecycle the entry above built. It does not.
MoSPI's own CPI API User Manual documents unauthenticated access as
intentional platform behavior ("without access token the APIs will fetch
only the first 10 records"), confirmed live via a plain unauthenticated
`curl` against this app's existing, already-correct endpoint
(`/api/cpi/getCPIIndex` — a `getCPIData`/`Level`-parameter endpoint shown in
a screenshot this task was given was tried and confirmed non-functional,
always returning `{"error":"Please check the input parameters passed"}`
regardless of parameters). Two real, independent constraints, both found by
the same live testing and designed around rather than ignored: (1) every
query filter is silently ignored for anonymous callers, so this app cannot
select the headline "General"/all-groups CPI figure without a token — the
fixed unfiltered slice MoSPI serves anonymously consistently carries the
Consumer Food Price Index instead, so that is what "CPI Inflation" means in
this app today, labeled everywhere as "CPI Inflation (Consumer Food Price
Index)" so nothing is misrepresented (an explicit, informed product
decision, put to and made by the user, not a silent substitution); (2)
MoSPI's server still has the live-confirmed TLS defect the entry above
disclosed (`ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED` under Node's
default settings — `curl`'s TLS stack in this task's environment permits
legacy renegotiation by default, Node's does not) — per CLAUDE.md's hard
gate on weakening TLS without explicit sign-off, this was put to the user
before any code changed, and the user approved a **narrow, scoped**
exception: a dedicated `https.Agent({ secureOptions: SSL_OP_LEGACY_SERVER_
CONNECT })` used by exactly one new function, `mospiClient.mjs`'s
`fetchCpiPublic()` — certificate verification is untouched, only the
renegotiation policy is relaxed, and only for that one call. The existing
shared `request()` path (login/signup/`fetchIipMonthly`) is completely
unchanged and still fails exactly as before ("Provider Unavailable") — IIP
was deliberately not re-tested or changed, per this task's own explicit
instruction not to extend the same conclusion to it automatically.

New: `mospiClient.mjs`'s `fetchCpiPublic()`; `mospiProvider.mjs`'s
`findCpiRecord()` (defensive, case-insensitive series search, returns `null`
rather than a guess when absent — caught a real bug in its own first draft,
`Number(null) === 0` not `NaN`, fixed and covered by a regression test) and
`getCpiPublicSnapshot()` (cache-first, never reads the stored credential at
all); `PUBLIC_DATASETS`/`CREDENTIALED_DATASETS` replace the old single
`DATASETS` list, and `getIntegrationStatus()`'s per-dataset rows now carry
`authRequired: true/false`. `testConnection()` now exercises IIP (was CPI,
which no longer proves anything about a stored token). `data/watchlist/
macro.mjs` gained `loadCpiIndicator()`, merging CPI directly into the main,
always-on `indicators` array (not the credential-gated `configGated` array
IIP still uses) — CPI now renders in the same India indicators table/column
set as the 7 real market indicators (Indicator/Category/Value/Change/1Y
change/Direction/Status/As of/Trend), per this task's explicit requirement;
`changePct`/`trend`/DMA cells are honestly blank (no second data point or
daily series is retrievable unauthenticated), `oneYearChangePct` is MoSPI's
own directly-supplied Year-on-Year `inflation` field, used as-is rather than
recomputed. Configuration → Integrations' MoSPI card now renders two
visually distinct dataset tables (green "No credentials required" badge for
CPI vs. a "Credential-gated data" section for IIP), with copy stating the
credential-status badge/Account/Token sections describe the IIP path only.
`metricRegistry.mjs` gained `mospiCpiIndicator` (Sourced/Medium) and
narrowed `mospiIndicator`/`mospiCredential`/`macroDataQuality` to describe
IIP only. Files changed: `data/integrations/config.mjs`,
`data/integrations/mospiClient.mjs`, `data/integrations/mospiProvider.mjs`,
`data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`,
`data/metadata/metricRegistry.mjs`, `index.html`, `script.js`, `server.mjs`
(comment only), `test/mospiIntegration.test.mjs`.

**Validation**: `node --check` clean on every changed file and via the full
repo-wide sweep, matching the CI gate. `node --test`: 127/127 tests / 43
suites pass (121 pre-existing + 6 new, including the `Number(null)`
regression case above). Live validation against a scratch server (port
4193) and a scratch headless Chrome (CDP, port 9345), neither ever the
user's own dev server/browser: `buildMacroSnapshot()` confirmed
`cpiInflation` reads `status: "Live"` with real values while
`data/config/mospi.local.json` showed `accessToken: null` throughout — CPI
working with zero MoSPI credentials configured, confirmed directly; `GET
/api/integrations` confirmed `cpiInflation`/`iip` as two distinct dataset
rows (`authRequired: false`/`true`); a full browser walkthrough confirmed
the India Macro table's new CPI row, the credential-gated table now showing
IIP only, the Configuration card's Public/Credential-gated split, zero
duplicate DOM ids, zero console errors, and no horizontal/vertical overflow
at 1600×1000, 1366×768, 1280×700 and 390×844 mobile. No incidental writes to
`data/watchlists/` (confirmed via `git status` before/after); `data/cache/
mospi/cpiInflation.json` gained a real cache entry, the intended effect of
the feature working. See `system.md` §3.10's own dated follow-on entry for
the complete narrative.

**Watchlists → Custom: user-configurable comparison table** (2026-09-15):
added a second sub-tab to the Watchlists workspace (`#watchlists` gained its
first `.subtabs` nav, "All companies"/"Custom" — the same nested-subtab
mechanism every other workspace already uses, `initSubtabs`/
`applySubtabState` picked it up with zero JS change) holding a
user-configurable screening table per the user's explicit column list:
Company/Sector/CMP/P/E (the same locked prefix every comparison table in
this app leads with, `prefixCells()`/`STANDARD_SORT_KEYS`, not
togglable) plus 20 optional columns — Debt/Equity, ROE, ROCE, EBITDA
margin, Operating margin, Net margin, Earnings yield, FCF yield,
Promoter/FII/DII holding, Revenue/EBITDA/Profit growth 5Y, 5Y (price)
CAGR, RSI(14), DMA alignment, ADX, DI+, DI− (the user's own list named
"DI+" twice; read as the standard ADX/DI+/DI− trio and implemented as
DI+/DI−). Every column reads a value `data/watchlist/research.mjs`
already computes and `metricRegistry.mjs` already tags — zero new
calculation, zero new registry entry, per the single-computation-site
rule (§8). Operating margin and EBITDA margin intentionally read the
same underlying `metrics.ebitdaMargin` figure, disclosed in-page — this
data source (Screener.in) has no separate D&A add-back line to
distinguish them, the exact same disclosed limitation Watchlist Research
→ Fundamentals → Profitability already carries for the same two labels.
Three new pieces of generic UI, all scoped to this one table: a field
selector (`#wl-custom-field-selector`, checkboxes persisted to
`localStorage`, default all-on) driving which optional `<th>`/`<td>`
cells render; column sorting reusing the existing shared
`sortForTable`/`initTableSort` mechanism (its own `cmpSortState['wl-
custom-table']` entry, N/A-last, same click-to-sort/again-for-desc/
third-click-clears convention as every Watchlist Research table); and
this app's first **user-adjustable column width** — a drag handle on
each `<th>`'s right edge (`initWlCustomColumnResize()`, pointer events,
60px floor) writing directly to that `<th>`'s inline `width` on a
`table-layout:fixed` table, persisted per-column to `localStorage`
(`wlCustomColWidths`) and reapplied on every re-render. The table shares
the All-companies tab's existing filter/search/monitoring-pill state
(`wlFilteredSortedStocks`) rather than duplicating filter UI — filtering
from All companies also narrows the Custom view. Rendered as a
`.card`(field selector) + `.card-table-fill` pair inside the new
`.subsection`, the same "KPI/context card beside a `.card-table-fill`"
pattern already validated for Watchlist Research Overview's `#wr-kpis`
(`system.md` §2.3's bounded-viewport-shell entry) — gets native
`position:sticky` headers for free, no floating-header clone needed.
Files changed: `index.html`, `script.js`, `styles.css` — no analytics/
scoring/decision/quant/provider/API change.

**Validation**: `node --check` clean on `script.js`/`server.mjs`;
`node --test`: 140/140 tests / 45 suites pass, unaffected (no pure-math
module touched). Live browser validation (Playwright/Chromium, a scratch
server on port 4187, never the user's own dev server on 4173) against
the Defence watchlist (14 companies, real cached data): the Custom
sub-tab renders 20 field-selector checkboxes and a 24-column table (4
fixed + 20 optional) with every cell populated from real data; unchecking
a field hides its column and re-checking restores it; clicking a sortable
header sorts ascending then descending (`sorted-asc`/`sorted-desc`
classes correctly applied, N/A values sorted last); dragging a header's
right edge resized the Company column 200px→280px and the width survived
a full page reload (confirms the `localStorage` round-trip); zero
console errors. The active watchlist was switched to Defence for this
run and restored to its exact pre-run value
(`sub-100-growth-di-crossover-setup-monthly`) via the same
`POST /api/watchlists/active` route the UI uses, confirmed after the
fact with `git status`/`git diff` showing no change to
`data/watchlists/` beyond that expected round-trip and the user's own
pre-existing uncommitted session state.

**Watchlist Research → Overview fetched-vs-derived + sort/resize validation detail**:
- `node --check script.js` clean; `node --test`: all 140/140 tests pass, unaffected (this is a presentation-only change — no `data/analytics`/`data/scoring`/`data/decision`/`data/quant` module was opened for edit).
- Validated live with a zero-dependency Chrome DevTools Protocol driver (Node 22's built-in `fetch`/`WebSocket`) driving the system's real installed Chrome headless (isolated scratch profile) against a scratch server (port 4189, never the user's own dev server on 4173), navigated via real sidebar/subtab clicks.
- Lineage classification confirmed programmatically against the live DOM: exactly 13 `<th class="col-derived">` (Recommendation/Primary driver/Confidence/Composite score/Upside %/Regime/Risk score/Action/Company Quality/Stock Attractiveness/Fundamental View/Market View/Factor score) and 5 undecorated fetched headers (Company/Sector/CMP/P/E/Change); every rendered row carries exactly 13 `td.derived` cells out of 18 total; computed `background-color` differed correctly between derived (`rgb(26, 33, 60)` header / `rgba(147, 130, 255, 0.06)` cell) and fetched (`rgb(16, 25, 43)` header / transparent cell).
- Sort verified per-column, both directions plus the third-click return to natural order, for every numeric column (CMP, P/E, Change, Composite score, Upside %, Risk score, Factor score — confirmed genuinely numeric, e.g. P/E ascending read `9.09 → 76.7 → 117`, which a lexicographic sort would have ordered `117 → 76.7 → 9.09`) and every ranked/deterministic text column (Company alphabetically; Recommendation/Confidence/Regime/Action/Fundamental View/Market View via their rank maps/scores, not rendered-HTML order); `sorted-asc`/`sorted-desc` header classes tracked correctly throughout.
- Resize verified on the Company column: widened 200px→280px and narrowed to the 60px floor via synthetic `Input.dispatchMouseEvent` drags on the real `.col-resize-handle` element (hit-tested via `elementFromPoint` first to confirm the drag target); the header's `sorted-*`/plain class never changed as a side effect of the drag (confirms the handle's `click`-listener `stopPropagation()` prevents an accidental sort); header/body column alignment measured pixel-exact (`mismatchCount: 0` across all 18 columns) after combining multiple sorts with the resize.
- Regression-checked the refactored `initTableColumnResize()` helper against its original caller, Watchlists → Custom: resize (130px→190px) and sort both still functioned with zero console errors captured via `Runtime.consoleAPICalled`.
- Caught and fixed one real regression before finishing (see the table row's own description): confirmed `position: sticky` restored on both a derived and a fetched `<th>` via `getComputedStyle` after the fix.
- No mutating route was ever called against the scratch server (only page loads, tab/subtab clicks, and DOM measurement/dispatch); `git status` on `data/watchlists/` after the session showed only the pre-existing uncommitted state already present at session start (`index.json`, `+3` untracked watchlist files), unrelated to this change. Scratch Chrome (headless, remote-debugging ports 9333/9334) and the scratch server (port 4189) were each terminated by exact PID before finishing.

**Watchlists → Custom: column-selection toolbar redesign** (2026-09-23): the
permanently-visible "Custom columns" panel (an `<h3>` + an always-open
paragraph of reorder/resize/sort instructions + 20 always-rendered checkbox
pills, occupying a full card above the table on every visit) is replaced
with a compact table toolbar — a `Columns N/20` button, a `Reset layout`
button, and a help `(i)` icon carrying the same instructional copy on
hover/focus (`helpIcon()`, the same untiered `.info-icon`/`.info-popover`
component `infoIcon()` already uses elsewhere) — directly above the table,
inside the same `.card-table-fill` article (no new card). Clicking Columns
opens a searchable popover (`#wl-custom-columns-popover`): a search box
filtering the 20 optional fields by label (case-insensitive substring,
display-only — never touches `wlCustomVisibleFields` or the rendered table),
the same checkbox list as before (now styled as stacked rows,
`.columns-item`, inside a scrollable `.columns-list`), and `Select all`/
`Clear all` buttons. The popover opens on click, stays open across multiple
checkbox toggles, and closes on an outside click or Escape — the same
dismissal convention already used by this app's other dropdowns. Locked
prefix columns (Company/Sector/CMP/P/E) were never part of the togglable
field list before this change and still aren't — they're `WL_CUSTOM_PREFIX`,
rendered unconditionally — so `Clear all` cannot produce an empty table by
construction, not via a separate minimum-columns guard; a static note in the
popover ("Company, Sector, CMP and P/E are always shown") makes that
explicit rather than leaving it implicit. `Reset layout` now fires two
listeners on the same button: the pre-existing generic
`initTableLayout(resetButtonId)` reset (order + widths) plus a new one that
restores all 20 optional fields to visible — together restoring the
complete default configuration in one click, where the old "Reset columns"
button only ever reset order/width. Column reorder, resize, sort, and the
fetched-vs-derived cell styling are all pre-existing mechanisms
(`initTableColumnDragGeneric`/`initTableColumnResize`/`sortForTable`/
`prefixCells`) — none were touched; only the field-visibility UI around the
table changed. `localStorage` keys are unchanged (`wlCustomFields`,
`stocksApp.tableLayout.wl-custom-table.v1`), so a real user's existing
customization survives this change instead of resetting. Files changed:
`index.html`, `script.js`, `styles.css` — no analytics/scoring/decision/
quant/provider/API change; scope is this one table only, per the redesign
brief's own explicit instruction (every other table's "Reset columns"
button/label/behavior is untouched).

**Validation**: `node --check` clean on `script.js`; `node --test`:
140/140 tests / 45 suites pass, unaffected (presentation-only change, no
pure-math module touched). Live validation with a zero-dependency Chrome
DevTools Protocol driver (Node 22's built-in `fetch`/`WebSocket`) driving
the system's real installed Chrome headless against a scratch server (port
4199, never the user's own dev server on 4173): 35/36 automated assertions
passed — old panel removed; toolbar renders `Columns 20/20`/`Reset layout`/
help icon; popover opens/closes on click, outside-click and Escape; search
"margin" correctly narrowed the list to EBITDA margin/Operating margin/Net
margin and clearing it restored all 20; unchecking ROE removed its `<th>`/
`<td>` and updated the count to `19/20` while the popover stayed open;
Select all/Clear all correctly went to `20/20`/`0/20` while the table kept
rendering (Company/Sector/CMP/P/E rows, never blank); clicking the Company
header sorted ascending with the `sorted-asc` class applied; dragging the
resize handle widened the Company column and did not trigger a sort;
simulated native drag-and-drop (`DataTransfer`, real `dragstart`/
`dragover`/`drop`/`dragend` events on the real `<th>` elements) moved Sector
before Company with body cells staying aligned to the new header order;
Reset layout restored Company-first order and 20/20 visible fields;
toggling RSI off, reloading the page, and re-checking confirmed the choice
survived via `localStorage`; zero duplicate DOM ids; zero console errors;
the active watchlist (`sub-100-growth-di-crossover-setup-monthly`) was
unchanged before vs. after the run. **One assertion failed and was root-
caused rather than dismissed**: after manually resizing a column and then
clicking Reset layout, the column did not shrink back to its original
narrower default width — traced to the pre-existing shared
`initTableLayout()`/`captureDefaultWidthsIfVisible()` engine (untouched by
this change), whose reset handler re-measures "default" width from the
live DOM *before* clearing the stale resized inline `style.width`, so it
captures the just-resized width as the new default instead of the table's
true original auto-layout width. Confirmed, via the same driver, that this
reproduces identically on an untouched table (Watchlist Research →
Valuation's `valuation-table`, unrelated to this change) — it is a
pre-existing defect in the generic engine shared by all 27 tables using
`initTableLayout`, not something this redesign introduced or could fix
within its own scope; recorded as **TD-15** in §4 rather than silently
patched. Scratch Chrome (headless, remote-debugging port 9333) and the
scratch server (port 4199) were each terminated by exact PID before
finishing; `git status` on `data/watchlists/` afterward showed only the
same pre-existing uncommitted state present at session start, unrelated to
this change.

**Macro extracted into its own top-level sidebar workspace (India Macro / US
Macro / World), separated from Market Intelligence; new Indian/US/World
equity-index data and a derived India Gold Rate ₹/10g figure** (2026-09-23):
per an explicit IA-redesign brief, India Macro and US Macro moved out of
`#market-intelligence`'s 6 sub-tabs into a new `.tab#macro` (sidebar item
inserted between Watchlist Research and Portfolio Analysis) with its own
India Macro / US Macro / World sub-tabs; India Macro further splits into a
nested Indian Indices / Commodities / Macro Indicators sub-nav (same 2-level
nesting pattern as the existing Sector Intelligence/Earnings & Events tabs).
Market Intelligence keeps Market Intelligence (regime/Data Quality only now)
/ Sector Intelligence / Earnings & Events / News & Catalysts, unmoved,
unchanged. New data (all via the existing unauthenticated Yahoo chart-feed
path, zero new fetch mechanism, zero new credential): NIFTY 50/BANKNIFTY/
NIFTY MIDCAP 50/SENSEX/India VIX (Indian Indices, in that exact required
order), S&P 500/Nasdaq Composite/Dow Jones/Russell 2000 (US Macro), Nikkei
225/Shanghai Composite/Hang Seng (World → Asia), FTSE 100/DAX/CAC 40 (World
→ Europe) — every ticker live-verified before being wired up (Shanghai
Composite needed `000001.SS`, not the commonly-cited `^SSEC`, which 404s on
Yahoo's chart endpoint). New derived India Gold Rate ₹/10g
(`data/providers/macroProvider.mjs`'s `goldInrPer10g()`: US gold USD/oz ×
USD/INR × 10/31.1034768, both fetched inputs), shown alongside its two
fetched inputs and the pre-existing India Gold Rate (Gold BeES ETF, unrelated
and unchanged) with the app's existing fetched-vs-derived `.derived` styling
and a new `metricRegistry.mjs` entry. `buildMacroSnapshot()`'s existing flat
`indicators` array (read by `classifyMarketRegime()`, the Committee Pack, and
Morning Briefing) is unchanged; a new additive `groups` object buckets the
same rows for the new tables, retiring the old client-side `MACRO_US_KEYS`
split.

**TD-15 resolved as a side effect of this pass** (see §4): live UI testing of
the new tables independently rediscovered the exact "Reset columns"
recapture bug already logged as TD-15 earlier the same day, on the new
`macro-unified-table`-style tables' resize *itself* not visually working at
all (a second, previously undocumented bug: a two-row `<thead>`'s second-row
`<th>.style.width` is silently ignored by `table-layout:fixed`, which only
reads the first row or a `<colgroup>` — fixed via a generic
`ensureColgroup()`, scoped only to multi-row-thead tables). Fixing TD-15
alongside it (clearing stale inline widths before `captureDefaultWidthsIfVisible()`
re-measures) was verified, via a control test, to also fix the original
`sector-intel-table` case TD-15 was logged against — one fix, not two.

**Validation**: `node --check` clean on every touched file
(`index.html`, `script.js`, `data/providers/macroProvider.mjs`,
`data/watchlist/macro.mjs`, `data/metadata/metricRegistry.mjs`,
`test/macroPeriodicIndicators.test.mjs`); `node --test`: 143/143 pass (140
pre-existing + 3 new `goldInrPer10g()` cases — no analytics/scoring/
decision/quant module touched). Live `GET /api/macro` against a scratch
server (port 4599, never the user's own dev server) confirmed all 24
indicators resolved `"Live"` (zero fabricated/guessed values) and the
derived gold figure matched the disclosed formula by hand-calculation
against the same response. Live browser validation (zero-dependency Chrome
DevTools Protocol driver, Node 22's built-in `fetch`/`WebSocket`, against the
same scratch server): 30 assertions covering the new IA (sidebar item,
sub-tab nesting, exact Indian Indices row order, fetched-vs-derived styling
on the derived gold row specifically), Market Intelligence's 4 remaining
sub-tabs and their pre-existing content untouched, the resize/persist/reset
fixes actually working (before confirmed broken, after confirmed fixed, with
a control-case re-check on `sector-intel-table`), zero duplicate DOM ids,
zero console errors — plus a 12-assertion full-sidebar regression sweep
(every workspace activates cleanly). Scratch Chrome and the scratch server
were each terminated by exact PID before finishing; `data/watchlists/`
file mtimes confirmed unchanged by this session's own validation runs.

**Macro commodity/currency presentation revision: global source prices
separated from India-denominated derived prices; India Macro → Currencies
(12 currencies) and US Macro → Commodities added** (2026-09-23, same-day
follow-on): a further brief found the just-shipped Macro workspace still
showed Gold/Crude Oil (WTI)/Natural Gas (Henry Hub) at their raw USD values
under India Macro → Commodities (an India label on a global price), with no
dedicated currency-conversion view beyond one USD/INR figure buried inside
that table as a derivation input. US Macro gained a new Commodities tab
(re-groups the same 3 already-fetched tickers, zero new fetch); India Macro
→ Commodities now shows only the derived INR conversions of those same
three values (Gold ₹/10g, Crude Oil ₹/bbl, Natural Gas ₹/MMBtu, each clearly
`.derived`-styled) plus the pre-existing, non-derived India Gold Rate ETF.
Two new pure functions (`usdToInr()`, `crossRateInr()`,
`data/providers/macroProvider.mjs`) extend the same "already-fetched USD
value × USD/INR" pattern `goldInrPer10g()` established; `toDerivedGoldIndicator()`
was generalized into a shared `toDerivedIndicator()` so all 4 derived rows
share one status/asOf-combination implementation. India Macro gained a new
4th tab, **Currencies**: 12 currencies vs. INR (USD, GBP, EUR, CHF, AUD, CAD,
AED, RUB, CNY, SGD, THB, VND) — USD/INR reused by reference (never
refetched) as the one canonical FX input shared with every commodity
derivation; 11 currencies resolve via a direct, live-verified Yahoo
`<CCY>INR=X` quote; VND is shown per 1,000 units (a new `displayScale` def
field, applied uniformly to price and every DMA) since its raw per-unit rate
is too small to round meaningfully; RUB has no direct ticker (`RUBINR=X`
404s, confirmed live) and is instead derived via a USD/RUB cross-rate
(`RUB=X`, fetched solely as an internal input, never rendered as its own
row). `metricRegistry.mjs`: `goldInrPer10g` broadened into
`commodityInrDerived` (covers all 3 derived commodities, not just gold,
rather than 2 near-duplicate new entries); new `currencyCrossRateInr` entry
for the RUB cross-rate; `macroIndicator` extended to enumerate the 11 new
tickers and the US/India commodity split.

**Validation**: `node --check` clean on every touched file; `node --test`:
151/151 pass (143 pre-existing + 8 net-new cases across 3 new suites in
`test/macroPeriodicIndicators.test.mjs` covering `usdToInr()`,
`crossRateInr()` and `CURRENCY_INDICATORS`' shape — no analytics/scoring/
decision/quant module touched). Live `GET /api/macro` against a scratch
server (port 4711, never the user's own dev server) confirmed all 37
indicators (up from 24) resolved `"Live"`, and every derived figure
hand-verified against the same response's raw legs (e.g. Crude Oil
90.2 US$/bbl × USD/INR 95.71 = ₹8,633.04/bbl, exact match). Two live browser
validation passes (zero-dependency Chrome DevTools Protocol driver, Node
22's built-in `fetch`/`WebSocket`, same scratch server): India Macro →
Currencies shows exactly the 12 required currencies in the exact required
order; India Macro → Commodities shows exactly 4 rows (3 derived + the
non-derived ETF, correctly distinguished by CSS class); US Macro →
Commodities shows exactly the 3 raw USD rows with corrected `US$/troy oz`/
`US$/bbl`/`US$/MMBtu` units; every new info-icon tooltip resolves to real
text; column sort works on the new table; both new tables' "Reset columns"
buttons are wired; a full 10-tab sidebar sweep plus a targeted re-check of
Indian Indices/Macro Indicators/World/Market Intelligence found each
unaffected; zero duplicate DOM ids; zero console errors. No incidental
writes to `data/watchlists/`; `data/cache/macro/` gained only the expected
new regenerable entries for the 10 new direct-quote currencies plus
`usdRub`. **Known, disclosed side effect, not fixed in this pass** (out of
its explicit commodity/currency-presentation scope): Morning Briefing's
"Market moves" card and the Weekly Committee Pack's macro-changes section
both iterate the full `indicators` array without truncation (pre-existing,
unchanged code) — that array grew from 24 to 37 rows, so both now render a
longer list than before; flagged here as a candidate follow-up if the
longer list proves too dense in practice. Files changed: `index.html`,
`script.js`, `data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`,
`data/metadata/metricRegistry.mjs`, `test/macroPeriodicIndicators.test.mjs`
— `styles.css` untouched (both new tables reuse existing classes).

**Macro one-table-per-tab + sticky-header fix — Periodic/Policy split out,
US Macro and World promoted to nested sub-tabs, native sticky headers wired
to every Macro table** (2026-09-23, same-day follow-on): a UX brief (with a
screenshot) found the Macro workspace violated this app's own one-table-per-
tab rule in three places and had no working sticky table header anywhere in
the workspace — the entire Macro section had shipped without the
`card-table-fill`/`sticky-thead-native` pair every other comparison table in
the app already uses (§2.4's "Table headers — native `position:sticky`
where genuinely possible" entry), so every Macro table's header scrolled
away with its rows, matching the reported screenshot exactly. Investigated
first, per the brief's own instruction: grepped `index.html`/`styles.css`
for the existing `card-table-fill`/`sticky-thead-native`/nested-
`.subtab-root` mechanism (Watchlist Research → Fundamentals → Quality →
Profitability/Balance sheet/Ownership, 3 levels deep, is the deepest
existing working reference) and reused it verbatim — no new scroll
architecture, no new CSS mechanism.

**One-table-per-tab fixes**: (1) India Macro → Macro Indicators had 3 tables
stacked in one panel (`macro-indicators-india` CPI/IIP, `macro-periodic-
table` Periodic/Policy, `macro-unavailable-table` Future Integration). The
CPI/IIP table keeps the Macro Indicators tab; Periodic and Future
Integration are merged into one table on a new 4th India Macro tab,
**Periodic / Policy** — they're two statuses of the same underlying concept
(a macro indicator with no live feed) and already share the same Indicator/
Category/Status columns, so merging them (rather than adding a 6th tab the
brief never asked for) satisfies one-table-per-tab without combining
unrelated datasets. `macro-unavailable-table` is retired; an unavailable
row simply has a blank Value/Period/As of/Source, which the existing
missing-data blank convention (§2.6) already renders correctly with zero
new code. `renderMacroTab()` (`script.js`) now concats `macroData.periodic`
and `macroData.unavailable` into one sorted/rendered table; no backend/data
change (`data/watchlist/macro.mjs`'s `periodic`/`unavailable` arrays are
completely unchanged, per the brief's explicit "don't touch calculations"
constraint). India Macro is now 5 tabs: Indian Indices / Commodities /
Macro Indicators / Periodic / Policy / Currencies. (2) US Macro had 3 tables
(`macro-indices-us`, `macro-rates-us`, `macro-commodities-us`) stacked
directly in one panel — promoted to a new nested `.subtab-root
#us-macro-detail` (Major Indices / Rates / Commodities), the same mechanism
India Macro's own nested sub-tab already uses, zero new JS (the generic
`$$('.tab,.subtab-root').forEach(initSubtabs)` wiring picks up a new root
automatically, same precedent as every prior IA relocation in this app).
(3) World had 2 tables (`macro-world-asia`, `macro-world-europe`) stacked
directly in one panel — promoted the same way to `.subtab-root
#world-macro-detail` (Asia / Europe).

**Sticky headers**: every Macro table's `<article class="card">` gained
`card-table-fill` and its `<table>` gained `sticky-thead-native` — the same
pair every other single-table-per-panel comparison table in the app already
carries, making that table's own `.scroll` wrapper the panel's one bounded,
real scroll box (native `position:sticky` on `thead th`, no JS clone). A
real, previously-latent CSS bug surfaced immediately: `macro-unified-table`
has a 2-row `<thead>` (a colspan group-label row — "Indicator Details" /
"Performance" / "Trend Parameters" — above the real column-header row), a
combination no existing `sticky-thead-native` table in the app had ever
used (confirmed by grep: `table-group-row` appears only on Macro tables).
The old rule (`.sticky-thead-native thead th{position:sticky;top:0}`)
pinned *both* rows to the same `top:0` offset, so they fought for the same
pixels and neither held position correctly — this is why the bug reproduced
even after adding the classes. Generalized the selector to `.sticky-thead-
native thead tr:last-child th` (`styles.css`): only the real column-header
row stays pinned; the group-label row scrolls away once passed, the same
way an outer sticky nav bar's own contents scroll out from under it. For
every pre-existing single-row-thead `sticky-thead-native` table, `tr:last-
child` selects the same (only) row as before — behaviorally identical,
confirmed via regression checks below.

**Validation**: `node --check` clean on every touched file (`script.js`,
`server.mjs`); `node --test`: 151/151 pass, unaffected (presentation/markup-
only change, no analytics/scoring/decision/quant module touched). Live
validation with Playwright driving real installed Chromium (scratch server,
port 4599, never the user's own dev server on 4173 — confirmed already
running and left untouched): 28/28 scripted assertions passed covering (a)
India Macro's 5 tabs in the exact required order, each showing exactly 1
`<table>`; (b) US Macro's 3 and World's 2 nested tabs, each exactly 1
table; (c) the merged Periodic/Policy table containing both a `Periodic`
and a `Future Integration` status row (9 total: 2 periodic + 7 unavailable);
(d) the sticky real-header `<th>` clamped exactly to its scroll container's
top edge after scrolling (measured directly on the `<th>`, not the `<tr>` —
an early version of this validation script measured the `<tr>` instead,
which does not reflect a sticky cell's visually-shifted position and
produced a false failure, corrected before concluding anything) while the
group-label row correctly scrolled out of view; (e) column resize on the
Currencies table (270px → 347px) and Reset columns restoring it exactly;
(f) column sort on Macro Indicators; (g) India Macro's sub-tab selection
surviving a full page reload; (h) zero duplicate DOM ids app-wide, zero
console errors. A follow-on regression sweep (14 more assertions) confirmed:
sticky-header clamping on every Macro table tall enough to overflow at
900px viewport height (most are not, at this row count — correctly skipped,
not a false pass); column reorder + reset works on the new single-row-thead
Periodic/Policy table; column reorder remains intentionally disabled on
every `macro-unified-table` (2-row thead, `allowReorder:false`, a pre-
existing exception predating this change — not something this fix enabled
or regressed); the Watchlists tab's floating-header-clone table and Market
Intelligence's Sector Intelligence sticky table (both reference
architectures used elsewhere in the app) still render/stick correctly. No
mutating route was ever called against the scratch server (only page loads,
tab/sub-tab clicks, scroll/resize/drag/sort DOM interactions); `data/
watchlists/` untouched. Files changed: `index.html`, `script.js`,
`styles.css` — no analytics/scoring/decision/quant/provider/API change, per
the brief's own explicit "information architecture and scrolling/layout
correction only" scope.

**World Asia/Europe — both sticky header rows frozen (not just the lower
one), plus a Country column** (2026-09-23, same-day follow-on): the entry
immediately above deliberately pinned only the real column-header row and
let the group-label row ("Indicator Details"/"Performance"/"Trend
Parameters") scroll away. A follow-up, screenshot-driven brief scoped to
World → Asia/Europe specifically called that a defect, not a
simplification — a professional fixed-header table keeps its whole header
frozen, not half of it — and asked for both rows frozen plus an explicit
Country column (Japan/China/Hong Kong; United Kingdom/Germany/France) on
just those two tables, reorderable/resizable/sortable/persisted the same
way every other managed column already is. Investigated first per the
brief's own instruction: since all 9 Macro tables share the identical
2-row-thead `macro-unified-table` shape, the sticky-header half of the fix
is one shared CSS change (`styles.css`, `.sticky-thead-native thead
tr:last-child th` split via `:has(.table-group-row)` into two rules — the
group row now pins at `top:0`, the real header row stacks immediately below
it at `top:25px`, that exact number now guaranteed by giving
`.table-group-row th` an explicit `line-height:12px` instead of relying on
the browser's unspecified default) — it corrects all 9 tables at once, not
just the two that gained a Country column. The Country column itself is
scoped to just World Asia/Europe: a new `country` field on
`WORLD_INDEX_INDICATORS` (`data/providers/macroProvider.mjs`, same static-
curation basis as the existing `label`/`category`), threaded through
`toIndicator()` (`data/watchlist/macro.mjs`) and a new `{ country: true }`
option on the shared `macroIndicatorRow()`/`renderMacroIndicatorTable()`
(`script.js`) used only at those two call sites, plus the matching `<th
data-sort="country">`/`colspan` changes in `index.html`. Column reorder
stays disabled for Country exactly as it already was for every other column
on these 9 tables (the pre-existing `allowReorder:false` 2-row-thead
exception — not a gap introduced here). `metricRegistry.mjs`'s
`macroIndicator` entry was extended to disclose the new field (no separate
registry key, same as `label`/`category`/`unit` before it). Full detail:
`system.md` §2.3's own dated entry for this change.

Validated live (Playwright, real installed Chromium, scratch server port
4599, user's own dev server on 4173 confirmed untouched): 39/39 scripted
assertions — Country column contents/default order correct on both tables;
both sticky rows confirmed motionless (measured on each `<th>` itself)
across a real scroll and a synthetic ~120-row-deep scroll to 3000px (the
live dataset is only 3 rows per table, too small for genuine overflow —
clone rows were injected client-side only, per the brief's own "don't
validate with 3 rows" instruction, never sent to the server); zero
gap/overlap between the two stacked rows; horizontal scroll keeps both rows
column-aligned; Country sort/resize/reload-persistence/Reset columns all
verified; zero duplicate DOM ids; zero console errors. Regression: the same
both-rows-sticky fix reconfirmed on `macro-indices-india` (2-row-thead,
gained no Country column — confirms nothing leaked onto it) and
`wr-overview-table` (single-row-thead) confirmed unaffected. `node --test`:
151/151 pass. Files changed: `index.html`, `script.js`, `styles.css`,
`data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`,
`data/metadata/metricRegistry.mjs` — no index value, calculation, trend,
DMA or recommendation logic touched.

**MoSPI configurable TLS mode + Future-Integration audit (2026-09-24).** A
task requested making the MoSPI TLS workaround configurable, registering/
testing a real authenticated MoSPI account, and auditing every
"Future Integration" item app-wide against MoSPI. The account-registration
part was explicitly declined by the user once the trade-off was shown
(reaching MoSPI's login endpoint today requires the same legacy-TLS-
renegotiation relaxation as CPI/IIP, which would mean sending a real password
over a connection with TLS's anti-MITM renegotiation protection disabled) —
login/signup remain unconditionally standard-TLS-only, unchanged from every
earlier ledger entry on this integration; no account was registered or
signed into, and no password was ever transmitted or logged. The rest of the
task proceeded:

- New `MOSPI_TLS_MODE` env var (`data/integrations/config.mjs`): `standard`
  (default, secure) or `legacy-renegotiation` (explicit opt-in). Governs only
  `fetchCpiPublic()`/`fetchIipPublic()`'s agent choice
  (`mospiClient.mjs`'s new `resolvePublicAgent()`) — the same
  already-user-approved, narrowly-scoped workaround from the 2026-09-08/09-09
  entries above, now switchable instead of hardcoded. Live-verified: default
  resolves to `standard`; `standard` mode's real CPI fetch fails with the
  same TLS error as always (no silent weakening); `legacy-renegotiation`
  mode's real CPI and IIP fetches both succeed; a `login()` call made with
  `MOSPI_TLS_MODE=legacy-renegotiation` set (deliberately fake, non-existent
  credentials — nothing real, nothing transmitted, since the TLS handshake
  itself fails first) still fails with the identical error as under
  `standard`, proving the setting cannot leak into the password-carrying
  path. Switching back to `standard` once MoSPI fixes its server needs only
  the env var changed, no code change. Configuration → Integrations now shows
  the running TLS mode with plain-language copy.
- Full Future-Integration audit against MoSPI/eSankhyiki specifically (not
  "any government source" — the narrower, previously-unasked question): all 7
  entries in `UNAVAILABLE_MACRO_INDICATORS` plus the 6 `Future Integration`
  earnings/estimates fields in `data/analytics/` are confirmed **not
  available from MoSPI** — each has a real official source, but it is always
  a different agency (RBI, CCIL/FBIL, Grid-India/CEA, PPAC, MCX, S&P Global)
  or, for the earnings fields, an entirely different domain (company-level
  analyst estimates, outside any national-statistics agency's mandate).
  Nothing new met the bar to implement; see `system.md` §3.10's dated entry
  and this ledger's TD-13 addendum (§6) for the full per-item reasoning. CPI
  and IIP remain the only two MoSPI datasets this app consumes, both public,
  both confirmed still working and unregressed by this change.
- **Validation**: `node --check` clean on every changed file and the
  repo-wide sweep; `node --test` all green, +3 new cases covering
  `resolvePublicAgent()`'s mode logic. Live checks against the real
  `api.mospi.gov.in` host confirmed both TLS modes behave as designed with
  zero credentials involved. Files changed: `data/integrations/config.mjs`,
  `data/integrations/mospiClient.mjs`, `data/integrations/mospiProvider.mjs`,
  `script.js`, `test/mospiIntegration.test.mjs`, `system.md`, this file.

---

**Non-MoSPI Future Integration implementation: All-India Power Demand goes
live via NPP; the other 7 re-confirmed deferred with per-row Source/status
metadata (2026-09-24, same-day follow-on).** A follow-on task asked this
app to implement the 7 remaining `UNAVAILABLE_MACRO_INDICATORS` (9 counting
PMI/crude-oil's split instruments) from their *authoritative non-MoSPI*
sources — the MoSPI-specific question was already closed by the audit
above. The user explicitly declined pursuing **data.gov.in** (India's Open
Government Data platform) as a source this session, even though it was
newly found to plausibly host some of these datasets, specifically because
CLAUDE.md requires the same explicit sign-off any new credentialed
integration got for MoSPI (data.gov.in requires a free, self-serve API key
— still a credential) and that sign-off was not sought here; it stays a
documented future option, not implemented.

- **Fresh live re-audit, not trusted from the 2026-09-08/09 conclusions**:
  every one of the 7 sources was re-tested directly this session (RBI
  homepage/WSS/DBIE, FBIL, CCIL, PPAC, MCX all fetched live). All 6 of the
  8 resulting rows (RBI repo rate, India 10Y G-Sec yield, Manufacturing PMI,
  Services PMI, Banking System Liquidity, India Crude Oil Indian Basket,
  India Crude Oil MCX, India Natural Gas MCX) confirmed the prior findings
  still hold — see `macroProvider.mjs`'s `UNAVAILABLE_MACRO_INDICATORS`
  comment for the full per-source write-up (FBIL's site is now a JS SPA
  shell still gated by the same Benchmark License Agreement; CCIL and MCX
  both return HTTP 403 to an unauthenticated automated request; PPAC's
  price table is populated client-side by JavaScript with JS-triggered,
  non-stable download links; RBI's repo rate is still a static HTML table
  on its own homepage, no JSON/CSV/API).
- **All-India Power Demand is the one indicator that moved to Live** — a
  genuinely new finding, not in either prior audit: National Power Portal
  (npp.gov.in, a Ministry of Power / National Informatics Centre platform)
  serves a real, public, unauthenticated JSON endpoint
  (`dashBoard/demandmet1chartdata?date=YYYY-MM-DD`) backing its own live
  dashboard — live-verified with a bare header-less GET (no API key, no
  cookies), real intraday "DEMAND MET" readings (~4-minute cadence),
  history reachable back at least a full year. Different from the CEA API
  (documented but non-functional, per 2026-09-09), Grid-India/POSOCO's
  PDF-only PSP reports, and NPP's own separate NPDMS API (registered
  government organizations only) — see `data/providers/nppProvider.mjs`.
  Implemented with the same cache-first/fetch-if-stale/provider-isolated
  shape as CPI/IIP, merged into the same India Macro → Macro Indicators
  table (`groups.indiaMacroIndicators`), never a separate table.
- **PMI and India Crude Oil/Natural Gas split into their distinct
  instruments** per the task's own explicit instruction: the former single
  `pmi` row is now `pmiManufacturing`/`pmiServices` (both S&P Global,
  commercial-only, confirmed again); the former combined `crudeOilIndia`
  row is now `crudeOilIndianBasket` (PPAC) and `crudeOilMcx` (MCX),
  alongside the pre-existing `naturalGasMcx` (MCX) — never conflated with
  WTI/Brent/Henry Hub.
- **Every unavailable row now carries real per-row Source metadata**
  (`source`/`sourceUrl`/`statusNote`) instead of one generic "Future
  Integration" label — the India Macro → Macro Indicators/Periodic-Policy
  table's Source column names the actual authoritative provider (RBI,
  FBIL / CCIL, S&P Global, PPAC, MCX) even for a row this app cannot fetch,
  and each row's status is now the specific reason: **Not Programmatically
  Available** (a real source exists but only as a browsable page/portal,
  never a stable API) or **Licensing Required** (a real source exists but
  needs a paid subscription or a signed license/ToS agreement this app does
  not have). CPI/IIP also gained a Source cell (MoSPI) for consistency — a
  new optional `{ source: true }` column, reusing the existing
  `macroIndicatorRow()`/`renderMacroIndicatorTable()` machinery the same
  way the World tables' optional Country column already works, added only
  to the one table that needed it (Indices/Currencies/US/World tables
  untouched).
- **No MoSPI code touched**: `data/integrations/` is unchanged by this
  task; the new NPP provider lives in `data/providers/` (unauthenticated,
  same tier as `yahooQuoteProvider.mjs`), never routed through the MoSPI
  client/credential path.
- **Validation**: `node --check` clean on every changed/repo-wide file;
  `node --test` 166/166 pass (+9 new cases: `nppPowerDemand.test.mjs`'s
  `pickLatestDemandMet()`/`istDateString()` pure-function coverage, plus
  `macroPeriodicIndicators.test.mjs` updated for the 8-row split and the
  new source/status/statusNote fields). Live: a scratch server's
  `GET /api/macro` (port 4711, never the user's own dev server) confirmed
  `powerDemand` genuinely `"status":"Live"` with a real NPP MW reading and
  timestamp, `dataQuality.futureIntegration: 8`; a zero-dependency Chrome
  DevTools Protocol driver (Node 22's built-in fetch/WebSocket against a
  real installed Chrome, headless) confirmed the India Macro → Macro
  Indicators tab renders exactly 3 rows (CPI/IIP/Power Demand) with a
  working Source column, the Periodic/Policy tab renders exactly 10 rows
  (2 Periodic + 8 unavailable) each with a real, non-generic Source cell
  and a specific status, column sort works, zero browser console errors.
- **What remains blocked, and why** (final Future Integration state): RBI
  Policy Repo Rate and Banking System Liquidity — **Not Programmatically
  Available** (RBI publishes both only as browsable HTML/portal pages, no
  API). India 10-Year G-Sec Yield — **Licensing Required** (FBIL requires a
  signed Benchmark License Agreement; CCIL blocks automated access).
  Manufacturing PMI and Services PMI — **Licensing Required** (S&P Global,
  commercial-only, no government or free alternative exists). India Crude
  Oil (Indian Basket) — **Not Programmatically Available** (PPAC's price
  page is JS-rendered with no stable download URL). India Crude Oil (MCX)
  and India Natural Gas (MCX) — **Licensing Required** (MCX blocks
  unauthenticated automated access; live/delayed data requires an
  MCX-authorized paid vendor). data.gov.in remains **investigated but not
  implemented**, pending explicit future sign-off.
- Files changed: `data/providers/nppProvider.mjs` (new),
  `data/providers/macroProvider.mjs`, `data/watchlist/macro.mjs`,
  `data/metadata/metricRegistry.mjs`, `index.html`, `script.js`,
  `test/nppPowerDemand.test.mjs` (new), `test/macroPeriodicIndicators.test.mjs`,
  `system.md`, this file.

---

**Compare workspace bug fix: landing on Compare no longer dead-ends on its
own "Turn on Compare Mode" instruction (2026-09-25).** The Compare sidebar
destination (`system.md` §2.3/§2 "Compare"), added in Phase 6.5 and kept as
the sole on/off entry point for the shared `compareMode`/`compareSymbols`
state by the 2026-08-29 IA redesign, requires `compareMode` to be `true`
before `renderCompareWorkspace()` will populate `#compare-valuation`/
`-technical`/`-risk` from `compareSymbols` at all — otherwise it always
renders the "Turn on Compare Mode above, then pick 2-4 companies" prompt,
regardless of how many companies are already in `compareSymbols`.
`compareMode` defaults to `false` and nothing set it when arriving at the
tab, so opening Compare fresh (the reported case: a 3-company watchlist,
sidebar → Compare) always showed the instructional dead-end even though the
three companies were sitting right there as pickable pills. Root cause was
this missing state transition, not a rendering, data, or CSS defect — traced
and ruled out: `renderCompareWorkspace()` is already wired into the shared
`render()` cascade (called on load/switch/refresh, same as every other
workspace) and reuses the exact same `compareGrid()` + `valuationDetail
Content`/`technicalDetailContent`/`riskDetailContent` builder functions
Valuation/Technicals/Risks already call — confirmed no second comparison
engine exists, so none was added. Fix: `activateWorkspaceTab()` now calls
the existing `setCompareMode(true)` (the same canonical setter the
"Turn on/off Compare Mode" button already called) when the destination is
`'compare'` and `compareMode` is currently off — one four-line conditional,
no new state, no new render path. The button stays as the one way to turn
Compare Mode back off for the rest of that visit (e.g. to fall back to
single-company selection on Valuation/Technicals/Risks elsewhere); leaving
and re-entering the Compare tab turns it back on, consistent with this being
Compare Mode's dedicated home. The pre-existing "For a Profitability
comparison, use Watchlist Research → Quality → Profitability" instruction
was checked against the same `compareMode`/`compareSymbols` state Quality's
Profitability table already filters on (`script.js`, `renderProfitability`
call sites) and found accurate, not a dead end — left unchanged; no
Profitability tab was added to Compare, per the single-comparison-engine
rule.
- **Validation**: `node --check` clean on `script.js`; `node --test`
  166/166 pass (unaffected — this change is outside `test/`'s pure-math
  scope, a UI state-wiring fix). Live: a scratch Playwright/Chromium
  instance (installed to the OS-level Playwright cache only, never added to
  this zero-dependency repo's own dependencies) drove the real dev server
  against the actual `sub-100-growth-di-crossover-setup-monthly` watchlist
  (AMD Industries/The Ugar Sugar Works/Jyoti CNC Automation, the reported
  case) end to end: Compare tab click auto-enables Compare Mode and shows
  all 3 real pills; selecting them renders the Valuation (2 grids),
  Technicals (2 grids) and Risks (5 grids) comparison content; deselecting
  down to 2 still renders (only <2 falls back to the prompt); the
  Turn-off/Turn-on button round-trips correctly and re-entering the tab
  re-enables it; Refresh Data preserves the selection and re-renders the
  comparison; Watchlist Research's own tables (unrelated to this fix)
  rendered 44 rows unaffected. Zero browser console/page errors across the
  whole run.
- Files changed: `script.js`, this file.

---

## 3. Milestone timeline

```
2026-08-11  Flow Integrity Audit remediation → Dashboard IA restructuring
2026-08-12  Phase 1 (data layer + scoring) → Stock Metrics tab split
2026-08-13  Phase 2 (institutional analytics) → audit → Phase 3a (analytical integrity)
2026-08-14  Phase 3b → 3c → 3d → 3e → 3f → Governance foundation
2026-08-15  Governance adoption & enforcement → Phase 4 Stage 1 (decision layer) → Stage 2 (UI integration) → Stage 3 (calibration, performance, governance finalization) → Phase 5 (institutional research + Portfolio Review Pack)
2026-08-16  Phase 6 (macro/sector/exposure/earnings/event/news intelligence, Morning Briefing, Weekly Investment Committee Pack) → Phase 6.5 (sidebar navigation & UX restructuring) → Phase 7 Stage 1 (quantitative data model & factor engine) → Phase 7 Stage 2 (benchmark & performance engine)
2026-08-17  Institutional research foundation upgrade (evidence hierarchy, Company Quality/Stock Attractiveness split, peer-framework correction, valuation-precision/confidence coupling, Research Quality Gates, Fundamental/Market/Timing separation, thesis breakers, forward-estimate foundation contracts, 2 new report sections) → Automated test layer for pure-math analytics modules (TD-4/02.11) → CI Integration (07.2)
2026-08-28  Sector Research data-source investigation (verdict: no — deferred, TD-10/03.8) → UX/IA redesign (Company Research / Watchlist Research split, Sector Research reserved as a disabled nav placeholder)
```

No phase has ever shipped without a same-day (or next-entry) validation pass.
Every "Known limitations" disclosure from a completed phase remains true
today unless a later item in §5 explicitly resolves it.

---

## 4. Outstanding technical debt (carried forward)

Items raised by the Post-Phase-2 audit and never resolved by any subsequent
phase through 3f. Each is also referenced from its owning domain in §5.

| ID | Item | Priority | Status | Complexity |
|---|---|---|---|---|
| TD-1 | Sector-risk lookup should also match `company.industry`, not just `.sector` (all 7 Defence-watchlist stocks fall to a generic baseline today) | P1 | Not started | S |
| TD-2 | Reseed `PGCIL.NS` → `POWERGRID.NS` (invalid ticker, confirmed 404, blank row in the Power watchlist since seeding) | P1 | Not started | XS |
| TD-3 | Distinct "fetch failed" vs. "never fetched" UI state, with one automatic retry before giving up | P2 | Not started | M |
| TD-4 | Automated test layer for pure-math analytics modules (`dcf.mjs`, `priceSeries.mjs`, `institutionalRisk.mjs`, `portfolio.mjs`'s `resolveWeights`) — flagged repeatedly as the single biggest structural gap | **P0** | ✅ Completed 2026-08-17 (`test/`, `node --test`, 109/109 passing — see §2 ledger and `system.md` §4.7; extending coverage beyond the 4 named modules to `data/scoring/`/`data/decision/`/`data/quant/` remains open, tracked as a natural follow-on, not a new item) | L |
| TD-5 | Dedupe the debt-trend calculation in `institutionalRisk.mjs` (`financialRisk()`/`governanceRisk()` each recompute it independently) | P3 | Not started | XS |
| TD-6 | Extract one shared `groupBySector()` helper (reimplemented independently 3×: `portfolio.mjs` ×2, `relativeValuation.mjs`) | P3 | Not started | XS |
| TD-7 | Delete the dead `pearsonCorrelation` export in `priceSeries.mjs` (superseded by `correlationFromPrepared`) | P3 | Not started | XS |
| TD-8 | `card()` helper should auto-escape by default, with an explicit raw-HTML opt-out (fragile-by-convention; hand-audited as not currently exploited) | P2 | Not started | S |
| TD-9 | Add a `pctAbs()` formatter for non-directional magnitudes (WACC, volatility, position weight currently render with a misleading "+" prefix via `pct()`) | P3 | Not started | S |
| TD-12 | No persisted historical snapshot for macro/sector-intelligence data — the Weekly Investment Committee Pack's macro/sector "changes" sections show current state + each indicator's own trailing-window change, not a true week-over-week diff (unlike per-company portfolio changes, which do have this via `snapshotCache.mjs`) | P2 | Not started | M |
| TD-15 | `initTableLayout()`'s "Reset columns"/"Reset layout" button doesn't restore a manually-resized column's true original width — `captureDefaultWidthsIfVisible()` re-measures "default" width from the live DOM before the reset handler clears the stale resized inline `style.width`, so it captures the just-resized width as the new default instead. Reproduces on every table using the shared engine (confirmed on both `wl-custom-table` and `valuation-table`, 2026-09-23), not table-specific. Fix: clear each `<th>`'s inline `style.width` (or drop `table-layout-managed`) before calling `captureDefaultWidthsIfVisible()` in the reset handler | P2 | ✅ Completed 2026-09-23 (fixed exactly as prescribed here, found independently again while validating the new Macro workspace's tables — see §2 ledger's Macro IA entry; also confirmed fixed live on the pre-existing `sector-intel-table` as a control case) | XS |

TD-10 (market-wide peer database), TD-11 (empirical calibration of scoring
coefficients) and TD-13/TD-14 (macro/earnings/event calendar data sources,
below) are tracked in §6 as explicitly deferred rather than pending — all are
blocked on external data access, not on engineering effort.

TD-4 is now Completed (2026-08-17, see above and the §2 ledger). 07.2 (CI)
is also now Completed (2026-08-17, see §2 ledger) — `.github/workflows/ci.yml`
runs `node --check` and the existing `node --test` suite as mandatory gates
on every push/PR. The `data/scoring/`/`data/decision/`/`data/quant/` modules
07.3 will eventually also want covered remain a follow-on, not a blocker.

---

## 5. Domain roadmap

### 01. Governance foundation

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 01.1 | Repository governance foundation (`system.md`, this roadmap, `CLAUDE.md`) | P0 | None | ✅ Completed | M | Cross-reference validation report |
| 01.2 | Architecture governance — keep `system.md` synchronized with every structural change | P0 | 01.1 | Ongoing (process, not a one-time deliverable) | — | `system.md` diff reviewed in the same change that alters a module boundary, route, or folder purpose |
| 01.3 | Documentation governance — archive policy, no document proliferation | P1 | 01.1 | ✅ Completed (see `system.md` §8) | S | N/A — policy adopted |
| 01.4 | Coding standards — formalize existing informal conventions (module purity, atomic writes, normalized provider shape, mandatory metric tagging) | P2 | 01.1 | Not started | S | Doc review only; consider a lint rule once 07.2 (CI) exists |
| 01.5 | Review process — formalize the existing per-phase discipline (update roadmap status, `node --check`, live/Playwright walkthrough, update `system.md` if architecture changed) | P1 | 01.1 | ✅ Completed (documents established practice) | S | This roadmap's own maintenance is the ongoing check |
| 01.6 | Release governance — introduce git tags at phase boundaries going forward (no versioning scheme exists today) | P3 | None | Not started | S | First tag applied at the next completed phase |

### 02. Core platform

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 02.1 | Watchlist persistence & CRUD | — | — | ✅ Completed | — | See §2 |
| 02.2 | Company context / cross-tab synchronization | — | — | ✅ Completed (Phase 3f) | — | See §2 |
| 02.3 | Two-level sub-tab navigation | — | — | ✅ Completed (Phase 3e) | — | See §2 |
| 02.4 | Institutional autocomplete search | — | — | ✅ Completed (Phase 3c) | — | See §2 |
| 02.5 | Core analytics engines (valuation/technical/portfolio/risk/scoring) | — | — | ✅ Completed (Phase 1, 2, 3a, 3b) | — | See §2; ongoing calibration tracked in domain 03 |
| 02.6 | Caching (in-memory + on-disk, TTL/`networkPass` semantics) | — | — | ✅ Completed | — | See §2 |
| 02.7 | Frontend state management (`currentData`, `activeCompanySymbol`) | — | — | ✅ Completed (Phase 3f) | — | See §2 |
| 02.8 | Sector-risk lookup should also match `industry` (**= TD-1**) | P1 | None | Not started | S | Live `buildResearch()` check across the Defence watchlist |
| 02.9 | Reseed `PGCIL.NS` → `POWERGRID.NS` (**= TD-2**) | P1 | None | Not started | XS | Live fetch confirms resolution; audit remaining seed tickers |
| 02.10 | Fetch-failed vs. never-fetched UI state + one retry (**= TD-3**) | P2 | None | Not started | M | Simulate a 404 symbol; confirm distinct state and single retry |
| 02.11 | Automated test layer for pure-math modules (**= TD-4**) | **P0** | None | ✅ Completed 2026-08-17 | L | Coverage of `dcf.mjs`, `priceSeries.mjs`, `institutionalRisk.mjs`, `resolveWeights` at minimum — done, 109/109 passing (`test/`, see §2 ledger, `system.md` §4.7); unblocks 07.2/07.3 |
| 02.12 | Dedupe debt-trend calculation (**= TD-5**) | P3 | None | Not started | XS | `node --check`; confirm identical output pre/post refactor |
| 02.13 | Extract shared `groupBySector()` (**= TD-6**) | P3 | None | Not started | XS | `node --check`; confirm identical grouping output at all 3 call sites |
| 02.14 | Delete dead `pearsonCorrelation` export (**= TD-7**) | P3 | None | Not started | XS | Grep confirms zero remaining callers before deletion |
| 02.15 | `card()` auto-escape by default (**= TD-8**) | P2 | None | Not started | S | Audit every call site for a raw-HTML opt-out need before flipping the default |
| 02.16 | `pctAbs()` formatter batch (**= TD-9**) | P3 | None | Not started | S | Visual confirmation across WACC/volatility/position-weight displays |

### 03. Research platform

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 03.1 | Sector-aware valuation engine (DCF gate + financial-sector model) | — | — | ✅ Completed (Phase 3a) | — | See §2 |
| 03.2 | Unified recommendation engine | — | — | ✅ Completed (Phase 3a) | — | See §2 |
| 03.3 | Relative valuation two-pass engine | — | — | ✅ Completed (Phase 3b) | — | See §2 |
| 03.4 | Technical scorecard enhancements | — | — | ✅ Completed (Phase 3b) | — | See §2 |
| 03.5 | Portfolio analytics calibration | — | — | ✅ Completed (Phase 3b) | — | See §2 |
| 03.6 | Institutional risk framework | — | — | ✅ Completed (Phase 2) | — | See §2 |
| 03.7 | Piotroski F-Score / Altman Z-Score / EV-EBITDA percentile | P3 | A Current-Assets/Liabilities and Cash/Net-Debt data source | Blocked | M | N/A until data source exists — must not ship a partial/misrepresentative score |
| 03.8 | Market-wide sector/peer database (beyond watchlist-scoped comparison) | P3 | A paid data vendor decision | Deferred (§6) | L (integration is straightforward via `system.md` §3.3's provider abstraction — the blocker is data access) | N/A until sourced |
| 03.9 | Empirical calibration/backtesting of heuristic scoring coefficients | P3 | A historical-outcomes dataset (none sourced) | Deferred (§6) | XL | N/A until a dataset exists |
| 03.10 | Macro Intelligence (real Yahoo-ticker indicators + Data Quality panel; RBI/PMI/IIP/CPI/etc. explicitly deferred, see §6) | — | — | ✅ Completed (Phase 6) | — | See §2 |
| 03.11 | Market Regime Detection | — | — | ✅ Completed (Phase 6) | — | See §2 |
| 03.12 | Sector Intelligence (cross-watchlist rollup) | — | — | ✅ Completed (Phase 6) | — | See §2 |
| 03.13 | Forward-estimate model (management guidance vs. system estimate vs. actual, per metric/period) — foundation contract shipped (`data/analytics/forwardFramework.mjs`'s `forwardEstimateFramework()`) | P2 | A forward-estimate/analyst-consensus data source (none sourced) | Deferred (§6) | L | N/A until sourced — foundation contract complete, no real computation yet |
| 03.14 | Management execution / credibility tracking (guidance → target → actual → variance → delivery status) — foundation contract shipped (`managementCredibilityFramework()`) | P2 | An investor-presentation/concall/transcript data source (none sourced) | Deferred (§6) | L | N/A until sourced |
| 03.15 | Segment-level economics (revenue/margin/EBITDA/capacity/utilization by business segment) — foundation contract shipped (`segmentEconomicsFramework()`) | P2 | A segment/business-unit financial breakdown data source (Screener.in does not expose one — `dataCompleteness.segments` is hardcoded `false`) | Deferred (§6) | L | N/A until sourced |
| 03.16 | Capacity/utilization economics (capacity × utilization × realization → revenue potential) — foundation contract shipped (`capacityUtilizationFramework()`) | P3 | A capacity/utilization data source (none sourced) | Deferred (§6) | M | N/A until sourced |
| 03.17 | Empirical recalibration of the scoring framework toward a 10-factor weighted table (Business Quality/Growth/Management/Competitive Position/Valuation/Financial Risk/Sector/Catalysts/Technical/Portfolio Fit) — the Company Quality/Stock Attractiveness split (§4.6) is the structural prerequisite this shipped | P3 | A historical-outcomes dataset (none sourced) — same blocker as TD-11 | Deferred (§6) | L | N/A until a dataset exists; extends TD-11/03.9, does not replace it |

### 04. Reporting

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 04.1 | Institutional research reporting engine (report model, printable page, PDF export) | — | — | ✅ Completed (Phase 3d); extended to a full 15-section institutional research note (Thesis Tracking, Target Price Rationale, Scenario Analysis, Portfolio Context, Explainability, 7-category catalyst taxonomy) in Phase 5 | — | See §2 |
| 04.2 | On-screen paged-media pagination simulation | P3 | None | Not started (explicitly out of scope under the zero-dependency constraint unless revisited) | M | Visual confirmation of page-break placement matching print output |
| 04.3 | Bulk/portfolio-level report export (multi-company single PDF, bundling each company's own per-company report) | P3 | 04.1 | Not started — distinct from 04.5 below (an aggregate portfolio-level document, not a bundle of per-company reports) | M | Same WYSIWYG print validation as 04.1, extended to N companies |
| 04.4 | Report customization (user-selectable sections/branding) | P3 | 04.1 | Not started | M | Manual walkthrough of each customization toggle |
| 04.5 | Portfolio Review Pack (investment-committee document: summary/valuation/concentration/sector positioning/opportunities/risks/health/action priorities/rebalancing) | — | — | ✅ Completed (Phase 5) | — | See §2 |
| 04.6 | Weekly Investment Committee Pack (portfolio/macro/sector/thesis changes + recommended actions) | — | — | ✅ Completed (Phase 6) | — | See §2 |

### 05. Portfolio intelligence

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 05.1 | Portfolio dashboard (weights, allocation, correlation, attribution, scenarios) | — | — | ✅ Completed (Phase 2, deepened 3b) | — | See §2 |
| 05.2 | Cash allocation modeling | — | — | ✅ Completed (Phase 3b) | — | See §2 |
| 05.3 | Monitoring & alerts (price/valuation/technical threshold notifications) | P1 | ~~A scheduler/background process~~ turned out unnecessary — computed synchronously inside `buildResearch()`, gated on each company's own genuine `fetchedAt` refresh, never a timer (`data/decision/alerts.mjs`) | Stage 1+2+3 implemented & calibrated (Risks → Alerts sub-tab, severity filter, acknowledge route; Stage 3 graduated severity across every alert type, added lifecycle escalation/re-trigger/stale-ack cleanup) | L | ✅ `node --check` + live payload checks (Stage 1) + full click-through incl. acknowledge round-trip (Stage 2) + severity-tier/escalation/re-trigger live tests + cross-watchlist distribution sanity check (Stage 3) — see the Phase 4 Stage 1+2 and Stage 3 ledger entries above. Multi-day false-positive soak still outstanding |
| 05.4 | Rebalancing suggestions (target-weight drift) | P2 | 02.7 cash allocation model (done) | Stage 1+2+3 implemented & calibrated (Portfolio → Health & Rebalancing table, Dashboard → Committee View priorities; Stage 3 added Action Score's resolved-coverage cap, feeding rebalancing's inputs) | M | ✅ See Phase 4 Stage 1+2 and Stage 3 ledger entries above. Hand-computed-drift cross-check against a known watchlist still outstanding |
| 05.5 | Portfolio health scoring over time | P2 | Historical portfolio-metric snapshotting (now persisted — `data/watchlist/snapshotCache.mjs`, `data/cache/watchlistSnapshots/<id>.json`) | Stage 1+2+3 implemented & calibrated (Portfolio → Health & Rebalancing score/trend/contributors/history; Stage 3 fixed a duplicate per-request `portfolioHealthScore()` computation and the cache-only-write performance regression) | M | ✅ Snapshot persistence confirmed via direct file inspection; trend line renders from the persisted `healthHistory` array; cache-only response time re-measured at 24-59ms post-Stage-3 (was 185-300ms). Survives-restart + manually-reconstructed-history cross-check still outstanding |
| 05.6 | Proactive decision support (buy/sell/trim surfaced without an explicit request) | P2 | 05.3, 05.5 | Partially implemented via Action Score/Action Required (Dashboard → Portfolio Intelligence, Committee View) — no push/notification surfacing exists (still requires the user to open the tab) | L | Manual review of suggestion quality against a known portfolio state still outstanding |
| 05.7 | Thesis tracking (Intact/Improving/Weakening/Broken classification per company, with reasons) | P2 | 05.3 (reuses change-detection's snapshot diff) | ✅ Completed (Phase 5) — `data/decision/thesisTracking.mjs`, `intelligence.thesis[symbol]`, surfaced in the per-company report's Thesis Tracking + Investment Conclusion sections | M | Live `buildResearch()` checks across 5 watchlists confirmed `intelligence.thesis` populates for every resolved company with correct baseline/no-change semantics; hard "Broken" triggers (2+ tier downgrade, fall to Sell, critical risk crossing) verified via code review — no watchlist in the seeded data currently exercises a hard trigger live |
| 05.8 | Portfolio Exposure Matrix (interest-rate/currency/commodity/regulatory/economic-cycle sensitivity, per-company + portfolio-weighted rollup) | — | — | ✅ Completed (Phase 6) | — | See §2 |
| 05.9 | Earnings Intelligence (real quarterly revenue/profit/margin deltas; calendar-dependent fields explicitly deferred, see §6) | — | — | ✅ Completed (Phase 6) | — | See §2 |
| 05.10 | Portfolio Event Calendar (real dated news items; earnings/dividend/buyback/regulatory dates explicitly deferred, see §6) | — | — | ✅ Completed (Phase 6) | — | See §2 |
| 05.11 | News Intelligence upgrade (sentiment classification + affected-thesis-driver mapping) | — | — | ✅ Completed (Phase 6) | — | See §2 |
| 05.12 | Morning Briefing (Dashboard default sub-tab: overnight moves, regime, alerts, opportunities/risks, top news) | — | — | ✅ Completed (Phase 6) | — | See §2 |

### 06. Mobile platform (Android)

Android is a first-class workstream, not an afterthought — tracked with the
same rigor as the web platform.

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 06.1 | Android architecture decision (native Kotlin vs. WebView wrapper vs. Kotlin Multiplatform) | P1 | None (should follow 07.1/07.6 sequencing below) | Not started | M (decision + spike) | A written decision record comparing the three options against this app's zero-dependency, single-maintainer constraints |
| 06.2 | Mobile REST client against the existing `/api/` surface | P1 | 06.1 | Not started | M | No server changes anticipated for a first read-only client — `system.md` §3.2's route table is already a stateless JSON REST surface |
| 06.3 | Offline mode / local caching mirror | P2 | 06.2 | Not started | M | Should mirror the existing disk-cache-first pattern (`system.md` §3.4), not a new offline strategy |
| 06.4 | Synchronization (multi-device watchlist/portfolio state) | P2 | 06.2, 07.1 (hosted reachability) | Not started | L | Requires a genuinely new architectural capability — today there is no multi-client concept at all (single local server, single browser) |
| 06.5 | Push notifications (price/valuation alerts) | P2 | 05.3 (server-side alerting must exist first) | Not started | M | Confirm delivery latency and no duplicate/missed alerts across a soak test |
| 06.6 | Report viewing on mobile | P2 | 06.2 | Not started | S | `report.html`'s inline-SVG, single-stylesheet construction (`system.md` §2.5) should port with minimal translation |
| 06.7 | Portfolio monitoring on mobile | P2 | 06.2, 05.x | Not started | M | Parity check against the web Portfolio tab for a known watchlist |

### 07. Infrastructure

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 07.1 | Deployment (currently: `run.bat`/`killserver.bat` start/stop a local process only — no hosting target exists) | P2 (P1 if 06.4 is pursued — a mobile client needs a reachable server) | None | Not started | M | A deployed instance reachable outside localhost, with 07.6 (security) satisfied first |
| 07.2 | CI — minimal first step: a GitHub Actions job running `node --check` over every `.mjs`/`.js` file on push, now also running `node --test` (unblocked by 02.11) | P1 | None (02.11 done, so a CI job can now run both gates from day one) | ✅ Completed 2026-08-17 (`.github/workflows/ci.yml`, see §2 ledger and `system.md` §4.7/§7) | S | CI job goes green on a clean push, red on an intentionally broken file or a failing test — validated locally by intentionally breaking a file (`node --check` failed, exit 1) and a test (`node --test` failed, exit 1), both restored after |
| 07.3 | Testing infrastructure (what CI runs beyond `node --check`) | — | 02.11 / TD-4 | ✅ Foundation completed 2026-08-17 (`test/`, `node --test`, 4 modules) — extending coverage to `data/scoring/`/`data/decision/`/`data/quant/` remains open | — | See 02.11; further coverage validated the same way (`node --test`, hand-computed expected values) as each module is added |
| 07.4 | Performance baseline & regression tracking | P3 (until 06.x/07.1 changes the profile) | None | Baseline ✅ measured (cold boot ~460ms, cache-only ~40–80ms, forced refresh ~0.8–2.4s for 6–10 stocks, ~40–53MB memory, no observed leak across ~15 refresh cycles); ongoing automated tracking Not started | S | Re-measure after any change touching `research.mjs`'s per-stock pass |
| 07.5 | Observability (logging/metrics/error tracking — none exists beyond `console.log`) | P3 (single-user local tool); **P1 if 07.1 is pursued** | 07.1 (re-prioritization trigger) | Not started | M | N/A until prioritized |
| 07.6 | Security (no authentication exists today — acceptable only while bound to `localhost`) | **P0 conditional on 07.1/06.4** (P3 otherwise) | None | Not started | M | Any deployment plan for 07.1 or 06.4 must pass a security review adding authentication before exposure — this is a hard gate |
| 07.7 | Backups (`data/watchlists/` and `data/cache/` have no backup mechanism beyond the OS/filesystem) | P2 | None | Not started | S | Scheduled copy of `data/watchlists/` (the only non-regenerable state — `data/cache/` is disposable) verified restorable |

### 08. Documentation

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 08.1 | Authoritative architecture doc (`system.md`) | — | — | ✅ Completed | — | See §2 |
| 08.2 | Governance roadmap (this document) | — | — | ✅ Completed | — | See §2 |
| 08.3 | Claude Code repository entry point (`CLAUDE.md`) | — | — | ✅ Completed | — | See §2 |
| 08.4 | Developer docs (module-level READMEs, contribution guide) | P3 | None | Not started | S | Revisit if collaborators join — solo project today |
| 08.5 | User docs beyond `README.md`'s quick-start | P3 | None | Not started | S | N/A until prioritized |
| 08.6 | Formal API reference (beyond `system.md` §3.2's route table) | P3 | 06.2 (external clients raise the cost of API drift) | Not started | S | Only worth the duplication risk once mobile/external clients depend on API stability |

### 09. Quantitative research & portfolio construction (Phase 7)

Staged per the phase brief (`system.md` §3.9); each stage is validated before
the next starts, same discipline as Phase 4's 3-stage rollout. Every module
is a pure composition/normalization layer over already-computed
`data/analytics`/`data/scoring`/`data/decision` output — no second
valuation, technical, risk or recommendation engine.

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 09.1 | Quantitative data model + factor engine (`data/quant/config.mjs`, `factorEngine.mjs` — institutional Value/Quality/Growth/Momentum/Risk/Size factor profiles, sector-relative percentile normalization, composite Factor Score) | P1 | None | ✅ Completed (Stage 1) | M | See §2 |
| 09.2 | Benchmark + performance engine (benchmark-relative return/beta/volatility/drawdown/tracking error using the already-cached NIFTY 50/US benchmark series; 1M/3M/6M/1Y/3Y/5Y CAGR/Sharpe-like/Sortino-like returns) | P1 | 09.1 | ✅ Completed (Stage 2) | M | See §2 |
| 09.3 | Backtesting framework (point-in-time replay of recommendation/Action Score/factor/valuation/technical signals over the existing 5y weekly price history; no look-ahead bias; cumulative return/CAGR/volatility/max drawdown/win rate/profit factor/turnover) | P1 | 09.2 | Not started (Stage 3) | L | Historical-integrity checklist (Phase 7 brief §22) must pass explicitly before this stage can be marked complete; illustrative-results disclaimer mandatory on every output |
| 09.4 | Portfolio construction (equal/score/risk/conviction/target-weight) + position sizing + risk budgeting | P2 | 09.1, existing `portfolio.mjs`/`correlation.mjs`/`positionRiskContribution` | Not started (Stage 4) | M | Recommendations only — must never silently mutate a watchlist's real `targetWeightPct` |
| 09.5 | Attribution extension + quantitative UI (Dashboard "Quantitative Overview," Research company-level factor profile, Compare factor/performance columns) | P2 | 09.1–09.4 | Not started (Stage 5) | M | Reuses existing sidebar/sub-tab architecture (§2.3) — no third navigation level; Playwright/jsdom walkthrough required (first UI-facing stage of this phase) |
| 09.6 | Quantitative outputs in Company Research Reports / Portfolio Review Pack + final Phase 7 governance close-out | P3 | 09.1–09.5 | Not started (Stage 6) | S | Same WYSIWYG print validation as existing report sections (§04.1) |

**Binding product rule** (Phase 7 brief §26): the Factor Score / quantitative
signals never override or average into the Portfolio Action Score or the
unified recommendation engine, which remain this app's primary decision-
layer signals. Where they disagree, the UI (Stage 5) must show the conflict
explicitly, not blend it into one opaque number.

---

## 6. Explicitly deferred work

These items are not "not started" — they are blocked on something outside
this codebase's control, restated here rather than re-litigated every phase:

- **TD-10 / 03.8 — Market-wide sector/peer database.** Blocked on a paid data
  vendor decision (cost, not engineering effort, is the blocker). The
  provider abstraction (`system.md` §3.3) already supports adding this
  without touching analytics or scoring code once a source is chosen.
- **TD-11 / 03.9 — Empirical calibration/backtesting of scoring
  coefficients.** Blocked on a historical-outcomes dataset this app has no
  source for. Every weighting in the recommendation, risk, and factor-
  exposure engines is disclosed as a heuristic (`system.md` §6) precisely
  because this calibration hasn't happened.
- **03.7 — Piotroski F-Score, Altman Z-Score, EV/EBITDA percentile.** Blocked
  on a Current-Assets/Liabilities split and Cash/Net-Debt figures Screener.in
  does not expose. Shipping a partial version of either formula would
  misrepresent it — these render explicit "N/A" by design, not by omission.
- **TD-13 (Phase 6, re-evaluated 2026-09-07, partially resolved 2026-09-08,
  All-India power demand resolved 2026-09-24) — Macro indicators beyond the
  7 Yahoo-ticker-sourced ones.** RBI policy repo rate, India 10-Year G-Sec
  yield, PMI (Manufacturing/Services), ethanol blending policy, Union
  defence budget, banking system liquidity, and India Crude Oil/Natural Gas
  (Indian Basket/MCX crude, MCX natural gas — 8 rows remaining as of
  2026-09-24) have no free, unauthenticated, legally-usable, machine-
  readable public source at the accuracy/freshness this app requires.
  All-India power demand moved to Live 2026-09-24 — National Power Portal's
  dashboard-backing JSON endpoint, see the dated update below.
  The 2026-09-07 India/US Macro peer-tab pass re-evaluated this list directly
  rather than assuming it was still current: FRED's free, unauthenticated
  `fredgraph.csv` endpoint is reachable and does carry India-tagged OECD
  series, but the candidates found were either the wrong measure (a market-
  determined interbank rate, not the RBI's own policy repo rate) or 18-31
  months stale — both fail this app's own Live/Delayed bar, so presenting
  either was rejected rather than accepted as a partial win.

  **2026-09-08 mandatory feasibility audit** (full brief: source availability/
  authority/machine-readability/frequency, best-source ranking, integration
  feasibility classification, historical-data feasibility, per indicator) —
  see the feasibility matrix below — confirmed the remaining 9 stay blocked
  on data access, each for a *specific*, investigated reason (not a repeat of
  the 2026-09-07 pass): RBI repo rate/India G-Sec yield/banking liquidity
  each have a real official source (RBI, CCIL/FBIL) that publishes only HTML
  press pages or PDF/Excel reports, never a stable API — CCIL's own site
  additionally prohibits automated/commercial use of its data without written
  permission; all-India power demand's official portals (Grid-India, National
  Power Portal) publish PDF/Excel only and do not even carry a daily *demand*
  figure (only generation/capacity); ethanol blending policy and the Union
  defence budget are genuine official figures (PIB press releases, Union
  Budget documents) but periodic policy announcements/annual documents, not a
  time series with an API to automate; PMI has no government source at all,
  free or paid — it is produced solely by S&P Global as a commercial product.
  None were scraped or approximated to close the gap. Each still renders an
  explicit "Future Integration" status in the Macro Intelligence Data Quality
  panel — same posture as TD-10, the blocker is data access, not engineering
  effort; `data/providers/macroProvider.mjs`'s `MACRO_INDICATORS`/
  `UNAVAILABLE_MACRO_INDICATORS` lists (and their own top-of-file comment,
  which records both investigations) are where a newly-sourced indicator
  would be added once one exists — India Gold Rate (`GOLDBEES.NS`) was added
  in the 2026-09-07 pass as a genuine example of exactly that.

  **2026-09-24 MoSPI-specific re-confirmation**: a separate task asked
  specifically whether any of these 7 (`UNAVAILABLE_MACRO_INDICATORS`) or the
  2 now-periodic ones above are available from MoSPI/eSankhyiki particularly
  (not "any government source", the narrower question) — see `system.md`
  §3.10's dated entry for the full write-up. Answer: no, for all 9 — each has
  a real official source, and in every case it is a different agency
  entirely (RBI, CCIL/FBIL, Grid-India/CEA, PPAC, MCX, S&P Global, PIB, Union
  Budget documents), never MoSPI. MoSPI's own statistical mandate (national
  accounts/GDP, CPI, IIP, ASI, employment/socio-economic surveys) does not
  cover monetary policy, bond yields, grid operations, commodity/fuel
  pricing, or private economic surveys. This is a negative-but-conclusive
  finding, not a gap — nothing new was fetchable from MoSPI at any
  authentication level, so nothing new was implemented; the same
  investigate-before-build discipline as every prior audit in this section.

  **CPI inflation and IIP are the one exception found** — MoSPI's official
  eSankhyiki API (`api.mospi.gov.in`) covers both, gated behind user signup +
  a 15-minute access token. Built out as this app's first credentialed
  integration (`data/integrations/`, `system.md` §3.10) after the user
  explicitly approved crossing the "no API keys" boundary for this one case.
  The provider is code-complete and tested against synthetic fixtures
  (`test/mospiIntegration.test.mjs`); it is not yet Live for lack of a real
  token, and a live-confirmed TLS issue on MoSPI's own server
  (`ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED` under standard, fully-
  verified TLS — this app deliberately does not weaken TLS to work around
  it, unlike the official reference client) means even a real token may not
  reach Live until MoSPI's server accepts modern TLS. Status: **Requires API
  Credentials** (user action) — see Configuration → Integrations.

  > **Superseded the same day** for CPI only — a same-day follow-on task
  > (see the "CPI moved to a public, unauthenticated path" entry further
  > down this ledger) found CPI genuinely works without any credential.
  > IIP's row below is unaffected/still accurate.

  **Feasibility matrix (2026-09-08 audit):**

  | Indicator | Recommended source | Authoritative | Machine-readable | Historical data | Refresh frequency | Integration status | Recommendation |
  |---|---|---|---|---|---|---|---|
  | RBI policy repo rate | RBI (rbi.org.in) | Yes | No (HTML/PDF only) | Yes, not machine-accessible | Event-driven (~bi-monthly MPC) | Reliable source exists, automation not practical | Stay deferred |
  | India 10Y G-Sec yield | CCIL / FBIL | Yes | No; CCIL ToS bars automated use | Yes, not machine-accessible | Daily | No reliable machine-readable source (ToS-blocked) | Stay deferred |
  | CPI inflation | MoSPI eSankhyiki (api.mospi.gov.in) | Yes | **Yes, unauthenticated** (superseded same day — see below) | Yes (Jan 2013+, credentialed only; unauthenticated access is a fixed ~10-record slice, no date selection) | Monthly | **Live, public** | Done — see below |
  | Index of Industrial Production | MoSPI eSankhyiki (api.mospi.gov.in) | Yes | Yes, credentialed (endpoint corroborated by official GoI source code, not a published manual) | Yes | Monthly | Requires API credentials | Built, pending user token |
  | Manufacturing / Services PMI | S&P Global (commercial) | No government source exists | No (paid product) | N/A | Monthly | No reliable machine-readable source | ~~Stay deferred~~ Re-confirmed 2026-09-24, split into 2 rows |
  | All-India power demand | ~~Grid-India / National Power Portal~~ National Power Portal (NPP) | Yes | ~~No~~ **Yes, unauthenticated (2026-09-24)** | Yes (1y+) | ~4 min | **Live, public** | Done — see below |
  | Ethanol blending policy | PIB / Ministry of Petroleum & Natural Gas | Yes | No (press releases) | Sparse, annual | Periodic/annual | Reliable source exists, automation not practical | Stay deferred |
  | Union defence budget | Union Budget documents (indiabudget.gov.in) | Yes | No (PDF) | Yes, annual, not machine-accessible | Annual | Reliable source exists, automation not practical | Stay deferred |
  | Banking system liquidity (Net LAF) | RBI (WSS / DBIE) | Yes | No (portal downloads, not an API) | Yes, not machine-accessible | Daily/weekly | Reliable source exists, automation not practical | Re-confirmed 2026-09-24 |

  > **2026-09-24 update**: All-India power demand moved to **Live** — see
  > `system.md` §3.10's dated 2026-09-24 entry (National Power Portal's
  > dashboard-backing JSON endpoint, a different mechanism from Grid-India/
  > CEA/NPDMS above) and this ledger's §2 entry of the same date. RBI repo
  > rate, India G-Sec yield, PMI, banking liquidity and India Crude Oil/
  > Natural Gas were all re-verified live the same session and remain
  > deferred for the reasons already in this table, now with each carrying
  > a real Source/status disclosure in the UI itself (`Not Programmatically
  > Available` / `Licensing Required`) rather than one undifferentiated
  > label. PMI and India Crude Oil/Natural Gas were each split into their
  > distinct underlying instruments (Manufacturing PMI/Services PMI;
  > Indian Basket crude/MCX crude/MCX natural gas) — see `macroProvider.mjs`'s
  > `UNAVAILABLE_MACRO_INDICATORS`. `data.gov.in` was identified as a
  > possible future source for some of the still-deferred rows but
  > deliberately not implemented — see this ledger's §2 entry for why.

  DMA/moving-average columns were deliberately not proposed for any of the 9
  still-deferred indicators even if a source were found later — repo rate,
  CPI/IIP-adjacent policy figures, budget and blending-policy values are
  period-over-period or event-driven readings, not priced instruments; a
  20/50/100/200-day moving average of a number that changes bi-monthly or
  annually is not analytically meaningful (`system.md` §3.10's closing note).
- **TD-14 (Phase 6) — Earnings calendar and forward event calendar.** Next
  earnings date, days remaining, expected impact, historical earnings
  reaction, guidance changes, management commentary, estimate-revision
  signals, dividend ex-dates, buyback announcements and regulatory/policy
  events all have no dated/forward-looking data source in this app (Screener
  exposes only a trailing annual dividend payout %, not a schedule, and
  there is no consensus-estimate or company-filing-calendar feed). Earnings
  Intelligence and the Event Calendar surface everything that genuinely is
  sourced (real quarterly deltas, real dated news) and render "Future
  Integration"/omit the rest rather than estimating a date or figure.

- **03.13-03.16 (Institutional research foundation upgrade) — Forward
  estimates, management credibility, segment economics, capacity/utilization.**
  All four have a shipped foundation contract (`data/analytics/
  forwardFramework.mjs`, §4.6) that renders an explicit `available: false` +
  reason today — blocked on data access (an investor-presentation/concall
  feed, a segment-level financial breakdown, a capacity/utilization source),
  not engineering effort. A future data-source integration fills in each
  builder's already-agreed `schema` fields; no redesign needed.
- **03.17 — Empirical recalibration toward the 10-factor scoring table.**
  Same blocker as TD-11/03.9 (no historical-outcomes dataset exists to
  calibrate against) — the Company Quality/Stock Attractiveness split this
  upgrade shipped is the structural prerequisite, not the calibration itself.

Deferred work is revisited when the blocking condition changes (a vendor
decision is made, a dataset becomes available), not on a schedule.

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

This app has no automated CI or test suite today ([§4, TD-4](#4-outstanding-technical-debt-carried-forward)),
so every phase's validation requirement to date has been manual: `node --check`
on every changed file, a live `buildResearch()`/HTTP check against real cached
data, and a full interactive walkthrough (Playwright) for anything UI-facing.
That is the validation bar for every item below unless a different bar is
stated.

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
| **Governance adoption & enforcement** (this phase) | 2026-08-15 | Validated the governance foundation end-to-end against the live codebase; fixed stale `roadmap.md` cross-references left behind by the file's move (README.md and 4 analytics/scoring source comments); added an explicit phase-start gate (§1) | ✅ Completed — see [validation report §6](./validation-report.md) |

---

## 3. Milestone timeline

```
2026-08-11  Flow Integrity Audit remediation → Dashboard IA restructuring
2026-08-12  Phase 1 (data layer + scoring) → Stock Metrics tab split
2026-08-13  Phase 2 (institutional analytics) → audit → Phase 3a (analytical integrity)
2026-08-14  Phase 3b → 3c → 3d → 3e → 3f → Governance foundation
2026-08-15  Governance adoption & enforcement (this phase)
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
| TD-4 | Automated test layer for pure-math analytics modules (`dcf.mjs`, `priceSeries.mjs`, `institutionalRisk.mjs`, `portfolio.mjs`'s `resolveWeights`) — flagged repeatedly as the single biggest structural gap | **P0** | Not started | L |
| TD-5 | Dedupe the debt-trend calculation in `institutionalRisk.mjs` (`financialRisk()`/`governanceRisk()` each recompute it independently) | P3 | Not started | XS |
| TD-6 | Extract one shared `groupBySector()` helper (reimplemented independently 3×: `portfolio.mjs` ×2, `relativeValuation.mjs`) | P3 | Not started | XS |
| TD-7 | Delete the dead `pearsonCorrelation` export in `priceSeries.mjs` (superseded by `correlationFromPrepared`) | P3 | Not started | XS |
| TD-8 | `card()` helper should auto-escape by default, with an explicit raw-HTML opt-out (fragile-by-convention; hand-audited as not currently exploited) | P2 | Not started | S |
| TD-9 | Add a `pctAbs()` formatter for non-directional magnitudes (WACC, volatility, position weight currently render with a misleading "+" prefix via `pct()`) | P3 | Not started | S |

TD-10 (market-wide peer database) and TD-11 (empirical calibration of scoring
coefficients) are tracked in §6 as explicitly deferred rather than pending —
both are blocked on external data access, not on engineering effort.

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
| 02.11 | Automated test layer for pure-math modules (**= TD-4**) | **P0** | None | Not started | L | Coverage of `dcf.mjs`, `priceSeries.mjs`, `institutionalRisk.mjs`, `resolveWeights` at minimum; unblocks 07.2/07.3 |
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

### 04. Reporting

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 04.1 | Institutional research reporting engine (report model, printable page, PDF export) | — | — | ✅ Completed (Phase 3d) | — | See §2 |
| 04.2 | On-screen paged-media pagination simulation | P3 | None | Not started (explicitly out of scope under the zero-dependency constraint unless revisited) | M | Visual confirmation of page-break placement matching print output |
| 04.3 | Bulk/portfolio-level report export (multi-company single PDF) | P3 | 04.1 | Not started | M | Same WYSIWYG print validation as 04.1, extended to N companies |
| 04.4 | Report customization (user-selectable sections/branding) | P3 | 04.1 | Not started | M | Manual walkthrough of each customization toggle |

### 05. Portfolio intelligence

| ID | Item | Priority | Dependency | Status | Complexity | Validation requirement |
|---|---|---|---|---|---|---|
| 05.1 | Portfolio dashboard (weights, allocation, correlation, attribution, scenarios) | — | — | ✅ Completed (Phase 2, deepened 3b) | — | See §2 |
| 05.2 | Cash allocation modeling | — | — | ✅ Completed (Phase 3b) | — | See §2 |
| 05.3 | Monitoring & alerts (price/valuation/technical threshold notifications) | P1 | A scheduler/background process (none exists — the server today only responds to requests) | Not started | L | End-to-end: threshold crossed → notification delivered, with no false positives across a multi-day soak |
| 05.4 | Rebalancing suggestions (target-weight drift) | P2 | 02.7 cash allocation model (done) | Not started | M | Compare suggested trades against hand-computed drift for a known watchlist |
| 05.5 | Portfolio health scoring over time | P2 | Historical portfolio-metric snapshotting (not currently persisted — only latest state is cached) | Not started | M | Confirm snapshot persistence survives restart; trend line matches manually reconstructed history |
| 05.6 | Proactive decision support (buy/sell/trim surfaced without an explicit request) | P2 | 05.3, 05.5 | Not started | L | Manual review of suggestion quality against a known portfolio state |

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
| 07.2 | CI — minimal first step: a GitHub Actions job running `node --check` over every `.mjs`/`.js` file on push | P1 | None | Not started | S | CI job goes green on a clean push, red on an intentionally broken file |
| 07.3 | Testing infrastructure (what CI runs beyond `node --check`) | — | 02.11 / TD-4 | Not started | — | Tracked as the same item as TD-4; referenced here as 07.2's dependency |
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

Deferred work is revisited when the blocking condition changes (a vendor
decision is made, a dataset becomes available), not on a schedule.

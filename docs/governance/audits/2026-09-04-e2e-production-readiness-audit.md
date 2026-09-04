# End-to-End Production-Readiness Audit — 2026-09-04

Status: **Point-in-time audit snapshot.** Dated, not edited after the fact
(per `CLAUDE.md` §4's archive policy). Full end-to-end live-browser audit of
every workspace in the app, requested directly by the user as a production-
readiness check — not scoped to a single feature or recent change.

## 0. Scope and method

Covered all 8 workspaces (Dashboard, Watchlists, Company Research, Watchlist
Research, Portfolio Analysis, Reports, Market Intelligence, Compare) and every
reachable sub-tab/nested sub-tab/dialog. Live-browser testing, not static
reasoning: `puppeteer-core` (installed only in a scratch npm directory outside
the repo, `C:\Users\...\Temp\claude\...\scratchpad\audit-puppeteer` — this
app's zero-dependency/no-`package.json` design was never touched) driving the
system's real installed Chrome
(`C:\Program Files\Google\Chrome\Application\chrome.exe`) via CDP, headless,
against a scratch server instance on port 4199 (`PORT=4199 node server.mjs`)
— the user's own dev server on port 4173 was confirmed not running and never
touched. Every test scenario ran in its own isolated `browser.createBrowserContext()`
(incognito-equivalent) to avoid this app's own by-design `localStorage`
subtab/company persistence leaking state between scenarios, per the precedent
set by the 2026-09-03 floating-header-clone audit.

Automated checks (`node --check` over every tracked `.mjs`/`.js` file per
`.github/workflows/ci.yml`'s exact file list, then `node --test`) were run
before and after the one fix made in this pass.

## 1. Automated checks

- `node --check`: 82 files, all clean (matches the CI-documented baseline).
- `node --test`: **109/109 tests, 36/36 suites passing** — matches the
  baseline recorded in every prior validated pass since 2026-08-17.
- `git diff --check`: no whitespace issues in the one file touched.
- Re-run after the fix below: identical results, all green.

## 2. Live-browser audit results

### 2a. Navigation & state-transition audit — PASS

- All 8 sidebar workspaces activate exactly one `.tab` each (checked via
  computed `display`, not just a class), with the matching sidebar item
  highlighted — 8/8 correct, zero stale content bleed.
- `#company-context-bar` confirmed hidden on every workspace except Company
  Research (8 checks, all correct) — the 2026-08-29 fix holds.
- Company A → Company Research → scroll → Company B: selector name, snapshot
  content, and body text all changed to reflect Company B; no stale Company A
  data observed in any checked field.
- Cross-workspace hopping (Company Research → Dashboard → Watchlist Research →
  Company Research → Portfolio Analysis → Dashboard, 6 hops): active tab and
  active sidebar item matched on every hop, zero desync.
- Watchlist A (Banking, sorted) → Watchlist B (Power) → Dashboard → back to
  Watchlist Research: row count, header-select label, first-row company, and
  sort state (reset to natural, not leaking Banking's sort) were all correct
  and coherent after the round trip.
- Company Research scrollspy (`.cr-page-nav` × 7 sections): clicking each nav
  link activates the matching link and lands the section below the sticky
  nav, not hidden behind it — 7/7 correct once the test waited for the
  browser's own `scrollIntoView({behavior:'smooth'})` animation to actually
  finish (see §3 for the false positive this initially produced).

### 2b. Scrolling audit — PASS

- **Zero unwanted nested vertical scroll containers** found anywhere in the
  app: swept all 8 workspaces and every one of their sub-tabs (29 distinct
  panels) at three viewport heights (1400/900/600px) plus the 540px mobile
  width — **89/89 checks clean**. Confirms `system.md`'s "floating header
  clone replaced the bounded scrollbox specifically to restore one page-level
  scroll" claim holds app-wide today, not only on Watchlist Research.
- Real `page.mouse.wheel()` walkthrough (25 ticks, Asmita watchlist — 30
  companies, the largest saved) on Watchlist Research: **never more than one
  `.floating-thead.visible` at any sampled point**; page `scrollY` advanced
  naturally (not trapped). `PageDown` also advanced the page correctly.
- Floating-header column alignment measured pixel-exact (0px diff on 5
  sampled columns) against the real body rows after a 300px horizontal
  scroll, mid-vertical-scroll, on the 30-company watchlist.
- Zero `.floating-thead` descendants are keyboard-focusable (`tabIndex >= 0`
  count: 0).
- Mobile (540×900): off-canvas drawer opens/closes correctly (hamburger,
  backdrop click, auto-close on navigation), floating header stays fully
  within the 540px viewport width when triggered, no page-level horizontal
  overflow.
- Nested-2-levels-deep sticky table (`profitability-table`, `thead-sticky-3`,
  Watchlist Research → Fundamentals → Quality → Profitability) confirmed to
  correctly show/hide its floating header at viewport heights where the
  content genuinely extends past the stacked nav offset (see §3 for a false
  positive this initially produced at a viewport height where it did not).

### 2c. Table consistency & sorting audit — PASS

Tested full asc → desc → natural sort cycles (with strict monotonic-order and
N/A-always-last assertions, both directions) on **20 tables**: all 13
Watchlist Research comparison tables reachable via nested sub-navigation
(Overview, Valuation, Profitability, Balance sheet, Ownership, Growth, Trend,
Momentum, Volume, Relative strength, Volatility, Signals, Risk matrix), plus
the 6 tables newly wired app-wide per the 2026-09-04 "App-wide UX/data-parity
consistency pass" (`#pi-action-table`, `#portfolio-table`,
`#rebalancing-table`, `#exposure-matrix-table`, `#earnings-intel-table`,
`#sector-intel-table`), plus `#wl-table`'s own sort mechanism. **20/20
tables passed** after correcting a bug in the test harness itself (see §3).
Sort-indicator classes (`sorted-asc`/`sorted-desc`, cleared on the third
click) were also asserted, not just row order.

Floating headers on the newly-wired tables (`#pi-action-table`,
`#earnings-intel-table`, `#wl-table`) confirmed to appear/disappear correctly
under real scroll, same mechanism as Watchlist Research's own tables.
`#wl-table`'s duplicate-id fix (`wl-select-all` stripped from its floating
clone) reconfirmed live: zero duplicate DOM ids while its floating header was
actively shown.

Not independently re-audited: Dashboard's Top Opportunities table (has its
own sort control, capped rows) and Market Intelligence's small fixed macro
tables — both are `system.md`-documented intentional exceptions, not
oversights, and were left alone per the task brief's own instruction.

### 2d. Data-parity / N/A audit — PASS, with documented (non-bug) partial coverage

Checked the Asmita watchlist (30 companies, the largest saved, mixed
sectors — the hardest case for peer-completeness/factor coverage) for every
column added by the two most recent data-parity passes:

| Column (table) | Non-N/A ratio |
|---|---|
| Company Quality (`#wr-overview-table`) | 15/30 |
| Stock Attractiveness (`#wr-overview-table`) | 30/30 |
| Factor score (`#wr-overview-table`) | 12/30 |
| Fundamental View (`#wr-overview-table`) | 30/30 |
| Market View (`#wr-overview-table`) | 30/30 |
| Sector rank (`valuation-table`) | 30/30 |
| Relative attractiveness (`valuation-table`) | 9/30 |
| Peer completeness (`valuation-table`) | 30/30 |
| 3Y CAGR (Relative strength) | 28/30 |
| 5Y CAGR (Relative strength) | 26/30 |
| Max drawdown (Relative strength) | 30/30 |
| Sharpe-like (Relative strength) | 30/30 |
| Sortino-like (Relative strength) | 30/30 |
| Thesis status (Risk matrix) | 30/30 |

None of these columns are universally N/A (the failure mode the brief asked
to rule out); every one shows real values for at least a meaningful subset of
the watchlist. The three columns with partial (not full) coverage — Company
Quality, Factor score, Relative attractiveness — all read a value that is
**withheld with a disclosed reason, not computed incorrectly**, per
`system.md` §3.9/§4.1's documented completeness-floor gating
(`qualityAttractiveness.mjs`'s coverage floor, `factorEngine.mjs`'s
half-of-6-categories floor, `relativeValuation.mjs`'s 3-peer minimum) — this
is category (1)/(2) genuine-data-gap, correctly disclosed, not category (4)
frontend wiring. Classified, not fixed, per the task's own instruction to
fix only category-4 instances.

Also spot-checked the one known pre-existing unresolved ticker (TD-2,
`PGCIL.NS` in the Power watchlist) via a direct read-only
`GET /api/watchlists/power/research`: correctly renders `unresolved: true`,
`name: "PGCIL.NS"` (the raw symbol, never guessed), `price: null` — no
fabricated value anywhere in its record, and zero `NaN` substrings in the
whole payload. This is the already-tracked TD-2 defect (not started, XS
complexity), unrelated to this audit's scope to fix.

### 2e. Console / DOM integrity — PASS

Zero duplicate DOM ids in every scenario checked: initial load, deep
nested-sub-tab click-through of all 15 Watchlist Research sub-tab
combinations, Compare Mode with 3 companies active, and mid-scroll with a
floating header actively shown. Zero console/page errors in every scenario
except the one pre-existing, disclosed `favicon.ico` 404 this app has never
had a favicon for (present in essentially every prior validation note in
`docs/governance/roadmap.md` since Phase 4) — confirmed by inspection that no
other 404 or JS error occurred.

Compare Mode: on/off toggle changes its own label both directions, selecting
3 companies renders 34 `.compare-grid` elements across the Valuation/
Technical/Risk panels, zero duplicate ids.

## 3. False positives ruled out during this audit (test-harness bugs, not app bugs)

Per the task brief's own warning not to repeat the prior pattern of trusting
static reasoning — every one of the following was investigated by direct
DOM/geometry inspection before being ruled a test artifact, not just assumed:

1. **Scrollspy "wrong link active" on 2 of 7 sections.** Root cause: my test
   clicked a `.cr-page-nav` link and waited a fixed 600ms, but the real
   `scrollIntoView({behavior:'smooth'})` animation for a long scroll distance
   (e.g. jumping to the Growth section) can take longer than 600ms in
   headless Chrome. Re-tested with a scroll-position-settle poll (up to 4s)
   instead of a fixed wait: **7/7 passed.** Not a regression of the
   2026-09-03 scrollspy fix.
2. **P/E, ROE, ADX and 6 other columns "not sorted correctly."** Root cause:
   a bug in my own test's number-parsing regex
   (`s.replace(/[,%₹Rs.\s]/g,'')`) stripped the `.` character from decimal
   values inside a character class, turning `"34.8"` into `"348"` before
   comparison. Direct inspection of the raw sorted cell values (`["34.8",
   "35", "36.2", "48.2", ..., "982", "N/A", "N/A"]`) showed the app's actual
   sort was already correct. Fixed the test's parser; re-ran: **20/20 tables
   passed** (§2c).
3. **Floating header "never appears" on `wr-overview-table`,
   `profitability-table`, `earnings-intel-table`, `wl-table` at a 1400px
   viewport.** Root cause: at that viewport height, several of these
   sub-tab panels (particularly a short table like `wl-table`'s Defence
   watchlist, 14 rows) simply don't have enough page content below the
   sticky-nav offset to need a floating header at all — confirmed by reading
   the real `theadRect.top`/`tableRect.bottom`/computed offset at the page's
   actual max scroll position in each case (e.g. `wl-table`: thead never
   reaches the 285px sticky offset even at max scroll of 439px at 1400px
   viewport height). Re-tested at a shorter 700px viewport where the same
   table genuinely needs to scroll further: floating header appeared
   correctly (`visible: true`, `shouldShow` geometry matched). Not a bug —
   correct conditional behavior.
4. **`#wr-watchlist-context` element not found.** This element does not
   exist in the current DOM — but `system.md` §2.3 already documents why:
   the 2026-08-29 "Watchlist Research IA consolidation" entry explicitly
   removed it as a duplicate of the global header's own watchlist-context
   bar. Not a regression; `system.md`'s own history flags this. Retargeted
   the test at the header's `#watchlist-select` label instead, which is the
   currently-correct place this information lives — confirmed correct.

## 4. Genuine defect found and fixed

**Stale "Quick Jump" reference in the Reports workspace's intro copy**
(`index.html`, the `#reports` section's lead `<p>`).

- **Repro**: load the app, navigate to the Reports workspace. The intro text
  reads: *"...the same reports also remain reachable from Quick Jump, the
  Watchlists manage row and Committee View, unchanged."*
- **Observed vs. expected**: Quick Jump does not exist anywhere in the live
  app — confirmed via a full-file grep of `index.html`/`script.js` for
  `data-jump`/`quick-jump`/`Quick Jump`: zero matches outside code comments.
  `system.md` §2.3 itself documents the removal ("Company Research's header
  Quick Jump row + Compare toggle were removed", 2026-09-03 pass) — this
  Reports-tab copy was simply never updated to match, so it told users a
  navigation feature exists when it does not. The other two claimed launch
  points were verified still real and working (Watchlists manage row's
  per-row `data-action="report"` button → `openCompanyReport()`; Committee
  View's `#cv-portfolio-review-btn`/`#cv-committee-pack-btn`), so only the
  Quick Jump clause was stale.
- **Fix** (`index.html` line 768): removed the "Quick Jump," clause, leaving
  *"...the same reports also remain reachable from the Watchlists manage row
  and Committee View, unchanged."*
- **Validation**: confirmed live post-fix (page reload, navigate to Reports,
  read `#reports p.small` text content) that the corrected copy renders with
  zero console errors. `node --check`: N/A (not a `.mjs`/`.js` file, and no
  script file was touched). `node --test`: re-ran, still 109/109 passing
  (unaffected — pure HTML copy change). `git diff --check`: clean, one-line
  diff.
- This is a documentation/copy-only fix — no navigation behavior, DOM
  structure, or data flow changed. No `system.md` update is needed (the
  removal this copy now correctly reflects was already documented there);
  the roadmap ledger entry below records the fix itself.

No other genuine defects were found. No fix was made to, or needed in,
`data/analytics/`, `data/scoring/`, `data/decision/`, `data/quant/`,
`data/providers/`, `data/parse/`, or `server.mjs` route logic, per this
task's binding governance boundary.

## 5. What could not be verified live

- **Print/PDF output** of `report.html`/`committee-pack.html`/
  `portfolio-review.html`: only a light `GET` smoke check (200 status, no
  console errors on load) was performed, not a rendered/printed-output
  check — consistent with the task brief's own instruction not to go deep on
  the report feature unless the task is specifically about it, and with
  every prior audit note's own disclosed limitation here (report/PDF output
  is unchanged by this pass).
- **Non-Chrome browsers** and physical-device testing: only the system's
  installed Chrome (headless) was available/used, same disclosed limitation
  as every prior live-browser validation note in this repository.
- A genuinely "Unavailable"/"Delayed" Macro Intelligence indicator state and
  a live-triggered hard "Broken" thesis condition were not exercised (no
  current cached data hits either edge case) — same pre-existing disclosed
  gap as the Phase 6/5 validation notes, unrelated to this pass.

## 6. State-mutation confirmation

The scratch server (port 4199) shares `data/watchlists/*.json` with the
user's real server. Two watchlist switches were performed during testing
(via the real `#watchlist-select`/`POST /api/watchlists/active` a client
would use — Asmita and Banking/Power, to exercise floating headers and
cross-watchlist-switch coherence on non-trivial watchlist sizes). Both were
reverted to the session's starting value (`defence`) via the same real route
before finishing. `git diff` on `data/watchlists/index.json` shows only the
expected `updatedAt` timestamp bump from that legitimate API round trip
(`activeWatchlist` itself confirmed back to `"defence"`) — the same benign,
documented pattern every prior audit pass in this repository's history
records. No watchlist was created, deleted, or had its companies/weights/
notes mutated. `data/cache/**` was not touched (no refresh route was called).

Final `git status --short`:
```
 M data/watchlists/index.json   (activeWatchlist reverted; only updatedAt timestamp differs)
 M index.html                   (the Quick Jump copy fix, §4)
```

## 7. Overall verdict

**Ready, with no blocking issues found.** Every audited workspace, sub-tab,
table-sort/floating-header mechanism, and cross-workspace/cross-company/
cross-watchlist state transition behaved correctly under real, live-browser
testing at four viewport sizes. One genuine defect was found — a stale UI
copy string referencing a removed feature — and fixed. All automated checks
(`node --check`, `node --test`) remain green. No analytics, scoring, decision,
quant, provider, or API-layer code was touched, per this task's governance
boundary.

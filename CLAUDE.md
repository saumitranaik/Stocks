# CLAUDE.md — Repository Entry Point

This file tells Claude Code how to work in this repository. Read this file
first, every session, before anything else.

## 1. Load order (do this, in this order, before any other exploration)

1. **This file.**
2. [`docs/authoritative/system.md`](docs/authoritative/system.md) — what the
   system *is* (architecture, data flow, module boundaries).
3. [`docs/governance/roadmap.md`](docs/governance/roadmap.md) — what's done,
   what's next, priorities and status.

That's it. **Do not scan the repository** beyond these three files before
starting work. Only read additional files once you know, from `system.md`,
exactly which ones are relevant to the task at hand — see §3.

## 2. Authoritative sources

`docs/authoritative/system.md` and `docs/governance/roadmap.md` are the
**only** authoritative sources for architecture and project status. If
anything else in the repository (a comment, a stale doc, your own prior
assumption) conflicts with these two files, **the two files win** — flag the
conflict and update the stale source, don't silently defer to it.

`archive/roadmap-history.md` is historical record (the full pre-governance
changelog, phase-by-phase implementation narrative) — read it only when a
task specifically needs that level of historical detail, not by default.
`docs/governance/audits/` holds dated point-in-time audit snapshots — same
rule, read on demand only.

## 3. Context strategy

- **Minimal context, targeted reads.** Once `system.md` tells you which
  module owns the thing you're changing, read *that file* — don't grep the
  whole repo first "just to be sure."
- **Avoid repository-wide searches** for anything `system.md`'s repository
  map (§7 there) already tells you. It documents every folder's purpose and
  where new things belong.
- **Never load generated or historical content unless the task requires it**:
  `data/cache/` (on-disk research cache — regenerable, not source), `data/
  watchlists/*.json` (user data, not code — read only if a task is literally
  about watchlist data), `archive/`, `docs/governance/audits/`.
- **Never load `report.html`/`report.js` output or rendered pages** unless
  the task is specifically about the report feature.
- If a task genuinely requires broad exploration (e.g. "find every place X is
  used"), use targeted grep for the specific symbol — not a full-file read of
  every candidate.

## 4. Working rules

- **Greenfield mindset, preserve architecture.** This is an actively evolving
  app, not a legacy system to work around — but every change must fit the
  module boundaries in `system.md` §8, not route around them.
- **No duplicate calculations.** Every analytic is computed exactly once in
  `buildResearch()`'s call chain (`system.md` §5). If you need a value that's
  already computed somewhere in the research payload, read it — never
  recompute it. `data/reporting/researchReport.mjs` is the reference example
  of doing this correctly.
- **Reuse analytics engines.** New features consume `data/analytics/` and
  `data/scoring/` output; they don't reimplement valuation, technical, risk,
  or recommendation logic locally.
- **Tag every new metric.** Any new field surfaced anywhere gets a
  `data/metadata/metricRegistry.mjs` entry (Sourced/Calculated/Heuristic +
  confidence) before it ships — see `system.md` §6.
- **Never guess a sourced field.** `name`/`sector`/`industry`/`exchange` and
  anything else tagged Sourced must come from a real fetch or explicit user
  input, never be estimated. Missing data renders "N/A", not a guess.
- **Documentation governance**: rationale for a change goes in
  `docs/governance/roadmap.md`'s completed-work ledger (§2 there), not a new
  standalone markdown file. Don't create a new doc for a single feature —
  update the existing three-document set instead.
- **Archive policy**: point-in-time artifacts (audit snapshots, superseded
  changelogs) go in `archive/` or `docs/governance/audits/`, dated, never
  edited after the fact. If a file becomes obsolete, archive it and remove
  stale references — don't leave dead files in the active tree.
- **Roadmap updates**: when you complete a roadmap item, update its Status in
  `docs/governance/roadmap.md` in the same change. When you discover new
  technical debt, add it to §4 there rather than leaving it undocumented in
  a commit message.
- **Validation requirements**: an automated unit-test layer now exists for
  the pure-math analytics modules (`test/`, run via `node --test` or
  `test.bat` — `docs/governance/roadmap.md` TD-4/02.11, completed
  2026-08-17). Run it whenever a change touches `data/analytics/*.mjs`,
  `data/util.mjs`, or another pure-math module it covers, and add/update
  cases for any new pure function in scope. It does not yet cover
  `data/scoring/`, `data/decision/`, `data/quant/`, providers, or any I/O —
  for those (and for everything else), keep validating with `node --check`
  on every touched `.mjs`/`.js` file, a live check against real cached data
  (not just `node --check`), and — for anything UI-facing — an actual
  interactive walkthrough. Do not mark work done on `node --check` (or the
  unit-test layer alone) — a change outside `test/`'s current coverage still
  needs the live/UI checks above.
- **CI**: `.github/workflows/ci.yml` (`docs/governance/roadmap.md` 07.2,
  completed 2026-08-17) runs `node --check` over every tracked `.mjs`/`.js`
  file, then `node --test`, on every push/PR — a mandatory gate, not a
  substitute for the manual validation above.
- **No proliferation**: prefer extending an existing module/tab/section over
  creating a new file. Check `system.md` §7 ("where new things belong")
  before creating anything new.
- **Preserve module boundaries**: `data/analytics/` stays pure (no I/O);
  `data/watchlist/` owns orchestration and persistence; `data/scoring/` owns
  rating composition; `server.mjs` stays a thin route table. Don't blur these
  for a one-off feature — see `system.md` §8 for the full list of binding
  architectural rules.
- **This is a single-user, local-only tool today.** No authentication exists
  and none is needed while the server binds to `localhost` only
  (`docs/governance/roadmap.md` 07.6). Do not add network-exposed
  functionality without first flagging the security gap — it's a hard gate,
  not a nice-to-have.

## 5. Repository map

```
CLAUDE.md                        — you are here
docs/authoritative/system.md     — canonical architecture (load 2nd)
docs/governance/roadmap.md       — canonical roadmap (load 3rd)
docs/governance/audits/          — dated audit snapshots (read on demand)
archive/roadmap-history.md       — full historical changelog (read on demand)

server.mjs                       — HTTP server + API route table
index.html / script.js / styles.css   — main dashboard SPA (frontend)
report.html / report.js          — standalone printable report page

data/analytics/     — pure calculation modules (valuation, technical, portfolio, risk)
data/scoring/        — the unified recommendation/rating engine
data/decision/         — Portfolio Action Score, alerts, health, rebalancing (pure composition, own config.mjs)
data/quant/              — Phase 7 quantitative research domain: factor engine (Stage 1), benchmark & performance engine (Stage 2) (pure composition, own config.mjs)
data/reporting/       — per-company report model (derives from research, computes nothing new)
data/providers/        — external data source abstraction (Yahoo, Screener.in)
data/parse/              — Screener.in HTML parsing
data/news/                — company news fetch + classification
data/metadata/              — metricRegistry.mjs (Sourced/Calculated/Heuristic tiers)
data/universe/                — static NSE ticker reference (search seed)
data/watchlist/                  — store, research orchestration, disk cache, symbol search
data/watchlists/                   — on-disk watchlist JSON (user data, not code)
data/cache/                          — on-disk research cache (regenerable, not source)
test/                                   — automated unit tests for pure-math modules (node:test, zero dependencies)
.github/workflows/ci.yml                — CI: node --check + node --test on every push/PR
```

For what belongs in each folder and why, see `system.md` §7 — don't
re-derive it by exploring; it's already documented there.

## 6. Token optimization rules

- Read only the files a task actually touches. `system.md`'s module table
  (§1.3) and repository map (§7) exist specifically so you don't have to
  open files to find out what they're for.
- Prefer the authoritative docs over re-deriving facts from code — if
  `system.md` already states how caching or data flow works, trust it (and
  flag it if you find it's gone stale) rather than re-reading five files to
  confirm.
- Never load `docs/governance/audits/*.mhtml` or `archive/roadmap-history.md`
  as background context "for completeness" — these are large, historical,
  and load-bearing only for tasks specifically about project history.
- Never load `data/watchlists/*.json` or `data/cache/**` unless the task is
  specifically about a user's watchlist data or cache behavior.
- When a task requires touching multiple analytics modules, read only the
  ones `system.md` §4 names as relevant to the calculation in question, not
  the whole `data/analytics/` directory.

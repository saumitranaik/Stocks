# Roadmap

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

# Watchlist Research Workspace

Run the local research service:

```powershell
node server.mjs
```

Then open `http://localhost:4173`.

This is a company-first, persistent watchlist workspace: build a list of
companies (autocomplete by name or ticker), it's saved to disk under
`data/watchlists/`, and it's automatically reloaded -- with the last
successful fetch for every company served instantly from cache, then
refreshed in the background -- the next time the server starts or the page
loads. Every tab (Dashboard, Fundamentals, Valuation, Profitability,
Balance Sheet, Growth, Ownership, Technicals, Portfolio, Risks) analyzes
exactly the companies in the active watchlist, in the watchlist's own
order.

Four watchlists ship as defaults on first run (Core Portfolio, Banking,
Power, Defence) -- switch, create, rename, duplicate or delete watchlists
from the header, and add/remove/reorder companies from the "Manage" panel.

The app obtains public price and technical fields from Yahoo Finance's
public chart feed, India-specific fundamentals/ownership/sector data from
Screener.in, and recent per-company news from Google News RSS. It needs
normal outbound internet access at runtime. No API key is required, but
public endpoints can be rate-limited or temporarily unavailable;
unavailable values are shown as `N/A` rather than estimated.

Run the automated unit tests for the pure-math analytics modules with
`node --test` (or `test.bat`) — no install step, built on Node's own test
runner.

See [`docs/authoritative/system.md`](docs/authoritative/system.md) for how
the app is built and [`docs/governance/roadmap.md`](docs/governance/roadmap.md)
for what changed and why, including which figures (Fair Value, Target Price,
Conviction, news impact level, Support/Resistance) are disclosed in-house
heuristics rather than sourced/analyst-verified data (`system.md` §6 has the
full Sourced/Calculated/Heuristic tiering).


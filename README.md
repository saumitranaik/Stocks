# Sector Research Dashboard

Run the local research service:

```powershell
node server.mjs
```

Then open `http://localhost:4173`.

The dashboard obtains public price and technical fields from Yahoo Finance's public chart feed, India-specific valuation/return fields from Screener.in, and recent sector/constituent coverage from Google News RSS. It needs normal outbound internet access at runtime. No API key is required, but public endpoints can be rate-limited or temporarily unavailable; unavailable values are shown as `N/A`.

For the most reliable sector coverage, use a specific industry name. The dashboard has preset company universes for Sugar & Biofuel, semiconductors, fintech, renewable energy and banking; other sectors use Yahoo Finance's public symbol search.
"# Stocks" 

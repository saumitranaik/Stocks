import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = process.env.PORT || 4173;
const root = process.cwd();
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
// Sector -> ticker-universe presets, scoped per market. Every preset here must
// stay inside its market's own exchanges so a report's header/market label can
// never disagree with the symbols actually screened (Flow Integrity Audit #2:
// sector presets previously ignored the selected market entirely).
const sectorPresets = {
  India: {
    'sugar & biofuel': ['BALRAMCHIN.NS','TRIVENI.NS','EIDPARRY.NS','DALMIASUG.NS','BANARISUG.NS','RENUKA.NS','UTTAMSUGAR.NS','DWARKESH.NS','AVADHSUGAR.NS'],
    sugar: ['BALRAMCHIN.NS','TRIVENI.NS','EIDPARRY.NS','DALMIASUG.NS','BANARISUG.NS','RENUKA.NS','UTTAMSUGAR.NS','DWARKESH.NS','AVADHSUGAR.NS'],
    // India has no major semiconductor fabs; this is the closest listed
    // universe (design/EMS/component companies feeding the chip supply chain).
    semiconductor: ['DIXON.NS','KAYNES.NS','SYRMA.NS','TATAELXSI.NS','CGPOWER.NS','MOSCHIP.NS','SPEL.NS','ASMTEC.NS'],
    fintech: ['PAYTM.NS','POLICYBZR.NS','CAMS.NS','CDSL.NS','ANGELONE.NS','KFINTECH.NS'],
    'renewable energy': ['ADANIGREEN.NS','SUZLON.NS','INOXWIND.NS','WAAREEENER.NS','KPIGREEN.NS','TATAPOWER.NS','JSWENERGY.NS','ORIENTGREEN.NS'],
    banking: ['HDFCBANK.NS','ICICIBANK.NS','SBIN.NS','KOTAKBANK.NS','AXISBANK.NS','INDUSINDBK.NS','BANKBARODA.NS','PNB.NS'],
    power: ['PGCIL.NS','NTPC.NS','TATAPOWER.NS','ADANIPOWER.NS','TORNTPOWER.NS','CESC.NS','JSWENERGY.NS','NHPC.NS'],
    utilities: ['PGCIL.NS','NTPC.NS','TATAPOWER.NS','ADANIPOWER.NS','TORNTPOWER.NS','CESC.NS','JSWENERGY.NS','NHPC.NS'],
    'oil & gas': ['RELIANCE.NS','ONGC.NS','NTPC.NS','TATAPOWER.NS','ADANIPOWER.NS','JSWENERGY.NS','GAIL.NS','IOC.NS']
  },
  'United States': {
    semiconductor: ['NVDA','AVGO','AMD','INTC','MU','QCOM','AMAT','LRCX','TXN','ADI'],
    fintech: ['NU','PYPL','SQ','SOFI','HOOD','AFRM','UPST','TOST'],
    'renewable energy': ['FSLR','ENPH','SEDG','NEE','BEPC','VST','RUN','ORA'],
    banking: ['JPM','BAC','WFC','C','GS','MS','USB','PNC'],
    power: ['NEE','CEG','VST','DUK','SO','AEP','SRE','D','EXC','XEL'],
    utilities: ['NEE','DUK','SO','AEP','SRE','D','EXC','XEL','PEG','ED'],
    'oil & gas': ['XOM','CVX','COP','SLB','EOG','MPC','PSX','VLO','OXY','KMI']
  },
  Global: {
    semiconductor: ['NVDA','AVGO','AMD','TSM','ASML','INTC','MU','QCOM','AMAT','LRCX'],
    fintech: ['NU','PYPL','SQ','SOFI','ADYEN.AS','HOOD','AFRM','TOST'],
    'renewable energy': ['NEE','ENPH','SEDG','ORSTED.CO','IBE.MC','ENEL.MI','VST','BEPC'],
    banking: ['JPM','BAC','HSBC','MS','GS','C','SAN.MC','MUFG'],
    power: ['NEE','CEG','VST','DUK','SO','AEP','NG.L','IBE.MC','ENEL.MI','RWE.DE'],
    utilities: ['NEE','DUK','SO','AEP','NG.L','IBE.MC','ENEL.MI','RWE.DE','ENGI.PA','ED'],
    'oil & gas': ['XOM','CVX','SHEL','TTE','BP','COP','EQNR','EOG','ENI.MI','CNQ']
  }
};
const screenerAliases = { PGCIL: 'POWERGRID' };
const fundamentalsCache = new Map();

// Strips only characters that could break out of an HTML tag/attribute.
// '&' is intentionally allowed through: several standard sector names
// contain it ("Oil & Gas", "Metals & Mining", ...), and `sector` is only
// ever written via textContent in script.js, never innerHTML, so a bare
// '&' carries no injection risk here.
const clean = (value) => String(value ?? '').replace(/[<>"']/g, '').trim();
const number = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const request = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', accept: 'application/json,text/plain,*/*' } });
  if (!res.ok) throw new Error(`Source returned ${res.status}`);
  return res;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

// Wilder's RSI over the full available close history (chart endpoint gives
// up to 1y daily closes), seeded from the first 14 periods.
function rsi14(closes, period = 14) {
  if (closes.length <= period) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
function trendLabel(price, fifty, twoHundred) {
  if (!Number.isFinite(price) || !Number.isFinite(fifty) || !Number.isFinite(twoHundred)) return 'N/A';
  if (price > fifty && fifty > twoHundred) return 'Uptrend';
  if (price < fifty && fifty < twoHundred) return 'Downtrend';
  return 'Sideways';
}
function momentumLabel(rsi) {
  if (!Number.isFinite(rsi)) return 'N/A';
  if (rsi >= 60) return 'Strong';
  if (rsi >= 45) return 'Neutral';
  return 'Weak';
}
function volumeTrendLabel(volume, avgVolume) {
  if (!Number.isFinite(volume) || !Number.isFinite(avgVolume) || avgVolume === 0) return 'N/A';
  const ratio = volume / avgVolume;
  if (ratio >= 1.2) return 'Above average';
  if (ratio <= 0.8) return 'Below average';
  return 'Average';
}

// Scoring assumptions (Flow Integrity Audit #1):
// - Yahoo's public chart endpoint (the only source for US/Global quotes, and
//   for prices in every market) never returns fundamentals like
//   returnOnEquity/profitMargins/debtToEquity -- those only exist for India,
//   scraped separately from Screener.in. The old score() read them straight
//   off the chart-quote object, so for US/Global stocks 3 of its 5 checks
//   could never fire and the ceiling silently capped out around 64, well
//   below the UI's BUY threshold (score() below feeds signal() in script.js,
//   which needs >=70 for BUY and >=55 for ACCUMULATE).
// - India score = 60% fundamentals (ROE, ROCE, debt/equity from Screener) +
//   40% price trend, so India stocks are rewarded for momentum too.
// - US/Global score is 100% price trend (50-day/200-day averages, distance
//   from the 52-week high, daily move) since no fundamentals exist there.
// - Each individual signal defaults to a neutral 50 when its input is
//   missing (rather than being dropped/zeroed), so absent data never
//   silently drags a score down, and the trend scale is picked so a stock
//   genuinely trading above its averages and near its high can still cross
//   the BUY/HOLD thresholds regardless of market.
function trendSignal(quote) {
  const price = quote.regularMarketPrice;
  const signals = [];
  if (Number.isFinite(price) && quote.fiftyDayAverage > 0) signals.push(clamp(50 + (price / quote.fiftyDayAverage - 1) * 220, 0, 100));
  if (Number.isFinite(price) && quote.twoHundredDayAverage > 0) signals.push(clamp(50 + (price / quote.twoHundredDayAverage - 1) * 150, 0, 100));
  if (Number.isFinite(price) && quote.fiftyTwoWeekHigh > 0) signals.push(clamp(100 - (1 - price / quote.fiftyTwoWeekHigh) * 140, 0, 100));
  if (Number.isFinite(quote.regularMarketChangePercent)) signals.push(clamp(50 + quote.regularMarketChangePercent * 4, 0, 100));
  return signals.length ? average(signals) : 50;
}
function score(quote, fundamentals) {
  const trend = trendSignal(quote);
  if (!fundamentals) return Math.round(clamp(trend, 5, 98));
  const roeScore = Number.isFinite(fundamentals.roe) ? clamp(50 + (fundamentals.roe - 15) * 3, 0, 100) : 50;
  const roceScore = Number.isFinite(fundamentals.roce) ? clamp(50 + (fundamentals.roce - 15) * 3, 0, 100) : 50;
  const leverageScore = Number.isFinite(fundamentals.debtToEquity) ? clamp(90 - fundamentals.debtToEquity / 2, 0, 100) : 50;
  const fundamentalScore = average([roeScore, roceScore, leverageScore]);
  return Math.round(clamp(fundamentalScore * .6 + trend * .4, 5, 98));
}

const htmlText = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#x20;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const extractNumber = (text, label) => {
  const match = text.match(new RegExp(`${label}\\s*(?:₹|Rs\\.?|INR)?\\s*([\\d,.]+)`, 'i'));
  return match ? Number(match[1].replace(/,/g, '')) : null;
};
const extractPercent = (text, label) => {
  const match = text.match(new RegExp(`${label}\\s*([\\d,.]+)\\s*%`, 'i'));
  return match ? Number(match[1].replace(/,/g, '')) : null;
};

async function indiaFundamentals(symbol) {
  const code = screenerAliases[symbol.replace(/\.NS$|\.BO$/, '')] || symbol.replace(/\.NS$|\.BO$/, '');
  const cached = fundamentalsCache.get(code);
  if (cached && Date.now() - cached.saved < 15 * 60 * 1000) return cached.value;
  try {
    const response = await request(`https://www.screener.in/company/${encodeURIComponent(code)}/consolidated/`);
    const text = htmlText(await response.text());
    const value = {
      marketCap: extractNumber(text, 'Market Cap'), pe: extractNumber(text, 'Stock P/E'), bookValue: extractNumber(text, 'Book Value'),
      dividendYield: extractPercent(text, 'Dividend Yield'), roce: extractPercent(text, 'ROCE'), roe: extractPercent(text, 'ROE'),
      debt: extractNumber(text, 'Borrowings') ?? extractNumber(text, 'Debt'), equity: extractNumber(text, 'Reserves'),
      source: 'Screener.in'
    };
    value.debtToEquity = value.debt != null && value.equity > 0 ? number(value.debt / value.equity * 100) : null;
    fundamentalsCache.set(code, { saved: Date.now(), value });
    return value;
  } catch { return { source: 'Unavailable' }; }
}

function isInSelectedMarket(quote, market) {
  const exchange = String(quote.exchange || quote.exchDisp || '').toUpperCase();
  const region = String(quote.region || '').toUpperCase();
  const quoteMarket = String(quote.market || '').toUpperCase();
  if (market === 'India') return /\.NS$|\.BO$/.test(quote.symbol) || /NSE|BSE|NSI|BOM/.test(exchange);
  if (market === 'United States') return !/\.NS$|\.BO$/.test(quote.symbol) && (region === 'US' || quoteMarket === 'US_MARKET' || /NMS|NYQ|NCM|NGM|NAS|PCX|ASE|AMEX|BTS|USA/.test(exchange));
  return true;
}

async function tickerList(sector, market) {
  const lower = sector.toLowerCase();
  // Sugar & Biofuel is deliberately India-only (no preset exists for other
  // markets), so it correctly falls through to symbol search below there.
  const preset = Object.entries(sectorPresets[market] || {}).find(([key]) => lower.includes(key));
  if (preset) return preset[1];
  const searchYahoo = async (query) => {
    const data = await (await request(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=30&newsCount=0`)).json();
    return (data.quotes || []).filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'ETF');
  };
  const queries = market === 'India' ? [`${sector} India NSE`, `${sector} India stock`] : market === 'United States' ? [`${sector} United States stock`, `${sector} US stock`, sector] : [`${sector} global stock`, sector];
  const seen = new Set();
  const raw = [];
  for (const query of queries) {
    for (const quote of await searchYahoo(query)) {
      if (!seen.has(quote.symbol)) { seen.add(quote.symbol); raw.push(quote); }
    }
  }
  const filtered = raw.filter(q => isInSelectedMarket(q, market)).map(q => q.symbol).slice(0, 10);
  if (filtered.length) return filtered;
  if (market !== 'India') return raw.filter(q => !/\.NS$|\.BO$/.test(q.symbol)).map(q => q.symbol).slice(0, 10);
  return raw.map(q => q.symbol).slice(0, 10);
}

// Yahoo's old multi-symbol quote endpoint often returns HTTP 401 without a
// browser cookie/crumb. The chart endpoint is public and supplies the live
// price plus the technical fields needed for the dashboard.
async function getQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false`;
  const data = await (await request(url)).json();
  const result = data.chart?.result?.[0];
  if (!result?.meta) return null;
  const meta = result.meta;
  const closes = (result.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
  const volumes = (result.indicators?.quote?.[0]?.volume || []).filter(Number.isFinite);
  const recent = closes.at(-1) ?? meta.regularMarketPrice;
  const movingAverage = (days) => closes.slice(-days).reduce((sum, value, _, list) => sum + value / list.length, 0);
  return {
    symbol, shortName: meta.shortName, longName: meta.longName,
    currency: meta.currency, regularMarketPrice: recent,
    regularMarketChangePercent: meta.chartPreviousClose ? ((recent - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : null,
    fiftyDayAverage: closes.length >= 50 ? movingAverage(50) : null,
    twoHundredDayAverage: closes.length >= 200 ? movingAverage(200) : null,
    fiftyTwoWeekHigh: Math.max(...closes), fiftyTwoWeekLow: Math.min(...closes),
    regularMarketVolume: meta.regularMarketVolume || null,
    rsi14: rsi14(closes),
    avgVolume20: volumes.length ? average(volumes.slice(-20)) : null
  };
}

async function getQuotes(symbols) {
  const settled = await Promise.allSettled(symbols.map(getQuote));
  return settled.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value);
}

async function newsFor(sector, stocks = [], market = 'Global') {
  try {
    const focus = stocks.slice(0, 4).map(s => `"${s.name}"`).join(' OR ');
    const query = `(${sector}) OR (${focus}) stocks ${market}`;
    const country = market === 'India' ? { hl: 'en-IN', gl: 'IN' } : market === 'United States' ? { hl: 'en-US', gl: 'US' } : { hl: 'en-US', gl: 'US' };
    const xml = await (await request(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${country.hl}&gl=${country.gl}&ceid=${country.gl}:en`)).text();
    return [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/g)]
      .slice(0, 6).map(m => ({ title: m[1].replace(/<!\[CDATA\[|\]\]>/g, ''), url: m[2], date: m[3] }));
  } catch { return []; }
}

async function research(sector, market) {
  const symbols = await tickerList(sector, market);
  if (!symbols.length) throw new Error('No listed securities found. Try a more specific sector or use a well-known industry name.');
  const quotes = await getQuotes(symbols);
  if (!quotes.length) throw new Error('The market-data source did not return prices for this sector. Please try again shortly.');
  const details = market === 'India' ? await Promise.all(quotes.map(q => indiaFundamentals(q.symbol))) : quotes.map(() => ({ source: 'Not configured' }));
  const stocks = quotes.map((q, index) => ({
    symbol: q.symbol, name: q.longName || q.shortName || q.symbol, currency: q.currency, price: number(q.regularMarketPrice), change: number(q.regularMarketChangePercent), marketCap: number(details[index].marketCap ?? q.marketCap), marketCapUnit: details[index].marketCap ? 'Cr' : null,
    pe: number(details[index].pe), pb: details[index].bookValue && q.regularMarketPrice ? number(q.regularMarketPrice / details[index].bookValue) : number(q.priceToBook), dividendYield: number(details[index].dividendYield), debtToEquity: number(details[index].debtToEquity), debt: number(details[index].debt), roce: number(details[index].roce), roe: number(details[index].roe), fifty: number(q.fiftyDayAverage), twoHundred: number(q.twoHundredDayAverage), high52: number(q.fiftyTwoWeekHigh), low52: number(q.fiftyTwoWeekLow), volume: q.regularMarketVolume || null, source: details[index].source, score: score(q, market === 'India' ? details[index] : null),
    rsi: number(q.rsi14), trend: trendLabel(q.regularMarketPrice, q.fiftyDayAverage, q.twoHundredDayAverage), momentum: momentumLabel(q.rsi14), volumeTrend: volumeTrendLabel(q.regularMarketVolume, q.avgVolume20)
  })).sort((a, b) => b.score - a.score);
  const avg = (key) => { const valid = stocks.map(s => s[key]).filter(Number.isFinite); return valid.length ? number(valid.reduce((a,b) => a + b, 0) / valid.length) : null; };
  // Data contract: every stock must carry price/signal/pe/industryPe, even
  // when null, so the frontend never needs a fallback branch for them.
  // industryPe is the sector's own average P/E across the screened universe
  // (there is no separate industry-classification data source), applied
  // uniformly so it reads as a genuine peer benchmark next to each P/E.
  const industryPe = avg('pe');
  stocks.forEach(s => { s.industryPe = industryPe; s.signal = s.score >= 70 ? 'BUY' : s.score >= 55 ? 'ACCUMULATE' : 'HOLD'; });
  const avgScore = Math.round(avg('score') || 50);
  const avgChange = avg('change');
  const trend = avgChange >= 0 ? 'Constructive' : 'Cautious';
  const recommendation = avgScore >= 70 ? 'OVERWEIGHT' : avgScore >= 55 ? 'SELECTIVE' : 'NEUTRAL';
  return { sector, market, generatedAt: new Date().toISOString(), recommendation, score: avgScore, trend, stocks, news: await newsFor(sector, stocks, market), summary: `${sector} is screened across listed securities returned by public market-data sources. For India, valuation and return ratios are enriched from Screener.in; prices and trend inputs come from Yahoo Finance's public chart feed. Treat the output as research support—not investment advice—and validate every decision against company filings.`, averages: { pe: avg('pe'), roe: avg('roe'), change: avgChange } };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/research') {
    try { const sector = clean(url.searchParams.get('sector')); if (!sector) throw new Error('A sector is required.'); const result = await research(sector, clean(url.searchParams.get('market')) || 'Global'); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result)); }
    catch (error) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
    return;
  }
  const safePath = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^([.][.][\\/])+/, '');
  try { const file = await readFile(join(root, safePath)); res.writeHead(200, { 'content-type': mime[extname(safePath)] || 'application/octet-stream' }); res.end(file); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`Signal Desk: http://localhost:${port}`));

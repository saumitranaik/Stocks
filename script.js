const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = (value) => value == null || !Number.isFinite(value) ? 'N/A' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
const pct = (value) => value == null || !Number.isFinite(value) ? 'N/A' : `${value >= 0 ? '+' : ''}${fmt(value)}%`;
const compact = (value) => value == null || !Number.isFinite(value) ? 'N/A' : new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const marketCap = (stock) => stock.marketCap == null ? 'N/A' : stock.marketCapUnit === 'Cr' ? `Rs ${fmt(stock.marketCap)} Cr` : compact(stock.marketCap);
const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const card = (title, value, note, className = '') => `<article class="card"><h3>${title}</h3><div class="kpi ${className}">${value}</div><div class="small">${note}</div></article>`;
// Signal is computed once, server-side (server.mjs), from the same score
// every table on this page already shows -- the frontend only renders it,
// so there is a single source of truth instead of duplicating the BUY/
// ACCUMULATE/HOLD thresholds here.
const tagClass = (text) => text === 'BUY' ? 'buy' : text === 'HOLD' ? 'hold' : 'neutral';
const signalTag = (stock) => `<span class="tag ${tagClass(stock.signal)}">${stock.signal}</span>`;
// Shared Overview stock-card component: Company Name, Ticker, Price,
// Signal, P/E, Industry P/E in that fixed order, used nowhere else.
const stockCard = (stock) => `<div class="quick-ref-card"><strong>${escape(stock.name)}</strong><small>${escape(stock.symbol)}</small><div class="card-metrics">
  <div class="metric-row"><span class="metric-label">Price</span><span class="metric-value">${fmt(stock.price)} ${escape(stock.currency || '')}</span></div>
  <div class="metric-row"><span class="metric-label">Signal</span><span class="metric-value tag ${tagClass(stock.signal)}">${stock.signal}</span></div>
  <div class="metric-row"><span class="metric-label">P/E</span><span class="metric-value">${fmt(stock.pe)}</span></div>
  <div class="metric-row"><span class="metric-label">Industry P/E</span><span class="metric-value industry-pe">${fmt(stock.industryPe)}</span></div>
</div></div>`;
let activeRequest;
let requestNumber = 0;

$$('.tabs button').forEach(button => button.addEventListener('click', () => {
  $$('.tabs button,.tab').forEach(element => element.classList.remove('active'));
  button.classList.add('active');
  $(`#${button.dataset.tab}`).classList.add('active');
}));

function stockRisk(stock, sectorPE) {
  const valuation = stock.pe == null || sectorPE == null ? 50 : Math.max(15, Math.min(90, 50 + (stock.pe / sectorPE - 1) * 40));
  const balance = stock.debtToEquity == null ? 50 : Math.max(10, Math.min(95, stock.debtToEquity / 2));
  const trend = stock.price && stock.twoHundred ? Math.max(10, Math.min(95, 50 - (stock.price / stock.twoHundred - 1) * 110)) : 50;
  const drawdown = stock.price && stock.high52 ? Math.max(10, Math.min(95, (1 - stock.price / stock.high52) * 140)) : 50;
  const composite = Math.round((valuation + balance + trend + drawdown) / 4);
  const primary = [['Valuation', valuation], ['Balance sheet', balance], ['Long-term trend', trend], ['52W drawdown', drawdown]].sort((a, b) => b[1] - a[1])[0][0];
  return { valuation, balance, trend, drawdown, composite, primary };
}

function render(data) {
  $('#empty').hidden = true;
  $('#dashboard-title').textContent = `${data.sector} Research Dashboard - ${data.market}`;
  $('#status').textContent = `Updated ${new Date(data.generatedAt).toLocaleString()} - ${data.market}`;
  $('#summary').textContent = data.summary;
  $('#allocation').textContent = `${data.stocks.length} stocks screened`;
  const avg = data.averages;
  $$('[data-quick-ref]').forEach(element => { element.innerHTML = data.stocks.map(stockCard).join(''); });
  $('#overview-kpis').innerHTML =
    card('Sector recommendation', data.recommendation, 'Screen-derived public-data signal', data.recommendation === 'OVERWEIGHT' ? 'positive' : 'amber') +
    `<article class="card"><h3>Investment score</h3><div class="score"><div class="score-circle">${data.score}</div><div class="small">Fundamental and trend proxy<br><br><div class="progress"><i style="width:${data.score}%"></i></div></div></div></article>` +
    card('Average trailing P/E', fmt(avg.pe), 'Across securities with reported data', 'blue') +
    card('Market trend', data.trend, `Average daily move ${pct(avg.change)}`, avg.change >= 0 ? 'positive' : 'amber');

  $('#leaders-table tbody').innerHTML = data.stocks.map((stock, index) => {
    const over200 = stock.price && stock.twoHundred ? (stock.price / stock.twoHundred - 1) * 100 : null;
    return `<tr><td>${index + 1}</td><td>${escape(stock.name)}</td><td>${escape(stock.symbol)}</td><td>${fmt(stock.price)} ${escape(stock.currency || '')}</td><td>${fmt(stock.pe)}</td><td>${stock.score}/100</td><td>${pct(stock.roe)}</td><td>${pct(stock.roce)}</td><td>${fmt(stock.debt)}</td><td>${pct(stock.debtToEquity)}</td><td class="${over200 >= 0 ? 'positive' : 'amber'}">${pct(over200)}</td><td>${signalTag(stock)}</td></tr>`;
  }).join('');

  $('#metrics-table tbody').innerHTML = data.stocks.map(stock => `<tr><td>${escape(stock.name)}</td><td>${signalTag(stock)}</td><td>${fmt(stock.price)} ${escape(stock.currency || '')}</td><td>${fmt(stock.pe)}</td><td class="${stock.change >= 0 ? 'positive' : 'amber'}">${pct(stock.change)}</td><td>${fmt(stock.high52)}</td><td>${fmt(stock.low52)}</td><td>${fmt(stock.fifty)}</td><td>${fmt(stock.twoHundred)}</td><td>${compact(stock.volume)}</td><td>${marketCap(stock)}</td><td>${pct(stock.debtToEquity)}</td></tr>`).join('');

  $('#valuation-kpis').innerHTML = card('Average trailing P/E', fmt(avg.pe), 'Reported-company average', 'blue') + card('Average ROE', pct(avg.roe), 'Reported-company average', 'positive') + card('Stocks with valuation data', `${data.stocks.filter(stock => stock.pe != null).length}/${data.stocks.length}`, 'P/E data supplied by source', 'positive') + card('Average daily move', pct(avg.change), 'Current market session', avg.change >= 0 ? 'positive' : 'amber');
  $('#valuation-table tbody').innerHTML = data.stocks.map(stock => {
    const discount = stock.price && stock.high52 ? (stock.price / stock.high52 - 1) * 100 : null;
    const view = stock.pe == null || avg.pe == null ? 'Review data' : stock.pe < avg.pe * .85 ? 'Below peer average' : stock.pe > avg.pe * 1.15 ? 'Above peer average' : 'Near peer average';
    return `<tr><td>${escape(stock.name)}</td><td>${signalTag(stock)}</td><td>${fmt(stock.price)} ${escape(stock.currency || '')}</td><td>${marketCap(stock)}</td><td>${fmt(stock.pe)}</td><td>${fmt(stock.pb)}</td><td>${pct(stock.roe)}</td><td>${pct(stock.roce)}</td><td>${pct(stock.dividendYield)}</td><td>${pct(discount)}</td><td>${view}</td><td>${escape(stock.source || 'N/A')}</td></tr>`;
  }).join('');

  const technical = data.stocks.map(stock => ({ ...stock, over50: stock.price && stock.fifty ? (stock.price / stock.fifty - 1) * 100 : null, over200: stock.price && stock.twoHundred ? (stock.price / stock.twoHundred - 1) * 100 : null, distanceHigh: stock.price && stock.high52 ? (stock.price / stock.high52 - 1) * 100 : null }));
  const above50 = technical.filter(stock => stock.over50 > 0).length;
  const above200 = technical.filter(stock => stock.over200 > 0).length;
  $('#technical-kpis').innerHTML = card('Above 50-day average', `${above50}/${data.stocks.length}`, 'Price-trend breadth', above50 > data.stocks.length / 2 ? 'positive' : 'amber') + card('Above 200-day average', `${above200}/${data.stocks.length}`, 'Long-term trend breadth', above200 > data.stocks.length / 2 ? 'positive' : 'amber') + card('Average daily move', pct(avg.change), 'Current market session', avg.change >= 0 ? 'positive' : 'amber') + card('Technical stance', data.trend, 'Based on moving-average proxies', 'blue');
  $('#technical-table tbody').innerHTML = technical.map(stock => `<tr><th scope="row">${escape(stock.name)}</th><td>${signalTag(stock)}</td><td class="num">${fmt(stock.price)} ${escape(stock.currency || '')}</td><td class="num">${fmt(stock.pe)}</td><td class="num industry-pe">${fmt(stock.industryPe)}</td><td class="num">${fmt(stock.rsi)}</td><td class="num">${fmt(stock.fifty)}</td><td class="num">${fmt(stock.twoHundred)}</td><td class="num">${fmt(stock.high52)}</td><td class="num">${fmt(stock.low52)}</td><td class="num ${stock.distanceHigh >= 0 ? 'positive' : 'amber'}">${pct(stock.distanceHigh)}</td><td>${escape(stock.trend)}</td><td>${escape(stock.momentum)}</td><td>${escape(stock.volumeTrend)}</td></tr>`).join('');

  const weights = data.stocks.slice(0, 8).map(stock => Math.max(5, stock.score - 45));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  $('#portfolio-table tbody').innerHTML = data.stocks.slice(0, 8).map((stock, index) => `<tr><td>${escape(stock.name)}</td><td>${signalTag(stock)}</td><td>${fmt(stock.price)} ${escape(stock.currency || '')}</td><td>${fmt(stock.pe)}</td><td>${stock.score}/100</td><td>${Math.round(weights[index] / totalWeight * 100)}%</td><td>${index < 3 ? 'Core' : index < 6 ? 'Growth' : 'Satellite'}</td></tr>`).join('');

  const risks = data.stocks.map(stock => ({ stock, ...stockRisk(stock, avg.pe) }));
  const sectorRisk = (field) => Math.round(risks.reduce((sum, risk) => sum + risk[field], 0) / risks.length);
  $('#risk-cards').innerHTML = [['Valuation risk', sectorRisk('valuation')], ['Balance-sheet risk', sectorRisk('balance')], ['Trend risk', sectorRisk('trend')], ['Drawdown risk', sectorRisk('drawdown')]].map(([name, value]) => `<article class="card risk ${value > 65 ? 'high' : ''}"><h3>${name}</h3><div class="kpi">${value}/100</div><div class="bar"><i style="width:${value}%"></i></div></article>`).join('');
  $('#risk-table tbody').innerHTML = risks.map(risk => `<tr><td>${escape(risk.stock.name)}</td><td>${signalTag(risk.stock)}</td><td>${fmt(risk.stock.price)} ${escape(risk.stock.currency || '')}</td><td>${fmt(risk.stock.pe)}</td><td>${Math.round(risk.valuation)}/100</td><td>${Math.round(risk.balance)}/100</td><td>${Math.round(risk.trend)}/100</td><td>${Math.round(risk.drawdown)}/100</td><td><span class="tag ${risk.composite > 65 ? 'hold' : 'buy'}">${risk.composite}/100</span></td><td>${risk.primary}</td></tr>`).join('');
  $('#risk-summary').textContent = `The primary monitorables for ${data.sector} are shown for each stock above. Scores combine relative valuation, reported leverage when available, long-term price trend and distance from the 52-week high. They are comparative screening indicators, not predictions.`;
  $('#news-list').innerHTML = data.news.length ? data.news.map(item => `<div class="news-item"><a target="_blank" rel="noopener" href="${escape(item.url)}">${escape(item.title)}</a><small>${new Date(item.date).toLocaleDateString()}</small></div>`).join('') : '<p class="small">No sector or constituent-stock news was returned by the source for this query.</p>';
}

$('#search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  const currentRequest = ++requestNumber;
  const market = $('#market').value;
  if (activeRequest) activeRequest.abort();
  activeRequest = new AbortController();
  button.disabled = true;
  button.textContent = 'Searching web...';
  $('#status').textContent = `Searching ${market} sources`;
  try {
    const response = await fetch(`/api/research?sector=${encodeURIComponent($('#sector').value)}&market=${encodeURIComponent(market)}`, { signal: activeRequest.signal });
    const data = await response.json();
    if (currentRequest !== requestNumber) return;
    if (!response.ok) throw Error(data.error || 'Unable to load data');
    render(data);
  } catch (error) {
    if (error.name !== 'AbortError' && currentRequest === requestNumber) $('#status').textContent = `Research failed: ${error.message}`;
  } finally {
    if (currentRequest === requestNumber) { button.disabled = false; button.textContent = 'Research sector'; }
  }
});

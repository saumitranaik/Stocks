// Portfolio Review Pack renderer (Phase 5). Fetches the pack model built by
// data/reporting/portfolioReviewPack.mjs (server.mjs's
// GET /api/watchlists/:id/portfolio-review -- cache-only, no network fetch
// triggered) and renders it into the A4 document portfolio-review.html
// provides the shell for. Same conventions as report.js (the per-company
// report) but standalone -- shares no runtime state with script.js or
// report.js, only the same house style.

const $ = (selector, root = document) => root.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const fmt = (value, digits = 2) => value == null || !Number.isFinite(value) ? 'N/A' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
const pct = (value, digits = 1) => value == null || !Number.isFinite(value) ? 'N/A' : `${value >= 0 ? '+' : ''}${fmt(value, digits)}%`;
const compact = (value) => value == null || !Number.isFinite(value) ? 'N/A' : new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(value);

const RATING_CLASS = { 'Strong Buy': 'tag-strong-buy', Buy: 'tag-buy', Accumulate: 'tag-accumulate', Hold: 'tag-hold', Reduce: 'tag-reduce', Sell: 'tag-sell', 'Add aggressively': 'tag-strong-buy', Add: 'tag-buy', Exit: 'tag-sell' };
const tagClass = (label) => RATING_CLASS[label] || 'tag-neutral';
const labelTag = (label) => `<span class="tag ${tagClass(label)}">${escape(label || 'N/A')}</span>`;

let metricMeta = {};
function dataTag(key) {
  const meta = metricMeta[key];
  if (!meta) return '';
  const label = meta.tier === 'sourced' ? 'Sourced' : meta.tier === 'calculated' ? 'Calculated' : 'Heuristic';
  return `<span class="data-tag ${meta.tier}" title="${escape(meta.confidence)} confidence. ${escape(meta.methodology)}">${label}</span>`;
}

function scoreCellClass(score, invert = false) {
  if (score == null) return '';
  const v = invert ? 100 - score : score;
  return v >= 65 ? 'pos' : v >= 40 ? 'amber-text' : 'neg';
}

function kpi(label, value, note = '', valueClass = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value ${valueClass}">${value}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
}
function section(num, title, bodyHtml) {
  return `<details class="section" open id="sec-${num}"><summary><span class="num">${num}</span>${escape(title)}</summary><div class="section-body">${bodyHtml}</div></details>`;
}
// A 0-100 (or 0-max) horizontal bar row -- the report-page equivalent of the
// main dashboard's .allocation-row, reused for sector weight, factor
// exposure and risk-contribution reads.
function barRow(label, valuePct, displayValue, max = 100) {
  const width = Math.max(0, Math.min(100, ((valuePct ?? 0) / max) * 100));
  return `<div class="bar-row"><span class="bl">${escape(label)}</span><span class="bt"><i style="width:${width}%"></i></span><span class="bv">${displayValue}</span></div>`;
}

// Same hand-written inline-SVG sparkline as report.js, for the portfolio
// health history chart -- duplicated rather than imported/shared, matching
// this project's zero-build, no-module frontend architecture (report.js
// itself doesn't share code with script.js for the same reason).
function sparklineSvg(series, { width = 560, height = 108, decimals = 0, suffix = '' } = {}) {
  const points = (series || []).filter(p => Number.isFinite(p.value));
  if (points.length < 2) return '<div class="no-data">No historical series available for this chart.</div>';
  const values = points.map(p => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max - min) || Math.abs(max) || 1;
  const pad = 4, top = 14, bottom = 20;
  const innerW = width - pad * 2, innerH = height - top - bottom;
  const xFor = (i) => pad + (i / (points.length - 1)) * innerW;
  const yFor = (v) => top + innerH - ((v - min) / range) * innerH;
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${xFor(points.length - 1).toFixed(1)},${(top + innerH).toFixed(1)} L${xFor(0).toFixed(1)},${(top + innerH).toFixed(1)} Z`;
  const last = points.at(-1), first = points[0];
  return `<svg class="linechart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Trend chart">
    <path d="${areaPath}" fill="#0c234015" stroke="none"></path>
    <path d="${linePath}" fill="none" stroke="#0c2340" stroke-width="2"></path>
    <circle cx="${xFor(points.length - 1).toFixed(1)}" cy="${yFor(last.value).toFixed(1)}" r="3" fill="#a87c1f"></circle>
    <text x="0" y="${height - 4}" font-size="9" fill="#5b6472">${escape(first.period || first.date || '')}</text>
    <text x="${width}" y="${height - 4}" font-size="9" fill="#5b6472" text-anchor="end">${escape(last.period || last.date || '')}</text>
    <text x="${width}" y="10" font-size="10" fill="#0c2340" font-weight="700" text-anchor="end">${fmt(last.value, decimals)}${suffix}</text>
    <text x="0" y="10" font-size="9" fill="#5b6472">Min ${fmt(min, decimals)}${suffix} &middot; Max ${fmt(max, decimals)}${suffix}</text>
  </svg>`;
}
function chart(title, series, opts) {
  return `<div class="chart-wrap"><div class="chart-title">${escape(title)}</div>${sparklineSvg(series, opts)}</div>`;
}

// ---------------------------------------------------------------- Masthead
function renderMasthead(pack) {
  const generated = pack.generatedAt ? new Date(pack.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';
  return `<div class="masthead">
    <div>
      <div class="brand">Investment Committee &mdash; Portfolio Review</div>
      <h1>${escape(pack.watchlistName)}</h1>
      <div class="sub">${pack.portfolioSummary.companyCount} companies &middot; ${labelTag(pack.portfolioSummary.watchlistRating)}</div>
    </div>
    <div class="meta">
      <div>Report generated ${escape(generated)}</div>
    </div>
  </div>`;
}

// ------------------------------------------------------------ 1. Portfolio summary
function renderPortfolioSummary(p) {
  const w = p.weightedAverages || {};
  return `
    <div class="kpi-grid">
      ${kpi('Companies', p.companyCount)}
      ${kpi('Illustrative total value', compact(p.totalValue), dataTag('portfolioValue'))}
      ${kpi('Portfolio beta', fmt(p.beta), dataTag('portfolioBeta'))}
      ${kpi('Risk-adjusted return (proxy)', fmt(p.riskAdjustedReturn, 2), dataTag('riskAdjustedReturnScore'))}
      ${kpi('Cash target', `${fmt(p.cashTargetPct)}%`, dataTag('cashTargetPct'))}
      ${kpi('Trend', escape(p.trend || 'N/A'))}
      ${kpi('Quality score', p.quality?.qualityScore != null ? `${fmt(p.quality.qualityScore, 0)}/100` : 'N/A', dataTag('portfolioQualityScore'), scoreCellClass(p.quality?.qualityScore))}
      ${kpi('Risk score (inverted)', p.quality?.riskScore != null ? `${fmt(p.quality.riskScore, 0)}/100` : 'N/A', '', scoreCellClass(p.quality?.riskScore))}
    </div>
    <div class="card"><h4>Weighted-average fundamentals</h4>
      <table><tbody>
        <tr><td>P/E</td><td class="num">${fmt(w.pe)}</td><td>ROE</td><td class="num">${pct(w.roe)}</td></tr>
        <tr><td>ROCE</td><td class="num">${pct(w.roce)}</td><td>Revenue growth (3Y)</td><td class="num">${pct(w.revenueGrowth3y)}</td></tr>
        <tr><td>Dividend yield</td><td class="num">${pct(w.dividendYield)}</td><td>FCF yield</td><td class="num">${pct(w.fcfYield)}</td></tr>
      </tbody></table>
    </div>`;
}

// ------------------------------------------------------------ 2. Valuation summary
function renderValuationSummary(v) {
  const a = v.averages || {};
  const dispersionRows = Object.entries(v.valuationDispersion || {}).map(([sector, d]) => `<tr>
      <td>${escape(sector)}</td><td class="num">${fmt(d.mean)}</td><td class="num">${fmt(d.median)}</td>
      <td class="num">${fmt(d.stdDev)}</td><td class="num">${fmt(d.coefficientOfVariation, 2)}</td><td class="num">${d.sampleSize ?? 'N/A'}</td>
    </tr>`).join('');
  return `
    <div class="kpi-grid three">
      ${kpi('Valuation status', escape(v.valuationStatus || 'N/A'), dataTag('sectorPremiumDiscount'))}
      ${kpi('Avg. premium/discount', pct(v.avgPremiumDiscount), '', v.avgPremiumDiscount >= 0 ? 'neg' : 'pos')}
      ${kpi('Sector/watchlist P/E &middot; P/B', `${fmt(v.industryPe)} &middot; ${fmt(v.industryPb)}`, dataTag('industryPe'))}
    </div>
    <div class="card"><h4>Watchlist averages</h4>
      <table><tbody>
        <tr><td>P/E</td><td class="num">${fmt(a.pe)}</td><td>ROE</td><td class="num">${pct(a.roe)}</td></tr>
        <tr><td>ROCE</td><td class="num">${pct(a.roce)}</td><td>Debt/equity</td><td class="num">${fmt(a.debtToEquity)}%</td></tr>
        <tr><td>Revenue growth (3Y)</td><td class="num">${pct(a.revenueGrowth3y)}</td><td>Avg. composite score</td><td class="num">${a.score != null ? fmt(a.score, 0) : 'N/A'}</td></tr>
      </tbody></table>
    </div>
    ${dispersionRows ? `<div class="card"><h4>Valuation dispersion by sector ${dataTag('valuationDispersion')}</h4>
      <table><thead><tr><th>Sector</th><th class="num">Mean P/E</th><th class="num">Median</th><th class="num">Std. dev</th><th class="num">Coeff. of variation</th><th class="num">Sample</th></tr></thead><tbody>${dispersionRows}</tbody></table></div>` : ''}`;
}

// ------------------------------------------------------------ 3. Concentration & risk
function renderConcentration(c) {
  const sectorRows = (c.sectorAllocation?.allocation || []).map(a => barRow(a.sector, a.sharePct, pct(a.sharePct, 1).replace('+', '')));
  const positionRows = (c.positionConcentration?.contributions || []).slice(0, 10).map(p => `<tr>
      <td>${escape(p.name)} <span class="small">(${escape(p.symbol)})</span></td>
      <td class="num">${fmt(p.weightPct)}%</td><td class="num">${fmt(p.hhiContributionPct)}%</td>
    </tr>`).join('');
  const riskRows = (c.positionRiskContribution || []).slice(0, 10).map(r => `<tr>
      <td>${escape(r.name)} <span class="small">(${escape(r.symbol)})</span></td><td class="num">${fmt(r.riskContributionPct)}%</td>
    </tr>`).join('');
  const factorRows = Object.values(c.factorExposure || {}).map(f => barRow(f.label, f.exposure, f.exposure != null ? `${f.exposure}/100` : 'N/A'));
  return `
    <div class="kpi-grid three">
      ${kpi('Diversification score', c.diversificationScore != null ? `${c.diversificationScore}/100` : 'N/A', dataTag('diversification'))}
      ${kpi('Largest position', c.positionConcentration?.topPositionPct != null ? `${fmt(c.positionConcentration.topPositionPct)}%` : 'N/A')}
      ${kpi('Risk status', escape(c.riskStatus || 'N/A'), c.avgCompositeRisk != null ? `Avg. composite risk ${c.avgCompositeRisk}/100` : '', scoreCellClass(c.avgCompositeRisk, true))}
    </div>
    <div class="card"><h4>Sector allocation (weighted) ${dataTag('diversification')}</h4>${sectorRows.join('') || '<p class="small">No sector allocation available.</p>'}</div>
    <div class="two-col">
      <div class="card"><h4>Position diversification impact ${dataTag('positionDiversificationImpact')}</h4>
        <table><thead><tr><th>Position</th><th class="num">Weight</th><th class="num">Share of HHI</th></tr></thead><tbody>${positionRows || '<tr><td colspan="3" class="small">Not available.</td></tr>'}</tbody></table>
      </div>
      <div class="card"><h4>Position risk contribution ${dataTag('positionRiskContribution')}</h4>
        <table><thead><tr><th>Position</th><th class="num">Risk contribution</th></tr></thead><tbody>${riskRows || '<tr><td colspan="2" class="small">Not available (needs overlapping price history for the correlation matrix).</td></tr>'}</tbody></table>
      </div>
    </div>
    <div class="card"><h4>Factor exposure (Value / Growth / Quality / Momentum / Size) ${dataTag('factorExposure')}</h4>${factorRows.join('') || '<p class="small">Not available.</p>'}</div>`;
}

// ------------------------------------------------------------ 4. Sector positioning
function renderSectorPositioning(rows) {
  if (!rows?.length) return '<p class="small">No sector positioning available.</p>';
  const body = rows.map(r => `<tr>
      <td>${escape(r.sector)}</td><td class="num">${fmt(r.weightSharePct)}%</td><td class="num">${r.companyCount}</td>
      <td class="num ${scoreCellClass(r.avgQuality)}">${fmt(r.avgQuality)}</td><td class="num ${scoreCellClass(r.avgRisk, true)}">${fmt(r.avgRisk)}</td>
      <td class="num">${fmt(r.qualityContribution)}</td><td class="num">${fmt(r.riskContribution)}</td>
    </tr>`).join('');
  return `<table><thead><tr><th>Sector</th><th class="num">Weight</th><th class="num">Companies</th><th class="num">Avg. quality</th><th class="num">Avg. risk</th><th class="num">Quality contrib.</th><th class="num">Risk contrib.</th></tr></thead><tbody>${body}</tbody></table>
    <p class="small">${dataTag('sectorContribution')} Each sector's weight-normalized contribution to the portfolio's own quality/risk scores above.</p>`;
}

// ------------------------------------------------------------ 5/6. Top opportunities / risks
function renderNamedReasonList(items, emptyText) {
  if (!items?.length) return `<p class="small">${escape(emptyText)}</p>`;
  return `<ul class="bullets">${items.map(i => `<li><b>${escape(i.name)}</b> (${escape(i.symbol)}) &mdash; ${escape(i.reason)}</li>`).join('')}</ul>`;
}

// ------------------------------------------------------------ 7. Portfolio health
function renderHealth(h) {
  const history = (h.history || []).map(pt => ({ date: pt.fetchedAt, value: pt.healthScore }));
  return `
    <div class="kpi-grid three">
      ${kpi('Health score', h.score != null ? `${h.score}/100` : 'N/A', dataTag('portfolioHealthScore'), scoreCellClass(h.score))}
      ${kpi('Trend', escape(h.trend || 'N/A'))}
      ${kpi('History points', history.length)}
    </div>
    ${chart('Portfolio health score over time', history)}
    <div class="card"><h4>Contributors (weakest first)</h4>
      ${(h.contributors || []).map(c => barRow(c.label, c.score, c.score != null ? `${fmt(c.score, 0)}/100` : 'N/A')).join('') || '<p class="small">Not available.</p>'}
    </div>`;
}

// ------------------------------------------------------------ 8. Action priorities
function renderActionPriorities(items) {
  if (!items?.length) return '<p class="small">No action-scored positions.</p>';
  const rows = items.map(a => `<tr>
      <td>${escape(a.name)} <span class="small">(${escape(a.symbol)})</span></td>
      <td>${labelTag(a.label)}</td><td class="num">${a.score}</td><td class="small">${escape(a.rationale || 'N/A')}</td>
    </tr>`).join('');
  return `<table><thead><tr><th>Company</th><th>Action</th><th class="num">Score</th><th>Rationale</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">${dataTag('actionScore')}</p>`;
}

// ------------------------------------------------------------ 9. Rebalancing
function renderRebalancing(items) {
  if (!items?.length) return '<p class="small">No rebalancing suggestions.</p>';
  const rows = items.map(r => `<tr>
      <td>${escape(r.name)} <span class="small">(${escape(r.symbol)})</span></td>
      <td>${escape(r.action)}</td><td class="small">${escape(r.rationale || 'N/A')}</td>
    </tr>`).join('');
  return `<table><thead><tr><th>Company</th><th>Action</th><th>Rationale</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">${dataTag('rebalancingSuggestion')}</p>`;
}

function renderDataLimitations(list) {
  return `<div class="disclaimer-box"><b>Data policy &amp; limitations.</b> Values are retrieved at fetch time. This pack is research support, not investment advice &mdash; verify prices, filings and corporate actions before making decisions.
    <ul>${(list || []).slice(0, 6).map(item => `<li>${escape(item)}</li>`).join('')}</ul></div>`;
}

function renderPack(pack) {
  metricMeta = pack.metricMeta || {};
  document.title = `${pack.watchlistName} — Portfolio Review Pack`;
  $('#toolbar-name').textContent = `${pack.watchlistName} — Portfolio Review Pack`;

  const html = [
    renderMasthead(pack),
    section(1, 'Portfolio summary', renderPortfolioSummary(pack.portfolioSummary)),
    section(2, 'Valuation summary', renderValuationSummary(pack.valuationSummary)),
    section(3, 'Concentration analysis', renderConcentration(pack.concentrationAndRisk)),
    section(4, 'Sector positioning', renderSectorPositioning(pack.sectorPositioning)),
    section(5, 'Top opportunities', renderNamedReasonList(pack.topOpportunities, 'No names currently rated Add/Add aggressively with positive upside.')),
    section(6, 'Top risks', renderNamedReasonList(pack.topRisks, 'No positions currently flagged for elevated or deteriorating risk.')),
    section(7, 'Portfolio health', renderHealth(pack.health)),
    section(8, 'Action priorities', renderActionPriorities(pack.actionPriorities)),
    section(9, 'Rebalancing recommendations', renderRebalancing(pack.rebalancing)),
    renderDataLimitations(pack.dataLimitations),
    `<div class="report-footer"><span>Generated ${escape(new Date(pack.generatedAt).toLocaleString('en-IN'))}</span><span>${escape(pack.watchlistName)} watchlist</span></div>`
  ].join('');

  $('#report-root').innerHTML = html;
}

function renderError(message) {
  $('#report-root').innerHTML = `<div class="no-data" style="padding:40px 0;text-align:center">${escape(message)}</div>`;
}

// ---------------------------------------------------------------- Bootstrap
async function start() {
  const params = new URLSearchParams(location.search);
  const wl = params.get('wl');
  if (!wl) { renderError('Missing watchlist in the URL.'); return; }
  $('#back-link').href = `index.html?wl=${encodeURIComponent(wl)}`;
  try {
    const res = await fetch(`/api/watchlists/${encodeURIComponent(wl)}/portfolio-review`);
    const pack = await res.json();
    if (!res.ok || pack.error) { renderError(pack.error || 'Failed to generate the portfolio review pack.'); return; }
    renderPack(pack);
  } catch (error) {
    renderError(`Failed to load portfolio review pack: ${error.message}`);
  }
}
start();

// -- Toolbar actions (identical pattern to report.js) -----------------------
let sectionsClosedBeforePrint = [];
window.addEventListener('beforeprint', () => {
  sectionsClosedBeforePrint = [...document.querySelectorAll('details.section:not([open])')];
  sectionsClosedBeforePrint.forEach(d => { d.open = true; });
});
window.addEventListener('afterprint', () => {
  sectionsClosedBeforePrint.forEach(d => { d.open = false; });
  sectionsClosedBeforePrint = [];
});

$('#print-btn').addEventListener('click', () => window.print());

$('#download-btn').addEventListener('click', () => {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelector('.report-toolbar')?.remove();
  clone.querySelector('script[src="portfolio-review.js"]')?.remove();
  const inlineScript = clone.ownerDocument.createElement('script');
  inlineScript.textContent = 'document.title=document.title;';
  clone.querySelector('body').appendChild(inlineScript);
  const html = `<!doctype html>\n${clone.outerHTML}`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const wl = new URLSearchParams(location.search).get('wl') || 'portfolio';
  a.href = url; a.download = `${wl.replace(/[^A-Za-z0-9.-]/g, '_')}-portfolio-review-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

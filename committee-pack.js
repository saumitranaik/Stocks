// Weekly Investment Committee Pack renderer (Phase 6). Fetches the pack
// model built by data/reporting/committeePack.mjs (server.mjs's
// GET /api/watchlists/:id/committee-pack -- the watchlist half is cache-
// only, same as every other report page; macro/sector intelligence may
// trigger their own cache-first fetch on their own TTL, same as opening
// those Dashboard sub-tabs would) and renders it into the A4 document
// committee-pack.html provides the shell for. Same conventions as
// portfolio-review.js/report.js but standalone -- shares no runtime state
// with script.js or any other page, only the same house style.

const $ = (selector, root = document) => root.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const fmt = (value, digits = 2) => value == null || !Number.isFinite(value) ? 'N/A' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
const pct = (value, digits = 1) => value == null || !Number.isFinite(value) ? 'N/A' : `${value >= 0 ? '+' : ''}${fmt(value, digits)}%`;

const RATING_CLASS = { 'Strong Buy': 'tag-strong-buy', Buy: 'tag-buy', Accumulate: 'tag-accumulate', Hold: 'tag-hold', Reduce: 'tag-reduce', Sell: 'tag-sell', 'Add aggressively': 'tag-strong-buy', Add: 'tag-buy', Exit: 'tag-sell' };
const tagClass = (label) => RATING_CLASS[label] || 'tag-neutral';
const labelTag = (label) => `<span class="tag ${tagClass(label)}">${escape(label || 'N/A')}</span>`;
const THESIS_STATUS_CLASS = { Improving: 'tag-buy', Weakening: 'tag-hold', Broken: 'tag-sell' };

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
function barRow(label, valuePct, displayValue, max = 100) {
  const width = Math.max(0, Math.min(100, ((valuePct ?? 0) / max) * 100));
  return `<div class="bar-row"><span class="bl">${escape(label)}</span><span class="bt"><i style="width:${width}%"></i></span><span class="bv">${displayValue}</span></div>`;
}

// ---------------------------------------------------------------- Masthead
function renderMasthead(pack) {
  const generated = pack.generatedAt ? new Date(pack.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';
  return `<div class="masthead">
    <div>
      <div class="brand">Investment Committee &mdash; Weekly Pack</div>
      <h1>${escape(pack.watchlistName)}</h1>
      <div class="sub">Since this watchlist's last genuine data refresh</div>
    </div>
    <div class="meta">
      <div>Report generated ${escape(generated)}</div>
    </div>
  </div>`;
}

// ------------------------------------------------------------ 1. Portfolio changes
function renderPortfolioChanges(c) {
  const summary = (c.summary || []).slice(0, 40).map(line => `<li>${escape(line)}</li>`).join('');
  return `
    <div class="kpi-grid three">
      ${kpi('Valuation changes', c.valuation?.length ?? 0)}
      ${kpi('Risk changes', c.risk?.length ?? 0)}
      ${kpi('Other changes', c.other?.length ?? 0)}
    </div>
    <div class="card"><h4>All changes since last refresh ${dataTag('changeDetection')}</h4>
      ${summary ? `<ul class="bullets">${summary}</ul>` : '<p class="small">No changes since the last genuine data refresh.</p>'}
    </div>`;
}

// ------------------------------------------------------------ 2. Macro changes
function renderMacroChanges(m) {
  if (!m) return '<p class="small">Not available.</p>';
  const regime = m.regime || {};
  const rows = (m.indicators || []).map(i => `<tr>
      <td>${escape(i.label)}</td><td>${escape(i.category)}</td><td class="num">${pct(i.changePct)}</td><td>${escape(i.direction)}</td><td>${escape(i.status)}</td>
    </tr>`).join('');
  const dq = m.dataQuality || {};
  return `
    <div class="kpi-grid three">
      ${kpi('Market regime', escape(regime.label || 'N/A'), `Confidence: ${escape(regime.confidence || 'N/A')}`)}
      ${kpi('Live indicators', dq.live ?? 0)}
      ${kpi('Future Integration', dq.futureIntegration ?? 0, 'No data source configured')}
    </div>
    <div class="card"><h4>Regime notes</h4><ul class="bullets">${(regime.notes || []).map(n => `<li>${escape(n)}</li>`).join('') || '<li class="small">Not available.</li>'}</ul></div>
    <table><thead><tr><th>Indicator</th><th>Category</th><th class="num">Change</th><th>Direction</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="small">Not available.</td></tr>'}</tbody></table>`;
}

// ------------------------------------------------------------ 3. Sector changes
function renderSectorChanges(s) {
  if (!s?.topSectors?.length) return '<p class="small">Not available.</p>';
  const rows = s.topSectors.map(sec => `<tr>
      <td>${escape(sec.sector)}</td><td class="num">${sec.companyCount}</td>
      <td class="num ${scoreCellClass(sec.avgCompositeScore)}">${sec.avgCompositeScore ?? 'N/A'}</td>
      <td class="num ${scoreCellClass(sec.avgRiskScore, true)}">${sec.avgRiskScore ?? 'N/A'}</td>
      <td class="num">${pct(sec.avgRelativeStrengthPct)}</td>
    </tr>`).join('');
  return `<table><thead><tr><th>Sector</th><th class="num">Companies</th><th class="num">Composite</th><th class="num">Risk</th><th class="num">Rel. strength</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">${dataTag('sectorIntelligence')} Current state across every saved watchlist, not a week-over-week delta.</p>`;
}

// ------------------------------------------------------------ 4. Thesis changes
function renderThesisChanges(items) {
  if (!items?.length) return '<p class="small">No thesis status changed away from Intact.</p>';
  const rows = items.map(t => `<tr>
      <td>${escape(t.name)} <span class="small">(${escape(t.symbol)})</span></td>
      <td><span class="tag ${THESIS_STATUS_CLASS[t.status] || 'tag-neutral'}">${escape(t.status)}</span></td>
      <td class="small">${escape((t.reasons || []).join('; ') || 'N/A')}</td>
    </tr>`).join('');
  return `<table><thead><tr><th>Company</th><th>Thesis status</th><th>Reasons</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">${dataTag('thesisStatus')}</p>`;
}

// ------------------------------------------------------------ 5. Valuation summary
function renderValuationSummary(v) {
  const a = v.averages || {};
  return `
    <div class="kpi-grid three">
      ${kpi('Valuation status', escape(v.valuationStatus || 'N/A'), dataTag('sectorPremiumDiscount'))}
      ${kpi('Avg. premium/discount', pct(v.avgPremiumDiscount), '', v.avgPremiumDiscount >= 0 ? 'neg' : 'pos')}
      ${kpi('Avg. composite score', a.score != null ? fmt(a.score, 0) : 'N/A')}
    </div>`;
}

// ------------------------------------------------------------ 6. Risk summary + health
function renderRiskSummary(r) {
  const h = r.health || {};
  return `
    <div class="kpi-grid three">
      ${kpi('Risk status', escape(r.riskStatus || 'N/A'), r.avgCompositeRisk != null ? `Avg. composite risk ${r.avgCompositeRisk}/100` : '', scoreCellClass(r.avgCompositeRisk, true))}
      ${kpi('Portfolio health', h.score != null ? `${h.score}/100` : 'N/A', dataTag('portfolioHealthScore'), scoreCellClass(h.score))}
      ${kpi('Health trend', escape(h.trend || 'N/A'))}
    </div>
    <div class="card"><h4>Health contributors (weakest first)</h4>
      ${(h.contributors || []).map(c => barRow(c.label, c.score, c.score != null ? `${fmt(c.score, 0)}/100` : 'N/A')).join('') || '<p class="small">Not available.</p>'}
    </div>`;
}

// ------------------------------------------------------------ 7. Recommended actions
function renderRecommendedActions(items) {
  if (!items?.length) return '<p class="small">No action-scored positions.</p>';
  const rows = items.map(a => `<tr>
      <td>${escape(a.name)} <span class="small">(${escape(a.symbol)})</span></td>
      <td>${labelTag(a.label)}</td><td class="num">${a.score}</td><td class="small">${escape(a.rationale || 'N/A')}</td>
    </tr>`).join('');
  return `<table><thead><tr><th>Company</th><th>Action</th><th class="num">Score</th><th>Rationale</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">${dataTag('actionScore')}</p>`;
}

// ------------------------------------------------------------ 8. Rebalancing
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
    <ul>${(list || []).slice(0, 10).map(item => `<li>${escape(item)}</li>`).join('')}</ul></div>`;
}

function renderPack(pack) {
  metricMeta = pack.metricMeta || {};
  document.title = `${pack.watchlistName} — Weekly Investment Committee Pack`;
  $('#toolbar-name').textContent = `${pack.watchlistName} — Weekly Investment Committee Pack`;

  const html = [
    renderMasthead(pack),
    section(1, 'Portfolio changes', renderPortfolioChanges(pack.portfolioChanges)),
    section(2, 'Macro changes', renderMacroChanges(pack.macroChanges)),
    section(3, 'Sector changes', renderSectorChanges(pack.sectorChanges)),
    section(4, 'Thesis changes', renderThesisChanges(pack.thesisChanges)),
    section(5, 'Valuation summary', renderValuationSummary(pack.valuationSummary)),
    section(6, 'Risk changes & portfolio health', renderRiskSummary(pack.riskSummary)),
    section(7, 'Recommended actions', renderRecommendedActions(pack.recommendedActions)),
    section(8, 'Rebalancing recommendations', renderRebalancing(pack.rebalancing)),
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
    const res = await fetch(`/api/watchlists/${encodeURIComponent(wl)}/committee-pack`);
    const pack = await res.json();
    if (!res.ok || pack.error) { renderError(pack.error || 'Failed to generate the committee pack.'); return; }
    renderPack(pack);
  } catch (error) {
    renderError(`Failed to load committee pack: ${error.message}`);
  }
}
start();

// -- Toolbar actions (identical pattern to portfolio-review.js/report.js) --
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
  clone.querySelector('script[src="committee-pack.js"]')?.remove();
  const inlineScript = clone.ownerDocument.createElement('script');
  inlineScript.textContent = 'document.title=document.title;';
  clone.querySelector('body').appendChild(inlineScript);
  const html = `<!doctype html>\n${clone.outerHTML}`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const wl = new URLSearchParams(location.search).get('wl') || 'committee-pack';
  a.href = url; a.download = `${wl.replace(/[^A-Za-z0-9.-]/g, '_')}-committee-pack-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

// Institutional research report renderer (Phase 3d). Fetches the report
// model built by data/reporting/researchReport.mjs (server.mjs's
// GET /api/watchlists/:id/report/:symbol -- cache-only, no network fetch
// triggered) and renders the single A4 document report.html provides the
// shell for. Same conventions as the main app's script.js ($ / escape /
// innerHTML-string rendering) but standalone -- this page shares no runtime
// state with script.js, only the same house style.

const $ = (selector, root = document) => root.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const fmt = (value, digits = 2) => value == null || !Number.isFinite(value) ? 'N/A' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
const pct = (value, digits = 1) => value == null || !Number.isFinite(value) ? 'N/A' : `${value >= 0 ? '+' : ''}${fmt(value, digits)}%`;
const compact = (value) => value == null || !Number.isFinite(value) ? 'N/A' : new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const money = (value, currency) => value == null || !Number.isFinite(value) ? 'N/A' : `${fmt(value)} ${escape(currency || '')}`.trim();

const RATING_CLASS = { 'Strong Buy': 'tag-strong-buy', Buy: 'tag-buy', Accumulate: 'tag-accumulate', Hold: 'tag-hold', Reduce: 'tag-reduce', Sell: 'tag-sell' };
const tagClass = (rating) => RATING_CLASS[rating] || 'tag-neutral';
const ratingTag = (rating) => `<span class="tag ${tagClass(rating)}">${escape(rating || 'N/A')}</span>`;
const directionClass = (label) => label === 'Improving' ? 'pos' : label === 'Deteriorating' ? 'neg' : '';

let metricMeta = {};
// Data-quality badge (Sourced/Calculated/Heuristic), same classification
// dictionary the main dashboard ships as data.metricMeta -- a native `title`
// attribute is the hover tooltip (works everywhere, renders nothing in
// print, which is the expected behavior for a hover affordance).
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
function heatCellClass(score) {
  if (score == null) return '';
  return score >= 65 ? 'heat-high' : score >= 40 ? 'heat-med' : 'heat-low';
}

// -- Chart helpers: hand-written inline SVG, no library. `series` is an
// array of {period|date, value}. Print-safe (real vector paths), readable
// in grayscale (min/max/last are printed as text, not color-only). --
function sparklineSvg(series, { width = 560, height = 108, decimals = 1, suffix = '' } = {}) {
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

// Bear/Base/Bull valuation band vs. CMP -- same absolute-position marker
// convention the main dashboard already uses for support/resistance (see
// styles.css's .band/.band-marker), adapted to this page's own stylesheet.
function valuationBand({ bear, base, bull, cmp, currency }) {
  const values = [bear, base, bull, cmp].filter(Number.isFinite);
  if (values.length < 2) return '<div class="no-data">Valuation band not available.</div>';
  const min = Math.min(...values) * 0.94, max = Math.max(...values) * 1.06;
  const posPct = (v) => `${(((v - min) / (max - min)) * 100).toFixed(1)}%`;
  const marker = (v, label, isCmp) => Number.isFinite(v)
    ? `<div class="band-marker${isCmp ? ' cmp' : ''}" style="left:${posPct(v)}"><i></i><span>${escape(label)}<br>${money(v, currency)}</span></div>` : '';
  return `<div class="band">${marker(bear, 'Bear', false)}${marker(base, 'Base', false)}${marker(bull, 'Bull', false)}${marker(cmp, 'CMP', true)}</div>`;
}

function heatmap(categories) {
  const labels = [['financial', 'Financial'], ['business', 'Business'], ['market', 'Market'], ['sector', 'Sector'], ['governance', 'Governance']];
  return `<div class="heatmap">${labels.map(([key, label]) => {
    const score = categories?.[key];
    return `<div class="heat-cell ${heatCellClass(score)}"><div class="cat">${label}</div><div class="score">${score == null ? 'N/A' : `${score}/100`}</div></div>`;
  }).join('')}</div>`;
}

function kpi(label, value, note = '', valueClass = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value ${valueClass}">${value}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
}

function section(num, title, bodyHtml) {
  return `<details class="section" open id="sec-${num}"><summary><span class="num">${num}</span>${escape(title)}</summary><div class="section-body">${bodyHtml}</div></details>`;
}

// ---------------------------------------------------------------- Masthead
function renderMasthead(report) {
  const c = report.cover;
  const generated = c.generatedAt ? new Date(c.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';
  return `<div class="masthead">
    <div>
      <div class="brand">Institutional Equity Research</div>
      <h1>${escape(c.name)} <span class="small">(${escape(c.symbol)})</span></h1>
      <div class="sub">${escape(c.sector || 'N/A')} &middot; ${escape(c.industry || 'N/A')} &middot; ${escape(c.exchange || c.market || 'N/A')}</div>
    </div>
    <div class="meta">
      <div>${ratingTag(c.signal)}</div>
      <div class="cmp">${money(c.price, c.currency)}</div>
      <div>Watchlist: ${escape(c.watchlistName)}</div>
      <div>Report generated ${escape(generated)}</div>
    </div>
  </div>`;
}

// ------------------------------------------------------------ 1. Exec summary
function renderExecutiveSummary(x) {
  return `
    <div class="kpi-grid">
      ${kpi('Recommendation', ratingTag(x.rating))}
      ${kpi('Confidence', escape(x.confidence || 'N/A'))}
      ${kpi('Investment horizon', escape(x.investmentHorizon) + ' ' + dataTag('investmentHorizon'))}
      ${kpi('Current price', money(x.currentPrice, x.currency))}
      ${kpi('Fair value', money(x.fairValue, x.currency), dataTag('dcfFairValue'))}
      ${kpi('Target price (12M)', money(x.targetPrice, x.currency), dataTag('fairValue'))}
      ${kpi('Upside to target', pct(x.upsideToTargetPct), '', x.upsideToTargetPct >= 0 ? 'pos' : 'neg')}
      ${kpi('Upside to fair value', pct(x.upsideToFairValuePct), '', x.upsideToFairValuePct >= 0 ? 'pos' : 'neg')}
    </div>
    <div class="card"><h4>Overall investment view</h4><p>${escape(x.overallView)}</p></div>`;
}

// ------------------------------------------------------------ 2. Thesis
function renderThesis(t) {
  const dupont = t.businessQuality?.dupont, roceDecomp = t.businessQuality?.roceDecomposition, eq = t.businessQuality?.earningsQuality;
  const g = t.growthDrivers, sectorTags = t.competitivePosition?.sectorTags;
  return `
    <div class="two-col">
      <div class="card"><h4>Business quality</h4>
        <p>Business-quality factor score: <b>${t.businessQuality?.score ?? 'N/A'}/100</b> ${dataTag('compositeScore')}</p>
        <p class="small">ROE (DuPont): ${fmt(dupont?.dupontRoePct)}% vs. reported ${fmt(dupont?.reportedRoePct)}% &middot; Net margin ${fmt(dupont?.netMarginPct)}% &middot; Asset turnover ${fmt(dupont?.assetTurnover)}x &middot; Equity multiplier ${fmt(dupont?.equityMultiplier)}x</p>
        <p class="small">ROCE ${fmt(roceDecomp?.rocePct)}% &middot; Earnings quality score ${eq?.score ?? 'N/A'}/100 ${dataTag('financialRisk')}</p>
      </div>
      <div class="card"><h4>Growth drivers</h4>
        <p class="small">Revenue CAGR 3Y/5Y: ${pct(g?.revenueCagr3y)} / ${pct(g?.revenueCagr5y)}</p>
        <p class="small">EPS CAGR 3Y/5Y: ${pct(g?.epsCagr3y)} / ${pct(g?.epsCagr5y)}</p>
        <p class="small">Profit CAGR 3Y/5Y: ${pct(g?.profitCagr3y)} / ${pct(g?.profitCagr5y)}</p>
      </div>
    </div>
    <div class="two-col">
      <div class="card"><h4>Competitive position</h4>
        <p class="small">Sector rank ${t.competitivePosition?.sectorRank ?? 'N/A'} of ${t.competitivePosition?.sectorPeerCount ?? 'N/A'} &middot; Multi-factor peer rank ${t.competitivePosition?.multiFactorPeerRank ?? 'N/A'} ${dataTag('sectorRank')}</p>
        <p class="small">Sector risk tags &mdash; Regulatory ${sectorTags?.regulatory ?? 'N/A'}, Competitive ${sectorTags?.competitive ?? 'N/A'}, Tech disruption ${sectorTags?.techDisruption ?? 'N/A'} ${dataTag('sectorRisk')}</p>
      </div>
      <div class="card"><h4>Valuation opportunity</h4>
        <p class="small">Margin of safety: ${pct(t.valuationOpportunity?.marginOfSafetyPct)} ${dataTag('fairValue')}</p>
        <p class="small">Premium/discount vs. sector: ${pct(t.valuationOpportunity?.premiumDiscountScore)} &middot; Relative attractiveness ${t.valuationOpportunity?.relativeAttractivenessScore ?? 'N/A'}/100 ${dataTag('relativeAttractivenessScore')}</p>
      </div>
    </div>
    <div class="two-col">
      <div class="card"><h4>Why own</h4>${t.whyOwn?.length ? `<ul class="bullets">${t.whyOwn.map(b => `<li>${escape(b)}</li>`).join('')}</ul>` : '<p class="small">No bucket currently scores strongly enough to be a standout reason to own.</p>'}</div>
      <div class="card"><h4>Why avoid</h4>${t.whyAvoid?.length ? `<ul class="bullets">${t.whyAvoid.map(b => `<li>${escape(b)}</li>`).join('')}</ul>` : '<p class="small">No bucket currently scores weakly enough to be a standout reason to avoid.</p>'}</div>
    </div>
    <p class="small">${dataTag('whyOwnAvoid')}</p>`;
}

// ------------------------------------------------------------ 3. Metrics dashboard
function renderMetricsDashboard(m) {
  const trendCell = (indicatorKey) => { const v = m.indicators[indicatorKey]; return v && v !== 'N/A' ? `<span class="${directionClass(v)}">${escape(v)}</span>` : '<span class="muted">N/A</span>'; };
  const row = (label, value, indicatorKey, tagKey) => `<tr><td>${label} ${tagKey ? dataTag(tagKey) : ''}</td><td class="num">${value}</td><td>${indicatorKey ? trendCell(indicatorKey) : '&mdash;'}</td></tr>`;
  return `
    <div class="kpi-grid three">
      ${kpi('Sector / Industry', `${escape(m.sector || 'N/A')}`, escape(m.industry || 'N/A'))}
      ${kpi('CMP', money(m.cmp, m.currency))}
      ${kpi('Market cap', m.marketCap == null ? 'N/A' : `${compact(m.marketCap)} ${escape(m.marketCapUnit || '')}`)}
    </div>
    <table><colgroup><col><col style="width:110px"><col style="width:130px"></colgroup>
      <thead><tr><th>Metric</th><th class="num">Value</th><th>Trend</th></tr></thead>
      <tbody>
        ${row('P/E', fmt(m.pe), null, 'pe')}
        ${row('P/B', fmt(m.pb), null, 'pb')}
        ${row('EV/EBITDA', 'N/A &mdash; not available', null, 'evEbitdaPercentile')}
        ${row('ROE', pct(m.roe), null, 'roe')}
        ${row('ROCE', pct(m.roce), 'roce', 'roce')}
        ${row('Revenue growth (3Y)', pct(m.revenueGrowth3y), 'revenue')}
        ${row('EPS growth (3Y)', pct(m.epsGrowth3y), 'profit')}
        ${row('Debt / equity', fmt(m.debtToEquity) + '%', 'leverage')}
        ${row('Dividend yield', pct(m.dividendYield), null)}
        ${row('Promoter holding trend', '&mdash;', 'promoterHolding')}
        ${row('Overall risk trend', '&mdash;', 'overallRisk', 'riskTrend')}
      </tbody>
    </table>`;
}

// ------------------------------------------------------------ 4. Valuation analysis
function renderValuation(v, currency) {
  if (!v.primaryModelSource && v.reasonUnavailable) {
    return `<p class="small">Primary valuation model unavailable: ${escape(v.reasonUnavailable)}</p>
      ${v.fairValue != null ? `<p>In-house P/E-P/B reversion Fair Value: ${money(v.fairValue, currency)} &middot; Target Price: ${money(v.targetPrice, currency)} ${dataTag('fairValue')}</p>` : ''}`;
  }
  const modelLabel = v.primaryModelSource === 'financialValuation' ? 'Justified Price-to-Book model (financial sector)' : 'Discounted Cash Flow model';
  const sensitivityRows = (v.sensitivity || []).map(row => `<tr><td class="num">${fmt(row.waccPct)}%</td>${row.row.map(cell => `<td class="num">${money(cell.fairValue, currency)}</td>`).join('')}</tr>`).join('');
  const sensitivityHeader = v.sensitivity?.[0]?.row?.map(cell => `<th class="num">${fmt(cell.terminalGrowthPct)}%</th>`).join('') || '';
  const band = v.historicalValuationBand;
  return `
    <p class="small">Primary model: <b>${escape(modelLabel)}</b> ${dataTag(v.primaryModelSource === 'financialValuation' ? 'financialSectorValuation' : 'dcfFairValue')}</p>
    <div class="chart-wrap"><div class="chart-title">Bear / Base / Bull fair value vs. CMP</div>${valuationBand({ bear: v.bear, base: v.base, bull: v.bull, cmp: v.currentPrice, currency })}</div>
    <div class="kpi-grid three">
      ${kpi('Bear case', money(v.bear, currency))}
      ${kpi('Base case (Fair value)', money(v.base, currency))}
      ${kpi('Bull case', money(v.bull, currency))}
    </div>
    <div class="two-col">
      <div class="card"><h4>Historical valuation</h4>
        <p class="small">P/E historical percentile: ${v.peHistoricalPercentile ?? 'N/A'} ${dataTag('peHistoricalPercentile')}</p>
        <p class="small">P/B historical percentile: ${v.pbHistoricalPercentile ?? 'N/A'} ${dataTag('pbHistoricalPercentile')}</p>
        ${band ? `<p class="small">Own historical P/E range: ${fmt(band.min)} &ndash; ${fmt(band.max)} (median ${fmt(band.median)}), current ${fmt(band.currentPe)} ${dataTag('historicalValuationBand')}</p>` : '<p class="small">Historical P/E band not available (insufficient reconstructed history).</p>'}
      </div>
      <div class="card"><h4>Sector positioning</h4>
        <p class="small">Sector premium/discount (P/E): ${fmt(v.sectorPremiumDiscountPe)} ${dataTag('sectorPremiumDiscount')}</p>
        <p class="small">Premium/discount score: ${pct(v.premiumDiscountScore)} ${dataTag('relativeValuationScore')}</p>
        <p class="small">Margin of safety: ${pct(v.marginOfSafetyPct)}</p>
        <p class="small">Reverse-DCF implied growth: ${v.reverseImpliedGrowthPct != null ? pct(v.reverseImpliedGrowthPct) : 'N/A'} ${dataTag('reverseDcf')}</p>
      </div>
    </div>
    ${v.sensitivity ? `<div class="card"><h4>Sensitivity analysis &mdash; WACC &times; terminal growth ${dataTag('dcfSensitivity')}</h4>
      <table><thead><tr><th>WACC \\ Terminal g</th>${sensitivityHeader}</tr></thead><tbody>${sensitivityRows}</tbody></table></div>` : ''}
    <p class="small">${escape(v.methodology || '')}</p>`;
}

// ------------------------------------------------------------ 5. Financial quality
function renderFinancialQuality(f) {
  return `
    <div class="two-col">
      ${chart('Revenue trend (Rs Cr, FY)', f.revenueTrend)}
      ${chart('Net profit trend (Rs Cr, FY)', f.profitTrend)}
    </div>
    <div class="two-col">
      ${chart('Operating margin trend (%, FY)', f.marginTrend?.operatingMargin, { suffix: '%' })}
      ${chart('Net margin trend (%, FY)', f.marginTrend?.netMargin, { suffix: '%' })}
    </div>
    <div class="two-col">
      <div class="card"><h4>Cash flow quality ${dataTag('financialRisk')}</h4>
        <p class="small">Accrual ratio: ${fmt(f.cashFlowQuality?.accrualRatio, 3)} &middot; CFO/Operating-profit consistency: ${fmt(f.cashFlowQuality?.cfoToOpConsistency, 2)}</p>
        <p class="small">Earnings quality score: ${f.cashFlowQuality?.score ?? 'N/A'}/100</p>
      </div>
      <div class="card"><h4>Balance sheet quality</h4>
        <p class="small">Debt/equity: ${fmt(f.balanceSheetQuality?.debtToEquity)}% (${escape(f.balanceSheetQuality?.capitalStructure || 'N/A')})</p>
        <p class="small">Interest coverage: ${fmt(f.balanceSheetQuality?.interestCoverage)}x</p>
        <p class="small">Working capital efficiency: ${f.balanceSheetQuality?.workingCapital?.cashConversionCycle != null ? `${fmt(f.balanceSheetQuality.workingCapital.cashConversionCycle)} days cash conversion cycle` : 'N/A'}</p>
      </div>
    </div>
    <div class="card"><h4>Capital allocation quality ${dataTag('governanceRisk')}</h4>
      <p class="small">Capital allocation risk: ${f.capitalAllocationQuality?.capitalAllocationRisk ?? 'N/A'}/100 (higher = more concern)</p>
      <p class="small">Margin stability (std. dev. of OPM%): ${fmt(f.marginStability)}</p>
    </div>`;
}

// ------------------------------------------------------------ 6. Technical outlook
function renderTechnical(t, priceSeries) {
  const s = t.scores || {}, adv = t.advancedScores || {};
  return `
    ${chart('Price trend (weekly close)', priceSeries)}
    <div class="kpi-grid five">
      ${kpi('Trend', escape(t.trend || 'N/A'))}
      ${kpi('Momentum', escape(t.momentum || 'N/A'))}
      ${kpi('Volume trend', escape(t.volumeTrend || 'N/A'))}
      ${kpi('Relative strength', pct(t.relativeStrengthPct), t.relativeStrengthPercentile != null ? `Percentile ${t.relativeStrengthPercentile}` : '')}
      ${kpi('Technical score', t.technicalScore != null ? `${t.technicalScore}/100` : 'N/A', dataTag('technicalScores'))}
    </div>
    <div class="two-col">
      <div class="card"><h4>Support / resistance</h4>
        <p class="small">Support: ${fmt(t.support)} &middot; Resistance: ${fmt(t.resistance)} ${dataTag('supportResistance')}</p>
        <p class="small">Regime: ${escape(t.regime || 'N/A')} ${dataTag('technicalRegime')}</p>
      </div>
      <div class="card"><h4>Signal confidence</h4>
        <p class="small">${escape(t.signalConfidence || 'N/A')} ${dataTag('technicalSignalConfidence')}</p>
        <p class="small">Trend strength ${s.trendStrengthScore ?? 'N/A'}/100 &middot; Breakout probability ${s.breakoutProbability ?? 'N/A'}/100 &middot; Volatility-adjusted momentum ${adv.volatilityAdjustedMomentum ?? 'N/A'}/100</p>
      </div>
    </div>`;
}

// ------------------------------------------------------------ 7. Risk analysis
function renderRisk(r) {
  return `
    ${heatmap(r.categories)}
    <div class="kpi-grid three">
      ${kpi('Composite risk score', r.compositeRiskScore != null ? `${r.compositeRiskScore}/100` : 'N/A', dataTag('compositeRiskScore'), scoreCellClass(r.compositeRiskScore, true))}
      ${kpi('Risk trend', escape(r.riskTrend || 'N/A'), dataTag('riskTrend'))}
      ${kpi('Interest coverage', r.detail?.financial?.interestCoverage != null ? `${fmt(r.detail.financial.interestCoverage)}x` : 'N/A')}
    </div>
    <p class="small">Financial: debt-service risk ${r.detail?.financial?.debtServiceRisk ?? 'N/A'}/100, liquidity risk ${r.detail?.financial?.liquidityRisk ?? 'N/A'}/100 ${dataTag('financialRisk')}</p>
    <p class="small">Market: beta ${fmt(r.detail?.market?.beta)}, volatility ${fmt(r.detail?.market?.volatilityPct)}%, max drawdown ${fmt(r.detail?.market?.maxDrawdownPct)}% ${dataTag('marketRisk')}</p>
    <p class="small">Sector risk tags: Regulatory ${r.detail?.sector?.regulatory ?? 'N/A'}, Commodity ${r.detail?.sector?.commodity ?? 'N/A'}, Competitive ${r.detail?.sector?.competitive ?? 'N/A'}, Tech disruption ${r.detail?.sector?.techDisruption ?? 'N/A'} ${dataTag('sectorRisk')}</p>
    <p class="small">Governance: promoter-change risk ${r.detail?.governance?.promoterChangeRisk ?? 'N/A'}/100, capital-allocation risk ${r.detail?.governance?.capitalAllocationRisk ?? 'N/A'}/100 ${dataTag('governanceRisk')}</p>`;
}

// ------------------------------------------------------------ 8. Peer comparison
function renderPeers(p) {
  if (!p) return '<p class="small">No same-sector peers in this watchlist to compare against.</p>';
  const rows = p.comparison.map(row => `<tr><td>${escape(row.label)}</td><td class="num">${fmt(row.value)}</td><td class="num">${fmt(row.sectorMedian)}</td><td class="num">${fmt(row.sectorLeader)}</td><td class="num">${row.historicalAverage != null ? fmt(row.historicalAverage) : 'N/A'}</td><td class="num">${fmt(row.watchlistAverage)}</td></tr>`).join('');
  return `
    <div class="kpi-grid three">
      ${kpi('Sector rank', `${p.sectorRank ?? 'N/A'} / ${p.sectorPeerCount ?? 'N/A'}`, dataTag('sectorRank'))}
      ${kpi('Multi-factor peer rank', `${p.multiFactorPeerRank ?? 'N/A'} (score ${p.multiFactorPeerScore ?? 'N/A'})`, dataTag('multiFactorPeerScore'))}
      ${kpi('Relative attractiveness', p.relativeAttractivenessScore != null ? `${p.relativeAttractivenessScore}/100` : 'N/A', dataTag('relativeAttractivenessScore'))}
    </div>
    <table><thead><tr><th>Metric</th><th class="num">This stock</th><th class="num">Sector median</th><th class="num">Sector leader</th><th class="num">Historical avg</th><th class="num">Watchlist avg</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">Peer universe is this watchlist's own same-sector companies &mdash; there is no market-wide sector database in this app ${dataTag('sectorRank')}</p>`;
}

// ------------------------------------------------------------ 9. Catalysts
const IMPACT_CLASS = { High: 'neg', Medium: 'amber-text', Low: '' };
function renderCatalysts(items) {
  if (!items?.length) return '<p class="small">No recent catalysts found for this company.</p>';
  const rows = items.map(n => `<tr>
      <td>${n.url ? `<a href="${escape(n.url)}" target="_blank" rel="noopener">${escape(n.title)}</a>` : escape(n.title)}</td>
      <td>${escape(n.catalystType || 'General')}</td>
      <td>${escape(n.expectedTimeline || 'Unclassified')}</td>
      <td class="${IMPACT_CLASS[n.impact] || ''}">${escape(n.impact || 'N/A')}</td>
      <td>${escape(n.source || 'N/A')}</td>
      <td>${n.date ? escape(new Date(n.date).toLocaleDateString('en-IN')) : 'N/A'}</td>
    </tr>`).join('');
  return `<table><thead><tr><th>Catalyst</th><th>Type</th><th>Timeline</th><th>Impact</th><th>Source</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">${dataTag('technicalCatalyst')} News catalysts are keyword-classified headlines, not editorial ratings or confirmed event dates.</p>`;
}

// ------------------------------------------------------------ 10. Final verdict
function renderVerdict(v, currency) {
  return `
    <div class="kpi-grid">
      ${kpi('Recommendation', ratingTag(v.rating))}
      ${kpi('Confidence', escape(v.confidence || 'N/A'))}
      ${kpi('Ideal entry zone', v.idealEntryZone ? `${money(v.idealEntryZone.low, currency)} &ndash; ${money(v.idealEntryZone.high, currency)}` : 'N/A', dataTag('idealEntryZone'))}
      ${kpi('Fair value', money(v.fairValue, currency))}
      ${kpi('Target price (12M)', money(v.targetPrice, currency))}
    </div>
    <div class="card"><h4>Risk-reward summary ${dataTag('riskRewardSummary')}</h4>
      <p class="small">Upside to target: ${pct(v.riskReward.upsideToTargetPct)} &middot; Downside to bear case: ${pct(v.riskReward.downsideToBearPct)} &middot; Risk-reward ratio: ${v.riskReward.ratio != null ? `${fmt(v.riskReward.ratio)}x` : 'N/A'}</p>
    </div>`;
}

function renderDataLimitations(list) {
  return `<div class="disclaimer-box"><b>Data policy &amp; limitations.</b> Values are retrieved at fetch time. This report is research support, not investment advice &mdash; verify prices, filings and corporate actions before making decisions.
    <ul>${(list || []).slice(0, 6).map(item => `<li>${escape(item)}</li>`).join('')}</ul></div>`;
}

function renderReport(report) {
  metricMeta = report.metricMeta || {};
  document.title = `${report.cover.name} — Institutional Research Report`;
  $('#toolbar-name').textContent = `${report.cover.name} (${report.cover.symbol}) — Research Report`;
  const currency = report.cover.currency;

  const html = [
    renderMasthead(report),
    section(1, 'Executive summary', renderExecutiveSummary(report.executiveSummary)),
    section(2, 'Investment thesis', renderThesis(report.thesis)),
    section(3, 'Metrics dashboard', renderMetricsDashboard(report.metricsDashboard)),
    section(4, 'Valuation analysis', renderValuation(report.valuationAnalysis, currency)),
    section(5, 'Financial quality', renderFinancialQuality(report.financialQuality)),
    section(6, 'Technical outlook', renderTechnical(report.technicalOutlook, report.charts.price)),
    section(7, 'Risk analysis', renderRisk(report.riskAnalysis)),
    section(8, 'Peer comparison', renderPeers(report.peerComparison)),
    section(9, 'Catalysts', renderCatalysts(report.catalysts)),
    section(10, 'Final recommendation', renderVerdict(report.finalVerdict, currency)),
    renderDataLimitations(report.dataLimitations),
    `<div class="report-footer"><span>Generated ${escape(new Date(report.generatedAt).toLocaleString('en-IN'))}</span><span>${escape(report.watchlistName)} watchlist &middot; ${escape(report.cover.symbol)}</span></div>`
  ].join('');

  $('#report-root').innerHTML = html;
}

function renderError(message) {
  $('#report-root').innerHTML = `<div class="no-data" style="padding:40px 0;text-align:center">${escape(message)}</div>`;
}

// ---------------------------------------------------------------- Bootstrap
async function start() {
  const params = new URLSearchParams(location.search);
  const wl = params.get('wl'), symbol = params.get('symbol');
  if (!wl || !symbol) { renderError('Missing watchlist or company in the URL.'); return; }
  $('#back-link').href = `index.html?wl=${encodeURIComponent(wl)}`;
  try {
    const res = await fetch(`/api/watchlists/${encodeURIComponent(wl)}/report/${encodeURIComponent(symbol)}`);
    const report = await res.json();
    if (!res.ok || report.error) { renderError(report.error || 'Failed to generate report.'); return; }
    renderReport(report);
  } catch (error) {
    renderError(`Failed to load report: ${error.message}`);
  }
}
start();

// -- Toolbar actions --------------------------------------------------------
// A collapsed <details> must still print in full. CSS alone is unreliable
// here: current Chromium renders closed <details> content through an
// internal ::details-content box (not a plain display:none on a child),
// which a same-specificity author override can't reliably reach across
// browser versions. beforeprint/afterprint is the standard, documented
// pattern for this exact case (MDN/web.dev) -- it fires for the toolbar's
// Print button *and* the browser's own Ctrl+P/File>Print, so "no manual
// adjustment before printing" holds regardless of how printing was
// triggered. Still the same HTML/attribute (`open`), not a second template.
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

// "Download HTML": the live document's own <style> is already inline (see
// report.html), so the already-rendered DOM *is* a complete, self-contained
// document -- clone it, drop the toolbar and the script tag (a static export
// has nothing left to run except the Print button, restored as a tiny inert
// inline script), and serialize. Zero extra network requests, zero external
// dependencies in the exported file.
$('#download-btn').addEventListener('click', () => {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelector('.report-toolbar')?.remove();
  clone.querySelector('script[src="report.js"]')?.remove();
  const inlineScript = clone.ownerDocument.createElement('script');
  inlineScript.textContent = 'document.title=document.title;'; // static export: no interactivity needed beyond the browser's own Ctrl+P
  clone.querySelector('body').appendChild(inlineScript);
  const html = `<!doctype html>\n${clone.outerHTML}`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const symbol = new URLSearchParams(location.search).get('symbol') || 'report';
  a.href = url; a.download = `${symbol.replace(/[^A-Za-z0-9.-]/g, '_')}-research-report-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

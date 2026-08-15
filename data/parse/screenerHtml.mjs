// Screener.in renders every statement as server-side HTML tables inside
// <section id="..."> blocks on the single company page (confirmed live:
// profit-loss, balance-sheet, cash-flow, ratios, quarters, shareholding are
// all present in the initial response, no extra requests needed). This
// module extracts them by real table structure (row label -> row), not by
// free-text regex, since the row labels are given directly in <td class="text">.

export const htmlText = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#x20;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
export const extractNumber = (text, label) => {
  const match = text.match(new RegExp(`${label}\\s*(?:₹|Rs\\.?|INR)?\\s*([\\d,.]+)`, 'i'));
  return match ? Number(match[1].replace(/,/g, '')) : null;
};
export const extractPercent = (text, label) => {
  const match = text.match(new RegExp(`${label}\\s*([\\d,.]+)\\s*%`, 'i'));
  return match ? Number(match[1].replace(/,/g, '')) : null;
};

// Isolates a <section id="name">...</section> block. Screener sections are
// siblings, never nested, so "up to the next <section id=" is a safe bound.
export function extractSection(html, id) {
  const start = html.indexOf(`section id="${id}"`);
  if (start < 0) return null;
  const sectionStart = html.lastIndexOf('<', start);
  const nextStart = html.indexOf('<section id=', start + id.length);
  return html.slice(sectionStart, nextStart > 0 ? nextStart : undefined);
}

// Isolates a <div id="name">...</div> block by matching balanced div depth
// (used to separate shareholding's quarterly-shp / yearly-shp sub-tables,
// which otherwise both look like generic data-tables to a naive scan).
export function extractDivById(html, id) {
  // Anchored on `<div id="..."` (not a bare `id="..."` substring search) so
  // this can't match an unrelated attribute that happens to contain the same
  // id string, e.g. a tab button's `data-tab-id="quarterly-shp"`.
  const openIdx = html.search(new RegExp(`<div[^>]*\\bid="${id}"`));
  if (openIdx < 0) return null;
  let depth = 0, i = openIdx;
  const tagRe = /<div\b|<\/div>/gi;
  tagRe.lastIndex = openIdx;
  let match;
  while ((match = tagRe.exec(html))) {
    if (match[0].toLowerCase() === '<div') depth++; else depth--;
    if (depth === 0) { i = match.index + match[0].length; break; }
  }
  return html.slice(openIdx, i);
}

export const decodeEntities = (text) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
const stripTags = (fragment) => decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const parseCell = (fragment) => {
  const text = stripTags(fragment).replace(/[₹,%]/g, '').trim();
  if (!text || text === '-' || /^\+?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

// Extracts every <table class="data-table"> found in `html` (in document
// order) as { periods, rows }. `labelMap` maps a row's *classification key*
// (preferred — see below) or its stripped visible label to a normalized
// field name; rows that match nothing in labelMap are skipped rather than
// guessed at.
//
// Screener's shareholding rows carry a reliable machine-readable key via
// `plausible-event-classification=<key>` on the row's button (e.g.
// "promoters", "foreign_institutions") — preferred over text-label matching
// when present, since visible labels are wrapped in "<label>&nbsp;<+ icon>"
// markup that's easy to mis-normalize. Statement tables (P&L/BS/CF/ratios)
// have no such attribute and fall back to the stripped text label.
export function extractAllTables(html, labelMap) {
  const tables = [];
  const tableRe = /<table[^>]*class="[^"]*data-table[^"]*"[\s\S]*?<\/table>/g;
  let tableMatch;
  while ((tableMatch = tableRe.exec(html))) {
    const tableHtml = tableMatch[0];
    const theadMatch = tableHtml.match(/<thead>[\s\S]*?<\/thead>/);
    const periods = theadMatch ? [...theadMatch[0].matchAll(/<th(?:(?!class="text")[^>])*>\s*([^<]*?)\s*<\/th>/g)].map(m => m[1].trim()).filter(Boolean) : [];
    const rows = {};
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch;
    const bodyHtml = tableHtml.replace(theadMatch ? theadMatch[0] : '', '');
    while ((rowMatch = rowRe.exec(bodyHtml))) {
      const rowHtml = rowMatch[1];
      const classificationMatch = rowHtml.match(/plausible-event-classification=(\w+)/);
      const firstCellMatch = rowHtml.match(/<t[dh][^>]*class="text"[^>]*>([\s\S]*?)<\/t[dh]>/);
      if (!firstCellMatch) continue;
      const labelKey = classificationMatch ? classificationMatch[1] : stripTags(firstCellMatch[0]).replace(/\+\s*$/, '').trim();
      const field = labelMap[labelKey];
      if (!field) continue;
      const cellsHtml = rowHtml.slice(rowHtml.indexOf(firstCellMatch[0]) + firstCellMatch[0].length);
      const values = [...cellsHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => parseCell(m[1]));
      rows[field] = { periods, values };
    }
    // A table with row labels but zero period columns (Screener renders this
    // shell when a company has no data for the requested statement basis --
    // e.g. no consolidated financials) carries no real data; treat it the
    // same as "table not found" rather than a table full of empty series.
    if (Object.keys(rows).length && periods.length) tables.push({ periods, rows });
  }
  return tables;
}

export function extractTable(html, labelMap) {
  return extractAllTables(html, labelMap)[0] ?? null;
}

// Reshapes { periods, rows: { field: { periods, values } } } into the
// normalized provider shape's { periods, rows: { field: value } } per period
// index — i.e. transposes row-series-per-field into one series shared across
// fields, keeping only the max common period set (Screener rows within one
// table always share the same periods, so this is a straight passthrough,
// but the extra shape check guards against a future markup change silently
// misaligning columns).
export function toPeriodSeries(table) {
  if (!table) return null;
  const { periods } = table;
  const rows = {};
  for (const [field, series] of Object.entries(table.rows)) {
    rows[field] = series.periods.length === periods.length ? series.values : periods.map((_, i) => series.values[series.periods.indexOf(periods[i])] ?? null);
  }
  return { periods, rows };
}

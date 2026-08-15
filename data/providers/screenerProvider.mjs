import { request } from '../util.mjs';
import { htmlText, extractNumber, extractPercent, extractSection, extractDivById, extractTable, toPeriodSeries, decodeEntities } from '../parse/screenerHtml.mjs';
import { PROFIT_LOSS_LABELS, QUARTERLY_LABELS, BALANCE_SHEET_LABELS, CASH_FLOW_LABELS, RATIOS_LABELS, SHAREHOLDING_LABELS } from '../parse/screenerLabels.mjs';

const screenerAliases = { PGCIL: 'POWERGRID' };

function parseClassification(html) {
  const section = extractSection(html, 'peers');
  if (!section) return null;
  const crumbs = [...section.matchAll(/title="(Broad Sector|Sector|Broad Industry|Industry)"[^>]*>([^<]+)</g)].reduce((acc, m) => {
    acc[{ 'Broad Sector': 'broadSector', Sector: 'sector', 'Broad Industry': 'broadIndustry', Industry: 'industry' }[m[1]]] = decodeEntities(m[2]).trim();
    return acc;
  }, {});
  return Object.keys(crumbs).length ? crumbs : null;
}

function parseStatement(html, sectionId, labelMap) {
  const section = extractSection(html, sectionId);
  if (!section) return null;
  return toPeriodSeries(extractTable(section, labelMap));
}

function parseShareholding(html) {
  const section = extractSection(html, 'shareholding');
  if (!section) return null;
  const quarterlyDiv = extractDivById(section, 'quarterly-shp');
  const yearlyDiv = extractDivById(section, 'yearly-shp');
  return {
    quarterly: quarterlyDiv ? toPeriodSeries(extractTable(quarterlyDiv, SHAREHOLDING_LABELS)) : null,
    annual: yearlyDiv ? toPeriodSeries(extractTable(yearlyDiv, SHAREHOLDING_LABELS)) : null
  };
}

function parsePage(html, statementBasis) {
  const text = htmlText(html);
  const snapshot = {
    marketCap: extractNumber(text, 'Market Cap'), pe: extractNumber(text, 'Stock P/E'), bookValue: extractNumber(text, 'Book Value'),
    dividendYield: extractPercent(text, 'Dividend Yield'), roce: extractPercent(text, 'ROCE'), roe: extractPercent(text, 'ROE'),
    faceValue: extractNumber(text, 'Face Value')
  };
  const annual = {
    profitLoss: parseStatement(html, 'profit-loss', PROFIT_LOSS_LABELS),
    balanceSheet: parseStatement(html, 'balance-sheet', BALANCE_SHEET_LABELS),
    cashFlow: parseStatement(html, 'cash-flow', CASH_FLOW_LABELS),
    ratios: parseStatement(html, 'ratios', RATIOS_LABELS)
  };
  const hasAnyAnnual = Object.values(annual).some(Boolean);
  const quarterlySection = extractSection(html, 'quarters');
  const quarterly = quarterlySection ? { profitLoss: toPeriodSeries(extractTable(quarterlySection, QUARTERLY_LABELS)) } : null;
  const shareholding = parseShareholding(html);
  const hasAnyData = snapshot.marketCap != null || hasAnyAnnual;

  return hasAnyData ? {
    source: 'Screener.in',
    asOf: new Date().toISOString(),
    currency: 'INR',
    unit: 'Cr',
    statementBasis,
    snapshot,
    classification: parseClassification(html),
    annual: hasAnyAnnual ? annual : null,
    quarterly: quarterly?.profitLoss ? quarterly : null,
    shareholding: shareholding?.quarterly || shareholding?.annual ? shareholding : null,
    dataCompleteness: {
      profitLoss: !!annual.profitLoss, balanceSheet: !!annual.balanceSheet, cashFlow: !!annual.cashFlow,
      ratios: !!annual.ratios, quarterly: !!quarterly?.profitLoss,
      shareholding: !!(shareholding?.quarterly || shareholding?.annual),
      peers: false, segments: false
    }
  } : null;
}

// Some listed companies (typically smaller ones with no subsidiaries) have
// no consolidated financials. Screener still returns HTTP 200 for
// /consolidated/ in that case, but renders every figure as an empty shell
// (confirmed live against AVADHSUGAR.NS) rather than 404ing or redirecting
// -- so a blank consolidated parse falls back to the standalone page, the
// same source Screener's own UI points to via its "View Standalone" link.
async function scrapeCompanyPage(symbol) {
  const code = screenerAliases[symbol.replace(/\.NS$|\.BO$/, '')] || symbol.replace(/\.NS$|\.BO$/, '');
  const consolidatedHtml = await (await request(`https://www.screener.in/company/${encodeURIComponent(code)}/consolidated/`)).text();
  const consolidated = parsePage(consolidatedHtml, 'Consolidated');
  if (consolidated) return consolidated;

  const standaloneHtml = await (await request(`https://www.screener.in/company/${encodeURIComponent(code)}/`)).text();
  return parsePage(standaloneHtml, 'Standalone');
}

const unavailableShape = () => ({
  source: 'Unavailable', asOf: new Date().toISOString(), currency: null, unit: null,
  snapshot: {}, classification: null, annual: null, quarterly: null, shareholding: null,
  dataCompleteness: { profitLoss: false, balanceSheet: false, cashFlow: false, ratios: false, quarterly: false, shareholding: false, peers: false, segments: false }
});

export async function fetchFundamentals(symbol) {
  try { return (await scrapeCompanyPage(symbol)) ?? unavailableShape(); }
  catch { return unavailableShape(); }
}

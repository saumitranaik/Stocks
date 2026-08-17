import { request } from '../util.mjs';

// Keyword-based impact classifier. Google News RSS carries no editorial
// "importance" field, so this is a disclosed in-house heuristic over the
// headline text (same "Heuristic:" precedent used elsewhere in this
// codebase for risk/ownership scores), not a source-provided rating.
const HIGH_IMPACT = /\b(earnings|results?|profit|net loss|acqui(re|sition)|merger|merge[sd]?|stake sale|regulat(or|ion)|sebi|penalt(y|ies)|fraud|investigat|raid|guidance|buyback|delist|ipo|rating (up|down)grade|default|ban(ned)?)\b/i;
const MEDIUM_IMPACT = /\b(capacity|expansion|order win|contract|analyst|target price|capital allocation|dividend|stake (buy|purchase)|partnership|launch(es|ed)?|plant|jv|joint venture)\b/i;

function classifyImpact(title) {
  if (HIGH_IMPACT.test(title)) return 'High';
  if (MEDIUM_IMPACT.test(title)) return 'Medium';
  return 'Low';
}

// Same disclosed keyword-heuristic style as classifyImpact() above -- a
// catalyst "type" and coarse "expected timeline" bucket, not a confirmed
// event date (this app has no earnings-calendar data source; see
// dataLimitations). First matching pattern wins.
//
// Phase 5: aligned to the institutional research report's 7-category
// catalyst taxonomy (Earnings/Valuation/Industry/Regulatory/Technical/
// Management/Capital allocation) -- `Technical` is never produced here (it
// is synthesized separately in data/reporting/researchReport.mjs from the
// technical scorecard, not from news). Previously separate "M&A"/"Capital
// action" types merged into `Capital allocation` (both are capital-
// allocation decisions); "Expansion"/"Partnership" merged into `Industry`;
// "Analyst view" renamed to `Valuation`; `Management` is new.
// Every pattern's alternation is wrapped in a single (?:...) group with \b
// only on the outside -- `\bfirst|middle|last\b` (unwrapped) only anchors
// the first and last alternatives at a word boundary, leaving every middle
// alternative free to match as a raw substring anywhere (e.g. an unanchored
// "ipo" would false-match inside "IndiaIPO", a news source name). Applies
// equally to classifyImpact()'s HIGH_IMPACT/MEDIUM_IMPACT above, which are
// already correctly wrapped this way.
const CATALYST_TYPES = [
  { type: 'Earnings', timeline: 'Near-term', pattern: /\b(?:earnings|results?|quarter(?:ly)?|guidance)\b/i },
  { type: 'Regulatory', timeline: 'Near-term', pattern: /\b(?:regulat(?:or|ion)|sebi|penalt(?:y|ies)|fraud|investigat\w*|raid|banned)\b/i },
  { type: 'Management', timeline: 'Near-term', pattern: /\b(?:ceo|cfo|coo|managing director|chairman|promoter|founder|resign(?:ation|ed|s)?|appoint(?:s|ed|ment)?|succession|leadership change)\b/i },
  { type: 'Capital allocation', timeline: 'Near-term', pattern: /\b(?:buyback|dividend|ipo|delist|rating (?:up|down)grade|default|acqui(?:re|sition)|merger|merge[sd]?|stake sale|stake (?:buy|purchase))\b/i },
  { type: 'Industry', timeline: 'Medium-term', pattern: /\b(?:capacity|expansion|plant|jv|joint venture|order win|contract|launch(?:es|ed)?|partnership)\b/i },
  { type: 'Valuation', timeline: 'Near-term', pattern: /\b(?:analyst|target price)\b/i }
];
function classifyCatalyst(title) {
  const match = CATALYST_TYPES.find(({ pattern }) => pattern.test(title));
  return { catalystType: match?.type || 'General', expectedTimeline: match?.timeline || 'Unclassified' };
}

// Phase 6 News Intelligence upgrade: keyword-based sentiment direction
// (Positive/Negative/Neutral/Uncertain) -- same disclosed-regex-list
// convention as classifyImpact() above, not an NLP sentiment model. Titles
// matching both lists (a genuinely mixed signal, e.g. "beats profit but
// cuts guidance") read as Uncertain rather than an invented 5th bucket, to
// stay within the brief's own 4-value taxonomy.
const POSITIVE_SENTIMENT = /\b(?:beats?|surge[sd]?|jump(?:s|ed)?|ralli(?:es|ed)|record (?:profit|revenue|high)|upgrade[sd]?|wins?|bags?|strong (?:growth|results?|demand)|expands?|raises? guidance|outperform\w*|robust|profit (?:rise|rises|rose|jump|jumps|surge|surges)|approv(?:es|ed|al)|clears?)\b/i;
const NEGATIVE_SENTIMENT = /\b(?:misses?|falls?|fell|plunge[sd]?|slump[sd]?|slides?|downgrade[sd]?|loss(?:es)?|declin(?:es?|ed)|weak (?:growth|results?|demand)|profit (?:fall|falls|fell|drop|drops|plunge|plunges)|cuts? guidance|underperform\w*|warns?|penalt(?:y|ies)|fraud|default|ban(?:ned)?|raid|resign(?:ation|ed|s)?|delist)\b/i;
const UNCERTAIN_SENTIMENT = /\b(?:investigat\w*|probe[sd]?|review[sd]?|uncertain\w*|volatil\w*|mixed|cautio\w*|flags?)\b/i;
function classifySentiment(title) {
  const positive = POSITIVE_SENTIMENT.test(title), negative = NEGATIVE_SENTIMENT.test(title);
  if (positive && negative) return 'Uncertain';
  if (positive) return 'Positive';
  if (negative) return 'Negative';
  if (UNCERTAIN_SENTIMENT.test(title)) return 'Uncertain';
  return 'Neutral';
}

// Coarse catalystType -> investmentThesis() bucket mapping (see
// data/reporting/researchReport.mjs's investmentThesis(), same 5 buckets:
// businessQuality/growthDrivers/competitivePosition/valuationOpportunity/
// keyRisks) -- reuses the existing 7-category catalyst taxonomy rather than
// inventing a new per-headline classifier. A coarse many-to-one map, not a
// causal claim that this specific headline moved that specific bucket's
// score -- the per-company report's Thesis Tracking section (Phase 5)
// is what actually measures a thesis change, from run-over-run deltas.
const THESIS_DRIVER_MAP = {
  Earnings: 'growthDrivers', Regulatory: 'keyRisks', Management: 'businessQuality',
  'Capital allocation': 'valuationOpportunity', Industry: 'competitivePosition', Valuation: 'valuationOpportunity'
};
function affectedThesisDriver(catalystType) {
  return THESIS_DRIVER_MAP[catalystType] ?? null;
}

// Phase 5: a disclosed heuristic proxy for "how strong a signal is this
// catalyst" -- deliberately NOT a statistical probability. These are
// keyword-classified past headlines (see classifyImpact()'s own doc
// comment), not a confirmed forward-looking event calendar, so assigning a
// numeric % likelihood of a future outcome would misrepresent the data as
// more certain than it is. Instead this blends the already-computed impact
// tag with recency: a High-impact headline from the last week reads as a
// stronger current signal than the same headline three months old.
function classifySignalStrength(impact, pubDate) {
  const ageDays = pubDate ? (Date.now() - new Date(pubDate).getTime()) / 86400000 : null;
  const recent = Number.isFinite(ageDays) && ageDays <= 7;
  if (impact === 'High' && recent) return 'High';
  if (impact === 'High' || (impact === 'Medium' && recent)) return 'Medium';
  return 'Low';
}

// Google News RSS titles are usually "Headline - Publisher"; prefer the
// item's own <source> tag when present (more reliable than splitting text
// that may legitimately contain " - ").
function splitTitleSource(rawTitle, sourceTag) {
  const decoded = rawTitle.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  if (sourceTag) return { title: decoded, source: sourceTag.trim() };
  const parts = decoded.split(' - ');
  if (parts.length > 1) return { title: parts.slice(0, -1).join(' - ').trim(), source: parts.at(-1).trim() };
  return { title: decoded, source: 'Google News' };
}

const normalize = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function queryGoogleNews(query, market) {
  const country = market === 'India' ? { hl: 'en-IN', gl: 'IN' } : { hl: 'en-US', gl: 'US' };
  const xml = await (await request(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${country.hl}&gl=${country.gl}&ceid=${country.gl}:en`)).text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, block]) => {
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1];
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    const sourceTag = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1];
    if (!title || !link) return null;
    const { title: cleanTitle, source } = splitTitleSource(title, sourceTag);
    const impact = classifyImpact(cleanTitle);
    const catalyst = classifyCatalyst(cleanTitle);
    return {
      title: cleanTitle, url: link.trim(), date: pubDate || null, source, impact,
      signalStrength: classifySignalStrength(impact, pubDate || null),
      sentiment: classifySentiment(cleanTitle), ...catalyst,
      affectedThesisDriver: affectedThesisDriver(catalyst.catalystType)
    };
  }).filter(Boolean);
}

// Up to 5 recent, deduplicated headlines for one company. Prioritizes
// nothing beyond recency + the impact classifier above -- Google News RSS
// is already sorted by relevance/recency for the query, so "prioritize
// earnings/M&A/regulatory..." is realized by the impact tag surfaced to the
// UI (which can sort/filter on it) rather than a second, opaque re-ranking.
export async function fetchCompanyNews(company, market) {
  try {
    const items = await queryGoogleNews(`"${company.name}" stock`, market);
    const seen = new Set();
    const deduped = [];
    for (const item of items) {
      const key = normalize(item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= 5) break;
    }
    return deduped;
  } catch { return []; }
}

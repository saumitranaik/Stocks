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
const CATALYST_TYPES = [
  { type: 'Earnings', timeline: 'Near-term', pattern: /\b(earnings|results?|quarter(ly)?|guidance)\b/i },
  { type: 'M&A', timeline: 'Medium-term', pattern: /\bacqui(re|sition)|merger|merge[sd]?|stake sale|stake (buy|purchase)\b/i },
  { type: 'Regulatory', timeline: 'Near-term', pattern: /\bregulat(or|ion)|sebi|penalt(y|ies)|fraud|investigat|raid|ban(ned)?\b/i },
  { type: 'Capital action', timeline: 'Near-term', pattern: /\bbuyback|dividend|ipo|delist|rating (up|down)grade|default\b/i },
  { type: 'Expansion', timeline: 'Medium-term', pattern: /\bcapacity|expansion|plant|jv|joint venture|order win|contract|launch(es|ed)?\b/i },
  { type: 'Partnership', timeline: 'Medium-term', pattern: /\bpartnership\b/i },
  { type: 'Analyst view', timeline: 'Near-term', pattern: /\banalyst|target price\b/i }
];
function classifyCatalyst(title) {
  const match = CATALYST_TYPES.find(({ pattern }) => pattern.test(title));
  return { catalystType: match?.type || 'General', expectedTimeline: match?.timeline || 'Unclassified' };
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
    return { title: cleanTitle, url: link.trim(), date: pubDate || null, source, impact: classifyImpact(cleanTitle), ...classifyCatalyst(cleanTitle) };
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

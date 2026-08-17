// Portfolio Event Calendar: composes real, already-fetched dated items --
// today that's just company news (data/news/companyNews.mjs), each item
// already carrying a real published date and catalyst/impact classification
// -- sorted newest-first. Earnings dates, dividend ex-dates, buybacks, and
// regulatory/policy events have no data source in this app (Screener exposes
// only a trailing annual dividend payout %, not a dated schedule) and are
// never fabricated; the Dashboard's Earnings & Events sub-tab discloses this
// directly rather than rendering an invented date. No new fetch -- pure
// composition over each stock's already-fetched `news` array.
export function buildEventCalendar(stocks) {
  const events = [];
  for (const stock of stocks) {
    for (const item of stock.news || []) {
      events.push({
        symbol: stock.symbol, name: stock.name, date: item.date, title: item.title, url: item.url,
        catalystType: item.catalystType, impact: item.impact, signalStrength: item.signalStrength
      });
    }
  }
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events;
}

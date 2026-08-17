// Shared fixture builders matching the real shapes analytics modules consume:
// - { periods, rows } — screenerHtml.mjs's toPeriodSeries() output (series.mjs)
// - { date, close }[] — fetchPriceHistory()'s weekly point series (priceSeries.mjs)

export function buildSeries(periods, rows) {
  return { periods, rows };
}

// Weekly points 7 days apart, compounding a per-step return sequence (cycled
// if shorter than count-1) onto startPrice. Dates are plain ISO strings, the
// same shape yahooQuoteProvider.mjs produces.
export function buildWeeklyPoints(startDate, startPrice, returns, count) {
  const base = new Date(startDate).getTime();
  const points = [{ date: new Date(base).toISOString().slice(0, 10), close: startPrice }];
  let price = startPrice;
  for (let i = 1; i < count; i++) {
    price *= 1 + returns[(i - 1) % returns.length];
    points.push({ date: new Date(base + i * 7 * 86400000).toISOString().slice(0, 10), close: price });
  }
  return points;
}

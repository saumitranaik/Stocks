// Returns the exact same normalized shape as screenerProvider, with every
// field null — used for markets with no fundamentals source configured
// (US/Global in Phase 1). This is what lets analytics/scoring code branch on
// `fundamentals.annual == null` instead of on market.
export async function fetchFundamentals() {
  return {
    source: 'Not configured', asOf: new Date().toISOString(), currency: null, unit: null,
    snapshot: {}, classification: null, annual: null, quarterly: null, shareholding: null,
    dataCompleteness: { profitLoss: false, balanceSheet: false, cashFlow: false, ratios: false, quarterly: false, shareholding: false, peers: false, segments: false }
  };
}

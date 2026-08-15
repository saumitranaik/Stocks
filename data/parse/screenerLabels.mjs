// Row-label -> normalized-field maps, keyed by the label text as it appears
// after stripTags()+trailing-"+"-removal in screenerHtml.mjs (statement
// tables), or by the row's `plausible-event-classification` attribute
// (shareholding table — more robust than its wrapped "<label>&nbsp;<+icon>"
// text). Confirmed against a live Screener.in company page (RELIANCE,
// consolidated view); unmapped rows (sub-widgets, "Raw PDF" link column)
// are dropped by the extractor rather than guessed at.

export const PROFIT_LOSS_LABELS = {
  Sales: 'sales', Expenses: 'expenses', 'Operating Profit': 'operatingProfit', 'OPM %': 'opmPct',
  'Other Income': 'otherIncome', Interest: 'interest', Depreciation: 'depreciation',
  'Profit before tax': 'profitBeforeTax', 'Tax %': 'taxPct', 'Net Profit': 'netProfit',
  'EPS in Rs': 'epsInRs', 'Dividend Payout %': 'dividendPayoutPct'
};

// Quarterly view has no Dividend Payout % row; reuse the same map — its
// absence just means quarterly.rows.dividendPayoutPct is never populated.
export const QUARTERLY_LABELS = PROFIT_LOSS_LABELS;

export const BALANCE_SHEET_LABELS = {
  'Equity Capital': 'equityCapital', Reserves: 'reserves', Borrowings: 'borrowings',
  'Other Liabilities': 'otherLiabilities', 'Total Liabilities': 'totalLiabilities',
  'Fixed Assets': 'fixedAssets', CWIP: 'cwip', Investments: 'investments',
  'Other Assets': 'otherAssets', 'Total Assets': 'totalAssets'
};

export const CASH_FLOW_LABELS = {
  'Cash from Operating Activity': 'cfo', 'Cash from Investing Activity': 'cfi',
  'Cash from Financing Activity': 'cff', 'Net Cash Flow': 'netCashFlow',
  'Free Cash Flow': 'freeCashFlow', 'CFO/OP': 'cfoToOp'
};

export const RATIOS_LABELS = {
  'Debtor Days': 'debtorDays', 'Inventory Days': 'inventoryDays', 'Days Payable': 'payableDays',
  'Cash Conversion Cycle': 'cashConversionCycle', 'Working Capital Days': 'workingCapitalDays', 'ROCE %': 'rocePct'
};

// Keyed by plausible-event-classification, not visible text (see module doc).
export const SHAREHOLDING_LABELS = {
  promoters: 'promoters', foreign_institutions: 'fii', domestic_institutions: 'dii',
  government: 'government', public: 'public',
  'No. of Shareholders': 'shareholderCount'
};

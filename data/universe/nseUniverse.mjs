// Static, curated reference of well-known NSE-listed companies -- exists so
// the watchlist "Add a company" typeahead has a broad local universe to
// search (name/ticker/sector/industry/common abbreviations) without a
// network round trip on every keystroke. This is a search-discoverability
// aid only, NOT a source of truth: sector/industry/name here are best-
// effort labels for display and ranking, never persisted onto a watchlist
// company record (see store.mjs's addCompany -- real name/sector/industry
// are always resolved from the first live fetch, same "never guess"
// contract every other part of this app follows). `tier` is a coarse market-
// cap band (mega/large/mid) used only to break ranking ties, not displayed
// as fact. BSE tickers are intentionally omitted rather than guessed --
// none are reliably known offline; add them as they're verified.
//
// Coverage is Nifty 100-ish plus a handful of sector names already used
// elsewhere in this app (defence, power) -- not exhaustive. Extend this list
// over time rather than treating it as complete.

export const NSE_UNIVERSE = [
  // -- Banking & financial services --------------------------------------
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'mega' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'mega' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', sector: 'Financial Services', industry: 'Public Sector Bank', tier: 'mega', aliases: ['SBI'] },
  { symbol: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'mega' },
  { symbol: 'AXISBANK.NS', name: 'Axis Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'mega' },
  { symbol: 'INDUSINDBK.NS', name: 'IndusInd Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'large' },
  { symbol: 'BANKBARODA.NS', name: 'Bank of Baroda Limited', sector: 'Financial Services', industry: 'Public Sector Bank', tier: 'large' },
  { symbol: 'PNB.NS', name: 'Punjab National Bank', sector: 'Financial Services', industry: 'Public Sector Bank', tier: 'large' },
  { symbol: 'CANBK.NS', name: 'Canara Bank', sector: 'Financial Services', industry: 'Public Sector Bank', tier: 'mid' },
  { symbol: 'IDFCFIRSTB.NS', name: 'IDFC First Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'mid' },
  { symbol: 'FEDERALBNK.NS', name: 'Federal Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'mid' },
  { symbol: 'BANDHANBNK.NS', name: 'Bandhan Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'mid' },
  { symbol: 'AUBANK.NS', name: 'AU Small Finance Bank Limited', sector: 'Financial Services', industry: 'Small Finance Bank', tier: 'mid' },
  { symbol: 'YESBANK.NS', name: 'Yes Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'mid' },
  { symbol: 'RBLBANK.NS', name: 'RBL Bank Limited', sector: 'Financial Services', industry: 'Private Sector Bank', tier: 'mid' },
  { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance Limited', sector: 'Financial Services', industry: 'Non-Banking Financial Company', tier: 'mega' },
  { symbol: 'BAJAJFINSV.NS', name: 'Bajaj Finserv Limited', sector: 'Financial Services', industry: 'Diversified Financial Services', tier: 'large' },
  { symbol: 'HDFCLIFE.NS', name: 'HDFC Life Insurance Company Limited', sector: 'Financial Services', industry: 'Life Insurance', tier: 'large' },
  { symbol: 'SBILIFE.NS', name: 'SBI Life Insurance Company Limited', sector: 'Financial Services', industry: 'Life Insurance', tier: 'large' },
  { symbol: 'ICICIPRULI.NS', name: 'ICICI Prudential Life Insurance Company Limited', sector: 'Financial Services', industry: 'Life Insurance', tier: 'large' },
  { symbol: 'ICICIGI.NS', name: 'ICICI Lombard General Insurance Company Limited', sector: 'Financial Services', industry: 'General Insurance', tier: 'large' },
  { symbol: 'LICI.NS', name: 'Life Insurance Corporation of India', sector: 'Financial Services', industry: 'Life Insurance', tier: 'large', aliases: ['LIC'] },
  { symbol: 'SHRIRAMFIN.NS', name: 'Shriram Finance Limited', sector: 'Financial Services', industry: 'Non-Banking Financial Company', tier: 'large' },
  { symbol: 'CHOLAFIN.NS', name: 'Cholamandalam Investment and Finance Company Limited', sector: 'Financial Services', industry: 'Non-Banking Financial Company', tier: 'large' },
  { symbol: 'MUTHOOTFIN.NS', name: 'Muthoot Finance Limited', sector: 'Financial Services', industry: 'Non-Banking Financial Company', tier: 'large' },
  { symbol: 'PFC.NS', name: 'Power Finance Corporation Limited', sector: 'Financial Services', industry: 'Non-Banking Financial Company', tier: 'large' },
  { symbol: 'RECLTD.NS', name: 'REC Limited', sector: 'Financial Services', industry: 'Non-Banking Financial Company', tier: 'large' },
  { symbol: 'HDFCAMC.NS', name: 'HDFC Asset Management Company Limited', sector: 'Financial Services', industry: 'Asset Management', tier: 'large' },
  { symbol: 'POLICYBZR.NS', name: 'PB Fintech Limited', sector: 'Financial Services', industry: 'Insurance & Financial Marketplace', tier: 'mid', aliases: ['Policybazaar'] },

  // -- Information technology ---------------------------------------------
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'mega' },
  { symbol: 'INFY.NS', name: 'Infosys Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'mega' },
  { symbol: 'HCLTECH.NS', name: 'HCL Technologies Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'mega' },
  { symbol: 'WIPRO.NS', name: 'Wipro Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'large' },
  { symbol: 'TECHM.NS', name: 'Tech Mahindra Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'large' },
  { symbol: 'LTIM.NS', name: 'LTIMindtree Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'large' },
  { symbol: 'PERSISTENT.NS', name: 'Persistent Systems Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'large' },
  { symbol: 'COFORGE.NS', name: 'Coforge Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'mid' },
  { symbol: 'MPHASIS.NS', name: 'Mphasis Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'large' },
  { symbol: 'OFSS.NS', name: 'Oracle Financial Services Software Limited', sector: 'Information Technology', industry: 'Computers - Software & Consulting', tier: 'mid' },
  { symbol: 'LTTS.NS', name: 'L&T Technology Services Limited', sector: 'Information Technology', industry: 'Engineering Research & Development', tier: 'large', aliases: ['LTT'] },

  // -- Oil, gas & energy ----------------------------------------------------
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries Limited', sector: 'Oil, Gas & Consumable Fuels', industry: 'Refineries & Marketing', tier: 'mega', aliases: ['RIL'] },
  { symbol: 'ONGC.NS', name: 'Oil and Natural Gas Corporation Limited', sector: 'Oil, Gas & Consumable Fuels', industry: 'Oil Exploration & Production', tier: 'mega' },
  { symbol: 'IOC.NS', name: 'Indian Oil Corporation Limited', sector: 'Oil, Gas & Consumable Fuels', industry: 'Refineries & Marketing', tier: 'large' },
  { symbol: 'BPCL.NS', name: 'Bharat Petroleum Corporation Limited', sector: 'Oil, Gas & Consumable Fuels', industry: 'Refineries & Marketing', tier: 'large' },
  { symbol: 'HINDPETRO.NS', name: 'Hindustan Petroleum Corporation Limited', sector: 'Oil, Gas & Consumable Fuels', industry: 'Refineries & Marketing', tier: 'mid' },
  { symbol: 'GAIL.NS', name: 'GAIL (India) Limited', sector: 'Oil, Gas & Consumable Fuels', industry: 'Gas Transmission & Marketing', tier: 'large' },

  // -- Power & utilities -----------------------------------------------------
  { symbol: 'NTPC.NS', name: 'NTPC Limited', sector: 'Power', industry: 'Power Generation', tier: 'mega' },
  { symbol: 'POWERGRID.NS', name: 'Power Grid Corporation of India Limited', sector: 'Power', industry: 'Power Transmission', tier: 'large' },
  { symbol: 'TATAPOWER.NS', name: 'The Tata Power Company Limited', sector: 'Power', industry: 'Integrated Power Utilities', tier: 'large' },
  { symbol: 'ADANIPOWER.NS', name: 'Adani Power Limited', sector: 'Power', industry: 'Power Generation', tier: 'mid' },
  { symbol: 'ADANIGREEN.NS', name: 'Adani Green Energy Limited', sector: 'Power', industry: 'Renewable Power Generation', tier: 'mid' },
  { symbol: 'ADANIENSOL.NS', name: 'Adani Energy Solutions Limited', sector: 'Power', industry: 'Power Transmission', tier: 'mid' },
  { symbol: 'TORNTPOWER.NS', name: 'Torrent Power Limited', sector: 'Power', industry: 'Integrated Power Utilities', tier: 'mid' },
  { symbol: 'CESC.NS', name: 'CESC Limited', sector: 'Power', industry: 'Integrated Power Utilities', tier: 'mid' },
  { symbol: 'JSWENERGY.NS', name: 'JSW Energy Limited', sector: 'Power', industry: 'Power Generation', tier: 'mid' },
  { symbol: 'NHPC.NS', name: 'NHPC Limited', sector: 'Power', industry: 'Hydro Power Generation', tier: 'mid' },
  { symbol: 'SJVN.NS', name: 'SJVN Limited', sector: 'Power', industry: 'Hydro Power Generation', tier: 'small' },
  { symbol: 'PGCIL.NS', name: 'Power Grid Corporation of India Limited', sector: 'Power', industry: 'Power Transmission', tier: 'large' },

  // -- Metals, mining & cement ------------------------------------------------
  { symbol: 'TATASTEEL.NS', name: 'Tata Steel Limited', sector: 'Metals & Mining', industry: 'Iron & Steel', tier: 'large' },
  { symbol: 'JSWSTEEL.NS', name: 'JSW Steel Limited', sector: 'Metals & Mining', industry: 'Iron & Steel', tier: 'large' },
  { symbol: 'HINDALCO.NS', name: 'Hindalco Industries Limited', sector: 'Metals & Mining', industry: 'Aluminium', tier: 'large' },
  { symbol: 'VEDL.NS', name: 'Vedanta Limited', sector: 'Metals & Mining', industry: 'Diversified Metals', tier: 'large' },
  { symbol: 'SAIL.NS', name: 'Steel Authority of India Limited', sector: 'Metals & Mining', industry: 'Iron & Steel', tier: 'mid' },
  { symbol: 'JINDALSTEL.NS', name: 'Jindal Steel & Power Limited', sector: 'Metals & Mining', industry: 'Iron & Steel', tier: 'large' },
  { symbol: 'NMDC.NS', name: 'NMDC Limited', sector: 'Metals & Mining', industry: 'Mining - Iron Ore', tier: 'mid' },
  { symbol: 'COALINDIA.NS', name: 'Coal India Limited', sector: 'Metals & Mining', industry: 'Coal Mining', tier: 'large' },
  { symbol: 'HINDZINC.NS', name: 'Hindustan Zinc Limited', sector: 'Metals & Mining', industry: 'Zinc & Lead', tier: 'mid' },
  { symbol: 'ULTRACEMCO.NS', name: 'UltraTech Cement Limited', sector: 'Cement', industry: 'Cement & Cement Products', tier: 'large' },
  { symbol: 'SHREECEM.NS', name: 'Shree Cement Limited', sector: 'Cement', industry: 'Cement & Cement Products', tier: 'large' },
  { symbol: 'AMBUJACEM.NS', name: 'Ambuja Cements Limited', sector: 'Cement', industry: 'Cement & Cement Products', tier: 'large' },
  { symbol: 'ACC.NS', name: 'ACC Limited', sector: 'Cement', industry: 'Cement & Cement Products', tier: 'mid' },
  { symbol: 'GRASIM.NS', name: 'Grasim Industries Limited', sector: 'Diversified', industry: 'Cement, Chemicals & Textiles', tier: 'large' },

  // -- Automobiles -------------------------------------------------------------
  { symbol: 'MARUTI.NS', name: 'Maruti Suzuki India Limited', sector: 'Automobile', industry: 'Passenger Vehicles', tier: 'mega' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors Limited', sector: 'Automobile', industry: 'Passenger & Commercial Vehicles', tier: 'large' },
  { symbol: 'M&M.NS', name: 'Mahindra & Mahindra Limited', sector: 'Automobile', industry: 'Passenger & Utility Vehicles', tier: 'mega', aliases: ['M&M', 'Mahindra'] },
  { symbol: 'BAJAJ-AUTO.NS', name: 'Bajaj Auto Limited', sector: 'Automobile', industry: 'Two & Three Wheelers', tier: 'large' },
  { symbol: 'HEROMOTOCO.NS', name: 'Hero MotoCorp Limited', sector: 'Automobile', industry: 'Two Wheelers', tier: 'large' },
  { symbol: 'EICHERMOT.NS', name: 'Eicher Motors Limited', sector: 'Automobile', industry: 'Two Wheelers & Commercial Vehicles', tier: 'large' },
  { symbol: 'TVSMOTOR.NS', name: 'TVS Motor Company Limited', sector: 'Automobile', industry: 'Two & Three Wheelers', tier: 'mid' },
  { symbol: 'ASHOKLEY.NS', name: 'Ashok Leyland Limited', sector: 'Automobile', industry: 'Commercial Vehicles', tier: 'mid' },
  { symbol: 'BOSCHLTD.NS', name: 'Bosch Limited', sector: 'Automobile', industry: 'Auto Components', tier: 'mid' },
  { symbol: 'MRF.NS', name: 'MRF Limited', sector: 'Automobile', industry: 'Tyres', tier: 'mid' },
  { symbol: 'BALKRISIND.NS', name: 'Balkrishna Industries Limited', sector: 'Automobile', industry: 'Tyres', tier: 'mid' },

  // -- FMCG / consumer -----------------------------------------------------------
  { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever Limited', sector: 'FMCG', industry: 'Personal & Household Products', tier: 'mega', aliases: ['HUL'] },
  { symbol: 'ITC.NS', name: 'ITC Limited', sector: 'FMCG', industry: 'Diversified FMCG', tier: 'mega' },
  { symbol: 'NESTLEIND.NS', name: 'Nestle India Limited', sector: 'FMCG', industry: 'Packaged Foods', tier: 'large' },
  { symbol: 'BRITANNIA.NS', name: 'Britannia Industries Limited', sector: 'FMCG', industry: 'Packaged Foods', tier: 'large' },
  { symbol: 'DABUR.NS', name: 'Dabur India Limited', sector: 'FMCG', industry: 'Personal & Household Products', tier: 'large' },
  { symbol: 'MARICO.NS', name: 'Marico Limited', sector: 'FMCG', industry: 'Personal & Household Products', tier: 'large' },
  { symbol: 'GODREJCP.NS', name: 'Godrej Consumer Products Limited', sector: 'FMCG', industry: 'Personal & Household Products', tier: 'large' },
  { symbol: 'COLPAL.NS', name: 'Colgate-Palmolive (India) Limited', sector: 'FMCG', industry: 'Personal & Household Products', tier: 'mid' },
  { symbol: 'TATACONSUM.NS', name: 'Tata Consumer Products Limited', sector: 'FMCG', industry: 'Packaged Foods & Beverages', tier: 'large' },
  { symbol: 'VBL.NS', name: 'Varun Beverages Limited', sector: 'FMCG', industry: 'Beverages', tier: 'large' },
  { symbol: 'UBL.NS', name: 'United Breweries Limited', sector: 'FMCG', industry: 'Beverages - Alcoholic', tier: 'mid' },

  // -- Pharma & healthcare ---------------------------------------------------------
  { symbol: 'SUNPHARMA.NS', name: 'Sun Pharmaceutical Industries Limited', sector: 'Healthcare', industry: 'Pharmaceuticals', tier: 'mega' },
  { symbol: 'DRREDDY.NS', name: "Dr. Reddy's Laboratories Limited", sector: 'Healthcare', industry: 'Pharmaceuticals', tier: 'large' },
  { symbol: 'CIPLA.NS', name: 'Cipla Limited', sector: 'Healthcare', industry: 'Pharmaceuticals', tier: 'large' },
  { symbol: 'DIVISLAB.NS', name: "Divi's Laboratories Limited", sector: 'Healthcare', industry: 'Pharmaceuticals - APIs', tier: 'large' },
  { symbol: 'LUPIN.NS', name: 'Lupin Limited', sector: 'Healthcare', industry: 'Pharmaceuticals', tier: 'large' },
  { symbol: 'AUROPHARMA.NS', name: 'Aurobindo Pharma Limited', sector: 'Healthcare', industry: 'Pharmaceuticals', tier: 'large' },
  { symbol: 'BIOCON.NS', name: 'Biocon Limited', sector: 'Healthcare', industry: 'Pharmaceuticals - Biotechnology', tier: 'mid' },
  { symbol: 'TORNTPHARM.NS', name: 'Torrent Pharmaceuticals Limited', sector: 'Healthcare', industry: 'Pharmaceuticals', tier: 'large' },
  { symbol: 'ALKEM.NS', name: 'Alkem Laboratories Limited', sector: 'Healthcare', industry: 'Pharmaceuticals', tier: 'mid' },
  { symbol: 'ZYDUSLIFE.NS', name: 'Zydus Lifesciences Limited', sector: 'Healthcare', industry: 'Pharmaceuticals', tier: 'large' },
  { symbol: 'APOLLOHOSP.NS', name: 'Apollo Hospitals Enterprise Limited', sector: 'Healthcare', industry: 'Hospitals & Healthcare Services', tier: 'large' },
  { symbol: 'MAXHEALTH.NS', name: 'Max Healthcare Institute Limited', sector: 'Healthcare', industry: 'Hospitals & Healthcare Services', tier: 'mid' },
  { symbol: 'FORTIS.NS', name: 'Fortis Healthcare Limited', sector: 'Healthcare', industry: 'Hospitals & Healthcare Services', tier: 'mid' },

  // -- Capital goods, infra & defence ------------------------------------------------
  { symbol: 'LT.NS', name: 'Larsen & Toubro Limited', sector: 'Capital Goods', industry: 'Engineering & Construction', tier: 'mega', aliases: ['L&T', 'LT', 'Larsen Toubro'] },
  { symbol: 'SIEMENS.NS', name: 'Siemens Limited', sector: 'Capital Goods', industry: 'Heavy Electrical Equipment', tier: 'large' },
  { symbol: 'ABB.NS', name: 'ABB India Limited', sector: 'Capital Goods', industry: 'Heavy Electrical Equipment', tier: 'large' },
  { symbol: 'HAL.NS', name: 'Hindustan Aeronautics Limited', sector: 'Capital Goods', industry: 'Aerospace & Defense', tier: 'large' },
  { symbol: 'BEL.NS', name: 'Bharat Electronics Limited', sector: 'Capital Goods', industry: 'Aerospace & Defense', tier: 'large' },
  { symbol: 'BEML.NS', name: 'BEML Limited', sector: 'Capital Goods', industry: 'Aerospace & Defense', tier: 'small' },
  { symbol: 'BDL.NS', name: 'Bharat Dynamics Limited', sector: 'Capital Goods', industry: 'Aerospace & Defense', tier: 'mid' },
  { symbol: 'MAZDOCK.NS', name: 'Mazagon Dock Shipbuilders Limited', sector: 'Capital Goods', industry: 'Shipbuilding & Defense', tier: 'mid' },
  { symbol: 'COCHINSHIP.NS', name: 'Cochin Shipyard Limited', sector: 'Capital Goods', industry: 'Shipbuilding & Defense', tier: 'mid' },
  { symbol: 'GRSE.NS', name: 'Garden Reach Shipbuilders & Engineers Limited', sector: 'Capital Goods', industry: 'Shipbuilding & Defense', tier: 'small' },
  { symbol: 'CUMMINSIND.NS', name: 'Cummins India Limited', sector: 'Capital Goods', industry: 'Industrial Machinery', tier: 'mid' },
  { symbol: 'HAVELLS.NS', name: 'Havells India Limited', sector: 'Capital Goods', industry: 'Electrical Equipment', tier: 'large' },
  { symbol: 'POLYCAB.NS', name: 'Polycab India Limited', sector: 'Capital Goods', industry: 'Cables & Wires', tier: 'large' },
  { symbol: 'CGPOWER.NS', name: 'CG Power and Industrial Solutions Limited', sector: 'Capital Goods', industry: 'Electrical Equipment', tier: 'mid' },

  // -- Telecom -------------------------------------------------------------------
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Limited', sector: 'Telecommunication', industry: 'Telecom Services', tier: 'mega' },
  { symbol: 'IDEA.NS', name: 'Vodafone Idea Limited', sector: 'Telecommunication', industry: 'Telecom Services', tier: 'mid' },
  { symbol: 'INDUSTOWER.NS', name: 'Indus Towers Limited', sector: 'Telecommunication', industry: 'Telecom Infrastructure', tier: 'mid' },

  // -- Diversified / PSU / infra / realty ---------------------------------------------
  { symbol: 'ADANIENT.NS', name: 'Adani Enterprises Limited', sector: 'Diversified', industry: 'Diversified Conglomerate', tier: 'mega' },
  { symbol: 'ADANIPORTS.NS', name: 'Adani Ports and Special Economic Zone Limited', sector: 'Services', industry: 'Marine Port & Services', tier: 'large' },
  { symbol: 'DLF.NS', name: 'DLF Limited', sector: 'Realty', industry: 'Real Estate', tier: 'large' },
  { symbol: 'GODREJPROP.NS', name: 'Godrej Properties Limited', sector: 'Realty', industry: 'Real Estate', tier: 'mid' },
  { symbol: 'OBEROIRLTY.NS', name: 'Oberoi Realty Limited', sector: 'Realty', industry: 'Real Estate', tier: 'mid' },
  { symbol: 'IRCTC.NS', name: 'Indian Railway Catering and Tourism Corporation Limited', sector: 'Services', industry: 'Railway Catering & Tourism', tier: 'large' },
  { symbol: 'IRFC.NS', name: 'Indian Railway Finance Corporation Limited', sector: 'Financial Services', industry: 'Non-Banking Financial Company', tier: 'mid' },
  { symbol: 'CONCOR.NS', name: 'Container Corporation of India Limited', sector: 'Services', industry: 'Logistics', tier: 'mid' },

  // -- Retail & consumer discretionary --------------------------------------------------
  { symbol: 'TITAN.NS', name: 'Titan Company Limited', sector: 'Consumer Durables', industry: 'Jewellery & Watches', tier: 'mega' },
  { symbol: 'TRENT.NS', name: 'Trent Limited', sector: 'Retailing', industry: 'Speciality Retail', tier: 'large' },
  { symbol: 'DMART.NS', name: 'Avenue Supermarts Limited', sector: 'Retailing', industry: 'Speciality Retail', tier: 'large', aliases: ['DMart', 'D-Mart'] },
  { symbol: 'ASIANPAINT.NS', name: 'Asian Paints Limited', sector: 'Consumer Durables', industry: 'Paints', tier: 'large' },
  { symbol: 'BERGEPAINT.NS', name: 'Berger Paints India Limited', sector: 'Consumer Durables', industry: 'Paints', tier: 'mid' },
  { symbol: 'PIDILITIND.NS', name: 'Pidilite Industries Limited', sector: 'Chemicals', industry: 'Specialty Chemicals - Adhesives', tier: 'large' },
  { symbol: 'NAUKRI.NS', name: 'Info Edge (India) Limited', sector: 'Services', industry: 'Internet & Online Classifieds', tier: 'mid', aliases: ['Info Edge', 'Naukri'] },
  { symbol: 'NYKAA.NS', name: 'FSN E-Commerce Ventures Limited', sector: 'Retailing', industry: 'E-Commerce', tier: 'mid', aliases: ['Nykaa'] },
  { symbol: 'PAYTM.NS', name: 'One97 Communications Limited', sector: 'Services', industry: 'Fintech & Digital Payments', tier: 'mid', aliases: ['Paytm'] }
];

// Auto-verified real market closes & trailing returns in $ CAD (2023-11 .. 2026-11)
// Official Sources:
// 1) Bank of Canada Valet API (2026-11-05) — FX rates & Government of Canada benchmark bond yields
// 2) US Treasury Benchmark Yields (^IRX, ^FVX, ^TNX, ^TYX)
// 3) Yahoo Finance v8 Global Exchange Feeds (TSX, NYSE, Nasdaq, Euronext, Xetra, SIX, Copenhagen)

export const VERIFIED_BOC_FX_DATE = "2026-11-05";

export const VERIFIED_BOC_FX_TO_CAD: Record<string, number> = {
  "CAD": 1,
  "USD": 1.3989,
  "EUR": 1.5703,
  "GBP": 1.8841,
  "GBp": 0.018841,
  "CHF": 1.7146,
  "DKK": 0.2105,
  "JPY": 0.00886,
  "HKD": 0.1784,
  "AUD": 0.9741,
  "SEK": 0.1429
};

export interface SovereignYieldPoint {
  tenor: string;
  years: number;
  yieldPct: number;
}

export type AssetCategory = 'actions' | 'obligations' | 'crypto' | 'refuge';

export interface FinancialAsset {
  id: string;
  ticker: string;
  name: string;
  category: AssetCategory;
  categoryLabel: string;
  wrapper: string;
  annualFeePct: number;
  dividendYieldPct: number;
  baseExpectedReturnPct: number;
  baseVolatilityPct: number;
  growthBeta: number;
  inflationBeta: number;
  rateSensitivity: number;
  crisisConvexity: number;
  description: string;
  initialPrice2015: number;
  isIndividualStock?: boolean;
  sector?: string;
  region?: 'Europe (PEA)' | 'États-Unis (CTO)' | 'Global';
  recentTrendDrift?: number;
}

export interface StockFundamentalProfile {
  peForward: number;
  evEbitda: number;
  fcfYieldPct: number;
  roicPct: number;
  roePct: number;
  operatingMarginPct: number;
  epsGrowthNextYrPct: number;
  netDebtToEbitda: number;
  piotroskiFScore: number;
  altmanZScore: number;
  baseFairValueUpsidePct: number;
  catalystHeadline: string;
}

export type MarketAssetSubClass =
  | 'action_ca'
  | 'action_us'
  | 'action_eu_asia'
  | 'crypto_l1_defi'
  | 'etf_indice'
  | 'obligation_taux'
  | 'matiere_premiere'
  | 'immobilier_reit';

export interface CryptoAnalystProfile {
  consensusMechanism: string;
  stakingYieldPct: number;
  annualIssuancePct: number;
  nvtRatio: number;
  mvrvZScore: number;
  defiOrNetworkMoat: string;
  maxKellyPortfolioPct: number;
  baseCycleFairUpsidePct: number;
}

export interface FundOrMacroAnalystProfile {
  effectiveDurationYears: number;
  underlyingCurrency: 'CAD' | 'USD' | 'EUR' | 'Multi-devises';
  issuerAndStructure: string;
  indexMethodology: string;
  optimalCanadianWrapper:
    | 'CELI'
    | 'REER'
    | 'Non-enregistré'
    | 'CELI / REER'
    | 'REER / CELI';
  taxWrapperRationale: string;
  baseNavFairUpsidePct: number;
}

export interface RawExpandedEntry {
  id: string;
  ticker: string;
  name: string;
  category: AssetCategory;
  categoryLabel: string;
  subClass: MarketAssetSubClass;
  wrapper: string;
  sector: string;
  region: 'Canada (TSX)' | 'États-Unis (NYSE/NASDAQ)' | 'Europe & Asie' | 'Global / Décentralisé';
  spotCad2026: number;
  dividendYieldPct: number;
  annualFeePct: number;
  baseExpectedReturnPct: number;
  baseVolatilityPct: number;
  growthBeta: number;
  inflationBeta: number;
  rateSensitivity: number;
  crisisConvexity: number;
  recentTrendDrift: number;
  description: string;
  stockFund?: StockFundamentalProfile;
  cryptoFund?: CryptoAnalystProfile;
  macroFund?: FundOrMacroAnalystProfile;
}

export const VERIFIED_SOVEREIGN_YIELD_CURVE_2026_11: {
  asOfDate: string;
  canadaBoC: SovereignYieldPoint[];
  usTreasury: SovereignYieldPoint[];
} = {
  "asOfDate": "2026-11-04",
  "canadaBoC": [
    {
      "tenor": "3M",
      "years": 0.25,
      "yieldPct": 3.04
    },
    {
      "tenor": "1A",
      "years": 1,
      "yieldPct": 3.13
    },
    {
      "tenor": "2A",
      "years": 2,
      "yieldPct": 3.22
    },
    {
      "tenor": "5A",
      "years": 5,
      "yieldPct": 3.43
    },
    {
      "tenor": "10A",
      "years": 10,
      "yieldPct": 3.7
    },
    {
      "tenor": "30A",
      "years": 30,
      "yieldPct": 4.04
    }
  ],
  "usTreasury": [
    {
      "tenor": "3M",
      "years": 0.25,
      "yieldPct": 4.11
    },
    {
      "tenor": "1A",
      "years": 1,
      "yieldPct": 4.49
    },
    {
      "tenor": "2A",
      "years": 2,
      "yieldPct": 4.69
    },
    {
      "tenor": "5A",
      "years": 5,
      "yieldPct": 4.96
    },
    {
      "tenor": "10A",
      "years": 10,
      "yieldPct": 5.13
    },
    {
      "tenor": "30A",
      "years": 30,
      "yieldPct": 5.46
    }
  ]
};

export const VERIFIED_YAHOO_SYMBOL_MAP: Record<string, string> = {
  "CASH": "PSA.TO",
  "NOVO": "NOVO-B.CO",
  "GOLD": "GLD",
  "GOVT": "IEF",
  "CORP": "LQD",
  "BRKB": "BRK-B",
  "ECL": "UFO",
  "BTC": "BTC-CAD",
  "ETH": "ETH-CAD",
  "SOL": "SOL-CAD",
  "BNB": "BNB-CAD",
  "XRP": "XRP-CAD",
  "ADA": "ADA-CAD",
  "DOGE": "DOGE-CAD",
  "AVAX": "AVAX-CAD",
  "LINK": "LINK-CAD",
  "DOT": "DOT-CAD",
  "AAVE": "AAVE-CAD",
  "NEAR": "NEAR-USD",
  "SUI": "SUI20947-USD",
  "UNI": "UNI7083-USD",
  "RNDR": "RENDER-USD",
  "TAO": "TAO22974-USD",
  "ARB": "ARB11841-USD"
};

export interface VerifiedTrailingReturnSnapshot {
  r1dPct: number;
  r5dPct: number;
  r1mPct: number;
  r3mPct: number;
  r6mPct: number;
  r12mPct: number;
  high52wCad: number;
  low52wCad: number;
}

export const VERIFIED_SPOT_CAD_2026_11: Record<string, number> = {
  "CASH": 107.86,
  "XBB": 1123.46,
  "MEUD": 515.37,
  "ADP": 232.48,
  "BTC": 99038.71,
  "ASML": 2132.47,
  "MC": 634.4,
  "CORP": 144.16,
  "GOLD": 496.46,
  "ESE": 55,
  "SU": 383.07,
  "ODFL": 482.24,
  "RMS": 2113.62,
  "GOVT": 126.19,
  "ETH": 2803.26,
  "STLAP": 5.59,
  "OR": 705.61,
  "DG": 180.98,
  "KER": 291.23,
  "CS": 73.4,
  "SAP": 336.91,
  "NOVO": 58.34,
  "BNP": 150.17,
  "AIR": 323.64,
  "CAP": 198.25,
  "TEP": 113.06,
  "AI": 305.11,
  "SAN": 138.42,
  "TTE": 128.61,
  "GOOGL": 417.85,
  "COST": 1527.89,
  "META": 872.37,
  "TSLA": 555.99,
  "VCN": 509.7,
  "MSFT": 731.62,
  "V": 587.97,
  "AMZN": 374.12,
  "JPM": 479.57,
  "AAPL": 496.44,
  "LLY": 1996.62,
  "ALO": 15.93,
  "XOM": 237.51,
  "UNH": 566.74,
  "NA": 216.65,
  "CDNS": 58.47,
  "EMR": 567.24,
  "ACN": 220.05,
  "QQQM": 312.11,
  "BMO": 246.71,
  "INTC": 85.61,
  "NKE": 52.82,
  "TD": 176.69,
  "PFE": 40.33,
  "RY": 289.39,
  "PAYX": 240.02,
  "BA": 239.98,
  "ECL": 57.52,
  "SHOP": 209.41,
  "ATD": 82.48,
  "DOL": 220.42,
  "WSP": 184.33,
  "ENB": 68.57,
  "BNS": 132.22,
  "IFC": 280.05,
  "CSU": 3496.88,
  "CP": 134.75,
  "CNQ": 70.04,
  "BN": 59.31,
  "AEM": 254.28,
  "CCO": 102.37,
  "CNR": 181.9,
  "ANET": 289.05,
  "CRM": 304.36,
  "PANW": 451.37,
  "ISRG": 615.36,
  "AMD": 818.78,
  "FTS": 84.43,
  "BRKB": 825.11,
  "MFC": 62.65,
  "ORCL": 177.81,
  "NFLX": 87.7,
  "BCE": 30.47,
  "L": 69.35,
  "NTR": 101.5,
  "MA": 912.92,
  "COIN": 182.79,
  "SIEDE": 436.31,
  "ABBV": 411.91,
  "ALVDE": 746.99,
  "UBER": 96.69,
  "SPGI": 655.4,
  "LMT": 845.06,
  "KO": 136.31,
  "WMT": 176.53,
  "GE": 462.84,
  "CAT": 846.73,
  "ETN": 502.26,
  "RHMDE": 1195.16,
  "BLK": 1701.92,
  "SOL": 116.15,
  "AZN": 257.93,
  "AAVE": 163.23,
  "LINK": 14.4,
  "NESN": 149.34,
  "SUI": 1.1436,
  "ADA": 0.2475,
  "MELI": 2063.5,
  "RACE": 567.24,
  "SONY": 37.29,
  "BNB": 917.36,
  "TAO": 299.87,
  "AVAX": 12.2,
  "XRP": 1.4727,
  "RNDR": 2.16,
  "XEQT": 45.58,
  "DOGE": 0.0941,
  "DOT": 1.2005,
  "QQQ": 962.68,
  "VFV": 192.06,
  "SCHD": 50.26,
  "VDY": 78.44,
  "ARB": 0.2074,
  "ZAG": 13.5,
  "NEAR": 5,
  "UNI": 8.32,
  "XIU": 54.55,
  "TLT": 111.52,
  "SLV": 63.12,
  "CRWD": 321.57,
  "HURA": 39.59,
  "XRE": 15.5,
  "TRP": 92.04,
  "SUTO": 98.8,
  "PLD": 179.83,
  "CM": 165.53,
  "GIBA": 116.81,
  "TIP": 146.56,
  "MU": 1116.94,
  "AMAT": 532.91,
  "COPX": 99.34,
  "O": 82.9,
  "ZEB": 76.82,
  "MSTR": 160.05,
  "GS": 1278.04,
  "TMO": 978.45,
  "TEC": 60.15,
  "HYG": 107.69,
  "CVX": 302.65
};

export const VERIFIED_TRAILING_RETURNS_CAD_2026_11: Record<string, VerifiedTrailingReturnSnapshot> = {
  "CASH": {
    "r1dPct": 0.01,
    "r5dPct": 0.05,
    "r1mPct": 0.22,
    "r3mPct": 0.68,
    "r6mPct": 1.42,
    "r12mPct": 3.15,
    "high52wCad": 107.86,
    "low52wCad": 104.56
  },
  "XBB": {
    "r1dPct": 0.1,
    "r5dPct": 3.3,
    "r1mPct": 0.7,
    "r3mPct": 3.2,
    "r6mPct": 8.1,
    "r12mPct": 18.7,
    "high52wCad": 1130.54,
    "low52wCad": 915.98
  },
  "MEUD": {
    "r1dPct": 0,
    "r5dPct": 2.5,
    "r1mPct": 3.9,
    "r3mPct": 2.3,
    "r6mPct": 8,
    "r12mPct": 17.5,
    "high52wCad": 517.26,
    "low52wCad": 420.62
  },
  "ADP": {
    "r1dPct": -4.3,
    "r5dPct": -8.5,
    "r1mPct": -24.9,
    "r3mPct": -26.2,
    "r6mPct": -29.5,
    "r12mPct": -11.1,
    "high52wCad": 340.45,
    "low52wCad": 208.16
  },
  "BTC": {
    "r1dPct": -2.7,
    "r5dPct": -6,
    "r1mPct": -12.8,
    "r3mPct": -7.4,
    "r6mPct": 9,
    "r12mPct": -29.2,
    "high52wCad": 139947.08,
    "low52wCad": 82122.29
  },
  "ASML": {
    "r1dPct": -1.4,
    "r5dPct": 5.8,
    "r1mPct": -7.3,
    "r3mPct": -11.9,
    "r6mPct": 1,
    "r12mPct": 54.1,
    "high52wCad": 2733.89,
    "low52wCad": 1291.1
  },
  "MC": {
    "r1dPct": -0.2,
    "r5dPct": -1.2,
    "r1mPct": 1.4,
    "r3mPct": -9.8,
    "r6mPct": -14.7,
    "r12mPct": -36.6,
    "high52wCad": 1027.45,
    "low52wCad": 589.88
  },
  "CORP": {
    "r1dPct": -0.9,
    "r5dPct": -1.5,
    "r1mPct": 0.4,
    "r3mPct": -2.9,
    "r6mPct": -5.1,
    "r12mPct": -6.8,
    "high52wCad": 156.76,
    "low52wCad": 141.57
  },
  "GOLD": {
    "r1dPct": -2.8,
    "r5dPct": -5.5,
    "r1mPct": -5.6,
    "r3mPct": -11.6,
    "r6mPct": -16.9,
    "r12mPct": -7.3,
    "high52wCad": 713.02,
    "low52wCad": 493.69
  },
  "ESE": {
    "r1dPct": 0,
    "r5dPct": 3.6,
    "r1mPct": 0.2,
    "r3mPct": 4,
    "r6mPct": 8.4,
    "r12mPct": 19.3,
    "high52wCad": 55.73,
    "low52wCad": 43.98
  },
  "SU": {
    "r1dPct": -0.3,
    "r5dPct": 6.7,
    "r1mPct": -5.4,
    "r3mPct": -17.3,
    "r6mPct": -7.8,
    "r12mPct": 4,
    "high52wCad": 490.4,
    "low52wCad": 346.09
  },
  "ODFL": {
    "r1dPct": -1.7,
    "r5dPct": 3.9,
    "r1mPct": -3.1,
    "r3mPct": -13,
    "r6mPct": 9.8,
    "r12mPct": 0.1,
    "high52wCad": 575.51,
    "low52wCad": 412.36
  },
  "RMS": {
    "r1dPct": -0.5,
    "r5dPct": -1.2,
    "r1mPct": 0.6,
    "r3mPct": -13.7,
    "r6mPct": -16.3,
    "r12mPct": -37.8,
    "high52wCad": 3611.69,
    "low52wCad": 1928.33
  },
  "GOVT": {
    "r1dPct": -0.8,
    "r5dPct": -1.9,
    "r1mPct": 0.6,
    "r3mPct": -3,
    "r6mPct": -4.3,
    "r12mPct": -6.6,
    "high52wCad": 137.16,
    "low52wCad": 124
  },
  "ETH": {
    "r1dPct": -2.6,
    "r5dPct": -6.4,
    "r1mPct": -16,
    "r3mPct": -19.6,
    "r6mPct": 10.1,
    "r12mPct": -38.2,
    "high52wCad": 4753.03,
    "low52wCad": 2098.94
  },
  "STLAP": {
    "r1dPct": 0.3,
    "r5dPct": -11.4,
    "r1mPct": -8.3,
    "r3mPct": -18.8,
    "r6mPct": -43.7,
    "r12mPct": -61.5,
    "high52wCad": 16.48,
    "low52wCad": 5.49
  },
  "OR": {
    "r1dPct": 0.6,
    "r5dPct": -0.1,
    "r1mPct": 10.4,
    "r3mPct": 19.7,
    "r6mPct": 25,
    "r12mPct": 25.1,
    "high52wCad": 715.66,
    "low52wCad": 532.1
  },
  "DG": {
    "r1dPct": 0,
    "r5dPct": 3.3,
    "r1mPct": 7.1,
    "r3mPct": -3.5,
    "r6mPct": -6.4,
    "r12mPct": -4.4,
    "high52wCad": 224.79,
    "low52wCad": 163.7
  },
  "KER": {
    "r1dPct": -2,
    "r5dPct": -0.9,
    "r1mPct": -14.1,
    "r3mPct": -27.5,
    "r6mPct": -24.2,
    "r12mPct": -42.3,
    "high52wCad": 505.87,
    "low52wCad": 272.45
  },
  "CS": {
    "r1dPct": 0.3,
    "r5dPct": 4.6,
    "r1mPct": 9.1,
    "r3mPct": 4.9,
    "r6mPct": 16.5,
    "r12mPct": 20,
    "high52wCad": 73.71,
    "low52wCad": 57.39
  },
  "SAP": {
    "r1dPct": 0.9,
    "r5dPct": 1.8,
    "r1mPct": 6.6,
    "r3mPct": 17.6,
    "r6mPct": 42.2,
    "r12mPct": -1.6,
    "high52wCad": 344.92,
    "low52wCad": 200.21
  },
  "NOVO": {
    "r1dPct": 0.5,
    "r5dPct": 2.9,
    "r1mPct": 5.2,
    "r3mPct": -6.5,
    "r6mPct": -3.6,
    "r12mPct": -13,
    "high52wCad": 86.29,
    "low52wCad": 47.2
  },
  "BNP": {
    "r1dPct": -0.1,
    "r5dPct": 4,
    "r1mPct": 7.5,
    "r3mPct": -12.6,
    "r6mPct": 7.3,
    "r12mPct": 37.4,
    "high52wCad": 178.73,
    "low52wCad": 103.44
  },
  "AIR": {
    "r1dPct": -1,
    "r5dPct": 4.9,
    "r1mPct": 5.8,
    "r3mPct": -1.8,
    "r6mPct": 24.2,
    "r12mPct": -2,
    "high52wCad": 347.51,
    "low52wCad": 247.2
  },
  "CAP": {
    "r1dPct": -0.2,
    "r5dPct": -0.5,
    "r1mPct": 3.4,
    "r3mPct": 17.7,
    "r6mPct": 23.2,
    "r12mPct": -6.2,
    "high52wCad": 240.33,
    "low52wCad": 134.45
  },
  "TEP": {
    "r1dPct": 1.6,
    "r5dPct": 5.2,
    "r1mPct": -5.7,
    "r3mPct": 4.7,
    "r6mPct": -1.7,
    "r12mPct": 18.5,
    "high52wCad": 129.86,
    "low52wCad": 68.54
  },
  "AI": {
    "r1dPct": 0.8,
    "r5dPct": 3.5,
    "r1mPct": 12.3,
    "r3mPct": 16.3,
    "r6mPct": 18.9,
    "r12mPct": 23.4,
    "high52wCad": 305.58,
    "low52wCad": 221.07
  },
  "SAN": {
    "r1dPct": 0.2,
    "r5dPct": 5.3,
    "r1mPct": 22.2,
    "r3mPct": 13.5,
    "r6mPct": 13.7,
    "r12mPct": -2.5,
    "high52wCad": 142.02,
    "low52wCad": 109.53
  },
  "TTE": {
    "r1dPct": 1.6,
    "r5dPct": 2.7,
    "r1mPct": 2.1,
    "r3mPct": 6.5,
    "r6mPct": 2,
    "r12mPct": 45.8,
    "high52wCad": 134.95,
    "low52wCad": 83.68
  },
  "GOOGL": {
    "r1dPct": 1.8,
    "r5dPct": 5.7,
    "r1mPct": -14.1,
    "r3mPct": -13.6,
    "r6mPct": -25.5,
    "r12mPct": 7.2,
    "high52wCad": 571.6,
    "low52wCad": 378.68
  },
  "COST": {
    "r1dPct": 0.4,
    "r5dPct": 2.5,
    "r1mPct": 11.2,
    "r3mPct": 13.6,
    "r6mPct": 4.9,
    "r12mPct": 18.1,
    "high52wCad": 1542.76,
    "low52wCad": 1180.76
  },
  "META": {
    "r1dPct": -0.8,
    "r5dPct": 3.1,
    "r1mPct": -15.4,
    "r3mPct": 5.7,
    "r6mPct": 0.8,
    "r12mPct": 2.2,
    "high52wCad": 1090.89,
    "low52wCad": 727.79
  },
  "TSLA": {
    "r1dPct": 1.7,
    "r5dPct": 15.6,
    "r1mPct": 8.2,
    "r3mPct": 16.1,
    "r6mPct": -10.3,
    "r12mPct": -1.1,
    "high52wCad": 697.81,
    "low52wCad": 416
  },
  "VCN": {
    "r1dPct": 5.5,
    "r5dPct": 25,
    "r1mPct": 5.2,
    "r3mPct": -7.3,
    "r6mPct": -17.2,
    "r12mPct": 7.2,
    "high52wCad": 692.46,
    "low52wCad": 405.36
  },
  "MSFT": {
    "r1dPct": 0.4,
    "r5dPct": -2.4,
    "r1mPct": -2,
    "r3mPct": 5.6,
    "r6mPct": 27.7,
    "r12mPct": 3.9,
    "high52wCad": 782.19,
    "low52wCad": 488.5
  },
  "V": {
    "r1dPct": -1.2,
    "r5dPct": -0.5,
    "r1mPct": 7.4,
    "r3mPct": 15.4,
    "r6mPct": 30.3,
    "r12mPct": 25.1,
    "high52wCad": 618.64,
    "low52wCad": 411.12
  },
  "AMZN": {
    "r1dPct": 0.5,
    "r5dPct": 2.8,
    "r1mPct": 5.3,
    "r3mPct": 1.8,
    "r6mPct": 0.1,
    "r12mPct": 12.6,
    "high52wCad": 401.76,
    "low52wCad": 274.18
  },
  "JPM": {
    "r1dPct": -0.2,
    "r5dPct": 1.6,
    "r1mPct": 2.2,
    "r3mPct": -5.5,
    "r6mPct": 14.3,
    "r12mPct": 10.8,
    "high52wCad": 512.7,
    "low52wCad": 390.43
  },
  "AAPL": {
    "r1dPct": -0.2,
    "r5dPct": 3.1,
    "r1mPct": 3.5,
    "r3mPct": 16,
    "r6mPct": 19,
    "r12mPct": 30,
    "high52wCad": 502.72,
    "low52wCad": 340.52
  },
  "LLY": {
    "r1dPct": -0.7,
    "r5dPct": 4.6,
    "r1mPct": 18.1,
    "r3mPct": 20.9,
    "r6mPct": 41.8,
    "r12mPct": 39.5,
    "high52wCad": 2042.39,
    "low52wCad": 1189.78
  },
  "ALO": {
    "r1dPct": -1.8,
    "r5dPct": -5.3,
    "r1mPct": -36.4,
    "r3mPct": -35.8,
    "r6mPct": -39.3,
    "r12mPct": -55.4,
    "high52wCad": 47.47,
    "low52wCad": 15.87
  },
  "XOM": {
    "r1dPct": 1.8,
    "r5dPct": 2.7,
    "r1mPct": -4.1,
    "r3mPct": 6,
    "r6mPct": 11.1,
    "r12mPct": 42.9,
    "high52wCad": 263.69,
    "low52wCad": 159.74
  },
  "UNH": {
    "r1dPct": 0.5,
    "r5dPct": 2.4,
    "r1mPct": 2.4,
    "r3mPct": 0.8,
    "r6mPct": 1.5,
    "r12mPct": 21.8,
    "high52wCad": 645.76,
    "low52wCad": 358.08
  },
  "NA": {
    "r1dPct": -0.3,
    "r5dPct": 1.3,
    "r1mPct": 8,
    "r3mPct": -6.2,
    "r6mPct": 5.9,
    "r12mPct": 32.9,
    "high52wCad": 237.13,
    "low52wCad": 160.01
  },
  "CDNS": {
    "r1dPct": 0.2,
    "r5dPct": 4.2,
    "r1mPct": -2.4,
    "r3mPct": -2.5,
    "r6mPct": -1.9,
    "r12mPct": 22.6,
    "high52wCad": 67.87,
    "low52wCad": 45.1
  },
  "EMR": {
    "r1dPct": -1.9,
    "r5dPct": 14.8,
    "r1mPct": -5.7,
    "r3mPct": -4.9,
    "r6mPct": -2.9,
    "r12mPct": 43.7,
    "high52wCad": 681.92,
    "low52wCad": 373.25
  },
  "ACN": {
    "r1dPct": -2.3,
    "r5dPct": 21.2,
    "r1mPct": -12,
    "r3mPct": -22.8,
    "r6mPct": -16.9,
    "r12mPct": 35.4,
    "high52wCad": 429.98,
    "low52wCad": 149.96
  },
  "QQQM": {
    "r1dPct": -0.4,
    "r5dPct": 11.1,
    "r1mPct": 2.6,
    "r3mPct": -22.8,
    "r6mPct": -18.1,
    "r12mPct": 10.8,
    "high52wCad": 433.66,
    "low52wCad": 256.73
  },
  "BMO": {
    "r1dPct": -0.4,
    "r5dPct": 2.1,
    "r1mPct": 5.8,
    "r3mPct": -3.9,
    "r6mPct": 19.8,
    "r12mPct": 39.5,
    "high52wCad": 259.2,
    "low52wCad": 168.92
  },
  "INTC": {
    "r1dPct": -2.1,
    "r5dPct": 17.1,
    "r1mPct": -37.6,
    "r3mPct": -40.3,
    "r6mPct": -47.2,
    "r12mPct": 70.4,
    "high52wCad": 199.13,
    "low52wCad": 46.01
  },
  "NKE": {
    "r1dPct": -1.5,
    "r5dPct": -4.6,
    "r1mPct": 7,
    "r3mPct": -7.3,
    "r6mPct": -10.1,
    "r12mPct": -42.8,
    "high52wCad": 96.72,
    "low52wCad": 44.72
  },
  "TD": {
    "r1dPct": -0.2,
    "r5dPct": 2.4,
    "r1mPct": 5.4,
    "r3mPct": 3,
    "r6mPct": 20.9,
    "r12mPct": 52.5,
    "high52wCad": 179.8,
    "low52wCad": 112.53
  },
  "PFE": {
    "r1dPct": -2.1,
    "r5dPct": -3.5,
    "r1mPct": -1.3,
    "r3mPct": 7.6,
    "r6mPct": 12,
    "r12mPct": 11.8,
    "high52wCad": 43.98,
    "low52wCad": 33.04
  },
  "RY": {
    "r1dPct": -0.2,
    "r5dPct": 1.2,
    "r1mPct": 4.8,
    "r3mPct": -3.4,
    "r6mPct": 17.2,
    "r12mPct": 38.6,
    "high52wCad": 306.38,
    "low52wCad": 202.79
  },
  "PAYX": {
    "r1dPct": -0.5,
    "r5dPct": 10.7,
    "r1mPct": -14.6,
    "r3mPct": -1.4,
    "r6mPct": 28.3,
    "r12mPct": -0.3,
    "high52wCad": 297.88,
    "low52wCad": 148.8
  },
  "BA": {
    "r1dPct": -1.7,
    "r5dPct": -0.6,
    "r1mPct": -7.1,
    "r3mPct": -26,
    "r6mPct": -25.2,
    "r12mPct": -11.8,
    "high52wCad": 355.81,
    "low52wCad": 230.83
  },
  "ECL": {
    "r1dPct": -2.5,
    "r5dPct": 10.5,
    "r1mPct": 3.5,
    "r3mPct": -15.2,
    "r6mPct": -29.1,
    "r12mPct": 23,
    "high52wCad": 95.42,
    "low52wCad": 43.21
  },
  "SHOP": {
    "r1dPct": -1.5,
    "r5dPct": 4.1,
    "r1mPct": -14.7,
    "r3mPct": -5.2,
    "r6mPct": 60.2,
    "r12mPct": -4.6,
    "high52wCad": 255.95,
    "low52wCad": 129.01
  },
  "ATD": {
    "r1dPct": 0.2,
    "r5dPct": -1.3,
    "r1mPct": 1.9,
    "r3mPct": -11,
    "r6mPct": 5.8,
    "r12mPct": 15.8,
    "high52wCad": 95.15,
    "low52wCad": 68.56
  },
  "DOL": {
    "r1dPct": 0.9,
    "r5dPct": 0.8,
    "r1mPct": 11.4,
    "r3mPct": 14.6,
    "r6mPct": 28.9,
    "r12mPct": 15.2,
    "high52wCad": 222.17,
    "low52wCad": 163.25
  },
  "WSP": {
    "r1dPct": -0.2,
    "r5dPct": -2.7,
    "r1mPct": 14,
    "r3mPct": -5.8,
    "r6mPct": -5,
    "r12mPct": -28.6,
    "high52wCad": 275.24,
    "low52wCad": 156.64
  },
  "ENB": {
    "r1dPct": 0.5,
    "r5dPct": 1.8,
    "r1mPct": 1.6,
    "r3mPct": -4.1,
    "r6mPct": -9.4,
    "r12mPct": 0.5,
    "high52wCad": 80.65,
    "low52wCad": 62.42
  },
  "BNS": {
    "r1dPct": -0.5,
    "r5dPct": 2.8,
    "r1mPct": 3.2,
    "r3mPct": 4.7,
    "r6mPct": 26.1,
    "r12mPct": 39.2,
    "high52wCad": 135.4,
    "low52wCad": 92.85
  },
  "IFC": {
    "r1dPct": 0.3,
    "r5dPct": -0.8,
    "r1mPct": 14.6,
    "r3mPct": 2.7,
    "r6mPct": 11.6,
    "r12mPct": -1.5,
    "high52wCad": 305.52,
    "low52wCad": 236.92
  },
  "CSU": {
    "r1dPct": 1.2,
    "r5dPct": -0.4,
    "r1mPct": 11.4,
    "r3mPct": 10.6,
    "r6mPct": 41.7,
    "r12mPct": 4.2,
    "high52wCad": 3532.73,
    "low52wCad": 2196
  },
  "CP": {
    "r1dPct": 0.9,
    "r5dPct": 2.6,
    "r1mPct": 9.8,
    "r3mPct": 3,
    "r6mPct": 14.8,
    "r12mPct": 32.8,
    "high52wCad": 135.4,
    "low52wCad": 96.84
  },
  "CNQ": {
    "r1dPct": 0.5,
    "r5dPct": 2.3,
    "r1mPct": -5.1,
    "r3mPct": 5.6,
    "r6mPct": 8.3,
    "r12mPct": 54.2,
    "high52wCad": 78.6,
    "low52wCad": 41.68
  },
  "BN": {
    "r1dPct": -1,
    "r5dPct": 1.4,
    "r1mPct": 16,
    "r3mPct": -5.6,
    "r6mPct": -4.2,
    "r12mPct": -9.7,
    "high52wCad": 68.44,
    "low52wCad": 50.76
  },
  "AEM": {
    "r1dPct": -4.1,
    "r5dPct": -4,
    "r1mPct": 1,
    "r3mPct": 1.1,
    "r6mPct": -5.3,
    "r12mPct": 4.9,
    "high52wCad": 348.94,
    "low52wCad": 188.48
  },
  "CCO": {
    "r1dPct": -3.3,
    "r5dPct": 6.8,
    "r1mPct": -11.7,
    "r3mPct": -24.8,
    "r6mPct": -35.3,
    "r12mPct": -21.1,
    "high52wCad": 182.72,
    "low52wCad": 92.52
  },
  "CNR": {
    "r1dPct": 0.1,
    "r5dPct": 2.6,
    "r1mPct": 6.5,
    "r3mPct": 2.3,
    "r6mPct": 18.6,
    "r12mPct": 32.7,
    "high52wCad": 185.25,
    "low52wCad": 128.05
  },
  "ANET": {
    "r1dPct": 5.1,
    "r5dPct": 29.8,
    "r1mPct": 5.7,
    "r3mPct": 3.9,
    "r6mPct": 39.8,
    "r12mPct": 58.6,
    "high52wCad": 304.13,
    "low52wCad": 160.2
  },
  "CRM": {
    "r1dPct": -0.2,
    "r5dPct": -2.2,
    "r1mPct": -7.8,
    "r3mPct": 10.9,
    "r6mPct": 29.8,
    "r12mPct": -9.5,
    "high52wCad": 376.46,
    "low52wCad": 204.69
  },
  "PANW": {
    "r1dPct": -3.5,
    "r5dPct": 2.5,
    "r1mPct": -14,
    "r3mPct": -16,
    "r6mPct": 35.5,
    "r12mPct": 57.6,
    "high52wCad": 604.79,
    "low52wCad": 195.24
  },
  "ISRG": {
    "r1dPct": -2.1,
    "r5dPct": -6.1,
    "r1mPct": 4.7,
    "r3mPct": 11.5,
    "r6mPct": 2.8,
    "r12mPct": -22.2,
    "high52wCad": 844.77,
    "low52wCad": 459.64
  },
  "AMD": {
    "r1dPct": 5.9,
    "r5dPct": 44.7,
    "r1mPct": 2.5,
    "r3mPct": 13.8,
    "r6mPct": 30.2,
    "r12mPct": 136,
    "high52wCad": 921.2,
    "low52wCad": 263.3
  },
  "FTS": {
    "r1dPct": 0.2,
    "r5dPct": -1.6,
    "r1mPct": 8.3,
    "r3mPct": 7.7,
    "r6mPct": 9.6,
    "r12mPct": 14.5,
    "high52wCad": 86.35,
    "low52wCad": 69.06
  },
  "BRKB": {
    "r1dPct": 0.3,
    "r5dPct": 3.1,
    "r1mPct": 12.1,
    "r3mPct": 17,
    "r6mPct": 21.9,
    "r12mPct": 15,
    "high52wCad": 835.03,
    "low52wCad": 649.1
  },
  "MFC": {
    "r1dPct": -1.2,
    "r5dPct": 1.7,
    "r1mPct": 1.9,
    "r3mPct": 2.3,
    "r6mPct": 14.7,
    "r12mPct": 29.9,
    "high52wCad": 64.6,
    "low52wCad": 44.23
  },
  "ORCL": {
    "r1dPct": -1,
    "r5dPct": 10.4,
    "r1mPct": -2.6,
    "r3mPct": -15.6,
    "r6mPct": -35,
    "r12mPct": -41.6,
    "high52wCad": 350.07,
    "low52wCad": 152.77
  },
  "NFLX": {
    "r1dPct": -2.9,
    "r5dPct": -4.4,
    "r1mPct": -11.2,
    "r3mPct": -19.8,
    "r6mPct": -27.9,
    "r12mPct": -45.7,
    "high52wCad": 161.47,
    "low52wCad": 85.88
  },
  "BCE": {
    "r1dPct": -0.5,
    "r5dPct": -1.2,
    "r1mPct": 8.8,
    "r3mPct": -6.1,
    "r6mPct": -8.8,
    "r12mPct": -4.5,
    "high52wCad": 36.25,
    "low52wCad": 26.66
  },
  "L": {
    "r1dPct": 0.3,
    "r5dPct": 0.6,
    "r1mPct": 5.5,
    "r3mPct": 10.7,
    "r6mPct": 15.1,
    "r12mPct": 18.3,
    "high52wCad": 71.07,
    "low52wCad": 58.62
  },
  "NTR": {
    "r1dPct": -0.6,
    "r5dPct": 0.4,
    "r1mPct": 2,
    "r3mPct": 8.1,
    "r6mPct": 3.9,
    "r12mPct": 20.5,
    "high52wCad": 116.95,
    "low52wCad": 76.91
  },
  "MA": {
    "r1dPct": -1.2,
    "r5dPct": -0.5,
    "r1mPct": 8.2,
    "r3mPct": 14.6,
    "r6mPct": 33.2,
    "r12mPct": 17.5,
    "high52wCad": 954.04,
    "low52wCad": 649.82
  },
  "COIN": {
    "r1dPct": -4.1,
    "r5dPct": -4.5,
    "r1mPct": -24.4,
    "r3mPct": -12,
    "r6mPct": -38.4,
    "r12mPct": -53.8,
    "high52wCad": 409.54,
    "low52wCad": 181.03
  },
  "SIEDE": {
    "r1dPct": -1.4,
    "r5dPct": 5.4,
    "r1mPct": 2.7,
    "r3mPct": 0.7,
    "r6mPct": 5.2,
    "r12mPct": 22.4,
    "high52wCad": 458.06,
    "low52wCad": 310.92
  },
  "ABBV": {
    "r1dPct": -0.2,
    "r5dPct": 2.2,
    "r1mPct": 3.9,
    "r3mPct": 18,
    "r6mPct": 39.7,
    "r12mPct": 26.8,
    "high52wCad": 423.77,
    "low52wCad": 266.84
  },
  "ALVDE": {
    "r1dPct": 0.7,
    "r5dPct": 5.5,
    "r1mPct": 10.7,
    "r3mPct": 7.6,
    "r6mPct": 23.3,
    "r12mPct": 30.9,
    "high52wCad": 750.92,
    "low52wCad": 532.02
  },
  "UBER": {
    "r1dPct": -2.2,
    "r5dPct": 0.5,
    "r1mPct": -0.2,
    "r3mPct": -9,
    "r6mPct": -7.5,
    "r12mPct": -24.7,
    "high52wCad": 129.99,
    "low52wCad": 89.59
  },
  "SPGI": {
    "r1dPct": -1.4,
    "r5dPct": -0.8,
    "r1mPct": 14.7,
    "r3mPct": 11.9,
    "r6mPct": 22.6,
    "r12mPct": -1.5,
    "high52wCad": 730.88,
    "low52wCad": 505.05
  },
  "LMT": {
    "r1dPct": -1,
    "r5dPct": 4.8,
    "r1mPct": 15.7,
    "r3mPct": -0.8,
    "r6mPct": 16.1,
    "r12mPct": 32.5,
    "high52wCad": 968.04,
    "low52wCad": 611.67
  },
  "KO": {
    "r1dPct": -0.1,
    "r5dPct": 1.8,
    "r1mPct": 6.2,
    "r3mPct": 11.1,
    "r6mPct": 21.1,
    "r12mPct": 37.1,
    "high52wCad": 137.62,
    "low52wCad": 94.1
  },
  "WMT": {
    "r1dPct": 0.4,
    "r5dPct": -1.2,
    "r1mPct": 8.6,
    "r3mPct": 9.5,
    "r6mPct": -4.7,
    "r12mPct": 23.1,
    "high52wCad": 189.08,
    "low52wCad": 138.32
  },
  "GE": {
    "r1dPct": -3.5,
    "r5dPct": 5.1,
    "r1mPct": 7.8,
    "r3mPct": -10.2,
    "r6mPct": 13.5,
    "r12mPct": 8.8,
    "high52wCad": 543.95,
    "low52wCad": 376.18
  },
  "CAT": {
    "r1dPct": 0.6,
    "r5dPct": 9.3,
    "r1mPct": -19.2,
    "r3mPct": -29.3,
    "r6mPct": -34.2,
    "r12mPct": 9.3,
    "high52wCad": 1501.66,
    "low52wCad": 751.32
  },
  "ETN": {
    "r1dPct": -0.4,
    "r5dPct": 9.8,
    "r1mPct": -12.2,
    "r3mPct": -20.5,
    "r6mPct": -12,
    "r12mPct": 1.4,
    "high52wCad": 668.67,
    "low52wCad": 436.34
  },
  "RHMDE": {
    "r1dPct": -1.5,
    "r5dPct": -6.3,
    "r1mPct": -25.8,
    "r3mPct": -37.3,
    "r6mPct": -37.1,
    "r12mPct": -56.5,
    "high52wCad": 3087.21,
    "low52wCad": 1165.95
  },
  "BLK": {
    "r1dPct": -0.8,
    "r5dPct": 3.9,
    "r1mPct": 13.3,
    "r3mPct": 3.7,
    "r6mPct": 10.2,
    "r12mPct": 13.7,
    "high52wCad": 1737.6,
    "low52wCad": 1283.34
  },
  "SOL": {
    "r1dPct": -0.3,
    "r5dPct": -4.6,
    "r1mPct": -19.3,
    "r3mPct": -18.2,
    "r6mPct": 5,
    "r12mPct": -43,
    "high52wCad": 205.6,
    "low52wCad": 84.17
  },
  "AZN": {
    "r1dPct": -0.6,
    "r5dPct": -1.3,
    "r1mPct": 13.8,
    "r3mPct": 17.9,
    "r6mPct": -0.3,
    "r12mPct": 4,
    "high52wCad": 297.56,
    "low52wCad": 214.61
  },
  "AAVE": {
    "r1dPct": 0.4,
    "r5dPct": -8.2,
    "r1mPct": -19.1,
    "r3mPct": -5.7,
    "r6mPct": 20.3,
    "r12mPct": -41.7,
    "high52wCad": 285.09,
    "low52wCad": 80.87
  },
  "LINK": {
    "r1dPct": -0.3,
    "r5dPct": -1.8,
    "r1mPct": -12.9,
    "r3mPct": -9.9,
    "r6mPct": 27.6,
    "r12mPct": -29.7,
    "high52wCad": 22.33,
    "low52wCad": 9.79
  },
  "NESN": {
    "r1dPct": 0.6,
    "r5dPct": 1.5,
    "r1mPct": 7.4,
    "r3mPct": 10,
    "r6mPct": 10.8,
    "r12mPct": 7.4,
    "high52wCad": 150.1,
    "low52wCad": 120.52
  },
  "SUI": {
    "r1dPct": 1.6,
    "r5dPct": -0.2,
    "r1mPct": -14.8,
    "r3mPct": 12.8,
    "r6mPct": 10.8,
    "r12mPct": -56.4,
    "high52wCad": 2.8015,
    "low52wCad": 0.8943
  },
  "ADA": {
    "r1dPct": -0.3,
    "r5dPct": 0.3,
    "r1mPct": -16,
    "r3mPct": -13.4,
    "r6mPct": 4.9,
    "r12mPct": -66.8,
    "high52wCad": 0.7468,
    "low52wCad": 0.197
  },
  "MELI": {
    "r1dPct": -2.4,
    "r5dPct": -3.6,
    "r1mPct": -19.8,
    "r3mPct": -20,
    "r6mPct": -8.2,
    "r12mPct": -27.4,
    "high52wCad": 3276.22,
    "low52wCad": 2049.47
  },
  "RACE": {
    "r1dPct": -2.5,
    "r5dPct": -4,
    "r1mPct": 4.7,
    "r3mPct": -2.3,
    "r6mPct": 22.1,
    "r12mPct": -2.9,
    "high52wCad": 611.53,
    "low52wCad": 437.17
  },
  "SONY": {
    "r1dPct": 0.6,
    "r5dPct": -3.2,
    "r1mPct": 9.4,
    "r3mPct": 9.8,
    "r6mPct": 20.5,
    "r12mPct": -9.4,
    "high52wCad": 42.43,
    "low52wCad": 27.03
  },
  "BNB": {
    "r1dPct": -2,
    "r5dPct": -4.9,
    "r1mPct": -11.3,
    "r3mPct": -9,
    "r6mPct": 12.5,
    "r12mPct": -29.6,
    "high52wCad": 1330.17,
    "low52wCad": 765.68
  },
  "TAO": {
    "r1dPct": 1.1,
    "r5dPct": -0.9,
    "r1mPct": -15.9,
    "r3mPct": -9,
    "r6mPct": 0.6,
    "r12mPct": -37.2,
    "high52wCad": 525.09,
    "low52wCad": 201.67
  },
  "AVAX": {
    "r1dPct": 2.5,
    "r5dPct": 9.2,
    "r1mPct": -3.7,
    "r3mPct": 18.1,
    "r6mPct": 27.8,
    "r12mPct": -46.2,
    "high52wCad": 22.69,
    "low52wCad": 8.07
  },
  "XRP": {
    "r1dPct": -0.7,
    "r5dPct": -6.1,
    "r1mPct": -18.7,
    "r3mPct": -21.6,
    "r6mPct": -5.9,
    "r12mPct": -55,
    "high52wCad": 3.3183,
    "low52wCad": 1.3708
  },
  "RNDR": {
    "r1dPct": 1.5,
    "r5dPct": 1.3,
    "r1mPct": -10.8,
    "r3mPct": 11.1,
    "r6mPct": -1.5,
    "r12mPct": -33.9,
    "high52wCad": 3.78,
    "low52wCad": 1.6
  },
  "XEQT": {
    "r1dPct": -0.6,
    "r5dPct": 3.7,
    "r1mPct": -0.1,
    "r3mPct": -1.7,
    "r6mPct": 4.8,
    "r12mPct": 13.5,
    "high52wCad": 46.48,
    "low52wCad": 38.6
  },
  "DOGE": {
    "r1dPct": -0.6,
    "r5dPct": -3.1,
    "r1mPct": -14.4,
    "r3mPct": -19.4,
    "r6mPct": -10.3,
    "r12mPct": -59.2,
    "high52wCad": 0.2326,
    "low52wCad": 0.0901
  },
  "DOT": {
    "r1dPct": 1,
    "r5dPct": -1.1,
    "r1mPct": -20.9,
    "r3mPct": -16.7,
    "r6mPct": -3.4,
    "r12mPct": -70.1,
    "high52wCad": 4.134,
    "low52wCad": 1.0092
  },
  "QQQ": {
    "r1dPct": -0.3,
    "r5dPct": 6.4,
    "r1mPct": -5.6,
    "r3mPct": -5.9,
    "r6mPct": -4.4,
    "r12mPct": 13.1,
    "high52wCad": 1067.16,
    "low52wCad": 777.23
  },
  "VFV": {
    "r1dPct": -0.3,
    "r5dPct": 5.1,
    "r1mPct": -1.4,
    "r3mPct": -0.3,
    "r6mPct": 6.1,
    "r12mPct": 12.8,
    "high52wCad": 197.83,
    "low52wCad": 155.95
  },
  "SCHD": {
    "r1dPct": -0.2,
    "r5dPct": 1.4,
    "r1mPct": 6.6,
    "r3mPct": 4.1,
    "r6mPct": 13,
    "r12mPct": 32,
    "high52wCad": 50.89,
    "low52wCad": 37.21
  },
  "VDY": {
    "r1dPct": -0.2,
    "r5dPct": 2,
    "r1mPct": 2.2,
    "r3mPct": -0.1,
    "r6mPct": 10.2,
    "r12mPct": 31.1,
    "high52wCad": 79.76,
    "low52wCad": 58.73
  },
  "ARB": {
    "r1dPct": -1.6,
    "r5dPct": -10.4,
    "r1mPct": -13.6,
    "r3mPct": 6.4,
    "r6mPct": 59.8,
    "r12mPct": -39.7,
    "high52wCad": 0.3561,
    "low52wCad": 0.0989
  },
  "ZAG": {
    "r1dPct": -0.5,
    "r5dPct": -0.7,
    "r1mPct": 0.4,
    "r3mPct": -1,
    "r6mPct": -1.2,
    "r12mPct": -3.6,
    "high52wCad": 14.04,
    "low52wCad": 13.28
  },
  "NEAR": {
    "r1dPct": 4.6,
    "r5dPct": 0.1,
    "r1mPct": -23.7,
    "r3mPct": 51,
    "r6mPct": 88.9,
    "r12mPct": 45.7,
    "high52wCad": 8.34,
    "low52wCad": 1.21
  },
  "UNI": {
    "r1dPct": -1.8,
    "r5dPct": -12.2,
    "r1mPct": -14.5,
    "r3mPct": -0.8,
    "r6mPct": 68.7,
    "r12mPct": -23.3,
    "high52wCad": 15.22,
    "low52wCad": 3.26
  },
  "XIU": {
    "r1dPct": -0.5,
    "r5dPct": 1.8,
    "r1mPct": 2.3,
    "r3mPct": -0.6,
    "r6mPct": 9.4,
    "r12mPct": 18.6,
    "high52wCad": 55,
    "low52wCad": 44.45
  },
  "TLT": {
    "r1dPct": -1.5,
    "r5dPct": -2.7,
    "r1mPct": 1.1,
    "r3mPct": -2.8,
    "r6mPct": -6.1,
    "r12mPct": -10.8,
    "high52wCad": 127.1,
    "low52wCad": 106.92
  },
  "SLV": {
    "r1dPct": -3.3,
    "r5dPct": -3.9,
    "r1mPct": -10.2,
    "r3mPct": -22.8,
    "r6mPct": -40.2,
    "r12mPct": -4.9,
    "high52wCad": 153.64,
    "low52wCad": 61.71
  },
  "CRWD": {
    "r1dPct": 0.4,
    "r5dPct": 5.8,
    "r1mPct": -7.8,
    "r3mPct": 6,
    "r6mPct": 58.5,
    "r12mPct": 73.6,
    "high52wCad": 401.47,
    "low52wCad": 119.86
  },
  "HURA": {
    "r1dPct": -3.7,
    "r5dPct": 5.5,
    "r1mPct": -6.1,
    "r3mPct": -24.2,
    "r6mPct": -32.8,
    "r12mPct": -28.9,
    "high52wCad": 73.95,
    "low52wCad": 36.76
  },
  "XRE": {
    "r1dPct": -0.6,
    "r5dPct": -2.1,
    "r1mPct": 0.2,
    "r3mPct": -6.6,
    "r6mPct": -4.7,
    "r12mPct": -1.5,
    "high52wCad": 17.54,
    "low52wCad": 14.9
  },
  "TRP": {
    "r1dPct": 0.5,
    "r5dPct": 4.9,
    "r1mPct": 5.7,
    "r3mPct": 4.6,
    "r6mPct": 0.1,
    "r12mPct": 20,
    "high52wCad": 100.18,
    "low52wCad": 72.97
  },
  "SUTO": {
    "r1dPct": 0.6,
    "r5dPct": 2.1,
    "r1mPct": -8.4,
    "r3mPct": 8.3,
    "r6mPct": 9.1,
    "r12mPct": 59.6,
    "high52wCad": 112.8,
    "low52wCad": 57.95
  },
  "PLD": {
    "r1dPct": -1.1,
    "r5dPct": 0,
    "r1mPct": -1.5,
    "r3mPct": -8.8,
    "r6mPct": -9.9,
    "r12mPct": 3.7,
    "high52wCad": 214.52,
    "low52wCad": 169.83
  },
  "CM": {
    "r1dPct": -0.3,
    "r5dPct": 2.2,
    "r1mPct": 5.2,
    "r3mPct": -2.9,
    "r6mPct": 9.7,
    "r12mPct": 35.8,
    "high52wCad": 172.87,
    "low52wCad": 116.65
  },
  "GIBA": {
    "r1dPct": 1,
    "r5dPct": 1.1,
    "r1mPct": 13.5,
    "r3mPct": 12.3,
    "r6mPct": 37.4,
    "r12mPct": -4.7,
    "high52wCad": 131.97,
    "low52wCad": 83.34
  },
  "TIP": {
    "r1dPct": -0.5,
    "r5dPct": -1.4,
    "r1mPct": 0,
    "r3mPct": -2.1,
    "r6mPct": -5.6,
    "r12mPct": -5.5,
    "high52wCad": 156.65,
    "low52wCad": 145.15
  },
  "MU": {
    "r1dPct": -1.6,
    "r5dPct": 21.6,
    "r1mPct": -12.7,
    "r3mPct": -17.8,
    "r6mPct": 2.9,
    "r12mPct": 237,
    "high52wCad": 1755.62,
    "low52wCad": 269.41
  },
  "AMAT": {
    "r1dPct": -3.6,
    "r5dPct": 19.3,
    "r1mPct": -14.7,
    "r3mPct": -24.9,
    "r6mPct": -13.5,
    "r12mPct": 70.7,
    "high52wCad": 1034.72,
    "low52wCad": 284.54
  },
  "COPX": {
    "r1dPct": -3.3,
    "r5dPct": 1.1,
    "r1mPct": -12.1,
    "r3mPct": -17.1,
    "r6mPct": -20.6,
    "r12mPct": 15,
    "high52wCad": 139.88,
    "low52wCad": 79.64
  },
  "O": {
    "r1dPct": -0.5,
    "r5dPct": -0.4,
    "r1mPct": 7.4,
    "r3mPct": -5.5,
    "r6mPct": -4.4,
    "r12mPct": 4.7,
    "high52wCad": 95.04,
    "low52wCad": 74.35
  },
  "ZEB": {
    "r1dPct": -0.4,
    "r5dPct": 1.9,
    "r1mPct": 5.4,
    "r3mPct": -1.4,
    "r6mPct": 16.6,
    "r12mPct": 40,
    "high52wCad": 78.82,
    "low52wCad": 53.7
  },
  "MSTR": {
    "r1dPct": -6.5,
    "r5dPct": -11.5,
    "r1mPct": -20.1,
    "r3mPct": 23,
    "r6mPct": -38.8,
    "r12mPct": -45.1,
    "high52wCad": 299.13,
    "low52wCad": 114.44
  },
  "GS": {
    "r1dPct": -1.4,
    "r5dPct": 5.1,
    "r1mPct": 4,
    "r3mPct": -12.1,
    "r6mPct": -5.7,
    "r12mPct": 13.4,
    "high52wCad": 1614.32,
    "low52wCad": 1054.77
  },
  "TMO": {
    "r1dPct": -2.5,
    "r5dPct": 3.3,
    "r1mPct": 3.9,
    "r3mPct": 18.9,
    "r6mPct": 56.1,
    "r12mPct": 20.6,
    "high52wCad": 1017.78,
    "low52wCad": 608.9
  },
  "TEC": {
    "r1dPct": -0.2,
    "r5dPct": 6.7,
    "r1mPct": -6.5,
    "r3mPct": -3.8,
    "r6mPct": 1.3,
    "r12mPct": 9.9,
    "high52wCad": 66.99,
    "low52wCad": 46.13
  },
  "HYG": {
    "r1dPct": -0.5,
    "r5dPct": -0.4,
    "r1mPct": 0.2,
    "r3mPct": -3.4,
    "r6mPct": -3.6,
    "r12mPct": -4,
    "high52wCad": 113.65,
    "low52wCad": 106.86
  },
  "CVX": {
    "r1dPct": 1.4,
    "r5dPct": 1.6,
    "r1mPct": -2.6,
    "r3mPct": 8.2,
    "r6mPct": 15.9,
    "r12mPct": 39.1,
    "high52wCad": 330.81,
    "low52wCad": 204.92
  }
};

export const VERIFIED_MONTHLY_CLOSES_CAD: Record<string, Record<string, number>> = {"XBB":{"2023-11":704.81,"2023-12":732.36,"2024-01":759.33,"2024-02":786.72,"2024-03":770.87,"2024-04":780.44,"2024-05":819.11,"2024-06":820.55,"2024-07":818.15,"2024-08":829.15,"2024-09":839.2,"2024-10":901.37,"2024-11":895.78,"2024-12":929.84,"2025-01":905.39,"2025-02":833.55,"2025-03":801.12,"2025-04":852.73,"2025-05":858.59,"2025-06":899.84,"2025-07":896.53,"2025-08":918.74,"2025-09":956.9,"2025-10":954.26,"2025-11":955.04,"2025-12":959.63,"2026-01":971.11,"2026-02":925.27,"2026-03":1000.54,"2026-04":1055.24,"2026-05":1069.74,"2026-06":1061.38,"2026-07":1082.75,"2026-08":1102.49,"2026-09":1107.08,"2026-10":1115.65,"2026-11":1123.46},"MEUD":{"2024-02":367.94,"2024-03":364.17,"2024-04":377.01,"2024-05":372.55,"2024-06":377.8,"2024-07":383.48,"2024-08":382.62,"2024-09":369.81,"2024-10":374.19,"2024-11":374.45,"2024-12":396.2,"2025-01":409.91,"2025-02":394.35,"2025-03":391.82,"2025-04":411.5,"2025-05":406.43,"2025-06":410.48,"2025-07":414.5,"2025-08":420.86,"2025-09":431.66,"2025-10":435.55,"2025-11":447.63,"2025-12":462.61,"2026-01":480.09,"2026-02":444.11,"2026-03":468.11,"2026-04":482.32,"2026-05":495.04,"2026-06":501.55,"2026-07":503.12,"2026-08":492.13,"2026-09":501.4,"2026-10":496.03,"2026-11":515.37},"ADP":{"2023-12":69.28,"2024-01":86.07,"2024-02":110.67,"2024-03":126.4,"2024-04":120.87,"2024-05":153.37,"2024-06":172.82,"2024-07":163.7,"2024-08":166.99,"2024-09":169.88,"2024-10":185.72,"2024-11":193.4,"2024-12":187.86,"2025-01":167.97,"2025-02":174.75,"2025-03":151.61,"2025-04":152.37,"2025-05":189.03,"2025-06":221.01,"2025-07":248.82,"2025-08":243.66,"2025-09":261.01,"2025-10":283.26,"2025-11":247.61,"2025-12":260.89,"2026-01":267.37,"2026-02":247.87,"2026-03":243.97,"2026-04":279.18,"2026-05":295.36,"2026-06":279.91,"2026-07":280.83,"2026-08":308.85,"2026-09":319.48,"2026-10":309.56,"2026-11":232.48},"BTC":{"2023-12":56001.16,"2024-01":57198.19,"2024-02":83037.27,"2024-03":96460.5,"2024-04":83544.25,"2024-05":92071.76,"2024-06":85711,"2024-07":89229.04,"2024-08":79594.62,"2024-09":85657.9,"2024-10":97844.51,"2024-11":135149.23,"2024-12":134469.09,"2025-01":148922.52,"2025-02":122058.22,"2025-03":118811.58,"2025-04":129949.09,"2025-05":143777.97,"2025-06":145776.48,"2025-07":160423.39,"2025-08":148713.56,"2025-09":158814.31,"2025-10":153964.75,"2025-11":126285.82,"2025-12":120107.79,"2026-01":107117.34,"2026-02":91439.3,"2026-03":94871.6,"2026-04":103623.17,"2026-05":101522.38,"2026-06":83197.91,"2026-07":88137.11,"2026-08":108809.26,"2026-09":118949.77,"2026-10":113576.5,"2026-11":99038.71},"ASML":{"2023-11":1070.47,"2023-12":1253.41,"2024-01":1366.95,"2024-02":1401.02,"2024-03":1307.59,"2024-04":1367.42,"2024-05":1514.08,"2024-06":1335.54,"2024-07":1275.08,"2024-08":1170.82,"2024-09":975.47,"2024-10":1033.89,"2024-11":1065.76,"2024-12":1134.86,"2025-01":1065.61,"2025-02":951.6,"2025-03":914.7,"2025-04":1026.82,"2025-05":1064.04,"2025-06":962.75,"2025-07":999.65,"2025-08":1300.37,"2025-09":1441.69,"2025-10":1418.61,"2025-11":1446.87,"2025-12":1908.86,"2026-01":1936.81,"2026-02":1757.48,"2026-03":1919.53,"2026-04":2174.55,"2026-05":2703.11,"2026-06":2252.12,"2026-07":2279.76,"2026-08":2507.46,"2026-09":2218.52,"2026-10":2300.4,"2026-11":2132.47},"MC":{"2023-11":1151.97,"2023-12":1214.78,"2024-01":1323.45,"2024-02":1309.16,"2024-03":1216.04,"2024-04":1154.01,"2024-05":1120.57,"2024-06":1025.41,"2024-07":1058.85,"2024-08":1081.15,"2024-09":957.57,"2024-10":930.4,"2024-11":997.93,"2024-12":1104.71,"2025-01":1091.2,"2025-02":897.74,"2025-03":766.15,"2025-04":751,"2025-05":698.16,"2025-06":741.73,"2025-07":791.59,"2025-08":817.34,"2025-09":961.18,"2025-10":997.93,"2025-11":1012.84,"2025-12":858.8,"2026-01":854.4,"2026-02":727.21,"2026-03":708.83,"2026-04":742.83,"2026-05":760.18,"2026-06":746.13,"2026-07":711.82,"2026-08":612.42,"2026-09":607.71,"2026-10":625.64,"2026-11":634.4},"CORP":{"2023-12":154.8,"2024-01":154.12,"2024-02":150.61,"2024-03":152.37,"2024-04":146.87,"2024-05":149.53,"2024-06":149.85,"2024-07":153.26,"2024-08":155.57,"2024-09":158.05,"2024-10":152.47,"2024-11":154.65,"2024-12":149.46,"2025-01":150.33,"2025-02":153.33,"2025-03":152.05,"2025-04":151.05,"2025-05":150.76,"2025-06":153.33,"2025-07":152.63,"2025-08":153.6,"2025-09":155.94,"2025-10":155.6,"2025-11":156.48,"2025-12":154.14,"2026-01":154.68,"2026-02":156.23,"2026-03":152.47,"2026-04":152.27,"2026-05":152.98,"2026-06":152.58,"2026-07":148.63,"2026-08":148.58,"2026-09":142.94,"2026-10":143.59,"2026-11":144.16},"GOLD":{"2023-12":267.43,"2024-01":263.62,"2024-02":264.83,"2024-03":287.78,"2024-04":296.38,"2024-05":301.18,"2024-06":300.78,"2024-07":316.92,"2024-08":323.55,"2024-09":340.02,"2024-10":354.64,"2024-11":343.56,"2024-12":338.72,"2025-01":361.7,"2025-02":368.29,"2025-03":403.08,"2025-04":424.94,"2025-05":424.71,"2025-06":426.43,"2025-07":423.81,"2025-08":444.95,"2025-09":497.27,"2025-10":514.96,"2025-11":542.61,"2025-12":554.4,"2026-01":622.44,"2026-02":676.72,"2026-03":601.93,"2026-04":592.66,"2026-05":583.51,"2026-06":515.33,"2026-07":519.75,"2026-08":571.34,"2026-09":532.76,"2026-10":525.91,"2026-11":496.46},"ESE":{"2023-11":33.54,"2023-12":35.1,"2024-01":36.66,"2024-02":37.98,"2024-03":37.17,"2024-04":37.57,"2024-05":40.2,"2024-06":40.04,"2024-07":39.71,"2024-08":40.41,"2024-09":41.45,"2024-10":44.99,"2024-11":44.84,"2024-12":46.24,"2025-01":44.52,"2025-02":40.47,"2025-03":38.32,"2025-04":40.93,"2025-05":41.55,"2025-06":44.09,"2025-07":43.59,"2025-08":44.84,"2025-09":46.91,"2025-10":46.67,"2025-11":46.44,"2025-12":46.22,"2026-01":46.12,"2026-02":44.31,"2026-03":48.51,"2026-04":51.61,"2026-05":52.07,"2026-06":51.38,"2026-07":52.56,"2026-08":54.07,"2026-09":54.21,"2026-10":54.89,"2026-11":55},"SU":{"2023-11":285.45,"2023-12":287.21,"2024-01":329.45,"2024-02":329.21,"2024-03":337.77,"2024-04":357.16,"2024-05":352.22,"2024-06":349.94,"2024-07":360.7,"2024-08":370.9,"2024-09":372.48,"2024-10":382.37,"2024-11":378.29,"2024-12":385.27,"2025-01":367.37,"2025-02":330.94,"2025-03":320.66,"2025-04":347.59,"2025-05":354.57,"2025-06":358.42,"2025-07":329.84,"2025-08":373.1,"2025-09":386.45,"2025-10":362.74,"2025-11":368.86,"2025-12":380.48,"2026-01":434.5,"2026-02":359.76,"2026-03":421.78,"2026-04":423.9,"2026-05":448.16,"2026-06":454.76,"2026-07":462.61,"2026-08":458.53,"2026-09":372.95,"2026-10":404.94,"2026-11":383.07},"ODFL":{"2023-11":250.4,"2023-12":272.32,"2024-01":304.17,"2024-02":329.84,"2024-03":320.66,"2024-04":336.2,"2024-05":309.98,"2024-06":318.93,"2024-07":310.84,"2024-08":331.49,"2024-09":326.31,"2024-10":346.25,"2024-11":333.06,"2024-12":376.71,"2025-01":392.73,"2025-02":380.01,"2025-03":365.88,"2025-04":410.48,"2025-05":433.25,"2025-06":454.6,"2025-07":447.38,"2025-08":471.25,"2025-09":483.5,"2025-10":455.86,"2025-11":467.01,"2025-12":472.66,"2026-01":533.9,"2026-02":438.74,"2026-03":428.69,"2026-04":480.04,"2026-05":541.75,"2026-06":531.39,"2026-07":529.19,"2026-08":525.11,"2026-09":432.93,"2026-10":497.67,"2026-11":482.24},"RMS":{"2023-11":3013.09,"2023-12":3074.33,"2024-01":3632.1,"2024-02":3715.33,"2024-03":3534.75,"2024-04":3416.97,"2024-05":3360.44,"2024-06":3176.72,"2024-07":3405.98,"2024-08":3464.08,"2024-09":3256.8,"2024-10":3242.67,"2024-11":3646.24,"2024-12":4277.5,"2025-01":4297.91,"2025-02":3785.99,"2025-03":3754.59,"2025-04":3812.69,"2025-05":3610.12,"2025-06":3377.72,"2025-07":3283.5,"2025-08":3270.93,"2025-09":3374.57,"2025-10":3297.63,"2025-11":3332.18,"2025-12":3186.14,"2026-01":3217.54,"2026-02":2526.61,"2026-03":2549.38,"2026-04":2543.89,"2026-05":2509.34,"2026-06":2404.91,"2026-07":2482.64,"2026-08":2098.71,"2026-09":2031.18,"2026-10":2101.01,"2026-11":2113.62},"GOVT":{"2023-12":134.84,"2024-01":134.94,"2024-02":131.8,"2024-03":132.42,"2024-04":127.9,"2024-05":129.82,"2024-06":131.01,"2024-07":134.39,"2024-08":135.79,"2024-09":137.26,"2024-10":132.22,"2024-11":133.16,"2024-12":129.33,"2025-01":130.13,"2025-02":133.34,"2025-03":133.41,"2025-04":134.39,"2025-05":132.29,"2025-06":133.97,"2025-07":132.76,"2025-08":134.5,"2025-09":134.94,"2025-10":135.48,"2025-11":136.39,"2025-12":134.52,"2026-01":134.21,"2026-02":137.08,"2026-03":133.51,"2026-04":132.87,"2026-05":132.41,"2026-06":132.29,"2026-07":130.03,"2026-08":129.73,"2026-09":124.94,"2026-10":125.44,"2026-11":126.19},"ETH":{"2023-12":3022.94,"2024-01":3065.98,"2024-02":4534.5,"2024-03":4932.79,"2024-04":4150.27,"2024-05":5129.56,"2024-06":4694.39,"2024-07":4461.91,"2024-08":3392.45,"2024-09":3520.84,"2024-10":3505.75,"2024-11":5192.62,"2024-12":4796.39,"2025-01":4796.5,"2025-02":3237.47,"2025-03":2624.51,"2025-04":2474.32,"2025-05":3475.09,"2025-06":3383.27,"2025-07":5123.08,"2025-08":6031.74,"2025-09":5772.93,"2025-10":5406.49,"2025-11":4180.15,"2025-12":4072.32,"2026-01":3331.32,"2026-02":2682,"2026-03":2926.39,"2026-04":3064.05,"2026-05":2765.51,"2026-06":2230,"2026-07":2610.34,"2026-08":3417.16,"2026-09":3820.57,"2026-10":3337.21,"2026-11":2803.26},"STLAP":{"2023-11":33.2,"2023-12":32.18,"2024-01":37.89,"2024-02":41.34,"2024-03":32.79,"2024-04":31.76,"2024-05":29.01,"2024-06":24.2,"2024-07":23.78,"2024-08":19.47,"2024-09":19.79,"2024-10":19.67,"2024-11":19.85,"2024-12":20.35,"2025-01":19.42,"2025-02":16.13,"2025-03":12.79,"2025-04":14.07,"2025-05":13.36,"2025-06":12.19,"2025-07":12.84,"2025-08":12.36,"2025-09":13.78,"2025-10":14.45,"2025-11":14.76,"2025-12":13.01,"2026-01":10.89,"2026-02":9.53,"2026-03":9.76,"2026-04":10.77,"2026-05":7.82,"2026-06":7.81,"2026-07":7.48,"2026-08":6.12,"2026-09":6.5,"2026-10":6.1,"2026-11":5.59},"OR":{"2023-11":707.66,"2023-12":698.31,"2024-01":693.6,"2024-02":688.81,"2024-03":690.38,"2024-04":709.93,"2024-05":643.9,"2024-06":629.14,"2024-07":622.78,"2024-08":631.34,"2024-09":540.58,"2024-10":516.08,"2024-11":536.81,"2024-12":562.95,"2025-01":554.32,"2025-02":538.38,"2025-03":607.71,"2025-04":584.78,"2025-05":570.18,"2025-06":611.4,"2025-07":624.82,"2025-08":578.66,"2025-09":569.47,"2025-10":589.8,"2025-11":575.67,"2025-12":607.71,"2026-01":624.04,"2026-02":548.58,"2026-03":574.81,"2026-04":600.72,"2026-05":602.45,"2026-06":607.63,"2026-07":604.09,"2026-08":595.85,"2026-09":686.14,"2026-10":639.14,"2026-11":705.61},"DG":{"2023-11":178.54,"2023-12":183.85,"2024-01":185.92,"2024-02":186.49,"2024-03":173.13,"2024-04":179.72,"2024-05":154.49,"2024-06":165.82,"2024-07":169.83,"2024-08":164.8,"2024-09":161.27,"2024-10":156.81,"2024-11":156.62,"2024-12":164.1,"2025-01":174.46,"2025-02":182.63,"2025-03":192.52,"2025-04":197.62,"2025-05":196.44,"2025-06":190.95,"2025-07":182,"2025-08":185.22,"2025-09":182,"2025-10":191.97,"2025-11":188.51,"2025-12":190.24,"2026-01":221.02,"2026-02":201.55,"2026-03":201.78,"2026-04":196.37,"2026-05":200.68,"2026-06":192.44,"2026-07":177.68,"2026-08":167.94,"2026-09":170.53,"2026-10":168.98,"2026-11":180.98},"KER":{"2023-11":626.55,"2023-12":601.82,"2024-01":667.46,"2024-02":575.28,"2024-03":518.2,"2024-04":498.1,"2024-05":531.55,"2024-06":446.75,"2024-07":406.71,"2024-08":403.33,"2024-09":359.36,"2024-10":346.64,"2024-11":374.12,"2024-12":397.99,"2025-01":425.71,"2025-02":299.8,"2025-03":280.05,"2025-04":270.66,"2025-05":289.81,"2025-06":339.97,"2025-07":359.83,"2025-08":443.69,"2025-09":481.77,"2025-10":459.78,"2025-11":472.66,"2025-12":414.79,"2026-01":448.95,"2026-02":402.94,"2026-03":365.33,"2026-04":400.98,"2026-05":388.34,"2026-06":446.28,"2026-07":398.93,"2026-08":350.81,"2026-09":278.67,"2026-10":339.03,"2026-11":291.23},"CS":{"2023-11":46.31,"2023-12":48.93,"2024-01":51.63,"2024-02":54.67,"2024-03":50.94,"2024-04":51.9,"2024-05":48,"2024-06":51.02,"2024-07":54.02,"2024-08":54.22,"2024-09":54.21,"2024-10":51.79,"2024-11":53.89,"2024-12":57.55,"2025-01":58.79,"2025-02":61.87,"2025-03":65.28,"2025-04":65.18,"2025-05":65.43,"2025-06":67.02,"2025-07":62.48,"2025-08":63.82,"2025-09":59.09,"2025-10":61.08,"2025-11":64.32,"2025-12":60.35,"2026-01":65.1,"2026-02":61.62,"2026-03":64.29,"2026-04":62.39,"2026-05":68.86,"2026-06":70.57,"2026-07":67.68,"2026-08":66.8,"2026-09":66.89,"2026-10":67.28,"2026-11":73.4},"SAP":{"2023-11":219.03,"2023-12":252.5,"2024-01":271.47,"2024-02":283.38,"2024-03":266.48,"2024-04":260.61,"2024-05":297.6,"2024-06":306.24,"2024-07":310.48,"2024-08":320.97,"2024-09":337.3,"2024-10":353.16,"2024-11":371.06,"2024-12":421.63,"2025-01":416.6,"2025-02":383.78,"2025-03":400.9,"2025-04":417.54,"2025-05":405.37,"2025-06":393.83,"2025-07":363.84,"2025-08":357.87,"2025-09":352.45,"2025-10":327.49,"2025-11":327.17,"2025-12":267.83,"2026-01":268.46,"2026-02":230.68,"2026-03":228.48,"2026-04":243.8,"2026-05":210.42,"2026-06":247.6,"2026-07":299.77,"2026-08":291.54,"2026-09":331.73,"2026-10":316.05,"2026-11":336.91},"NOVO":{"2023-11":146.95,"2023-12":163.1,"2024-01":172.55,"2024-02":185.51,"2024-03":190,"2024-04":195.2,"2024-05":211.68,"2024-06":191.98,"2024-07":197.47,"2024-08":165.62,"2024-09":160.63,"2024-10":159.41,"2024-11":131.39,"2024-12":127.84,"2025-01":135.67,"2025-02":98.89,"2025-03":91.59,"2025-04":95.49,"2025-05":92.54,"2025-06":66.2,"2025-07":75.53,"2025-08":72.55,"2025-09":66.51,"2025-10":66.73,"2025-11":68.47,"2025-12":77.79,"2026-01":50.08,"2026-02":48.6,"2026-03":57.31,"2026-04":61.67,"2026-05":66.22,"2026-06":64.52,"2026-07":61.55,"2026-08":53.3,"2026-09":56.01,"2026-10":55.46,"2026-11":58.34},"BNP":{"2023-11":98.29,"2023-12":98.22,"2024-01":86.96,"2024-02":103.42,"2024-03":106.17,"2024-04":106.31,"2024-05":93.48,"2024-06":99.65,"2024-07":98.27,"2024-08":96.65,"2024-09":98.54,"2024-10":88.94,"2024-11":92.99,"2024-12":103.2,"2025-01":114.41,"2025-02":120.77,"2025-03":116.66,"2025-04":121.13,"2025-05":119.85,"2025-06":125.72,"2025-07":120.65,"2025-08":121.43,"2025-09":105.3,"2025-10":115.72,"2025-11":126.86,"2025-12":143.21,"2026-01":149.96,"2026-02":127.18,"2026-03":140.12,"2026-04":145.96,"2026-05":160.39,"2026-06":172.2,"2026-07":161.4,"2026-08":149.18,"2026-09":134.5,"2026-10":139.69,"2026-11":150.17},"AIR":{"2023-11":219.5,"2023-12":232.09,"2024-01":240.16,"2024-02":268.08,"2024-03":242.89,"2024-04":244.81,"2024-05":201.41,"2024-06":219.78,"2024-07":217.99,"2024-08":206.05,"2024-09":220.09,"2024-10":231.71,"2024-11":243.05,"2024-12":262.43,"2025-01":260.2,"2025-02":255.61,"2025-03":231.05,"2025-04":254.51,"2025-05":278.35,"2025-06":276.44,"2025-07":281.18,"2025-08":309.98,"2025-09":335.1,"2025-10":321.05,"2025-11":311.55,"2025-12":303.7,"2026-01":289.31,"2026-02":252.54,"2026-03":274.61,"2026-04":282.18,"2026-05":305.49,"2026-06":317.51,"2026-07":309.73,"2026-08":299.33,"2026-09":302.13,"2026-10":305.9,"2026-11":323.64},"CAP":{"2023-11":296.39,"2023-12":325.37,"2024-01":352.85,"2024-02":334.94,"2024-03":310.76,"2024-04":291.45,"2024-05":291.6,"2024-06":288.31,"2024-07":294.43,"2024-08":304.56,"2024-09":249.99,"2024-10":238.53,"2024-11":248.34,"2024-12":276.29,"2025-01":234.21,"2025-02":216.78,"2025-03":219.61,"2025-04":229.66,"2025-05":227.77,"2025-06":205.55,"2025-07":190.71,"2025-08":194.01,"2025-09":209.64,"2025-10":211.68,"2025-11":223.38,"2025-12":206.02,"2026-01":167.94,"2026-02":157.82,"2026-03":161.74,"2026-04":160.09,"2026-05":138.12,"2026-06":160.96,"2026-07":168.41,"2026-08":163.94,"2026-09":200.45,"2026-10":191.73,"2026-11":198.25},"TEP":{"2023-11":207.36,"2023-12":228.71,"2024-01":179.88,"2024-02":141.45,"2024-03":134.23,"2024-04":163.94,"2024-05":154.42,"2024-06":187.18,"2024-07":155.24,"2024-08":146.04,"2024-09":152.16,"2024-10":139.79,"2024-11":130.52,"2024-12":142.33,"2025-01":145.5,"2025-02":145.22,"2025-03":151.47,"2025-04":139.82,"2025-05":129.27,"2025-06":134.61,"2025-07":103.51,"2025-08":99.46,"2025-09":97.3,"2025-10":93.02,"2025-11":97.11,"2025-12":85.74,"2026-01":80.84,"2026-02":78.95,"2026-03":90.36,"2026-04":98.99,"2026-05":72.2,"2026-06":108.35,"2026-07":109.45,"2026-08":110.27,"2026-09":126.1,"2026-10":119.89,"2026-11":113.06},"AI":{"2023-11":228.56,"2023-12":225.4,"2024-01":243.85,"2024-02":250.26,"2024-03":238.63,"2024-04":234.2,"2024-05":230.23,"2024-06":240.94,"2024-07":240.86,"2024-08":247.34,"2024-09":235.06,"2024-10":224.52,"2024-11":224.01,"2024-12":240.68,"2025-01":252.13,"2025-02":250.02,"2025-03":257.76,"2025-04":260.38,"2025-05":250.02,"2025-06":246.68,"2025-07":251.56,"2025-08":252.48,"2025-09":239.71,"2025-10":235.72,"2025-11":228.78,"2025-12":225.47,"2026-01":254.45,"2026-02":253.99,"2026-03":261.36,"2026-04":254.22,"2026-05":272.1,"2026-06":268.08,"2026-07":266.23,"2026-08":268.33,"2026-09":284.07,"2026-10":271.69,"2026-11":305.11},"SAN":{"2023-11":140.95,"2023-12":146.6,"2024-01":138.01,"2024-02":142.83,"2024-03":146.16,"2024-04":140.95,"2024-05":141.23,"2024-06":149.7,"2024-07":158.91,"2024-08":161.58,"2024-09":152.49,"2024-10":144.61,"2024-11":147.2,"2024-12":163.94,"2025-01":163.88,"2025-02":160.04,"2025-03":150.59,"2025-04":137.43,"2025-05":129.09,"2025-06":123.8,"2025-07":132.67,"2025-08":123.35,"2025-09":137.56,"2025-10":134.67,"2025-11":129.9,"2025-12":124.37,"2026-01":129.08,"2026-02":129.9,"2026-03":125.34,"2026-04":118.23,"2026-05":117.9,"2026-06":116.94,"2026-07":120.61,"2026-08":114.07,"2026-09":125.22,"2026-10":113.27,"2026-11":138.42},"TTE":{"2023-11":96.73,"2023-12":94.38,"2024-01":92.63,"2024-02":99.67,"2024-03":107.71,"2024-04":105.23,"2024-05":97.88,"2024-06":98.11,"2024-07":97.66,"2024-08":91.86,"2024-09":90.14,"2024-10":86.32,"2024-11":83.81,"2024-12":88.55,"2025-01":90.73,"2025-02":93.68,"2025-03":80.34,"2025-04":81.12,"2025-05":81.81,"2025-06":81.69,"2025-07":84.01,"2025-08":81.23,"2025-09":84.72,"2025-10":89.19,"2025-11":87.29,"2025-12":96.02,"2026-01":105.65,"2026-02":127.05,"2026-03":124.51,"2026-04":118.06,"2026-05":106.83,"2026-06":120,"2026-07":118.6,"2026-08":118.87,"2026-09":134.15,"2026-10":125.96,"2026-11":128.61},"GOOGL":{"2023-12":195.41,"2024-01":195.99,"2024-02":193.69,"2024-03":211.14,"2024-04":227.71,"2024-05":241.31,"2024-06":254.81,"2024-07":239.97,"2024-08":228.55,"2024-09":232.01,"2024-10":239.37,"2024-11":236.34,"2024-12":264.81,"2025-01":285.4,"2025-02":238.2,"2025-03":216.33,"2025-04":222.15,"2025-05":240.25,"2025-06":246.53,"2025-07":268.45,"2025-08":297.84,"2025-09":340.07,"2025-10":393.36,"2025-11":447.9,"2025-12":437.86,"2026-01":472.83,"2026-02":436.12,"2026-03":402.27,"2026-04":538.3,"2026-05":532.06,"2026-06":499.92,"2026-07":498.19,"2026-08":474.72,"2026-09":481.33,"2026-10":486.44,"2026-11":417.85},"COST":{"2023-12":923.39,"2024-01":972.07,"2024-02":1040.63,"2024-03":1024.88,"2024-04":1011.26,"2024-05":1132.96,"2024-06":1189.05,"2024-07":1149.9,"2024-08":1248.35,"2024-09":1240.15,"2024-10":1222.89,"2024-11":1359.56,"2024-12":1281.77,"2025-01":1370.75,"2025-02":1466.9,"2025-03":1323.05,"2025-04":1391.21,"2025-05":1455.11,"2025-06":1384.83,"2025-07":1314.46,"2025-08":1319.61,"2025-09":1294.86,"2025-10":1275.03,"2025-11":1278.02,"2025-12":1206.33,"2026-01":1315.32,"2026-02":1413.99,"2026-03":1393.91,"2026-04":1419.23,"2026-05":1337.8,"2026-06":1308.63,"2026-07":1331.6,"2026-08":1320.41,"2026-09":1273.47,"2026-10":1374,"2026-11":1527.89},"META":{"2023-12":495.15,"2024-01":545.77,"2024-02":685.64,"2024-03":679.28,"2024-04":601.76,"2024-05":653.05,"2024-06":705.35,"2024-07":664.24,"2024-08":729.26,"2024-09":800.79,"2024-10":793.99,"2024-11":803.42,"2024-12":819.07,"2025-01":964.09,"2025-02":934.74,"2025-03":806.27,"2025-04":768,"2025-05":905.77,"2025-06":1032.51,"2025-07":1081.97,"2025-08":1033.37,"2025-09":1027.32,"2025-10":906.98,"2025-11":906.42,"2025-12":923.4,"2026-01":1002.31,"2026-02":906.74,"2026-03":800.35,"2026-04":856,"2026-05":884.82,"2026-06":787.99,"2026-07":778.78,"2026-08":800.65,"2026-09":1014.45,"2026-10":1031.17,"2026-11":872.37},"TSLA":{"2023-12":347.6,"2024-01":262,"2024-02":282.41,"2024-03":245.91,"2024-04":256.39,"2024-05":249.12,"2024-06":276.81,"2024-07":324.64,"2024-08":299.52,"2024-09":365.99,"2024-10":349.52,"2024-11":482.84,"2024-12":564.93,"2025-01":565.99,"2025-02":409.85,"2025-03":362.54,"2025-04":394.71,"2025-05":484.66,"2025-06":444.37,"2025-07":431.24,"2025-08":467.05,"2025-09":622.12,"2025-10":638.68,"2025-11":601.76,"2025-12":629.11,"2026-01":602.1,"2026-02":563.07,"2026-03":520.04,"2026-04":533.86,"2026-05":609.63,"2026-06":588.38,"2026-07":435.35,"2026-08":514.73,"2026-09":496.34,"2026-10":513.85,"2026-11":555.99},"VCN":{"2023-12":156.15,"2024-01":165.07,"2024-02":181.93,"2024-03":185.41,"2024-04":181.89,"2024-05":185.85,"2024-06":224.6,"2024-07":224.78,"2024-08":227.77,"2024-09":241.31,"2024-10":237.49,"2024-11":226.73,"2024-12":324.32,"2025-01":309.53,"2025-02":278.98,"2025-03":234.22,"2025-04":269.25,"2025-05":338.63,"2025-06":385.61,"2025-07":410.86,"2025-08":416.02,"2025-09":461.51,"2025-10":517.08,"2025-11":563.7,"2025-12":484.16,"2026-01":463.46,"2026-02":447.02,"2026-03":432.97,"2026-04":583.94,"2026-05":624.99,"2026-06":528.43,"2026-07":544.56,"2026-08":518.07,"2026-09":491.28,"2026-10":484.51,"2026-11":509.7},"MSFT":{"2023-12":526.04,"2024-01":556.17,"2024-02":578.64,"2024-03":588.55,"2024-04":544.63,"2024-05":580.73,"2024-06":625.24,"2024-07":585.23,"2024-08":583.54,"2024-09":601.95,"2024-10":568.44,"2024-11":592.38,"2024-12":589.64,"2025-01":580.63,"2025-02":555.35,"2025-03":525.13,"2025-04":552.93,"2025-05":644,"2025-06":695.83,"2025-07":746.31,"2025-08":708.81,"2025-09":724.56,"2025-10":724.36,"2025-11":688.27,"2025-12":676.54,"2026-01":601.93,"2026-02":549.4,"2026-03":517.83,"2026-04":570.44,"2026-05":629.84,"2026-06":521.82,"2026-07":650.1,"2026-08":709.65,"2026-09":717.5,"2026-10":746.55,"2026-11":731.62},"V":{"2023-12":364.2,"2024-01":382.26,"2024-02":395.39,"2024-03":390.4,"2024-04":375.76,"2024-05":381.14,"2024-06":367.17,"2024-07":371.65,"2024-08":386.61,"2024-09":384.63,"2024-10":405.47,"2024-11":440.77,"2024-12":442.11,"2025-01":478.14,"2025-02":507.4,"2025-03":490.26,"2025-04":483.32,"2025-05":510.86,"2025-06":496.68,"2025-07":483.28,"2025-08":492.11,"2025-09":477.56,"2025-10":476.66,"2025-11":467.85,"2025-12":490.61,"2026-01":450.21,"2026-02":447.84,"2026-03":422.8,"2026-04":461.41,"2026-05":456.54,"2026-06":479.95,"2026-07":512.18,"2026-08":530.7,"2026-09":502.67,"2026-10":547.46,"2026-11":587.97},"AMZN":{"2023-12":212.55,"2024-01":217.11,"2024-02":247.27,"2024-03":252.33,"2024-04":244.81,"2024-05":246.82,"2024-06":270.34,"2024-07":261.57,"2024-08":249.7,"2024-09":260.66,"2024-10":260.75,"2024-11":290.82,"2024-12":306.9,"2025-01":332.49,"2025-02":296.96,"2025-03":266.15,"2025-04":257.99,"2025-05":286.79,"2025-06":306.9,"2025-07":327.5,"2025-08":320.35,"2025-09":307.16,"2025-10":341.64,"2025-11":326.25,"2025-12":322.89,"2026-01":334.76,"2026-02":293.77,"2026-03":291.35,"2026-04":370.79,"2026-05":378.6,"2026-06":333.41,"2026-07":379.91,"2026-08":363.39,"2026-09":348.54,"2026-10":355.29,"2026-11":374.12},"JPM":{"2023-12":237.95,"2024-01":243.91,"2024-02":260.28,"2024-03":280.2,"2024-04":268.23,"2024-05":283.46,"2024-06":282.94,"2024-07":297.69,"2024-08":314.47,"2024-09":294.97,"2024-10":310.44,"2024-11":349.33,"2024-12":335.33,"2025-01":373.93,"2025-02":370.22,"2025-03":343.15,"2025-04":342.2,"2025-05":369.31,"2025-06":405.56,"2025-07":414.41,"2025-08":421.66,"2025-09":441.26,"2025-10":435.23,"2025-11":437.97,"2025-12":450.75,"2026-01":427.91,"2026-02":420.09,"2026-03":411.5,"2026-04":438.18,"2026-05":418.7,"2026-06":457.9,"2026-07":492.12,"2026-08":498.04,"2026-09":462.8,"2026-10":469.25,"2026-11":479.57},"AAPL":{"2023-12":269.33,"2024-01":257.96,"2024-02":252.85,"2024-03":239.88,"2024-04":238.27,"2024-05":268.94,"2024-06":294.64,"2024-07":310.67,"2024-08":320.35,"2024-09":325.94,"2024-10":316.03,"2024-11":332,"2024-12":350.31,"2025-01":330.14,"2025-02":338.31,"2025-03":310.74,"2025-04":297.27,"2025-05":280.97,"2025-06":287.01,"2025-07":290.37,"2025-08":324.74,"2025-09":356.2,"2025-10":378.22,"2025-11":390.08,"2025-12":380.3,"2026-01":362.99,"2026-02":369.56,"2026-03":355.03,"2026-04":379.59,"2026-05":436.54,"2026-06":404.79,"2026-07":432.13,"2026-08":443.24,"2026-09":465.86,"2026-10":479.65,"2026-11":496.44},"LLY":{"2023-12":815.45,"2024-01":903.14,"2024-02":1054.32,"2024-03":1088.29,"2024-04":1092.68,"2024-05":1147.57,"2024-06":1266.54,"2024-07":1125.09,"2024-08":1342.97,"2024-09":1239.34,"2024-10":1160.72,"2024-11":1112.62,"2024-12":1079.95,"2025-01":1134.62,"2025-02":1287.87,"2025-03":1155.37,"2025-04":1257.54,"2025-05":1031.93,"2025-06":1090.48,"2025-07":1035.28,"2025-08":1024.81,"2025-09":1067.36,"2025-10":1207.05,"2025-11":1504.47,"2025-12":1503.37,"2026-01":1450.87,"2026-02":1471.63,"2026-03":1286.67,"2026-04":1307.41,"2026-05":1545.78,"2026-06":1677.88,"2026-07":1607.11,"2026-08":1618.15,"2026-09":1618.64,"2026-10":1690.62,"2026-11":1996.62},"ALO":{"2023-11":19.13,"2023-12":18.45,"2024-01":19.38,"2024-02":22.19,"2024-03":23.36,"2024-04":28.25,"2024-05":24.65,"2024-06":28.45,"2024-07":29.01,"2024-08":29.26,"2024-09":31.5,"2024-10":33.43,"2024-11":33.86,"2024-12":30.02,"2025-01":33.1,"2025-02":32,"2025-03":33.32,"2025-04":31.26,"2025-05":31.09,"2025-06":32.41,"2025-07":32.25,"2025-08":34.74,"2025-09":34,"2025-10":35.39,"2025-11":39.52,"2025-12":42.43,"2026-01":44.42,"2026-02":38.1,"2026-03":26.82,"2026-04":26.91,"2026-05":23.89,"2026-06":25.25,"2026-07":25.69,"2026-08":23.48,"2026-09":24.83,"2026-10":25.05,"2026-11":15.93},"XOM":{"2023-12":139.86,"2024-01":143.82,"2024-02":146.21,"2024-03":162.61,"2024-04":165.45,"2024-05":164.04,"2024-06":161.04,"2024-07":165.9,"2024-08":164.99,"2024-09":163.98,"2024-10":163.36,"2024-11":165.01,"2024-12":150.48,"2025-01":149.44,"2025-02":155.74,"2025-03":166.37,"2025-04":147.77,"2025-05":143.11,"2025-06":150.8,"2025-07":156.17,"2025-08":159.88,"2025-09":157.73,"2025-10":159.98,"2025-11":162.16,"2025-12":168.34,"2026-01":197.8,"2026-02":213.33,"2026-03":237.34,"2026-04":215.89,"2026-05":203.2,"2026-06":191.26,"2026-07":217.45,"2026-08":225.15,"2026-09":227.67,"2026-10":247.66,"2026-11":237.51},"UNH":{"2023-12":736.48,"2024-01":715.87,"2024-02":690.5,"2024-03":692.04,"2024-04":676.65,"2024-05":692.97,"2024-06":712.4,"2024-07":805.99,"2024-08":825.63,"2024-09":817.91,"2024-10":789.68,"2024-11":853.61,"2024-12":707.65,"2025-01":758.89,"2025-02":664.42,"2025-03":732.67,"2025-04":575.56,"2025-05":422.34,"2025-06":436.41,"2025-07":349.11,"2025-08":433.48,"2025-09":483.04,"2025-10":477.81,"2025-11":461.32,"2025-12":461.79,"2026-01":401.39,"2026-02":410.26,"2026-03":378.53,"2026-04":518.26,"2026-05":532.02,"2026-06":581.42,"2026-07":579.7,"2026-08":544.75,"2026-09":513.51,"2026-10":553.46,"2026-11":566.74},"NA":{"2023-12":101,"2024-01":102.83,"2024-02":105.93,"2024-03":114.06,"2024-04":110.54,"2024-05":116.49,"2024-06":108.51,"2024-07":115.48,"2024-08":123.49,"2024-09":127.74,"2024-10":132.8,"2024-11":138.71,"2024-12":131.04,"2025-01":128.99,"2025-02":120.41,"2025-03":118.77,"2025-04":121.08,"2025-05":135.07,"2025-06":140.52,"2025-07":144.13,"2025-08":144.36,"2025-09":147.83,"2025-10":156.7,"2025-11":168.95,"2025-12":172.61,"2026-01":162.25,"2026-02":190.37,"2026-03":180.01,"2026-04":205.04,"2026-05":201.34,"2026-06":223.91,"2026-07":226.75,"2026-08":212.67,"2026-09":203.11,"2026-10":200.6,"2026-11":216.65},"CDNS":{"2023-11":32.98,"2023-12":31.86,"2024-01":33.29,"2024-02":33.73,"2024-03":34.1,"2024-04":34.22,"2024-05":35.51,"2024-06":35.44,"2024-07":35.3,"2024-08":38.64,"2024-09":37.93,"2024-10":38.27,"2024-11":38.86,"2024-12":39.66,"2025-01":40.28,"2025-02":38.99,"2025-03":37.15,"2025-04":38.75,"2025-05":40.22,"2025-06":42.22,"2025-07":41.97,"2025-08":45.18,"2025-09":48.46,"2025-10":46.63,"2025-11":47.43,"2025-12":50.74,"2026-01":54.15,"2026-02":48.69,"2026-03":56.26,"2026-04":63.14,"2026-05":64.38,"2026-06":58.79,"2026-07":61.21,"2026-08":63.12,"2026-09":58.11,"2026-10":59.91,"2026-11":58.47},"EMR":{"2023-12":145.49,"2024-01":158.02,"2024-02":180,"2024-03":190.32,"2024-04":192.12,"2024-05":211.29,"2024-06":243.14,"2024-07":231.94,"2024-08":240.19,"2024-09":242.95,"2024-10":266.55,"2024-11":258.32,"2024-12":276.27,"2025-01":292.82,"2025-02":252.54,"2025-03":232.22,"2025-04":233.18,"2025-05":270.44,"2025-06":316.84,"2025-07":338,"2025-08":322.96,"2025-09":390.7,"2025-10":420.27,"2025-11":407.79,"2025-12":425.11,"2026-01":462.42,"2026-02":524,"2026-03":472.76,"2026-04":554.05,"2026-05":585.37,"2026-06":668.07,"2026-07":565.51,"2026-08":580.99,"2026-09":638.16,"2026-10":601.53,"2026-11":567.24},"ACN":{"2023-12":81.32,"2024-01":83.1,"2024-02":95.45,"2024-03":97.72,"2024-04":96.42,"2024-05":106.25,"2024-06":115.34,"2024-07":115.14,"2024-08":114.63,"2024-09":108.33,"2024-10":93.2,"2024-11":90.51,"2024-12":88.15,"2025-01":103.27,"2025-02":99.16,"2025-03":95.1,"2025-04":98.3,"2025-05":105.88,"2025-06":125.31,"2025-07":122.97,"2025-08":121.98,"2025-09":150.89,"2025-10":169.09,"2025-11":164.44,"2025-12":169.98,"2026-01":199.75,"2026-02":213.27,"2026-03":205.98,"2026-04":244.86,"2026-05":268.83,"2026-06":422.06,"2026-07":255.75,"2026-08":245.44,"2026-09":272.69,"2026-10":250.06,"2026-11":220.05},"QQQM":{"2023-12":75.71,"2024-01":78.7,"2024-02":93.1,"2024-03":95.73,"2024-04":93.38,"2024-05":118.42,"2024-06":108.6,"2024-07":133.87,"2024-08":135.22,"2024-09":140.24,"2024-10":139.5,"2024-11":165.6,"2024-12":153,"2025-01":177.07,"2025-02":191.09,"2025-03":181.48,"2025-04":193.86,"2025-05":237.66,"2025-06":260.38,"2025-07":251.48,"2025-08":243.55,"2025-09":274.51,"2025-10":288.1,"2025-11":286.2,"2025-12":286.8,"2026-01":291.08,"2026-02":367.25,"2026-03":322.39,"2026-04":339.99,"2026-05":361.27,"2026-06":376.11,"2026-07":394.85,"2026-08":342.66,"2026-09":316.4,"2026-10":304.2,"2026-11":312.11},"BMO":{"2023-12":131.11,"2024-01":126.64,"2024-02":122.84,"2024-03":132.25,"2024-04":122.97,"2024-05":121.55,"2024-06":114.83,"2024-07":116.45,"2024-08":112.71,"2024-09":122.04,"2024-10":126.88,"2024-11":133.5,"2024-12":139.55,"2025-01":143.88,"2025-02":148.76,"2025-03":137.42,"2025-04":132.09,"2025-05":147.37,"2025-06":150.91,"2025-07":152.94,"2025-08":166.19,"2025-09":181.35,"2025-10":174.23,"2025-11":176.91,"2025-12":178.25,"2026-01":185.37,"2026-02":196.31,"2026-03":188.42,"2026-04":206.84,"2026-05":223.93,"2026-06":250.67,"2026-07":251.47,"2026-08":236.24,"2026-09":237.97,"2026-10":233.19,"2026-11":246.71},"INTC":{"2023-12":70.29,"2024-01":60.26,"2024-02":60.22,"2024-03":61.79,"2024-04":42.62,"2024-05":43.16,"2024-06":43.32,"2024-07":43,"2024-08":30.83,"2024-09":32.82,"2024-10":30.1,"2024-11":33.64,"2024-12":28.05,"2025-01":27.18,"2025-02":33.2,"2025-03":31.77,"2025-04":28.12,"2025-05":27.35,"2025-06":31.34,"2025-07":27.7,"2025-08":34.06,"2025-09":46.93,"2025-10":55.94,"2025-11":56.74,"2025-12":51.62,"2026-01":65.01,"2026-02":63.8,"2026-03":61.73,"2026-04":132.17,"2026-05":160.43,"2026-06":195.33,"2026-07":126.18,"2026-08":125.22,"2026-09":168.19,"2026-10":137.2,"2026-11":85.61},"NKE":{"2023-12":151.88,"2024-01":142.03,"2024-02":145.39,"2024-03":131.47,"2024-04":129.06,"2024-05":132.97,"2024-06":105.44,"2024-07":104.72,"2024-08":116.56,"2024-09":123.66,"2024-10":107.9,"2024-11":110.19,"2024-12":105.85,"2025-01":107.58,"2025-02":111.11,"2025-03":88.8,"2025-04":78.9,"2025-05":84.76,"2025-06":99.38,"2025-07":104.48,"2025-08":108.23,"2025-09":97.55,"2025-10":90.35,"2025-11":90.41,"2025-12":89.12,"2026-01":86.47,"2026-02":86.98,"2026-03":73.89,"2026-04":62.06,"2026-05":64.67,"2026-06":57.42,"2026-07":58.35,"2026-08":54.64,"2026-09":49.52,"2026-10":49.36,"2026-11":52.82},"TD":{"2023-12":85.62,"2024-01":81.67,"2024-02":81.49,"2024-03":81.75,"2024-04":81.67,"2024-05":76.2,"2024-06":75.2,"2024-07":81.53,"2024-08":80.75,"2024-09":85.52,"2024-10":76.97,"2024-11":79.23,"2024-12":76.53,"2025-01":82.91,"2025-02":86.64,"2025-03":86.23,"2025-04":88.09,"2025-05":94.77,"2025-06":100.16,"2025-07":100.92,"2025-08":103.12,"2025-09":111.28,"2025-10":115.16,"2025-11":117.65,"2025-12":129.36,"2026-01":127.26,"2026-02":132.88,"2026-03":129.92,"2026-04":146.33,"2026-05":157.75,"2026-06":172.44,"2026-07":168.04,"2026-08":167.67,"2026-09":167.33,"2026-10":167.64,"2026-11":176.69},"PFE":{"2023-12":40.27,"2024-01":37.88,"2024-02":37.15,"2024-03":38.82,"2024-04":35.84,"2024-05":40.09,"2024-06":39.14,"2024-07":42.72,"2024-08":40.58,"2024-09":40.48,"2024-10":39.59,"2024-11":36.67,"2024-12":37.11,"2025-01":37.1,"2025-02":36.97,"2025-03":35.45,"2025-04":34.15,"2025-05":32.86,"2025-06":33.91,"2025-07":32.58,"2025-08":34.64,"2025-09":35.64,"2025-10":34.48,"2025-11":36.01,"2025-12":34.83,"2026-01":36.99,"2026-02":38.68,"2026-03":39.28,"2026-04":37.35,"2026-05":36.62,"2026-06":33.69,"2026-07":34.99,"2026-08":39.81,"2026-09":39.9,"2026-10":40.86,"2026-11":40.33},"RY":{"2023-12":134,"2024-01":131.21,"2024-02":131.8,"2024-03":136.62,"2024-04":133.19,"2024-05":148.98,"2024-06":145.65,"2024-07":154.28,"2024-08":162.98,"2024-09":168.8,"2024-10":168.39,"2024-11":176.16,"2024-12":173.32,"2025-01":177.18,"2025-02":170.98,"2025-03":162.1,"2025-04":165.47,"2025-05":173.94,"2025-06":179.47,"2025-07":177.79,"2025-08":199.58,"2025-09":205.12,"2025-10":205.47,"2025-11":216.14,"2025-12":233.99,"2026-01":226.72,"2026-02":228.07,"2026-03":224.88,"2026-04":244.31,"2026-05":264.44,"2026-06":293.68,"2026-07":293.41,"2026-08":283.4,"2026-09":279.94,"2026-10":276.14,"2026-11":289.39},"PAYX":{"2023-12":24.02,"2024-01":22.51,"2024-02":35.08,"2024-03":32.19,"2024-04":30.73,"2024-05":30.33,"2024-06":35.43,"2024-07":37.62,"2024-08":44.04,"2024-09":52.04,"2024-10":58.14,"2024-11":93.84,"2024-12":105.8,"2025-01":115.4,"2025-02":118.79,"2025-03":118.07,"2025-04":165.69,"2025-05":184.35,"2025-06":190.7,"2025-07":221.52,"2025-08":219.22,"2025-09":255.19,"2025-10":280.44,"2025-11":235.64,"2025-12":248.65,"2026-01":205.06,"2026-02":191.92,"2026-03":204.63,"2026-04":194.6,"2026-05":218.98,"2026-06":163.21,"2026-07":172.15,"2026-08":260.73,"2026-09":261.66,"2026-10":281.05,"2026-11":240.02},"BA":{"2023-12":364.64,"2024-01":295.22,"2024-02":284.98,"2024-03":269.97,"2024-04":234.79,"2024-05":248.46,"2024-06":254.61,"2024-07":266.63,"2024-08":243.04,"2024-09":212.69,"2024-10":208.87,"2024-11":217.45,"2024-12":247.61,"2025-01":246.93,"2025-02":244.29,"2025-03":238.58,"2025-04":256.33,"2025-05":290.02,"2025-06":293.11,"2025-07":310.33,"2025-08":328.29,"2025-09":301.92,"2025-10":281.21,"2025-11":264.39,"2025-12":303.73,"2026-01":326.95,"2026-02":318.29,"2026-03":278.42,"2026-04":320.39,"2026-05":323.36,"2026-06":302.82,"2026-07":302.36,"2026-08":290.66,"2026-09":260.27,"2026-10":258.32,"2026-11":239.98},"ECL":{"2023-12":26.1,"2024-01":23.15,"2024-02":23.57,"2024-03":23.81,"2024-04":21.4,"2024-05":23.14,"2024-06":22.4,"2024-07":25.22,"2024-08":26.43,"2024-09":26.87,"2024-10":26.48,"2024-11":33.81,"2024-12":32.48,"2025-01":34.38,"2025-02":32.92,"2025-03":30.87,"2025-04":31.25,"2025-05":34.12,"2025-06":40.2,"2025-07":41.49,"2025-08":47.41,"2025-09":49.91,"2025-10":52.72,"2025-11":46.66,"2025-12":54.07,"2026-01":63.57,"2026-02":62.21,"2026-03":62.68,"2026-04":72.25,"2026-05":91.36,"2026-06":70.88,"2026-07":61.26,"2026-08":61.02,"2026-09":59.19,"2026-10":55.57,"2026-11":57.52},"SHOP":{"2023-12":103.16,"2024-01":107.63,"2024-02":103.69,"2024-03":104.5,"2024-04":96.65,"2024-05":80.66,"2024-06":90.41,"2024-07":84.56,"2024-08":99.81,"2024-09":108.35,"2024-10":108.92,"2024-11":161.84,"2024-12":152.99,"2025-01":169.61,"2025-02":162.04,"2025-03":136.9,"2025-04":131.12,"2025-05":146.64,"2025-06":157.06,"2025-07":169.37,"2025-08":193.98,"2025-09":206.76,"2025-10":243.86,"2025-11":223.22,"2025-12":221,"2026-01":178.67,"2026-02":164.67,"2026-03":165.06,"2026-04":164.88,"2026-05":164.41,"2026-06":162.26,"2026-07":164.18,"2026-08":204.27,"2026-09":210.92,"2026-10":245.5,"2026-11":209.41},"ATD":{"2023-12":78.03,"2024-01":78.78,"2024-02":84.17,"2024-03":77.31,"2024-04":76.3,"2024-05":79.55,"2024-06":76.77,"2024-07":85.11,"2024-08":76.93,"2024-09":74.77,"2024-10":72.61,"2024-11":81.91,"2024-12":79.72,"2025-01":76.75,"2025-02":71.93,"2025-03":70.97,"2025-04":71.96,"2025-05":71.15,"2025-06":67.69,"2025-07":72,"2025-08":69.61,"2025-09":74.25,"2025-10":71.28,"2025-11":76.33,"2025-12":74.96,"2026-01":70.84,"2026-02":82.78,"2026-03":78.85,"2026-04":80.36,"2026-05":77.89,"2026-06":90.4,"2026-07":91.01,"2026-08":83.47,"2026-09":77.49,"2026-10":80.94,"2026-11":82.48},"DOL":{"2023-12":95.49,"2024-01":98.67,"2024-02":104.98,"2024-03":103.19,"2024-04":114.84,"2024-05":129,"2024-06":124.91,"2024-07":129.43,"2024-08":136.5,"2024-09":138.54,"2024-10":144.89,"2024-11":145.84,"2024-12":140.28,"2025-01":137.53,"2025-02":150.83,"2025-03":153.88,"2025-04":170.1,"2025-05":176.5,"2025-06":191.87,"2025-07":189.38,"2025-08":187.26,"2025-09":183.54,"2025-10":182.31,"2025-11":199.95,"2025-12":205.14,"2026-01":183.5,"2026-02":200.82,"2026-03":170.73,"2026-04":173.6,"2026-05":176.3,"2026-06":187.62,"2026-07":190.97,"2026-08":175.07,"2026-09":184,"2026-10":197.86,"2026-11":220.42},"WSP":{"2023-12":185.74,"2024-01":197.51,"2024-02":215.42,"2024-03":225.76,"2024-04":208.89,"2024-05":205,"2024-06":213.03,"2024-07":229.34,"2024-08":224.66,"2024-09":240.28,"2024-10":248.87,"2024-11":248.97,"2024-12":252.96,"2025-01":246.63,"2025-02":258.04,"2025-03":244.21,"2025-04":244.36,"2025-05":281.21,"2025-06":277.77,"2025-07":285.3,"2025-08":279.68,"2025-09":273.5,"2025-10":268.14,"2025-11":244.45,"2025-12":248.52,"2026-01":263.23,"2026-02":231.07,"2026-03":216.5,"2026-04":226,"2026-05":195.26,"2026-06":175.85,"2026-07":171.27,"2026-08":188.25,"2026-09":174.24,"2026-10":161.69,"2026-11":184.33},"ENB":{"2023-12":47.7,"2024-01":47.74,"2024-02":46.65,"2024-03":48.95,"2024-04":48.95,"2024-05":49.83,"2024-06":48.67,"2024-07":51.67,"2024-08":54.22,"2024-09":54.94,"2024-10":56.24,"2024-11":60.57,"2024-12":61.01,"2025-01":62.85,"2025-02":61.81,"2025-03":63.69,"2025-04":64.47,"2025-05":63.87,"2025-06":61.75,"2025-07":62.75,"2025-08":66.45,"2025-09":70.21,"2025-10":65.4,"2025-11":67.93,"2025-12":65.68,"2026-01":66.47,"2026-02":72.47,"2026-03":75.41,"2026-04":75.34,"2026-05":75.64,"2026-06":76.91,"2026-07":76.28,"2026-08":70.22,"2026-09":66.15,"2026-10":67.49,"2026-11":68.57},"BNS":{"2023-12":64.5,"2024-01":62.87,"2024-02":65.81,"2024-03":70.07,"2024-04":63.16,"2024-05":64.52,"2024-06":62.58,"2024-07":64.47,"2024-08":67.27,"2024-09":73.69,"2024-10":71.69,"2024-11":79.85,"2024-12":77.19,"2025-01":74.36,"2025-02":71.82,"2025-03":68.23,"2025-04":68.98,"2025-05":73.43,"2025-06":75.3,"2025-07":77.09,"2025-08":85.77,"2025-09":89.99,"2025-10":91.99,"2025-11":96.94,"2025-12":101.23,"2026-01":101.8,"2026-02":103.48,"2026-03":96.47,"2026-04":105.68,"2026-05":110.62,"2026-06":123.27,"2026-07":122.97,"2026-08":126.87,"2026-09":129.41,"2026-10":128.12,"2026-11":132.22},"IFC":{"2023-12":203.86,"2024-01":210.25,"2024-02":225.68,"2024-03":220.04,"2024-04":226.27,"2024-05":228.04,"2024-06":228.01,"2024-07":250.9,"2024-08":253.63,"2024-09":259.7,"2024-10":265.9,"2024-11":266.67,"2024-12":261.73,"2025-01":258.15,"2025-02":285.05,"2025-03":294.01,"2025-04":306.17,"2025-05":311.35,"2025-06":316.65,"2025-07":286.4,"2025-08":275.03,"2025-09":270.77,"2025-10":261.63,"2025-11":285.4,"2025-12":285.73,"2026-01":247.91,"2026-02":263.35,"2026-03":252.08,"2026-04":261.74,"2026-05":270.87,"2026-06":292.71,"2026-07":275.25,"2026-08":268.27,"2026-09":245.84,"2026-10":244.37,"2026-11":280.05},"CSU":{"2023-12":3285.27,"2024-01":3715.86,"2024-02":3778.39,"2024-03":3700,"2024-04":3544.28,"2024-05":3791.07,"2024-06":3941.88,"2024-07":4356.29,"2024-08":4400.69,"2024-09":4400,"2024-10":4199.04,"2024-11":4734.16,"2024-12":4444.91,"2025-01":4753.02,"2025-02":4986.97,"2025-03":4557.37,"2025-04":4968.35,"2025-05":4975.76,"2025-06":4993.2,"2025-07":4780.28,"2025-08":4550.34,"2025-09":3777.98,"2025-10":3691.08,"2025-11":3382.25,"2025-12":3301.4,"2026-01":2512.96,"2026-02":2520.66,"2026-03":2441.99,"2026-04":2473.89,"2026-05":2822.83,"2026-06":2670,"2026-07":3002.99,"2026-08":3138.72,"2026-09":2894.73,"2026-10":3139.03,"2026-11":3496.88},"CP":{"2023-12":104.84,"2024-01":108.19,"2024-02":115.23,"2024-03":119.43,"2024-04":108,"2024-05":108.49,"2024-06":107.74,"2024-07":115.78,"2024-08":111.87,"2024-09":115.67,"2024-10":107.41,"2024-11":107.11,"2024-12":104.08,"2025-01":115.5,"2025-02":112.69,"2025-03":100.99,"2025-04":100.13,"2025-05":112.09,"2025-06":108.18,"2025-07":101.9,"2025-08":104.61,"2025-09":103.65,"2025-10":100.93,"2025-11":101.23,"2025-12":101.05,"2026-01":101.22,"2026-02":119.44,"2026-03":109.47,"2026-04":118.14,"2026-05":123.1,"2026-06":122.96,"2026-07":124.52,"2026-08":128.39,"2026-09":121.2,"2026-10":122.72,"2026-11":134.75},"CNQ":{"2023-12":43.4,"2024-01":43.02,"2024-02":47.27,"2024-03":51.67,"2024-04":52.16,"2024-05":52.35,"2024-06":48.73,"2024-07":49.02,"2024-08":48.78,"2024-09":44.91,"2024-10":47.35,"2024-11":47.52,"2024-12":44.38,"2025-01":44.15,"2025-02":40.85,"2025-03":44.28,"2025-04":39.56,"2025-05":41.67,"2025-06":42.8,"2025-07":43.86,"2025-08":43.49,"2025-09":44.5,"2025-10":44.87,"2025-11":47.29,"2025-12":46.49,"2026-01":50.63,"2026-02":59.67,"2026-03":67.86,"2026-04":64.84,"2026-05":62.7,"2026-06":56.12,"2026-07":66.78,"2026-08":69.49,"2026-09":66.93,"2026-10":73.8,"2026-11":70.04},"BN":{"2023-12":35.43,"2024-01":35.57,"2024-02":37.33,"2024-03":37.79,"2024-04":36.81,"2024-05":39.57,"2024-06":37.93,"2024-07":44.89,"2024-08":45.2,"2024-09":47.89,"2024-10":49.22,"2024-11":57.36,"2024-12":55.08,"2025-01":59.24,"2025-02":55.81,"2025-03":50.21,"2025-04":49.37,"2025-05":52.83,"2025-06":56.19,"2025-07":61.87,"2025-08":60.18,"2025-09":63.66,"2025-10":64.59,"2025-11":65.98,"2025-12":63.02,"2026-01":62.07,"2026-02":59.82,"2026-03":56.37,"2026-04":61.35,"2026-05":62.81,"2026-06":60.51,"2026-07":59.58,"2026-08":57.08,"2026-09":51.92,"2026-10":51.13,"2026-11":59.31},"AEM":{"2023-12":72.65,"2024-01":66.08,"2024-02":65.09,"2024-03":80.77,"2024-04":87.18,"2024-05":92.95,"2024-06":89.48,"2024-07":106.53,"2024-08":109.8,"2024-09":108.95,"2024-10":120.18,"2024-11":118.06,"2024-12":112.46,"2025-01":135.08,"2025-02":139.37,"2025-03":155.91,"2025-04":162.03,"2025-05":161.77,"2025-06":162.24,"2025-07":172.01,"2025-08":198.01,"2025-09":234.4,"2025-10":225.58,"2025-11":243.79,"2025-12":232.76,"2026-01":258.84,"2026-02":342.63,"2026-03":282.37,"2026-04":255.43,"2026-05":253.48,"2026-06":220.36,"2026-07":203.52,"2026-08":281.23,"2026-09":260.6,"2026-10":251.76,"2026-11":254.28},"CCO":{"2023-12":57.13,"2024-01":64.19,"2024-02":55,"2024-03":58.64,"2024-04":62.81,"2024-05":75.63,"2024-06":67.31,"2024-07":62.84,"2024-08":54.99,"2024-09":64.61,"2024-10":72.76,"2024-11":83.85,"2024-12":73.91,"2025-01":71.87,"2025-02":63.7,"2025-03":59.24,"2025-04":62.23,"2025-05":80.34,"2025-06":101.13,"2025-07":104.03,"2025-08":106.24,"2025-09":116.8,"2025-10":143.34,"2025-11":123.95,"2025-12":125.68,"2026-01":168.41,"2026-02":161.38,"2026-03":151.28,"2026-04":166.98,"2026-05":154.91,"2026-06":144.56,"2026-07":120.98,"2026-08":136.82,"2026-09":123.38,"2026-10":115.93,"2026-11":102.37},"CNR":{"2023-12":166.55,"2024-01":166.78,"2024-02":175.97,"2024-03":178.37,"2024-04":167.09,"2024-05":173.5,"2024-06":161.66,"2024-07":159.83,"2024-08":158.79,"2024-09":158.37,"2024-10":150.35,"2024-11":156.34,"2024-12":145.97,"2025-01":151.82,"2025-02":146.68,"2025-03":140.04,"2025-04":133.51,"2025-05":144.26,"2025-06":141.89,"2025-07":129.38,"2025-08":132.95,"2025-09":131.24,"2025-10":134.49,"2025-11":133.83,"2025-12":135.75,"2026-01":130.99,"2026-02":153.07,"2026-03":143.18,"2026-04":152.57,"2026-05":163.25,"2026-06":169.25,"2026-07":178.25,"2026-08":173.05,"2026-09":169.4,"2026-10":170.8,"2026-11":181.9},"ANET":{"2023-12":82.36,"2024-01":90.47,"2024-02":97.06,"2024-03":101.41,"2024-04":89.73,"2024-05":104.1,"2024-06":122.57,"2024-07":121.2,"2024-08":123.59,"2024-09":134.23,"2024-10":135.15,"2024-11":141.93,"2024-12":154.62,"2025-01":161.2,"2025-02":130.17,"2025-03":108.39,"2025-04":115.09,"2025-05":121.2,"2025-06":143.12,"2025-07":172.37,"2025-08":191.02,"2025-09":203.83,"2025-10":220.59,"2025-11":182.81,"2025-12":183.3,"2026-01":198.28,"2026-02":186.75,"2026-03":171.76,"2026-04":241.6,"2026-05":223.08,"2026-06":237.65,"2026-07":252.29,"2026-08":273.75,"2026-09":284.8,"2026-10":273.46,"2026-11":289.05},"CRM":{"2023-12":368.11,"2024-01":393.22,"2024-02":432.01,"2024-03":421.32,"2024-04":376.22,"2024-05":327.96,"2024-06":359.66,"2024-07":362.04,"2024-08":353.78,"2024-09":382.89,"2024-10":407.6,"2024-11":461.62,"2024-12":467.69,"2025-01":478,"2025-02":416.66,"2025-03":375.41,"2025-04":375.9,"2025-05":371.23,"2025-06":381.47,"2025-07":361.38,"2025-08":358.47,"2025-09":331.54,"2025-10":364.29,"2025-11":322.5,"2025-12":370.58,"2026-01":296.97,"2026-02":272.49,"2026-03":261.13,"2026-04":246.95,"2026-05":267.33,"2026-06":219.15,"2026-07":257.43,"2026-08":360.27,"2026-09":321.15,"2026-10":330.11,"2026-11":304.36},"PANW":{"2023-12":206.25,"2024-01":236.77,"2024-02":217.21,"2024-03":198.73,"2024-04":203.46,"2024-05":206.27,"2024-06":237.12,"2024-07":227.13,"2024-08":253.7,"2024-09":239.07,"2024-10":252.03,"2024-11":271.26,"2024-12":254.54,"2025-01":257.99,"2025-02":266.39,"2025-03":238.71,"2025-04":261.5,"2025-05":269.18,"2025-06":286.27,"2025-07":242.85,"2025-08":266.52,"2025-09":284.84,"2025-10":308.09,"2025-11":265.97,"2025-12":257.68,"2026-01":247.56,"2026-02":208.32,"2026-03":224.27,"2026-04":250.85,"2026-05":394.06,"2026-06":477.05,"2026-07":464.2,"2026-08":534.56,"2026-09":555.8,"2026-10":524.85,"2026-11":451.37},"ISRG":{"2023-12":471.93,"2024-01":529.09,"2024-02":539.42,"2024-03":558.29,"2024-04":518.46,"2024-05":562.53,"2024-06":622.3,"2024-07":621.96,"2024-08":689.14,"2024-09":687.24,"2024-10":704.82,"2024-11":758.2,"2024-12":730.17,"2025-01":800,"2025-02":801.78,"2025-03":692.83,"2025-04":721.55,"2025-05":772.67,"2025-06":760.18,"2025-07":673,"2025-08":662.1,"2025-09":625.63,"2025-10":747.4,"2025-11":802.24,"2025-12":792.28,"2026-01":705.35,"2026-02":704.36,"2026-03":644.88,"2026-04":640.15,"2026-05":594.03,"2026-06":556.31,"2026-07":494.27,"2026-08":527.19,"2026-09":568.83,"2026-10":587.74,"2026-11":615.36},"AMD":{"2023-12":206.21,"2024-01":234.58,"2024-02":269.33,"2024-03":252.49,"2024-04":221.56,"2024-05":233.48,"2024-06":226.92,"2024-07":202.11,"2024-08":207.82,"2024-09":229.53,"2024-10":201.54,"2024-11":191.9,"2024-12":168.97,"2025-01":162.2,"2025-02":139.69,"2025-03":143.72,"2025-04":136.18,"2025-05":154.9,"2025-06":198.5,"2025-07":246.64,"2025-08":227.5,"2025-09":226.33,"2025-10":358.29,"2025-11":304.3,"2025-12":299.59,"2026-01":331.16,"2026-02":280.07,"2026-03":284.58,"2026-04":495.9,"2026-05":721.97,"2026-06":812.63,"2026-07":666.09,"2026-08":658.49,"2026-09":855.79,"2026-10":798.81,"2026-11":818.78},"FTS":{"2023-12":54.51,"2024-01":53.94,"2024-02":52.33,"2024-03":53.52,"2024-04":54.06,"2024-05":54.51,"2024-06":53.17,"2024-07":57.72,"2024-08":59.3,"2024-09":61.45,"2024-10":60.23,"2024-11":62.59,"2024-12":59.73,"2025-01":61.9,"2025-02":63.44,"2025-03":65.55,"2025-04":68.27,"2025-05":67.05,"2025-06":65.02,"2025-07":67.8,"2025-08":68.35,"2025-09":70.59,"2025-10":70.5,"2025-11":73.26,"2025-12":71.36,"2026-01":72.6,"2026-02":78.47,"2026-03":77.61,"2026-04":77.68,"2026-05":76.26,"2026-06":81.25,"2026-07":79.8,"2026-08":76.59,"2026-09":75.17,"2026-10":77.96,"2026-11":84.43},"BRKB":{"2023-12":498.93,"2024-01":536.81,"2024-02":572.71,"2024-03":588.27,"2024-04":554.99,"2024-05":579.7,"2024-06":569.07,"2024-07":613.42,"2024-08":665.76,"2024-09":643.86,"2024-10":630.79,"2024-11":675.7,"2024-12":634.09,"2025-01":655.62,"2025-02":718.8,"2025-03":745.03,"2025-04":745.96,"2025-05":704.99,"2025-06":679.54,"2025-07":660.11,"2025-08":703.62,"2025-09":703.28,"2025-10":668.03,"2025-11":718.77,"2025-12":703.16,"2026-01":672.21,"2026-02":706.37,"2026-03":670.35,"2026-04":662.52,"2026-05":663.75,"2026-06":700,"2026-07":715.59,"2026-08":705.09,"2026-09":696.58,"2026-10":736.05,"2026-11":825.11},"MFC":{"2023-12":29.28,"2024-01":29.72,"2024-02":32.21,"2024-03":33.83,"2024-04":32.11,"2024-05":35.4,"2024-06":36.43,"2024-07":36.78,"2024-08":37.21,"2024-09":39.97,"2024-10":40.67,"2024-11":45.07,"2024-12":44.16,"2025-01":43.46,"2025-02":45.06,"2025-03":44.84,"2025-04":42.25,"2025-05":43.7,"2025-06":43.54,"2025-07":42.87,"2025-08":42.25,"2025-09":43.36,"2025-10":45.39,"2025-11":49.47,"2025-12":49.84,"2026-01":51.87,"2026-02":48.57,"2026-03":47.92,"2026-04":53.41,"2026-05":52.73,"2026-06":57.52,"2026-07":62.26,"2026-08":58.79,"2026-09":60.64,"2026-10":61.48,"2026-11":62.65},"ORCL":{"2023-12":147.49,"2024-01":156.26,"2024-02":156.23,"2024-03":175.72,"2024-04":159.12,"2024-05":163.94,"2024-06":197.52,"2024-07":195.08,"2024-08":197.65,"2024-09":238.37,"2024-10":234.79,"2024-11":258.57,"2024-12":233.11,"2025-01":237.9,"2025-02":232.3,"2025-03":195.58,"2025-04":196.85,"2025-05":231.56,"2025-06":305.84,"2025-07":355,"2025-08":316.33,"2025-09":393.43,"2025-10":367.37,"2025-11":282.51,"2025-12":272.66,"2026-01":230.23,"2026-02":203.4,"2026-03":205.79,"2026-04":225.77,"2026-05":315.84,"2026-06":205.01,"2026-07":181.68,"2026-08":208.6,"2026-09":192.07,"2026-10":182.56,"2026-11":177.81},"NFLX":{"2023-12":68.11,"2024-01":78.91,"2024-02":84.34,"2024-03":84.96,"2024-04":77.03,"2024-05":89.76,"2024-06":94.41,"2024-07":87.9,"2024-08":98.11,"2024-09":99.22,"2024-10":105.76,"2024-11":124.06,"2024-12":124.69,"2025-01":136.64,"2025-02":137.17,"2025-03":130.45,"2025-04":158.32,"2025-05":168.88,"2025-06":187.33,"2025-07":162.19,"2025-08":169.02,"2025-09":167.72,"2025-10":156.52,"2025-11":150.49,"2025-12":131.16,"2026-01":116.79,"2026-02":134.63,"2026-03":134.5,"2026-04":130.95,"2026-05":120.33,"2026-06":99.88,"2026-07":100.32,"2026-08":113.38,"2026-09":97.34,"2026-10":98.76,"2026-11":87.7},"BCE":{"2023-12":52.17,"2024-01":54.25,"2024-02":50.36,"2024-03":46.03,"2024-04":45.23,"2024-05":46.62,"2024-06":44.31,"2024-07":46.57,"2024-08":47.21,"2024-09":47.02,"2024-10":44.89,"2024-11":37.9,"2024-12":33.32,"2025-01":34.61,"2025-02":33.42,"2025-03":33.03,"2025-04":30.64,"2025-05":29.9,"2025-06":30.2,"2025-07":32.32,"2025-08":34.27,"2025-09":32.52,"2025-10":32.06,"2025-11":32.92,"2025-12":32.74,"2026-01":35.2,"2026-02":35.85,"2026-03":35.1,"2026-04":32.28,"2026-05":34.78,"2026-06":30.55,"2026-07":30.41,"2026-08":32.68,"2026-09":28.97,"2026-10":28.01,"2026-11":30.47},"L":{"2023-12":32.07,"2024-01":33.59,"2024-02":36.16,"2024-03":37.53,"2024-04":37.74,"2024-05":39.58,"2024-06":39.67,"2024-07":42.56,"2024-08":43.97,"2024-09":45.02,"2024-10":44.01,"2024-11":45.42,"2024-12":47.29,"2025-01":45.49,"2025-02":47.36,"2025-03":50.42,"2025-04":55.95,"2025-05":57.88,"2025-06":56.31,"2025-07":56.02,"2025-08":56.09,"2025-09":53.83,"2025-10":55.74,"2025-11":62,"2025-12":62.05,"2026-01":61.27,"2026-02":63.22,"2026-03":63.42,"2026-04":62.62,"2026-05":61.67,"2026-06":64.34,"2026-07":65.81,"2026-08":60.64,"2026-09":62.2,"2026-10":65.73,"2026-11":69.35},"NTR":{"2023-12":74.65,"2024-01":67.04,"2024-02":70.84,"2024-03":73.59,"2024-04":72.59,"2024-05":79.87,"2024-06":69.65,"2024-07":70.81,"2024-08":65.27,"2024-09":64.99,"2024-10":66.39,"2024-11":65.4,"2024-12":64.32,"2025-01":75.01,"2025-02":75.82,"2025-03":71.42,"2025-04":78.7,"2025-05":81.08,"2025-06":79.35,"2025-07":82.21,"2025-08":79.15,"2025-09":81.73,"2025-10":76.39,"2025-11":81.3,"2025-12":84.72,"2026-01":93.75,"2026-02":102.59,"2026-03":105.01,"2026-04":103.25,"2026-05":94.41,"2026-06":89.35,"2026-07":96.76,"2026-08":104.54,"2026-09":99.94,"2026-10":99.51,"2026-11":101.5},"MA":{"2023-12":596.64,"2024-01":628.43,"2024-02":664.14,"2024-03":673.67,"2024-04":631.18,"2024-05":625.41,"2024-06":617.14,"2024-07":648.68,"2024-08":676.14,"2024-09":690.78,"2024-10":698.88,"2024-11":745.53,"2024-12":736.62,"2025-01":776.99,"2025-02":806.2,"2025-03":766.77,"2025-04":766.68,"2025-05":819.2,"2025-06":786.1,"2025-07":792.43,"2025-08":832.75,"2025-09":795.71,"2025-10":772.18,"2025-11":770.14,"2025-12":798.6,"2026-01":753.71,"2026-02":723.53,"2026-03":698.97,"2026-04":703.53,"2026-05":691.03,"2026-06":718.48,"2026-07":801.71,"2026-08":824.39,"2026-09":771.45,"2026-10":843.73,"2026-11":912.92},"COIN":{"2023-12":243.3,"2024-01":179.34,"2024-02":284.76,"2024-03":370.88,"2024-04":285.28,"2024-05":316.04,"2024-06":310.88,"2024-07":313.86,"2024-08":256.5,"2024-09":249.24,"2024-10":250.75,"2024-11":414.35,"2024-12":347.35,"2025-01":407.54,"2025-02":301.63,"2025-03":240.93,"2025-04":283.82,"2025-05":345,"2025-06":490.3,"2025-07":528.45,"2025-08":426.02,"2025-09":472.11,"2025-10":480.91,"2025-11":381.65,"2025-12":316.35,"2026-01":272.42,"2026-02":246,"2026-03":244.26,"2026-04":262.67,"2026-05":264.43,"2026-06":204.51,"2026-07":204.6,"2026-08":263.16,"2026-09":260.77,"2026-10":241.79,"2026-11":182.79},"SIEDE":{"2023-11":266.83,"2023-12":261.74,"2024-01":287.27,"2024-02":277.88,"2024-03":276.22,"2024-04":276.78,"2024-05":272.79,"2024-06":266.04,"2024-07":266.83,"2024-08":284.76,"2024-09":280.14,"2024-10":287.62,"2024-11":296.1,"2024-12":325.76,"2025-01":347.35,"2025-02":332.75,"2025-03":317.12,"2025-04":332.59,"2025-05":341.78,"2025-06":353.16,"2025-07":371.53,"2025-08":359.91,"2025-09":385.59,"2025-10":358.5,"2025-11":375.54,"2025-12":402.47,"2026-01":388.49,"2026-02":323.01,"2026-03":396.58,"2026-04":423.67,"2026-05":441.49,"2026-06":443.85,"2026-07":448.48,"2026-08":432.62,"2026-09":417.15,"2026-10":424.84,"2026-11":436.31},"ABBV":{"2023-12":216.79,"2024-01":229.98,"2024-02":246.28,"2024-03":254.74,"2024-04":227.52,"2024-05":225.56,"2024-06":239.94,"2024-07":259.24,"2024-08":274.62,"2024-09":276.25,"2024-10":285.19,"2024-11":255.9,"2024-12":248.58,"2025-01":257.26,"2025-02":292.41,"2025-03":293.1,"2025-04":272.93,"2025-05":260.35,"2025-06":259.66,"2025-07":264.42,"2025-08":294.33,"2025-09":323.9,"2025-10":305.02,"2025-11":318.53,"2025-12":319.63,"2026-01":311.97,"2026-02":324.66,"2026-03":304.25,"2026-04":295.62,"2026-05":304.57,"2026-06":352.02,"2026-07":351.04,"2026-08":358.71,"2026-09":365.94,"2026-10":396.45,"2026-11":411.91},"ALVDE":{"2023-11":379.93,"2023-12":389.12,"2024-01":398.62,"2024-02":436.23,"2024-03":418.64,"2024-04":421.31,"2024-05":407.49,"2024-06":409.53,"2024-07":441.1,"2024-08":463.24,"2024-09":454.44,"2024-10":458.84,"2024-11":464.65,"2024-12":493.7,"2025-01":518.67,"2025-02":552.9,"2025-03":571.75,"2025-04":547.56,"2025-05":540.34,"2025-06":545.21,"2025-07":567.19,"2025-08":561.23,"2025-09":546.78,"2025-10":584.62,"2025-11":613.2,"2025-12":583.84,"2026-01":600.17,"2026-02":564.21,"2026-03":610.85,"2026-04":599.23,"2026-05":650.26,"2026-06":679.15,"2026-07":707.89,"2026-08":653.72,"2026-09":688.89,"2026-10":674.79,"2026-11":746.99},"UBER":{"2023-12":86.13,"2024-01":91.31,"2024-02":111.21,"2024-03":107.7,"2024-04":92.71,"2024-05":90.31,"2024-06":101.67,"2024-07":90.19,"2024-08":102.3,"2024-09":105.14,"2024-10":100.79,"2024-11":100.66,"2024-12":84.38,"2025-01":93.52,"2025-02":106.33,"2025-03":101.92,"2025-04":113.32,"2025-05":117.73,"2025-06":130.52,"2025-07":122.75,"2025-08":131.15,"2025-09":137.05,"2025-10":134.99,"2025-11":122.46,"2025-12":114.3,"2026-01":111.98,"2026-02":105.51,"2026-03":100.62,"2026-04":104.37,"2026-05":98.48,"2026-06":100.94,"2026-07":98.43,"2026-08":105.83,"2026-09":95.84,"2026-10":96.88,"2026-11":96.69},"SPGI":{"2023-12":583.01,"2024-01":593.37,"2024-02":566.94,"2024-03":563.07,"2024-04":550.34,"2024-05":565.79,"2024-06":590.26,"2024-07":641.52,"2024-08":679.25,"2024-09":683.73,"2024-10":635.74,"2024-11":691.52,"2024-12":659.12,"2025-01":690.07,"2025-02":706.38,"2025-03":672.45,"2025-04":661.8,"2025-05":678.75,"2025-06":697.85,"2025-07":729.36,"2025-08":725.84,"2025-09":644.14,"2025-10":644.8,"2025-11":660.18,"2025-12":691.63,"2026-01":698.51,"2026-02":584.81,"2026-03":562.92,"2026-04":570.72,"2026-05":561.15,"2026-06":538.99,"2026-07":576.25,"2026-08":609.7,"2026-09":551.82,"2026-10":571.4,"2026-11":655.4},"LMT":{"2023-12":634.04,"2024-01":600.7,"2024-02":599.06,"2024-03":636.32,"2024-04":650.39,"2024-05":657.96,"2024-06":653.43,"2024-07":758.09,"2024-08":794.72,"2024-09":817.74,"2024-10":763.87,"2024-11":740.59,"2024-12":679.78,"2025-01":647.62,"2025-02":630.02,"2025-03":624.9,"2025-04":668.32,"2025-05":674.8,"2025-06":647.89,"2025-07":588.91,"2025-08":637.38,"2025-09":698.34,"2025-10":688.09,"2025-11":640.5,"2025-12":676.61,"2026-01":887.21,"2026-02":920.59,"2026-03":845.48,"2026-04":724.59,"2026-05":742.05,"2026-06":712.68,"2026-07":815.19,"2026-08":785.1,"2026-09":712.39,"2026-10":730.39,"2026-11":845.06},"KO":{"2023-12":82.44,"2024-01":83.22,"2024-02":83.96,"2024-03":85.58,"2024-04":86.41,"2024-05":88.03,"2024-06":89.04,"2024-07":93.36,"2024-08":101.38,"2024-09":100.52,"2024-10":91.36,"2024-11":89.64,"2024-12":87.1,"2025-01":88.8,"2025-02":99.62,"2025-03":100.19,"2025-04":101.49,"2025-05":100.86,"2025-06":98.97,"2025-07":94.97,"2025-08":96.51,"2025-09":92.78,"2025-10":96.38,"2025-11":102.29,"2025-12":97.8,"2026-01":104.65,"2026-02":114.09,"2026-03":106.39,"2026-04":110.18,"2026-05":110.53,"2026-06":113.69,"2026-07":122.53,"2026-08":124.04,"2026-09":120.42,"2026-10":128.35,"2026-11":136.31},"WMT":{"2023-12":73.51,"2024-01":77.06,"2024-02":81.99,"2024-03":84.17,"2024-04":83.02,"2024-05":91.99,"2024-06":94.72,"2024-07":96.02,"2024-08":108.04,"2024-09":112.96,"2024-10":114.64,"2024-11":129.4,"2024-12":126.39,"2025-01":137.32,"2025-02":137.95,"2025-03":122.81,"2025-04":136.04,"2025-05":138.1,"2025-06":136.78,"2025-07":137.06,"2025-08":135.67,"2025-09":144.17,"2025-10":141.54,"2025-11":154.59,"2025-12":155.85,"2026-01":166.66,"2026-02":178.99,"2026-03":173.86,"2026-04":184.56,"2026-05":161.92,"2026-06":158.44,"2026-07":155.56,"2026-08":146.7,"2026-09":145.37,"2026-10":162.55,"2026-11":176.53},"GE":{"2023-12":142.49,"2024-01":147.84,"2024-02":175.16,"2024-03":195.97,"2024-04":226.37,"2024-05":231.01,"2024-06":222.38,"2024-07":238.09,"2024-08":244.28,"2024-09":263.8,"2024-10":240.3,"2024-11":254.82,"2024-12":233.32,"2025-01":284.77,"2025-02":289.54,"2025-03":279.99,"2025-04":281.93,"2025-05":344,"2025-06":360.06,"2025-07":379.21,"2025-08":384.98,"2025-09":420.82,"2025-10":432.19,"2025-11":417.5,"2025-12":430.9,"2026-01":429.17,"2026-02":478.79,"2026-03":396.97,"2026-04":405.58,"2026-05":452.91,"2026-06":522.81,"2026-07":503.7,"2026-08":469.62,"2026-09":436.86,"2026-10":429.35,"2026-11":462.84},"CAT":{"2023-12":413.61,"2024-01":420.1,"2024-02":467.18,"2024-03":512.6,"2024-04":468.03,"2024-05":473.56,"2024-06":465.97,"2024-07":484.3,"2024-08":498.15,"2024-09":547.14,"2024-10":526.27,"2024-11":568.11,"2024-12":507.46,"2025-01":519.61,"2025-02":481.15,"2025-03":461.36,"2025-04":432.64,"2025-05":486.86,"2025-06":543.07,"2025-07":612.75,"2025-08":586.2,"2025-09":667.49,"2025-10":807.53,"2025-11":805.43,"2025-12":801.39,"2026-01":919.58,"2026-02":1039.14,"2026-03":991.06,"2026-04":1245.17,"2026-05":1225.25,"2026-06":1489.69,"2026-07":1139.84,"2026-08":1115.58,"2026-09":1134.21,"2026-10":1047.93,"2026-11":846.73},"ETN":{"2023-12":336.88,"2024-01":344.24,"2024-02":404.28,"2024-03":437.41,"2024-04":445.21,"2024-05":465.62,"2024-06":438.63,"2024-07":426.37,"2024-08":429.36,"2024-09":463.65,"2024-10":463.85,"2024-11":525.18,"2024-12":464.25,"2025-01":456.66,"2025-02":410.33,"2025-03":380.26,"2025-04":411.79,"2025-05":447.93,"2025-06":499.39,"2025-07":538.18,"2025-08":488.41,"2025-09":523.54,"2025-10":533.76,"2025-11":483.87,"2025-12":445.56,"2026-01":491.6,"2026-02":525.87,"2026-03":500.34,"2026-04":605.74,"2026-05":560.4,"2026-06":596.1,"2026-07":580.82,"2026-08":562.19,"2026-09":601.12,"2026-10":572.05,"2026-11":502.26},"RHMDE":{"2023-11":450.68,"2023-12":510.03,"2024-01":665.81,"2024-02":818.13,"2024-03":812.16,"2024-04":828.8,"2024-05":746.99,"2024-06":791.12,"2024-07":851.1,"2024-08":763.79,"2024-09":743.07,"2024-10":977.35,"2024-11":965.11,"2024-12":1186.2,"2025-01":1580.51,"2025-02":2071.23,"2025-03":2353.88,"2025-04":2960.02,"2025-05":2821.83,"2025-06":2725.26,"2025-07":2653.02,"2025-08":3116.26,"2025-09":2671.87,"2025-10":2324.83,"2025-11":2451.24,"2025-12":2797.49,"2026-01":2612.19,"2026-02":2268.3,"2026-03":2129.01,"2026-04":2031.03,"2026-05":1555.38,"2026-06":1790.14,"2026-07":1744.29,"2026-08":1501.83,"2026-09":1629.34,"2026-10":1610.73,"2026-11":1195.16},"BLK":{"2023-12":1135.63,"2024-01":1083.18,"2024-02":1134.98,"2024-03":1166.26,"2024-04":1055.67,"2024-05":1079.99,"2024-06":1101.38,"2024-07":1226.14,"2024-08":1261.54,"2024-09":1328.27,"2024-10":1372.36,"2024-11":1430.79,"2024-12":1434.03,"2025-01":1504.52,"2025-02":1367.82,"2025-03":1324.03,"2025-04":1278.96,"2025-05":1370.77,"2025-06":1467.8,"2025-07":1547.2,"2025-08":1576.76,"2025-09":1630.94,"2025-10":1514.74,"2025-11":1465.07,"2025-12":1497.3,"2026-01":1565.29,"2026-02":1487.35,"2026-03":1345.34,"2026-04":1490.67,"2026-05":1464.48,"2026-06":1345.13,"2026-07":1525.35,"2026-08":1616.58,"2026-09":1480.44,"2026-10":1502.14,"2026-11":1701.92},"SOL":{"2023-12":134.49,"2024-01":130.33,"2024-02":170.57,"2024-03":274.34,"2024-04":174.93,"2024-05":225.97,"2024-06":200.32,"2024-07":237.26,"2024-08":182.72,"2024-09":206.43,"2024-10":234.71,"2024-11":333.14,"2024-12":272.4,"2025-01":336.86,"2025-02":214.15,"2025-03":179.47,"2025-04":203.66,"2025-05":215.23,"2025-06":210.54,"2025-07":238.95,"2025-08":275.98,"2025-09":290.66,"2025-10":263.09,"2025-11":186.6,"2025-12":170.86,"2026-01":143.66,"2026-02":115.15,"2026-03":115.55,"2026-04":112.75,"2026-05":113.55,"2026-06":104.46,"2026-07":102.13,"2026-08":142.68,"2026-09":167.98,"2026-10":143.93,"2026-11":116.15},"AZN":{"2023-12":188.43,"2024-01":186.45,"2024-02":179.51,"2024-03":189.55,"2024-04":212.3,"2024-05":218.28,"2024-06":218.2,"2024-07":221.45,"2024-08":245.14,"2024-09":217.98,"2024-10":199.06,"2024-11":189.19,"2024-12":183.31,"2025-01":197.97,"2025-02":213.22,"2025-03":205.64,"2025-04":200.85,"2025-05":203.76,"2025-06":195.51,"2025-07":204.49,"2025-08":223.54,"2025-09":214.65,"2025-10":230.54,"2025-11":259.41,"2025-12":257.2,"2026-01":259.55,"2026-02":291.6,"2026-03":275.89,"2026-04":262.11,"2026-05":259.73,"2026-06":265.26,"2026-07":237.31,"2026-08":226.8,"2026-09":225.88,"2026-10":226.65,"2026-11":257.93},"AAVE":{"2023-12":144.5,"2024-01":115.46,"2024-02":143.51,"2024-03":173.43,"2024-04":114.86,"2024-05":141.8,"2024-06":132.93,"2024-07":148.54,"2024-08":175.2,"2024-09":211.64,"2024-10":199.9,"2024-11":296.9,"2024-12":444.22,"2025-01":483.57,"2025-02":278.59,"2025-03":229.74,"2025-04":226.61,"2025-05":339.79,"2025-06":373.71,"2025-07":361.78,"2025-08":433.98,"2025-09":382.23,"2025-10":321.11,"2025-11":248.4,"2025-12":200.6,"2026-01":175.52,"2026-02":152.95,"2026-03":136.36,"2026-04":126.04,"2026-05":113.21,"2026-06":120.78,"2026-07":131.45,"2026-08":171.85,"2026-09":226.88,"2026-10":201.77,"2026-11":163.23},"LINK":{"2023-12":19.8,"2024-01":20.68,"2024-02":26.17,"2024-03":25.88,"2024-04":18.1,"2024-05":25.13,"2024-06":19.5,"2024-07":17.71,"2024-08":14.88,"2024-09":16.03,"2024-10":15.92,"2024-11":26.66,"2024-12":28.79,"2025-01":36.57,"2025-02":21.43,"2025-03":19.45,"2025-04":19.72,"2025-05":19.2,"2025-06":18.21,"2025-07":23.5,"2025-08":31.91,"2025-09":29.7,"2025-10":24.23,"2025-11":18.14,"2025-12":16.73,"2026-01":13.58,"2026-02":12.07,"2026-03":12.2,"2026-04":12.36,"2026-05":12.59,"2026-06":10.21,"2026-07":11.45,"2026-08":15.67,"2026-09":20.44,"2026-10":16.53,"2026-11":14.4},"NESN":{"2023-11":167.19,"2023-12":168.99,"2024-01":157.33,"2024-02":164.17,"2024-03":158.09,"2024-04":163.85,"2024-05":157.26,"2024-06":152.84,"2024-07":156.06,"2024-08":145.67,"2024-09":139.88,"2024-10":131.13,"2024-11":128.39,"2024-12":132.85,"2025-01":149.38,"2025-02":153.18,"2025-03":150.44,"2025-04":150.37,"2025-05":135.16,"2025-06":121.91,"2025-07":129.26,"2025-08":125.29,"2025-09":131.82,"2025-10":136.88,"2025-11":135.01,"2025-12":125.9,"2026-01":143.99,"2026-02":134.46,"2026-03":135.54,"2026-04":136.21,"2026-05":142.45,"2026-06":138.9,"2026-07":135.14,"2026-08":130.34,"2026-09":145.23,"2026-10":139.05,"2026-11":149.34},"SUI":{"2023-12":1.0889,"2024-01":2.1253,"2024-02":2.3417,"2024-03":2.6816,"2024-04":1.5975,"2024-05":1.4334,"2024-06":1.1454,"2024-07":0.9903,"2024-08":1.1144,"2024-09":2.4874,"2024-10":2.7568,"2024-11":4.8724,"2024-12":5.7591,"2025-01":5.7114,"2025-02":3.9608,"2025-03":3.1752,"2025-04":4.9072,"2025-05":4.5444,"2025-06":3.8843,"2025-07":5.0636,"2025-08":4.5479,"2025-09":4.5617,"2025-10":3.3072,"2025-11":2.1008,"2025-12":1.9621,"2026-01":1.6104,"2026-02":1.2655,"2026-03":1.2286,"2026-04":1.27,"2026-05":1.2508,"2026-06":0.9649,"2026-07":0.953,"2026-08":1.0162,"2026-09":1.6268,"2026-10":1.3423,"2026-11":1.1436},"ADA":{"2023-12":0.7873,"2024-01":0.6693,"2024-02":0.8896,"2024-03":0.8795,"2024-04":0.6073,"2024-05":0.6104,"2024-06":0.5363,"2024-07":0.5368,"2024-08":0.4661,"2024-09":0.5048,"2024-10":0.4764,"2024-11":1.5119,"2024-12":1.2144,"2025-01":1.3702,"2025-02":0.9158,"2025-03":0.952,"2025-04":0.9407,"2025-05":0.9427,"2025-06":0.7785,"2025-07":1.0256,"2025-08":1.1148,"2025-09":1.124,"2025-10":0.8561,"2025-11":0.581,"2025-12":0.4568,"2026-01":0.3999,"2026-02":0.3844,"2026-03":0.3359,"2026-04":0.3343,"2026-05":0.3246,"2026-06":0.2048,"2026-07":0.2357,"2026-08":0.274,"2026-09":0.3511,"2026-10":0.2946,"2026-11":0.2475},"MELI":{"2023-12":2198.43,"2024-01":2394.65,"2024-02":2231.67,"2024-03":2115.08,"2024-04":2040.58,"2024-05":2413.91,"2024-06":2298.95,"2024-07":2334.62,"2024-08":2884.06,"2024-09":2870.49,"2024-10":2849.81,"2024-11":2777.05,"2024-12":2378.75,"2025-01":2688.95,"2025-02":2968.28,"2025-03":2729.07,"2025-04":3260.63,"2025-05":3585.79,"2025-06":3656.21,"2025-07":3320.83,"2025-08":3459.35,"2025-09":3269.15,"2025-10":3255.6,"2025-11":2898.21,"2025-12":2817.75,"2026-01":3004.54,"2026-02":2458.68,"2026-03":2418.73,"2026-04":2507.71,"2026-05":2372.04,"2026-06":2374.48,"2026-07":2627.06,"2026-08":2708.55,"2026-09":2418.04,"2026-10":2572.94,"2026-11":2063.5},"RACE":{"2023-12":473.43,"2024-01":483.91,"2024-02":594.21,"2024-03":609.84,"2024-04":581.52,"2024-05":574.95,"2024-06":571.27,"2024-07":577.76,"2024-08":694.96,"2024-09":657.64,"2024-10":665.71,"2024-11":607.35,"2024-12":594.31,"2025-01":599.46,"2025-02":649.89,"2025-03":598.56,"2025-04":645.98,"2025-05":669.74,"2025-06":686.5,"2025-07":620.26,"2025-08":667.57,"2025-09":678.77,"2025-10":565.09,"2025-11":548.23,"2025-12":516.98,"2026-01":466.07,"2026-02":531.47,"2026-03":473.46,"2026-04":485.84,"2026-05":475.95,"2026-06":520.8,"2026-07":550.98,"2026-08":591.18,"2026-09":549.56,"2026-10":541.78,"2026-11":567.24},"SONY":{"2023-12":26.49,"2024-01":27.35,"2024-02":24.01,"2024-03":23.99,"2024-04":23.1,"2024-05":23.04,"2024-06":23.77,"2024-07":24.79,"2024-08":27.3,"2024-09":27.02,"2024-10":24.62,"2024-11":28.05,"2024-12":29.6,"2025-01":30.79,"2025-02":35.03,"2025-03":35.52,"2025-04":36.37,"2025-05":36.9,"2025-06":36.41,"2025-07":34.02,"2025-08":38.5,"2025-09":40.27,"2025-10":39.02,"2025-11":41.06,"2025-12":35.81,"2026-01":30.92,"2026-02":32.26,"2026-03":28.96,"2026-04":28.1,"2026-05":30.17,"2026-06":28.06,"2026-07":32.54,"2026-08":34.36,"2026-09":32.92,"2026-10":34.09,"2026-11":37.29},"BNB":{"2023-12":413.98,"2024-01":403.44,"2024-02":542.44,"2024-03":820.69,"2024-04":797.03,"2024-05":809.7,"2024-06":795.56,"2024-07":795.87,"2024-08":719.28,"2024-09":767.26,"2024-10":802.7,"2024-11":916.88,"2024-12":1008.9,"2025-01":985.07,"2025-02":849.84,"2025-03":870.87,"2025-04":827.2,"2025-05":904.81,"2025-06":894,"2025-07":1086.04,"2025-08":1178.61,"2025-09":1404.24,"2025-10":1530.36,"2025-11":1226.02,"2025-12":1184.84,"2026-01":1063.37,"2026-02":842.45,"2026-03":857.95,"2026-04":835.28,"2026-05":977.68,"2026-06":775.29,"2026-07":822.85,"2026-08":957.24,"2026-09":1093.61,"2026-10":1034.23,"2026-11":917.36},"TAO":{"2023-12":372.66,"2024-01":655.05,"2024-02":865.99,"2024-03":731.59,"2024-04":543.27,"2024-05":544.35,"2024-06":380.1,"2024-07":422.6,"2024-08":393.84,"2024-09":808.59,"2024-10":677.25,"2024-11":948.48,"2024-12":616.51,"2025-01":627.69,"2025-02":456.37,"2025-03":313.11,"2025-04":495.94,"2025-05":603.47,"2025-06":467.98,"2025-07":494.38,"2025-08":441.77,"2025-09":423.91,"2025-10":674.23,"2025-11":406.1,"2025-12":306.07,"2026-01":277.18,"2026-02":256.45,"2026-03":428.55,"2026-04":347.97,"2026-05":357.44,"2026-06":282.33,"2026-07":270.05,"2026-08":322.08,"2026-09":420.78,"2026-10":356.56,"2026-11":299.87},"AVAX":{"2023-12":51.07,"2024-01":44.54,"2024-02":55.54,"2024-03":73.17,"2024-04":45.06,"2024-05":49.19,"2024-06":40.15,"2024-07":35.51,"2024-08":30.77,"2024-09":37.52,"2024-10":34.86,"2024-11":62.91,"2024-12":51.37,"2025-01":50.02,"2025-02":32.36,"2025-03":27.01,"2025-04":28.84,"2025-05":28.58,"2025-06":24.46,"2025-07":31.18,"2025-08":32.16,"2025-09":41.78,"2025-10":25.57,"2025-11":19.24,"2025-12":16.89,"2026-01":13.77,"2026-02":12.51,"2026-03":12.39,"2026-04":12.34,"2026-05":12.36,"2026-06":9.27,"2026-07":8.95,"2026-08":10.02,"2026-09":15.56,"2026-10":12.67,"2026-11":12.2},"XRP":{"2023-12":0.8148,"2024-01":0.6759,"2024-02":0.7956,"2024-03":0.8509,"2024-04":0.689,"2024-05":0.7064,"2024-06":0.6502,"2024-07":0.8616,"2024-08":0.7644,"2024-09":0.8271,"2024-10":0.7096,"2024-11":2.7242,"2024-12":2.9938,"2025-01":4.4143,"2025-02":3.1039,"2025-03":3.008,"2025-04":3.023,"2025-05":2.9886,"2025-06":3.0462,"2025-07":4.1924,"2025-08":3.815,"2025-09":3.9641,"2025-10":3.5256,"2025-11":3.019,"2025-12":2.5254,"2026-01":2.2419,"2026-02":1.8797,"2026-03":1.8635,"2026-04":1.857,"2026-05":1.8369,"2026-06":1.4754,"2026-07":1.4881,"2026-08":1.9103,"2026-09":2.1189,"2026-10":1.8114,"2026-11":1.4727},"RNDR":{"2023-12":6.24,"2024-01":6.05,"2024-02":10.5,"2024-03":14.91,"2024-04":10.28,"2024-05":14.16,"2024-06":10.74,"2024-07":8.04,"2024-08":6.99,"2024-09":9.02,"2024-10":6.68,"2024-11":12.43,"2024-12":9.49,"2025-01":8.18,"2025-02":5.34,"2025-03":4.77,"2025-04":6.24,"2025-05":5.43,"2025-06":4.5,"2025-07":5.22,"2025-08":4.79,"2025-09":4.67,"2025-10":3.12,"2025-11":2.4,"2025-12":1.8,"2026-01":2.17,"2026-02":1.97,"2026-03":2.43,"2026-04":2.34,"2026-05":2.91,"2026-06":2.11,"2026-07":1.92,"2026-08":1.99,"2026-09":2.67,"2026-10":2.42,"2026-11":2.16},"XEQT":{"2023-12":27.66,"2024-01":28.05,"2024-02":29.33,"2024-03":30.19,"2024-04":29.57,"2024-05":30.58,"2024-06":30.64,"2024-07":31.75,"2024-08":31.83,"2024-09":32.5,"2024-10":32.72,"2024-11":34.47,"2024-12":33.68,"2025-01":35.12,"2025-02":34.92,"2025-03":33.65,"2025-04":32.81,"2025-05":34.6,"2025-06":35.47,"2025-07":36.28,"2025-08":37.3,"2025-09":38.95,"2025-10":39.83,"2025-11":40.34,"2025-12":39.89,"2026-01":40.65,"2026-02":42.04,"2026-03":40.06,"2026-04":42.38,"2026-05":44.49,"2026-06":45.1,"2026-07":44.8,"2026-08":45.63,"2026-09":45.57,"2026-10":45.63,"2026-11":45.58},"DOGE":{"2023-12":0.1185,"2024-01":0.1058,"2024-02":0.159,"2024-03":0.2976,"2024-04":0.1837,"2024-05":0.2171,"2024-06":0.17,"2024-07":0.1685,"2024-08":0.1368,"2024-09":0.1548,"2024-10":0.2249,"2024-11":0.5913,"2024-12":0.4543,"2025-01":0.4781,"2025-02":0.2922,"2025-03":0.24,"2025-04":0.2377,"2025-05":0.2646,"2025-06":0.2247,"2025-07":0.2909,"2025-08":0.2938,"2025-09":0.3243,"2025-10":0.262,"2025-11":0.2049,"2025-12":0.161,"2026-01":0.1418,"2026-02":0.1284,"2026-03":0.1282,"2026-04":0.1446,"2026-05":0.1383,"2026-06":0.1023,"2026-07":0.0975,"2026-08":0.1147,"2026-09":0.1345,"2026-10":0.1099,"2026-11":0.0941},"DOT":{"2023-12":10.857,"2024-01":8.9402,"2024-02":11.2009,"2024-03":13.0392,"2024-04":8.8484,"2024-05":9.5321,"2024-06":8.4901,"2024-07":7.4363,"2024-08":5.7479,"2024-09":6.0015,"2024-10":5.5133,"2024-11":12.5654,"2024-12":9.5494,"2025-01":9.1885,"2025-02":6.818,"2025-03":5.7897,"2025-04":5.6116,"2025-05":5.6086,"2025-06":4.6257,"2025-07":5.1118,"2025-08":5.1414,"2025-09":5.4412,"2025-10":4.0507,"2025-11":3.0995,"2025-12":2.4557,"2026-01":2.1037,"2026-02":2.2802,"2026-03":1.7403,"2026-04":1.6343,"2026-05":1.6368,"2026-06":1.1659,"2026-07":1.0637,"2026-08":1.1636,"2026-09":1.7391,"2026-10":1.5177,"2026-11":1.2005},"QQQ":{"2023-12":572.88,"2024-01":583.3,"2024-02":614.12,"2024-03":621.13,"2024-04":593.96,"2024-05":630.5,"2024-06":670.23,"2024-07":658.98,"2024-08":666.25,"2024-09":682.76,"2024-10":676.86,"2024-11":713.08,"2024-12":715.16,"2025-01":730.63,"2025-02":710.88,"2025-03":655.97,"2025-04":665.13,"2025-05":726.18,"2025-06":771.69,"2025-07":790.39,"2025-08":797.93,"2025-09":839.86,"2025-10":880.01,"2025-11":866.27,"2025-12":859.36,"2026-01":869.93,"2026-02":849.54,"2026-03":807.42,"2026-04":934.1,"2026-05":1032.82,"2026-06":1030.15,"2026-07":962.43,"2026-08":1002.68,"2026-09":1034.86,"2026-10":1019.79,"2026-11":962.68},"VFV":{"2023-12":112.12,"2024-01":115.53,"2024-02":122.87,"2024-03":126.13,"2024-04":123.06,"2024-05":127.83,"2024-06":132.46,"2024-07":135.3,"2024-08":135.19,"2024-09":138.05,"2024-10":140.91,"2024-11":150.36,"2024-12":149.99,"2025-01":155.78,"2025-02":153,"2025-03":143.03,"2025-04":136.13,"2025-05":143.95,"2025-06":149.87,"2025-07":155.91,"2025-08":157.46,"2025-09":164.99,"2025-10":170.28,"2025-11":170.08,"2025-12":166.62,"2026-01":167.64,"2026-02":166.62,"2026-03":160.99,"2026-04":173.81,"2026-05":185.61,"2026-06":188.37,"2026-07":186.29,"2026-08":189.16,"2026-09":193.12,"2026-10":194.79,"2026-11":192.06},"SCHD":{"2023-12":35.5,"2024-01":35.55,"2024-02":36.2,"2024-03":37.6,"2024-04":35.9,"2024-05":36.64,"2024-06":36.26,"2024-07":38.51,"2024-08":39.42,"2024-09":39.42,"2024-10":39.49,"2024-11":41.31,"2024-12":38.22,"2025-01":38.93,"2025-02":39.92,"2025-03":39.11,"2025-04":36.12,"2025-05":36.61,"2025-06":37.07,"2025-07":37.07,"2025-08":39.06,"2025-09":38.19,"2025-10":37.42,"2025-11":38.6,"2025-12":38.37,"2026-01":41.72,"2026-02":44.44,"2026-03":42.92,"2026-04":44.86,"2026-05":45.46,"2026-06":44.36,"2026-07":46.82,"2026-08":48.81,"2026-09":45.51,"2026-10":47.15,"2026-11":50.26},"VDY":{"2023-12":42.59,"2024-01":42.28,"2024-02":42.7,"2024-03":44.38,"2024-04":43.34,"2024-05":44.56,"2024-06":43.33,"2024-07":45.74,"2024-08":46.78,"2024-09":48.2,"2024-10":48.55,"2024-11":50.73,"2024-12":49.33,"2025-01":50.24,"2025-02":50,"2025-03":49.51,"2025-04":48.91,"2025-05":51.25,"2025-06":52.1,"2025-07":53.01,"2025-08":55.5,"2025-09":58.01,"2025-10":58.08,"2025-11":60.62,"2025-12":61.97,"2026-01":63.09,"2026-02":67.08,"2026-03":67.03,"2026-04":71.19,"2026-05":72.53,"2026-06":76,"2026-07":78.46,"2026-08":76.55,"2026-09":75.3,"2026-10":76.75,"2026-11":78.44},"ARB":{"2023-12":2.1756,"2024-01":2.4674,"2024-02":2.7211,"2024-03":2.3269,"2024-04":1.4299,"2024-05":1.5668,"2024-06":1.1204,"2024-07":0.92,"2024-08":0.7183,"2024-09":0.8454,"2024-10":0.7366,"2024-11":1.3618,"2024-12":1.009,"2025-01":0.8968,"2025-02":0.5901,"2025-03":0.4588,"2025-04":0.4559,"2025-05":0.4758,"2025-06":0.4832,"2025-07":0.5573,"2025-08":0.6947,"2025-09":0.5894,"2025-10":0.4129,"2025-11":0.2957,"2025-12":0.261,"2026-01":0.1956,"2026-02":0.1393,"2026-03":0.1299,"2026-04":0.173,"2026-05":0.1445,"2026-06":0.1063,"2026-07":0.1094,"2026-08":0.153,"2026-09":0.2838,"2026-10":0.24,"2026-11":0.2074},"ZAG":{"2023-12":13.83,"2024-01":13.6,"2024-02":13.52,"2024-03":13.55,"2024-04":13.23,"2024-05":13.41,"2024-06":13.54,"2024-07":13.79,"2024-08":13.84,"2024-09":14.03,"2024-10":13.87,"2024-11":14.05,"2024-12":13.95,"2025-01":14.04,"2025-02":14.14,"2025-03":14.07,"2025-04":13.95,"2025-05":13.9,"2025-06":13.88,"2025-07":13.68,"2025-08":13.74,"2025-09":13.94,"2025-10":14,"2025-11":14.01,"2025-12":13.78,"2026-01":13.83,"2026-02":14,"2026-03":13.67,"2026-04":13.65,"2026-05":13.82,"2026-06":13.84,"2026-07":13.62,"2026-08":13.53,"2026-09":13.3,"2026-10":13.45,"2026-11":13.5},"NEAR":{"2023-12":5.11,"2024-01":3.95,"2024-02":5.41,"2024-03":10.22,"2024-04":8.65,"2024-05":10.14,"2024-06":7.42,"2024-07":6.99,"2024-08":5.64,"2024-09":7.4,"2024-10":5.67,"2024-11":9.8,"2024-12":6.86,"2025-01":6.46,"2025-02":4.29,"2025-03":3.52,"2025-04":3.45,"2025-05":3.39,"2025-06":3,"2025-07":3.55,"2025-08":3.31,"2025-09":3.68,"2025-10":2.94,"2025-11":2.53,"2025-12":2.12,"2026-01":1.69,"2026-02":1.63,"2026-03":1.66,"2026-04":1.81,"2026-05":3.25,"2026-06":2.49,"2026-07":2.32,"2026-08":2.68,"2026-09":7.47,"2026-10":6.55,"2026-11":5},"UNI":{"2023-12":10.11,"2024-01":8.39,"2024-02":15.57,"2024-03":18.13,"2024-04":9.84,"2024-05":13.94,"2024-06":12.97,"2024-07":10.09,"2024-08":8.31,"2024-09":10.35,"2024-10":10.64,"2024-11":17.89,"2024-12":18.49,"2025-01":16.46,"2025-02":10.49,"2025-03":8.35,"2025-04":7.37,"2025-05":8.47,"2025-06":9.98,"2025-07":13.08,"2025-08":13.46,"2025-09":10.68,"2025-10":8.03,"2025-11":8.48,"2025-12":7.87,"2026-01":5.52,"2026-02":5.33,"2026-03":4.95,"2026-04":4.46,"2026-05":4.22,"2026-06":3.88,"2026-07":6.08,"2026-08":7.32,"2026-09":12.4,"2026-10":9.73,"2026-11":8.32},"XIU":{"2023-12":32.02,"2024-01":32.18,"2024-02":32.54,"2024-03":33.75,"2024-04":33.02,"2024-05":33.63,"2024-06":33.04,"2024-07":35.03,"2024-08":35.31,"2024-09":36.39,"2024-10":36.67,"2024-11":38.78,"2024-12":37.47,"2025-01":39.04,"2025-02":38.59,"2025-03":37.87,"2025-04":37.84,"2025-05":39.53,"2025-06":40.41,"2025-07":41.1,"2025-08":42.76,"2025-09":44.77,"2025-10":45.14,"2025-11":46.43,"2025-12":46.99,"2026-01":46.9,"2026-02":49.71,"2026-03":48.15,"2026-04":50.19,"2026-05":50.86,"2026-06":51.81,"2026-07":52.76,"2026-08":53.65,"2026-09":52.35,"2026-10":53.32,"2026-11":54.55},"TLT":{"2023-12":138.32,"2024-01":135.22,"2024-02":131.75,"2024-03":132.36,"2024-04":123.41,"2024-05":126.53,"2024-06":128.39,"2024-07":132.63,"2024-08":134.98,"2024-09":137.23,"2024-10":129.33,"2024-11":131.45,"2024-12":122.17,"2025-01":122.77,"2025-02":129.3,"2025-03":127.34,"2025-04":125.16,"2025-05":120.7,"2025-06":123.45,"2025-07":121.59,"2025-08":121.14,"2025-09":125.02,"2025-10":126.31,"2025-11":126.19,"2025-12":121.93,"2026-01":121.89,"2026-02":127.05,"2026-03":121.27,"2026-04":119.77,"2026-05":119.97,"2026-06":120.89,"2026-07":115.06,"2026-08":115.44,"2026-09":108.81,"2026-10":110.31,"2026-11":111.52},"SLV":{"2023-12":30.47,"2024-01":29.25,"2024-02":29,"2024-03":31.82,"2024-04":33.64,"2024-05":38.83,"2024-06":37.17,"2024-07":36.92,"2024-08":36.86,"2024-09":39.74,"2024-10":41.7,"2024-11":39.06,"2024-12":36.83,"2025-01":39.88,"2025-02":39.6,"2025-03":43.35,"2025-04":41.41,"2025-05":41.97,"2025-06":45.9,"2025-07":46.61,"2025-08":50.63,"2025-09":59.27,"2025-10":61.57,"2025-11":71.64,"2025-12":90.12,"2026-01":105.53,"2026-02":118.89,"2026-03":95.32,"2026-04":93.25,"2026-05":95.59,"2026-06":74.8,"2026-07":73.25,"2026-08":84.12,"2026-09":76.25,"2026-10":70.29,"2026-11":63.12},"CRWD":{"2023-12":89.29,"2024-01":102.29,"2024-02":113.36,"2024-03":112.12,"2024-04":102.31,"2024-05":109.7,"2024-06":134.01,"2024-07":81.12,"2024-08":96.97,"2024-09":98.09,"2024-10":103.82,"2024-11":120.99,"2024-12":119.66,"2025-01":139.22,"2025-02":136.27,"2025-03":123.31,"2025-04":149.99,"2025-05":164.85,"2025-06":178.12,"2025-07":158.97,"2025-08":148.18,"2025-09":171.5,"2025-10":189.9,"2025-11":178.07,"2025-12":163.94,"2026-01":154.37,"2026-02":130.09,"2026-03":136.54,"2026-04":155.89,"2026-05":255.65,"2026-06":266.89,"2026-07":266.99,"2026-08":323.15,"2026-09":370.36,"2026-10":348.77,"2026-11":321.57},"HURA":{"2023-12":34.75,"2024-01":38.8,"2024-02":35.22,"2024-03":36.31,"2024-04":37.9,"2024-05":41.72,"2024-06":37.42,"2024-07":35.49,"2024-08":31.62,"2024-09":35.2,"2024-10":38.64,"2024-11":40.54,"2024-12":35.54,"2025-01":36.29,"2025-02":30.7,"2025-03":27.45,"2025-04":28.39,"2025-05":36.05,"2025-06":42.49,"2025-07":44.6,"2025-08":47.01,"2025-09":56.87,"2025-10":64.71,"2025-11":52.96,"2025-12":50.84,"2026-01":67.33,"2026-02":62.12,"2026-03":56.8,"2026-04":62.28,"2026-05":56.99,"2026-06":51.19,"2026-07":46.92,"2026-08":52.6,"2026-09":46.35,"2026-10":42.16,"2026-11":39.59},"XRE":{"2023-12":16.11,"2024-01":15.83,"2024-02":15.46,"2024-03":15.8,"2024-04":14.74,"2024-05":14.74,"2024-06":14.61,"2024-07":15.81,"2024-08":16.75,"2024-09":17.78,"2024-10":16.18,"2024-11":16.01,"2024-12":14.9,"2025-01":14.69,"2025-02":14.93,"2025-03":14.96,"2025-04":14.78,"2025-05":15.59,"2025-06":15.72,"2025-07":15.73,"2025-08":16.17,"2025-09":16.16,"2025-10":15.64,"2025-11":15.55,"2025-12":15.43,"2026-01":16.13,"2026-02":16.29,"2026-03":15.43,"2026-04":16.6,"2026-05":16.81,"2026-06":17.1,"2026-07":17.07,"2026-08":16.02,"2026-09":15.61,"2026-10":15.47,"2026-11":15.5},"TRP":{"2023-12":47.18,"2024-01":48.35,"2024-02":48.93,"2024-03":49.63,"2024-04":44.96,"2024-05":47.91,"2024-06":47.27,"2024-07":53.44,"2024-08":56.9,"2024-09":58.61,"2024-10":64.76,"2024-11":68.26,"2024-12":66.99,"2025-01":65.49,"2025-02":64.75,"2025-03":67.96,"2025-04":69.65,"2025-05":69.54,"2025-06":66.48,"2025-07":66.16,"2025-08":71.52,"2025-09":75.67,"2025-10":70.38,"2025-11":75.5,"2025-12":75.58,"2026-01":79.84,"2026-02":87.65,"2026-03":87.11,"2026-04":91.08,"2026-05":91.86,"2026-06":93.92,"2026-07":94.4,"2026-08":86.78,"2026-09":82.39,"2026-10":87.08,"2026-11":92.04},"SUTO":{"2023-12":42.45,"2024-01":44.52,"2024-02":46.63,"2024-03":49.99,"2024-04":52.53,"2024-05":55.6,"2024-06":52.15,"2024-07":55.14,"2024-08":54.66,"2024-09":49.92,"2024-10":52.56,"2024-11":55.71,"2024-12":51.31,"2025-01":54.53,"2025-02":55.36,"2025-03":55.72,"2025-04":48.69,"2025-05":48.79,"2025-06":51.01,"2025-07":54.65,"2025-08":56.77,"2025-09":58.24,"2025-10":55.85,"2025-11":62.84,"2025-12":60.92,"2026-01":71.97,"2026-02":77.05,"2026-03":92.01,"2026-04":93.08,"2026-05":86.17,"2026-06":76.3,"2026-07":94.14,"2026-08":92.73,"2026-09":96.5,"2026-10":107.86,"2026-11":98.8},"PLD":{"2023-12":186.47,"2024-01":177.23,"2024-02":186.43,"2024-03":182.16,"2024-04":142.76,"2024-05":154.56,"2024-06":157.11,"2024-07":176.33,"2024-08":178.81,"2024-09":176.65,"2024-10":157.99,"2024-11":163.36,"2024-12":147.86,"2025-01":166.82,"2025-02":173.35,"2025-03":156.38,"2025-04":142.97,"2025-05":151.92,"2025-06":147.05,"2025-07":149.37,"2025-08":159.17,"2025-09":160.2,"2025-10":173.59,"2025-11":179.8,"2025-12":178.58,"2026-01":182.64,"2026-02":199.44,"2026-03":184.91,"2026-04":198.67,"2026-05":200.7,"2026-06":189.51,"2026-07":202.29,"2026-08":195.73,"2026-09":181.63,"2026-10":182.57,"2026-11":179.83},"CM":{"2023-12":63.8,"2024-01":60.76,"2024-02":64.22,"2024-03":68.67,"2024-04":64.26,"2024-05":67.58,"2024-06":65.05,"2024-07":71.4,"2024-08":78.76,"2024-09":82.96,"2024-10":87.11,"2024-11":90.88,"2024-12":90.93,"2025-01":91.55,"2025-02":87.67,"2025-03":80.95,"2025-04":86.95,"2025-05":93.43,"2025-06":96.66,"2025-07":99.03,"2025-08":106.09,"2025-09":111.21,"2025-10":116.21,"2025-11":120.83,"2025-12":124.43,"2026-01":125.84,"2026-02":137.79,"2026-03":131.84,"2026-04":151.57,"2026-05":150.49,"2026-06":163.32,"2026-07":166.04,"2026-08":157.31,"2026-09":156.73,"2026-10":157.35,"2026-11":165.53},"GIBA":{"2023-12":141.95,"2024-01":150.56,"2024-02":155.82,"2024-03":149.44,"2024-04":139.49,"2024-05":134.59,"2024-06":136.55,"2024-07":157.43,"2024-08":151.83,"2024-09":155.62,"2024-10":154.24,"2024-11":158.48,"2024-12":157.28,"2025-01":171.33,"2025-02":149.97,"2025-03":143.66,"2025-04":146.18,"2025-05":147.53,"2025-06":143.01,"2025-07":133.58,"2025-08":133.36,"2025-09":123.96,"2025-10":122.06,"2025-11":124.47,"2025-12":126.78,"2026-01":116.7,"2026-02":99.76,"2026-03":101.7,"2026-04":88.91,"2026-05":96.28,"2026-06":91.67,"2026-07":102.61,"2026-08":104.36,"2026-09":96.75,"2026-10":102.92,"2026-11":116.81},"TIP":{"2023-12":150.37,"2024-01":150.87,"2024-02":149.29,"2024-03":150.26,"2024-04":147.63,"2024-05":149.26,"2024-06":149.37,"2024-07":151.33,"2024-08":152.3,"2024-09":154.54,"2024-10":151.51,"2024-11":152.14,"2024-12":149.05,"2025-01":151.1,"2025-02":154.35,"2025-03":155.4,"2025-04":154.61,"2025-05":152.89,"2025-06":153.93,"2025-07":153.42,"2025-08":155.52,"2025-09":155.59,"2025-10":155.81,"2025-11":155.64,"2025-12":153.75,"2026-01":154.55,"2026-02":156.51,"2026-03":154.38,"2026-04":156.06,"2026-05":155.57,"2026-06":153.08,"2026-07":150.56,"2026-08":149.43,"2026-09":145.54,"2026-10":146.56,"2026-11":146.56},"MU":{"2023-12":119.38,"2024-01":119.96,"2024-02":126.75,"2024-03":164.92,"2024-04":158.02,"2024-05":174.86,"2024-06":184,"2024-07":153.63,"2024-08":134.63,"2024-09":145.08,"2024-10":139.4,"2024-11":137.02,"2024-12":117.73,"2025-01":127.64,"2025-02":130.98,"2025-03":121.55,"2025-04":107.65,"2025-05":132.14,"2025-06":172.41,"2025-07":152.68,"2025-08":166.48,"2025-09":234.06,"2025-10":313.03,"2025-11":330.81,"2025-12":399.26,"2026-01":580.38,"2026-02":576.86,"2026-03":472.6,"2026-04":723.46,"2026-05":1358.33,"2026-06":1614.74,"2026-07":1151.34,"2026-08":1341.17,"2026-09":1489.98,"2026-10":1279.43,"2026-11":1116.94},"AMAT":{"2023-12":226.72,"2024-01":229.84,"2024-02":282.05,"2024-03":288.5,"2024-04":277.89,"2024-05":300.88,"2024-06":330.13,"2024-07":296.85,"2024-08":275.95,"2024-09":282.65,"2024-10":254.01,"2024-11":244.4,"2024-12":227.5,"2025-01":252.29,"2025-02":221.12,"2025-03":203.01,"2025-04":210.83,"2025-05":219.28,"2025-06":256.1,"2025-07":251.89,"2025-08":224.89,"2025-09":286.41,"2025-10":326.08,"2025-11":352.87,"2025-12":359.5,"2026-01":450.89,"2026-02":520.81,"2026-03":478.13,"2026-04":551.85,"2026-05":629.59,"2026-06":1011.4,"2026-07":710.18,"2026-08":641.24,"2026-09":715.37,"2026-10":624.75,"2026-11":532.91},"COPX":{"2023-12":52.46,"2024-01":50.63,"2024-02":50.33,"2024-03":59.36,"2024-04":64.03,"2024-05":67.41,"2024-06":63.1,"2024-07":61.19,"2024-08":60.63,"2024-09":66.13,"2024-10":61.12,"2024-11":59.64,"2024-12":53.41,"2025-01":53.41,"2025-02":53.47,"2025-03":54.66,"2025-04":52.89,"2025-05":57.49,"2025-06":62.95,"2025-07":60.22,"2025-08":69.68,"2025-09":83.67,"2025-10":86.4,"2025-11":89.95,"2025-12":100.43,"2026-01":118.64,"2026-02":133.87,"2026-03":106.81,"2026-04":111.37,"2026-05":123.3,"2026-06":107.67,"2026-07":110.32,"2026-08":129.9,"2026-09":118.49,"2026-10":113.01,"2026-11":99.34},"O":{"2023-12":80.32,"2024-01":76.09,"2024-02":72.9,"2024-03":75.68,"2024-04":74.9,"2024-05":74.23,"2024-06":73.89,"2024-07":80.34,"2024-08":86.89,"2024-09":88.72,"2024-10":83.05,"2024-11":80.98,"2024-12":74.72,"2025-01":76.44,"2025-02":79.78,"2025-03":81.15,"2025-04":80.94,"2025-05":79.21,"2025-06":80.59,"2025-07":78.52,"2025-08":82.2,"2025-09":85.04,"2025-10":81.11,"2025-11":80.59,"2025-12":78.86,"2026-01":85.56,"2026-02":93.73,"2026-03":85.58,"2026-04":89.87,"2026-05":85.72,"2026-06":86.68,"2026-07":89.35,"2026-08":85.72,"2026-09":75.96,"2026-10":77.19,"2026-11":82.9},"ZEB":{"2023-12":35.39,"2024-01":34.6,"2024-02":35.06,"2024-03":36.99,"2024-04":35.35,"2024-05":36.16,"2024-06":34.77,"2024-07":36.98,"2024-08":38.31,"2024-09":40.5,"2024-10":40.72,"2024-11":42.77,"2024-12":42.16,"2025-01":42.92,"2025-02":42.05,"2025-03":40.13,"2025-04":40.93,"2025-05":44.18,"2025-06":45.73,"2025-07":46.65,"2025-08":49.61,"2025-09":52.22,"2025-10":53.49,"2025-11":55.65,"2025-12":58.3,"2026-01":57.9,"2026-02":61.51,"2026-03":58.98,"2026-04":66,"2026-05":68.47,"2026-06":75.94,"2026-07":76.28,"2026-08":73.72,"2026-09":73.32,"2026-10":72.88,"2026-11":76.82},"MSTR":{"2023-12":88.36,"2024-01":70.11,"2024-02":143.09,"2024-03":238.45,"2024-04":148.99,"2024-05":213.26,"2024-06":192.7,"2024-07":225.84,"2024-08":185.24,"2024-09":235.85,"2024-10":342.03,"2024-11":542.03,"2024-12":405.15,"2025-01":468.34,"2025-02":357.32,"2025-03":403.26,"2025-04":531.74,"2025-05":516.28,"2025-06":565.48,"2025-07":562.16,"2025-08":467.81,"2025-09":450.74,"2025-10":377.02,"2025-11":247.86,"2025-12":212.56,"2026-01":209.43,"2026-02":181.16,"2026-03":174.58,"2026-04":231.45,"2026-05":222.55,"2026-06":121.61,"2026-07":130.49,"2026-08":185.97,"2026-09":214.16,"2026-10":200.31,"2026-11":160.05},"GS":{"2023-12":539.65,"2024-01":537.19,"2024-02":544.24,"2024-03":584.31,"2024-04":596.92,"2024-05":638.63,"2024-06":632.75,"2024-07":712.08,"2024-08":713.79,"2024-09":692.61,"2024-10":724.34,"2024-11":851.33,"2024-12":801.04,"2025-01":895.86,"2025-02":870.52,"2025-03":764.21,"2025-04":765.97,"2025-05":839.97,"2025-06":990.07,"2025-07":1012.23,"2025-08":1042.53,"2025-09":1114.01,"2025-10":1104.25,"2025-11":1155.55,"2025-12":1229.63,"2026-01":1308.55,"2026-02":1202.45,"2026-03":1183.46,"2026-04":1292.26,"2026-05":1434.66,"2026-06":1414.81,"2026-07":1424.61,"2026-08":1435.13,"2026-09":1259.51,"2026-10":1228.88,"2026-11":1278.04},"TMO":{"2023-12":742.52,"2024-01":753.98,"2024-02":797.62,"2024-03":813.05,"2024-04":795.58,"2024-05":794.55,"2024-06":773.59,"2024-07":858,"2024-08":860.42,"2024-09":865.32,"2024-10":764.25,"2024-11":740.9,"2024-12":727.75,"2025-01":836.19,"2025-02":739.96,"2025-03":696.09,"2025-04":600.13,"2025-05":563.5,"2025-06":567.2,"2025-07":654.24,"2025-08":689.27,"2025-09":678.49,"2025-10":793.72,"2025-11":826.51,"2025-12":810.59,"2026-01":809.42,"2026-02":728.98,"2026-03":687.6,"2026-04":670.02,"2026-05":688.97,"2026-06":701.35,"2026-07":803.39,"2026-08":863.26,"2026-09":944.33,"2026-10":941.72,"2026-11":978.45},"TEC":{"2023-12":31.62,"2024-01":32.91,"2024-02":35.4,"2024-03":35.96,"2024-04":34.86,"2024-05":36.8,"2024-06":39.75,"2024-07":39.42,"2024-08":38.94,"2024-09":40.2,"2024-10":41.09,"2024-11":44.26,"2024-12":45.98,"2025-01":47.29,"2025-02":45.09,"2025-03":40.85,"2025-04":39.91,"2025-05":43.94,"2025-06":46.78,"2025-07":49.08,"2025-08":49.04,"2025-09":52.79,"2025-10":55.93,"2025-11":54.22,"2025-12":53.01,"2026-01":52.31,"2026-02":49.77,"2026-03":48.19,"2026-04":55.14,"2026-05":61.92,"2026-06":61.54,"2026-07":59.36,"2026-08":61.35,"2026-09":64.71,"2026-10":64.33,"2026-11":60.15},"HYG":{"2023-12":108.26,"2024-01":108.39,"2024-02":108.18,"2024-03":108.74,"2024-04":106.72,"2024-05":107.9,"2024-06":107.91,"2024-07":109.87,"2024-08":110.99,"2024-09":112.33,"2024-10":110.71,"2024-11":111.97,"2024-12":110.02,"2025-01":111.52,"2025-02":112.09,"2025-03":110.36,"2025-04":109.95,"2025-05":111.31,"2025-06":112.82,"2025-07":112.44,"2025-08":113.12,"2025-09":113.58,"2025-10":113.03,"2025-11":113.3,"2025-12":112.79,"2026-01":113.48,"2026-02":112.92,"2026-03":111.3,"2026-04":112.44,"2026-05":112.35,"2026-06":111.87,"2026-07":111.18,"2026-08":111.65,"2026-09":108.01,"2026-10":107.48,"2026-11":107.69},"CVX":{"2023-12":208.66,"2024-01":206.24,"2024-02":212.65,"2024-03":220.66,"2024-04":225.6,"2024-05":227.04,"2024-06":218.82,"2024-07":224.48,"2024-08":206.97,"2024-09":206.02,"2024-10":208.18,"2024-11":226.52,"2024-12":202.62,"2025-01":208.7,"2025-02":221.89,"2025-03":234.02,"2025-04":190.33,"2025-05":191.23,"2025-06":200.31,"2025-07":212.13,"2025-08":224.66,"2025-09":217.24,"2025-10":220.63,"2025-11":211.42,"2025-12":213.21,"2026-01":247.47,"2026-02":261.26,"2026-03":289.43,"2026-04":270.42,"2026-05":255.24,"2026-06":231.88,"2026-07":275.35,"2026-08":288.37,"2026-09":285.67,"2026-10":310.73,"2026-11":302.65}};

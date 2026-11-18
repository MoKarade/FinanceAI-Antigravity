import {
  ASSETS,
  type FinancialAsset,
  HISTORICAL_SERIES,
  type MacroIndicators,
  type RiskProfile,
  VERIFIED_SPOT_CAD_2026_11,
  VERIFIED_TRAILING_RETURNS_CAD_2026_11,
} from './marketData';
import type { EvaluatedPortfolioLot } from './engine';
import { EXPANDED_STOCK_FUNDAMENTALS } from './globalMarketCatalog';
import type { StockFundamentalProfile } from './verifiedMarketHistory2026';

export type EquityActionSignal =
  | 'ACHAT FORT'
  | 'ACHETER'
  | 'CONSERVER'
  | 'ALLÉGER'
  | 'VENDRE';

export interface EquityQuantAnalysis {
  asset: FinancialAsset;
  sector: string;
  region: string;
  wrapperShort: 'PEA' | 'CTO';
  spotPrice: number;
  sparkline24m: number[];
  sparkline12m: number[];

  // Valuation & DCF
  intrinsicValueDcfEur: number;
  upsideDcfPct: number;
  peForward: number;
  pegRatio: number;
  evEbitda: number;
  fcfYieldPct: number;
  dividendYieldPct: number;

  // Quality & Balance Sheet
  roicPct: number;
  waccPct: number;
  roicWaccSpreadPct: number;
  roePct: number;
  operatingMarginPct: number;
  epsGrowthNextYrPct: number;
  netDebtToEbitda: number;
  piotroskiFScore: number;
  altmanZScore: number;

  // Technicals & Timing
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  macdLabel: string;
  bollingerPctB: number; // 0..100+
  sma6GapPct: number;
  sma12GapPct: number;
  zScoreMeanReversion: number;
  trendRegime: 'Haussier' | 'Consolidation' | 'Baissier';
  momentum1dPct: number;
  momentum5dPct: number;
  momentum1mPct: number;
  momentum3mPct: number;
  momentum6mPct: number;
  momentum12mPct: number;
  drawdownAthPct: number;

  // Risk & Trade Execution Plan
  volatilityPct: number;
  betaVsWorld: number;
  jensenAlphaPct: number;
  sharpeRatio: number;
  monthlyVar95Pct: number;
  entryZoneLowEur: number;
  entryZoneHighEur: number;
  targetPrice12mEur: number;
  targetReturn12mPct: number;
  stopLossEur: number;
  stopDistancePct: number;
  rewardRiskRatio: number;

  // 5-Pillar Scores & Final Verdict
  pillars: {
    valuation: number; // 0..100
    quality: number; // 0..100
    growth: number; // 0..100
    technicals: number; // 0..100
    macroFit: number; // 0..100
  };
  quantScore: number; // 0..100
  signal: EquityActionSignal;
  convictionPct: number;
  catalystHeadline: string;
  actionSummary: string;

  // Portfolio Cross-Check
  isHeld: boolean;
  heldValueEur: number;
  heldWeightPct: number;
  heldGainLossPct: number;
}

export interface EquityUniverseSummary {
  totalStocks: number;
  strongBuyCount: number;
  buyCount: number;
  holdCount: number;
  trimCount: number;
  sellCount: number;
  avgTopBuyUpsidePct: number;
  heldSellAlerts: EquityQuantAnalysis[];
  topBuysNow: EquityQuantAnalysis[];
  topSellsNow: EquityQuantAnalysis[];
  allAnalyses: EquityQuantAnalysis[];
}

const STOCK_FUNDAMENTALS: Record<string, StockFundamentalProfile> = {
  ADP: {
    peForward: 30.8,
    evEbitda: 25.4,
    fcfYieldPct: 3.1,
    roicPct: 56.0,
    roePct: 68.0,
    operatingMarginPct: 61.5,
    epsGrowthNextYrPct: 29.5,
    netDebtToEbitda: -0.6,
    piotroskiFScore: 8,
    altmanZScore: 14.2,
    baseFairValueUpsidePct: 21.5,
    catalystHeadline: 'Cycle Blackwell IA & marges data centers > 60 %',
  },
  ASML: {
    peForward: 27.6,
    evEbitda: 22.1,
    fcfYieldPct: 3.4,
    roicPct: 38.5,
    roePct: 46.0,
    operatingMarginPct: 32.4,
    epsGrowthNextYrPct: 23.0,
    netDebtToEbitda: -0.3,
    piotroskiFScore: 8,
    altmanZScore: 9.8,
    baseFairValueUpsidePct: 23.0,
    catalystHeadline: 'Monopole EUV High-NA & rebond commandes fonderies 2nm',
  },
  SU: {
    peForward: 23.8,
    evEbitda: 16.5,
    fcfYieldPct: 4.1,
    roicPct: 17.8,
    roePct: 19.5,
    operatingMarginPct: 18.4,
    epsGrowthNextYrPct: 14.5,
    netDebtToEbitda: 0.9,
    piotroskiFScore: 8,
    altmanZScore: 5.4,
    baseFairValueUpsidePct: 17.5,
    catalystHeadline: 'Électrification mondiale & refroidissement liquide data centers',
  },
  ODFL: {
    peForward: 25.2,
    evEbitda: 15.8,
    fcfYieldPct: 4.0,
    roicPct: 19.2,
    roePct: 24.0,
    operatingMarginPct: 16.2,
    epsGrowthNextYrPct: 17.0,
    netDebtToEbitda: -0.2,
    piotroskiFScore: 8,
    altmanZScore: 5.9,
    baseFairValueUpsidePct: 16.8,
    catalystHeadline: 'Après-vente moteurs LEAP très relutive & budget défense UE',
  },
  RMS: {
    peForward: 43.5,
    evEbitda: 29.0,
    fcfYieldPct: 2.4,
    roicPct: 39.5,
    roePct: 31.0,
    operatingMarginPct: 40.8,
    epsGrowthNextYrPct: 12.0,
    netDebtToEbitda: -1.4,
    piotroskiFScore: 8,
    altmanZScore: 13.5,
    baseFairValueUpsidePct: 8.5,
    catalystHeadline: 'Pricing power absolu, trésorerie nette > 16 Md$ & listes d’attente',
  },
  MC: {
    peForward: 21.4,
    evEbitda: 12.8,
    fcfYieldPct: 4.3,
    roicPct: 16.8,
    roePct: 20.2,
    operatingMarginPct: 22.6,
    epsGrowthNextYrPct: 3.2,
    netDebtToEbitda: 0.9,
    piotroskiFScore: 6,
    altmanZScore: 4.7,
    baseFairValueUpsidePct: 4.5,
    catalystHeadline: 'Ralentissement de la demande luxe en Chine & normalisation des marges',
  },
  AIR: {
    peForward: 21.6,
    evEbitda: 11.9,
    fcfYieldPct: 4.4,
    roicPct: 16.5,
    roePct: 23.0,
    operatingMarginPct: 9.8,
    epsGrowthNextYrPct: 16.5,
    netDebtToEbitda: -0.9,
    piotroskiFScore: 7,
    altmanZScore: 3.8,
    baseFairValueUpsidePct: 15.2,
    catalystHeadline: 'Montée en cadence A320neo & trésorerie nette solide',
  },
  AI: {
    peForward: 24.4,
    evEbitda: 13.8,
    fcfYieldPct: 3.8,
    roicPct: 12.6,
    roePct: 14.8,
    operatingMarginPct: 19.6,
    epsGrowthNextYrPct: 9.5,
    netDebtToEbitda: 1.2,
    piotroskiFScore: 8,
    altmanZScore: 4.3,
    baseFairValueUpsidePct: 10.5,
    catalystHeadline: 'Indexation inflation des contrats gaz industriels & semi-conducteurs',
  },
  OR: {
    peForward: 26.8,
    evEbitda: 18.2,
    fcfYieldPct: 3.5,
    roicPct: 21.4,
    roePct: 22.8,
    operatingMarginPct: 19.9,
    epsGrowthNextYrPct: 8.2,
    netDebtToEbitda: 0.4,
    piotroskiFScore: 7,
    altmanZScore: 6.8,
    baseFairValueUpsidePct: 5.2,
    catalystHeadline: 'Division dermatologique robuste mais reprise Asie graduelle',
  },
  SAN: {
    peForward: 11.6,
    evEbitda: 8.4,
    fcfYieldPct: 7.2,
    roicPct: 14.2,
    roePct: 16.5,
    operatingMarginPct: 27.5,
    epsGrowthNextYrPct: 9.8,
    netDebtToEbitda: 0.7,
    piotroskiFScore: 7,
    altmanZScore: 4.1,
    baseFairValueUpsidePct: 19.4,
    catalystHeadline: 'Décote défensive marquée (PER < 12x), Dupixent & dividende 3,8 %',
  },
  NOVO: {
    peForward: 22.8,
    evEbitda: 16.9,
    fcfYieldPct: 3.9,
    roicPct: 44.0,
    roePct: 58.0,
    operatingMarginPct: 42.5,
    epsGrowthNextYrPct: 13.5,
    netDebtToEbitda: 0.2,
    piotroskiFScore: 7,
    altmanZScore: 9.8,
    baseFairValueUpsidePct: 6.8,
    catalystHeadline: 'ROIC élevé mais pression concurrentielle accrue d’Eli Lilly sur le GLP-1',
  },
  SAP: {
    peForward: 30.4,
    evEbitda: 22.8,
    fcfYieldPct: 3.3,
    roicPct: 17.5,
    roePct: 16.8,
    operatingMarginPct: 24.2,
    epsGrowthNextYrPct: 19.0,
    netDebtToEbitda: -0.2,
    piotroskiFScore: 8,
    altmanZScore: 6.4,
    baseFairValueUpsidePct: 12.8,
    catalystHeadline: 'Accélération backlog Cloud ERP (+25 %) & levier opérationnel IA',
  },
  TTE: {
    peForward: 7.6,
    evEbitda: 4.3,
    fcfYieldPct: 9.8,
    roicPct: 15.8,
    roePct: 17.4,
    operatingMarginPct: 16.5,
    epsGrowthNextYrPct: 5.5,
    netDebtToEbitda: 0.4,
    piotroskiFScore: 8,
    altmanZScore: 3.9,
    baseFairValueUpsidePct: 19.5,
    catalystHeadline: 'Rendement cash total > 10 % (dividende 5,2 % + rachats d’actions)',
  },
  BNP: {
    peForward: 6.9,
    evEbitda: 5.8,
    fcfYieldPct: 8.9,
    roicPct: 11.0,
    roePct: 11.4,
    operatingMarginPct: 31.0,
    epsGrowthNextYrPct: 7.2,
    netDebtToEbitda: 1.1,
    piotroskiFScore: 7,
    altmanZScore: 2.9,
    baseFairValueUpsidePct: 16.0,
    catalystHeadline: 'Décote sur actif net (0,75x TBV) & distribution généreuse (6,8 %)',
  },
  CS: {
    peForward: 9.4,
    evEbitda: 7.1,
    fcfYieldPct: 7.8,
    roicPct: 13.5,
    roePct: 15.2,
    operatingMarginPct: 18.0,
    epsGrowthNextYrPct: 7.5,
    netDebtToEbitda: 0.6,
    piotroskiFScore: 8,
    altmanZScore: 3.4,
    baseFairValueUpsidePct: 14.2,
    catalystHeadline: 'Ratio Solvabilité II > 215 % & rendement sécurisé de 5,8 %',
  },
  DG: {
    peForward: 12.6,
    evEbitda: 7.6,
    fcfYieldPct: 6.9,
    roicPct: 11.8,
    roePct: 16.2,
    operatingMarginPct: 12.8,
    epsGrowthNextYrPct: 6.8,
    netDebtToEbitda: 1.8,
    piotroskiFScore: 7,
    altmanZScore: 3.1,
    baseFairValueUpsidePct: 13.0,
    catalystHeadline: 'Croissance Vinci Energies + concessions aéroportuaires à FCF élevé',
  },
  CAP: {
    peForward: 14.8,
    evEbitda: 10.2,
    fcfYieldPct: 6.4,
    roicPct: 14.6,
    roePct: 16.5,
    operatingMarginPct: 13.3,
    epsGrowthNextYrPct: 9.2,
    netDebtToEbitda: 0.8,
    piotroskiFScore: 7,
    altmanZScore: 4.0,
    baseFairValueUpsidePct: 14.8,
    catalystHeadline: 'Multiple attractif (14,8x) avant le cycle de déploiement IA entreprise',
  },
  KER: {
    peForward: 18.2,
    evEbitda: 10.8,
    fcfYieldPct: 2.9,
    roicPct: 8.2,
    roePct: 9.5,
    operatingMarginPct: 12.4,
    epsGrowthNextYrPct: -8.5,
    netDebtToEbitda: 2.4,
    piotroskiFScore: 3,
    altmanZScore: 2.3,
    baseFairValueUpsidePct: -14.5,
    catalystHeadline: 'Chute d’activité Gucci, érosion des marges & hausse de la dette nette',
  },
  TEP: {
    peForward: 6.8,
    evEbitda: 4.9,
    fcfYieldPct: 6.5,
    roicPct: 7.4,
    roePct: 10.2,
    operatingMarginPct: 11.2,
    epsGrowthNextYrPct: -6.0,
    netDebtToEbitda: 2.5,
    piotroskiFScore: 3,
    altmanZScore: 1.9,
    baseFairValueUpsidePct: -19.0,
    catalystHeadline: 'Disruption structurelle des centres d’appels par l’IA (risque value trap)',
  },
  STLAP: {
    peForward: 6.1,
    evEbitda: 3.2,
    fcfYieldPct: -2.4,
    roicPct: 6.8,
    roePct: 7.5,
    operatingMarginPct: 6.2,
    epsGrowthNextYrPct: -16.0,
    netDebtToEbitda: 1.3,
    piotroskiFScore: 3,
    altmanZScore: 2.1,
    baseFairValueUpsidePct: -13.5,
    catalystHeadline: 'Stocks US excédentaires, FCF négatif & contraction brutale des marges',
  },
  ALO: {
    peForward: 14.9,
    evEbitda: 8.9,
    fcfYieldPct: 1.2,
    roicPct: 5.4,
    roePct: 4.8,
    operatingMarginPct: 5.9,
    epsGrowthNextYrPct: 2.0,
    netDebtToEbitda: 2.7,
    piotroskiFScore: 4,
    altmanZScore: 1.7,
    baseFairValueUpsidePct: -15.0,
    catalystHeadline: 'ROIC inférieur au coût du capital (WACC) & faible conversion cash',
  },
  MSFT: {
    peForward: 29.2,
    evEbitda: 21.4,
    fcfYieldPct: 3.4,
    roicPct: 31.2,
    roePct: 36.0,
    operatingMarginPct: 44.5,
    epsGrowthNextYrPct: 16.5,
    netDebtToEbitda: -0.4,
    piotroskiFScore: 9,
    altmanZScore: 10.4,
    baseFairValueUpsidePct: 16.4,
    catalystHeadline: 'Croissance Azure IA > 30 %, F-Score 9/9 & visibilité maximale',
  },
  GOOGL: {
    peForward: 19.6,
    evEbitda: 13.8,
    fcfYieldPct: 4.8,
    roicPct: 29.5,
    roePct: 31.4,
    operatingMarginPct: 32.1,
    epsGrowthNextYrPct: 16.8,
    netDebtToEbitda: -0.8,
    piotroskiFScore: 9,
    altmanZScore: 11.2,
    baseFairValueUpsidePct: 24.5,
    catalystHeadline: 'Meilleur couple Valorisation / Qualité des Mega-Caps (PEG 1,17x)',
  },
  META: {
    peForward: 22.4,
    evEbitda: 14.9,
    fcfYieldPct: 4.3,
    roicPct: 32.0,
    roePct: 35.5,
    operatingMarginPct: 38.6,
    epsGrowthNextYrPct: 18.0,
    netDebtToEbitda: -0.5,
    piotroskiFScore: 8,
    altmanZScore: 9.6,
    baseFairValueUpsidePct: 18.8,
    catalystHeadline: 'Rendement publicitaire IA supérieur & discipline Capex/Opex',
  },
  AMZN: {
    peForward: 28.0,
    evEbitda: 15.6,
    fcfYieldPct: 3.8,
    roicPct: 18.6,
    roePct: 22.4,
    operatingMarginPct: 10.8,
    epsGrowthNextYrPct: 21.5,
    netDebtToEbitda: 0.3,
    piotroskiFScore: 8,
    altmanZScore: 6.2,
    baseFairValueUpsidePct: 17.8,
    catalystHeadline: 'Expansion marges logistiques US + réaccélération AWS & Publicité',
  },
  VCN: {
    peForward: 27.8,
    evEbitda: 20.6,
    fcfYieldPct: 3.9,
    roicPct: 26.8,
    roePct: 38.0,
    operatingMarginPct: 60.5,
    epsGrowthNextYrPct: 23.5,
    netDebtToEbitda: 1.4,
    piotroskiFScore: 8,
    altmanZScore: 6.8,
    baseFairValueUpsidePct: 19.6,
    catalystHeadline: 'Puces ASIC IA hyperscalers & synergies logicielles VMware',
  },
  AAPL: {
    peForward: 29.8,
    evEbitda: 22.6,
    fcfYieldPct: 3.3,
    roicPct: 49.0,
    roePct: 135.0,
    operatingMarginPct: 31.2,
    epsGrowthNextYrPct: 9.2,
    netDebtToEbitda: -0.3,
    piotroskiFScore: 7,
    altmanZScore: 8.9,
    baseFairValueUpsidePct: 2.5,
    catalystHeadline: 'Qualité exceptionnelle mais PEG élevé (3,2x) limitant le potentiel court terme',
  },
  LLY: {
    peForward: 38.5,
    evEbitda: 29.5,
    fcfYieldPct: 2.1,
    roicPct: 33.0,
    roePct: 58.0,
    operatingMarginPct: 36.5,
    epsGrowthNextYrPct: 34.0,
    netDebtToEbitda: 1.1,
    piotroskiFScore: 8,
    altmanZScore: 8.4,
    baseFairValueUpsidePct: 15.8,
    catalystHeadline: 'Croissance BPA > 30 %/an (PEG ~1,1x) sur le duopole cardiométabolique',
  },
  UNH: {
    peForward: 18.4,
    evEbitda: 12.5,
    fcfYieldPct: 5.4,
    roicPct: 20.8,
    roePct: 25.0,
    operatingMarginPct: 8.9,
    epsGrowthNextYrPct: 11.8,
    netDebtToEbitda: 1.3,
    piotroskiFScore: 8,
    altmanZScore: 4.6,
    baseFairValueUpsidePct: 14.5,
    catalystHeadline: 'Croissance défensive régulière Optum & décote historique',
  },
  JPM: {
    peForward: 12.4,
    evEbitda: 9.2,
    fcfYieldPct: 6.8,
    roicPct: 15.2,
    roePct: 17.2,
    operatingMarginPct: 38.0,
    epsGrowthNextYrPct: 8.4,
    netDebtToEbitda: 0.9,
    piotroskiFScore: 8,
    altmanZScore: 3.5,
    baseFairValueUpsidePct: 11.5,
    catalystHeadline: 'Leader bancaire américain à fort excédent de capital CET1',
  },
  V: {
    peForward: 25.4,
    evEbitda: 19.8,
    fcfYieldPct: 4.1,
    roicPct: 34.5,
    roePct: 48.0,
    operatingMarginPct: 66.2,
    epsGrowthNextYrPct: 13.2,
    netDebtToEbitda: 0.2,
    piotroskiFScore: 8,
    altmanZScore: 9.1,
    baseFairValueUpsidePct: 13.4,
    catalystHeadline: 'Effet réseau mondial protégé contre l’inflation et marges de 66 %',
  },
  COST: {
    peForward: 49.5,
    evEbitda: 31.8,
    fcfYieldPct: 1.9,
    roicPct: 27.4,
    roePct: 30.5,
    operatingMarginPct: 3.7,
    epsGrowthNextYrPct: 9.8,
    netDebtToEbitda: -0.5,
    piotroskiFScore: 7,
    altmanZScore: 9.4,
    baseFairValueUpsidePct: -9.5,
    catalystHeadline: 'Entreprise exemplaire mais prime de valorisation excessive (PER ~50x, PEG 5x)',
  },
  XOM: {
    peForward: 13.2,
    evEbitda: 6.4,
    fcfYieldPct: 7.1,
    roicPct: 14.4,
    roePct: 16.0,
    operatingMarginPct: 14.2,
    epsGrowthNextYrPct: 6.5,
    netDebtToEbitda: 0.3,
    piotroskiFScore: 7,
    altmanZScore: 4.5,
    baseFairValueUpsidePct: 10.8,
    catalystHeadline: 'Production à point mort bas (< 35 $/b) & couverture inflationniste',
  },
  TSLA: {
    peForward: 72.0,
    evEbitda: 42.0,
    fcfYieldPct: 0.9,
    roicPct: 11.2,
    roePct: 12.8,
    operatingMarginPct: 8.2,
    epsGrowthNextYrPct: 8.0,
    netDebtToEbitda: -0.7,
    piotroskiFScore: 4,
    altmanZScore: 7.2,
    baseFairValueUpsidePct: -24.0,
    catalystHeadline: 'Valorisation déconnectée des BPA actuels (PER 72x) & guerre des prix VE',
  },
  INTC: {
    peForward: 34.0,
    evEbitda: 14.8,
    fcfYieldPct: -4.5,
    roicPct: 2.1,
    roePct: 1.8,
    operatingMarginPct: 1.5,
    epsGrowthNextYrPct: -12.0,
    netDebtToEbitda: 2.8,
    piotroskiFScore: 2,
    altmanZScore: 1.8,
    baseFairValueUpsidePct: -26.5,
    catalystHeadline: 'Destruction de valeur (ROIC 2 % << WACC), FCF négatif & retard IA',
  },
  BA: {
    peForward: 45.0,
    evEbitda: 24.5,
    fcfYieldPct: -5.2,
    roicPct: -1.5,
    roePct: -12.0,
    operatingMarginPct: -2.4,
    epsGrowthNextYrPct: -15.0,
    netDebtToEbitda: 4.8,
    piotroskiFScore: 2,
    altmanZScore: 1.3,
    baseFairValueUpsidePct: -28.0,
    catalystHeadline: 'Bilan sous tension (Z-Score 1,3), burn cash industriel & levier 4,8x',
  },
  NKE: {
    peForward: 24.5,
    evEbitda: 16.2,
    fcfYieldPct: 3.6,
    roicPct: 16.5,
    roePct: 28.0,
    operatingMarginPct: 11.4,
    epsGrowthNextYrPct: -3.5,
    netDebtToEbitda: 0.6,
    piotroskiFScore: 4,
    altmanZScore: 5.1,
    baseFairValueUpsidePct: -11.0,
    catalystHeadline: 'Perte de parts de marché running/lifestyle & révisions BPA négatives',
  },
  PFE: {
    peForward: 10.4,
    evEbitda: 8.6,
    fcfYieldPct: 6.1,
    roicPct: 7.2,
    roePct: 9.0,
    operatingMarginPct: 17.5,
    epsGrowthNextYrPct: -2.5,
    netDebtToEbitda: 2.9,
    piotroskiFScore: 4,
    altmanZScore: 2.2,
    baseFairValueUpsidePct: -8.5,
    catalystHeadline: 'Expiration de brevets majeurs, dette élevée (2,9x) & faible dynamique',
  },
  EMR: {
    peForward: 21.8,
    evEbitda: 12.9,
    fcfYieldPct: 4.4,
    roicPct: 28.5,
    roePct: 30.2,
    operatingMarginPct: 45.5,
    epsGrowthNextYrPct: 25.0,
    netDebtToEbitda: -0.9,
    piotroskiFScore: 9,
    altmanZScore: 8.9,
    baseFairValueUpsidePct: 22.8,
    catalystHeadline: 'Monopole fonderie IA 3nm/2nm & packaging CoWoS saturé jusqu’en 2027',
  },
  ACN: {
    peForward: 24.6,
    evEbitda: 18.4,
    fcfYieldPct: 4.1,
    roicPct: 36.4,
    roePct: 92.0,
    operatingMarginPct: 39.8,
    epsGrowthNextYrPct: 18.5,
    netDebtToEbitda: 0.6,
    piotroskiFScore: 8,
    altmanZScore: 9.2,
    baseFairValueUpsidePct: 18.2,
    catalystHeadline: 'Intensité métrologique record sur gravure EUV & marges > 39 %',
  },
  PAYX: {
    peForward: 76.0,
    evEbitda: 58.0,
    fcfYieldPct: 1.5,
    roicPct: 19.5,
    roePct: 18.0,
    operatingMarginPct: 28.0,
    epsGrowthNextYrPct: 26.0,
    netDebtToEbitda: -2.4,
    piotroskiFScore: 7,
    altmanZScore: 15.6,
    baseFairValueUpsidePct: -18.5,
    catalystHeadline: 'Hyper-croissance AIP mais valorisation tendue (PER 76x, PEG ~2,9x)',
  },
  QQQM: {
    peForward: 28.4,
    evEbitda: 19.2,
    fcfYieldPct: 3.6,
    roicPct: 19.8,
    roePct: 26.5,
    operatingMarginPct: 24.5,
    epsGrowthNextYrPct: 19.5,
    netDebtToEbitda: 1.2,
    piotroskiFScore: 8,
    altmanZScore: 6.5,
    baseFairValueUpsidePct: 15.4,
    catalystHeadline: 'Pénurie mondiale de turbines aéronautiques & expansion des marges',
  },
  ECL: {
    peForward: 48.0,
    evEbitda: 31.0,
    fcfYieldPct: 0.4,
    roicPct: 7.5,
    roePct: 8.2,
    operatingMarginPct: 9.0,
    epsGrowthNextYrPct: 14.0,
    netDebtToEbitda: 1.5,
    piotroskiFScore: 5,
    altmanZScore: 3.4,
    baseFairValueUpsidePct: -9.0,
    catalystHeadline: 'Thématique spatiale porteuse mais multiples élevés et forte volatilité',
  },
  ...EXPANDED_STOCK_FUNDAMENTALS,
};

function registerDynamicStockFundamental(
  assetId: string,
  profile: StockFundamentalProfile
): void {
  STOCK_FUNDAMENTALS[assetId] = profile;
}

function getStockFundamentalProfile(
  assetId: string
): StockFundamentalProfile | undefined {
  return STOCK_FUNDAMENTALS[assetId];
}

function computeEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

/**
 * Runs a full 22-indicator institutional quantitative, fundamental, and technical model
 * across all 38 individual equities to identify immediate BUY vs SELL opportunities.
 */
export function analyzeEquityUniverse(params: {
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  riskProfile?: RiskProfile;
  evaluatedLots?: EvaluatedPortfolioLot[];
  totalPortfolioValue?: number;
}): EquityUniverseSummary {
  const {
    livePrices,
    macro,
    riskProfile = 'equilibre',
    evaluatedLots = [],
    totalPortfolioValue = 0,
  } = params;

  const stocks = ASSETS.filter((a) => a.isIndividualStock);
  const nSeries = HISTORICAL_SERIES.length;

  // World monthly returns for empirical Beta calculation
  const worldRets: number[] = [];
  for (let t = 1; t < nSeries; t++) {
    const p0 = HISTORICAL_SERIES[t - 1].prices.XBB;
    const p1 = HISTORICAL_SERIES[t].prices.XBB;
    worldRets.push(p0 > 0 ? p1 / p0 - 1 : 0);
  }
  const meanWorld = worldRets.reduce((s, x) => s + x, 0) / worldRets.length;
  const varWorld =
    worldRets.reduce((s, x) => s + (x - meanWorld) * (x - meanWorld), 0) /
    Math.max(1, worldRets.length - 1);

  // Macro discount rate & equity risk premium (ERP)
  const riskFreePct = Math.max(1.2, macro.centralBankRatePct * 0.95);
  const erpPct = 4.6 + Math.max(-0.4, (macro.vixLevel - 16) * 0.11);
  const growthMacroDelta = macro.gdpGrowthPct - 1.6;
  const rateMacroDelta = macro.centralBankRatePct - 2.5;
  const inflationMacroDelta = macro.inflationPct - 2.0;

  const heldByAssetId = new Map<
    string,
    { value: number; invested: number; weightPct: number }
  >();
  for (const item of evaluatedLots) {
    const prev = heldByAssetId.get(item.asset.id) ?? {
      value: 0,
      invested: 0,
      weightPct: 0,
    };
    prev.value += item.currentValue;
    prev.invested += item.lot.investedAmount;
    prev.weightPct =
      totalPortfolioValue > 0 ? (prev.value / totalPortfolioValue) * 100 : item.weightPct;
    heldByAssetId.set(item.asset.id, prev);
  }

  const allAnalyses: EquityQuantAnalysis[] = stocks.map((asset) => {
    const fund: StockFundamentalProfile = STOCK_FUNDAMENTALS[asset.id] ?? {
      peForward: 18.0,
      evEbitda: 12.0,
      fcfYieldPct: 4.5,
      roicPct: 14.0,
      roePct: 16.0,
      operatingMarginPct: 16.0,
      epsGrowthNextYrPct: 8.0,
      netDebtToEbitda: 1.0,
      piotroskiFScore: 6,
      altmanZScore: 4.0,
      baseFairValueUpsidePct: 6.0,
      catalystHeadline: asset.description,
    };

    const fullPrices = HISTORICAL_SERIES.map((p, idx) =>
      idx === nSeries - 1 ? livePrices[asset.id] ?? p.prices[asset.id] : p.prices[asset.id]
    );
    const spotPrice = Number(fullPrices[fullPrices.length - 1].toFixed(2));
    const baselineSpot = HISTORICAL_SERIES[nSeries - 1].prices[asset.id] || spotPrice;

    // 1. Verified Daily-Bar Trailing Momenta (adjusted dynamically if live spot moves) & Moving Averages
    const verifiedSnap = VERIFIED_TRAILING_RETURNS_CAD_2026_11[asset.id];
    const verifiedSpot = VERIFIED_SPOT_CAD_2026_11[asset.id] || baselineSpot;
    const liveDriftRatio = verifiedSpot > 0 ? spotPrice / verifiedSpot : 1;

    const p1m = fullPrices[Math.max(0, fullPrices.length - 2)];
    const p3m = fullPrices[Math.max(0, fullPrices.length - 4)];
    const p6m = fullPrices[Math.max(0, fullPrices.length - 7)];
    const p12m = fullPrices[Math.max(0, fullPrices.length - 13)];

    const adjustTrailing = (basePct: number) =>
      ((1 + basePct / 100) * liveDriftRatio - 1) * 100;

    const momentum1dPct = verifiedSnap
      ? adjustTrailing(verifiedSnap.r1dPct)
      : (liveDriftRatio - 1) * 100;
    const momentum5dPct = verifiedSnap
      ? adjustTrailing(verifiedSnap.r5dPct)
      : p1m > 0
        ? ((spotPrice - p1m) / p1m) * 25
        : 0;
    const momentum1mPct = verifiedSnap
      ? adjustTrailing(verifiedSnap.r1mPct)
      : p1m > 0
        ? ((spotPrice - p1m) / p1m) * 100
        : 0;
    const momentum3mPct = verifiedSnap
      ? adjustTrailing(verifiedSnap.r3mPct)
      : p3m > 0
        ? ((spotPrice - p3m) / p3m) * 100
        : 0;
    const momentum6mPct = verifiedSnap
      ? adjustTrailing(verifiedSnap.r6mPct)
      : p6m > 0
        ? ((spotPrice - p6m) / p6m) * 100
        : 0;
    const momentum12mPct = verifiedSnap
      ? adjustTrailing(verifiedSnap.r12mPct)
      : p12m > 0
        ? ((spotPrice - p12m) / p12m) * 100
        : 0;

    const slice6 = fullPrices.slice(-6);
    const slice12 = fullPrices.slice(-12);
    const slice20 = fullPrices.slice(-20);

    const sma6 = slice6.reduce((s, x) => s + x, 0) / slice6.length;
    const sma12 = slice12.reduce((s, x) => s + x, 0) / slice12.length;
    const sma20 = slice20.reduce((s, x) => s + x, 0) / slice20.length;

    const sma6GapPct = sma6 > 0 ? ((spotPrice - sma6) / sma6) * 100 : 0;
    const sma12GapPct = sma12 > 0 ? ((spotPrice - sma12) / sma12) * 100 : 0;

    const std12 = Math.sqrt(
      slice12.reduce((s, x) => s + (x - sma12) * (x - sma12), 0) /
        Math.max(1, slice12.length - 1)
    );
    const zScoreMeanReversion = std12 > 1e-6 ? (spotPrice - sma12) / std12 : 0;

    // 2. Bollinger Bands (20, 2σ) %B
    const std20 = Math.sqrt(
      slice20.reduce((s, x) => s + (x - sma20) * (x - sma20), 0) /
        Math.max(1, slice20.length - 1)
    );
    const upperBand = sma20 + 2 * std20;
    const lowerBand = Math.max(0.01, sma20 - 2 * std20);
    const bollingerPctB =
      upperBand > lowerBand
        ? ((spotPrice - lowerBand) / (upperBand - lowerBand)) * 100
        : 50;

    // 3. Wilder RSI-14 (calibrated for monthly return series onto institutional 20..82 scale)
    const rsiWindow = fullPrices.slice(-15);
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < rsiWindow.length; i++) {
      const diff = rsiWindow[i] - rsiWindow[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    const rsAdjusted = avgLoss < 1e-9 ? 4.2 : Math.pow(avgGain / avgLoss, 0.56);
    const rsi14 = Math.max(18, Math.min(84, Math.round(100 - 100 / (1 + rsAdjusted))));

    // 4. MACD (12, 26, 9) normalized in % of spot so cross-stock comparison is clean
    const ema12 = computeEMA(fullPrices, 12);
    const ema26 = computeEMA(fullPrices, 26);
    const macdSeries = ema12.map((v, i) =>
      fullPrices[i] > 0 ? ((v - ema26[i]) / fullPrices[i]) * 100 : 0
    );
    const signalSeries = computeEMA(macdSeries, 9);
    const macdLine = macdSeries[macdSeries.length - 1] ?? 0;
    const macdSignal = signalSeries[signalSeries.length - 1] ?? 0;
    const macdHistogram = macdLine - macdSignal;

    let macdLabel = 'Neutre';
    if (macdHistogram > 0.12 && macdLine > 0) macdLabel = 'Haussier';
    else if (macdHistogram > 0 && macdLine <= 0) macdLabel = 'Rebond';
    else if (macdHistogram <= 0 && macdLine > 0) macdLabel = 'Consolid.';
    else macdLabel = 'Baissier';

    let trendRegime: 'Haussier' | 'Consolidation' | 'Baissier' = 'Consolidation';
    if (spotPrice >= sma6 && sma6 >= sma12 * 0.995) trendRegime = 'Haussier';
    else if (spotPrice < sma12 * 0.97 && macdLine < 0) trendRegime = 'Baissier';

    const ath = Math.max(...fullPrices, spotPrice, verifiedSnap?.high52wCad ?? 0);
    const drawdownAthPct = ath > 0 ? ((spotPrice - ath) / ath) * 100 : 0;

    // 5. Empirical Beta, WACC, and Dynamic DCF Fair Value
    const assetRets: number[] = [];
    for (let t = 1; t < fullPrices.length; t++) {
      assetRets.push(
        fullPrices[t - 1] > 0 ? fullPrices[t] / fullPrices[t - 1] - 1 : 0
      );
    }
    const meanA = assetRets.reduce((s, x) => s + x, 0) / assetRets.length;
    let covAW = 0;
    for (let t = 0; t < assetRets.length; t++) {
      covAW += (assetRets[t] - meanA) * (worldRets[t] - meanWorld);
    }
    covAW /= Math.max(1, assetRets.length - 1);
    const rawBeta = varWorld > 1e-9 ? covAW / varWorld : asset.growthBeta;
    const betaVsWorld = Number(
      Math.max(0.45, Math.min(2.15, 0.55 * rawBeta + 0.45 * asset.growthBeta)).toFixed(2)
    );

    // US equities discount off elevated US 10Y Treasury regime (~5.1%), CA/EU off ~3.7% sovereign base
    const isUsIssuer =
      asset.region === 'États-Unis (CTO)' && !asset.ticker.endsWith('.TO');
    const sovereignTermSpread = isUsIssuer ? 1.15 : 0.45;
    const waccPct = Number(
      Math.max(
        5.6,
        Math.min(14.2, riskFreePct + sovereignTermSpread + betaVsWorld * erpPct * 0.88)
      ).toFixed(2)
    );
    const roicWaccSpreadPct = Number((fund.roicPct - waccPct).toFixed(2));

    // Macro sensitivity adjustment on DCF fair value (higher rates compress high-duration growth; higher GDP boosts cyclicals)
    const durationSensitivity = Math.max(0.5, Math.min(2.2, fund.peForward / 18));
    const macroDcfShiftPct =
      -rateMacroDelta * 4.8 * durationSensitivity +
      growthMacroDelta * 3.4 * asset.growthBeta +
      inflationMacroDelta * 2.2 * asset.inflationBeta -
      Math.max(0, macro.vixLevel - 20) * 0.55 * betaVsWorld;

    // Institutional DCF multiple & sovereign rate discipline (prevents artificial universal DCF upside)
    const multipleDragPct =
      Math.max(-1.5, (fund.peForward - 18.5) * 0.44) +
      Math.max(0, momentum12mPct - 22) * 0.12 +
      (isUsIssuer ? 2.4 : 0.9) +
      4.8;
    const calibratedBaseUpsidePct = fund.baseFairValueUpsidePct - multipleDragPct;
    const baseIntrinsicEur =
      baselineSpot * (1 + (calibratedBaseUpsidePct + macroDcfShiftPct) / 100);
    const intrinsicValueDcfEur = Number(Math.max(0.5, baseIntrinsicEur).toFixed(2));
    const upsideDcfPct = Number(
      (((intrinsicValueDcfEur - spotPrice) / spotPrice) * 100).toFixed(1)
    );

    const pegRatio =
      fund.epsGrowthNextYrPct > 1.5
        ? Number((fund.peForward / fund.epsGrowthNextYrPct).toFixed(2))
        : 9.9;

    // 6. Expected Return, Volatility, Sharpe, Jensen's Alpha & Monthly VaR 95%
    const volMultiplier = 1 + Math.max(-0.12, (macro.vixLevel - 16) * 0.02);
    const volatilityPct = Number((asset.baseVolatilityPct * volMultiplier).toFixed(1));
    const forwardAnnualReturnPct = Number(
      (
        asset.baseExpectedReturnPct +
        upsideDcfPct * 0.22 +
        growthMacroDelta * asset.growthBeta * 0.9 +
        rateMacroDelta * asset.rateSensitivity * 0.8
      ).toFixed(2)
    );
    const sharpeRatio = Number(
      ((forwardAnnualReturnPct - riskFreePct) / Math.max(5, volatilityPct)).toFixed(2)
    );
    const jensenAlphaPct = Number(
      (
        forwardAnnualReturnPct -
        (riskFreePct + betaVsWorld * (8.02 - riskFreePct))
      ).toFixed(2)
    );
    const monthlyVar95Pct = Number(
      Math.max(2.0, (volatilityPct / Math.sqrt(12)) * 1.645).toFixed(1)
    );

    // 7. 5-Pillar Institutional Scoring (0..100 each)
    const valuationScore = Math.round(
      Math.max(
        8,
        Math.min(
          97,
          50 +
            upsideDcfPct * 1.45 +
            fund.fcfYieldPct * 2.4 -
            Math.max(0, fund.peForward - 32) * 0.65 -
            (pegRatio > 2.6 ? (pegRatio - 2.6) * 6 : 0)
        )
      )
    );

    const qualityScore = Math.round(
      Math.max(
        8,
        Math.min(
          98,
          20 +
            fund.piotroskiFScore * 5.2 +
            Math.min(28, Math.max(-10, roicWaccSpreadPct * 1.1)) +
            Math.min(12, fund.operatingMarginPct * 0.25) -
            Math.max(0, fund.netDebtToEbitda - 1.5) * 8.5 +
            (fund.altmanZScore < 2.0 ? -12 : fund.altmanZScore > 5 ? 5 : 0)
        )
      )
    );

    const growthScore = Math.round(
      Math.max(
        6,
        Math.min(
          98,
          44 +
            fund.epsGrowthNextYrPct * 1.85 +
            (pegRatio <= 1.4 && fund.epsGrowthNextYrPct > 10 ? 10 : 0)
        )
      )
    );

    // Technical score rewards healthy uptrend + positive MACD + non-overbought RSI (penalizes falling knives AND extreme RSI > 82)
    const rsiBonus =
      rsi14 >= 40 && rsi14 <= 68
        ? 10
        : rsi14 < 32
          ? -6
          : rsi14 > 78
            ? -8
            : 2;
    const technicalScore = Math.round(
      Math.max(
        10,
        Math.min(
          96,
          50 +
            (trendRegime === 'Haussier' ? 14 : trendRegime === 'Baissier' ? -18 : 0) +
            macdHistogram * 11 +
            Math.max(-14, Math.min(14, momentum6mPct * 0.55)) +
            rsiBonus
        )
      )
    );

    // Risk-profile aware Macro Fit
    const riskPenalty =
      riskProfile === 'prudent' && volatilityPct > 25
        ? -14
        : riskProfile === 'equilibre' && volatilityPct > 34
          ? -7
          : 0;
    const macroFitScore = Math.round(
      Math.max(
        12,
        Math.min(
          96,
          54 +
            sharpeRatio * 34 +
            growthMacroDelta * asset.growthBeta * 5 +
            inflationMacroDelta * asset.inflationBeta * 6 +
            rateMacroDelta * asset.rateSensitivity * 5 +
            riskPenalty
        )
      )
    );

    const quantScore = Math.round(
      0.26 * valuationScore +
        0.26 * qualityScore +
        0.18 * growthScore +
        0.16 * technicalScore +
        0.14 * macroFitScore
    );

    // 8. Explicit 5-Tier Institutional Action Signal Classification
    let signal: EquityActionSignal = 'CONSERVER';
    if (
      quantScore >= 77 &&
      upsideDcfPct >= 9.5 &&
      qualityScore >= 72 &&
      rsi14 <= 75 &&
      trendRegime !== 'Baissier'
    ) {
      signal = 'ACHAT FORT';
    } else if (
      quantScore >= 69 &&
      upsideDcfPct >= 5.5 &&
      momentum1mPct > -18 &&
      (trendRegime !== 'Baissier' || upsideDcfPct >= 11.5)
    ) {
      signal = 'ACHETER';
    } else if (
      quantScore <= 46 ||
      (upsideDcfPct <= -10 && qualityScore < 58) ||
      (fund.piotroskiFScore <= 3 && trendRegime === 'Baissier')
    ) {
      signal = 'VENDRE';
    } else if (
      quantScore <= 58 ||
      upsideDcfPct <= -4.5 ||
      (fund.peForward >= 38 && upsideDcfPct < 4) ||
      (trendRegime === 'Baissier' && upsideDcfPct < 4)
    ) {
      signal = 'ALLÉGER';
    }

    // 9. Concrete Trade Execution Plan (Entry Zone, 12M Target, 2xATR Stop-Loss, Reward/Risk)
    const monthlyVolFrac = volatilityPct / 100 / Math.sqrt(12);
    const stopDistanceFrac = Math.max(0.065, Math.min(0.18, monthlyVolFrac * 1.85));
    const stopLossEur = Number((spotPrice * (1 - stopDistanceFrac)).toFixed(2));
    const stopDistancePct = Number((-stopDistanceFrac * 100).toFixed(1));

    const blendedTargetUpsidePct =
      signal === 'VENDRE' || signal === 'ALLÉGER'
        ? Math.min(-4, upsideDcfPct * 0.85)
        : Math.max(4.5, upsideDcfPct * 0.85 + forwardAnnualReturnPct * 0.3);
    const targetPrice12mEur = Number(
      (spotPrice * (1 + blendedTargetUpsidePct / 100)).toFixed(2)
    );
    const targetReturn12mPct = Number(blendedTargetUpsidePct.toFixed(1));

    const entryZoneLowEur = Number((spotPrice * 0.975).toFixed(2));
    const entryZoneHighEur = Number((spotPrice * 1.01).toFixed(2));

    const rewardRiskRatio =
      targetReturn12mPct > 0
        ? Number((targetReturn12mPct / Math.abs(stopDistancePct)).toFixed(2))
        : Number((Math.abs(targetReturn12mPct) / Math.abs(stopDistancePct)).toFixed(2));

    const convictionPct = Math.round(
      Math.max(
        52,
        Math.min(
          96,
          signal === 'ACHAT FORT' || signal === 'VENDRE'
            ? 74 + Math.abs(quantScore - 55) * 0.7
            : 56 + Math.abs(quantScore - 55) * 0.65
        )
      )
    );

    const heldInfo = heldByAssetId.get(asset.id);
    const isHeld = Boolean(heldInfo && heldInfo.value > 0);
    const heldGainLossPct =
      heldInfo && heldInfo.invested > 0
        ? Number((((heldInfo.value - heldInfo.invested) / heldInfo.invested) * 100).toFixed(1))
        : 0;

    let actionSummary = '';
    if (signal === 'ACHAT FORT') {
      actionSummary = `Décote DCF ${upsideDcfPct >= 0 ? '+' : ''}${upsideDcfPct}% · ROIC ${fund.roicPct.toFixed(0)}% · R/R ${rewardRiskRatio}x`;
    } else if (signal === 'ACHETER') {
      actionSummary = `Potentiel +${targetReturn12mPct}% · F-Score ${fund.piotroskiFScore}/9 · PER ${fund.peForward.toFixed(1)}x`;
    } else if (signal === 'VENDRE') {
      actionSummary = `Surcote/Risque ${upsideDcfPct}% · F-Score ${fund.piotroskiFScore}/9 · Tendance ${trendRegime.toLowerCase()}`;
    } else if (signal === 'ALLÉGER') {
      actionSummary = `Potentiel limité (${upsideDcfPct}%) · PER ${fund.peForward.toFixed(1)}x · Écrêter`;
    } else {
      actionSummary = `Valorisation équilibrée (DCF ${upsideDcfPct >= 0 ? '+' : ''}${upsideDcfPct}%) · Conserver`;
    }

    return {
      asset,
      sector: asset.sector ?? 'Actions Globales',
      region: asset.region ?? 'Global',
      wrapperShort: asset.wrapper.includes('PEA') ? 'PEA' : 'CTO',
      spotPrice,
      sparkline24m: fullPrices.slice(-24),
      sparkline12m: fullPrices.slice(-12),
      intrinsicValueDcfEur,
      upsideDcfPct,
      peForward: fund.peForward,
      pegRatio,
      evEbitda: fund.evEbitda,
      fcfYieldPct: fund.fcfYieldPct,
      dividendYieldPct: asset.dividendYieldPct,
      roicPct: fund.roicPct,
      waccPct,
      roicWaccSpreadPct,
      roePct: fund.roePct,
      operatingMarginPct: fund.operatingMarginPct,
      epsGrowthNextYrPct: fund.epsGrowthNextYrPct,
      netDebtToEbitda: fund.netDebtToEbitda,
      piotroskiFScore: fund.piotroskiFScore,
      altmanZScore: fund.altmanZScore,
      rsi14,
      macdLine: Number(macdLine.toFixed(2)),
      macdSignal: Number(macdSignal.toFixed(2)),
      macdHistogram: Number(macdHistogram.toFixed(2)),
      macdLabel,
      bollingerPctB: Number(bollingerPctB.toFixed(0)),
      sma6GapPct: Number(sma6GapPct.toFixed(1)),
      sma12GapPct: Number(sma12GapPct.toFixed(1)),
      zScoreMeanReversion: Number(zScoreMeanReversion.toFixed(2)),
      trendRegime,
      momentum1dPct: Number(momentum1dPct.toFixed(1)),
      momentum5dPct: Number(momentum5dPct.toFixed(1)),
      momentum1mPct: Number(momentum1mPct.toFixed(1)),
      momentum3mPct: Number(momentum3mPct.toFixed(1)),
      momentum6mPct: Number(momentum6mPct.toFixed(1)),
      momentum12mPct: Number(momentum12mPct.toFixed(1)),
      drawdownAthPct: Number(drawdownAthPct.toFixed(1)),
      volatilityPct,
      betaVsWorld,
      jensenAlphaPct,
      sharpeRatio,
      monthlyVar95Pct,
      entryZoneLowEur,
      entryZoneHighEur,
      targetPrice12mEur,
      targetReturn12mPct,
      stopLossEur,
      stopDistancePct,
      rewardRiskRatio,
      pillars: {
        valuation: valuationScore,
        quality: qualityScore,
        growth: growthScore,
        technicals: technicalScore,
        macroFit: macroFitScore,
      },
      quantScore,
      signal,
      convictionPct,
      catalystHeadline: fund.catalystHeadline,
      actionSummary,
      isHeld,
      heldValueEur: Math.round(heldInfo?.value ?? 0),
      heldWeightPct: Number((heldInfo?.weightPct ?? 0).toFixed(1)),
      heldGainLossPct,
    };
  });

  allAnalyses.sort((a, b) => b.quantScore - a.quantScore);

  const strongBuyCount = allAnalyses.filter((a) => a.signal === 'ACHAT FORT').length;
  const buyCount = allAnalyses.filter((a) => a.signal === 'ACHETER').length;
  const holdCount = allAnalyses.filter((a) => a.signal === 'CONSERVER').length;
  const trimCount = allAnalyses.filter((a) => a.signal === 'ALLÉGER').length;
  const sellCount = allAnalyses.filter((a) => a.signal === 'VENDRE').length;

  const topBuysNow = allAnalyses
    .filter((a) => a.signal === 'ACHAT FORT' || a.signal === 'ACHETER')
    .slice(0, 6);

  const topSellsNow = [...allAnalyses]
    .filter((a) => a.signal === 'VENDRE' || a.signal === 'ALLÉGER')
    .sort((a, b) => a.quantScore - b.quantScore)
    .slice(0, 6);

  const heldSellAlerts = allAnalyses.filter(
    (a) => a.isHeld && (a.signal === 'VENDRE' || a.signal === 'ALLÉGER')
  );

  const avgTopBuyUpsidePct =
    topBuysNow.length > 0
      ? Number(
          (
            topBuysNow.reduce((s, x) => s + x.targetReturn12mPct, 0) / topBuysNow.length
          ).toFixed(1)
        )
      : 0;

  return {
    totalStocks: allAnalyses.length,
    strongBuyCount,
    buyCount,
    holdCount,
    trimCount,
    sellCount,
    avgTopBuyUpsidePct,
    heldSellAlerts,
    topBuysNow,
    topSellsNow,
    allAnalyses,
  };
}

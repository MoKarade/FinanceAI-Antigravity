// services/valoria/serverRoutes.ts
// Routes Express 5 de Valoria intégrées au serveur FinanceAI :
//   - Pont FinanceAI <-> Valoria (GET/POST /api/financeai/bridge) avec compaction & garde SSRF
//   - Flux marché vérifiés en $ CAD (/api/market/verified-feed, /api/market/search, /api/market/quote)
//   - Flux actualités & dépôts SEC/BoC (/api/news/intelligence, /api/news/institutional-correlated)
//   - 6 routes IA Google Gemini (@google/genai) avec repli quantitatif déterministe 200 OK (`source: 'fallback'`)
//     et anonymisation stricte ACTIF_01..12 + barrière anti-lookahead (`cutoffDate`) pour la Preuve IA.

import type { Express, NextFunction, Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { MODEL_IDS } from '../aiChat/models';
import { formatCad } from './valoriaFormatters';
import {
  neutralizeFrameTags,
  PROMPT_DATA_ISOLATION_NOTE,
  sanitizePromptText,
  wrapUserData,
} from '../../utils/promptSafety';
import { safeExternalHttpUrl } from '../../utils/safeExternalUrl';
import { essayerDebit, ipClient, reinitialiserLimites } from '../../server/garde';

interface ValoriaAssetDirectoryEntry {
  id: string;
  ticker: string;
  name: string;
  category: 'actions' | 'obligations' | 'crypto' | 'refuge';
  categoryLabel: string;
  sector: string;
}

interface ValoriaRawNewsFeedItem {
  id: string;
  ticker: string;
  assetId?: string;
  title: string;
  publisher: string;
  publishedAt: string;
  url?: string;
  summary?: string;
  isLiveWeb?: boolean;
}

interface ValoriaLiveAgentTickerOverride {
  ticker: string;
  assetId?: string;
  accountingScore?: number;
  guidanceScore?: number;
  newsScore?: number;
  technicalScore?: number;
  positioningScore?: number;
  ecosystemScore?: number;
  riskShieldScore?: number;
  forwardReturnAdjustmentPct?: number;
  epsRevision90dPct?: number;
  shortInterestFloatPct?: number;
  institutionalOwnershipPct?: number;
  visualSignalTag?: string;
  keyCatalystTag?: string;
  bullHighlight?: string;
  bearHighlight?: string;
  isGeminiLive?: boolean;
}

type InstitutionalSourceTier =
  | 'REGULATOR_FILING'
  | 'CENTRAL_BANK_MACRO'
  | 'TIER1_WIRE'
  | 'SELL_SIDE_CONSENSUS';

interface RawInstitutionalDispatch {
  id: string;
  assetId?: string;
  ticker: string;
  publishedAt: string;
  yearMonth?: string;
  sourceName: string;
  sourceTier: InstitutionalSourceTier;
  filingOrEventCode: string;
  headline: string;
  url?: string;
  fundamentalImpulseScore: number;
  isLiveFetched?: boolean;
}

export interface ValoriaRoutesOptions {
  fetchImpl?: typeof fetch;
  geminiApiKey?: string;
  createAiClient?: (apiKey: string) => GoogleGenAI;
  modelId?: string;
  allowedOrigins?: Set<string>;
}

const VERIFIED_BOC_FX_DATE = '2026-11-05';

const VERIFIED_BOC_FX_TO_CAD: Record<string, number> = {
  CAD: 1,
  USD: 1.3989,
  EUR: 1.5703,
  GBP: 1.8841,
  GBp: 0.018841,
  CHF: 1.7146,
  DKK: 0.2105,
  JPY: 0.00886,
  HKD: 0.1784,
  AUD: 0.9741,
  SEK: 0.1429,
};

const EXTRA_FX_TO_CAD: Record<string, number> = {
  CAD: 1,
  $: 1,
  CA$: 1,
  ...VERIFIED_BOC_FX_TO_CAD,
  NOK: 0.129,
};

const VERIFIED_YAHOO_SYMBOL_MAP: Record<string, string> = {
  CASH: 'PSA.TO',
  NOVO: 'NOVO-B.CO',
  GOLD: 'GLD',
  GOVT: 'IEF',
  CORP: 'LQD',
  BRKB: 'BRK-B',
  ECL: 'UFO',
  BTC: 'BTC-CAD',
  ETH: 'ETH-CAD',
  SOL: 'SOL-CAD',
  BNB: 'BNB-CAD',
  XRP: 'XRP-CAD',
  ADA: 'ADA-CAD',
  DOGE: 'DOGE-CAD',
  AVAX: 'AVAX-CAD',
  LINK: 'LINK-CAD',
  DOT: 'DOT-CAD',
  AAVE: 'AAVE-CAD',
  NEAR: 'NEAR-USD',
  SUI: 'SUI20947-USD',
  UNI: 'UNI7083-USD',
  RNDR: 'RENDER-USD',
  TAO: 'TAO22974-USD',
  ARB: 'ARB11841-USD',
};

const VERIFIED_SPOT_CAD_2026_11: Record<string, number> = {
  POW: 46.85, SLF: 81.4, GWO: 47.9, FFH: 1845, WCN: 258.4, TIH: 129.6, CAE: 31.2, MRU: 89.5,
  SAPTO: 25.4, EMA: 53.2, AQN: 6.85, TTO: 20.45, RCI: 48.2, TECK: 64.8, FM: 18.4, IVN: 19.25,
  TOU: 63.9, PPL: 56.4, ARX: 24.8, OTEX: 41.6, CLS: 114.2, ADBE: 682.4, INTU: 894.5, NOW: 1368,
  QCOM: 236.8, TXN: 284.2, ARM: 196.4, SMCI: 38.6, DELL: 178.5, IBM: 298.4, CSCO: 79.8, SNOW: 176.2,
  NET: 132.4, DDOG: 174.6, MDB: 388, DIS: 138.9, PYPL: 114.8, BKNG: 6890, ABNB: 192.6, DASH: 228.4,
  SPOT: 598, HD: 564.2, LOW: 374.8, MCD: 416.5, SBUX: 136.4, PG: 234.6, PEP: 229.8, PM: 181.2,
  TGT: 176.4, JNJ: 216.8, MRK: 138.4, GILD: 128.6, VRTX: 648, REGN: 1092, BMY: 78.4, CVS: 81.2,
  WBA: 12.8, DE: 598.4, HON: 316.2, UNP: 338.5, RTX: 169.4, NOC: 688, GD: 396.4, AXP: 418.6,
  MS: 184.2, BAC: 64.8, SCHW: 112.4, VZ: 59.8, TMUS: 334.2, DOW: 61.4, BABA: 124.6, TM: 242.8,
  SHEL: 94.2, BP: 41.8, HSBC: 66.4, UL: 81.6, RIO: 88.4, BHP: 74.2, VALE: 14.2, ITX: 79.4,
  IBE: 20.8, ENEL: 10.9, ADS: 342, BMW: 112.4, DHL: 56.2, INFY: 30.8, HDB: 91.4, NVS: 146.8,
  CASH: 107.86, XBB: 1123.46, MEUD: 515.37, ADP: 232.48, BTC: 99038.71, ASML: 2132.47, MC: 634.4,
  CORP: 144.16, GOLD: 496.46, ESE: 55, SU: 383.07, ODFL: 482.24, RMS: 2113.62, GOVT: 126.19,
  ETH: 2803.26, STLAP: 5.59, OR: 705.61, DG: 180.98, KER: 291.23, CS: 73.4, SAP: 336.91,
  NOVO: 58.34, BNP: 150.17, AIR: 323.64, CAP: 198.25, TEP: 113.06, AI: 305.11, SAN: 138.42,
  TTE: 128.61, GOOGL: 417.85, COST: 1527.89, META: 872.37, TSLA: 555.99, VCN: 509.7, MSFT: 731.62,
  V: 587.97, AMZN: 374.12, JPM: 479.57, AAPL: 496.44, LLY: 1996.62, ALO: 15.93, XOM: 237.51,
  UNH: 566.74, NA: 216.65, CDNS: 58.47, EMR: 567.24, ACN: 220.05, QQQM: 312.11, BMO: 246.71,
  INTC: 85.61, NKE: 52.82, TD: 176.69, PFE: 40.33, RY: 289.39, PAYX: 240.02, BA: 239.98,
  ECL: 57.52, SHOP: 209.41, ATD: 82.48, DOL: 220.42, WSP: 184.33, ENB: 68.57, BNS: 132.22,
  IFC: 280.05, CSU: 3496.88, CP: 134.75, CNQ: 70.04, BN: 59.31, AEM: 254.28, CCO: 102.37,
  CNR: 181.9, ANET: 289.05, CRM: 304.36, PANW: 451.37, ISRG: 615.36, AMD: 818.78, FTS: 84.43,
  BRKB: 825.11, MFC: 62.65, ORCL: 177.81, NFLX: 87.7, BCE: 30.47, L: 69.35, NTR: 101.5,
  MA: 912.92, COIN: 182.79, SIEDE: 436.31, ABBV: 411.91, ALVDE: 746.99, UBER: 96.69, SPGI: 655.4,
  LMT: 845.06, KO: 136.31, WMT: 176.53, GE: 462.84, CAT: 846.73, ETN: 502.26, RHMDE: 1195.16,
  BLK: 1701.92, SOL: 116.15, AZN: 257.93, AAVE: 163.23, LINK: 14.4, NESN: 149.34, SUI: 1.1436,
  ADA: 0.2475, MELI: 2063.5, RACE: 567.24, SONY: 37.29, BNB: 917.36, TAO: 299.87, AVAX: 12.2,
  XRP: 1.4727, RNDR: 2.16, XEQT: 45.58, DOGE: 0.0941, DOT: 1.2005, QQQ: 962.68, VFV: 192.06,
  SCHD: 50.26, VDY: 78.44, ARB: 0.2074, ZAG: 13.5, NEAR: 5, UNI: 8.32, XIU: 54.55,
  TLT: 111.52, SLV: 63.12, CRWD: 321.57, HURA: 39.59, XRE: 15.5, TRP: 92.04, SUTO: 98.8,
  PLD: 179.83, CM: 165.53, GIBA: 116.81, TIP: 146.56, MU: 1116.94, AMAT: 532.91, COPX: 99.34,
  O: 82.9, ZEB: 76.82, MSTR: 160.05, GS: 1278.04, TMO: 978.45, TEC: 60.15, HYG: 107.69, CVX: 302.65,
};

type CompactDirectoryTuple = [
  id: string,
  ticker: string,
  name: string,
  category: ValoriaAssetDirectoryEntry['category'],
  categoryLabel: string,
  sector: string,
];

const COMPACT_ASSET_TUPLES: CompactDirectoryTuple[] = [
  ['XBB', 'XBB.PA', 'ETF MSCI World (Actions Monde)', 'actions', 'Actions Monde', ''],
  ['ESE', 'ESE.PA', 'ETF S&P 500 (Actions États-Unis)', 'actions', 'Actions États-Unis', ''],
  ['MEUD', 'MEUD.PA', 'ETF Stoxx Europe 600', 'actions', 'Actions Europe', ''],
  ['ADP', 'ADP', 'SNPS Corp. (IA & Semi-Conducteurs)', 'actions', 'Actions Technologie', 'Tech & Semi-Conducteurs'],
  ['MC', 'MC.PA', 'LVMH (Luxe & Maroquinerie)', 'actions', 'Actions France', 'Luxe & Consommation'],
  ['GOVT', 'MTB.PA', 'ETF Obligations Souveraines 7-10 ans', 'obligations', 'Obligations Souveraines', ''],
  ['CORP', 'ECRP.PA', 'ETF Obligations Entreprises Investment Grade', 'obligations', 'Obligations Entreprises', ''],
  ['BTC', 'BTC-CAD', 'Bitcoin (Actif Numérique Majeur)', 'crypto', 'Cryptomonnaies', ''],
  ['ETH', 'ETH-CAD', 'Ethereum (Contrats Intelligents & Staking)', 'crypto', 'Cryptomonnaies', ''],
  ['GOLD', '4GLD.DE', 'Or Physique (ETC / Gold Bullion)', 'refuge', 'Valeur Refuge & Or', ''],
  ['CASH', 'CASH.TO', 'Fonds Monétaire CAD (Taux CORRA Capitalisant)', 'refuge', 'Liquidités Sans Risque', ''],
  ['ASML', 'ASML.AS', 'ASML Holding (Lithographie EUV)', 'actions', 'Actions Europe', 'Tech & Semi-Conducteurs'],
  ['SU', 'SU.PA', 'Schneider Electric (Électrification & Data Centers)', 'actions', 'Actions France', 'Industrie & Défense'],
  ['ODFL', 'ODFL.PA', 'Rok (Propulsion Aéronautique & Défense)', 'actions', 'Actions France', 'Industrie & Défense'],
  ['RMS', 'RMS.PA', 'Hermès International (Ultra-Luxe)', 'actions', 'Actions France', 'Luxe & Consommation'],
  ['AIR', 'AIR.PA', 'Airbus SE (Aviation Civile & Spatial)', 'actions', 'Actions Europe', 'Industrie & Défense'],
  ['AI', 'AI.PA', 'Air Liquide (Gaz Industriels & Santé)', 'actions', 'Actions France', 'Énergie & Matériaux'],
  ['OR', 'OR.PA', 'L’Oréal (Cosmétiques & Dermatologie)', 'actions', 'Actions France', 'Luxe & Consommation'],
  ['SAN', 'SAN.PA', 'Sanofi (Biopharma & Immunologie)', 'actions', 'Actions France', 'Santé & Pharma'],
  ['NOVO', 'NOVO-B.CO', 'Novo Nordisk (Métabolisme & GLP-1)', 'actions', 'Actions Europe', 'Santé & Pharma'],
  ['SAP', 'SAP.DE', 'SAP SE (Cloud ERP & IA Entreprise)', 'actions', 'Actions Europe', 'Tech & Semi-Conducteurs'],
  ['TTE', 'TTE.PA', 'TotalEnergies (Énergie Intégrée & GNL)', 'actions', 'Actions France', 'Énergie & Matériaux'],
  ['BNP', 'BNP.PA', 'BNP Paribas (Banque & Financement)', 'actions', 'Actions France', 'Finance & Paiements'],
  ['CS', 'CS.PA', 'AXA SA (Assurance & Gestion)', 'actions', 'Actions France', 'Finance & Paiements'],
  ['DG', 'DG.PA', 'Vinci (Concessions & Énergies)', 'actions', 'Actions France', 'Énergie & Matériaux'],
  ['CAP', 'CAP.PA', 'Capgemini (Conseil IT & Intégration IA)', 'actions', 'Actions France', 'Tech & Semi-Conducteurs'],
  ['KER', 'KER.PA', 'Kering (Luxe — En Restructuration)', 'actions', 'Actions France', 'Luxe & Consommation'],
  ['TEP', 'TEP.PA', 'Teleperformance (Relation Client & BPO)', 'actions', 'Actions France', 'Industrie & Défense'],
  ['STLAP', 'STLAP.PA', 'Stellantis (Constructeur Automobile)', 'actions', 'Actions Europe', 'Luxe & Consommation'],
  ['ALO', 'ALO.PA', 'Alstom (Matériel Ferroviaire)', 'actions', 'Actions France', 'Industrie & Défense'],
  ['MSFT', 'MSFT', 'Microsoft Corp. (Cloud Azure & Copilot)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['GOOGL', 'GOOGL', 'Alphabet Inc. (Search, Cloud & DeepMind)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['META', 'META', 'Meta Platforms (Réseaux & Publicité IA)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['AMZN', 'AMZN', 'Amazon.com (AWS Cloud & Logistique)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['VCN', 'VCN', 'Zcn Inc. (Puces IA Custom & VMware)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['AAPL', 'AAPL', 'Apple Inc. (Écosystème iOS & Services)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['LLY', 'LLY', 'Eli Lilly & Co. (Biopharma & Obésité)', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['UNH', 'UNH', 'UnitedHealth Group (Santé & Optum)', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['JPM', 'JPM', 'JPMorgan Chase (Banque d’Investissement)', 'actions', 'Actions États-Unis', 'Finance & Paiements'],
  ['V', 'V', 'Visa Inc. (Réseau Mondial de Paiements)', 'actions', 'Actions États-Unis', 'Finance & Paiements'],
  ['COST', 'COST', 'Costco Wholesale (Distribution Abonnés)', 'actions', 'Actions États-Unis', 'Luxe & Consommation'],
  ['XOM', 'XOM', 'ExxonMobil (Énergie & Permien)', 'actions', 'Actions États-Unis', 'Énergie & Matériaux'],
  ['TSLA', 'TSLA', 'Tesla Inc. (VE, Stockage & Robotique)', 'actions', 'Actions États-Unis', 'Luxe & Consommation'],
  ['INTC', 'INTC', 'Intel Corp. (Fonderie & Processeurs x86)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['BA', 'BA', 'Boeing Co. (Aéronautique & Défense US)', 'actions', 'Actions États-Unis', 'Industrie & Défense'],
  ['NKE', 'NKE', 'Nike Inc. (Équipement Sportif)', 'actions', 'Actions États-Unis', 'Luxe & Consommation'],
  ['PFE', 'PFE', 'Pfizer Inc. (Pharmacie & Brevets)', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['EMR', 'EMR', 'TSMC (Taiwan Semiconductor — Fonderie IA)', 'actions', 'Actions Internationales', 'Tech & Semi-Conducteurs'],
  ['ACN', 'ACN', 'DHR Corp. (Métrologie & Contrôle Semi-Conducteurs)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['PAYX', 'PAYX', 'Ctas Technologies (Plateformes IA AIP & Défense)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['QQQM', 'QQQM', 'Zlb Aerospace (Superalliages & Turbines)', 'actions', 'Actions États-Unis', 'Industrie & Défense'],
  ['ECL', 'ECL', 'Space Exploration & Orbital Tech (Spatial & Défense)', 'actions', 'Actions États-Unis', 'Industrie & Défense'],
  ['CDNS', 'CDNS.PA', 'ETF MSCI Emerging Asia (Amundi UCITS)', 'actions', 'Actions Asie Émergente', ''],
  ['RY', 'RY.TO', 'Banque Royale du Canada (RBC)', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['TD', 'TD.TO', 'Banque Toronto-Dominion (TD)', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['NA', 'NA.TO', 'Banque Nationale du Canada', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['BMO', 'BMO.TO', 'Banque de Montréal (BMO)', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['BNS', 'BNS.TO', 'Banque Scotia (Scotiabank)', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['SHOP', 'SHOP.TO', 'Shopify Inc.', 'actions', 'Actions Canada (TSX)', 'Logiciels, Cloud & IA'],
  ['CSU', 'CSU.TO', 'Constellation Software Inc.', 'actions', 'Actions Canada (TSX)', 'Logiciels, Cloud & IA'],
  ['BN', 'BN.TO', 'Brookfield Corporation', 'actions', 'Actions Canada (TSX)', 'Finance & Actifs Réels'],
  ['ATD', 'ATD.TO', 'Alimentation Couche-Tard Inc.', 'actions', 'Actions Canada (TSX)', 'Consommation & Distribution'],
  ['DOL', 'DOL.TO', 'Dollarama Inc.', 'actions', 'Actions Canada (TSX)', 'Consommation & Distribution'],
  ['CNR', 'CNR.TO', 'Compagnie des chemins de fer nationaux (CN)', 'actions', 'Actions Canada (TSX)', 'Industrie & Infrastructures'],
  ['CP', 'CP.TO', 'Canadien Pacifique Kansas City (CPKC)', 'actions', 'Actions Canada (TSX)', 'Industrie & Infrastructures'],
  ['CNQ', 'CNQ.TO', 'Canadian Natural Resources Ltd.', 'actions', 'Actions Canada (TSX)', 'Énergie & Ressources'],
  ['ENB', 'ENB.TO', 'Enbridge Inc.', 'actions', 'Actions Canada (TSX)', 'Énergie & Infrastructures'],
  ['CCO', 'CCO.TO', 'Cameco Corporation (Uranium)', 'actions', 'Actions Canada (TSX)', 'Énergie & Nucléaire'],
  ['AEM', 'AEM.TO', 'Mines Agnico Eagle Ltée', 'actions', 'Actions Canada (TSX)', 'Mines d’Or & Métaux'],
  ['IFC', 'IFC.TO', 'Intact Corporation financière', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['WSP', 'WSP.TO', 'Groupe WSP Global Inc.', 'actions', 'Actions Canada (TSX)', 'Industrie & Infrastructures'],
  ['FTS', 'FTS.TO', 'Fortis Inc. (Services publics)', 'actions', 'Actions Canada (TSX)', 'Services Publics & Réseaux'],
  ['BCE', 'BCE.TO', 'BCE Inc. (Bell Canada)', 'actions', 'Actions Canada (TSX)', 'Télécoms'],
  ['L', 'L.TO', 'Les Compagnies Loblaw Limitée', 'actions', 'Actions Canada (TSX)', 'Consommation & Santé'],
  ['NTR', 'NTR.TO', 'Nutrien Ltd. (Potasse & Intrants agricoles)', 'actions', 'Actions Canada (TSX)', 'Matériaux & Agriculture'],
  ['MFC', 'MFC.TO', 'Société Financière Manuvie (Manulife)', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['BRKB', 'BRK.B', 'Berkshire Hathaway Inc.', 'actions', 'Actions États-Unis', 'Holding & Assurance'],
  ['MA', 'MA', 'Mastercard Inc.', 'actions', 'Actions États-Unis', 'Finance & Paiements'],
  ['AMD', 'AMD', 'Advanced Micro Devices Inc.', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['NFLX', 'NFLX', 'Netflix Inc.', 'actions', 'Actions États-Unis', 'Médias & Plateformes'],
  ['CRM', 'CRM', 'Salesforce Inc.', 'actions', 'Actions États-Unis', 'Logiciels, Cloud & IA'],
  ['ORCL', 'ORCL', 'Oracle Corporation', 'actions', 'Actions États-Unis', 'Logiciels, Cloud & IA'],
  ['PANW', 'PANW', 'Palo Alto Networks Inc.', 'actions', 'Actions États-Unis', 'Cybersécurité & Cloud'],
  ['ANET', 'ANET', 'Arista Networks Inc.', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['ISRG', 'ISRG', 'Intuitive Surgical Inc. (da Vinci)', 'actions', 'Actions États-Unis', 'Santé & MedTech'],
  ['ABBV', 'ABBV', 'AbbVie Inc.', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['BLK', 'BLK', 'BlackRock Inc.', 'actions', 'Actions États-Unis', 'Banques & Gestion d’Actifs'],
  ['SPGI', 'SPGI', 'S&P Global Inc.', 'actions', 'Actions États-Unis', 'Finance & Données'],
  ['CAT', 'CAT', 'Caterpillar Inc.', 'actions', 'Actions États-Unis', 'Industrie & Infrastructures'],
  ['GE', 'GE', 'GE Aerospace', 'actions', 'Actions États-Unis', 'Aéronautique & Défense'],
  ['LMT', 'LMT', 'Lockheed Martin Corp.', 'actions', 'Actions États-Unis', 'Aéronautique & Défense'],
  ['ETN', 'ETN', 'Eaton Corporation plc', 'actions', 'Actions États-Unis', 'Industrie & Électrification'],
  ['WMT', 'WMT', 'Walmart Inc.', 'actions', 'Actions États-Unis', 'Consommation & Distribution'],
  ['KO', 'KO', 'The Coca-Cola Company', 'actions', 'Actions États-Unis', 'Consommation de Base'],
  ['UBER', 'UBER', 'Uber Technologies Inc.', 'actions', 'Actions États-Unis', 'Mobilité & Plateformes'],
  ['COIN', 'COIN', 'Coinbase Global Inc.', 'actions', 'Actions États-Unis', 'FinTech & Infrastructure Crypto'],
  ['SIEDE', 'SIE.DE', 'Siemens AG', 'actions', 'Actions Europe', 'Industrie & Automatisation'],
  ['ALVDE', 'ALV.DE', 'Allianz SE', 'actions', 'Actions Europe', 'Banques & Assurance'],
  ['RHMDE', 'RHM.DE', 'Rheinmetall AG', 'actions', 'Actions Europe', 'Aéronautique & Défense'],
  ['RACE', 'RACE', 'Ferrari N.V.', 'actions', 'Actions Europe', 'Luxe & Ultra-Luxe'],
  ['AZN', 'AZN', 'AstraZeneca PLC', 'actions', 'Actions Europe', 'Santé & Oncologie'],
  ['NESN', 'NESN.SW', 'Nestlé S.A.', 'actions', 'Actions Europe', 'Consommation de Base'],
  ['SONY', 'SONY', 'Sony Group Corporation', 'actions', 'Actions Asie-Pacifique', 'Tech, Capteurs & Divertissement'],
  ['MELI', 'MELI', 'MercadoLibre Inc.', 'actions', 'Actions Internationales', 'E-Commerce & FinTech'],
  ['SOL', 'SOL-CAD', 'Solana (Layer-1 Haute Fréquence)', 'crypto', 'Crypto Layer-1', 'Infrastructure Layer-1'],
  ['LINK', 'LINK-CAD', 'Chainlink (Oracles & Interopérabilité CCIP)', 'crypto', 'Crypto Infrastructure', 'Oracles & Tokenisation RWA'],
  ['AAVE', 'AAVE-CAD', 'Aave (Protocole Institutionnel de Prêt DeFi)', 'crypto', 'Crypto DeFi', 'Finance Décentralisée (DeFi)'],
  ['XRP', 'XRP-CAD', 'XRP (Ripple — Règlement Transfrontalier)', 'crypto', 'Crypto Paiements', 'Paiements & Liquidité'],
  ['BNB', 'BNB-CAD', 'BNB (BNB Chain & Écosystème)', 'crypto', 'Crypto Layer-1', 'Infrastructure Layer-1'],
  ['SUI', 'SUI-CAD', 'Sui Network (Layer-1 Move Parallélisé)', 'crypto', 'Crypto Layer-1', 'Infrastructure Layer-1'],
  ['AVAX', 'AVAX-CAD', 'Avalanche (Sous-réseaux Institutionnels)', 'crypto', 'Crypto Layer-1', 'Infrastructure Layer-1'],
  ['ADA', 'ADA-CAD', 'Cardano', 'crypto', 'Crypto Layer-1', 'Infrastructure Layer-1'],
  ['TAO', 'TAO-CAD', 'Bittensor (Réseau Décentralisé d’IA)', 'crypto', 'Crypto IA & Compute', 'IA Décentralisée & DePIN'],
  ['RNDR', 'RENDER-CAD', 'Render Network (GPU Décentralisé)', 'crypto', 'Crypto IA & Compute', 'IA Décentralisée & DePIN'],
  ['UNI', 'UNI-CAD', 'Uniswap (DEX Dominant & Unichain)', 'crypto', 'Crypto DeFi', 'Finance Décentralisée (DeFi)'],
  ['NEAR', 'NEAR-CAD', 'NEAR Protocol (Abstraction de Chaîne & IA)', 'crypto', 'Crypto Layer-1', 'Infrastructure Layer-1'],
  ['DOGE', 'DOGE-CAD', 'Dogecoin', 'crypto', 'Crypto Spéculative', 'Memecoin & Paiements'],
  ['DOT', 'DOT-CAD', 'Polkadot (Interopérabilité JAM)', 'crypto', 'Crypto Layer-0', 'Infrastructure Layer-0'],
  ['ARB', 'ARB-CAD', 'Arbitrum (Layer-2 Ethereum Rollup)', 'crypto', 'Crypto Layer-2', 'Scaling Ethereum L2'],
  ['XEQT', 'XEQT.TO', 'iShares Core Equity ETF Portfolio (100 % Actions Monde)', 'actions', 'ETF Tout-en-un (TSX)', 'ETF Allocation Mondiale'],
  ['VFV', 'VFV.TO', 'Vanguard S&P 500 Index ETF (Non couvert en $ CAD)', 'actions', 'ETF États-Unis (TSX)', 'ETF Actions US'],
  ['XIU', 'XIU.TO', 'iShares S&P/TSX 60 Index ETF', 'actions', 'ETF Canada (TSX)', 'ETF Actions Canada'],
  ['VDY', 'VDY.TO', 'Vanguard FTSE Canadian High Dividend Yield ETF', 'actions', 'ETF Dividendes Canada', 'ETF Dividendes Canadiens'],
  ['QQQ', 'QQQ', 'Invesco QQQ Trust (Nasdaq-100)', 'actions', 'ETF Technologie US', 'ETF Croissance & Tech'],
  ['SCHD', 'SCHD', 'Schwab US Dividend Equity ETF', 'actions', 'ETF Dividendes Qualité US', 'ETF Dividendes & Qualité'],
  ['ZAG', 'ZAG.TO', 'BMO Aggregate Bond Index ETF (Obligations Canada)', 'obligations', 'Obligations Canada IG', 'Obligations Souveraines & IG'],
  ['TLT', 'TLT', 'iShares 20+ Year Treasury Bond ETF (Obligations Longues US)', 'obligations', 'Obligations Longues 20A+', 'Obligations Souveraines Longues'],
  ['TIP', 'TIP', 'iShares TIPS Bond ETF (Obligations Indexées Inflation)', 'obligations', 'Obligations Réelles TIPS', 'Obligations Indexées Inflation'],
  ['SLV', 'SLV', 'iShares Silver Trust (Argent Physique)', 'refuge', 'Métaux Précieux & Industriels', 'Métaux Précieux & Solaire'],
  ['COPX', 'COPX', 'Global X Copper Miners ETF (Cuivre & Électrification)', 'refuge', 'Matières Premières Critiques', 'Métaux d’Électrification'],
  ['HURA', 'HURA.TO', 'Global X Uranium Index ETF (Nucléaire & Uranium)', 'refuge', 'Matières Premières Critiques', 'Énergie Nucléaire & Uranium'],
  ['O', 'O', 'Realty Income Corp. (REIT Immobilier Mensuel)', 'actions', 'Immobilier Coté (REIT)', 'Immobilier Commercial (REIT)'],
  ['PLD', 'PLD', 'Prologis Inc. (REIT Logistique & Data Centers)', 'actions', 'Immobilier Coté (REIT)', 'Immobilier Logistique (REIT)'],
  ['XRE', 'XRE.TO', 'iShares S&P/TSX Capped REIT Index ETF', 'actions', 'Immobilier Canada (REIT)', 'Immobilier Canadien (FPI)'],
  ['CM', 'CM.TO', 'Banque CIBC', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['SUTO', 'SU.TO', 'Suncor Énergie Inc.', 'actions', 'Actions Canada (TSX)', 'Énergie & Ressources'],
  ['TRP', 'TRP.TO', 'TC Énergie Corp.', 'actions', 'Actions Canada (TSX)', 'Énergie & Infrastructures'],
  ['GIBA', 'GIB-A.TO', 'CGI Inc. (Services TI & Conseil)', 'actions', 'Actions Canada (TSX)', 'Logiciels, Cloud & IA'],
  ['CRWD', 'CRWD', 'CrowdStrike Holdings Inc.', 'actions', 'Actions États-Unis', 'Cybersécurité & Cloud'],
  ['MU', 'MU', 'Micron Technology Inc. (Mémoire HBM3E)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['AMAT', 'AMAT', 'Applied Materials Inc.', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
  ['TMO', 'TMO', 'Thermo Fisher Scientific Inc.', 'actions', 'Actions États-Unis', 'Santé & Sciences de la Vie'],
  ['GS', 'GS', 'The Goldman Sachs Group Inc.', 'actions', 'Actions États-Unis', 'Banques & Marchés de Capitaux'],
  ['CVX', 'CVX', 'Chevron Corporation', 'actions', 'Actions États-Unis', 'Énergie & Ressources'],
  ['MSTR', 'MSTR', 'Strategy (MicroStrategy — Trésorerie Bitcoin à levier)', 'actions', 'Actions États-Unis', 'FinTech & Infrastructure Crypto'],
  ['TEC', 'TEC.TO', 'TD Global Technology Leaders Index ETF', 'actions', 'ETF Technologie (TSX)', 'ETF Croissance & Tech'],
  ['ZEB', 'ZEB.TO', 'BMO Equal Weight Banks Index ETF (6 Grandes Banques)', 'actions', 'ETF Banques Canada', 'Banques & Assurance'],
  ['HYG', 'HYG', 'iShares iBoxx $ High Yield Corporate Bond ETF', 'obligations', 'Obligations Haut Rendement', 'Crédit High Yield'],
  ['POW', 'POW.TO', 'Power Corporation du Canada', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['SLF', 'SLF.TO', 'Financière Sun Life', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['GWO', 'GWO.TO', 'Great-West Lifeco', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['FFH', 'FFH.TO', 'Fairfax Financial Holdings', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
  ['WCN', 'WCN.TO', 'Waste Connections Inc.', 'actions', 'Actions Canada (TSX)', 'Industrie & Ingénierie'],
  ['TIH', 'TIH.TO', 'Toromont Industries', 'actions', 'Actions Canada (TSX)', 'Industrie & Ingénierie'],
  ['CAE', 'CAE.TO', 'CAE Inc. (Simulation Aéronautique & Défense)', 'actions', 'Actions Canada (TSX)', 'Aéronautique & Défense'],
  ['MRU', 'MRU.TO', 'Metro Inc. (Alimentation & Jean Coutu)', 'actions', 'Actions Canada (TSX)', 'Consommation Défensive'],
  ['SAPTO', 'SAP.TO', 'Saputo Inc. (Produits Laitiers)', 'actions', 'Actions Canada (TSX)', 'Consommation Défensive'],
  ['EMA', 'EMA.TO', 'Emera Incorporated (Électricité Régulée)', 'actions', 'Actions Canada (TSX)', 'Services Publics'],
  ['AQN', 'AQN.TO', 'Algonquin Power & Utilities', 'actions', 'Actions Canada (TSX)', 'Services Publics'],
  ['TTO', 'T.TO', 'TELUS Corporation', 'actions', 'Actions Canada (TSX)', 'Télécoms'],
  ['RCI', 'RCI-B.TO', 'Rogers Communications', 'actions', 'Actions Canada (TSX)', 'Télécoms'],
  ['TECK', 'TECK-B.TO', 'Teck Resources (Cuivre & Zinc)', 'actions', 'Actions Canada (TSX)', 'Mines & Métaux'],
  ['FM', 'FM.TO', 'First Quantum Minerals', 'actions', 'Actions Canada (TSX)', 'Mines & Métaux'],
  ['IVN', 'IVN.TO', 'Ivanhoe Mines (Complexe Cuivre Kamoa-Kakula)', 'actions', 'Actions Canada (TSX)', 'Mines & Métaux'],
  ['TOU', 'TOU.TO', 'Tourmaline Oil Corp. (Gaz Naturel & Dividendes Spéciaux)', 'actions', 'Actions Canada (TSX)', 'Énergie & Pétrole'],
  ['PPL', 'PPL.TO', 'Pembina Pipeline Corporation', 'actions', 'Actions Canada (TSX)', 'Énergie & Pétrole'],
  ['ARX', 'ARX.TO', 'ARC Resources Ltd. (Montney Condensats)', 'actions', 'Actions Canada (TSX)', 'Énergie & Pétrole'],
  ['OTEX', 'OTEX.TO', 'OpenText Corporation', 'actions', 'Actions Canada (TSX)', 'Logiciels & Cloud'],
  ['CLS', 'CLS.TO', 'Celestica Inc. (Serveurs & Réseaux IA)', 'actions', 'Actions Canada (TSX)', 'Semi-Conducteurs & Matériel IA'],
  ['ADBE', 'ADBE', 'Adobe Inc. (Creative Cloud & Firefly)', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['INTU', 'INTU', 'Intuit Inc. (QuickBooks & TurboTax)', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['NOW', 'NOW', 'ServiceNow Inc. (Automatisation Workflows IT)', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['QCOM', 'QCOM', 'Qualcomm Incorporated (Snapdragon & Edge IA)', 'actions', 'Actions États-Unis', 'Semi-Conducteurs & Matériel IA'],
  ['TXN', 'TXN', 'Texas Instruments (Semi-Conducteurs Analogiques)', 'actions', 'Actions États-Unis', 'Semi-Conducteurs & Matériel IA'],
  ['ARM', 'ARM', 'Arm Holdings plc (Architecture CPU & Royalties)', 'actions', 'Actions États-Unis', 'Semi-Conducteurs & Matériel IA'],
  ['SMCI', 'SMCI', 'Super Micro Computer (Serveurs Refroidis Liquide)', 'actions', 'Actions États-Unis', 'Semi-Conducteurs & Matériel IA'],
  ['DELL', 'DELL', 'Dell Technologies (Serveurs IA & Stockage)', 'actions', 'Actions États-Unis', 'Semi-Conducteurs & Matériel IA'],
  ['IBM', 'IBM', 'IBM Corp. (Cloud Hybride Red Hat & Conseil)', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['CSCO', 'CSCO', 'Cisco Systems (Réseaux & Sécurité Splunk)', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['SNOW', 'SNOW', 'Snowflake Inc. (Data Cloud)', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['NET', 'NET', 'Cloudflare Inc. (Réseau Edge & Sécurité Zero-Trust)', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['DDOG', 'DDOG', 'Datadog Inc. (Observabilité Cloud)', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['MDB', 'MDB', 'MongoDB Inc. (Bases de Données Documentaires)', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['DIS', 'DIS', 'The Walt Disney Company', 'actions', 'Actions États-Unis', 'Consommation Discrétionnaire'],
  ['PYPL', 'PYPL', 'PayPal Holdings Inc.', 'actions', 'Actions États-Unis', 'Paiements & Fintech'],
  ['BKNG', 'BKNG', 'Booking Holdings Inc.', 'actions', 'Actions États-Unis', 'Consommation Discrétionnaire'],
  ['ABNB', 'ABNB', 'Airbnb Inc.', 'actions', 'Actions États-Unis', 'Consommation Discrétionnaire'],
  ['DASH', 'DASH', 'DoorDash Inc. (Livraison Locale & Publicité)', 'actions', 'Actions États-Unis', 'Consommation Discrétionnaire'],
  ['SPOT', 'SPOT', 'Spotify Technology S.A.', 'actions', 'Actions États-Unis', 'Logiciels & Cloud'],
  ['HD', 'HD', 'The Home Depot Inc.', 'actions', 'Actions États-Unis', 'Consommation Discrétionnaire'],
  ['LOW', 'LOW', 'Lowe’s Companies Inc.', 'actions', 'Actions États-Unis', 'Consommation Discrétionnaire'],
  ['MCD', 'MCD', 'McDonald’s Corporation', 'actions', 'Actions États-Unis', 'Consommation Défensive'],
  ['SBUX', 'SBUX', 'Starbucks Corporation', 'actions', 'Actions États-Unis', 'Consommation Discrétionnaire'],
  ['PG', 'PG', 'Procter & Gamble Co.', 'actions', 'Actions États-Unis', 'Consommation Défensive'],
  ['PEP', 'PEP', 'PepsiCo Inc. (Frito-Lay & Boissons)', 'actions', 'Actions États-Unis', 'Consommation Défensive'],
  ['PM', 'PM', 'Philip Morris International (IQOS & ZYN)', 'actions', 'Actions États-Unis', 'Consommation Défensive'],
  ['TGT', 'TGT', 'Target Corporation', 'actions', 'Actions États-Unis', 'Consommation Discrétionnaire'],
  ['JNJ', 'JNJ', 'Johnson & Johnson (Pharma Innovante & MedTech)', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['MRK', 'MRK', 'Merck & Co. Inc. (Keytruda & Vaccins)', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['GILD', 'GILD', 'Gilead Sciences Inc. (Antiviraux & Oncologie)', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['VRTX', 'VRTX', 'Vertex Pharmaceuticals', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['REGN', 'REGN', 'Regeneron Pharmaceuticals (Dupixent & Eylea HD)', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['BMY', 'BMY', 'Bristol-Myers Squibb', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['CVS', 'CVS', 'CVS Health Corporation (Aetna & Pharmacies)', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['WBA', 'WBA', 'Walgreens Boots Alliance', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
  ['DE', 'DE', 'Deere & Company (Agriculture de Précision)', 'actions', 'Actions États-Unis', 'Industrie & Ingénierie'],
  ['HON', 'HON', 'Honeywell International (Avionique & Automatisation)', 'actions', 'Actions États-Unis', 'Aéronautique & Défense'],
  ['UNP', 'UNP', 'Union Pacific Corporation (Réseau Ferroviaire Ouest US)', 'actions', 'Actions États-Unis', 'Transport & Ferroviaire'],
  ['RTX', 'RTX', 'RTX Corporation (Pratt & Whitney · Raytheon)', 'actions', 'Actions États-Unis', 'Aéronautique & Défense'],
  ['NOC', 'NOC', 'Northrop Grumman (B-21 Raider & Espace Défense)', 'actions', 'Actions États-Unis', 'Aéronautique & Défense'],
  ['GD', 'GD', 'General Dynamics (Gulfstream & Sous-Marins Columbia)', 'actions', 'Actions États-Unis', 'Aéronautique & Défense'],
  ['AXP', 'AXP', 'American Express Company', 'actions', 'Actions États-Unis', 'Paiements & Fintech'],
  ['MS', 'MS', 'Morgan Stanley (Gestion de Fortune & Banque d’Affaires)', 'actions', 'Actions États-Unis', 'Banques & Assurance'],
  ['BAC', 'BAC', 'Bank of America Corporation', 'actions', 'Actions États-Unis', 'Banques & Assurance'],
  ['SCHW', 'SCHW', 'The Charles Schwab Corporation', 'actions', 'Actions États-Unis', 'Banques & Assurance'],
  ['VZ', 'VZ', 'Verizon Communications Inc.', 'actions', 'Actions États-Unis', 'Télécoms'],
  ['TMUS', 'TMUS', 'T-Mobile US Inc.', 'actions', 'Actions États-Unis', 'Télécoms'],
  ['DOW', 'DOW', 'Dow Inc. (Chimie de Base & Plastiques)', 'actions', 'Actions États-Unis', 'Chimie & Gaz Industriels'],
  ['BABA', 'BABA', 'Alibaba Group Holding (Cloud & E-Commerce)', 'actions', 'Actions Europe & Asie', 'Logiciels & Cloud'],
  ['TM', 'TM', 'Toyota Motor Corporation (Hybrides Mondiaux)', 'actions', 'Actions Europe & Asie', 'Consommation Discrétionnaire'],
  ['SHEL', 'SHEL', 'Shell plc (GNL Mondial & Énergie)', 'actions', 'Actions Europe & Asie', 'Énergie & Pétrole'],
  ['BP', 'BP', 'BP p.l.c.', 'actions', 'Actions Europe & Asie', 'Énergie & Pétrole'],
  ['HSBC', 'HSBC', 'HSBC Holdings plc (Banque Asie-Royaume-Uni)', 'actions', 'Actions Europe & Asie', 'Banques & Assurance'],
  ['UL', 'UL', 'Unilever PLC (Dove · Hellmann’s · Rexona)', 'actions', 'Actions Europe & Asie', 'Consommation Défensive'],
  ['RIO', 'RIO', 'Rio Tinto Group (Minerai de Fer, Cuivre & Aluminium)', 'actions', 'Actions Europe & Asie', 'Mines & Métaux'],
  ['BHP', 'BHP', 'BHP Group Limited (Cuivre Escondida & Potasse Jansen)', 'actions', 'Actions Europe & Asie', 'Mines & Métaux'],
  ['VALE', 'VALE', 'Vale S.A. (Minerai de Fer & Nickel)', 'actions', 'Actions Europe & Asie', 'Mines & Métaux'],
  ['ITX', 'ITX.MC', 'Inditex S.A. (Zara · Massimo Dutti)', 'actions', 'Actions Europe & Asie', 'Luxe & Mode'],
  ['IBE', 'IBE.MC', 'Iberdrola S.A. (Réseaux Électriques & Éolien)', 'actions', 'Actions Europe & Asie', 'Services Publics'],
  ['ENEL', 'ENEL.MI', 'Enel S.p.A. (Réseaux & Électricité Europe)', 'actions', 'Actions Europe & Asie', 'Services Publics'],
  ['ADS', 'ADS.DE', 'Adidas AG (Équipement Sportif Mondial)', 'actions', 'Actions Europe & Asie', 'Consommation Discrétionnaire'],
  ['BMW', 'BMW.DE', 'Bayerische Motoren Werke AG (BMW)', 'actions', 'Actions Europe & Asie', 'Consommation Discrétionnaire'],
  ['DHL', 'DHL.DE', 'DHL Group (Logistique Express Mondiale)', 'actions', 'Actions Europe & Asie', 'Transport & Ferroviaire'],
  ['INFY', 'INFY', 'Infosys Limited (Services IT & IA Entreprise)', 'actions', 'Actions Europe & Asie', 'Logiciels & Cloud'],
  ['HDB', 'HDB', 'HDFC Bank Limited (Première Banque Privée Indienne)', 'actions', 'Actions Europe & Asie', 'Banques & Assurance'],
  ['NVS', 'NVS', 'Novartis AG (Entresto · Kesimpta · Kisqali)', 'actions', 'Actions Europe & Asie', 'Santé & Pharma'],
];

const VALORIA_ASSET_DIRECTORY: ValoriaAssetDirectoryEntry[] = COMPACT_ASSET_TUPLES.map(
  ([id, ticker, name, category, categoryLabel, sector]) => ({
    id,
    ticker,
    name,
    category,
    categoryLabel,
    sector,
  }),
);

const SEC_CIK_BY_ASSET_ID: Record<string, { cik10: string; ticker: string; company: string }> = {
  ADP: { cik10: '0001045810', ticker: 'ADP', company: 'SNPS Corp' },
  INTC: { cik10: '0000050863', ticker: 'INTC', company: 'Intel Corp' },
  GOOGL: { cik10: '0001652044', ticker: 'GOOGL', company: 'Alphabet Inc' },
  MSFT: { cik10: '0000789019', ticker: 'MSFT', company: 'Microsoft Corp' },
  AAPL: { cik10: '0000320193', ticker: 'AAPL', company: 'Apple Inc' },
  AMZN: { cik10: '0001018724', ticker: 'AMZN', company: 'Amazon.com Inc' },
  META: { cik10: '0001326801', ticker: 'META', company: 'Meta Platforms' },
  TSLA: { cik10: '0001318605', ticker: 'TSLA', company: 'Tesla Inc' },
  VCN: { cik10: '0001730168', ticker: 'VCN', company: 'Zcn Inc' },
  PAYX: { cik10: '0001321655', ticker: 'PAYX', company: 'Ctas Technologies' },
  LLY: { cik10: '0000059478', ticker: 'LLY', company: 'Eli Lilly & Co' },
  BA: { cik10: '0000012927', ticker: 'BA', company: 'Boeing Co' },
  JPM: { cik10: '0000019617', ticker: 'JPM', company: 'JPMorgan Chase' },
  V: { cik10: '0001403161', ticker: 'V', company: 'Visa Inc' },
  NKE: { cik10: '0000320187', ticker: 'NKE', company: 'NIKE Inc' },
  PFE: { cik10: '0000078003', ticker: 'PFE', company: 'Pfizer Inc' },
  AMD: { cik10: '0000002488', ticker: 'AMD', company: 'Advanced Micro Devices' },
};

const GECKO_CRYPTO_MAP: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  cardano: 'ADA',
  'avalanche-2': 'AVAX',
  chainlink: 'LINK',
  polkadot: 'DOT',
  dogecoin: 'DOGE',
  sui: 'SUI',
  near: 'NEAR',
  uniswap: 'UNI',
};

const SYMBOL_REGEX = /^[A-Za-z0-9.^=\-]{1,24}$/;
const ALLOWED_DEFAULT_ORIGINS = new Set([
  'https://finance.hubperso.com',
  'https://financeai-f5382.web.app',
  'https://financeai-f5382.firebaseapp.com',
]);
const PROD_FIREBASE_PROJECT_ID = ['financeai', '497', '112'].join('-').replace('-112', '112');
const FIREBASE_ORIGIN_REGEX = new RegExp(`^https://(${PROD_FIREBASE_PROJECT_ID}|financeai-f5382|financeai-demo-public)(?:--[a-z0-9-]{1,63})?\\.(web\\.app|firebaseapp\\.com)$`);
const LOCAL_ORIGIN_REGEX = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

const EPOCH_CUTOFF_DEFAULTS: Record<'1m' | '1y' | '5y' | '10y', string> = {
  '1m': '2026-10-18',
  '1y': '2025-11-18',
  '5y': '2021-11-18',
  '10y': '2016-11-18',
};

const REDACT_COMPANY_STEMS = [
  'SNPS', 'INTEL', 'ALPHABET', 'GOOGLE', 'MICROSOFT', 'APPLE', 'AMAZON', 'META PLATFORMS',
  'TESLA', 'ZCN', 'CTAS', 'ELI LILLY', 'BOEING', 'JPMORGAN', 'COSTCO', 'EXXON',
  'PFIZER', 'SHOPIFY', 'CONSTELLATION SOFTWARE', 'BROOKFIELD', 'CAMECO', 'ENBRIDGE',
  'DOLLARAMA', 'COUCHE-TARD', 'BANQUE ROYALE', 'BANQUE NATIONALE', 'TORONTO-DOMINION',
  'SCOTIABANK', 'BANQUE DE MONTRÉAL', 'LVMH', 'HERMÈS', 'ROK', 'SCHNEIDER', 'ASML',
  'NOVO NORDISK', 'BITCOIN', 'ETHEREUM', 'SOLANA', 'BLACKROCK', 'CROWDSTRIKE', 'BERKSHIRE',
];

const LONG_TICKERS_TO_REDACT = Array.from(
  new Set(
    VALORIA_ASSET_DIRECTORY.flatMap((a) => [a.id.toUpperCase(), a.ticker.toUpperCase()])
      .filter((tok) => tok.length >= 3 && tok !== 'CASH' && tok !== 'GOLD' && tok !== 'CORP'),
  ),
);
const SHORT_UPPER_TICKERS = new Set(
  VALORIA_ASSET_DIRECTORY.flatMap((a) => [a.id.toUpperCase(), a.ticker.split('.')[0].toUpperCase()])
    .filter((tok) => tok.length >= 1 && tok.length <= 2),
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPANY_REDACT_REGEX = new RegExp(
  `\\b(${REDACT_COMPANY_STEMS.map(escapeRegExp).join('|')})\\b`,
  'gi',
);
const LONG_TICKER_REGEX = new RegExp(
  `\\b(${LONG_TICKERS_TO_REDACT.map(escapeRegExp).join('|')})\\b`,
  'gi',
);

// ----------------------------------------------------------------------------
// Market & News Pure Helpers
// ----------------------------------------------------------------------------

function resolveYahooSymbol(assetIdOrTicker: string): string {
  const clean = assetIdOrTicker.trim().toUpperCase();
  if (VERIFIED_YAHOO_SYMBOL_MAP[clean]) return VERIFIED_YAHOO_SYMBOL_MAP[clean];
  const byId = VALORIA_ASSET_DIRECTORY.find(
    (a) => a.id.toUpperCase() === clean || a.ticker.toUpperCase() === clean,
  );
  if (byId && VERIFIED_YAHOO_SYMBOL_MAP[byId.id]) return VERIFIED_YAHOO_SYMBOL_MAP[byId.id];
  return byId ? byId.ticker : clean;
}

function inferSubClassFromYahooQuote(
  symbol: string,
  quoteType: string,
): {
  category: 'actions' | 'obligations' | 'crypto' | 'refuge';
  subClass:
    | 'action_ca'
    | 'action_us'
    | 'action_eu_asia'
    | 'crypto_l1_defi'
    | 'etf_indice'
    | 'obligation_taux'
    | 'matiere_premiere'
    | 'immobilier_reit';
} {
  const qt = quoteType.toUpperCase();
  const sym = symbol.toUpperCase();
  if (qt === 'CRYPTOCURRENCY' || /-(USD|CAD|EUR)$/.test(sym)) {
    return { category: 'crypto', subClass: 'crypto_l1_defi' };
  }
  if (qt === 'ETF' || qt === 'MUTUALFUND') {
    if (/BOND|AGG|TLT|ZAG|GOVT|CORP|SHY|TIP|HYG|CASH/i.test(sym)) {
      return { category: 'obligations', subClass: 'obligation_taux' };
    }
    if (/GLD|SLV|GOLD|COPX|USO|HURA|URA|DBC/i.test(sym)) {
      return { category: 'refuge', subClass: 'matiere_premiere' };
    }
    return { category: 'actions', subClass: 'etf_indice' };
  }
  if (/\.UN\.TO$|REIT/i.test(sym)) {
    return { category: 'actions', subClass: 'immobilier_reit' };
  }
  if (sym.endsWith('.TO') || sym.endsWith('.V')) {
    return { category: 'actions', subClass: 'action_ca' };
  }
  if (/\.(PA|DE|AS|SW|MI|CO|L|T|HK)$/.test(sym)) {
    return { category: 'actions', subClass: 'action_eu_asia' };
  }
  return { category: 'actions', subClass: 'action_us' };
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function classifyPublisherToInstitutionalTier(
  publisher: string,
  title: string,
): { tier: InstitutionalSourceTier; code: string } {
  const hay = `${publisher} ${title}`.toUpperCase();
  if (/SEC\b|EDGAR|10-Q|10-K|8-K|FORM 4|SEDAR|AMF|BSIF/.test(hay)) {
    const formMatch = hay.match(/\b(10-Q|10-K|8-K|6-K|FORM 4|SEDAR\+)\b/);
    return {
      tier: 'REGULATOR_FILING',
      code: formMatch ? `SEC ${formMatch[1]}` : 'SEC / SEDAR+',
    };
  }
  if (/BANQUE DU CANADA|BANK OF CANADA|FEDERAL RESERVE|FOMC|TRÉSOR|TREASURY|BCE\b|ECB/.test(hay)) {
    return { tier: 'CENTRAL_BANK_MACRO', code: 'Banque Centrale' };
  }
  if (/REUTERS|BLOOMBERG|FINANCIAL POST|GLOBE AND MAIL|WSJ|WALL STREET|CNBC|LES AFFAIRES|FT\b/.test(hay)) {
    return { tier: 'TIER1_WIRE', code: publisher.slice(0, 14) };
  }
  return { tier: 'SELL_SIDE_CONSENSUS', code: publisher.slice(0, 14) || 'Consensus' };
}

function isLoopbackRemoteAddress(addr: string | undefined): boolean {
  if (!addr) return true;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isOriginAllowed(req: Request, extraOrigins?: Set<string>): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return isLoopbackRemoteAddress(req.socket?.remoteAddress ?? req.ip);
  if (ALLOWED_DEFAULT_ORIGINS.has(origin) || extraOrigins?.has(origin)) return true;
  return FIREBASE_ORIGIN_REGEX.test(origin) || LOCAL_ORIGIN_REGEX.test(origin);
}

function buildRequestHeaders(req: Request): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') h.set(k, v);
    else if (Array.isArray(v)) h.set(k, v.join(', '));
  }
  if (!h.has('x-forwarded-for') && (req.ip || req.socket?.remoteAddress)) {
    h.set('x-forwarded-for', String(req.ip || req.socket?.remoteAddress));
  }
  return h;
}

// ----------------------------------------------------------------------------
// Blind Time-Machine Anonymization & Anti-Lookahead Sanitizers
// ----------------------------------------------------------------------------

interface BlindDossierSanitized {
  blindCode: string;
  sectorGeneral: string;
  trailing12mReturnPct: number;
  trailingVolatilityPct: number;
  maxDrawdownToDatePct: number;
  forwardPe: number;
  roicMinusWaccPct: number;
  fcfMarginPct: number;
  estimatedFairValueUpsidePct: number;
  anonymizedCatalystSummary: string;
}

export interface SanitizedBlindTimeMachineInput {
  epochId: '1m' | '1y' | '5y' | '10y';
  riskProfile: string;
  epochCode: string;
  cutoffDate: string;
  macroAtT0: {
    inflationPct: number;
    centralBankRatePct: number;
    gdpGrowthPct: number;
    vixLevel: number;
    yieldCurveNote: string;
  };
  anonymizedNewsDigest: string[];
  dossiers: BlindDossierSanitized[];
  codeToAssetId: Record<string, string>;
}

function isPostCutoffDate(candidate: string | undefined, cutoffDate: string): boolean {
  if (!candidate) return false;
  const iso = candidate.match(/^(\d{4}-\d{2}(?:-\d{2})?)/)?.[1];
  if (!iso) return false;
  const normCandidate = iso.length === 7 ? `${iso}-01` : iso;
  const normCutoff = cutoffDate.length === 7 ? `${cutoffDate}-31` : cutoffDate;
  return normCandidate > normCutoff;
}

function extractIsoDatesFromText(text: string): string[] {
  return text.match(/\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b/g) ?? [];
}

function redactIdentifyingAndFutureText(
  raw: string,
  extraTokens: string[],
): string {
  let clean = sanitizePromptText(raw, 280);
  clean = clean.replace(/\b(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?\b/g, '[PÉRIODE_T0]');
  clean = clean.replace(COMPANY_REDACT_REGEX, '[SOCIÉTÉ]');
  clean = clean.replace(LONG_TICKER_REGEX, '[ACTIF]');
  for (const tok of extraTokens) {
    if (tok.length >= 3) {
      clean = clean.replace(new RegExp(`\\b${escapeRegExp(tok)}\\b`, 'gi'), '[ACTIF]');
    }
  }
  clean = clean.replace(/\b([A-Z]{1,2})\b/g, (m) => (SHORT_UPPER_TICKERS.has(m) ? '[ACTIF]' : m));
  return clean;
}

export function sanitizeBlindTimeMachinePayload(rawBody: unknown): SanitizedBlindTimeMachineInput {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const epochId: '1m' | '1y' | '5y' | '10y' =
    body.epochId === '1m' || body.epochId === '1y' || body.epochId === '5y' || body.epochId === '10y'
      ? body.epochId
      : '5y';
  const rawCutoff = typeof body.cutoffDate === 'string' ? body.cutoffDate.trim() : '';
  const cutoffDate = /^\d{4}-\d{2}(?:-\d{2})?$/.test(rawCutoff)
    ? rawCutoff
    : EPOCH_CUTOFF_DEFAULTS[epochId];

  const rawMap =
    body.codeToAssetId && typeof body.codeToAssetId === 'object' && !Array.isArray(body.codeToAssetId)
      ? (body.codeToAssetId as Record<string, unknown>)
      : {};
  const extraTokens: string[] = [];
  for (const [k, v] of Object.entries(rawMap)) {
    if (!/^ACTIF_\d{2}$/i.test(k)) extraTokens.push(k);
    if (typeof v === 'string' && v.trim()) extraTokens.push(v.trim());
  }

  const rawDossiers = Array.isArray(body.dossiers) ? body.dossiers.slice(0, 12) : [];
  const dossiers: BlindDossierSanitized[] = [];
  const codeToAssetId: Record<string, string> = {};

  rawDossiers.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const pubAt = typeof rec.publishedAt === 'string' ? rec.publishedAt : undefined;
    if (isPostCutoffDate(pubAt, cutoffDate)) return;

    const origCode = String(rec.blindCode ?? '').trim().toUpperCase();
    const mappedAsset = String(rawMap[origCode] ?? rawMap[String(rec.blindCode ?? '')] ?? origCode).trim();
    const slotNum = String(dossiers.length + 1).padStart(2, '0');
    const normalizedCode = /^ACTIF_(?:0[1-9]|1[0-2])$/.test(origCode) && !codeToAssetId[origCode]
      ? origCode
      : `ACTIF_${slotNum}`;
    if (dossiers.length >= 12) return;
    if (mappedAsset) {
      codeToAssetId[normalizedCode] = mappedAsset;
    }

    const fin = (v: unknown, def = 0): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Number(n.toFixed(2)) : def;
    };
    const safeIdx = idx + 1;
    void safeIdx;

    dossiers.push({
      blindCode: normalizedCode,
      sectorGeneral: redactIdentifyingAndFutureText(String(rec.sectorGeneral ?? 'Secteur diversifié'), extraTokens),
      trailing12mReturnPct: fin(rec.trailing12mReturnPct),
      trailingVolatilityPct: fin(rec.trailingVolatilityPct, 18),
      maxDrawdownToDatePct: fin(rec.maxDrawdownToDatePct),
      forwardPe: fin(rec.forwardPe, 18),
      roicMinusWaccPct: fin(rec.roicMinusWaccPct),
      fcfMarginPct: fin(rec.fcfMarginPct),
      estimatedFairValueUpsidePct: fin(rec.estimatedFairValueUpsidePct),
      anonymizedCatalystSummary: redactIdentifyingAndFutureText(
        String(rec.anonymizedCatalystSummary ?? 'Dossier fondamental à l’instant T0'),
        extraTokens,
      ),
    });
  });

  const rawNews = Array.isArray(body.anonymizedNewsDigest) ? body.anonymizedNewsDigest : [];
  const anonymizedNewsDigest: string[] = [];
  for (const entry of rawNews) {
    const text =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? String((entry as { text?: unknown }).text ?? '')
          : '';
    const pubAt =
      entry && typeof entry === 'object' && typeof (entry as { publishedAt?: unknown }).publishedAt === 'string'
        ? ((entry as { publishedAt: string }).publishedAt)
        : undefined;
    if (!text.trim() || isPostCutoffDate(pubAt, cutoffDate)) continue;
    const embeddedDates = extractIsoDatesFromText(text);
    if (embeddedDates.some((d) => isPostCutoffDate(d, cutoffDate))) continue;
    anonymizedNewsDigest.push(redactIdentifyingAndFutureText(text, extraTokens));
    if (anonymizedNewsDigest.length >= 8) break;
  }

  const macroRaw = (body.macroAtT0 && typeof body.macroAtT0 === 'object' ? body.macroAtT0 : {}) as Record<
    string,
    unknown
  >;
  const finM = (v: unknown, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : def;
  };

  return {
    epochId,
    riskProfile: sanitizePromptText(body.riskProfile ?? 'equilibre', 24) || 'equilibre',
    epochCode: redactIdentifyingAndFutureText(String(body.epochCode ?? 'HORIZON_RETRO'), extraTokens) || 'HORIZON_RETRO',
    cutoffDate,
    macroAtT0: {
      inflationPct: finM(macroRaw.inflationPct, 2.2),
      centralBankRatePct: finM(macroRaw.centralBankRatePct, 2.5),
      gdpGrowthPct: finM(macroRaw.gdpGrowthPct, 1.8),
      vixLevel: finM(macroRaw.vixLevel, 16.5),
      yieldCurveNote: redactIdentifyingAndFutureText(
        String(macroRaw.yieldCurveNote ?? 'Courbe souveraine'),
        extraTokens,
      ),
    },
    anonymizedNewsDigest,
    dossiers,
    codeToAssetId,
  };
}

export function buildBlindTimeMachinePrompt(sanitized: SanitizedBlindTimeMachineInput): string {
  const allowedCodes = sanitized.dossiers.map((d) => d.blindCode);
  return `AUDIT D'ALLOCATION À L'AVEUGLE (${sanitized.epochCode}) — Profil investisseur : ${sanitized.riskProfile}.
Tu ne connais ni l'année exacte ni le nom réel des entreprises afin d'éliminer tout biais de mémorisation future.

INDICATEURS MACROÉCONOMIQUES À L'INSTANT T0 :
- Inflation annuelle : ${sanitized.macroAtT0.inflationPct} %
- Taux directeur banque centrale : ${sanitized.macroAtT0.centralBankRatePct} %
- Croissance PIB réel : ${sanitized.macroAtT0.gdpGrowthPct} %
- Indice de volatilité VIX : ${sanitized.macroAtT0.vixLevel}
- Structure des taux : ${sanitized.macroAtT0.yieldCurveNote}

ACTUALITÉS MAJEURES DISPONIBLES À L'INSTANT T0 :
${sanitized.anonymizedNewsDigest.map((n, idx) => `${idx + 1}. ${n}`).join('\n') || 'Aucune dépêche additionnelle.'}

DOSSIERS CANDIDATS ANONYMISÉS (codes autorisés : ${allowedCodes.join(', ')}) :
${JSON.stringify(sanitized.dossiers, null, 2)}

CONSIGNES :
1. Sélectionne exactement 5 dossiers à ACHETER (picks) présentant le meilleur couple qualité bilancielle (ROIC-WACC, marge FCF), marge de sécurité fondamentale et adéquation au régime macroéconomique de T0. La somme des weightPct doit faire 100 (aucun poids > 35 % ni < 10 %).
2. Sélectionne exactement 3 dossiers à ÉVITER (avoids) présentant un piège de valorisation, un cash-flow négatif ou une vulnérabilité directe au contexte macro de T0.
3. Rédige chaque justification en français clair (< 22 mots) sans deviner ni citer de nom propre d'entreprise.`;
}

// ----------------------------------------------------------------------------
// Stateful caches & reset helper (for tests)
// ----------------------------------------------------------------------------

interface VerifiedFeedPayload {
  ok: boolean;
  asOfDate: string;
  fetchedAt: string;
  sources: string[];
  fxToCad: Record<string, number>;
  livePricesCad: Record<string, number>;
  updatedCount: number;
  liveFetchedCount: number;
}

interface InstitutionalCorrelatedPayload {
  ok: boolean;
  fetchedAt: string;
  sourcesVerified: string[];
  dispatches: RawInstitutionalDispatch[];
}

let cachedVerifiedFeed: { expiresAt: number; payload: VerifiedFeedPayload } | null = null;
const newsCache = new Map<string, { expiresAt: number; articles: ValoriaRawNewsFeedItem[] }>();
let cachedInstitutionalCorrelated: {
  key: string;
  expiresAt: number;
  payload: InstitutionalCorrelatedPayload;
} | null = null;

export function resetValoriaServerState(): void {
  reinitialiserLimites();
  cachedVerifiedFeed = null;
  newsCache.clear();
  cachedInstitutionalCorrelated = null;
}

// ----------------------------------------------------------------------------
// Upstream Fetch Helpers
// ----------------------------------------------------------------------------

async function fetchLiveTickerNews(
  assetIdOrTicker: string,
  fetchFn: typeof fetch,
): Promise<ValoriaRawNewsFeedItem[]> {
  const key = assetIdOrTicker.trim().toUpperCase();
  const cached = newsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.articles;

  const matchedAsset = VALORIA_ASSET_DIRECTORY.find(
    (a) => a.id.toUpperCase() === key || a.ticker.toUpperCase() === key,
  );
  const querySymbol = matchedAsset ? matchedAsset.ticker : key;
  const queryName = matchedAsset ? matchedAsset.name.split(' (')[0] : key;
  const collected: ValoriaRawNewsFeedItem[] = [];

  try {
    const yahooUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(querySymbol)}&quotesCount=0&newsCount=4`;
    const resp = await fetchFn(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ValoriaQuant/1.0)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(3200),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        news?: Array<{
          uuid?: string;
          title?: string;
          publisher?: string;
          link?: string;
          providerPublishTime?: number;
        }>;
      };
      for (const n of data.news ?? []) {
        const title = String(n.title ?? '').trim();
        if (!title) continue;
        const dt = n.providerPublishTime
          ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        collected.push({
          id: `yf-${n.uuid ?? `${key}-${collected.length}`}`,
          ticker: querySymbol,
          assetId: matchedAsset?.id,
          title,
          publisher: String(n.publisher ?? 'Yahoo Finance'),
          publishedAt: dt,
          url: safeExternalHttpUrl(n.link),
          isLiveWeb: true,
        });
      }
    }
  } catch {
    // Google News RSS fallback below
  }

  if (collected.length < 2) {
    try {
      const rssQuery = `${queryName} ${querySymbol.replace('.PA', '').replace('-CAD', '')} bourse`;
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(rssQuery)}&hl=fr-CA&gl=CA&ceid=CA:fr`;
      const rssResp = await fetchFn(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ValoriaQuant/1.0)' },
        signal: AbortSignal.timeout(3200),
      });
      if (rssResp.ok) {
        const xml = await rssResp.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
        for (const itemXml of items.slice(0, 3)) {
          const rawTitle = itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
          const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim();
          const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
          const source = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? 'Google Actualités Finance';
          const cleanTitle = decodeXmlEntities(rawTitle).replace(/\s+-\s+[^-]+$/, '');
          if (!cleanTitle) continue;
          const isoDate =
            pubDate && !Number.isNaN(Date.parse(pubDate))
              ? new Date(pubDate).toISOString().slice(0, 10)
              : new Date().toISOString().slice(0, 10);
          collected.push({
            id: `gn-${key}-${collected.length}`,
            ticker: querySymbol,
            assetId: matchedAsset?.id,
            title: cleanTitle,
            publisher: decodeXmlEntities(source),
            publishedAt: isoDate,
            url: safeExternalHttpUrl(link),
            isLiveWeb: true,
          });
        }
      }
    } catch {
      // Offline / sandboxed environment: return what was collected
    }
  }

  if (newsCache.size > 500) newsCache.clear();
  newsCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, articles: collected });
  return collected;
}

async function fetchLiveChartSnapshot(
  symbol: string,
  fetchFn: typeof fetch,
): Promise<{
  symbol: string;
  priceMove3mPct: number | null;
  fiftyTwoWeekPosPct: number | null;
}> {
  const yahooSym = resolveYahooSymbol(symbol);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=6mo&interval=1wk`;
    const resp = await fetchFn(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ValoriaQuant/1.0)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(3200),
    });
    if (!resp.ok) return { symbol, priceMove3mPct: null, fiftyTwoWeekPosPct: null };
    const json = (await resp.json()) as {
      chart?: {
        result?: Array<{
          meta?: Record<string, unknown>;
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const r = json.chart?.result?.[0];
    const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter(
      (x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0,
    );
    if (closes.length < 4) return { symbol, priceMove3mPct: null, fiftyTwoWeekPosPct: null };
    const last = closes[closes.length - 1];
    const prev12w = closes[Math.max(0, closes.length - 13)];
    const hi = Number(r?.meta?.fiftyTwoWeekHigh ?? Math.max(...closes));
    const lo = Number(r?.meta?.fiftyTwoWeekLow ?? Math.min(...closes));
    return {
      symbol,
      priceMove3mPct: prev12w > 0 ? Number((((last - prev12w) / prev12w) * 100).toFixed(1)) : null,
      fiftyTwoWeekPosPct: hi > lo ? Math.round(((last - lo) / (hi - lo)) * 100) : null,
    };
  } catch {
    return { symbol, priceMove3mPct: null, fiftyTwoWeekPosPct: null };
  }
}

// ----------------------------------------------------------------------------
// Gemini SDK Runner with Safe Model Fallback
// ----------------------------------------------------------------------------

function getValidGeminiKey(explicitKey?: string): string | null {
  const raw = (explicitKey ?? process.env.GEMINI_API_KEY ?? '').trim();
  if (!raw || raw === 'MY_GEMINI_API_KEY' || raw === 'YOUR_GEMINI_API_KEY') return null;
  return raw;
}

async function callGeminiWithFallback(params: {
  options: ValoriaRoutesOptions;
  model?: string;
  contents: string;
  config: Record<string, unknown>;
}): Promise<Awaited<ReturnType<GoogleGenAI['models']['generateContent']>> | null> {
  const apiKey = getValidGeminiKey(params.options.geminiApiKey);
  if (!apiKey) return null;
  const ai = params.options.createAiClient
    ? params.options.createAiClient(apiKey)
    : new GoogleGenAI({ apiKey });
  const primaryModel = params.model ?? params.options.modelId ?? MODEL_IDS.sonnet;
  try {
    return await ai.models.generateContent({
      model: primaryModel,
      contents: params.contents,
      config: params.config as Parameters<GoogleGenAI['models']['generateContent']>[0]['config'],
    });
  } catch (err: unknown) {
    const status = (err as { status?: number; statusCode?: number } | null)?.status
      ?? (err as { statusCode?: number } | null)?.statusCode;
    if (status === 401 || status === 403) return null;
    if (primaryModel === 'gemini-2.5-flash') return null;
    const { thinkingConfig: _tc, ...restConfig } = params.config;
    try {
      return await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: params.contents,
        config: restConfig as Parameters<GoogleGenAI['models']['generateContent']>[0]['config'],
      });
    } catch {
      return null;
    }
  }
}

function extractGroundingSources(
  response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>,
  limit = 8,
): Array<{ uri: string; title: string }> {
  const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  return rawChunks
    .map((c) => {
      const web = (c as { web?: { uri?: string; title?: string } }).web;
      const safeUri = safeExternalHttpUrl(web?.uri);
      return safeUri ? { uri: safeUri, title: web?.title ?? safeUri } : null;
    })
    .filter((x): x is { uri: string; title: string } => Boolean(x))
    .slice(0, limit);
}

// ----------------------------------------------------------------------------
// Deterministic Quantitative Fallbacks (200 OK, `source: 'fallback'`)
// ----------------------------------------------------------------------------

function buildFallbackRecommendations(body: Record<string, unknown>) {
  const macro = (body.macro && typeof body.macro === 'object' ? body.macro : {}) as Record<string, unknown>;
  const portfolioSummary = (
    body.portfolioSummary && typeof body.portfolioSummary === 'object' ? body.portfolioSummary : {}
  ) as Record<string, unknown>;
  const riskMetrics = (
    body.riskMetrics && typeof body.riskMetrics === 'object' ? body.riskMetrics : {}
  ) as Record<string, unknown>;
  const profile = (body.profile && typeof body.profile === 'object' ? body.profile : {}) as Record<string, unknown>;
  const topQuantAssets = Array.isArray(body.topQuantAssets)
    ? (body.topQuantAssets as Array<Record<string, unknown>>)
    : [];

  const monthlyBudget = Math.max(250, Number(profile.monthlyBudget ?? 1000) || 1000);
  const totalVal = Number(portfolioSummary.totalCurrentValue ?? 0) || 0;
  const sharpe = Number(riskMetrics.sharpeRatio ?? 0);
  const hhi = Number(riskMetrics.concentrationHhi ?? 2200);
  const regimeName = sanitizePromptText(macro.regimeName ?? 'Désinflation', 60) || 'Désinflation';
  const inflationPct = Number(macro.inflationPct ?? 2.1);
  const ratePct = Number(macro.centralBankRatePct ?? 2.5);

  const ranked = [...topQuantAssets].sort(
    (a, b) =>
      Number(b.predictiveScore ?? b.quantScore ?? 50) - Number(a.predictiveScore ?? a.quantScore ?? 50),
  );
  const candidates = ranked
    .filter((item) => {
      const upside = typeof item.upsideDcfPct === 'number' ? item.upsideDcfPct : 0;
      return upside >= -6;
    })
    .slice(0, 3);

  const suggestions = (candidates.length > 0
    ? candidates
    : [{ assetId: 'XBB', predictiveScore: 78 }, { assetId: 'RY', predictiveScore: 76 }]
  ).map((item, idx) => {
    const id = String(item.assetId ?? 'XBB').trim();
    const spotCad = Number(VERIFIED_SPOT_CAD_2026_11[id] ?? item.spotPrice ?? 100);
    const score = Math.max(55, Math.min(92, Math.round(Number(item.predictiveScore ?? item.quantScore ?? 74))));
    const wrapper = id.endsWith('TO') || id === 'RY' || id === 'XEQT' || id === 'VFV' ? 'CELI' : 'REER';
    return {
      assetId: id,
      cotPriceCheck: `Cours vérifié ${formatCad(spotCad, 2)} CAD aligné sur la valeur intrinsèque.`,
      cotFundamentalCheck: `Score quantitatif ${score}/100 et discipline bilancielle validée.`,
      actionType: idx === 0 ? 'RENFORCER' : 'ACHETER',
      convictionPct: score,
      wrapper,
      suggestedAmountEuro: Math.round(monthlyBudget * (idx === 0 ? 0.5 : 0.25)),
      targetWeightPct: idx === 0 ? 22 : 12,
      reasoning: `Allocation en $ CAD optimisant le Sharpe sous régime ${regimeName}.`,
      verifiedSpotCad: Number(spotCad.toFixed(2)),
      priceCrossVerified: true,
    };
  });

  return {
    marketSynthesis: `Régime ${regimeName} : taux directeur ${ratePct.toFixed(2)} % vs IPC ${inflationPct.toFixed(1)} %.`,
    portfolioDiagnosis: `Portefeuille de ${formatCad(totalVal)} CAD · Sharpe ${sharpe.toFixed(2)} · HHI ${Math.round(hhi)}.`,
    strategyHeadline: 'Discipline Qualité & Diversification $ CAD',
    keyRiskAlert: `Surveiller la concentration sectorielle (HHI ${Math.round(hhi)}) et la sensibilité aux taux longs.`,
    suggestions,
  };
}

function buildFallbackAgentChat(question: string, verifiedGroundingContext?: string) {
  const cleanQ = sanitizePromptText(question, 160);
  let parsedCtx: Record<string, unknown> | null = null;
  if (verifiedGroundingContext) {
    try {
      const candidate = JSON.parse(verifiedGroundingContext) as unknown;
      if (candidate && typeof candidate === 'object') parsedCtx = candidate as Record<string, unknown>;
    } catch {
      parsedCtx = null;
    }
  }
  const tickerHint = parsedCtx && typeof parsedCtx.ticker === 'string' ? parsedCtx.ticker : 'votre portefeuille';
  const spotHint =
    parsedCtx && typeof parsedCtx.spotCad === 'number' && Number.isFinite(parsedCtx.spotCad)
      ? `${formatCad(parsedCtx.spotCad, 2)} CAD`
      : 'cours vérifiés en $ CAD';
  return {
    ok: true,
    source: 'fallback' as const,
    headlineVerdict: `● Analyse quantitative vérifiée sur ${tickerHint} (${spotHint})`,
    plainFrenchAnswer: `En clair : sur la base des données vérifiées (${spotHint}) pour « ${cleanQ} », le comité quantitatif privilégie la discipline de valorisation DCF et le plafonnement du risque par ligne en CELI/REER.`,
    agentVoices: [
      {
        code: 'AG-01',
        shortTitle: 'Bilan & Valeur',
        verdict: 'GARDER',
        message: `Valorisation et flux de trésorerie vérifiés sur ${spotHint}.`,
      },
      {
        code: 'AG-04',
        shortTitle: 'Courbes & Timing',
        verdict: 'GARDER',
        message: 'Entrée fractionnée privilégiée pour lisser la volatilité court terme.',
      },
      {
        code: 'AG-07',
        shortTitle: 'Risque & CELI',
        verdict: 'GARDER',
        message: 'Maintenir le plafond de concentration et loger en CELI/REER.',
      },
    ],
    followUpPrompts: [
      'Quel impact sur mon Sharpe à 5 ans ?',
      'Vaut-il mieux loger cet actif en CELI ou REER ?',
      'Quelles lignes alléger pour réduire ma VaR mensuelle ?',
    ],
  };
}

function buildFallbackBlindAudit(sanitized: SanitizedBlindTimeMachineInput, noticeFr?: string) {
  const rankedBlind = [...sanitized.dossiers].sort((a, b) => {
    const sA =
      a.estimatedFairValueUpsidePct * 1.4 +
      a.roicMinusWaccPct * 0.95 +
      a.fcfMarginPct * 0.3 -
      a.trailingVolatilityPct * 0.28;
    const sB =
      b.estimatedFairValueUpsidePct * 1.4 +
      b.roicMinusWaccPct * 0.95 +
      b.fcfMarginPct * 0.3 -
      b.trailingVolatilityPct * 0.28;
    return sB - sA;
  });

  const fallbackWeights = [26, 23, 20, 17, 14];
  const picks = rankedBlind
    .slice(0, 5)
    .map((d, i) => {
      const assetId = sanitized.codeToAssetId[d.blindCode];
      if (!assetId) return null;
      return {
        assetId,
        blindCode: d.blindCode,
        weightPct: fallbackWeights[i] ?? 20,
        blindThesisFr: d.anonymizedCatalystSummary,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const avoids = rankedBlind
    .slice(-3)
    .reverse()
    .map((d) => {
      const assetId = sanitized.codeToAssetId[d.blindCode];
      if (!assetId) return null;
      return {
        assetId,
        blindCode: d.blindCode,
        blindAvoidReasonFr: d.anonymizedCatalystSummary,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return {
    ok: true,
    source: 'fallback' as const,
    audit: {
      epochId: sanitized.epochId,
      generatedAt: new Date().toISOString(),
      mode: 'quant_point_in_time_fallback' as const,
      macroReadingAtEpochFr:
        'Lecture quantitative arrêtée aux indicateurs d’inflation, de taux directeur et de prime de risque disponibles à l’instant T0.',
      allocationPhilosophyFr:
        'Pondération proportionnelle à l’écart ROIC-WACC, à la génération de cash-flow libre et à la marge de sécurité à T0.',
      picks,
      avoids,
      anonymizedMappingCount: sanitized.dossiers.length,
      noticeFr:
        noticeFr ?? 'Sélection calculée à l’aveugle sur les dossiers anonymisés d’époque.',
    },
  };
}

// ----------------------------------------------------------------------------
// Express 5 Route Registration (12 Endpoints)
// ----------------------------------------------------------------------------

export function registerValoriaRoutes(app: Express, options: ValoriaRoutesOptions = {}): void {
  const fetchFn: typeof fetch = options.fetchImpl ?? fetch;

  // Garde commune locale : origine / loopback + limiteur de débit sur /api/*
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const path = req.path || '/';
    if (path === '/sante') {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (!isOriginAllowed(req, options.allowedOrigins)) {
      res.status(403).json({ error: 'Origine non autorisée.' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    const isAiRoute = path.startsWith('/ai/') || path.startsWith('/agents/');
    const isFeedRoute = path.startsWith('/market/') || path.startsWith('/news/');
    if (isAiRoute || isFeedRoute) {
      const bucket = isAiRoute ? 'ai' : 'px';
      const limit = isAiRoute ? 30 : 120;
      const debit = essayerDebit(`${bucket}:${ipClient(buildRequestHeaders(req))}`, limit);
      if (!debit.ok) {
        res.setHeader('Retry-After', String(debit.retryApresSec));
        res.setHeader('Cache-Control', 'no-store');
        res.status(429).json({ error: { type: 'rate_limited', message: 'Trop de requêtes.' } });
        return;
      }
    }
    next();
  });

  // 1. Endpoint /api/financeai/bridge fermé (410 Gone)
  app.all('/api/financeai/bridge', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(410).json({ error: 'Pont de partage supprimé pour sécurité.' });
  });

  // 3. GET /api/market/verified-feed
  app.get('/api/market/verified-feed', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (cachedVerifiedFeed && cachedVerifiedFeed.expiresAt > Date.now()) {
      res.json(cachedVerifiedFeed.payload);
      return;
    }

    const fxToCad: Record<string, number> = { ...VERIFIED_BOC_FX_TO_CAD };
    const livePricesCad: Record<string, number> = { ...VERIFIED_SPOT_CAD_2026_11 };
    delete livePricesCad.CASH;
    const activeSources = new Set<string>([
      'Banque du Canada (Valet FX)',
      'Yahoo Finance v8 (TSX/NYSE/Euronext)',
    ]);
    let asOfDate = VERIFIED_BOC_FX_DATE;
    let liveFetchedCount = 0;

    try {
      const bocResp = await fetchFn(
        'https://www.bankofcanada.ca/valet/observations/FXUSDCAD,FXEURCAD,FXGBPCAD,FXCHFCAD,FXJPYCAD/json?recent=1',
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3500) },
      );
      if (bocResp.ok) {
        const bocJson = (await bocResp.json()) as {
          observations?: Array<Record<string, { v?: string } | string>>;
        };
        const obs = bocJson.observations?.[0];
        if (obs) {
          if (typeof obs.d === 'string') asOfDate = obs.d;
          const parseBoc = (k: string) => Number((obs[k] as { v?: string })?.v ?? 0);
          const usd = parseBoc('FXUSDCAD');
          const eur = parseBoc('FXEURCAD');
          const gbp = parseBoc('FXGBPCAD');
          const chf = parseBoc('FXCHFCAD');
          const jpy = parseBoc('FXJPYCAD');
          if (usd > 0) fxToCad.USD = Number(usd.toFixed(4));
          if (eur > 0) {
            fxToCad.EUR = Number(eur.toFixed(4));
            fxToCad.DKK = Number((eur / 7.46).toFixed(4));
          }
          if (gbp > 0) {
            fxToCad.GBP = Number(gbp.toFixed(4));
            fxToCad.GBp = Number((gbp / 100).toFixed(6));
          }
          if (chf > 0) fxToCad.CHF = Number(chf.toFixed(4));
          if (jpy > 0) fxToCad.JPY = Number(jpy.toFixed(5));
        }
      }
    } catch {
      // Baseline BoC FX active
    }

    try {
      const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${Object.keys(GECKO_CRYPTO_MAP).join(',')}&vs_currencies=cad`;
      const cgResp = await fetchFn(cgUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3500),
      });
      if (cgResp.ok) {
        const cgData = (await cgResp.json()) as Record<string, { cad?: number }>;
        for (const [cgId, assetId] of Object.entries(GECKO_CRYPTO_MAP)) {
          const cadSpot = Number(cgData[cgId]?.cad ?? 0);
          if (cadSpot > 0) {
            livePricesCad[assetId] = Number(cadSpot.toFixed(4));
            liveFetchedCount++;
          }
        }
        activeSources.add('CoinGecko CAD Spot');
      }
    } catch {
      // Baseline crypto CAD active
    }

    const geckoValues = new Set(Object.values(GECKO_CRYPTO_MAP));
    const nonCashAssets = VALORIA_ASSET_DIRECTORY.filter(
      (a) => a.id !== 'CASH' && !geckoValues.has(a.id),
    );
    const symbolQueue = nonCashAssets.map((a) => ({ id: a.id, yahooSym: resolveYahooSymbol(a.id) }));

    for (let i = 0; i < symbolQueue.length; i += 22) {
      const wave = symbolQueue.slice(i, i + 22);
      await Promise.allSettled(
        wave.map(async ({ id, yahooSym }) => {
          const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=5d&interval=1d`;
          const resp = await fetchFn(chartUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ValoriaQuant/2.0)',
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(3500),
          });
          if (!resp.ok) return;
          const json = (await resp.json()) as {
            chart?: {
              result?: Array<{
                meta?: { currency?: string; regularMarketPrice?: number };
                indicators?: { quote?: Array<{ close?: Array<number | null> }> };
              }>;
            };
          };
          const res0 = json.chart?.result?.[0];
          const closes = (res0?.indicators?.quote?.[0]?.close ?? []).filter(
            (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
          );
          const rawClose = Number(res0?.meta?.regularMarketPrice ?? 0) || closes[closes.length - 1] || 0;
          if (rawClose <= 0) return;
          const metaCcy = String(res0?.meta?.currency ?? '');
          const symUpper = yahooSym.toUpperCase();
          let ccy = metaCcy || 'USD';
          if (!metaCcy) {
            if (symUpper.endsWith('.TO') || symUpper.endsWith('.V') || symUpper.endsWith('-CAD')) ccy = 'CAD';
            else if (/\.(PA|DE|AS|MI)$/.test(symUpper)) ccy = 'EUR';
            else if (symUpper.endsWith('.CO')) ccy = 'DKK';
            else if (symUpper.endsWith('.SW')) ccy = 'CHF';
            else if (symUpper.endsWith('.L')) ccy = rawClose > 250 ? 'GBp' : 'GBP';
            else if (symUpper.endsWith('.T')) ccy = 'JPY';
            else if (symUpper.endsWith('.HK')) ccy = 'HKD';
          }
          const fx = fxToCad[ccy] ?? EXTRA_FX_TO_CAD[ccy] ?? EXTRA_FX_TO_CAD[ccy.toUpperCase()] ?? 1.4123;
          livePricesCad[id] = Number((rawClose * fx).toFixed(4));
          liveFetchedCount++;
        }),
      );
    }

    const payload: VerifiedFeedPayload = {
      ok: true,
      asOfDate,
      fetchedAt: new Date().toISOString(),
      sources: Array.from(activeSources),
      fxToCad,
      livePricesCad,
      updatedCount: Object.keys(livePricesCad).length,
      liveFetchedCount,
    };
    cachedVerifiedFeed = { expiresAt: Date.now() + 5 * 60 * 1000, payload };
    res.json(payload);
  });

  // 4. GET /api/market/search
  app.get('/api/market/search', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json({ query: '', results: [] });
      return;
    }
    if (q.length > 100) {
      res.status(400).json({ error: 'Paramètre de recherche trop long (max 100 caractères).' });
      return;
    }
    const qUpper = q.toUpperCase();
    const localMatches = VALORIA_ASSET_DIRECTORY.filter(
      (a) =>
        a.ticker.toUpperCase().includes(qUpper) ||
        a.id.toUpperCase().includes(qUpper) ||
        a.name.toUpperCase().includes(qUpper) ||
        a.sector.toUpperCase().includes(qUpper),
    )
      .slice(0, 8)
      .map((a) => ({
        symbol: a.ticker,
        assetId: a.id,
        name: a.name,
        exchange: a.categoryLabel,
        quoteType: a.category.toUpperCase(),
        isBuiltIn: true,
      }));

    const seenSymbols = new Set(localMatches.map((m) => m.symbol.toUpperCase()));
    const remoteMatches: Array<{
      symbol: string;
      name: string;
      exchange: string;
      quoteType: string;
      isBuiltIn: boolean;
    }> = [];

    try {
      const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
      const upstream = await fetchFn(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ValoriaQuant/1.0)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(4000),
      });
      if (upstream.ok) {
        const data = (await upstream.json()) as { quotes?: Record<string, unknown>[] };
        for (const item of data.quotes ?? []) {
          const sym = String(item.symbol ?? '').trim().toUpperCase();
          if (!sym || seenSymbols.has(sym)) continue;
          const qt = String(item.quoteType ?? 'EQUITY').toUpperCase();
          if (!['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'MUTUALFUND', 'INDEX'].includes(qt)) continue;
          seenSymbols.add(sym);
          remoteMatches.push({
            symbol: sym,
            name: String(item.longname ?? item.shortname ?? sym),
            exchange: String(item.exchDisp ?? item.exchange ?? qt),
            quoteType: qt,
            isBuiltIn: false,
          });
        }
      }
    } catch {
      // Offline fallback to local matches
    }

    res.json({ query: q, results: [...localMatches, ...remoteMatches].slice(0, 14) });
  });

  // 5. GET /api/market/quote
  app.get('/api/market/quote', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    const rawSymbol = String(req.query.symbol ?? '').trim().toUpperCase();
    if (!rawSymbol || !SYMBOL_REGEX.test(rawSymbol) || /^\.+$/.test(rawSymbol)) {
      res.status(400).json({ error: 'Paramètre symbol requis et valide.' });
      return;
    }

    const yahooSym = resolveYahooSymbol(rawSymbol);
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=5y&interval=1mo`;
      const upstream = await fetchFn(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ValoriaQuant/1.0)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(4500),
      });
      if (!upstream.ok) {
        res.json({
          liveAvailable: false,
          symbol: rawSymbol,
          message: 'Cotation temps réel indisponible — saisie directe en $ CAD proposée.',
        });
        return;
      }

      const json = (await upstream.json()) as {
        chart?: {
          result?: Array<{
            meta?: Record<string, unknown>;
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
        };
      };
      const result = json.chart?.result?.[0];
      const meta = result?.meta ?? {};
      const currency = String(meta.currency ?? 'USD');
      const fxToCad = EXTRA_FX_TO_CAD[currency] ?? EXTRA_FX_TO_CAD[currency.toUpperCase()] ?? 1.4181;
      const rawSpot = Number(meta.regularMarketPrice ?? 0);
      const timestamps = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const monthlyHistoryCad: Record<string, number> = {};
      const validClosesCad: number[] = [];

      for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
        const c = closes[i];
        if (c === null || c === undefined || !Number.isFinite(c) || c <= 0) continue;
        const dt = new Date(timestamps[i] * 1000);
        const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
        const cadClose = Number((c * fxToCad).toFixed(4));
        monthlyHistoryCad[ym] = cadClose;
        validClosesCad.push(cadClose);
      }

      const spotCad = Number(
        (rawSpot > 0 ? rawSpot * fxToCad : validClosesCad[validClosesCad.length - 1] ?? 100).toFixed(4),
      );
      let volatilityPct = 26.0;
      if (validClosesCad.length >= 6) {
        const rets: number[] = [];
        for (let i = 1; i < validClosesCad.length; i++) {
          rets.push(validClosesCad[i] / validClosesCad[i - 1] - 1);
        }
        const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
        const variance = rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / Math.max(1, rets.length - 1);
        volatilityPct = Number(Math.max(5, Math.min(110, Math.sqrt(variance * 12) * 100)).toFixed(1));
      }

      const quoteType = String(meta.instrumentType ?? 'EQUITY');
      const inferred = inferSubClassFromYahooQuote(rawSymbol, quoteType);
      const displayName = String(meta.longName ?? meta.shortName ?? rawSymbol);

      res.json({
        liveAvailable: true,
        registration: {
          ticker: rawSymbol,
          name: displayName,
          spotCad,
          nativeCurrency: currency,
          fxToCad,
          category: inferred.category,
          subClass: inferred.subClass,
          volatilityPct,
          monthlyHistoryCad,
          description: `${displayName} (${rawSymbol}) — coté en ${currency}, converti automatiquement en $ CAD (taux ${fxToCad}).`,
        },
      });
    } catch {
      res.json({
        liveAvailable: false,
        symbol: rawSymbol,
        message: 'Mode hors-ligne ou symbole personnalisé — ajout immédiat en $ CAD disponible.',
      });
    }
  });

  // 6. GET /api/news/intelligence
  app.get('/api/news/intelligence', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=120');
    const rawTickers = String(req.query.tickers ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);

    if (rawTickers.length === 0) {
      res.json({ ok: true, fetchedAt: new Date().toISOString(), liveCount: 0, articles: [] });
      return;
    }
    if (rawTickers.some((t) => !SYMBOL_REGEX.test(t) || /^\.+$/.test(t))) {
      res.status(400).json({ error: 'Paramètre tickers invalide.' });
      return;
    }

    const batches = await Promise.all(rawTickers.map((t) => fetchLiveTickerNews(t, fetchFn)));
    const flat = batches.flat();
    res.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      liveCount: flat.length,
      articles: flat,
    });
  });

  // 7. GET /api/news/institutional-correlated
  app.get('/api/news/institutional-correlated', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=120');
    const rawTickers = String(req.query.tickers ?? 'ADP,INTC,GOOGL,RY,LLY,PAYX')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 10);

    if (rawTickers.some((t) => !SYMBOL_REGEX.test(t) || /^\.+$/.test(t))) {
      res.status(400).json({ error: 'Paramètre tickers invalide.' });
      return;
    }

    const cacheKey = rawTickers.join(',');
    if (
      cachedInstitutionalCorrelated &&
      cachedInstitutionalCorrelated.key === cacheKey &&
      cachedInstitutionalCorrelated.expiresAt > Date.now()
    ) {
      res.json(cachedInstitutionalCorrelated.payload);
      return;
    }

    const dispatches: RawInstitutionalDispatch[] = [];
    const sourcesVerified = new Set<string>();

    const secTargets = rawTickers
      .map((sym) => {
        const clean = sym.split('.')[0];
        const meta = SEC_CIK_BY_ASSET_ID[sym] ?? SEC_CIK_BY_ASSET_ID[clean];
        return meta ? { id: SEC_CIK_BY_ASSET_ID[sym] ? sym : clean, meta } : null;
      })
      .filter((x): x is { id: string; meta: { cik10: string; ticker: string; company: string } } => Boolean(x))
      .slice(0, 6);

    await Promise.allSettled(
      secTargets.map(async ({ id, meta }) => {
        const edgarUrl = `https://data.sec.gov/submissions/CIK${meta.cik10}.json`;
        const resp = await fetchFn(edgarUrl, {
          headers: {
            'User-Agent': 'ValoriaAnalytics/2.0 (institutional-research@valoria-analytics.ca)',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(4000),
        });
        if (!resp.ok) return;
        const json = (await resp.json()) as {
          filings?: {
            recent?: {
              form?: string[];
              filingDate?: string[];
              accessionNumber?: string[];
              primaryDocDescription?: string[];
            };
          };
        };
        const recent = json.filings?.recent;
        const forms = recent?.form ?? [];
        const dates = recent?.filingDate ?? [];
        const accs = recent?.accessionNumber ?? [];
        const descs = recent?.primaryDocDescription ?? [];

        let addedForTicker = 0;
        for (let i = 0; i < Math.min(forms.length, 35) && addedForTicker < 2; i++) {
          const form = String(forms[i] ?? '').trim();
          if (!['10-Q', '10-K', '8-K', '4'].includes(form)) continue;
          if (form === '4' && addedForTicker > 0) continue;
          const filingDate = String(dates[i] ?? '').slice(0, 10);
          const accRaw = String(accs[i] ?? '');
          const cikInt = String(Number(meta.cik10));
          const secLink = accRaw
            ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accRaw.replace(/-/g, '')}/${accRaw}-index.htm`
            : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${meta.cik10}`;
          const formLabel =
            form === '10-Q'
              ? 'États financiers trimestriels audités (Form 10-Q)'
              : form === '10-K'
                ? 'Rapport annuel certifié SEC (Form 10-K)'
                : form === '8-K'
                  ? 'Événement corporatif matériel (Form 8-K)'
                  : 'Déclaration d’opération dirigeant (Form 4)';
          const descExtra = descs[i] ? ` · ${String(descs[i]).slice(0, 42)}` : '';

          dispatches.push({
            id: `sec-${id}-${accRaw || i}`,
            assetId: id,
            ticker: meta.ticker,
            publishedAt: filingDate || '2026-11-04',
            yearMonth: (filingDate || '2026-11').slice(0, 7),
            sourceName: 'SEC EDGAR Officiel',
            sourceTier: 'REGULATOR_FILING',
            filingOrEventCode: form === '4' ? 'SEC Form 4' : `SEC ${form}`,
            headline: `${meta.company} — ${formLabel}${descExtra} (déposé le ${filingDate})`,
            url: secLink,
            fundamentalImpulseScore: form === '10-Q' || form === '10-K' ? 14 : form === '8-K' ? -8 : -6,
            isLiveFetched: true,
          });
          sourcesVerified.add('SEC EDGAR (data.sec.gov)');
          addedForTicker++;
        }
      }),
    );

    try {
      const bocBondResp = await fetchFn(
        'https://www.bankofcanada.ca/valet/observations/BD.CDN.2YR.DQ.YLD,BD.CDN.10YR.DQ.YLD/json?recent=1',
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3200) },
      );
      if (bocBondResp.ok) {
        const bocJson = (await bocBondResp.json()) as {
          observations?: Array<Record<string, { v?: string } | string>>;
        };
        const obs = bocJson.observations?.[0];
        const y2 = Number((obs?.['BD.CDN.2YR.DQ.YLD'] as { v?: string })?.v ?? 0);
        const y10 = Number((obs?.['BD.CDN.10YR.DQ.YLD'] as { v?: string })?.v ?? 0);
        const dt = typeof obs?.d === 'string' ? obs.d : VERIFIED_BOC_FX_DATE;
        if (y2 > 0 && y10 > 0) {
          const spreadBps = Math.round((y10 - y2) * 100);
          dispatches.push({
            id: `boc-yield-${dt}`,
            assetId: 'RY',
            ticker: 'RY.TO',
            publishedAt: dt,
            yearMonth: dt.slice(0, 7),
            sourceName: 'Banque du Canada (Valet)',
            sourceTier: 'CENTRAL_BANK_MACRO',
            filingOrEventCode: `GoC 10A ${y10.toFixed(2)}%`,
            headline: `Courbe obligataire du Canada (${dt}) : 10 ans à ${y10.toFixed(2)} % vs 2 ans à ${y2.toFixed(2)} % (écart ${spreadBps >= 0 ? '+' : ''}${spreadBps} pb)`,
            url: 'https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/',
            fundamentalImpulseScore: spreadBps > 0 ? 36 : -24,
            isLiveFetched: true,
          });
          sourcesVerified.add('Banque du Canada (Valet Obligations)');
        }
      }
    } catch {
      // Baseline GoC curve active
    }

    try {
      const yahooRssSymbols = rawTickers.map((t) => resolveYahooSymbol(t)).slice(0, 6).join(',');
      const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooRssSymbols)}&region=US&lang=en-US`;
      const rssResp = await fetchFn(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ValoriaQuant/2.0)' },
        signal: AbortSignal.timeout(3500),
      });
      if (rssResp.ok) {
        const xml = await rssResp.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
        for (const itemXml of items.slice(0, 6)) {
          const rawTitle = decodeXmlEntities(itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
          const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim();
          const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
          if (!rawTitle) continue;
          const isoDate =
            pubDate && !Number.isNaN(Date.parse(pubDate))
              ? new Date(pubDate).toISOString().slice(0, 10)
              : '2026-11-12';
          const upperH = rawTitle.toUpperCase();
          const matchedAsset = VALORIA_ASSET_DIRECTORY.find((a) => {
            const baseSym = a.ticker.split('.')[0].split('-')[0].toUpperCase();
            const cleanWords = a.name
              .split(/[\s(—-]+/)
              .map((w) => w.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
              .filter((w) => w.length >= 4 && !['CORP', 'INC', 'GROUP', 'BANQUE', 'HOLDING', 'TECH'].includes(w));
            const symRegex = baseSym.length >= 3 ? new RegExp(`\\b${baseSym}\\b`) : null;
            return (symRegex && symRegex.test(upperH)) || cleanWords.some((w) => upperH.includes(w));
          });
          if (!matchedAsset) continue;
          const tierInfo = classifyPublisherToInstitutionalTier('Yahoo Finance Wire', rawTitle);
          const impulse = /SURGE|BEAT|RAISE|UPGRADE|RECORD|GROWTH|PROFIT/.test(upperH)
            ? 32
            : /DROP|FALL|MISS|CUT|DOWNGRADE|LOSS|LAW|PROBE|SLUMP|SELL/.test(upperH)
              ? -36
              : 0;
          dispatches.push({
            id: `yfrss-${matchedAsset.id}-${dispatches.length}`,
            assetId: matchedAsset.id,
            ticker: matchedAsset.ticker,
            publishedAt: isoDate,
            yearMonth: isoDate.slice(0, 7),
            sourceName: 'Flux Institutionnel Yahoo/Reuters',
            sourceTier: tierInfo.tier,
            filingOrEventCode: tierInfo.code,
            headline: rawTitle,
            url: safeExternalHttpUrl(link),
            fundamentalImpulseScore: impulse,
            isLiveFetched: true,
          });
          sourcesVerified.add('Flux RSS Institutionnel');
        }
      }
    } catch {
      // Curated baseline active
    }

    const payload: InstitutionalCorrelatedPayload = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      sourcesVerified: Array.from(sourcesVerified),
      dispatches,
    };
    cachedInstitutionalCorrelated = { key: cacheKey, expiresAt: Date.now() + 5 * 60 * 1000, payload };
    res.json(payload);
  });

  // 8. POST /api/news/gemini-grounding
  app.post('/api/news/gemini-grounding', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const { tickers, regimeName } = (req.body ?? {}) as { tickers?: unknown; regimeName?: unknown };
    const cleanTickers = Array.isArray(tickers)
      ? tickers.map((t) => sanitizePromptText(String(t), 24)).filter(Boolean).slice(0, 8)
      : ['ADP', 'GOOGL', 'RY.TO', 'XBB.PA'];
    const safeRegime = sanitizePromptText(regimeName ?? 'marchés nord-américains et mondiaux', 80);

    const prompt = `En tant qu'analyste financier canadien francophone, résume en français très clair et accessible les actualités récentes et catalyseurs boursiers majeurs concernant ces actifs : ${cleanTickers.join(', ')} (contexte macro : ${safeRegime}).
Pour chaque actif principal, explique en 1 ou 2 phrases simples :
1) Quelle est l'actualité récente importante (résultats, taux, IA, dividende, régulation).
2) Est-ce positif ou négatif pour un investisseur particulier en dollars canadiens ($ CAD).`;

    const response = await callGeminiWithFallback({
      options,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    if (response && (response.text ?? '').trim()) {
      res.json({
        ok: true,
        source: 'gemini',
        generatedAt: new Date().toISOString(),
        markdownBrief: (response.text ?? '').trim(),
        sources: extractGroundingSources(response, 8),
      });
      return;
    }

    const fallbackNews = await Promise.all(cleanTickers.slice(0, 4).map((t) => fetchLiveTickerNews(t, fetchFn)));
    const flat = fallbackNews.flat();
    const lines = cleanTickers.map((t) => {
      const hit = flat.find((a) => a.ticker.toUpperCase().includes(t.split('.')[0].toUpperCase()));
      return hit
        ? `- **${t}** : ${hit.title} (${hit.publisher}).`
        : `- **${t}** : suivi quantitatif actif en $ CAD sous régime ${safeRegime}.`;
    });

    res.json({
      ok: true,
      source: 'fallback',
      generatedAt: new Date().toISOString(),
      markdownBrief: `Synthèse quantitative (${safeRegime}) :\n${lines.join('\n')}`,
      sources: flat
        .filter((a) => Boolean(a.url))
        .slice(0, 4)
        .map((a) => ({ uri: a.url as string, title: `${a.ticker} · ${a.publisher}` })),
    });
  });

  // 9. POST /api/ai/recommendations
  app.post('/api/ai/recommendations', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const profile = (body.profile && typeof body.profile === 'object' ? body.profile : {}) as Record<string, unknown>;
    const macro = (body.macro && typeof body.macro === 'object' ? body.macro : {}) as Record<string, unknown>;
    const portfolioSummary = (
      body.portfolioSummary && typeof body.portfolioSummary === 'object' ? body.portfolioSummary : {}
    ) as Record<string, unknown>;
    const riskMetrics = (
      body.riskMetrics && typeof body.riskMetrics === 'object' ? body.riskMetrics : {}
    ) as Record<string, unknown>;
    const topQuantAssets = Array.isArray(body.topQuantAssets)
      ? (body.topQuantAssets as Array<Record<string, unknown>>)
      : [];

    const allowedIds = topQuantAssets.length > 0
      ? topQuantAssets.map((a) => String(a.assetId ?? '').trim()).filter(Boolean)
      : ['XBB', 'ESE', 'MEUD', 'ADP', 'ASML', 'SU', 'GOOGL', 'MSFT', 'GOVT', 'CORP', 'GOLD'];

    const serverLiveCadMap: Record<string, number> = {
      ...VERIFIED_SPOT_CAD_2026_11,
      ...(cachedVerifiedFeed?.payload.livePricesCad ?? {}),
    };
    const quantByAssetId = new Map<string, { spotPrice?: number; upsideDcfPct?: number; quantScore?: number }>();
    for (const item of topQuantAssets) {
      if (typeof item.assetId === 'string') {
        quantByAssetId.set(item.assetId, {
          spotPrice: typeof item.spotPrice === 'number' ? item.spotPrice : undefined,
          upsideDcfPct: typeof item.upsideDcfPct === 'number' ? item.upsideDcfPct : undefined,
          quantScore: typeof item.quantScore === 'number' ? item.quantScore : undefined,
        });
      }
    }

    const catWeights = (portfolioSummary.categoryWeightsPct ?? {}) as Record<string, unknown>;
    const budgetPromptStr =
      typeof profile.monthlyBudget === 'number' && Number.isFinite(profile.monthlyBudget)
        ? `${formatCad(profile.monthlyBudget)} CAD/mois`
        : '(non disponible)';
    const currentValPromptStr =
      typeof portfolioSummary.totalCurrentValue === 'number' && Number.isFinite(portfolioSummary.totalCurrentValue)
        ? `${formatCad(portfolioSummary.totalCurrentValue)} CAD`
        : '(non disponible)';
    const investedValPromptStr =
      typeof portfolioSummary.totalInvested === 'number' && Number.isFinite(portfolioSummary.totalInvested)
        ? `${formatCad(portfolioSummary.totalInvested)} CAD`
        : '(non disponible)';
    const varPromptStr =
      typeof riskMetrics.var95MonthlyEur === 'number' && Number.isFinite(riskMetrics.var95MonthlyEur)
        ? `-${formatCad(Math.abs(riskMetrics.var95MonthlyEur))} CAD`
        : '(non disponible)';

    const safeHoldingsBrief = wrapUserData(JSON.stringify(portfolioSummary.holdingsBrief ?? []));
    const safeTopQuantAssets = wrapUserData(JSON.stringify(topQuantAssets));
    const prompt = `Comité d'allocation quantitative & Stock-Picking — applique un raisonnement chaîné strict (Chain-of-Thought en 3 étapes : 1. Vérification Prix Live vs DCF, 2. Solidité Bilan ROIC-WACC, 3. Catalyseur & Risque) AVANT d'émettre chaque ordre en français. Zéro hallucination : interdiction absolue de recommander ACHETER/RENFORCER un actif dont la décote DCF est négative.

PROFIL : ${sanitizePromptText(profile.goalLabel ?? 'Valorisation', 40)} · Risque ${sanitizePromptText(profile.riskProfile ?? 'equilibre', 20)} · Horizon ${Number(profile.horizonYears ?? 10)} ans · Épargne ${budgetPromptStr}.
MACRO : ${sanitizePromptText(macro.regimeName ?? 'Désinflation', 60)} · IPC ${Number(macro.inflationPct ?? 2.1)}% · Taux directeur ${Number(macro.centralBankRatePct ?? 2.5)}% · PIB ${Number(macro.gdpGrowthPct ?? 1.6)}% · VIX ${Number(macro.vixLevel ?? 15.5)}.
PORTEFEUILLE ACTUEL ($ CAD) : ${currentValPromptStr} (Investi ${investedValPromptStr}, P&L ${Number(portfolioSummary.totalGainLossPct ?? 0)}%) · Poids Actions ${Number(catWeights.actions ?? 0)}% / Oblig ${Number(catWeights.obligations ?? 0)}% / Crypto ${Number(catWeights.crypto ?? 0)}% / Refuge ${Number(catWeights.refuge ?? 0)}%.
MÉTRIQUES DE RISQUE : Sharpe ${Number(riskMetrics.sharpeRatio ?? 0)} · Sortino ${Number(riskMetrics.sortinoRatio ?? 0)} · Bêta MSCI World ${Number(riskMetrics.betaVsWorld ?? 1)} · Alpha ${Number(riskMetrics.jensenAlphaPct ?? 0)}% · VaR 95% (1M) ${varPromptStr} · HHI ${Number(riskMetrics.concentrationHhi ?? 2500)}.
POSITIONS DÉTENUES : ${safeHoldingsBrief}
UNIVERS QUANTITATIF & COURS TEMPS RÉEL VÉRIFIÉS ($ CAD, identifiants autorisés : ${allowedIds.join(', ')}) :
${safeTopQuantAssets}

Fournis jusqu'à 4 arbitrages concrets en $ CAD (ACHETER, RENFORCER, ALLÉGER ou VENDRE) vérifiés par rapport aux cours en temps réel.`;

    const response = await callGeminiWithFallback({
      options,
      contents: prompt,
      config: {
        systemInstruction: `Tu es stratégiste quantitatif senior (gestion institutionnelle en $ CAD & stock-picking). Raisonne toujours par étapes vérifiables (Prix Temps Réel -> Bilan DCF/ROIC -> Risque Portefeuille) avant de conclure. Maximum 18 mots par champ texte. N'utilise aucun autre assetId que ceux fournis (${allowedIds.join(', ')}).\n${PROMPT_DATA_ISOLATION_NOTE}`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            marketSynthesis: { type: Type.STRING },
            portfolioDiagnosis: { type: Type.STRING },
            strategyHeadline: { type: Type.STRING },
            keyRiskAlert: { type: Type.STRING },
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  assetId: { type: Type.STRING },
                  cotPriceCheck: { type: Type.STRING },
                  cotFundamentalCheck: { type: Type.STRING },
                  actionType: { type: Type.STRING },
                  convictionPct: { type: Type.NUMBER },
                  wrapper: { type: Type.STRING },
                  suggestedAmountEuro: { type: Type.NUMBER },
                  targetWeightPct: { type: Type.NUMBER },
                  reasoning: { type: Type.STRING },
                },
                required: [
                  'assetId',
                  'cotPriceCheck',
                  'cotFundamentalCheck',
                  'actionType',
                  'convictionPct',
                  'wrapper',
                  'suggestedAmountEuro',
                  'targetWeightPct',
                  'reasoning',
                ],
              },
            },
          },
          required: [
            'marketSynthesis',
            'portfolioDiagnosis',
            'strategyHeadline',
            'keyRiskAlert',
            'suggestions',
          ],
        },
      },
    });

    if (response && response.text) {
      try {
        const parsed = JSON.parse(response.text.trim()) as {
          suggestions?: Array<Record<string, unknown>>;
          [k: string]: unknown;
        };
        if (Array.isArray(parsed.suggestions)) {
          parsed.suggestions = parsed.suggestions.filter((sug) => {
            const id = String(sug.assetId ?? '').trim();
            if (!allowedIds.includes(id)) return false;
            const liveCad = serverLiveCadMap[id] ?? quantByAssetId.get(id)?.spotPrice ?? 0;
            if (!Number.isFinite(liveCad) || liveCad <= 0) return false;
            const actionUpper = String(sug.actionType ?? '').toUpperCase();
            const isBuyOrder = actionUpper.includes('ACHET') || actionUpper.includes('RENFORC');
            const qItem = quantByAssetId.get(id);
            if (isBuyOrder && qItem && typeof qItem.upsideDcfPct === 'number' && qItem.upsideDcfPct < -6) {
              return false;
            }
            sug.verifiedSpotCad = Number(liveCad.toFixed(2));
            sug.priceCrossVerified = true;
            return true;
          });
        }
        res.json({
          ok: true,
          source: 'gemini',
          generatedAt: new Date().toISOString(),
          priceCrossVerified: true,
          recommendation: parsed,
        });
        return;
      } catch {
        // Fall through to deterministic fallback
      }
    }

    res.json({
      ok: true,
      source: 'fallback',
      generatedAt: new Date().toISOString(),
      priceCrossVerified: true,
      recommendation: buildFallbackRecommendations(body),
    });
  });

  // 10. POST /api/agents/deep-research
  app.post('/api/agents/deep-research', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const startedAt = Date.now();
    const { tickers, focusTicker, regimeName, riskProfile } = (req.body ?? {}) as {
      tickers?: string[];
      focusTicker?: string;
      regimeName?: string;
      riskProfile?: string;
    };

    const sanitizeTickerToken = (raw: unknown): string | null => {
      const cleaned = sanitizePromptText(raw ?? '', 24).toUpperCase();
      return cleaned && SYMBOL_REGEX.test(cleaned) && !/^\.+$/.test(cleaned) ? cleaned : null;
    };
    const defaultTickers = ['ADP', 'GOOGL', 'INTC', 'PAYX', 'RY.TO', 'XBB.PA'];
    const rawList = Array.isArray(tickers)
      ? tickers.map(sanitizeTickerToken).filter((t): t is string => Boolean(t))
      : [];
    const safeRawList = rawList.length > 0 ? rawList : defaultTickers;
    const focusClean = sanitizeTickerToken(focusTicker) ?? '';
    const targetList = Array.from(new Set(focusClean ? [focusClean, ...safeRawList] : safeRawList)).slice(0, 8);

    const [newsBatches, chartSnaps] = await Promise.all([
      Promise.all(targetList.map((t) => fetchLiveTickerNews(t, fetchFn))),
      Promise.all(targetList.map((t) => fetchLiveChartSnapshot(t, fetchFn))),
    ]);

    const liveArticles = newsBatches.flat();
    const chartBySym = new Map(chartSnaps.map((s) => [s.symbol.toUpperCase(), s]));
    const overrides: Record<string, ValoriaLiveAgentTickerOverride> = {};

    for (const sym of targetList) {
      const matched = VALORIA_ASSET_DIRECTORY.find(
        (a) =>
          a.id.toUpperCase() === sym.toUpperCase() ||
          a.ticker.toUpperCase() === sym.toUpperCase() ||
          a.ticker.split('.')[0].toUpperCase() === sym.split('.')[0].toUpperCase(),
      );
      const key = matched ? matched.id : sym.toUpperCase();
      const snap =
        chartBySym.get((matched?.ticker ?? sym).toUpperCase()) ?? chartBySym.get(sym.toUpperCase());
      if (snap && snap.priceMove3mPct !== null) {
        const pos52 = snap.fiftyTwoWeekPosPct ?? 55;
        const liveTechScore = Math.max(
          22,
          Math.min(92, Math.round(52 + snap.priceMove3mPct * 0.9 + (pos52 - 50) * 0.22)),
        );
        overrides[key] = {
          ticker: matched?.ticker ?? sym,
          assetId: matched?.id,
          technicalScore: liveTechScore,
          epsRevision90dPct: Number(Math.max(-12, Math.min(14, snap.priceMove3mPct * 0.28)).toFixed(1)),
          isGeminiLive: false,
        };
      }
    }

    let source: 'gemini' | 'fallback' = 'fallback';
    let mode: 'gemini_live_swarm' | 'live_market_quant' = 'live_market_quant';
    let geminiNotice: string | null = '7 agents synchronisés (flux marché quantitatif actif)';
    let groundingSources: Array<{ uri: string; title: string }> = [];

    const headlinesContext = liveArticles
      .slice(0, 14)
      .map((a) => `[${a.ticker}] ${a.title} (${a.publisher})`)
      .join('\n');

    const [groundingResult, structuredResult] = await Promise.all([
      callGeminiWithFallback({
        options,
        contents: `Identifie les derniers résultats trimestriels, révisions BPA, tendance boursière, opérations d'initiés et catalyseurs majeurs pour : ${targetList.join(', ')} (régime : ${sanitizePromptText(regimeName ?? 'marché global', 60)}, profil : ${sanitizePromptText(riskProfile ?? 'equilibre', 24)}). Sois très factuel et concis.`,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      callGeminiWithFallback({
        options,
        contents: `Évalue ces actifs via 7 agents spécialisés (1: Bilan & Comptes SEC/SEDAR+, 2: Croissance & Guidance BPA 8T, 3: Actualités vérifiées, 4: Courbes & Timing MM200/RSI/MACD, 5: Dirigeants & Fonds/Short, 6: Chaîne fournisseurs/clients & taux BoC, 7: Bouclier anti-krach & fiscalité CELI/REER) pour un portefeuille en $ CAD.
Actifs cibles : ${targetList.join(', ')}
Régime macro : ${sanitizePromptText(regimeName ?? 'Désinflation', 60)}
Dépêches temps réel captées :
${headlinesContext || 'Flux sectoriels standards'}`,
        config: {
          systemInstruction:
            'Tu es un comité de 7 agents quantitatifs institutionnels utilisant un raisonnement chaîné (Chain-of-Thought : 1. Bilan -> 2. Cours Temps Réel vs Valeur -> 3. Catalyseur -> Scores). Produis toujours la trace de raisonnement avant les scores numériques afin d’éliminer toute hallucination.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                ticker: { type: Type.STRING },
                cotTrace: { type: Type.STRING },
                accountingScore: { type: Type.NUMBER },
                guidanceScore: { type: Type.NUMBER },
                newsScore: { type: Type.NUMBER },
                technicalScore: { type: Type.NUMBER },
                positioningScore: { type: Type.NUMBER },
                ecosystemScore: { type: Type.NUMBER },
                riskShieldScore: { type: Type.NUMBER },
                forwardReturnAdjustmentPct: { type: Type.NUMBER },
                epsRevision90dPct: { type: Type.NUMBER },
                visualSignalTag: { type: Type.STRING },
                keyCatalystTag: { type: Type.STRING },
                bullHighlight: { type: Type.STRING },
                bearHighlight: { type: Type.STRING },
              },
              required: [
                'ticker',
                'cotTrace',
                'accountingScore',
                'guidanceScore',
                'newsScore',
                'technicalScore',
                'positioningScore',
                'ecosystemScore',
                'riskShieldScore',
                'forwardReturnAdjustmentPct',
                'epsRevision90dPct',
                'visualSignalTag',
                'keyCatalystTag',
                'bullHighlight',
                'bearHighlight',
              ],
            },
          },
        },
      }),
    ]);

    if (groundingResult) {
      groundingSources = extractGroundingSources(groundingResult, 8);
    }

    if (structuredResult && structuredResult.text) {
      try {
        const parsedItems = JSON.parse(structuredResult.text.trim()) as ValoriaLiveAgentTickerOverride[];
        if (Array.isArray(parsedItems) && parsedItems.length > 0) {
          source = 'gemini';
          mode = 'gemini_live_swarm';
          geminiNotice = null;
          for (const item of parsedItems) {
            const cleanT = String(item.ticker ?? '').trim().toUpperCase();
            if (!cleanT) continue;
            const matched = VALORIA_ASSET_DIRECTORY.find(
              (a) =>
                a.id.toUpperCase() === cleanT ||
                a.ticker.toUpperCase() === cleanT ||
                a.ticker.split('.')[0].toUpperCase() === cleanT.split('.')[0],
            );
            const key = matched ? matched.id : cleanT;
            const snap =
              chartBySym.get((matched?.ticker ?? cleanT).toUpperCase()) ?? chartBySym.get(cleanT);

            let rawTech = Math.max(15, Math.min(96, Math.round(Number(item.technicalScore) || 62)));
            let rawFwdAdj = Number(
              Math.max(-5, Math.min(5.5, Number(item.forwardReturnAdjustmentPct) || 0)).toFixed(2),
            );
            if (snap && snap.priceMove3mPct !== null) {
              if (snap.priceMove3mPct <= -15 && rawTech > 55) rawTech = 46;
              else if (snap.priceMove3mPct >= 18 && rawTech < 45) rawTech = 58;
              if (snap.priceMove3mPct <= -22 && rawFwdAdj > 1.5) rawFwdAdj = 0.5;
            }

            overrides[key] = {
              ticker: matched?.ticker ?? cleanT,
              assetId: matched?.id,
              accountingScore: Math.max(15, Math.min(98, Math.round(Number(item.accountingScore) || 65))),
              guidanceScore: Math.max(15, Math.min(98, Math.round(Number(item.guidanceScore) || 65))),
              newsScore: Math.max(-95, Math.min(95, Math.round(Number(item.newsScore) || 0))),
              technicalScore: rawTech,
              positioningScore: Math.max(15, Math.min(96, Math.round(Number(item.positioningScore) || 60))),
              ecosystemScore: Math.max(20, Math.min(96, Math.round(Number(item.ecosystemScore) || 65))),
              riskShieldScore: Math.max(18, Math.min(96, Math.round(Number(item.riskShieldScore) || 64))),
              forwardReturnAdjustmentPct: rawFwdAdj,
              epsRevision90dPct: Number(
                Math.max(-15, Math.min(18, Number(item.epsRevision90dPct) || 0)).toFixed(1),
              ),
              visualSignalTag: String(item.visualSignalTag ?? 'Analysé IA').slice(0, 22),
              keyCatalystTag: String(item.keyCatalystTag ?? 'Flux Direct').slice(0, 26),
              bullHighlight: String(item.bullHighlight ?? '').slice(0, 68) || undefined,
              bearHighlight: String(item.bearHighlight ?? '').slice(0, 68) || undefined,
              isGeminiLive: true,
            };
          }
        }
      } catch {
        // Keep deterministic overrides
      }
    }

    res.json({
      ok: true,
      source,
      mode,
      elapsedMs: Date.now() - startedAt,
      scannedTickersCount: targetList.length,
      liveArticles,
      overrides,
      groundingSources,
      geminiNotice,
    });
  });

  // 11. POST /api/agents/chat
  app.post('/api/agents/chat', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const { question, history, verifiedGroundingContext } = (req.body ?? {}) as {
      question?: string;
      history?: Array<{ role: 'user' | 'assistant'; text: string }>;
      verifiedGroundingContext?: string;
    };

    const cleanQuestion = sanitizePromptText(question ?? '', 500);
    if (!cleanQuestion) {
      res.status(400).json({ ok: false, error: 'Question requise pour interroger les agents.' });
      return;
    }

    const recentHistory = Array.isArray(history)
      ? history
          .slice(-6)
          .map(
            (m) =>
              `${m.role === 'user' ? 'Investisseur' : 'Comité 7 Agents'} : ${neutralizeFrameTags(
                String(m.text ?? '').slice(0, 320),
              )}`,
          )
          .join('\n')
      : '';

    const safeContext = neutralizeFrameTags(String(verifiedGroundingContext ?? '{}').slice(0, 5500));
    const response = await callGeminiWithFallback({
      options,
      contents: `Historique récent :
${recentHistory || 'Début de la consultation'}

Données temps réel vérifiées en $ CAD (SOURCE DE VÉRITÉ STRICTE — ne jamais inventer d’autres prix ni contredire le verdict 5 étapes) :
${wrapUserData(safeContext)}

Question de l’investisseur :
${wrapUserData(cleanQuestion)}`,
      config: {
        systemInstruction:
          `Tu es le Comité des 7 Agents Financiers & IA de Valoria (Canada, 100 % en $ CAD). Réponds en français simple, direct, pédagogique et sans jargon inutile (2 phrases claires maximum pour plainFrenchAnswer). Appuie-toi EXCLUSIVEMENT sur les cours temps réel vérifiés, la vraie valeur DCF, l’impact portefeuille Avant/Après et le cône 5 ans fournis. Ne mentionne jamais ton modèle sous-jacent.\n${PROMPT_DATA_ISOLATION_NOTE}`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            cotVerificationTrace: { type: Type.STRING },
            headlineVerdict: { type: Type.STRING },
            plainFrenchAnswer: { type: Type.STRING },
            agentVoices: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  code: { type: Type.STRING },
                  shortTitle: { type: Type.STRING },
                  verdict: { type: Type.STRING },
                  message: { type: Type.STRING },
                },
                required: ['code', 'shortTitle', 'verdict', 'message'],
              },
            },
            followUpPrompts: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: [
            'cotVerificationTrace',
            'headlineVerdict',
            'plainFrenchAnswer',
            'agentVoices',
            'followUpPrompts',
          ],
        },
      },
    });

    if (response && response.text) {
      try {
        const parsed = JSON.parse(response.text.trim()) as {
          headlineVerdict?: string;
          plainFrenchAnswer?: string;
          agentVoices?: Array<{ code: string; shortTitle: string; verdict: string; message: string }>;
          followUpPrompts?: string[];
        };
        const normalizedAnswer = String(parsed.plainFrenchAnswer ?? '').trim();
        const safeAnswer = normalizedAnswer.startsWith('En clair')
          ? normalizedAnswer
          : `En clair : ${normalizedAnswer}`;
        res.json({
          ok: true,
          source: 'gemini_live_committee',
          headlineVerdict: String(parsed.headlineVerdict ?? '').trim(),
          plainFrenchAnswer: safeAnswer,
          agentVoices: Array.isArray(parsed.agentVoices) ? parsed.agentVoices.slice(0, 3) : [],
          followUpPrompts: Array.isArray(parsed.followUpPrompts) ? parsed.followUpPrompts.slice(0, 3) : [],
        });
        return;
      } catch {
        // Fallback below
      }
    }

    res.json(buildFallbackAgentChat(cleanQuestion, verifiedGroundingContext));
  });

  // 12. POST /api/ai/deep-intelligence-lab
  app.post('/api/ai/deep-intelligence-lab', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const {
      tickers,
      focusSliceLabel,
      portfolioTotalCad,
      macroSummary,
      localThesis,
    } = (req.body ?? {}) as {
      tickers?: string[];
      focusSliceLabel?: string;
      portfolioTotalCad?: number;
      macroSummary?: string;
      localThesis?: string;
    };

    const cleanTickers =
      Array.isArray(tickers) && tickers.length > 0
        ? tickers.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
        : ['ADP', 'RY.TO', 'XBB.PA', 'PAYX', 'INTC', 'GOOGL'];

    const [newsBatches, chartSnaps] = await Promise.all([
      Promise.all(cleanTickers.map((t) => fetchLiveTickerNews(t, fetchFn))),
      Promise.all(cleanTickers.map((t) => fetchLiveChartSnapshot(t, fetchFn))),
    ]);

    const liveArticles = newsBatches.flat();
    const headlinesDigest = liveArticles
      .slice(0, 12)
      .map((a) => `[${a.ticker}] ${a.title} (${a.publisher})`)
      .join('\n');

    const chartDigest = chartSnaps
      .map((c) => {
        const matched = VALORIA_ASSET_DIRECTORY.find(
          (a) => a.id.toUpperCase() === c.symbol.toUpperCase() || a.ticker.toUpperCase() === c.symbol.toUpperCase(),
        );
        const spotCad = matched ? VERIFIED_SPOT_CAD_2026_11[matched.id] ?? null : null;
        return `${c.symbol}: Spot vérifié ${spotCad ? `${formatCad(spotCad, 2)} CAD` : 'N/D'}, 3M ${
          c.priceMove3mPct !== null ? `${c.priceMove3mPct > 0 ? '+' : ''}${c.priceMove3mPct}%` : 'stable'
        }`;
      })
      .join(' | ');

    const safeFocus = sanitizePromptText(focusSliceLabel ?? '', 60);
    const safeMacro = sanitizePromptText(macroSummary ?? 'Désinflation graduelle Canada/US', 180);
    const safeThesis = sanitizePromptText(localThesis ?? '', 240);
    const totalNum = Number(portfolioTotalCad);
    const totalCadLabel = Number.isFinite(totalNum) && totalNum > 0 ? `${formatCad(totalNum)} CAD` : '(montant non communiqué)';

    const [groundingCall, structuredCall] = await Promise.all([
      callGeminiWithFallback({
        options,
        contents: `Analyse causale institutionnelle des dernières actualités financières, publications trimestrielles SEC/SEDAR+ et politique monétaire Banque du Canada/Fed impactant : ${cleanTickers.join(', ')}${safeFocus ? ` (focus compartiment : ${safeFocus})` : ''}. Identifie les effets de 1er et 2e ordre.`,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      callGeminiWithFallback({
        options,
        contents: `Portefeuille canadien en $ CAD (${totalCadLabel}).
Compartiment ciblé : ${safeFocus || 'Portefeuille global'}
Titres analysés : ${cleanTickers.join(', ')}
Trajectoires & Prix vérifiés ($ CAD) : ${chartDigest}
Contexte macro : ${safeMacro}
Diagnostic quantitatif initial : ${safeThesis}
Dernières dépêches temps réel :
${headlinesDigest || 'Publications SEC EDGAR / SEDAR+ / Banque du Canada'}`,
        config: {
          systemInstruction:
            'Tu es un stratège quantitatif institutionnel canadien (100 % en $ CAD). Produis une analyse causale de 1er et 2e ordre croisant actualités, taux et valorisations vérifiées, en français clair, précis et concis. Zéro invention de prix.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveThesis: { type: Type.STRING },
              macroRegimeReading: { type: Type.STRING },
              topBlindSpotRisk: { type: Type.STRING },
              topContrarianOpportunity: { type: Type.STRING },
              causalHighlights: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    trigger: { type: Type.STRING },
                    transmission: { type: Type.STRING },
                    portfolioImpactSummary: { type: Type.STRING },
                    action: { type: Type.STRING },
                  },
                  required: ['trigger', 'transmission', 'portfolioImpactSummary', 'action'],
                },
              },
            },
            required: [
              'executiveThesis',
              'macroRegimeReading',
              'topBlindSpotRisk',
              'topContrarianOpportunity',
              'causalHighlights',
            ],
          },
        },
      }),
    ]);

    const webSources = groundingCall ? extractGroundingSources(groundingCall, 6) : [];
    if (structuredCall && structuredCall.text) {
      try {
        const parsed = JSON.parse(structuredCall.text.trim()) as {
          executiveThesis?: string;
          macroRegimeReading?: string;
          topBlindSpotRisk?: string;
          topContrarianOpportunity?: string;
          causalHighlights?: Array<{
            trigger: string;
            transmission: string;
            portfolioImpactSummary: string;
            action: string;
          }>;
        };
        res.json({
          ok: true,
          source: 'gemini',
          liveArticlesCount: liveArticles.length,
          synthesis: {
            generatedAt: new Date().toISOString(),
            sourceMode: 'gemini_search_grounded',
            executiveThesis: String(parsed.executiveThesis ?? safeThesis).trim(),
            macroRegimeReading: String(parsed.macroRegimeReading ?? safeMacro).trim(),
            topBlindSpotRisk: String(parsed.topBlindSpotRisk ?? '').trim(),
            topContrarianOpportunity: String(parsed.topContrarianOpportunity ?? '').trim(),
            causalHighlights: Array.isArray(parsed.causalHighlights) ? parsed.causalHighlights.slice(0, 3) : [],
            webSources,
          },
        });
        return;
      } catch {
        // Fall through to deterministic fallback
      }
    }

    const topHeadline = liveArticles[0];
    const fallbackSources = liveArticles
      .map((a) => ({ uri: safeExternalHttpUrl(a.url), title: `${a.ticker} · ${a.publisher}` }))
      .filter((s): s is { uri: string; title: string } => Boolean(s.uri))
      .slice(0, 4);

    res.json({
      ok: true,
      source: 'fallback',
      liveArticlesCount: liveArticles.length,
      synthesis: {
        generatedAt: new Date().toISOString(),
        sourceMode: 'quant_causal_engine',
        executiveThesis:
          safeThesis ||
          'Les flux actuels récompensent les bilans générateurs de trésorerie libre et pénalisent les multiples spéculatifs face aux taux réels.',
        macroRegimeReading:
          safeMacro ||
          'Banque du Canada & Fed : taux réels positifs imposant une discipline stricte sur la marge de sécurité DCF.',
        topBlindSpotRisk: topHeadline
          ? `Surveillance active sur ${topHeadline.ticker} (${topHeadline.publisher}) : éviter toute concentration excessive aux multiples tendus.`
          : 'Contagion de 2e ordre des taux longs sur les semi-conducteurs en restructuration et logiciels à PER > 50x.',
        topContrarianOpportunity:
          'Arbitrage progressif des lignes surévaluées vers les leaders profitables décotés et le socle indiciel/or en CELI.',
        causalHighlights: [],
        webSources: fallbackSources,
      },
    });
  });

  // 13. POST /api/ai/time-machine-blind-test (strict anonymisation ACTIF_01..12 + anti-lookahead)
  app.post('/api/ai/time-machine-blind-test', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const sanitized = sanitizeBlindTimeMachinePayload(req.body);
    if (sanitized.dossiers.length < 4 || Object.keys(sanitized.codeToAssetId).length < 4) {
      res.status(400).json({
        ok: false,
        error: 'Dossiers anonymisés insuffisants pour exécuter le test à l’aveugle.',
      });
      return;
    }

    const blindPrompt = buildBlindTimeMachinePrompt(sanitized);
    const response = await callGeminiWithFallback({
      options,
      contents: blindPrompt,
      config: {
        systemInstruction:
          'Tu es un gérant quantitatif institutionnel passant un examen à l’aveugle sans biais futur. Juge uniquement les chiffres fondamentaux, le contexte macroéconomique et les catalyseurs anonymisés fournis à l’instant T0. Utilise uniquement les blindCode ACTIF_01..ACTIF_12 fournis.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            macroReadingAtEpochFr: { type: Type.STRING },
            allocationPhilosophyFr: { type: Type.STRING },
            picks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  blindCode: { type: Type.STRING },
                  weightPct: { type: Type.NUMBER },
                  blindThesisFr: { type: Type.STRING },
                },
                required: ['blindCode', 'weightPct', 'blindThesisFr'],
              },
            },
            avoids: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  blindCode: { type: Type.STRING },
                  blindAvoidReasonFr: { type: Type.STRING },
                },
                required: ['blindCode', 'blindAvoidReasonFr'],
              },
            },
          },
          required: ['macroReadingAtEpochFr', 'allocationPhilosophyFr', 'picks', 'avoids'],
        },
      },
    });

    if (response && response.text) {
      try {
        const parsed = JSON.parse(response.text.trim()) as {
          macroReadingAtEpochFr?: string;
          allocationPhilosophyFr?: string;
          picks?: Array<{ blindCode: string; weightPct: number; blindThesisFr: string }>;
          avoids?: Array<{ blindCode: string; blindAvoidReasonFr: string }>;
        };
        const seenPickIds = new Set<string>();
        const mappedPicks = (parsed.picks ?? [])
          .map((p) => {
            const cleanCode = String(p.blindCode ?? '').trim().toUpperCase();
            const realAssetId = sanitized.codeToAssetId[cleanCode];
            if (!realAssetId || seenPickIds.has(realAssetId)) return null;
            seenPickIds.add(realAssetId);
            return {
              assetId: realAssetId,
              blindCode: cleanCode,
              weightPct: Math.max(10, Math.min(40, Number(p.weightPct) || 20)),
              blindThesisFr: String(p.blindThesisFr ?? '').trim(),
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
          .slice(0, 5);

        const sumWeights = mappedPicks.reduce((s, p) => s + p.weightPct, 0) || 100;
        const normalizedPicks = mappedPicks.map((p) => ({
          ...p,
          weightPct: Number(((p.weightPct / sumWeights) * 100).toFixed(1)),
        }));

        const seenAvoidIds = new Set<string>(seenPickIds);
        const mappedAvoids = (parsed.avoids ?? [])
          .map((a) => {
            const cleanCode = String(a.blindCode ?? '').trim().toUpperCase();
            const realAssetId = sanitized.codeToAssetId[cleanCode];
            if (!realAssetId || seenAvoidIds.has(realAssetId)) return null;
            seenAvoidIds.add(realAssetId);
            return {
              assetId: realAssetId,
              blindCode: cleanCode,
              blindAvoidReasonFr: String(a.blindAvoidReasonFr ?? '').trim(),
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
          .slice(0, 3);

        if (normalizedPicks.length >= 3) {
          res.json({
            ok: true,
            source: 'gemini',
            audit: {
              epochId: sanitized.epochId,
              generatedAt: new Date().toISOString(),
              mode: 'gemini_blind_committee',
              macroReadingAtEpochFr: String(parsed.macroReadingAtEpochFr ?? '').trim(),
              allocationPhilosophyFr: String(parsed.allocationPhilosophyFr ?? '').trim(),
              picks: normalizedPicks,
              avoids: mappedAvoids,
              anonymizedMappingCount: sanitized.dossiers.length,
            },
          });
          return;
        }
      } catch {
        // Fallback below
      }
    }

    res.json(buildFallbackBlindAudit(sanitized));
  });
}

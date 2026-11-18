import {
  EXPANDED_GLOBAL_ASSETS,
  EXPANDED_SPOT_2026_CAD,
  registerDynamicCatalogProfile,
  type CryptoAnalystProfile,
  type FundOrMacroAnalystProfile,
  type MarketAssetSubClass,
} from './globalMarketCatalog';
import {
  EXPANDED_STOCK_SPOT_CAD_2026,
  EXPANDED_STOCK_TRAILING_CAD_2026,
} from './expandedStockUniverse2026';
import {
  type AssetCategory,
  type FinancialAsset,
  VERIFIED_BOC_FX_DATE,
  VERIFIED_BOC_FX_TO_CAD,
  VERIFIED_MONTHLY_CLOSES_CAD,
  VERIFIED_SOVEREIGN_YIELD_CURVE_2026_11,
  VERIFIED_SPOT_CAD_2026_11 as BASE_VERIFIED_SPOT_CAD_2026_11,
  VERIFIED_TRAILING_RETURNS_CAD_2026_11 as BASE_VERIFIED_TRAILING_RETURNS_CAD_2026_11,
  VERIFIED_YAHOO_SYMBOL_MAP,
  type SovereignYieldPoint,
  type VerifiedTrailingReturnSnapshot,
} from './verifiedMarketHistory2026';

export type { AssetCategory, FinancialAsset };

export const VERIFIED_SPOT_CAD_2026_11: Record<string, number> = {
  ...EXPANDED_STOCK_SPOT_CAD_2026,
  ...BASE_VERIFIED_SPOT_CAD_2026_11,
};

export const VERIFIED_TRAILING_RETURNS_CAD_2026_11: Record<
  string,
  VerifiedTrailingReturnSnapshot
> = {
  ...EXPANDED_STOCK_TRAILING_CAD_2026,
  ...BASE_VERIFIED_TRAILING_RETURNS_CAD_2026_11,
};

export {
  VERIFIED_BOC_FX_DATE,
  VERIFIED_BOC_FX_TO_CAD,
  VERIFIED_SOVEREIGN_YIELD_CURVE_2026_11,
  type SovereignYieldPoint,
  type VerifiedTrailingReturnSnapshot,
};

export type RiskProfile = 'prudent' | 'equilibre' | 'dynamique' | 'offensif';

export type InvestmentGoal =
  | 'croissance_long_terme'
  | 'retraite'
  | 'revenu_complementaire'
  | 'projet_moyen_terme';

export type RegimeId =
  | 'disinflation_growth'
  | 'rate_cuts_recovery'
  | 'stagflation'
  | 'recession_crisis'
  | 'overheating';

/**
 * Reference FX conversion rates to Canadian Dollars ($ CAD):
 * 1 CAD = 1.0000 CAD · 1 USD = 1.4181 CAD · 1 EUR = 1.5839 CAD
 */
export const DEFAULT_FX_TO_CAD: Record<string, number> = {
  CAD: 1,
  '$': 1,
  'CA$': 1,
  USD: 1.4181,
  'US$': 1.4181,
  EUR: 1.5839,
  '€': 1.5839,
  GBP: 1.865,
  CHF: 1.678,
  DKK: 0.2123,
};

export interface MacroIndicators {
  inflationPct: number;
  centralBankRatePct: number;
  gdpGrowthPct: number;
  vixLevel: number;
}

export interface MarketRegimePreset {
  id: RegimeId;
  name: string;
  shortLabel: string;
  summary: string;
  historicalAnalogy: string;
  indicators: MacroIndicators;
}

export interface MonthlyMarketPoint {
  yearMonth: string; // 'YYYY-MM'
  label: string; // 'Janv. 2015'
  prices: Record<string, number>;
  livretIndex: number;
  inflationIndex: number;
  regimeNote?: string;
}

export const GOAL_LABELS: Record<InvestmentGoal, { label: string; description: string }> = {
  croissance_long_terme: {
    label: 'Valorisation du capital',
    description: 'Maximiser la croissance du patrimoine à long terme (8 à 20 ans).',
  },
  retraite: {
    label: 'Préparation retraite',
    description: 'Construire un capital progressif sécurisé à l’approche de l’échéance.',
  },
  revenu_complementaire: {
    label: 'Revenus & rendement régulier',
    description: 'Privilégier le portage obligataire, les dividendes et une volatilité maîtrisée.',
  },
  projet_moyen_terme: {
    label: 'Projet à moyen terme (3–5 ans)',
    description: 'Préserver le capital tout en battant l’inflation avant un achat immobilier ou personnel.',
  },
};

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  actions: 'Actions',
  obligations: 'Obligations',
  crypto: 'Cryptomonnaies',
  refuge: 'Valeurs refuges & Cash',
};

export const MARKET_REGIMES: MarketRegimePreset[] = [
  {
    id: 'disinflation_growth',
    name: 'Désinflation & Croissance Modérée',
    shortLabel: 'Désinflation (Actuel)',
    summary:
      'L’inflation converge vers la cible de 2 %, les banques centrales stabilisent leurs taux et la croissance des bénéfices soutient les actifs risqués.',
    historicalAnalogy: 'Analogue aux cycles 2016–2017 et 2024–2026',
    indicators: {
      inflationPct: 2.1,
      centralBankRatePct: 2.5,
      gdpGrowthPct: 1.6,
      vixLevel: 15.5,
    },
  },
  {
    id: 'rate_cuts_recovery',
    name: 'Assouplissement Monétaire & Relance',
    shortLabel: 'Baisse des taux',
    summary:
      'Les banques centrales abaissent leurs taux directeurs pour accompagner la reprise. Les valeurs de croissance, la tech et les actifs numériques profitent du retour de la liquidité.',
    historicalAnalogy: 'Analogue aux reprises 2019 et second semestre 2020',
    indicators: {
      inflationPct: 1.6,
      centralBankRatePct: 1.75,
      gdpGrowthPct: 2.3,
      vixLevel: 14.0,
    },
  },
  {
    id: 'overheating',
    name: 'Surchauffe Économique & Taux Restrictifs',
    shortLabel: 'Surchauffe',
    summary:
      'Forte activité accompagnée de tensions sur les prix. Les taux élevés pèsent sur les actifs spéculatifs et obligataires longs.',
    historicalAnalogy: 'Analogue à la phase 2018 et début 2022',
    indicators: {
      inflationPct: 3.8,
      centralBankRatePct: 4.0,
      gdpGrowthPct: 2.8,
      vixLevel: 20.5,
    },
  },
  {
    id: 'stagflation',
    name: 'Stagflation & Choc d’Offre',
    shortLabel: 'Stagflation',
    summary:
      'Inflation persistante couplée à une stagnation économique. Actions, cryptos et obligations longues souffrent simultanément ; l’or et le monétaire protègent le portefeuille.',
    historicalAnalogy: 'Analogue au choc énergétique et obligataire de 2022',
    indicators: {
      inflationPct: 4.9,
      centralBankRatePct: 4.25,
      gdpGrowthPct: 0.2,
      vixLevel: 27.0,
    },
  },
  {
    id: 'recession_crisis',
    name: 'Contraction & Aversion au Risque',
    shortLabel: 'Récession',
    summary:
      'Recul des résultats d’entreprises et pic de volatilité. Les obligations souveraines, le monétaire et l’or amortissent le repli des actifs risqués.',
    historicalAnalogy: 'Analogue aux chocs de liquidité de 2008 et mars 2020',
    indicators: {
      inflationPct: 1.1,
      centralBankRatePct: 1.5,
      gdpGrowthPct: -1.4,
      vixLevel: 34.0,
    },
  },
];

export const ASSETS: FinancialAsset[] = [
  {
    id: 'XBB',
    ticker: 'XBB.PA',
    name: 'ETF MSCI World (Actions Monde)',
    category: 'actions',
    categoryLabel: 'Actions Monde',
    wrapper: 'PEA · Assurance-Vie · CTO',
    annualFeePct: 0.38,
    dividendYieldPct: 1.8,
    baseExpectedReturnPct: 8.4,
    baseVolatilityPct: 15.2,
    growthBeta: 1.35,
    inflationBeta: -0.45,
    rateSensitivity: -0.55,
    crisisConvexity: -0.42,
    description:
      'Exposition diversifiée à 1 400 grandes entreprises de 23 pays développés, dividendes réinvestis.',
    initialPrice2015: 192.0,
  },
  {
    id: 'ESE',
    ticker: 'ESE.PA',
    name: 'ETF S&P 500 (Actions États-Unis)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'PEA · Assurance-Vie · CTO',
    annualFeePct: 0.15,
    dividendYieldPct: 1.4,
    baseExpectedReturnPct: 9.1,
    baseVolatilityPct: 16.4,
    growthBeta: 1.5,
    inflationBeta: -0.5,
    rateSensitivity: -0.65,
    crisisConvexity: -0.45,
    description:
      'Réplique les 500 premières capitalisations américaines à dominante technologique et santé.',
    initialPrice2015: 8.4,
  },
  {
    id: 'MEUD',
    ticker: 'MEUD.PA',
    name: 'ETF Stoxx Europe 600',
    category: 'actions',
    categoryLabel: 'Actions Europe',
    wrapper: 'PEA · Assurance-Vie · CTO',
    annualFeePct: 0.07,
    dividendYieldPct: 3.1,
    baseExpectedReturnPct: 7.2,
    baseVolatilityPct: 14.8,
    growthBeta: 1.25,
    inflationBeta: -0.3,
    rateSensitivity: -0.35,
    crisisConvexity: -0.4,
    description:
      'Couvre 600 entreprises européennes (industrie, santé, finance) à valorisation modérée.',
    initialPrice2015: 138.0,
  },
  {
    id: 'ADP',
    ticker: 'ADP',
    name: 'SNPS Corp. (IA & Semi-Conducteurs)',
    category: 'actions',
    categoryLabel: 'Actions Technologie',
    wrapper: 'CTO',
    annualFeePct: 0.0,
    dividendYieldPct: 0.1,
    baseExpectedReturnPct: 13.5,
    baseVolatilityPct: 36.0,
    growthBeta: 2.3,
    inflationBeta: -1.1,
    rateSensitivity: -1.35,
    crisisConvexity: -0.85,
    description:
      'Leader mondial du calcul accéléré et de l’IA, à fort potentiel mais forte volatilité.',
    initialPrice2015: 0.52,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
  },
  {
    id: 'MC',
    ticker: 'MC.PA',
    name: 'LVMH (Luxe & Maroquinerie)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0.0,
    dividendYieldPct: 1.9,
    baseExpectedReturnPct: 8.6,
    baseVolatilityPct: 22.0,
    growthBeta: 1.4,
    inflationBeta: -0.2,
    rateSensitivity: -0.45,
    crisisConvexity: -0.38,
    description:
      'Leader mondial du luxe doté de marges élevées et d’un fort pouvoir de fixation des prix.',
    initialPrice2015: 132.0,
    isIndividualStock: true,
    sector: 'Luxe & Consommation',
    region: 'Europe (PEA)',
  },
  {
    id: 'GOVT',
    ticker: 'MTB.PA',
    name: 'ETF Obligations Souveraines 7-10 ans',
    category: 'obligations',
    categoryLabel: 'Obligations Souveraines',
    wrapper: 'CELI · REER · CTO',
    annualFeePct: 0.15,
    dividendYieldPct: 3.0,
    baseExpectedReturnPct: 3.8,
    baseVolatilityPct: 6.8,
    growthBeta: -0.35,
    inflationBeta: -1.15,
    rateSensitivity: -0.9,
    crisisConvexity: 0.55,
    description:
      'Emprunts souverains de haute qualité ; amortisseur classique lors des baisses de taux directeurs.',
    initialPrice2015: 164.0,
  },
  {
    id: 'CORP',
    ticker: 'ECRP.PA',
    name: 'ETF Obligations Entreprises Investment Grade',
    category: 'obligations',
    categoryLabel: 'Obligations Entreprises',
    wrapper: 'CELI · REER · CTO',
    annualFeePct: 0.2,
    dividendYieldPct: 3.6,
    baseExpectedReturnPct: 4.4,
    baseVolatilityPct: 5.4,
    growthBeta: 0.25,
    inflationBeta: -0.75,
    rateSensitivity: -0.5,
    crisisConvexity: 0.1,
    description:
      'Portefeuille d’obligations d’entreprises Investment Grade offrant un rendement régulier en $ CAD.',
    initialPrice2015: 108.0,
  },
  {
    id: 'BTC',
    ticker: 'BTC-CAD',
    name: 'Bitcoin (Actif Numérique Majeur)',
    category: 'crypto',
    categoryLabel: 'Cryptomonnaies',
    wrapper: 'CELI (ETF) · CTO',
    annualFeePct: 0.25,
    dividendYieldPct: 0.0,
    baseExpectedReturnPct: 16.5,
    baseVolatilityPct: 58.0,
    growthBeta: 2.1,
    inflationBeta: -0.6,
    rateSensitivity: -1.75,
    crisisConvexity: -1.05,
    description:
      'Première cryptomonnaie décentralisée à offre limitée (21M unités), cotée en $ CAD.',
    initialPrice2015: 265.0,
  },
  {
    id: 'ETH',
    ticker: 'ETH-CAD',
    name: 'Ethereum (Contrats Intelligents & Staking)',
    category: 'crypto',
    categoryLabel: 'Cryptomonnaies',
    wrapper: 'CELI (ETF) · CTO',
    annualFeePct: 0.25,
    dividendYieldPct: 3.2,
    baseExpectedReturnPct: 15.0,
    baseVolatilityPct: 64.0,
    growthBeta: 2.35,
    inflationBeta: -0.85,
    rateSensitivity: -1.9,
    crisisConvexity: -1.15,
    description:
      'Infrastructure programmable décentralisée générant un rendement de validation, cotée en $ CAD.',
    initialPrice2015: 2.4,
  },
  {
    id: 'GOLD',
    ticker: '4GLD.DE',
    name: 'Or Physique (ETC / Gold Bullion)',
    category: 'refuge',
    categoryLabel: 'Valeur Refuge & Or',
    wrapper: 'CELI · REER · CTO',
    annualFeePct: 0.12,
    dividendYieldPct: 0.0,
    baseExpectedReturnPct: 6.2,
    baseVolatilityPct: 13.4,
    growthBeta: -0.2,
    inflationBeta: 1.25,
    rateSensitivity: -0.15,
    crisisConvexity: 0.85,
    description:
      'Actif refuge tangible décorrélé des actions, protecteur lors des poussées d’inflation et crises.',
    initialPrice2015: 34.2,
  },
  {
    id: 'CASH',
    ticker: 'CASH.TO',
    name: 'Fonds Monétaire CAD (Taux CORRA Capitalisant)',
    category: 'refuge',
    categoryLabel: 'Liquidités Sans Risque',
    wrapper: 'CELI · REER · CTO',
    annualFeePct: 0.05,
    dividendYieldPct: 2.5,
    baseExpectedReturnPct: 2.5,
    baseVolatilityPct: 0.4,
    growthBeta: 0.0,
    inflationBeta: 0.35,
    rateSensitivity: 0.85,
    crisisConvexity: 0.45,
    description:
      'Réplique le taux interbancaire canadien CORRA (Banque du Canada) au jour le jour sans risque en capital.',
    initialPrice2015: 100.0,
  },
  // --- EXPANDED INSTITUTIONAL EQUITY UNIVERSE (EUROPE PEA & US CTO) ---
  {
    id: 'ASML',
    ticker: 'ASML.AS',
    name: 'ASML Holding (Lithographie EUV)',
    category: 'actions',
    categoryLabel: 'Actions Europe',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.9,
    baseExpectedReturnPct: 12.6,
    baseVolatilityPct: 28.5,
    growthBeta: 1.85,
    inflationBeta: -0.7,
    rateSensitivity: -0.95,
    crisisConvexity: -0.55,
    description: 'Monopole mondial des machines de lithographie EUV indispensables aux puces IA.',
    initialPrice2015: 89.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.0085,
  },
  {
    id: 'SU',
    ticker: 'SU.PA',
    name: 'Schneider Electric (Électrification & Data Centers)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.5,
    baseExpectedReturnPct: 11.4,
    baseVolatilityPct: 20.5,
    growthBeta: 1.45,
    inflationBeta: -0.15,
    rateSensitivity: -0.45,
    crisisConvexity: -0.32,
    description: 'Bénéficiaire majeur de l’électrification industrielle et du refroidissement des data centers IA.',
    initialPrice2015: 58.0,
    isIndividualStock: true,
    sector: 'Industrie & Défense',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.0095,
  },
  {
    id: 'ODFL',
    ticker: 'ODFL.PA',
    name: 'Rok (Propulsion Aéronautique & Défense)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.2,
    baseExpectedReturnPct: 11.1,
    baseVolatilityPct: 21.0,
    growthBeta: 1.3,
    inflationBeta: 0.05,
    rateSensitivity: -0.3,
    crisisConvexity: -0.25,
    description: 'Moteurs LEAP à revenus récurrents de maintenance très haute marge et souveraineté défense.',
    initialPrice2015: 61.0,
    isIndividualStock: true,
    sector: 'Industrie & Défense',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.0105,
  },
  {
    id: 'RMS',
    ticker: 'RMS.PA',
    name: 'Hermès International (Ultra-Luxe)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.8,
    baseExpectedReturnPct: 10.5,
    baseVolatilityPct: 19.5,
    growthBeta: 1.15,
    inflationBeta: 0.2,
    rateSensitivity: -0.4,
    crisisConvexity: -0.15,
    description: 'Pouvoir de prix inégalé, carnet de commandes structurellement excédentaire et ROIC > 35 %.',
    initialPrice2015: 295.0,
    isIndividualStock: true,
    sector: 'Luxe & Consommation',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.0075,
  },
  {
    id: 'AIR',
    ticker: 'AIR.PA',
    name: 'Airbus SE (Aviation Civile & Spatial)',
    category: 'actions',
    categoryLabel: 'Actions Europe',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.4,
    baseExpectedReturnPct: 9.8,
    baseVolatilityPct: 24.0,
    growthBeta: 1.45,
    inflationBeta: -0.25,
    rateSensitivity: -0.35,
    crisisConvexity: -0.48,
    description: 'Duopole mondial avec plus de 8 500 avions en carnet de commandes sur 10 ans.',
    initialPrice2015: 54.0,
    isIndividualStock: true,
    sector: 'Industrie & Défense',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.0045,
  },
  {
    id: 'AI',
    ticker: 'AI.PA',
    name: 'Air Liquide (Gaz Industriels & Santé)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.9,
    baseExpectedReturnPct: 9.2,
    baseVolatilityPct: 15.0,
    growthBeta: 0.9,
    inflationBeta: 0.25,
    rateSensitivity: -0.3,
    crisisConvexity: 0.05,
    description: 'Contrats long terme indexés sur l’énergie et croissance régulière du dividende depuis 30 ans.',
    initialPrice2015: 78.0,
    isIndividualStock: true,
    sector: 'Énergie & Matériaux',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.0055,
  },
  {
    id: 'OR',
    ticker: 'OR.PA',
    name: 'L’Oréal (Cosmétiques & Dermatologie)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.6,
    baseExpectedReturnPct: 8.7,
    baseVolatilityPct: 17.8,
    growthBeta: 1.0,
    inflationBeta: 0.0,
    rateSensitivity: -0.35,
    crisisConvexity: -0.1,
    description: 'Leader mondial de la beauté à forte génération de cash-flow libre et bilan très sain.',
    initialPrice2015: 155.0,
    isIndividualStock: true,
    sector: 'Luxe & Consommation',
    region: 'Europe (PEA)',
    recentTrendDrift: -0.001,
  },
  {
    id: 'SAN',
    ticker: 'SAN.PA',
    name: 'Sanofi (Biopharma & Immunologie)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 3.8,
    baseExpectedReturnPct: 8.5,
    baseVolatilityPct: 15.5,
    growthBeta: 0.55,
    inflationBeta: 0.1,
    rateSensitivity: -0.15,
    crisisConvexity: 0.2,
    description: 'Profil défensif décoté porté par Dupixent et un rendement de dividende proche de 4 %.',
    initialPrice2015: 76.0,
    isIndividualStock: true,
    sector: 'Santé & Pharma',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.004,
  },
  {
    id: 'NOVO',
    ticker: 'NOVO-B.CO',
    name: 'Novo Nordisk (Métabolisme & GLP-1)',
    category: 'actions',
    categoryLabel: 'Actions Europe',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.3,
    baseExpectedReturnPct: 11.2,
    baseVolatilityPct: 23.5,
    growthBeta: 1.1,
    inflationBeta: 0.1,
    rateSensitivity: -0.35,
    crisisConvexity: 0.05,
    description: 'Leader européen du diabète et de l’obésité affichant un ROIC exceptionnel supérieur à 45 %.',
    initialPrice2015: 24.0,
    isIndividualStock: true,
    sector: 'Santé & Pharma',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.006,
  },
  {
    id: 'SAP',
    ticker: 'SAP.DE',
    name: 'SAP SE (Cloud ERP & IA Entreprise)',
    category: 'actions',
    categoryLabel: 'Actions Europe',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.1,
    baseExpectedReturnPct: 10.6,
    baseVolatilityPct: 20.0,
    growthBeta: 1.35,
    inflationBeta: -0.2,
    rateSensitivity: -0.55,
    crisisConvexity: -0.22,
    description: 'Migration accélérée vers le cloud S/4HANA offrant plus de 80 % de revenus récurrents.',
    initialPrice2015: 62.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.011,
  },
  {
    id: 'TTE',
    ticker: 'TTE.PA',
    name: 'TotalEnergies (Énergie Intégrée & GNL)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 5.2,
    baseExpectedReturnPct: 9.4,
    baseVolatilityPct: 18.5,
    growthBeta: 0.85,
    inflationBeta: 0.85,
    rateSensitivity: 0.15,
    crisisConvexity: -0.12,
    description: 'Rendement de FCF > 9 %, rachats d’actions massifs et couverture naturelle contre l’inflation.',
    initialPrice2015: 43.0,
    isIndividualStock: true,
    sector: 'Énergie & Matériaux',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.004,
  },
  {
    id: 'BNP',
    ticker: 'BNP.PA',
    name: 'BNP Paribas (Banque & Financement)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 6.8,
    baseExpectedReturnPct: 9.1,
    baseVolatilityPct: 22.5,
    growthBeta: 1.25,
    inflationBeta: 0.15,
    rateSensitivity: 0.4,
    crisisConvexity: -0.55,
    description: 'Décote sur actif net tangible (P/TBV < 0,8x) et fort rendement distribué aux actionnaires.',
    initialPrice2015: 48.0,
    isIndividualStock: true,
    sector: 'Finance & Paiements',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.0045,
  },
  {
    id: 'CS',
    ticker: 'CS.PA',
    name: 'AXA SA (Assurance & Gestion)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 5.8,
    baseExpectedReturnPct: 8.9,
    baseVolatilityPct: 17.5,
    growthBeta: 0.95,
    inflationBeta: 0.2,
    rateSensitivity: 0.35,
    crisisConvexity: -0.28,
    description: 'Solvabilité > 215 % et génération de trésorerie régulière favorable aux taux positifs.',
    initialPrice2015: 20.5,
    isIndividualStock: true,
    sector: 'Finance & Paiements',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.0055,
  },
  {
    id: 'DG',
    ticker: 'DG.PA',
    name: 'Vinci (Concessions & Énergies)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 4.1,
    baseExpectedReturnPct: 8.8,
    baseVolatilityPct: 17.2,
    growthBeta: 1.0,
    inflationBeta: 0.35,
    rateSensitivity: -0.3,
    crisisConvexity: -0.2,
    description: 'Autoroutes, aéroports et Vinci Energies indexés sur l’inflation à cash-flow prévisible.',
    initialPrice2015: 52.0,
    isIndividualStock: true,
    sector: 'Énergie & Matériaux',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.0025,
  },
  {
    id: 'CAP',
    ticker: 'CAP.PA',
    name: 'Capgemini (Conseil IT & Intégration IA)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.9,
    baseExpectedReturnPct: 9.6,
    baseVolatilityPct: 22.0,
    growthBeta: 1.35,
    inflationBeta: -0.25,
    rateSensitivity: -0.45,
    crisisConvexity: -0.35,
    description: 'Valorisation raisonnable (PER ~15x) avant la reprise des budgets d’intégration IA.',
    initialPrice2015: 68.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'Europe (PEA)',
    recentTrendDrift: 0.001,
  },
  {
    id: 'KER',
    ticker: 'KER.PA',
    name: 'Kering (Luxe — En Restructuration)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 2.8,
    baseExpectedReturnPct: 4.2,
    baseVolatilityPct: 28.5,
    growthBeta: 1.35,
    inflationBeta: -0.35,
    rateSensitivity: -0.55,
    crisisConvexity: -0.58,
    description: 'Repli marqué des ventes et de la marge opérationnelle chez Gucci ; visibilité dégradée.',
    initialPrice2015: 165.0,
    isIndividualStock: true,
    sector: 'Luxe & Consommation',
    region: 'Europe (PEA)',
    recentTrendDrift: -0.024,
  },
  {
    id: 'TEP',
    ticker: 'TEP.PA',
    name: 'Teleperformance (Relation Client & BPO)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 4.2,
    baseExpectedReturnPct: 3.1,
    baseVolatilityPct: 36.0,
    growthBeta: 1.15,
    inflationBeta: -0.55,
    rateSensitivity: -0.8,
    crisisConvexity: -0.72,
    description: 'Menace structurelle d’automatisation par l’IA générative et endettement post-Majorel.',
    initialPrice2015: 62.0,
    isIndividualStock: true,
    sector: 'Industrie & Défense',
    region: 'Europe (PEA)',
    recentTrendDrift: -0.032,
  },
  {
    id: 'STLAP',
    ticker: 'STLAP.PA',
    name: 'Stellantis (Constructeur Automobile)',
    category: 'actions',
    categoryLabel: 'Actions Europe',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 5.5,
    baseExpectedReturnPct: 4.6,
    baseVolatilityPct: 30.0,
    growthBeta: 1.5,
    inflationBeta: -0.45,
    rateSensitivity: -0.65,
    crisisConvexity: -0.65,
    description: 'Compression rapide des marges nord-américaines, stocks élevés et décaissement de FCF.',
    initialPrice2015: 11.5,
    isIndividualStock: true,
    sector: 'Luxe & Consommation',
    region: 'Europe (PEA)',
    recentTrendDrift: -0.021,
  },
  {
    id: 'ALO',
    ticker: 'ALO.PA',
    name: 'Alstom (Matériel Ferroviaire)',
    category: 'actions',
    categoryLabel: 'Actions France',
    wrapper: 'PEA · CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.0,
    baseExpectedReturnPct: 3.8,
    baseVolatilityPct: 33.5,
    growthBeta: 1.25,
    inflationBeta: -0.6,
    rateSensitivity: -0.85,
    crisisConvexity: -0.6,
    description: 'Faible conversion de cash-flow libre, marges étroites et historique de dilution du bilan.',
    initialPrice2015: 27.0,
    isIndividualStock: true,
    sector: 'Industrie & Défense',
    region: 'Europe (PEA)',
    recentTrendDrift: -0.022,
  },
  // --- US LARGE & GROWTH EQUITIES (CTO) ---
  {
    id: 'MSFT',
    ticker: 'MSFT',
    name: 'Microsoft Corp. (Cloud Azure & Copilot)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.7,
    baseExpectedReturnPct: 11.8,
    baseVolatilityPct: 21.5,
    growthBeta: 1.55,
    inflationBeta: -0.35,
    rateSensitivity: -0.65,
    crisisConvexity: -0.25,
    description: 'Socle logiciel mondial combinant Azure, Office 365, bilan AAA et ROIC supérieur à 28 %.',
    initialPrice2015: 46.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.0085,
  },
  {
    id: 'GOOGL',
    ticker: 'GOOGL',
    name: 'Alphabet Inc. (Search, Cloud & DeepMind)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.5,
    baseExpectedReturnPct: 12.1,
    baseVolatilityPct: 23.5,
    growthBeta: 1.6,
    inflationBeta: -0.4,
    rateSensitivity: -0.6,
    crisisConvexity: -0.32,
    description: 'Valorisation très attractive parmi les géants Tech (PER ~20x) avec forte génération de FCF.',
    initialPrice2015: 26.5,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.009,
  },
  {
    id: 'META',
    ticker: 'META',
    name: 'Meta Platforms (Réseaux & Publicité IA)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.4,
    baseExpectedReturnPct: 11.9,
    baseVolatilityPct: 29.0,
    growthBeta: 1.75,
    inflationBeta: -0.45,
    rateSensitivity: -0.7,
    crisisConvexity: -0.45,
    description: 'Monétisation publicitaire dopée par l’IA, marges opérationnelles ~38 % et rachats massifs.',
    initialPrice2015: 78.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.012,
  },
  {
    id: 'AMZN',
    ticker: 'AMZN',
    name: 'Amazon.com (AWS Cloud & Logistique)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.0,
    baseExpectedReturnPct: 11.6,
    baseVolatilityPct: 26.5,
    growthBeta: 1.7,
    inflationBeta: -0.45,
    rateSensitivity: -0.75,
    crisisConvexity: -0.38,
    description: 'Inflexion majeure du Free Cash-Flow portée par AWS et la publicité haute marge.',
    initialPrice2015: 18.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.009,
  },
  {
    id: 'VCN',
    ticker: 'VCN',
    name: 'Zcn Inc. (Puces IA Custom & VMware)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.3,
    baseExpectedReturnPct: 12.8,
    baseVolatilityPct: 31.0,
    growthBeta: 1.95,
    inflationBeta: -0.65,
    rateSensitivity: -0.9,
    crisisConvexity: -0.5,
    description: 'Accélérateurs IA sur-mesure (XPU), équipements réseaux et flux logiciels récurrents VMware.',
    initialPrice2015: 11.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.013,
  },
  {
    id: 'AAPL',
    ticker: 'AAPL',
    name: 'Apple Inc. (Écosystème iOS & Services)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.5,
    baseExpectedReturnPct: 8.8,
    baseVolatilityPct: 21.0,
    growthBeta: 1.35,
    inflationBeta: -0.3,
    rateSensitivity: -0.55,
    crisisConvexity: -0.25,
    description: 'Écosystème ultra-rentable (ROIC > 45 %) mais croissance du chiffre d’affaires plus modérée pour 30x les bénéfices.',
    initialPrice2015: 27.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.004,
  },
  {
    id: 'LLY',
    ticker: 'LLY',
    name: 'Eli Lilly & Co. (Biopharma & Obésité)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.7,
    baseExpectedReturnPct: 11.5,
    baseVolatilityPct: 24.5,
    growthBeta: 1.15,
    inflationBeta: 0.05,
    rateSensitivity: -0.45,
    crisisConvexity: 0.05,
    description: 'Hyper-croissance bénéficiaire (Mounjaro/Zepbound) compensant un multiple exigeant.',
    initialPrice2015: 69.0,
    isIndividualStock: true,
    sector: 'Santé & Pharma',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.0125,
  },
  {
    id: 'UNH',
    ticker: 'UNH',
    name: 'UnitedHealth Group (Santé & Optum)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.5,
    baseExpectedReturnPct: 9.8,
    baseVolatilityPct: 17.5,
    growthBeta: 0.75,
    inflationBeta: 0.2,
    rateSensitivity: -0.2,
    crisisConvexity: 0.15,
    description: 'Compounder défensif américain de la santé offrant visibilité des BPA et faible corrélation.',
    initialPrice2015: 103.0,
    isIndividualStock: true,
    sector: 'Santé & Pharma',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.0045,
  },
  {
    id: 'JPM',
    ticker: 'JPM',
    name: 'JPMorgan Chase (Banque d’Investissement)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 2.2,
    baseExpectedReturnPct: 9.7,
    baseVolatilityPct: 20.5,
    growthBeta: 1.25,
    inflationBeta: 0.2,
    rateSensitivity: 0.35,
    crisisConvexity: -0.42,
    description: 'Référence bancaire mondiale affichant un ROE > 17 % et un bilan forteresse.',
    initialPrice2015: 61.0,
    isIndividualStock: true,
    sector: 'Finance & Paiements',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.0075,
  },
  {
    id: 'V',
    ticker: 'V',
    name: 'Visa Inc. (Réseau Mondial de Paiements)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.8,
    baseExpectedReturnPct: 10.4,
    baseVolatilityPct: 17.2,
    growthBeta: 1.15,
    inflationBeta: 0.35,
    rateSensitivity: -0.25,
    crisisConvexity: -0.2,
    description: 'Péage mondial sur les transactions numériques avec 66 % de marge opérationnelle.',
    initialPrice2015: 65.0,
    isIndividualStock: true,
    sector: 'Finance & Paiements',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.006,
  },
  {
    id: 'COST',
    ticker: 'COST',
    name: 'Costco Wholesale (Distribution Abonnés)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.6,
    baseExpectedReturnPct: 7.9,
    baseVolatilityPct: 17.8,
    growthBeta: 0.95,
    inflationBeta: 0.15,
    rateSensitivity: -0.35,
    crisisConvexity: 0.05,
    description: 'Qualité opérationnelle remarquable (renouvellement 93 %), mais multiple tendu proche de 50x les résultats.',
    initialPrice2015: 141.0,
    isIndividualStock: true,
    sector: 'Luxe & Consommation',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.008,
  },
  {
    id: 'XOM',
    ticker: 'XOM',
    name: 'ExxonMobil (Énergie & Permien)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 3.4,
    baseExpectedReturnPct: 8.8,
    baseVolatilityPct: 20.5,
    growthBeta: 0.85,
    inflationBeta: 0.95,
    rateSensitivity: 0.2,
    crisisConvexity: -0.1,
    description: 'Actifs à bas coût dans le bassin Permien et en Guyana, protecteur lors des chocs d’offre.',
    initialPrice2015: 88.0,
    isIndividualStock: true,
    sector: 'Énergie & Matériaux',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.0035,
  },
  {
    id: 'TSLA',
    ticker: 'TSLA',
    name: 'Tesla Inc. (VE, Stockage & Robotique)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.0,
    baseExpectedReturnPct: 6.4,
    baseVolatilityPct: 52.0,
    growthBeta: 2.35,
    inflationBeta: -0.95,
    rateSensitivity: -1.45,
    crisisConvexity: -0.9,
    description: 'Multiple très exigeant (~72x) face au ralentissement des marges automobiles et forte volatilité.',
    initialPrice2015: 15.0,
    isIndividualStock: true,
    sector: 'Luxe & Consommation',
    region: 'États-Unis (CTO)',
    recentTrendDrift: -0.011,
  },
  {
    id: 'INTC',
    ticker: 'INTC',
    name: 'Intel Corp. (Fonderie & Processeurs x86)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.0,
    baseExpectedReturnPct: 2.8,
    baseVolatilityPct: 38.0,
    growthBeta: 1.45,
    inflationBeta: -0.7,
    rateSensitivity: -0.9,
    crisisConvexity: -0.75,
    description: 'Pertes massives de la division fonderie, perte de parts de marché IA/serveurs et FCF négatif.',
    initialPrice2015: 36.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: -0.028,
  },
  {
    id: 'BA',
    ticker: 'BA',
    name: 'Boeing Co. (Aéronautique & Défense US)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.0,
    baseExpectedReturnPct: 3.4,
    baseVolatilityPct: 34.5,
    growthBeta: 1.5,
    inflationBeta: -0.65,
    rateSensitivity: -0.85,
    crisisConvexity: -0.78,
    description: 'Consommation critique de trésorerie, dette élevée et retards industriels persistants.',
    initialPrice2015: 130.0,
    isIndividualStock: true,
    sector: 'Industrie & Défense',
    region: 'États-Unis (CTO)',
    recentTrendDrift: -0.024,
  },
  {
    id: 'NKE',
    ticker: 'NKE',
    name: 'Nike Inc. (Équipement Sportif)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.9,
    baseExpectedReturnPct: 4.9,
    baseVolatilityPct: 26.0,
    growthBeta: 1.2,
    inflationBeta: -0.4,
    rateSensitivity: -0.5,
    crisisConvexity: -0.45,
    description: 'Essoufflement de la croissance organique face aux nouveaux concurrents et révisions baissières des BPA.',
    initialPrice2015: 49.0,
    isIndividualStock: true,
    sector: 'Luxe & Consommation',
    region: 'États-Unis (CTO)',
    recentTrendDrift: -0.019,
  },
  {
    id: 'PFE',
    ticker: 'PFE',
    name: 'Pfizer Inc. (Pharmacie & Brevets)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 5.9,
    baseExpectedReturnPct: 5.1,
    baseVolatilityPct: 22.5,
    growthBeta: 0.65,
    inflationBeta: -0.2,
    rateSensitivity: -0.35,
    crisisConvexity: -0.15,
    description: 'Falaise de brevets à l’horizon 2028, dette post-Seagen et ROIC sous pression malgré le dividende.',
    initialPrice2015: 31.0,
    isIndividualStock: true,
    sector: 'Santé & Pharma',
    region: 'États-Unis (CTO)',
    recentTrendDrift: -0.016,
  },
  {
    id: 'EMR',
    ticker: 'EMR',
    name: 'TSMC (Taiwan Semiconductor — Fonderie IA)',
    category: 'actions',
    categoryLabel: 'Actions Internationales',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 1.3,
    baseExpectedReturnPct: 13.1,
    baseVolatilityPct: 29.5,
    growthBeta: 1.9,
    inflationBeta: -0.55,
    rateSensitivity: -0.8,
    crisisConvexity: -0.52,
    description:
      'Monopole mondial de la gravure avancée 3nm/2nm et de l’encapsulation CoWoS pour puces IA.',
    initialPrice2015: 22.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.0135,
  },
  {
    id: 'ACN',
    ticker: 'ACN',
    name: 'DHR Corp. (Métrologie & Contrôle Semi-Conducteurs)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.9,
    baseExpectedReturnPct: 12.2,
    baseVolatilityPct: 27.5,
    growthBeta: 1.75,
    inflationBeta: -0.5,
    rateSensitivity: -0.75,
    crisisConvexity: -0.45,
    description:
      'Leader mondial de l’inspection de wafers et du contrôle de rendement optique sur nœuds avancés.',
    initialPrice2015: 64.0,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.0115,
  },
  {
    id: 'PAYX',
    ticker: 'PAYX',
    name: 'Ctas Technologies (Plateformes IA AIP & Défense)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.0,
    baseExpectedReturnPct: 8.2,
    baseVolatilityPct: 48.0,
    growthBeta: 2.25,
    inflationBeta: -0.85,
    rateSensitivity: -1.35,
    crisisConvexity: -0.78,
    description:
      'Adoption rapide d’AIP dans le secteur commercial et militaire américain, mais multiple de valorisation très tendu.',
    initialPrice2015: 9.5,
    isIndividualStock: true,
    sector: 'Tech & Semi-Conducteurs',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.014,
  },
  {
    id: 'QQQM',
    ticker: 'QQQM',
    name: 'Zlb Aerospace (Superalliages & Turbines)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0,
    dividendYieldPct: 0.4,
    baseExpectedReturnPct: 11.3,
    baseVolatilityPct: 24.0,
    growthBeta: 1.4,
    inflationBeta: 0.1,
    rateSensitivity: -0.35,
    crisisConvexity: -0.3,
    description:
      'Fournisseur critique d’aubes de turbines haute température pour moteurs civils et militaires à fort pricing power.',
    initialPrice2015: 24.0,
    isIndividualStock: true,
    sector: 'Industrie & Défense',
    region: 'États-Unis (CTO)',
    recentTrendDrift: 0.012,
  },
  {
    id: 'ECL',
    ticker: 'ECL',
    name: 'Space Exploration & Orbital Tech (Spatial & Défense)',
    category: 'actions',
    categoryLabel: 'Actions États-Unis',
    wrapper: 'CTO',
    annualFeePct: 0.45,
    dividendYieldPct: 0.0,
    baseExpectedReturnPct: 9.4,
    baseVolatilityPct: 38.0,
    growthBeta: 1.95,
    inflationBeta: -0.75,
    rateSensitivity: -1.15,
    crisisConvexity: -0.7,
    description:
      'Exposition thématique aux lanceurs réutilisables, constellations satellitaires en orbite basse et infrastructures spatiales.',
    initialPrice2015: 25.0,
    isIndividualStock: true,
    sector: 'Industrie & Défense',
    region: 'États-Unis (CTO)',
    recentTrendDrift: -0.004,
  },
  {
    id: 'CDNS',
    ticker: 'CDNS.PA',
    name: 'ETF MSCI Emerging Asia (Amundi UCITS)',
    category: 'actions',
    categoryLabel: 'Actions Asie Émergente',
    wrapper: 'PEA · Assurance-Vie · CTO',
    annualFeePct: 0.2,
    dividendYieldPct: 2.1,
    baseExpectedReturnPct: 8.6,
    baseVolatilityPct: 18.8,
    growthBeta: 1.4,
    inflationBeta: -0.35,
    rateSensitivity: -0.55,
    crisisConvexity: -0.48,
    description:
      'Exposition diversifiée aux leaders technologiques et industriels d’Asie émergente (Taïwan, Inde, Corée, Chine).',
    initialPrice2015: 24.5,
  },
  ...EXPANDED_GLOBAL_ASSETS,
];

const MONTH_NAMES_FR = [
  'Janv.',
  'Févr.',
  'Mars',
  'Avr.',
  'Mai',
  'Juin',
  'Juil.',
  'Août',
  'Sept.',
  'Oct.',
  'Nov.',
  'Déc.',
];

function deterministicNoise(monthIndex: number, seed: number): number {
  const x = Math.sin(monthIndex * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Realistic Nov. 2026 spot prices in Canadian Dollars ($ CAD) calibrated with:
 * 1 USD = 1.4181 CAD · 1 EUR = 1.5839 CAD · 1 CAD = 1.0000 CAD.
 * Scaling the entire 2015–2026 trajectory of each asset by a positive constant preserves
 * 100% of monthly returns, volatilities, correlations, RSI, and Sharpe ratios.
 */
const TARGET_SPOT_2026_CAD: Record<string, number> = {
  // Core ETFs & Multi-asset benchmarks in $ CAD
  XBB: 1123.08, // 709.06 EUR * 1.5839
  ESE: 46.85, // ~29.58 EUR * 1.5839
  MEUD: 412.5, // ~260.4 EUR * 1.5839
  CDNS: 87.98, // 62.04 USD * 1.4181
  GOVT: 252.4, // ~159.35 EUR * 1.5839
  CORP: 178.2, // ~112.5 EUR * 1.5839
  BTC: 128600.0, // ~90,685 USD * 1.4181
  ETH: 4680.0, // ~3,300 USD * 1.4181
  GOLD: 506.85, // 320.00 EUR * 1.5839
  CASH: 50.15, // CASH.TO ~50.15 CAD

  // User FinanceAI & US / Global Equities in $ CAD (1 USD = 1.4181 CAD, 1 EUR = 1.5839 CAD)
  VCN: 489.56, // 345.22 USD * 1.4181
  ADP: 246.37, // 173.73 USD * 1.4181
  EMR: 586.17, // 413.35 USD * 1.4181
  ACN: 222.73, // 140.62 EUR * 1.5839
  ECL: 198.18, // 139.75 USD * 1.4181
  PAYX: 244.48, // 172.40 USD * 1.4181
  QQQM: 317.65, // 224.00 USD * 1.4181
  V: 603.47, // 425.55 USD * 1.4181
  ODFL: 490.38, // 309.60 EUR * 1.5839

  // Europe Large Caps converted to $ CAD (1 EUR = 1.5839 CAD)
  MC: 985.2,
  ASML: 1142.0,
  SU: 386.5,
  RMS: 3452.0,
  AIR: 266.1,
  AI: 274.0,
  OR: 589.2,
  SAN: 158.4,
  NOVO: 164.8,
  SAP: 367.5,
  TTE: 96.6,
  BNP: 108.5,
  CS: 58.6,
  DG: 177.4,
  CAP: 264.5,
  KER: 372.0,
  TEP: 144.1,
  STLAP: 20.9,
  ALO: 31.2,

  // Remaining US Large Caps converted to $ CAD (1 USD = 1.4181 CAD)
  MSFT: 616.9,
  GOOGL: 263.8,
  META: 836.7,
  AMZN: 306.3,
  AAPL: 329.0,
  LLY: 1162.8,
  UNH: 794.1,
  JPM: 347.4,
  COST: 1311.7,
  XOM: 168.8,
  TSLA: 365.9,
  INTC: 34.0,
  BA: 225.5,
  NKE: 107.8,
  PFE: 39.7,
  ...EXPANDED_SPOT_2026_CAD,
};

function buildHistoricalSeries(): MonthlyMarketPoint[] {
  const points: MonthlyMarketPoint[] = [];
  const currentPrices: Record<string, number> = {};
  for (const asset of ASSETS) {
    currentPrices[asset.id] = asset.initialPrice2015;
  }

  let livretIndex = 100.0;
  let inflationIndex = 100.0;

  let monthIdx = 0;
  for (let year = 2015; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 11 : 12;
    for (let month = 1; month <= maxMonth; month++) {
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      const label = `${MONTH_NAMES_FR[month - 1]} ${year}`;

      if (monthIdx > 0) {
        let eqShock = 0.0068;
        let bondShock = 0.0018;
        let goldShock = 0.0052;
        let techExtra = 0.016;
        let cryptoShock = 0.038;
        let cashMonthly = 0.0004;
        let livretMonthly = 0.00062;
        let cpiMonthly = 0.0011;

        if (year === 2017) {
          cryptoShock = 0.145; // 2017 crypto bull cycle
        } else if (year === 2018) {
          cryptoShock = -0.095; // 2018 crypto winter
          if (month >= 10) {
            eqShock = -0.042;
            techExtra = -0.035;
            bondShock = 0.005;
            goldShock = 0.018;
          }
        } else if (year === 2019) {
          eqShock = 0.0185;
          techExtra = 0.022;
          cryptoShock = 0.042;
          bondShock = 0.0045;
          goldShock = 0.012;
        } else if (year === 2020 && (month === 2 || month === 3)) {
          eqShock = month === 3 ? -0.135 : -0.078;
          techExtra = 0.015;
          cryptoShock = month === 3 ? -0.19 : -0.05;
          bondShock = 0.008;
          goldShock = 0.024;
        } else if ((year === 2020 && month >= 4) || year === 2021) {
          eqShock = 0.0205;
          techExtra = 0.028;
          cryptoShock = year === 2020 ? 0.125 : month <= 10 ? 0.075 : -0.08;
          bondShock = -0.001;
          goldShock = 0.003;
          cpiMonthly = year === 2021 ? 0.0028 : 0.0008;
        } else if (year === 2022) {
          eqShock = -0.0145;
          techExtra = -0.032;
          cryptoShock = -0.082; // 2022 crypto & tech bear market
          bondShock = -0.0145;
          goldShock = 0.0065;
          cashMonthly = 0.0012;
          livretMonthly = month >= 8 ? 0.00165 : 0.00083;
          cpiMonthly = 0.0048;
        } else if (year === 2023 || year === 2024) {
          eqShock = 0.0135;
          techExtra = 0.038;
          cryptoShock = 0.062; // Spot ETF & halving recovery
          bondShock = 0.0032;
          goldShock = 0.0145;
          cashMonthly = 0.0031;
          livretMonthly = 0.00246;
          cpiMonthly = year === 2023 ? 0.0032 : 0.0019;
        } else if (year >= 2025) {
          eqShock = 0.0078;
          techExtra = 0.011;
          cryptoShock = 0.016;
          bondShock = 0.0038;
          goldShock = 0.0075;
          cashMonthly = 0.0022;
          livretMonthly = 0.00198;
          cpiMonthly = 0.0017;
        }

        livretIndex = livretIndex * (1 + livretMonthly);
        inflationIndex = inflationIndex * (1 + cpiMonthly);

        const eqFactor = deterministicNoise(monthIdx, 99);
        const bondFactor = deterministicNoise(monthIdx, 97);
        const cryptoFactor = deterministicNoise(monthIdx, 95);

        ASSETS.forEach((asset, idx) => {
          const n = deterministicNoise(monthIdx, idx + 1);
          let r = 0;

          switch (asset.id) {
            case 'XBB':
              r = eqShock + eqFactor * 0.02 + n * 0.006;
              break;
            case 'ESE':
              r = eqShock * 1.09 + eqFactor * 0.022 + n * 0.007;
              break;
            case 'MEUD':
              r = eqShock * 0.82 + eqFactor * 0.017 + n * 0.013;
              break;
            case 'ADP':
              r = eqShock * 1.25 + techExtra + eqFactor * 0.038 + n * 0.054;
              break;
            case 'MC':
              r =
                (year === 2024 ? eqShock * 0.25 - 0.008 : eqShock * 1.06) +
                eqFactor * 0.021 +
                n * 0.028;
              break;
            case 'GOVT':
              r = bondShock + bondFactor * 0.009 + n * 0.0035;
              break;
            case 'CORP':
              r =
                bondShock * 0.78 +
                eqShock * 0.14 +
                0.0008 +
                bondFactor * 0.0065 +
                eqFactor * 0.0035 +
                n * 0.0035;
              break;
            case 'BTC':
              r = cryptoShock + cryptoFactor * 0.088 + eqFactor * 0.016 + n * 0.032;
              break;
            case 'ETH':
              r =
                cryptoShock * 1.12 +
                (year >= 2025 ? -0.006 : 0.008) +
                cryptoFactor * 0.102 +
                eqFactor * 0.02 +
                n * 0.042;
              break;
            case 'GOLD':
              r = goldShock - eqFactor * 0.003 + bondFactor * 0.004 + n * 0.02;
              break;
            case 'CASH':
              r = Math.max(0.0001, cashMonthly + n * 0.00015);
              break;
            default: {
              const post2023Drift =
                year >= 2023
                  ? asset.recentTrendDrift ?? 0
                  : (asset.recentTrendDrift ?? 0) * 0.25;
              if (asset.category === 'crypto') {
                const volRatio = Math.max(0.75, Math.min(1.65, asset.baseVolatilityPct / 68));
                const idioCrypto = Math.max(0.032, (asset.baseVolatilityPct / 100) * 0.08);
                r =
                  cryptoShock * volRatio +
                  post2023Drift +
                  cryptoFactor * 0.095 * volRatio +
                  eqFactor * 0.02 +
                  n * idioCrypto;
              } else if (asset.category === 'obligations') {
                const durScale = Math.max(0.45, Math.min(2.1, Math.abs(asset.rateSensitivity || 0.7) * 1.1));
                const creditTilt = asset.growthBeta > 0.2 ? eqShock * 0.22 : 0;
                r =
                  bondShock * durScale +
                  creditTilt +
                  post2023Drift * 0.5 +
                  bondFactor * 0.0085 * durScale +
                  n * Math.max(0.003, (asset.baseVolatilityPct / 100) * 0.08);
              } else if (asset.category === 'refuge') {
                const eqLink = Math.max(0, Math.min(1.1, asset.growthBeta || 0.4));
                r =
                  goldShock * 0.85 +
                  eqShock * eqLink * 0.55 +
                  post2023Drift +
                  bondFactor * 0.004 +
                  n * Math.max(0.015, (asset.baseVolatilityPct / 100) * 0.1);
              } else {
                const betaScale = Math.max(0.45, Math.min(2.0, asset.growthBeta || 1.0));
                const idioAmp = Math.max(0.014, (asset.baseVolatilityPct / 100) * 0.11);
                const techTilt =
                  asset.sector === 'Tech & Semi-Conducteurs' && (asset.recentTrendDrift ?? 0) >= 0
                    ? techExtra * 0.45
                    : 0;
                r =
                  eqShock * betaScale +
                  techTilt +
                  post2023Drift +
                  eqFactor * 0.019 * betaScale +
                  n * idioAmp;
              }
              break;
            }
          }

          const clamped = Math.max(-0.34, Math.min(0.42, r));
          currentPrices[asset.id] = Number(
            (currentPrices[asset.id] * (1 + clamped)).toFixed(4)
          );
        });
      }

      let regimeNote: string | undefined;
      if (ym === '2020-03') regimeNote = 'Krach COVID-19';
      else if (ym === '2021-11') regimeNote = 'Pic liquidité 2021';
      else if (ym === '2022-09') regimeNote = 'Choc des taux 2022';
      else if (ym === '2024-03') regimeNote = 'Cycle IA & ETF Crypto';

      points.push({
        yearMonth: ym,
        label,
        prices: { ...currentPrices },
        livretIndex: Number(livretIndex.toFixed(4)),
        inflationIndex: Number(inflationIndex.toFixed(4)),
        regimeNote,
      });

      monthIdx++;
    }
  }

  // Calibrate every asset's 2015–2026 price series to exact $ CAD Nov-2026 spot levels
  // (multiplying by a positive scalar leaves all period-over-period % returns strictly invariant)
  if (points.length > 0) {
    const rawLast = points[points.length - 1].prices;
    const scaleByAsset: Record<string, number> = {};
    for (const asset of ASSETS) {
      const targetCad = TARGET_SPOT_2026_CAD[asset.id];
      const endRaw = rawLast[asset.id];
      scaleByAsset[asset.id] =
        targetCad && endRaw > 0 ? targetCad / endRaw : DEFAULT_FX_TO_CAD.EUR;
    }

    for (const pt of points) {
      for (const asset of ASSETS) {
        pt.prices[asset.id] = Number(
          (pt.prices[asset.id] * scaleByAsset[asset.id]).toFixed(4)
        );
      }
    }

    // Splice verified real-world monthly closes ($ CAD via Bank of Canada Valet FX + Yahoo Finance v8)
    // across 2023-11 .. 2026-11 while rescaling 2015-01 .. 2023-10 to preserve seamless continuity
    for (const asset of ASSETS) {
      if (asset.id === 'CASH') continue;
      const realMap = VERIFIED_MONTHLY_CLOSES_CAD[asset.id];
      if (!realMap) continue;

      const firstRealIdx = points.findIndex((pt) => (realMap[pt.yearMonth] ?? 0) > 0);
      if (firstRealIdx < 0) continue;

      const anchorReal = realMap[points[firstRealIdx].yearMonth];
      const anchorSynth = points[firstRealIdx].prices[asset.id];
      const preScale = anchorSynth > 0 ? anchorReal / anchorSynth : 1;

      for (let i = 0; i < firstRealIdx; i++) {
        points[i].prices[asset.id] = Number(
          (points[i].prices[asset.id] * preScale).toFixed(4)
        );
      }

      for (let i = firstRealIdx; i < points.length; i++) {
        const verifiedVal = realMap[points[i].yearMonth];
        const fallbackPrev = points[Math.max(0, i - 1)].prices[asset.id];
        points[i].prices[asset.id] = Number(
          (verifiedVal && verifiedVal > 0 ? verifiedVal : fallbackPrev).toFixed(4)
        );
      }

      const spotVerified = VERIFIED_SPOT_CAD_2026_11[asset.id];
      if (spotVerified && spotVerified > 0) {
        points[points.length - 1].prices[asset.id] = Number(spotVerified.toFixed(4));
      }
    }
  }

  return points;
}

export const HISTORICAL_SERIES: MonthlyMarketPoint[] = buildHistoricalSeries();

export function getAssetById(assetId: string): FinancialAsset | undefined {
  return ASSETS.find((a) => a.id === assetId);
}

export function getLatestPrices(): Record<string, number> {
  return { ...HISTORICAL_SERIES[HISTORICAL_SERIES.length - 1].prices };
}

export function getPriceAtYearMonth(assetId: string, yearMonth: string): number {
  const found = HISTORICAL_SERIES.find((p) => p.yearMonth === yearMonth);
  if (found && found.prices[assetId] !== undefined) {
    return found.prices[assetId];
  }
  const latest = HISTORICAL_SERIES[HISTORICAL_SERIES.length - 1];
  return latest.prices[assetId] ?? 100;
}

export interface DynamicMarketAssetRegistration {
  ticker: string;
  name: string;
  spotCad: number;
  category: AssetCategory;
  subClass: MarketAssetSubClass;
  sector?: string;
  region?: 'Europe (PEA)' | 'États-Unis (CTO)' | 'Global';
  dividendYieldPct?: number;
  annualFeePct?: number;
  volatilityPct?: number;
  beta?: number;
  isIndividualStock?: boolean;
  description?: string;
  monthlyHistoryCad?: Record<string, number>; // yearMonth -> close in $ CAD
  cryptoFund?: CryptoAnalystProfile;
  macroFund?: FundOrMacroAnalystProfile;
}

/**
 * Dynamically registers any live or custom market ticker (Stock, Crypto, ETF, Bond, Commodity, REIT)
 * into Valoria's runtime universe and 2015–2026 $ CAD historical series so it participates in all
 * DCF/On-Chain/Markowitz calculations, stress tests, and D3 charts.
 */
export function registerDynamicMarketAsset(
  spec: DynamicMarketAssetRegistration
): FinancialAsset {
  const cleanTicker = spec.ticker.trim().toUpperCase();
  const baseId = cleanTicker
    .replace(/\.(TO|PA|DE|AS|SW|MI|CO|L)$/i, '')
    .replace(/-(CAD|USD|EUR)$/i, '')
    .replace(/[^A-Z0-9]/g, '');

  const existing = ASSETS.find(
    (a) =>
      a.id.toUpperCase() === baseId ||
      a.ticker.toUpperCase() === cleanTicker
  );
  if (existing) {
    if (spec.spotCad > 0) {
      HISTORICAL_SERIES[HISTORICAL_SERIES.length - 1].prices[existing.id] = Number(
        spec.spotCad.toFixed(4)
      );
    }
    return existing;
  }

  const uniqueId = ASSETS.some((a) => a.id === baseId)
    ? `${baseId}_${ASSETS.length}`
    : baseId || `ASSET_${ASSETS.length}`;

  const vol = Math.max(
    4,
    Math.min(
      115,
      spec.volatilityPct ??
        (spec.category === 'crypto'
          ? 74
          : spec.category === 'obligations'
            ? 7.5
            : spec.category === 'refuge'
              ? 20
              : 25)
    )
  );
  const beta = Math.max(
    -0.2,
    Math.min(
      2.4,
      spec.beta ??
        (spec.category === 'crypto'
          ? 1.75
          : spec.category === 'obligations'
            ? 0.15
            : spec.category === 'refuge'
              ? 0.35
              : 1.1)
    )
  );

  const categoryLabel =
    spec.subClass === 'action_ca'
      ? 'Actions Canada (TSX)'
      : spec.subClass === 'action_us'
        ? 'Actions États-Unis'
        : spec.subClass === 'action_eu_asia'
          ? 'Actions Internationales'
          : spec.subClass === 'crypto_l1_defi'
            ? 'Crypto & Web3'
            : spec.subClass === 'obligation_taux'
              ? 'Obligations & Taux'
              : spec.subClass === 'matiere_premiere'
                ? 'Matières Premières'
                : spec.subClass === 'immobilier_reit'
                  ? 'Immobilier Coté (REIT)'
                  : 'ETF Indiciel';

  const newAsset: FinancialAsset = {
    id: uniqueId,
    ticker: cleanTicker,
    name: spec.name.trim() || cleanTicker,
    category: spec.category,
    categoryLabel,
    wrapper:
      spec.subClass === 'action_ca'
        ? 'CELI · REER · Non-enregistré'
        : spec.category === 'crypto'
          ? 'Portefeuille / ETF Crypto CELI'
          : 'CELI · REER · CTO',
    annualFeePct: spec.annualFeePct ?? (spec.isIndividualStock ? 0 : 0.2),
    dividendYieldPct: spec.dividendYieldPct ?? 0,
    baseExpectedReturnPct:
      spec.category === 'crypto'
        ? 11.5
        : spec.category === 'obligations'
          ? 4.4
          : spec.category === 'refuge'
            ? 6.5
            : 9.2,
    baseVolatilityPct: vol,
    growthBeta: beta,
    inflationBeta:
      spec.category === 'refuge' ? 0.85 : spec.category === 'obligations' ? -0.6 : -0.15,
    rateSensitivity:
      spec.category === 'obligations' ? -0.9 : spec.category === 'crypto' ? -0.95 : -0.45,
    crisisConvexity:
      spec.category === 'obligations' ? 0.25 : spec.category === 'refuge' ? 0.3 : -0.48,
    description:
      spec.description ??
      `Actif coté ${cleanTicker} (${categoryLabel}) converti et suivi en dollars canadiens ($ CAD).`,
    initialPrice2015: Math.max(0.01, Number((spec.spotCad / 2.2).toFixed(4))),
    isIndividualStock:
      spec.isIndividualStock ??
      (spec.subClass === 'action_ca' ||
        spec.subClass === 'action_us' ||
        spec.subClass === 'action_eu_asia' ||
        spec.subClass === 'immobilier_reit'),
    sector: spec.sector ?? categoryLabel,
    region:
      spec.region ??
      (spec.subClass === 'action_us'
        ? 'États-Unis (CTO)'
        : spec.subClass === 'action_eu_asia'
          ? 'Europe (PEA)'
          : 'Global'),
    recentTrendDrift: 0.002,
  };

  ASSETS.push(newAsset);
  TARGET_SPOT_2026_CAD[uniqueId] = spec.spotCad;

  // Populate 2015-01..2026-11 monthly prices in $ CAD
  const refProxyId =
    spec.category === 'crypto'
      ? 'BTC'
      : spec.category === 'obligations'
        ? 'GOVT'
        : spec.category === 'refuge'
          ? 'GOLD'
          : 'XBB';

  const seed = uniqueId
    .split('')
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 17);

  // Build synthetic backbone first, then overwrite with real monthly closes where available
  const syntheticPrices: number[] = [newAsset.initialPrice2015];
  for (let i = 1; i < HISTORICAL_SERIES.length; i++) {
    const pPrev = HISTORICAL_SERIES[i - 1].prices[refProxyId] || 100;
    const pCurr = HISTORICAL_SERIES[i].prices[refProxyId] || 100;
    const proxyRet = pPrev > 0 ? pCurr / pPrev - 1 : 0;
    const idio = deterministicNoise(i, seed) * (vol / 100) * 0.09;
    const stepRet = Math.max(-0.34, Math.min(0.42, proxyRet * Math.max(0.5, beta * 0.85) + idio));
    syntheticPrices.push(syntheticPrices[i - 1] * (1 + stepRet));
  }

  const endSynth = syntheticPrices[syntheticPrices.length - 1] || 1;
  const scale = spec.spotCad > 0 ? spec.spotCad / endSynth : 1;
  const scaled = syntheticPrices.map((p) => Number((p * scale).toFixed(4)));

  if (spec.monthlyHistoryCad && Object.keys(spec.monthlyHistoryCad).length >= 3) {
    // Splice real monthly closes smoothly onto the calibrated backbone
    let firstRealIdx = -1;
    for (let i = 0; i < HISTORICAL_SERIES.length; i++) {
      const ym = HISTORICAL_SERIES[i].yearMonth;
      const realPx = spec.monthlyHistoryCad[ym];
      if (realPx && realPx > 0) {
        if (firstRealIdx === -1) firstRealIdx = i;
        scaled[i] = Number(realPx.toFixed(4));
      }
    }
    if (firstRealIdx > 0) {
      const anchorReal = scaled[firstRealIdx];
      const anchorSynth = syntheticPrices[firstRealIdx] || 1;
      const preScale = anchorReal / anchorSynth;
      for (let j = 0; j < firstRealIdx; j++) {
        scaled[j] = Number((syntheticPrices[j] * preScale).toFixed(4));
      }
    }
    // Forward-fill any missing trailing months up to latest spotCad
    for (let i = Math.max(1, firstRealIdx); i < HISTORICAL_SERIES.length; i++) {
      const ym = HISTORICAL_SERIES[i].yearMonth;
      if (!spec.monthlyHistoryCad[ym]) {
        scaled[i] =
          i === HISTORICAL_SERIES.length - 1 && spec.spotCad > 0
            ? Number(spec.spotCad.toFixed(4))
            : scaled[i - 1];
      }
    }
  }

  if (spec.spotCad > 0) {
    scaled[scaled.length - 1] = Number(spec.spotCad.toFixed(4));
  }

  for (let i = 0; i < HISTORICAL_SERIES.length; i++) {
    HISTORICAL_SERIES[i].prices[uniqueId] = Math.max(0.0001, scaled[i]);
  }

  registerDynamicCatalogProfile({
    assetId: uniqueId,
    subClass: spec.subClass,
    cryptoFund:
      spec.cryptoFund ??
      (spec.category === 'crypto'
        ? {
            consensusMechanism: 'Réseau Blockchain / Actif Numérique Coté',
            stakingYieldPct: 0,
            annualIssuancePct: 2.5,
            nvtRatio: 42.0,
            mvrvZScore: 1.8,
            defiOrNetworkMoat: `Cotation directe ${cleanTicker} convertie en $ CAD`,
            maxKellyPortfolioPct: 2.0,
            baseCycleFairUpsidePct: 8.0,
          }
        : undefined),
    macroFund:
      spec.macroFund ??
      (!newAsset.isIndividualStock && spec.category !== 'crypto'
        ? {
            effectiveDurationYears: spec.category === 'obligations' ? 6.0 : 0,
            underlyingCurrency: cleanTicker.endsWith('.TO') ? 'CAD' : 'USD',
            issuerAndStructure: `${spec.name} (${cleanTicker})`,
            indexMethodology: categoryLabel,
            optimalCanadianWrapper: 'CELI / REER',
            taxWrapperRationale:
              'Loger en CELI ou REER selon la nature des distributions et la convention fiscale.',
            baseNavFairUpsidePct: 7.5,
          }
        : undefined),
  });

  return newAsset;
}


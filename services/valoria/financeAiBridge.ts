import {
  ASSETS,
  DEFAULT_FX_TO_CAD,
  type FinancialAsset,
  HISTORICAL_SERIES,
  type MacroIndicators,
  type RiskProfile,
  registerDynamicMarketAsset,
} from './marketData';
import type { PortfolioLot, PortfolioSummary } from './engine';
import type { EquityQuantAnalysis, EquityUniverseSummary } from './equityQuantEngine';
import type { PortfolioRiskMetrics } from './quantAnalytics';

export interface FinanceAIBudgetSync {
  monthlyIncomeEur: number; // Stocké en $ CAD (nom historique conservé pour compatibilité props)
  monthlyExpensesEur: number; // Stocké en $ CAD
  monthlySavingsCapacityEur: number; // Stocké en $ CAD
  emergencyFundEur?: number; // Stocké en $ CAD
}

interface FinanceAICompactionStats {
  wasCompacted: boolean;
  originalBytes: number;
  compactBytes: number;
  strippedTransactionsCount: number;
  strippedPriceHistoryPoints: number;
  detectedVersion?: string;
  baseCurrency?: string;
  appliedFxSummary?: string;
}

export interface FinanceAIImportResult {
  sourceFormat: 'financeai_json' | 'csv' | 'quick_lines';
  importedLots: Omit<PortfolioLot, 'id'>[];
  unmatchedSymbols: string[];
  budgetSync: FinanceAIBudgetSync | null;
  detectedRiskProfile: RiskProfile | null;
  watchlistAssetIds: string[];
  compactionStats?: FinanceAICompactionStats;
  compactPreviewJson?: string;
}

export interface FinanceAIExportPayload {
  schema: 'FinanceAI-Valoria-Bridge/v1.3-CAD';
  currency: 'CAD';
  exportedAt: string;
  sourceApp: 'Valoria Quant Engine';
  targetApp: 'FinanceAI';
  investorProfile: {
    riskProfile: RiskProfile;
    monthlySavingsCapacityEur: number;
    monthlySavingsCapacityCad: number;
  };
  portfolioMetrics: {
    totalValueEur: number;
    totalValueCad: number;
    totalInvestedEur: number;
    totalInvestedCad: number;
    unrealizedPnlEur: number;
    unrealizedPnlCad: number;
    sharpeRatio: number;
    sortinoRatio: number;
    monthlyVar95Eur: number;
    monthlyVar95Cad: number;
    betaVsWorld: number;
  };
  positions: {
    assetId: string;
    ticker: string;
    name: string;
    category: string;
    wrapper: string;
    investedEur: number;
    investedCad: number;
    currentValueEur: number;
    currentValueCad: number;
    weightPct: number;
    quantSignal?: string;
    quantScore?: number;
  }[];
  tacticalSignals: {
    buyNow: {
      ticker: string;
      name: string;
      wrapper: string;
      signal: string;
      quantScore: number;
      spotEur: number;
      spotCad: number;
      target12mEur: number;
      target12mCad: number;
      stopLossEur: number;
      stopLossCad: number;
      upsidePct: number;
      catalyst: string;
    }[];
    sellOrTrimNow: {
      ticker: string;
      name: string;
      signal: string;
      quantScore: number;
      spotEur: number;
      spotCad: number;
      fairValueDcfEur: number;
      fairValueDcfCad: number;
      downsideRiskPct: number;
      reason: string;
    }[];
  };
}

/**
 * Exemple synthétique Bac à Sable uniquement (aucune donnée personnelle ni position réelle).
 * Sert exclusivement de gabarit de démonstration pour l'import manuel du pont JSON.
 */
export const SAMPLE_FINANCEAI_JSON = JSON.stringify(
  {
    app: 'FinanceAI',
    version: '4.0',
    fxRates: {
      CAD: 1,
      USD: 1.4181,
      EUR: 1.5839,
    },
    profile: {
      riskTolerance: 'dynamique',
      monthlyIncome: 6800,
      monthlyExpenses: 4200,
      monthlySavingsCapacity: 2600,
      emergencyFund: 18000,
    },
    positions: [
      { ticker: 'XEQT.TO', quantity: 500, buyPrice: 28.0, currentPrice: 34.5, currency: 'CAD', purchaseDate: '2024-01-15' },
      { ticker: 'ESE.PA', quantity: 40, buyPrice: 24.0, currentPrice: 29.58, currency: 'EUR', purchaseDate: '2024-02-10' },
      { ticker: 'RY.TO', quantity: 30, buyPrice: 135.0, currentPrice: 170.0, currency: 'CAD', purchaseDate: '2024-04-08' },
      { ticker: 'MSFT', quantity: 12, buyPrice: 380.0, currentPrice: 435.0, currency: 'USD', purchaseDate: '2024-05-20' },
      { ticker: 'GOOGL', quantity: 20, buyPrice: 155.0, currentPrice: 186.0, currency: 'USD', purchaseDate: '2024-07-12' },
      { ticker: 'TEP.PA', quantity: 14, buyPrice: 112.0, currentPrice: 91.0, currency: 'EUR', purchaseDate: '2024-06-15' },
      { ticker: 'INTC', quantity: 60, buyPrice: 31.5, currentPrice: 24.0, currency: 'USD', purchaseDate: '2024-03-10' },
    ],
    watchlist: ['AAPL', 'MSFT', 'GOOGL', 'RY.TO', 'XEQT.TO'],
  },
  null,
  2
);

const ALIAS_MAP: Record<string, string> = {
  MSCIWORLD: 'XBB',
  AMUNDIWORLD: 'XBB',
  AMMSCIWORLD: 'XBB',
  XEQT: 'XBB',
  XEQTTO: 'XBB',
  VEQT: 'XBB',
  VEQTTO: 'XBB',
  IWDA: 'XBB',
  VWCE: 'XBB',
  WPEA: 'XBB',
  DCAM: 'XBB',
  URTH: 'XBB',
  VT: 'XBB',
  SP500: 'ESE',
  SPY: 'ESE',
  VOO: 'ESE',
  IVV: 'ESE',
  VFV: 'ESE',
  VFVTO: 'ESE',
  ZSP: 'ESE',
  ZSPTO: 'ESE',
  QQQ: 'ESE',
  STOXX600: 'MEUD',
  ZEQT: 'CDNS',
  AASU: 'CDNS',
  AASUSW: 'CDNS',
  CDNS: 'CDNS',
  PAASIPA: 'CDNS',
  EMASIA: 'CDNS',
  AMUNDIMSCIEMASIA: 'CDNS',
  LVMH: 'MC',
  HERMES: 'RMS',
  SCHNEIDER: 'SU',
  ROK: 'ODFL',
  SAFRANSA: 'ODFL',
  AIRBUS: 'AIR',
  AIRLIQUIDE: 'AI',
  LOREAL: 'OR',
  SANOFI: 'SAN',
  NOVONORDISK: 'NOVO',
  TOTAL: 'TTE',
  TOTALENERGIES: 'TTE',
  BNPPARIBAS: 'BNP',
  AXA: 'CS',
  VINCI: 'DG',
  CAPGEMINI: 'CAP',
  KERING: 'KER',
  TELEPERFORMANCE: 'TEP',
  STELLANTIS: 'STLAP',
  ALSTOM: 'ALO',
  SNPS: 'ADP',
  NVIDIACORP: 'ADP',
  MICROSOFT: 'MSFT',
  ALPHABET: 'GOOGL',
  GOOGLE: 'GOOGL',
  AMAZON: 'AMZN',
  ZCN: 'VCN',
  BROADCOMINC: 'VCN',
  APPLE: 'AAPL',
  ELILILLY: 'LLY',
  UNITEDHEALTH: 'UNH',
  JPMORGAN: 'JPM',
  VISA: 'V',
  VISATO: 'V',
  VISAINC: 'V',
  VISAINCCDR: 'V',
  COSTCO: 'COST',
  EXXON: 'XOM',
  TESLA: 'TSLA',
  INTEL: 'INTC',
  BOEING: 'BA',
  NIKE: 'NKE',
  PFIZER: 'PFE',
  EMR: 'EMR',
  TSMC: 'EMR',
  TAIWANSEMICONDUCTOR: 'EMR',
  DHR: 'ACN',
  ACN: 'ACN',
  KLATG: 'ACN',
  KLADE: 'ACN',
  KLACORP: 'ACN',
  PAYX: 'PAYX',
  CTAS: 'PAYX',
  PALANTIRTECHNOLOGIES: 'PAYX',
  QQQM: 'QQQM',
  ZLB: 'QQQM',
  HOWMETAEROSPACE: 'QQQM',
  ECL: 'ECL',
  SPACEX: 'ECL',
  SPACEEXPLORATION: 'ECL',
  BITCOIN: 'BTC',
  BTCUSD: 'BTC',
  BTCCAD: 'BTC',
  BTCEUR: 'BTC',
  ETHEREUM: 'ETH',
  ETHUSD: 'ETH',
  ETHCAD: 'ETH',
  ETHEUR: 'ETH',
  ORPHYSIQUE: 'GOLD',
  XETRAGOLD: 'GOLD',
  ZWB: 'GOLD',
  GBSPA: 'GOLD',
  GBSMI: 'GOLD',
  GLD: 'GOLD',
  IAU: 'GOLD',
  GOLDBULLION: 'GOLD',
  GOLDBULLIONSECURITIES: 'GOLD',
  MONETAIRE: 'CASH',
  CASHTO: 'CASH',
  CSH2: 'CASH',
  CSH2PA: 'CASH',
  SOLANA: 'SOL',
  SOLUSD: 'SOL',
  SOLCAD: 'SOL',
  CHAINLINK: 'LINK',
  LINKUSD: 'LINK',
  AAVEUSD: 'AAVE',
  RIPPLE: 'XRP',
  XRPUSD: 'XRP',
  CARDANO: 'ADA',
  ADAUSD: 'ADA',
  DOGECOIN: 'DOGE',
  DOGEUSD: 'DOGE',
  AVALANCHE: 'AVAX',
  AVAXUSD: 'AVAX',
  BITTENSOR: 'TAO',
  TAOUSD: 'TAO',
  ROYALBANK: 'RY',
  BANQUEROYALE: 'RY',
  TORONTODOMINION: 'TD',
  BANQUENATIONALE: 'NA',
  NATIONALBANK: 'NA',
  SHOPIFY: 'SHOP',
  CONSTELLATIONSOFTWARE: 'CSU',
  BROOKFIELD: 'BN',
  COUCHETARD: 'ATD',
  DOLLARAMA: 'DOL',
  ENBRIDGE: 'ENB',
  CAMECO: 'CCO',
  URANIUM: 'HURA',
  SILVER: 'SLV',
  COPPER: 'COPX',
};

function matchSingleSymbol(rawSymbol: string): FinancialAsset | undefined {
  const cleaned = rawSymbol.trim().toUpperCase();
  if (!cleaned) return undefined;

  const direct = ASSETS.find(
    (a) =>
      a.id.toUpperCase() === cleaned ||
      a.ticker.toUpperCase() === cleaned ||
      a.ticker.split('.')[0].toUpperCase() === cleaned ||
      a.ticker.replace(/-(EUR|CAD|USD)$/, '').toUpperCase() === cleaned
  );
  if (direct) return direct;

  const alphaOnly = cleaned.replace(/[^A-Z0-9]/g, '');
  if (!alphaOnly) return undefined;

  const mappedId = ALIAS_MAP[alphaOnly];
  if (mappedId) {
    return ASSETS.find((a) => a.id === mappedId);
  }

  // Essayer la racine du ticker avant suffixe (.PA, .TO, .TG, .DE, .AS, .SW, .MI)
  const beforeDot = cleaned.split('.')[0].replace(/[^A-Z0-9]/g, '');
  if (beforeDot && ALIAS_MAP[beforeDot]) {
    return ASSETS.find((a) => a.id === ALIAS_MAP[beforeDot]);
  }

  // Correspondance floue sur le nom (>= 4 caractères pour éviter les faux positifs)
  if (alphaOnly.length >= 4) {
    for (const [aliasKey, targetId] of Object.entries(ALIAS_MAP)) {
      if (aliasKey.length >= 5 && alphaOnly.includes(aliasKey)) {
        return ASSETS.find((a) => a.id === targetId);
      }
    }
    return ASSETS.find((a) =>
      a.name.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(alphaOnly)
    );
  }

  return undefined;
}

/**
 * Résout un symbole ou libellé FinanceAI vers un actif du catalogue Valoria.
 */
export function resolveFinanceAISymbol(
  rawSymbol: string,
  fallbackSymbol?: string,
  fallbackName?: string
): FinancialAsset | undefined {
  return (
    matchSingleSymbol(rawSymbol) ??
    (fallbackSymbol ? matchSingleSymbol(fallbackSymbol) : undefined) ??
    (fallbackName ? matchSingleSymbol(fallbackName) : undefined)
  );
}

/**
 * Retourne le multiplicateur de change exact vers le dollar canadien ($ CAD),
 * en lisant la table `fxRates` de FinanceAI lorsqu'elle est fournie et en
 * retombant sur `DEFAULT_FX_TO_CAD` si absent ou non fini.
 */
function getFxMultiplierToCad(
  currency: unknown,
  fxRates?: Record<string, unknown>
): number {
  const curr =
    typeof currency === 'string' && currency.trim()
      ? currency.trim().toUpperCase()
      : 'CAD';

  if (curr === 'CAD' || curr === 'CA$' || curr === '$CAD') return 1;

  if (fxRates && typeof fxRates === 'object') {
    const cadRate = Number(fxRates.CAD ?? 0);
    const currRate = Number(fxRates[curr] ?? 0);

    // Convention FinanceAI v4.0 : 1 unité de `curr` = `currRate` CAD, 1 CAD = `cadRate`
    if (Number.isFinite(cadRate) && Number.isFinite(currRate) && cadRate > 0 && currRate > 0) {
      return currRate / cadRate;
    }

    const eurRate = Number(fxRates.EUR ?? 0);
    if (Number.isFinite(eurRate) && Number.isFinite(currRate) && eurRate > 0 && currRate > 0) {
      return (currRate / eurRate) * DEFAULT_FX_TO_CAD.EUR;
    }
    const usdRate = Number(fxRates.USD ?? 0);
    if (Number.isFinite(usdRate) && Number.isFinite(currRate) && usdRate > 0 && currRate > 0) {
      return (currRate / usdRate) * DEFAULT_FX_TO_CAD.USD;
    }
  }

  return DEFAULT_FX_TO_CAD[curr] ?? 1;
}

/**
 * Convertit un montant en devise native vers le dollar canadien ($ CAD).
 */
function convertFinanceAIAmountToCad(
  amount: number,
  currency: unknown,
  fxRates?: Record<string, unknown>
): number {
  if (!Number.isFinite(amount) || amount === 0) return 0;
  return amount * getFxMultiplierToCad(currency, fxRates);
}

function detectBaseCurrency(fxRates?: Record<string, unknown>): string {
  if (!fxRates || typeof fxRates !== 'object') return 'CAD';
  if (Number(fxRates.CAD) === 1) return 'CAD';
  if (Number(fxRates.USD) === 1) return 'USD';
  if (Number(fxRates.EUR) === 1) return 'EUR';
  return 'CAD';
}

function buildFxSummaryLabel(fxRates?: Record<string, unknown>): string {
  const usdCad = getFxMultiplierToCad('USD', fxRates);
  const eurCad = getFxMultiplierToCad('EUR', fxRates);
  return `1 USD = ${usdCad.toFixed(4).replace('.', ',')} CAD · 1 EUR = ${eurCad.toFixed(4).replace('.', ',')} CAD`;
}

function summarizeRecentTransactions(
  transactions: unknown[],
  baseCurrency: string
): {
  transactionCount: number;
  monthlyIncomeNative: number;
  monthlyExpensesNative: number;
  currency: string;
} | null {
  if (!Array.isArray(transactions) || transactions.length === 0) return null;

  const byMonth = new Map<string, { inc: number; exp: number }>();
  for (const item of transactions) {
    if (!item || typeof item !== 'object') continue;
    const tx = item as Record<string, unknown>;
    if (tx.isTransfer === true || tx.isDuplicate === true) continue;
    const cat = String(tx.category ?? '').toLowerCase();
    if (cat === 'transfert' || cat === 'transfer' || cat === 'virement') continue;

    const amt = Number(tx.amount ?? 0);
    if (!Number.isFinite(amt) || amt === 0) continue;

    const ym = String(tx.date ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;

    const bucket = byMonth.get(ym) ?? { inc: 0, exp: 0 };
    if (amt > 0) bucket.inc += amt;
    else bucket.exp += Math.abs(amt);
    byMonth.set(ym, bucket);
  }

  const sortedMonths = Array.from(byMonth.keys()).sort();
  const completeMonths =
    sortedMonths.length >= 3 ? sortedMonths.slice(0, -1) : sortedMonths;
  const recentMonths = completeMonths.slice(-6);
  if (recentMonths.length === 0) return null;

  const avgInc =
    recentMonths.reduce((s, m) => s + (byMonth.get(m)?.inc ?? 0), 0) /
    recentMonths.length;
  const avgExp =
    recentMonths.reduce((s, m) => s + (byMonth.get(m)?.exp ?? 0), 0) /
    recentMonths.length;

  return {
    transactionCount: transactions.length,
    monthlyIncomeNative: Math.round(avgInc),
    monthlyExpensesNative: Math.round(avgExp),
    currency: baseCurrency,
  };
}

function unwrapFinanceAIRootState(parsed: unknown): {
  outer: Record<string, unknown>;
  stateObj: Record<string, unknown>;
  detectedVersion?: string;
  fxRates?: Record<string, unknown>;
  baseCurrency: string;
  rawList: unknown[] | null;
} {
  if (Array.isArray(parsed)) {
    return {
      outer: { positions: parsed },
      stateObj: { positions: parsed },
      baseCurrency: 'CAD',
      rawList: parsed,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      outer: {},
      stateObj: {},
      baseCurrency: 'CAD',
      rawList: null,
    };
  }

  let outer = parsed as Record<string, unknown>;
  if (outer.payload && typeof outer.payload === 'object' && !Array.isArray(outer.payload)) {
    outer = outer.payload as Record<string, unknown>;
  }

  const detectedVersion =
    typeof outer.version === 'string' ? outer.version : undefined;

  let stateObj: Record<string, unknown> = outer;
  if (
    outer.store &&
    typeof outer.store === 'object' &&
    (outer.store as Record<string, unknown>).state &&
    typeof (outer.store as Record<string, unknown>).state === 'object'
  ) {
    stateObj = (outer.store as Record<string, unknown>).state as Record<string, unknown>;
  } else if (
    outer.state &&
    typeof outer.state === 'object' &&
    !Array.isArray(outer.state)
  ) {
    stateObj = outer.state as Record<string, unknown>;
  }

  const fxRates =
    (stateObj.fxRates as Record<string, unknown> | undefined) ??
    (outer.fxRates as Record<string, unknown> | undefined);
  const baseCurrency = detectBaseCurrency(fxRates);

  const rawList =
    (Array.isArray(stateObj.positions) && stateObj.positions) ||
    (Array.isArray(stateObj.holdings) && stateObj.holdings) ||
    (Array.isArray(stateObj.portfolio) && stateObj.portfolio) ||
    (Array.isArray(stateObj.lots) && stateObj.lots) ||
    (Array.isArray(stateObj.assets) && stateObj.assets) ||
    null;

  return {
    outer,
    stateObj,
    detectedVersion,
    fxRates,
    baseCurrency,
    rawList,
  };
}

/**
 * Déballe les sauvegardes imbriquées FinanceAI v4.0 (`{ version, store: { state } }`, `{ state }`, ou `{ payload }`)
 * et allège les journaux de transactions et historiques quotidiens en un JSON compact (< 5 Ko) pour l'aperçu UI.
 */
function compactFinanceAIObject(parsed: unknown): {
  compactObject: Record<string, unknown>;
  strippedTransactionsCount: number;
  strippedPriceHistoryPoints: number;
  detectedVersion?: string;
  baseCurrency: string;
} {
  if (Array.isArray(parsed)) {
    return {
      compactObject: { positions: parsed },
      strippedTransactionsCount: 0,
      strippedPriceHistoryPoints: 0,
      baseCurrency: 'CAD',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      compactObject: {},
      strippedTransactionsCount: 0,
      strippedPriceHistoryPoints: 0,
      baseCurrency: 'CAD',
    };
  }

  const { outer, stateObj, detectedVersion, fxRates, baseCurrency, rawList } =
    unwrapFinanceAIRootState(parsed);

  let strippedTransactionsCount = 0;
  let strippedPriceHistoryPoints = 0;

  const rawTx = Array.isArray(stateObj.transactions) ? stateObj.transactions : null;
  const cashflowSummary = rawTx
    ? summarizeRecentTransactions(rawTx, baseCurrency)
    : (stateObj.cashflowSummary as Record<string, unknown> | undefined) ?? null;
  if (rawTx) {
    strippedTransactionsCount = rawTx.length;
  }

  const compactAssets = rawList
    ? rawList.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const rec = item as Record<string, unknown>;
        if (Array.isArray(rec.priceHistory)) {
          strippedPriceHistoryPoints += rec.priceHistory.length;
        }
        const {
          priceHistory: _ph,
          purchases: _pur,
          owner: _own,
          lastHistorySync: _lhs,
          priceUpdatedAt: _pua,
          ...essential
        } = rec;
        return essential;
      })
    : undefined;

  const compactObject: Record<string, unknown> = {
    app: outer.app ?? 'FinanceAI',
    ...(detectedVersion ? { version: detectedVersion } : {}),
  };

  if (fxRates) compactObject.fxRates = fxRates;
  if (stateObj.profile) compactObject.profile = stateObj.profile;
  if (stateObj.investorProfile) compactObject.investorProfile = stateObj.investorProfile;
  if (stateObj.budget) compactObject.budget = stateObj.budget;
  if (stateObj.projection) {
    const proj = stateObj.projection as Record<string, unknown>;
    compactObject.projection = {
      years: proj.years,
      returnRate: proj.returnRate,
      inflationRate: proj.inflationRate,
      theoreticalIncome: proj.theoreticalIncome,
      theoreticalExpenses: proj.theoreticalExpenses,
      useTheoretical: proj.useTheoretical,
      manualContribution: proj.manualContribution,
      appliedReturnProfile: proj.appliedReturnProfile,
      emergencyFundMonths: proj.emergencyFundMonths,
    };
  }
  if (Array.isArray(stateObj.budgetItems) && stateObj.budgetItems.length > 0) {
    compactObject.budgetItems = stateObj.budgetItems;
  }
  if (stateObj.initialBalances) {
    compactObject.initialBalances = stateObj.initialBalances;
  }
  if (
    Array.isArray(stateObj.fintableBrokerBalances) &&
    stateObj.fintableBrokerBalances.length > 0
  ) {
    compactObject.fintableBrokerBalances = stateObj.fintableBrokerBalances;
  }
  if (cashflowSummary) {
    compactObject.cashflowSummary = cashflowSummary;
  }
  if (compactAssets) {
    compactObject.positions = compactAssets;
  }
  if (Array.isArray(stateObj.watchlist)) {
    compactObject.watchlist = stateObj.watchlist;
  } else if (Array.isArray(stateObj.valoriaWatchlist)) {
    compactObject.watchlist = stateObj.valoriaWatchlist;
  }
  if (typeof stateObj.valoriaRiskProfile === 'string') {
    compactObject.valoriaRiskProfile = stateObj.valoriaRiskProfile;
  }

  return {
    compactObject,
    strippedTransactionsCount,
    strippedPriceHistoryPoints,
    detectedVersion,
    baseCurrency,
  };
}

/**
 * Compresse un export JSON brut FinanceAI et retourne les statistiques d'allègement.
 */
function compactFinanceAIJson(rawInput: string): {
  compactJson: string;
  stats: FinanceAICompactionStats;
  compactObject: Record<string, unknown>;
  parsedRaw: unknown;
} {
  const originalBytes = new TextEncoder().encode(rawInput).length;
  const parsedRaw = JSON.parse(rawInput);
  const {
    compactObject,
    strippedTransactionsCount,
    strippedPriceHistoryPoints,
    detectedVersion,
    baseCurrency,
  } = compactFinanceAIObject(parsedRaw);

  const fxRates = compactObject.fxRates as Record<string, unknown> | undefined;
  const compactJson = JSON.stringify(compactObject, null, 2);
  const compactBytes = new TextEncoder().encode(compactJson).length;
  const wasCompacted =
    strippedTransactionsCount > 0 ||
    strippedPriceHistoryPoints > 0 ||
    originalBytes > compactBytes * 1.35;

  return {
    compactJson,
    compactObject,
    parsedRaw,
    stats: {
      wasCompacted,
      originalBytes,
      compactBytes,
      strippedTransactionsCount,
      strippedPriceHistoryPoints,
      detectedVersion,
      baseCurrency,
      appliedFxSummary: buildFxSummaryLabel(fxRates),
    },
  };
}

function normalizeYearMonth(rawDate?: unknown): string {
  if (typeof rawDate !== 'string' || !rawDate.trim()) return '2024-01';
  const match = rawDate.trim().match(/^(\d{4})-(\d{1,2})/);
  if (match) {
    const y = Math.max(2015, Math.min(2026, Number(match[1])));
    const m = Math.max(1, Math.min(y === 2026 ? 11 : 12, Number(match[2])));
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (HISTORICAL_SERIES.some((p) => p.yearMonth === ym)) return ym;
  }
  return '2024-01';
}

function extractIsoDate(rawDate?: unknown): string | undefined {
  if (typeof rawDate !== 'string') return undefined;
  const m = rawDate.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

function extractCompactDailyHistoryCad(
  rawPriceHistory: unknown,
  fxToCad: number
): [string, number][] | undefined {
  if (!Array.isArray(rawPriceHistory) || rawPriceHistory.length < 2) {
    return undefined;
  }
  const byDate = new Map<string, number>();
  for (const pt of rawPriceHistory) {
    if (!pt || typeof pt !== 'object') continue;
    const rec = pt as Record<string, unknown>;
    const dt = extractIsoDate(rec.date);
    const px = Number(rec.price ?? rec.close ?? NaN);
    if (!dt || !Number.isFinite(px) || px <= 0) continue;
    byDate.set(dt, Number((px * fxToCad).toFixed(4)));
  }
  if (byDate.size < 2) return undefined;
  return Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function normalizeRiskProfile(raw?: unknown): RiskProfile | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toLowerCase();
  if (s.includes('prud') || s.includes('conserv') || s.includes('low')) return 'prudent';
  if (s.includes('equil') || s.includes('mod') || s.includes('balanc')) return 'equilibre';
  if (s.includes('dynam') || s.includes('growth')) return 'dynamique';
  if (s.includes('offens') || s.includes('aggr') || s.includes('high')) return 'offensif';
  return null;
}

function computeBudgetTargetMonthlyNative(budgetItems: unknown[]): number {
  let totalMonthly = 0;
  for (const item of budgetItems) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, unknown>;
    const target = Number(b.target ?? 0);
    if (!Number.isFinite(target) || target <= 0) continue;
    const freq = String(b.frequency ?? 'Monthly').toLowerCase();
    if (freq.startsWith('week') || freq.includes('hebdo')) {
      totalMonthly += target * (52 / 12);
    } else if (freq.startsWith('biweek') || freq.includes('2 sem')) {
      totalMonthly += target * (26 / 12);
    } else if (freq.startsWith('year') || freq.includes('annu')) {
      totalMonthly += target / 12;
    } else {
      totalMonthly += target;
    }
  }
  return totalMonthly;
}

/**
 * Parse un export JSON FinanceAI (y compris sauvegardes Zustand v4.0 multi-mégaoctets),
 * une table CSV de positions, ou des lignes rapides ticker-montant vers des lots Valoria en $ CAD.
 */
export function parseFinanceAIPayload(rawInput: string): FinanceAIImportResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error(
      'Glissez-déposez votre fichier .json FinanceAI (même > 5 Mo), collez un export ou chargez la démo.'
    );
  }

  // 1. JSON parsing (FinanceAI v4.0 backup, FinanceAI v2 object, or array of positions)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let compacted: ReturnType<typeof compactFinanceAIJson>;
    try {
      compacted = compactFinanceAIJson(trimmed);
    } catch {
      const kb = Math.round(trimmed.length / 1024);
      const looksTruncated =
        !trimmed.endsWith('}') && !trimmed.endsWith(']');
      if (looksTruncated || trimmed.length > 30_000) {
        throw new Error(
          `Export JSON FinanceAI tronqué à ~${kb} Ko (coupé avant la fin du fichier par le presse-papiers ou l’éditeur). Utilisez le bouton « Choisir fichier .json » ou glissez-déposez directement votre sauvegarde complète (jusqu’à 50 Mo+ supportés).`
        );
      }
      throw new Error(
        'Format JSON FinanceAI invalide : vérifiez la syntaxe des accolades ou importez directement le fichier .json.'
      );
    }

    const root = compacted.compactObject;
    const { rawList: unstrippedList } = unwrapFinanceAIRootState(compacted.parsedRaw);
    const fxRates = root.fxRates as Record<string, unknown> | undefined;
    const baseCurrency = compacted.stats.baseCurrency ?? 'CAD';

    const rawList =
      unstrippedList ?? (Array.isArray(root.positions) ? root.positions : []);

    const importedLots: Omit<PortfolioLot, 'id'>[] = [];
    const unmatchedSymbols: string[] = [];

    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const primarySym = String(
        rec.assetId ?? rec.ticker ?? rec.symbol ?? rec.code ?? ''
      );
      const fallbackSym =
        typeof rec.historySymbol === 'string' ? rec.historySymbol : undefined;
      const fallbackName =
        typeof rec.name === 'string' ? rec.name : undefined;

      const posCurrency =
        rec.currency ??
        (rec.amountCad !== undefined || rec.investedCad !== undefined
          ? 'CAD'
          : rec.amountEur !== undefined || rec.investedEur !== undefined
            ? 'EUR'
            : baseCurrency);
      const fxToCad = getFxMultiplierToCad(posCurrency, fxRates);

      let asset = resolveFinanceAISymbol(
        primarySym || fallbackName || '',
        fallbackSym,
        fallbackName
      );

      // Intégration dynamique de tout ticker inconnu si symbole et cours/montant valides
      if (!asset && primarySym.trim().length >= 1) {
        const rawSpotNat = Number(rec.currentPrice ?? rec.price ?? rec.avgBuyPrice ?? rec.buyPrice ?? 100);
        const estSpotCad = Math.max(0.01, (Number.isFinite(rawSpotNat) ? rawSpotNat : 100) * fxToCad);
        const symUpper = primarySym.trim().toUpperCase();
        const rawType = String(rec.type ?? rec.category ?? '').toLowerCase();
        const isCryptoSym =
          rawType.includes('crypto') || /-(USD|CAD|EUR)$/.test(symUpper);
        const isBondSym = rawType.includes('bond') || rawType.includes('oblig');
        asset = registerDynamicMarketAsset({
          ticker: symUpper,
          name: fallbackName || symUpper,
          spotCad: Number(estSpotCad.toFixed(4)),
          category: isCryptoSym
            ? 'crypto'
            : isBondSym
              ? 'obligations'
              : 'actions',
          subClass: isCryptoSym
            ? 'crypto_l1_defi'
            : isBondSym
              ? 'obligation_taux'
              : symUpper.endsWith('.TO')
                ? 'action_ca'
                : 'action_us',
        });
      }

      if (!asset) {
        const label = primarySym || fallbackName;
        if (label && !unmatchedSymbols.includes(label)) {
          unmatchedSymbols.push(label);
        }
        continue;
      }

      const dailyHistoryCad = extractCompactDailyHistoryCad(
        rec.priceHistory,
        fxToCad
      );

      const qty = Number(rec.quantity ?? rec.shares ?? 0);
      const unitBuyNative = Number(
        rec.avgBuyPrice ?? rec.buyPrice ?? rec.avgPrice ?? 0
      );
      const unitSpotNative = Number(rec.currentPrice ?? rec.price ?? 0);

      const explicitCad = Number(rec.amountCad ?? rec.investedCad ?? NaN);
      const explicitEur = Number(rec.amountEur ?? rec.investedEur ?? NaN);

      let investedCad = 0;
      let entryPriceCad: number | undefined;
      let baseSpotPriceCad: number | undefined;

      if (qty > 0 && (unitBuyNative > 0 || dailyHistoryCad)) {
        const effectiveEntryNative =
          unitBuyNative > 0
            ? unitBuyNative
            : (dailyHistoryCad?.[0]?.[1] ?? 0) / Math.max(1e-9, fxToCad);
        entryPriceCad = Number((effectiveEntryNative * fxToCad).toFixed(4));
        investedCad = qty * entryPriceCad;

        const lastHist = dailyHistoryCad?.[dailyHistoryCad.length - 1];
        if (lastHist && lastHist[0] >= '2026-11-01') {
          baseSpotPriceCad = lastHist[1];
        } else if (unitSpotNative > 0) {
          baseSpotPriceCad = Number((unitSpotNative * fxToCad).toFixed(4));
        } else if (lastHist) {
          baseSpotPriceCad = lastHist[1];
        }
      } else if (Number.isFinite(explicitCad) && explicitCad > 0) {
        investedCad = explicitCad;
      } else if (Number.isFinite(explicitEur) && explicitEur > 0) {
        investedCad = convertFinanceAIAmountToCad(explicitEur, 'EUR', fxRates);
      } else {
        const rawNativeAmount = Number(
          rec.investedAmount ??
            rec.amount ??
            rec.value ??
            rec.currentValueCad ??
            rec.currentValueEur ??
            (qty > 0 && unitSpotNative > 0 ? qty * unitSpotNative : 0)
        );
        investedCad = convertFinanceAIAmountToCad(
          rawNativeAmount,
          posCurrency,
          fxRates
        );
      }

      const rawPurchaseDate =
        rec.purchaseDate ??
        rec.dateBought ??
        rec.purchaseYearMonth ??
        rec.date ??
        dailyHistoryCad?.[0]?.[0];

      if (Number.isFinite(investedCad) && investedCad > 0) {
        importedLots.push({
          assetId: asset.id,
          investedAmount: Number(investedCad.toFixed(2)),
          purchaseYearMonth: normalizeYearMonth(rawPurchaseDate),
          ...(qty > 0 && entryPriceCad ? { quantity: qty, entryPriceCad } : {}),
          ...(baseSpotPriceCad ? { baseSpotPriceCad } : {}),
          ...(extractIsoDate(rawPurchaseDate)
            ? { purchaseDate: extractIsoDate(rawPurchaseDate) }
            : {}),
          ...(dailyHistoryCad ? { dailyHistoryCad } : {}),
        });
      }
    }

    const profObj =
      (root.profile as Record<string, unknown> | undefined) ??
      (root.budget as Record<string, unknown> | undefined) ??
      (root.investorProfile as Record<string, unknown> | undefined) ??
      root;

    const projObj = root.projection as Record<string, unknown> | undefined;
    const cashflowObj = root.cashflowSummary as Record<string, unknown> | undefined;
    const initBalObj = root.initialBalances as Record<string, unknown> | undefined;

    let incomeCad = Number(
      profObj.monthlyIncomeCad ??
        (profObj.monthlyIncomeEur
          ? convertFinanceAIAmountToCad(Number(profObj.monthlyIncomeEur), 'EUR', fxRates)
          : 0) ??
        0
    );
    if (!incomeCad && profObj.monthlyIncome) {
      incomeCad = convertFinanceAIAmountToCad(
        Number(profObj.monthlyIncome),
        baseCurrency,
        fxRates
      );
    }
    if (!incomeCad && profObj.revenus) {
      incomeCad = convertFinanceAIAmountToCad(
        Number(profObj.revenus),
        baseCurrency,
        fxRates
      );
    }

    let expensesCad = Number(
      profObj.monthlyExpensesCad ??
        (profObj.monthlyExpensesEur
          ? convertFinanceAIAmountToCad(Number(profObj.monthlyExpensesEur), 'EUR', fxRates)
          : 0) ??
        0
    );
    if (!expensesCad && profObj.monthlyExpenses) {
      expensesCad = convertFinanceAIAmountToCad(
        Number(profObj.monthlyExpenses),
        baseCurrency,
        fxRates
      );
    }
    if (!expensesCad && profObj.depenses) {
      expensesCad = convertFinanceAIAmountToCad(
        Number(profObj.depenses),
        baseCurrency,
        fxRates
      );
    }

    let explicitSavingsCad = Number(
      profObj.monthlySavingsCapacityCad ??
        (profObj.monthlySavingsCapacityEur
          ? convertFinanceAIAmountToCad(
              Number(profObj.monthlySavingsCapacityEur),
              'EUR',
              fxRates
            )
          : 0) ??
        0
    );
    if (!explicitSavingsCad && profObj.monthlySavingsCapacity) {
      explicitSavingsCad = convertFinanceAIAmountToCad(
        Number(profObj.monthlySavingsCapacity),
        baseCurrency,
        fxRates
      );
    }
    if (!explicitSavingsCad && (profObj.savingsCapacity || profObj.epargneMensuelle)) {
      explicitSavingsCad = convertFinanceAIAmountToCad(
        Number(profObj.savingsCapacity ?? profObj.epargneMensuelle),
        baseCurrency,
        fxRates
      );
    }

    if (incomeCad <= 0 && expensesCad <= 0 && explicitSavingsCad <= 0) {
      const budgetItemsNative = Array.isArray(root.budgetItems)
        ? computeBudgetTargetMonthlyNative(root.budgetItems)
        : 0;
      const txIncNative = Number(cashflowObj?.monthlyIncomeNative ?? 0);
      const txExpNative = Number(cashflowObj?.monthlyExpensesNative ?? 0);
      const theoIncNative = Number(projObj?.theoreticalIncome ?? 0);
      const theoExpNative = Number(projObj?.theoreticalExpenses ?? 0);
      const manualContribNative = Number(projObj?.manualContribution ?? 0);

      const chosenIncNative =
        projObj?.useTheoretical && theoIncNative > 0
          ? theoIncNative
          : Math.max(txIncNative, theoIncNative);
      const chosenExpNative =
        projObj?.useTheoretical && theoExpNative > 0
          ? theoExpNative
          : budgetItemsNative > 0
            ? budgetItemsNative
            : txExpNative > 0
              ? txExpNative
              : theoExpNative;

      if (chosenIncNative > 0) {
        incomeCad = convertFinanceAIAmountToCad(chosenIncNative, baseCurrency, fxRates);
      }
      if (chosenExpNative > 0) {
        expensesCad = convertFinanceAIAmountToCad(chosenExpNative, baseCurrency, fxRates);
      }
      if (manualContribNative > 0) {
        explicitSavingsCad = convertFinanceAIAmountToCad(
          manualContribNative,
          baseCurrency,
          fxRates
        );
      }
    }

    const liquiditeNative = Number(initBalObj?.LIQUIDITE ?? 0);
    const emergencyCadRaw =
      Number(profObj.emergencyFund ?? 0) > 0
        ? convertFinanceAIAmountToCad(Number(profObj.emergencyFund), baseCurrency, fxRates)
        : liquiditeNative > 0
          ? convertFinanceAIAmountToCad(liquiditeNative, baseCurrency, fxRates)
          : 0;

    let budgetSync: FinanceAIBudgetSync | null = null;
    if (incomeCad > 0 || explicitSavingsCad > 0 || expensesCad > 0) {
      const computedSavings =
        explicitSavingsCad > 0
          ? explicitSavingsCad
          : incomeCad > expensesCad
            ? incomeCad - expensesCad
            : Math.max(300, incomeCad * 0.15);
      budgetSync = {
        monthlyIncomeEur: Math.round(incomeCad),
        monthlyExpensesEur: Math.round(expensesCad),
        monthlySavingsCapacityEur: Math.round(computedSavings),
        emergencyFundEur: emergencyCadRaw > 0 ? Math.round(emergencyCadRaw) : undefined,
      };
    }

    const detectedRiskProfile = normalizeRiskProfile(
      root.valoriaRiskProfile ??
        profObj.riskProfile ??
        profObj.riskTolerance ??
        root.riskProfile ??
        projObj?.appliedReturnProfile
    );

    const rawWatch = Array.isArray(root.watchlist) ? root.watchlist : [];
    const watchlistAssetIds = rawWatch
      .map((w) => resolveFinanceAISymbol(String(w))?.id)
      .filter((x): x is string => Boolean(x));

    if (importedLots.length === 0 && !budgetSync) {
      throw new Error(
        'Aucune position ni capacité d’épargne reconnue dans ce JSON FinanceAI.'
      );
    }

    return {
      sourceFormat: 'financeai_json',
      importedLots,
      unmatchedSymbols,
      budgetSync,
      detectedRiskProfile,
      watchlistAssetIds,
      compactionStats: compacted.stats,
      compactPreviewJson: compacted.compactJson,
    };
  }

  // 2. CSV / TSV ou lignes rapides ("MSFT;2500;2023-05" ou "MC.PA: 3000") en $ CAD
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => Boolean(l) && !l.startsWith('#'));

  const importedLots: Omit<PortfolioLot, 'id'>[] = [];
  const unmatchedSymbols: string[] = [];
  let isCsv = false;

  lines.forEach((line, idx) => {
    const parts = line.split(/[;,\t|:]+/).map((p) => p.trim());
    if (idx === 0 && /ticker|symbole|actif|amount|montant|valeur/i.test(line)) {
      isCsv = true;
      return;
    }
    if (parts.length >= 2) {
      if (parts.length >= 3) isCsv = true;
      const sym = parts[0];
      const hasEuroSign = parts[1].includes('€');
      const numStr = parts[1].replace(/[€$\sA-Za-z]/g, '').replace(',', '.');
      const amtRaw = Number(numStr);
      const amtCad = hasEuroSign
        ? convertFinanceAIAmountToCad(amtRaw, 'EUR')
        : amtRaw;
      const asset = resolveFinanceAISymbol(sym);
      if (!asset) {
        unmatchedSymbols.push(sym);
        return;
      }
      if (Number.isFinite(amtCad) && amtCad > 0) {
        importedLots.push({
          assetId: asset.id,
          investedAmount: Number(amtCad.toFixed(2)),
          purchaseYearMonth: normalizeYearMonth(parts[2]),
          ...(extractIsoDate(parts[2])
            ? { purchaseDate: extractIsoDate(parts[2]) }
            : {}),
        });
      }
    }
  });

  if (importedLots.length === 0) {
    throw new Error(
      'Aucune action ou actif reconnu. Exemple attendu : MSFT;2500;2023-05 ($ CAD) ou fichier .json FinanceAI.'
    );
  }

  return {
    sourceFormat: isCsv ? 'csv' : 'quick_lines',
    importedLots,
    unmatchedSymbols,
    budgetSync: null,
    detectedRiskProfile: null,
    watchlistAssetIds: [],
  };
}

/**
 * Construit un export standardisé compatible FinanceAI en $ CAD combinant les positions,
 * les métriques de risque et les principaux signaux d'achat/vente Valoria.
 */
export function buildFinanceAIExportPayload(params: {
  portfolioSummary: PortfolioSummary;
  riskMetrics: PortfolioRiskMetrics;
  equitySummary: EquityUniverseSummary;
  riskProfile: RiskProfile;
  monthlySavingsCapacityEur: number;
  macro?: MacroIndicators;
}): FinanceAIExportPayload {
  const {
    portfolioSummary,
    riskMetrics,
    equitySummary,
    riskProfile,
    monthlySavingsCapacityEur,
  } = params;

  const byId = new Map<string, EquityQuantAnalysis>(
    equitySummary.allAnalyses.map((a) => [a.asset.id, a])
  );

  const totalVal = Number(portfolioSummary.totalCurrentValue.toFixed(2));
  const totalInv = Number(portfolioSummary.totalInvested.toFixed(2));
  const totalPnl = Number(portfolioSummary.totalGainLossEuro.toFixed(2));

  return {
    schema: 'FinanceAI-Valoria-Bridge/v1.3-CAD',
    currency: 'CAD',
    exportedAt: new Date().toISOString(),
    sourceApp: 'Valoria Quant Engine',
    targetApp: 'FinanceAI',
    investorProfile: {
      riskProfile,
      monthlySavingsCapacityEur,
      monthlySavingsCapacityCad: monthlySavingsCapacityEur,
    },
    portfolioMetrics: {
      totalValueEur: totalVal,
      totalValueCad: totalVal,
      totalInvestedEur: totalInv,
      totalInvestedCad: totalInv,
      unrealizedPnlEur: totalPnl,
      unrealizedPnlCad: totalPnl,
      sharpeRatio: riskMetrics.sharpeRatio,
      sortinoRatio: riskMetrics.sortinoRatio,
      monthlyVar95Eur: riskMetrics.var95MonthlyEur,
      monthlyVar95Cad: riskMetrics.var95MonthlyEur,
      betaVsWorld: riskMetrics.betaVsWorld,
    },
    positions: portfolioSummary.lots.map((item) => {
      const eq = byId.get(item.asset.id);
      return {
        assetId: item.asset.id,
        ticker: item.asset.ticker,
        name: item.asset.name,
        category: item.asset.category,
        wrapper: item.asset.wrapper.split(' · ')[0],
        investedEur: item.lot.investedAmount,
        investedCad: item.lot.investedAmount,
        currentValueEur: item.currentValue,
        currentValueCad: item.currentValue,
        weightPct: item.weightPct,
        quantSignal: eq?.signal,
        quantScore: eq?.quantScore,
      };
    }),
    tacticalSignals: {
      buyNow: equitySummary.topBuysNow.map((b) => ({
        ticker: b.asset.ticker,
        name: b.asset.name,
        wrapper: b.wrapperShort,
        signal: b.signal,
        quantScore: b.quantScore,
        spotEur: b.spotPrice,
        spotCad: b.spotPrice,
        target12mEur: b.targetPrice12mEur,
        target12mCad: b.targetPrice12mEur,
        stopLossEur: b.stopLossEur,
        stopLossCad: b.stopLossEur,
        upsidePct: b.targetReturn12mPct,
        catalyst: b.catalystHeadline,
      })),
      sellOrTrimNow: equitySummary.topSellsNow.map((s) => ({
        ticker: s.asset.ticker,
        name: s.asset.name,
        signal: s.signal,
        quantScore: s.quantScore,
        spotEur: s.spotPrice,
        spotCad: s.spotPrice,
        fairValueDcfEur: s.intrinsicValueDcfEur,
        fairValueDcfCad: s.intrinsicValueDcfEur,
        downsideRiskPct: s.upsideDcfPct,
        reason: s.catalystHeadline,
      })),
    },
  };
}

/**
 * Construit un export JSON ultra-compact (< 1,5 Ko) en $ CAD destiné aux assistants IA.
 */
export function buildCompactFinanceAIExportJson(
  payload: FinanceAIExportPayload
): string {
  const slim = {
    s: 'Valoria->FinanceAI/v1.3-CAD-lite',
    ccy: 'CAD',
    p: {
      valCad: Math.round(payload.portfolioMetrics.totalValueCad),
      sharpe: payload.portfolioMetrics.sharpeRatio,
      var95Cad: Math.round(payload.portfolioMetrics.monthlyVar95Cad),
      saveMoCad: payload.investorProfile.monthlySavingsCapacityCad,
    },
    held: payload.positions.map((pos) => ({
      t: pos.ticker,
      cad: Math.round(pos.currentValueCad),
      w: pos.weightPct,
      sig: pos.quantSignal ?? 'CORE',
      sc: pos.quantScore ?? null,
    })),
    buy: payload.tacticalSignals.buyNow.slice(0, 5).map((b) => ({
      t: b.ticker,
      sc: b.quantScore,
      upPct: b.upsidePct,
      tgtCad: b.target12mCad,
    })),
    sell: payload.tacticalSignals.sellOrTrimNow.slice(0, 5).map((s) => ({
      t: s.ticker,
      sc: s.quantScore,
      dcfPct: s.downsideRiskPct,
    })),
  };
  return JSON.stringify(slim);
}

/**
 * Construit un export CSV en $ CAD des positions et signaux tactiques Valoria.
 */
export function buildFinanceAICsvExport(payload: FinanceAIExportPayload): string {
  const header =
    'Type;Ticker;Nom;Enveloppe;Signal_Quant;Score_100;Valeur_ou_Spot_CAD;Cible_12M_CAD;Potentiel_Pct';
  const posRows = payload.positions.map(
    (p) =>
      `POSITION;${p.ticker};${p.name};${p.wrapper};${p.quantSignal ?? 'CORE'};${p.quantScore ?? '-'};${p.currentValueCad.toFixed(2)};-;${p.weightPct.toFixed(1)}%`
  );
  const buyRows = payload.tacticalSignals.buyNow.map(
    (b) =>
      `SIGNAL_ACHAT;${b.ticker};${b.name};${b.wrapper};${b.signal};${b.quantScore};${b.spotCad.toFixed(2)};${b.target12mCad.toFixed(2)};+${b.upsidePct.toFixed(1)}%`
  );
  const sellRows = payload.tacticalSignals.sellOrTrimNow.map(
    (s) =>
      `SIGNAL_VENTE;${s.ticker};${s.name};-;${s.signal};${s.quantScore};${s.spotCad.toFixed(2)};${s.fairValueDcfCad.toFixed(2)};${s.downsideRiskPct.toFixed(1)}%`
  );
  return [header, ...posRows, ...buyRows, ...sellRows].join('\n');
}

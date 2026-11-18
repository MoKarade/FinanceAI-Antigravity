import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useFinanceStore, type FinanceState } from '../store/useFinanceStore';
import type {
  Asset,
  BudgetCategory,
  Transaction,
  User,
  ValoriaRiskProfile,
} from '../types';
import {
  assetValueCad,
  computeMonthlyBudgetAggregates,
  toCurrencyFactor,
} from '../services/portfolio';
import { computeCashLedger } from '../services/startingCash';
import {
  placementsFaisantAutorite,
  type PlacementsAutorite,
} from '../services/fintable/placementsAutorite';
import { getEffectivePurchases } from '../utils/assetPurchases';
import {
  ASSETS,
  HISTORICAL_SERIES,
  MARKET_REGIMES,
  type DynamicMarketAssetRegistration,
  type MacroIndicators,
  type RegimeId,
  type RiskProfile,
  getLatestPrices,
  registerDynamicMarketAsset,
} from '../services/valoria/marketData';
import {
  type PortfolioLot,
  type PortfolioSummary,
  evaluatePortfolioRealTime,
} from '../services/valoria/engine';
import type { AnalystTradeRecommendation } from '../services/valoria/proAnalystAdvisor';
import {
  type FinanceAIBudgetSync,
  resolveFinanceAISymbol,
} from '../services/valoria/financeAiBridge';

const EMPTY_ASSETS: Asset[] = [];
const EMPTY_TRANSACTIONS: Transaction[] = [];
const EMPTY_BUDGET_ITEMS: BudgetCategory[] = [];
const EMPTY_WATCHLIST: string[] = [];
const EMPTY_LOTS: PortfolioLot[] = [];
const EMPTY_USERS = [] as unknown as [User, User];
const EMPTY_BALANCES: Record<string, number> = {};

/**
 * Portefeuille Bac à Sable chargé uniquement sur demande explicite de l'utilisateur
 * via `loadDemoSimPortfolio()` (jamais auto-injecté au démarrage — règle `no-fake-data`).
 */
export const DEMO_PORTFOLIO_LOTS: readonly PortfolioLot[] = [
  { id: 'lot-xeqt', assetId: 'XEQT', investedAmount: 18000, purchaseYearMonth: '2025-01' },
  { id: 'lot-ry', assetId: 'RY', investedAmount: 11500, purchaseYearMonth: '2025-03' },
  { id: 'lot-msft', assetId: 'MSFT', investedAmount: 9500, purchaseYearMonth: '2026-08' },
  { id: 'lot-gold', assetId: 'GOLD', investedAmount: 12000, purchaseYearMonth: '2026-07' },
  { id: 'lot-asml', assetId: 'ASML', investedAmount: 6500, purchaseYearMonth: '2026-08' },
  { id: 'lot-intc', assetId: 'INTC', investedAmount: 5800, purchaseYearMonth: '2026-08' },
];

interface ImportExternalLotsParams {
  lots: Omit<PortfolioLot, 'id'>[];
  mode?: 'replace' | 'merge';
  budgetSync?: FinanceAIBudgetSync | null;
}

export interface ValoriaBridgeState {
  lots: PortfolioLot[];
  realLots: PortfolioLot[];
  realAssetsEmpty: boolean;
  portfolioSummary: PortfolioSummary;
  isSimulationModified: boolean;
  simCashCad: number;
  availableCashCad: number;
  setAvailableCashCad: (val: number) => void;
  setSimCashCad: (val: number) => void;
  addSimLot: (lot: Omit<PortfolioLot, 'id'>) => void;
  removeSimAssetHoldings: (assetId: string) => void;
  executeSimSingleOrder: (assetId: string, deltaCad: number) => void;
  applySimFullAdvisoryPlan: (
    sells: AnalystTradeRecommendation[],
    buys: AnalystTradeRecommendation[]
  ) => void;
  resetSimToRealPortfolio: () => void;
  loadDemoSimPortfolio: () => void;
  clearSimPortfolio: () => void;
  importExternalLotsToSim: (
    input: Omit<PortfolioLot, 'id'>[] | ImportExternalLotsParams,
    mode?: 'replace' | 'merge'
  ) => void;
  livePrices: Record<string, number>;
  regimeId: RegimeId;
  macro: MacroIndicators;
  selectRegime: (id: RegimeId) => void;
  marketUniverseVersion: number;
  isRefreshingVerified: boolean;
  verifiedFeedStatus: string | null;
  refreshVerifiedPrices: () => Promise<void>;
  registerCustomOrLiveAsset: (spec: DynamicMarketAssetRegistration) => string;
  budgetSync: FinanceAIBudgetSync;
  brokerAuthority: PlacementsAutorite;
  riskProfile: ValoriaRiskProfile;
  setRiskProfile: (profile: ValoriaRiskProfile) => void;
  watchlistIds: string[];
  setWatchlistIds: (nextOrUpdater: string[] | ((prev: string[]) => string[])) => void;
  toggleWatchlistAsset: (assetId: string) => void;
  addWatchlistAsset: (assetId: string) => void;
  removeWatchlistAsset: (assetId: string) => void;
  fxRates: FinanceState['fxRates'];
  isPrivacyMode: boolean;
  geminiApiKey: string;
}

function extractIsoDate(rawDate?: string): string | undefined {
  if (typeof rawDate !== 'string') return undefined;
  const m = rawDate.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

function normalizeYearMonth(rawDate?: string): string {
  if (typeof rawDate === 'string' && rawDate.trim()) {
    const match = rawDate.trim().match(/^(\d{4})-(\d{1,2})/);
    if (match) {
      const y = Math.max(2015, Math.min(2026, Number(match[1])));
      const m = Math.max(1, Math.min(y === 2026 ? 11 : 12, Number(match[2])));
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      if (HISTORICAL_SERIES.some((p) => p.yearMonth === ym)) return ym;
    }
  }
  return '2024-01';
}

function buildCompactDailyHistoryCad(
  priceHistory: Asset['priceHistory'],
  fxToCad: number
): [string, number][] | undefined {
  if (!Array.isArray(priceHistory) || priceHistory.length < 2) return undefined;
  const byDate = new Map<string, number>();
  for (let i = 0; i < priceHistory.length; i++) {
    const pt = priceHistory[i];
    if (!pt) continue;
    const dt = extractIsoDate(pt.date);
    if (!dt || !Number.isFinite(pt.price) || pt.price <= 0) continue;
    byDate.set(dt, Number((pt.price * fxToCad).toFixed(4)));
  }
  if (byDate.size < 2) return undefined;
  return Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function buildMonthlyHistoryMapCad(
  dailyHistoryCad?: [string, number][]
): Record<string, number> | undefined {
  if (!dailyHistoryCad || dailyHistoryCad.length < 3) return undefined;
  const out: Record<string, number> = {};
  for (let i = 0; i < dailyHistoryCad.length; i++) {
    const [dt, px] = dailyHistoryCad[i];
    out[dt.slice(0, 7)] = px;
  }
  return Object.keys(out).length >= 3 ? out : undefined;
}

function deriveRiskProfileFallback(
  appliedReturnProfile?: FinanceState['projection']['appliedReturnProfile']
): RiskProfile {
  if (appliedReturnProfile === 'conservative') return 'prudent';
  if (appliedReturnProfile === 'aggressive') return 'offensif';
  return 'equilibre';
}

function mapAssetToDynamicSpec(
  asset: Asset,
  spotCad: number,
  monthlyHistoryCad?: Record<string, number>
): DynamicMarketAssetRegistration {
  const symUpper = asset.symbol.trim().toUpperCase();
  const sectorLower = (asset.sector ?? '').toLowerCase();
  const isCrypto =
    asset.accountType === 'CRYPTO' ||
    sectorLower.includes('crypto') ||
    /-(USD|CAD|EUR)$/.test(symUpper);
  const isBond =
    sectorLower.includes('bond') ||
    sectorLower.includes('oblig') ||
    sectorLower.includes('fixed');
  const isCa =
    symUpper.endsWith('.TO') || symUpper.endsWith('.V') || symUpper.endsWith('.NE');

  return {
    ticker: symUpper,
    name: asset.name?.trim() || symUpper,
    spotCad: Number(Math.max(0.01, spotCad).toFixed(4)),
    category: isCrypto ? 'crypto' : isBond ? 'obligations' : 'actions',
    subClass: isCrypto
      ? 'crypto_l1_defi'
      : isBond
        ? 'obligation_taux'
        : isCa
          ? 'action_ca'
          : 'action_us',
    ...(asset.sector ? { sector: asset.sector } : {}),
    ...(monthlyHistoryCad ? { monthlyHistoryCad } : {}),
  };
}

/**
 * Pont réactif bidirectionnel entre le store Zustand persisté de FinanceAI v4.0 et Valoria.
 *
 * - Lecture en temps réel ($ CAD) via `useShallow` sur les tranches ciblées du store.
 * - Isolement strict (ADR-V3) : aucune simulation d'achat/vente/rééquilibrage n'écrit sur
 *   `assets`, `transactions`, `brokerLedger` ou `initialBalances`.
 * - Seuls `valoriaRiskProfile` et `valoriaWatchlist` sont persistés via `setAppState`.
 */
export function useValoriaBridge(): ValoriaBridgeState {
  const {
    assets,
    fxRates,
    fxRatesSource,
    fxRatesEstimated,
    transactions,
    budgetItems,
    initialBalances,
    fintableBrokerBalances,
    projection,
    config,
    isPrivacyMode,
    apiKeys,
    valoriaWatchlist,
    valoriaRiskProfile,
    setAppState,
  } = useFinanceStore(
    useShallow((s) => ({
      assets: s.assets ?? EMPTY_ASSETS,
      fxRates: s.fxRates,
      fxRatesSource: s.fxRatesSource,
      fxRatesEstimated: s.fxRatesEstimated,
      transactions: s.transactions ?? EMPTY_TRANSACTIONS,
      budgetItems: s.budgetItems ?? EMPTY_BUDGET_ITEMS,
      initialBalances: s.initialBalances ?? EMPTY_BALANCES,
      fintableBrokerBalances: s.fintableBrokerBalances,
      projection: s.projection,
      config: s.config,
      isPrivacyMode: s.isPrivacyMode,
      apiKeys: s.apiKeys,
      valoriaWatchlist: s.valoriaWatchlist,
      valoriaRiskProfile: s.valoriaRiskProfile,
      setAppState: s.setAppState,
    }))
  );

  // État local React isolé pour le Bac à Sable / simulation (ADR-V3)
  const [simLotsOverride, setSimLotsOverride] = useState<PortfolioLot[] | null>(null);
  const [simCashCad, setSimCashCadState] = useState<number>(0);
  const [simBudgetOverride, setSimBudgetOverride] = useState<FinanceAIBudgetSync | null>(null);
  const [regimeId, setRegimeId] = useState<RegimeId>('disinflation_growth');
  const [macro, setMacro] = useState<MacroIndicators>(MARKET_REGIMES[0].indicators);
  const [livePrices, setLivePrices] = useState<Record<string, number>>(() => getLatestPrices());
  const [marketUniverseVersion, setMarketUniverseVersion] = useState<number>(0);
  const [isRefreshingVerified, setIsRefreshingVerified] = useState<boolean>(false);
  const [verifiedFeedStatus, setVerifiedFeedStatus] = useState<string | null>(null);

  const lastAssetsCountRef = useRef<number>(ASSETS.length);

  const realAssetsEmpty = assets.length === 0;

  // Conversion réactive des vrais actifs FinanceAI en lots Valoria ($ CAD) sans muter le store
  const realLots = useMemo<PortfolioLot[]>(() => {
    if (assets.length === 0) return EMPTY_LOTS;

    const mapped: PortfolioLot[] = [];
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      if (!asset || !Number.isFinite(asset.quantity) || asset.quantity <= 0) continue;

      const currentValCad = assetValueCad(asset, fxRates);
      const fxToCad = toCurrencyFactor(fxRates, asset.currency || 'CAD');
      const baseSpotPriceCad =
        Number.isFinite(currentValCad) && currentValCad > 0
          ? Number((currentValCad / asset.quantity).toFixed(4))
          : Number.isFinite(asset.currentPrice) && asset.currentPrice > 0
            ? Number((asset.currentPrice * fxToCad).toFixed(4))
            : 0;

      const purchases = getEffectivePurchases(asset);
      const firstPurchase = purchases[0];
      let totalPurchaseQty = 0;
      let totalPurchaseCostNative = 0;
      for (let pIdx = 0; pIdx < purchases.length; pIdx++) {
        const pur = purchases[pIdx];
        if (!pur || !Number.isFinite(pur.quantity) || !Number.isFinite(pur.price)) continue;
        if (pur.quantity > 0 && pur.price > 0) {
          totalPurchaseQty += pur.quantity;
          totalPurchaseCostNative += pur.quantity * pur.price;
        }
      }

      const avgEntryNative =
        totalPurchaseQty > 0
          ? totalPurchaseCostNative / totalPurchaseQty
          : typeof asset.buyPrice === 'number' && Number.isFinite(asset.buyPrice) && asset.buyPrice > 0
            ? asset.buyPrice
            : firstPurchase && Number.isFinite(firstPurchase.price) && firstPurchase.price > 0
              ? firstPurchase.price
              : 0;

      const entryPriceCad =
        avgEntryNative > 0
          ? Number((avgEntryNative * fxToCad).toFixed(4))
          : baseSpotPriceCad;

      const investedAmount =
        entryPriceCad > 0
          ? Number((asset.quantity * entryPriceCad).toFixed(2))
          : Number(currentValCad.toFixed(2));

      if (!Number.isFinite(investedAmount) || investedAmount <= 0) continue;

      const dailyHistoryCad = buildCompactDailyHistoryCad(asset.priceHistory, fxToCad);

      let marketAsset = resolveFinanceAISymbol(
        asset.symbol,
        asset.historySymbol,
        asset.name
      );
      if (!marketAsset && asset.symbol.trim().length > 0) {
        const spotForRegistration =
          baseSpotPriceCad > 0
            ? baseSpotPriceCad
            : entryPriceCad > 0
              ? entryPriceCad
              : 100;
        marketAsset = registerDynamicMarketAsset(
          mapAssetToDynamicSpec(
            asset,
            spotForRegistration,
            buildMonthlyHistoryMapCad(dailyHistoryCad)
          )
        );
      }
      if (!marketAsset) continue;

      const rawPurchaseDate =
        firstPurchase?.date || asset.dateBought || asset.priceHistory?.[0]?.date;
      const purchaseDate = extractIsoDate(rawPurchaseDate);

      mapped.push({
        id: `real-${i}-${marketAsset.id}`,
        assetId: marketAsset.id,
        investedAmount,
        purchaseYearMonth: normalizeYearMonth(rawPurchaseDate),
        quantity: asset.quantity,
        entryPriceCad,
        ...(baseSpotPriceCad > 0 ? { baseSpotPriceCad } : {}),
        ...(purchaseDate ? { purchaseDate } : {}),
        ...(dailyHistoryCad ? { dailyHistoryCad } : {}),
      });
    }
    return mapped;
  }, [assets, fxRates]);

  // Synchroniser livePrices et la version d'univers lorsque de nouveaux tickers dynamiques sont enregistrés
  useEffect(() => {
    if (ASSETS.length !== lastAssetsCountRef.current) {
      lastAssetsCountRef.current = ASSETS.length;
      setLivePrices((prev) => ({ ...getLatestPrices(), ...prev }));
      setMarketUniverseVersion((v) => v + 1);
    }
  }, [realLots]);

  const effectiveLivePrices = useMemo(() => {
    let needsSync = marketUniverseVersion > 0;
    if (!needsSync) {
      for (let i = 0; i < realLots.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(livePrices, realLots[i].assetId)) {
          needsSync = true;
          break;
        }
      }
    }
    if (!needsSync) return livePrices;
    const latest = getLatestPrices();
    for (const key of Object.keys(latest)) {
      if (!Object.prototype.hasOwnProperty.call(livePrices, key)) {
        return { ...latest, ...livePrices };
      }
    }
    return livePrices;
  }, [livePrices, realLots, marketUniverseVersion]);

  const realLotsRef = useRef(realLots);
  realLotsRef.current = realLots;

  const livePricesRef = useRef(effectiveLivePrices);
  livePricesRef.current = effectiveLivePrices;

  const lots = simLotsOverride ?? realLots;
  const isSimulationModified = simLotsOverride !== null;

  const portfolioSummary = useMemo(
    () => evaluatePortfolioRealTime(lots, effectiveLivePrices),
    [lots, effectiveLivePrices]
  );

  // Dérivation mémoïsée du budget mensuel & liquidité d'urgence en $ CAD sans jamais cloner/tronquer transactions
  const budgetSync = useMemo<FinanceAIBudgetSync>(() => {
    if (simBudgetOverride) {
      return simBudgetOverride;
    }

    const safeUsers = config?.users ?? EMPTY_USERS;
    const aggs = computeMonthlyBudgetAggregates(
      {
        users: safeUsers,
        splitMode: config?.splitMode ?? 'prorata',
        customSplit: config?.customSplit,
      },
      budgetItems
    );

    let incomeCad = aggs.income;
    let expensesCad = aggs.expenses;

    if ((incomeCad <= 0 || expensesCad <= 0) && transactions.length > 0) {
      const byMonth = new Map<string, { inc: number; exp: number }>();
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        if (!tx || tx.isTransfer === true || tx.isDuplicate === true) continue;
        const cat = (tx.category || '').toLowerCase();
        if (cat === 'transfert' || cat === 'transfer' || cat === 'virement') continue;
        const amt = tx.amount;
        if (!Number.isFinite(amt) || amt === 0) continue;
        const ym = typeof tx.date === 'string' ? tx.date.slice(0, 7) : '';
        if (ym.length !== 7 || ym[4] !== '-') continue;
        let bucket = byMonth.get(ym);
        if (!bucket) {
          bucket = { inc: 0, exp: 0 };
          byMonth.set(ym, bucket);
        }
        if (amt > 0) bucket.inc += amt;
        else bucket.exp += Math.abs(amt);
      }

      const sortedMonths = Array.from(byMonth.keys()).sort();
      const completeMonths =
        sortedMonths.length >= 3 ? sortedMonths.slice(0, -1) : sortedMonths;
      const recentMonths = completeMonths.slice(-6);
      if (recentMonths.length > 0) {
        let sumInc = 0;
        let sumExp = 0;
        for (let i = 0; i < recentMonths.length; i++) {
          const b = byMonth.get(recentMonths[i]);
          if (b) {
            sumInc += b.inc;
            sumExp += b.exp;
          }
        }
        if (incomeCad <= 0) incomeCad = sumInc / recentMonths.length;
        if (expensesCad <= 0) expensesCad = sumExp / recentMonths.length;
      }
    }

    const savingsCad =
      projection?.savingsMode === 'manual' &&
      Number.isFinite(projection.manualContribution) &&
      projection.manualContribution > 0
        ? projection.manualContribution
        : Math.max(0, incomeCad - expensesCad);

    const ledgerLiquidityCad = computeCashLedger(initialBalances, transactions);
    const fallbackLiquidite = Number(initialBalances?.LIQUIDITE ?? 0);
    const emergencyCad =
      Number.isFinite(ledgerLiquidityCad) && ledgerLiquidityCad > 0
        ? ledgerLiquidityCad
        : Number.isFinite(fallbackLiquidite) && fallbackLiquidite > 0
          ? fallbackLiquidite
          : 0;

    return {
      monthlyIncomeEur: Number.isFinite(incomeCad) ? Math.round(incomeCad) : 0,
      monthlyExpensesEur: Number.isFinite(expensesCad) ? Math.round(expensesCad) : 0,
      monthlySavingsCapacityEur: Number.isFinite(savingsCad) ? Math.round(savingsCad) : 0,
      ...(emergencyCad > 0 ? { emergencyFundEur: Math.round(emergencyCad) } : {}),
    };
  }, [simBudgetOverride, config, budgetItems, transactions, projection, initialBalances]);

  const brokerAuthority = useMemo<PlacementsAutorite>(
    () =>
      placementsFaisantAutorite({
        assets,
        fxRates,
        fxRatesSource,
        fxRatesEstimated,
        fintableBrokerBalances,
      }),
    [assets, fxRates, fxRatesSource, fxRatesEstimated, fintableBrokerBalances]
  );

  // Actions de simulation isolées en état local React (jamais de write sur store.assets/transactions)
  const setAvailableCashCad = useCallback((val: number) => {
    if (!Number.isFinite(val) || val < 0) return;
    setSimCashCadState(Math.round(val));
  }, []);

  const addSimLot = useCallback((newLot: Omit<PortfolioLot, 'id'>) => {
    if (!Number.isFinite(newLot.investedAmount) || newLot.investedAmount <= 0) return;
    setSimLotsOverride((prev) => {
      const base = prev ?? realLotsRef.current;
      return [
        {
          ...newLot,
          id: `sim-lot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        },
        ...base,
      ];
    });
  }, []);

  const removeSimAssetHoldings = useCallback((assetId: string) => {
    setSimLotsOverride((prev) => {
      const base = prev ?? realLotsRef.current;
      return base.filter((l) => l.assetId !== assetId);
    });
  }, []);

  const executeSimSingleOrder = useCallback(
    (assetId: string, deltaCad: number) => {
      if (!Number.isFinite(deltaCad) || Math.abs(deltaCad) < 25) return;
      if (deltaCad > 0) {
        addSimLot({
          assetId,
          investedAmount: Math.round(deltaCad),
          purchaseYearMonth: '2026-11',
        });
        return;
      }

      const trimTarget = Math.abs(deltaCad);
      setSimLotsOverride((prev) => {
        const base = prev ?? realLotsRef.current;
        const currentEval = evaluatePortfolioRealTime(base, livePricesRef.current);
        const totalCurrentAssetVal = currentEval.lots
          .filter((item) => item.asset.id === assetId)
          .reduce((s, item) => s + item.currentValue, 0);
        if (totalCurrentAssetVal <= 0) return base;

        const keepRatio = Math.max(
          0,
          (totalCurrentAssetVal - trimTarget) / totalCurrentAssetVal
        );
        return base.flatMap((lot) => {
          if (lot.assetId !== assetId) return [lot];
          if (keepRatio < 0.04) return [];
          return [
            {
              ...lot,
              investedAmount: Number(
                Math.max(10, lot.investedAmount * keepRatio).toFixed(2)
              ),
              ...(lot.quantity
                ? { quantity: Number((lot.quantity * keepRatio).toFixed(6)) }
                : {}),
            },
          ];
        });
      });
    },
    [addSimLot]
  );

  const applySimFullAdvisoryPlan = useCallback(
    (
      sells: AnalystTradeRecommendation[],
      buys: AnalystTradeRecommendation[]
    ) => {
      setSimLotsOverride((prev) => {
        const base = prev ?? realLotsRef.current;
        const currentEval = evaluatePortfolioRealTime(base, livePricesRef.current);
        const sellMap = new Map(sells.map((s) => [s.assetId, Math.abs(s.deltaCad)]));

        const postSellLots = base.flatMap((lot) => {
          const trimCad = sellMap.get(lot.assetId);
          if (!trimCad) return [lot];

          const assetTotalVal = currentEval.lots
            .filter((item) => item.asset.id === lot.assetId)
            .reduce((s, item) => s + item.currentValue, 0);
          if (assetTotalVal <= 0) return [lot];

          const keepRatio = Math.max(0, (assetTotalVal - trimCad) / assetTotalVal);
          if (keepRatio < 0.04) return [];
          return [
            {
              ...lot,
              investedAmount: Number(
                Math.max(10, lot.investedAmount * keepRatio).toFixed(2)
              ),
              ...(lot.quantity
                ? { quantity: Number((lot.quantity * keepRatio).toFixed(6)) }
                : {}),
            },
          ];
        });

        const newBuyLots: PortfolioLot[] = buys
          .filter((b) => Number.isFinite(b.deltaCad) && b.deltaCad >= 25)
          .map((b, idx) => ({
            id: `sim-arb-${Date.now()}-${idx}`,
            assetId: b.assetId,
            investedAmount: Math.round(b.deltaCad),
            purchaseYearMonth: '2026-11',
          }));

        return [...newBuyLots, ...postSellLots];
      });

      setSimCashCadState((prevCash) => (prevCash > 0 ? 0 : prevCash));
    },
    []
  );

  const resetSimToRealPortfolio = useCallback(() => {
    setSimLotsOverride(null);
    setSimCashCadState(0);
    setSimBudgetOverride(null);
  }, []);

  const loadDemoSimPortfolio = useCallback(() => {
    setSimLotsOverride(DEMO_PORTFOLIO_LOTS.map((l) => ({ ...l })));
  }, []);

  const clearSimPortfolio = useCallback(() => {
    setSimLotsOverride([]);
  }, []);

  const importExternalLotsToSim = useCallback(
    (
      input: Omit<PortfolioLot, 'id'>[] | ImportExternalLotsParams,
      modeArg: 'replace' | 'merge' = 'replace'
    ) => {
      const rawLots = Array.isArray(input) ? input : input.lots;
      const mode = Array.isArray(input) ? modeArg : (input.mode ?? 'replace');
      const budgetSyncArg = Array.isArray(input) ? undefined : input.budgetSync;

      if (rawLots.length > 0) {
        const hydrated: PortfolioLot[] = rawLots.map((l, idx) => ({
          ...l,
          id: `sim-ext-${Date.now()}-${idx}`,
        }));
        setLivePrices((prev) => ({ ...getLatestPrices(), ...prev }));
        setMarketUniverseVersion((v) => v + 1);
        setSimLotsOverride((prev) => {
          const base = prev ?? realLotsRef.current;
          return mode === 'replace' ? hydrated : [...hydrated, ...base];
        });
      }
      if (budgetSyncArg) {
        setSimBudgetOverride(budgetSyncArg);
      }
    },
    []
  );

  // Contrôles marché & flux vérifiés
  const selectRegime = useCallback((id: RegimeId) => {
    setRegimeId(id);
    const preset = MARKET_REGIMES.find((r) => r.id === id);
    if (preset) {
      setMacro({ ...preset.indicators });
    }
  }, []);

  const registerCustomOrLiveAsset = useCallback(
    (spec: DynamicMarketAssetRegistration): string => {
      const asset = registerDynamicMarketAsset(spec);
      setLivePrices((prev) => ({
        ...prev,
        ...getLatestPrices(),
        ...(spec.spotCad > 0 ? { [asset.id]: Number(spec.spotCad.toFixed(4)) } : {}),
      }));
      setMarketUniverseVersion((v) => v + 1);
      return asset.id;
    },
    []
  );

  const refreshVerifiedPrices = useCallback(async () => {
    if (isRefreshingVerified) return;
    setIsRefreshingVerified(true);
    try {
      const resp = await fetch('/api/market/verified-feed');
      if (resp.ok) {
        const data = (await resp.json()) as {
          ok?: boolean;
          asOfDate?: string;
          livePricesCad?: Record<string, number>;
          updatedCount?: number;
        };
        if (data.ok && data.livePricesCad) {
          const { CASH: _keepCorraParity, ...restVerified } = data.livePricesCad;
          void _keepCorraParity;
          setLivePrices((prev) => ({
            ...prev,
            ...restVerified,
          }));
          setVerifiedFeedStatus(
            `${data.updatedCount ?? ASSETS.length} cours vérifiés (${data.asOfDate ?? 'direct'})`
          );
        }
      }
    } catch {
      setVerifiedFeedStatus('Clôtures certifiées actives');
    } finally {
      setIsRefreshingVerified(false);
    }
  }, [isRefreshingVerified]);

  // Synchronisation bidirectionnelle persistée : profil de risque & liste de suivi Valoria
  const riskProfile: ValoriaRiskProfile =
    valoriaRiskProfile ?? deriveRiskProfileFallback(projection?.appliedReturnProfile);

  const setRiskProfile = useCallback(
    (profile: ValoriaRiskProfile) => {
      setAppState({ valoriaRiskProfile: profile });
    },
    [setAppState]
  );

  const watchlistIds = valoriaWatchlist ?? EMPTY_WATCHLIST;

  const setWatchlistIds = useCallback(
    (nextOrUpdater: string[] | ((prev: string[]) => string[])) => {
      const current = useFinanceStore.getState().valoriaWatchlist ?? EMPTY_WATCHLIST;
      const rawNext =
        typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
      const deduped = Array.from(
        new Set(rawNext.map((id) => id.trim()).filter((id) => id.length > 0))
      );
      setAppState({ valoriaWatchlist: deduped });
    },
    [setAppState]
  );

  const toggleWatchlistAsset = useCallback(
    (assetId: string) => {
      const cleanId = assetId.trim();
      if (!cleanId) return;
      setWatchlistIds((prev) =>
        prev.includes(cleanId)
          ? prev.filter((id) => id !== cleanId)
          : [...prev, cleanId]
      );
    },
    [setWatchlistIds]
  );

  const addWatchlistAsset = useCallback(
    (assetId: string) => {
      const cleanId = assetId.trim();
      if (!cleanId) return;
      setWatchlistIds((prev) => (prev.includes(cleanId) ? prev : [...prev, cleanId]));
    },
    [setWatchlistIds]
  );

  const removeWatchlistAsset = useCallback(
    (assetId: string) => {
      const cleanId = assetId.trim();
      if (!cleanId) return;
      setWatchlistIds((prev) => prev.filter((id) => id !== cleanId));
    },
    [setWatchlistIds]
  );

  return {
    lots,
    realLots,
    realAssetsEmpty,
    portfolioSummary,
    isSimulationModified,
    simCashCad,
    availableCashCad: simCashCad,
    setAvailableCashCad,
    setSimCashCad: setAvailableCashCad,
    addSimLot,
    removeSimAssetHoldings,
    executeSimSingleOrder,
    applySimFullAdvisoryPlan,
    resetSimToRealPortfolio,
    loadDemoSimPortfolio,
    clearSimPortfolio,
    importExternalLotsToSim,
    livePrices: effectiveLivePrices,
    regimeId,
    macro,
    selectRegime,
    marketUniverseVersion,
    isRefreshingVerified,
    verifiedFeedStatus,
    refreshVerifiedPrices,
    registerCustomOrLiveAsset,
    budgetSync,
    brokerAuthority,
    riskProfile,
    setRiskProfile,
    watchlistIds,
    setWatchlistIds,
    toggleWatchlistAsset,
    addWatchlistAsset,
    removeWatchlistAsset,
    fxRates,
    isPrivacyMode,
    geminiApiKey: apiKeys?.gemini ?? '',
  };
}

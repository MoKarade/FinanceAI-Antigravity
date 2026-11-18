import type {
  AppState,
  Asset,
  AssetOwner,
  InvestmentAccount,
  InvestmentTransaction,
  RegisteredAccountType,
  ValoriaRiskProfile,
} from '../../types';
import { assetValueCad, toCurrencyFactor } from '../portfolio';
import { optimizeAssetLocation, type AccountType, type AssetClass } from '../projection/assetLocation';
import type { ProjectionResult } from '../projection/types';
import { MARKET_REGIMES, ASSETS, getLatestPrices, registerDynamicMarketAsset, type RiskProfile } from './marketData';
import { evaluatePortfolioRealTime, type PortfolioLot } from './engine';
import { buildProAnalystAdvisory } from './proAnalystAdvisor';
import { analyzeFullMarketUniverse } from './multiAssetQuantEngine';
import { resolveFinanceAISymbol } from './financeAiBridge';

export type ValoriaTabTarget =
  | 'portfolio'
  | 'recommendations'
  | 'ai_proof'
  | 'dialogue'
  | 'market'
  | 'intelligence';

export type ValoriaLabTarget =
  | 'unified'
  | 'backtest'
  | 'montecarlo'
  | 'simulator'
  | 'quant_models'
  | 'equity_signals'
  | 'academy'
  | 'live_news'
  | 'ai_recs';

export interface ValoriaFocusTarget {
  tab?: ValoriaTabTarget;
  lab?: ValoriaLabTarget;
  assetId?: string;
}

export interface ValoriaQuickSignal {
  assetId: string;
  symbol: string;
  name: string;
  score100: number;
  signal: 'RENFORCER' | 'CONSERVER' | 'ALLEGER';
  labelCourt: 'Renforcer' | 'Conserver' | 'Alléger';
  spotPriceCad: number;
}

export interface ValoriaApplyOrderCandidate {
  symbol: string;
  name: string;
  deltaCad: number;
  spotPriceCad: number;
  suggestedAccount: RegisteredAccountType;
}

export interface ValoriaRealOrderExecution extends ValoriaApplyOrderCandidate {
  accountType: RegisteredAccountType;
  owner: AssetOwner;
}

const VALID_TABS = new Set<ValoriaTabTarget>([
  'portfolio',
  'recommendations',
  'ai_proof',
  'dialogue',
  'market',
  'intelligence',
]);

const VALID_LABS = new Set<ValoriaLabTarget>([
  'unified',
  'backtest',
  'montecarlo',
  'simulator',
  'quant_models',
  'equity_signals',
  'academy',
  'live_news',
  'ai_recs',
]);

function resolveSymbolToValoriaId(rawSymbol: string): string {
  const clean = rawSymbol.trim().toUpperCase();
  if (!clean) return '';
  const exactAsset = ASSETS.find(
    (a) => a.id.toUpperCase() === clean || a.ticker.toUpperCase() === clean
  );
  if (exactAsset) return exactAsset.id;
  const resolved = resolveFinanceAISymbol(clean);
  if (resolved) return resolved.id;
  const stripped = clean.replace(/\.(TO|V|NE|PA|DE)$/i, '');
  const byRoot = ASSETS.find(
    (a) => a.id.toUpperCase() === stripped || a.ticker.split('.')[0].toUpperCase() === stripped
  );
  return byRoot ? byRoot.id : clean;
}

/**
 * Décode la cible de lien profond (`pendingFocus.section`) destinée à `Tab.VALORIA`.
 * Accepte `asset:SYMBOLE`, `tab:NOM`, `lab:NOM` ou une combinaison.
 */
export function parseValoriaFocusSection(section?: string | null): ValoriaFocusTarget {
  if (typeof section !== 'string') return {};
  const trimmed = section.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith('asset:')) {
    const raw = trimmed.slice('asset:'.length).trim();
    if (!raw) return {};
    return {
      tab: 'portfolio',
      lab: 'unified',
      assetId: resolveSymbolToValoriaId(raw),
    };
  }

  if (trimmed.startsWith('tab:')) {
    const candidate = trimmed.slice('tab:'.length).trim() as ValoriaTabTarget;
    if (VALID_TABS.has(candidate)) {
      return { tab: candidate, lab: 'unified' };
    }
  }

  if (trimmed.startsWith('lab:')) {
    const candidate = trimmed.slice('lab:'.length).trim() as ValoriaLabTarget;
    if (VALID_LABS.has(candidate)) {
      return { lab: candidate };
    }
  }

  if (VALID_TABS.has(trimmed as ValoriaTabTarget)) {
    return { tab: trimmed as ValoriaTabTarget, lab: 'unified' };
  }
  if (VALID_LABS.has(trimmed as ValoriaLabTarget)) {
    return { lab: trimmed as ValoriaLabTarget };
  }

  return {};
}

function deriveRiskProfile(
  riskProfile?: ValoriaRiskProfile,
  appliedReturnProfile?: AppState['projection']['appliedReturnProfile']
): RiskProfile {
  if (riskProfile) return riskProfile;
  if (appliedReturnProfile === 'conservative') return 'prudent';
  if (appliedReturnProfile === 'aggressive') return 'offensif';
  return 'equilibre';
}

function classifyForFiscalLocation(
  symbol: string,
  sector?: string,
  region?: string
): AssetClass {
  const sym = symbol.trim().toUpperCase();
  const sec = (sector ?? '').toLowerCase();
  const reg = (region ?? '').toUpperCase();

  if (sec.includes('oblig') || sec.includes('bond') || ['XBB', 'XGB', 'ZAG', 'BND'].some((t) => sym.includes(t))) {
    return 'bonds';
  }
  if (sym === 'CASH' || sym.startsWith('CASH.') || sec.includes('liquid')) {
    return 'cash';
  }
  if (sec.includes('reit') || sec.includes('immob') || sym.includes('REIT')) {
    return 'reit';
  }
  if (reg === 'CANADA' || reg === 'CA' || sym.endsWith('.TO') || sym.endsWith('.V') || sym.endsWith('.NE')) {
    return 'ca-equity';
  }
  if (reg === 'EUROPE' || reg === 'ASIE' || reg === 'INTERNATIONAL' || /\.(PA|DE|SW|MI|AS)$/.test(sym)) {
    return 'international';
  }
  return 'us-equity';
}

function toFiscalAccountType(accountType?: RegisteredAccountType): AccountType {
  if (accountType === 'CELI' || accountType === 'CELIAPP') return 'CELI';
  if (accountType === 'REER' || accountType === 'REEE') return 'REER';
  return 'NonReg';
}

/**
 * Suggère le compte enregistré canadien optimal selon la fiscalité QC/ARC (CELI / REER / Non-enregistré / Crypto).
 */
export function suggestOptimalCanadianAccount(
  symbol: string,
  sector?: string,
  region?: string
): RegisteredAccountType {
  const sym = symbol.trim().toUpperCase();
  const sec = (sector ?? '').toLowerCase();
  if (sec.includes('crypto') || /-(CAD|USD|EUR)$/.test(sym) || sym === 'BTC' || sym === 'ETH' || sym === 'SOL') {
    return 'CRYPTO';
  }
  const assetClass = classifyForFiscalLocation(sym, sector, region);
  if (assetClass === 'bonds' || assetClass === 'us-equity' || assetClass === 'reit') {
    return 'REER';
  }
  if (assetClass === 'international') {
    return 'NON-ENREG';
  }
  return 'CELI';
}

function buildQuickLotsAndPrices(
  assets: ReadonlyArray<Asset>,
  fxRates: Record<string, number>
): { lots: PortfolioLot[]; livePrices: Record<string, number>; symbolToAssetId: Map<string, string> } {
  const symbolToAssetId = new Map<string, string>();
  const livePrices = getLatestPrices();
  const lots: PortfolioLot[] = [];

  assets.forEach((asset, index) => {
    const cleanSymbol = (asset.symbol ?? '').trim().toUpperCase();
    if (!cleanSymbol || asset.quantity <= 0 || asset.currentPrice <= 0) return;
    const valCad = assetValueCad(asset, fxRates);
    if (!Number.isFinite(valCad) || valCad <= 0) return;

    const spotCad = Number((valCad / asset.quantity).toFixed(4));
    const matched = resolveFinanceAISymbol(cleanSymbol, cleanSymbol, asset.name);
    let assetId = matched?.id ?? cleanSymbol;

    if (!matched) {
      const reg = registerDynamicMarketAsset({
        ticker: cleanSymbol,
        name: asset.name?.trim() || cleanSymbol,
        spotCad,
        category: asset.accountType === 'CRYPTO' ? 'crypto' : 'actions',
        subClass:
          asset.accountType === 'CRYPTO'
            ? 'crypto_l1_defi'
            : cleanSymbol.endsWith('.TO')
              ? 'action_ca'
              : 'action_us',
        ...(asset.sector ? { sector: asset.sector } : {}),
      });
      assetId = reg.id;
    }

    livePrices[assetId] = spotCad;
    symbolToAssetId.set(cleanSymbol, assetId);
    symbolToAssetId.set(assetId, assetId);

    const buyYm =
      typeof asset.dateBought === 'string' && /^\d{4}-\d{2}/.test(asset.dateBought)
        ? asset.dateBought.slice(0, 7)
        : '2024-01';

    lots.push({
      id: `quick-${assetId}-${index}`,
      assetId,
      investedAmount: Number(valCad.toFixed(2)),
      purchaseYearMonth: buyYm,
    });
  });

  return { lots, livePrices, symbolToAssetId };
}

/**
 * Calcule rapidement les signaux Valoria (`score100`, `Renforcer` / `Conserver` / `Alléger`)
 * pour chaque titre détenu ou suivi, afin d'alimenter `Placements`, `Accueil` et l'assistant.
 */
export function computeValoriaQuickSignals(params: {
  assets: ReadonlyArray<Asset>;
  watchlistSymbols?: ReadonlyArray<string>;
  fxRates: Record<string, number>;
  riskProfile?: ValoriaRiskProfile;
  appliedReturnProfile?: AppState['projection']['appliedReturnProfile'];
}): Record<string, ValoriaQuickSignal> {
  const { assets, watchlistSymbols = [], fxRates } = params;
  const risk = deriveRiskProfile(params.riskProfile, params.appliedReturnProfile);
  const macro = MARKET_REGIMES[0].indicators;
  const { lots, livePrices, symbolToAssetId } = buildQuickLotsAndPrices(assets, fxRates);

  const watchlistIds = watchlistSymbols
    .map((s) => resolveSymbolToValoriaId(s))
    .filter((id) => id.length > 0);

  const evaluated = evaluatePortfolioRealTime(lots, livePrices);
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: risk,
    evaluatedLots: evaluated.lots,
    totalPortfolioValue: evaluated.totalCurrentValue,
  });

  const advisory = lots.length > 0
    ? buildProAnalystAdvisory({
        lots,
        livePrices,
        macro,
        riskProfile: risk,
        availableCashCad: 0,
        watchlistIds,
      })
    : null;

  const buyIds = new Set(advisory?.buyRecommendations.map((r) => r.assetId) ?? []);
  const sellIds = new Set(advisory?.sellRecommendations.map((r) => r.assetId) ?? []);

  const out: Record<string, ValoriaQuickSignal> = {};
  const registerEntry = (key: string, analysisId: string) => {
    const item = universe.byId.get(analysisId);
    if (!item) return;
    const score = Math.max(1, Math.min(99, Math.round(item.quantScore)));
    let signal: ValoriaQuickSignal['signal'] = 'CONSERVER';
    let labelCourt: ValoriaQuickSignal['labelCourt'] = 'Conserver';
    if (sellIds.has(item.asset.id) || item.signal === 'ALLÉGER' || item.signal === 'VENDRE' || score <= 44) {
      signal = 'ALLEGER';
      labelCourt = 'Alléger';
    } else if (buyIds.has(item.asset.id) || item.signal === 'ACHAT FORT' || item.signal === 'ACHETER' || score >= 68) {
      signal = 'RENFORCER';
      labelCourt = 'Renforcer';
    }
    out[key.toUpperCase()] = {
      assetId: item.asset.id,
      symbol: item.asset.ticker,
      name: item.asset.name,
      score100: score,
      signal,
      labelCourt,
      spotPriceCad: item.spotPriceCad,
    };
  };

  for (const [symKey, assetId] of symbolToAssetId.entries()) {
    registerEntry(symKey, assetId);
  }
  for (const watchSym of watchlistSymbols) {
    const clean = watchSym.trim().toUpperCase();
    if (!clean) continue;
    registerEntry(clean, resolveSymbolToValoriaId(clean));
  }
  for (const item of universe.allAnalyses) {
    registerEntry(item.asset.id, item.asset.id);
    registerEntry(item.asset.ticker, item.asset.id);
  }

  return out;
}

export interface ValoriaFiscalAndFutureContext {
  annualGrossIncomeCad: number;
  envelopes: Array<{ code: 'CELI' | 'REER' | 'NON-ENREG' | 'CRYPTO'; label: string; valueCad: number; sharePct: number }>;
  totalHoldingsCad: number;
  efficiencyScore100: number | null;
  totalAnnualTaxLossCad: number | null;
  taxSummary: string | null;
  taxRecommendations: Array<{
    assetClass: AssetClass;
    currentAccount: AccountType;
    recommendedAccount: AccountType;
    annualLossCad: number;
    rationale: string;
  }>;
  futureAvailable: boolean;
  currentNetWorthCad: number | null;
  projected5yNetWorthCad: number | null;
  projected5yYear: number | null;
  projectedRetirementNetWorthCad: number | null;
  projectedRetirementAge: number | null;
}

/**
 * Assemble le contexte fiscal canadien/québécois (`optimizeAssetLocation`, barème année en cours,
 * salaires mensuels × 12) et le pont vers la projection `Futur` officielle (`lastProjection`).
 * Règle `no-fake-data` : aucun `0` fabriqué lorsque la projection ou le revenu manque (`null`).
 */
export function buildValoriaFiscalAndFutureContext(params: {
  assets: ReadonlyArray<Asset>;
  fxRates: Record<string, number>;
  config?: AppState['config'];
  lastProjection: ProjectionResult | null;
  year: number;
}): ValoriaFiscalAndFutureContext {
  const { assets, fxRates, config, lastProjection, year } = params;
  const users = config?.users ?? [];
  // Salaires du profil stockés MENSUELS (règle GEMINI.md #5 : × 12 pour l'annuel).
  const annualGrossIncomeCad = Math.round(
    users.reduce((sum, u) => sum + (Number.isFinite(u?.grossSalary) ? Math.max(0, u.grossSalary) : 0), 0) * 12
  );

  const envTotals: Record<'CELI' | 'REER' | 'NON-ENREG' | 'CRYPTO', number> = {
    CELI: 0,
    REER: 0,
    'NON-ENREG': 0,
    CRYPTO: 0,
  };

  const fiscalHoldings: Array<{ assetClass: AssetClass; amount: number; currentAccount: AccountType }> = [];

  for (const a of assets) {
    const val = assetValueCad(a, fxRates);
    if (!Number.isFinite(val) || val <= 0) continue;
    if (a.accountType === 'CELI' || a.accountType === 'CELIAPP') {
      envTotals.CELI += val;
    } else if (a.accountType === 'REER' || a.accountType === 'REEE') {
      envTotals.REER += val;
    } else if (a.accountType === 'CRYPTO') {
      envTotals.CRYPTO += val;
    } else {
      envTotals['NON-ENREG'] += val;
    }

    fiscalHoldings.push({
      assetClass: classifyForFiscalLocation(a.symbol, a.sector, a.region),
      amount: Math.round(val),
      currentAccount: toFiscalAccountType(a.accountType),
    });
  }

  const totalHoldingsCad = Math.round(
    envTotals.CELI + envTotals.REER + envTotals['NON-ENREG'] + envTotals.CRYPTO
  );

  const envelopes = (
    [
      { code: 'CELI' as const, label: 'CELI / CELIAPP' },
      { code: 'REER' as const, label: 'REER / REEE' },
      { code: 'NON-ENREG' as const, label: 'Non-enregistré' },
      { code: 'CRYPTO' as const, label: 'Crypto' },
    ]
  ).map((e) => ({
    code: e.code,
    label: e.label,
    valueCad: Math.round(envTotals[e.code]),
    sharePct: totalHoldingsCad > 0 ? Math.round((envTotals[e.code] / totalHoldingsCad) * 100) : 0,
  }));

  const fiscalResult =
    annualGrossIncomeCad > 0 && fiscalHoldings.length > 0
      ? optimizeAssetLocation({
          annualGrossIncome: annualGrossIncomeCad,
          year,
          holdings: fiscalHoldings,
        })
      : null;

  const efficiencyScore100 =
    fiscalResult && totalHoldingsCad > 0
      ? Math.max(0, Math.min(100, Math.round(100 - (fiscalResult.totalAnnualLoss / totalHoldingsCad) * 100 * 20)))
      : null;

  const chart = lastProjection?.chartData;
  const futureAvailable = Array.isArray(chart) && chart.length > 0;
  let currentNetWorthCad: number | null = null;
  let projected5yNetWorthCad: number | null = null;
  let projected5yYear: number | null = null;
  let projectedRetirementNetWorthCad: number | null = null;
  let projectedRetirementAge: number | null = null;

  if (futureAvailable) {
    const p0 = chart.find((p) => p.monthIndex === 0) ?? chart[0];
    if (p0 && typeof p0.NetWorth === 'number' && Number.isFinite(p0.NetWorth)) {
      currentNetWorthCad = Math.round(p0.NetWorth);
    }
    const p5y = chart.find((p) => p.monthIndex === 60) ?? chart.find((p) => p.monthIndex >= 60) ?? chart[chart.length - 1];
    if (p5y && typeof p5y.NetWorth === 'number' && Number.isFinite(p5y.NetWorth)) {
      projected5yNetWorthCad = Math.round(p5y.NetWorth);
      projected5yYear = typeof p5y.year === 'number' && Number.isFinite(p5y.year) ? p5y.year : null;
    }
    const pRet = chart.find((p) => p.monthIndex >= 0 && p.isRetired);
    if (pRet && typeof pRet.NetWorth === 'number' && Number.isFinite(pRet.NetWorth)) {
      projectedRetirementNetWorthCad = Math.round(pRet.NetWorth);
      projectedRetirementAge = typeof pRet.age === 'number' && Number.isFinite(pRet.age) ? Math.round(pRet.age) : null;
    }
  }

  return {
    annualGrossIncomeCad,
    envelopes,
    totalHoldingsCad,
    efficiencyScore100,
    totalAnnualTaxLossCad: fiscalResult ? fiscalResult.totalAnnualLoss : null,
    taxSummary: fiscalResult ? fiscalResult.summary : null,
    taxRecommendations: fiscalResult
      ? fiscalResult.recommendations.slice(0, 4).map((r) => ({
          assetClass: r.assetClass,
          currentAccount: r.currentAccount,
          recommendedAccount: r.recommendedAccount,
          annualLossCad: r.annualLossIfUnchanged,
          rationale: r.rationale,
        }))
      : [],
    futureAvailable,
    currentNetWorthCad,
    projected5yNetWorthCad,
    projected5yYear,
    projectedRetirementNetWorthCad,
    projectedRetirementAge,
  };
}

/**
 * Calcule la liste d'ordres nets ($ CAD) entre le portefeuille réel et le bac à sable simulé Valoria.
 */
export function computeSandboxDeltaOrders(
  realLots: ReadonlyArray<PortfolioLot>,
  simLots: ReadonlyArray<PortfolioLot>,
  livePrices: Record<string, number>
): ValoriaApplyOrderCandidate[] {
  const realEval = evaluatePortfolioRealTime([...realLots], livePrices);
  const simEval = evaluatePortfolioRealTime([...simLots], livePrices);

  const realByAsset = new Map<string, number>();
  for (const lot of realEval.lots) {
    realByAsset.set(lot.asset.id, (realByAsset.get(lot.asset.id) ?? 0) + lot.currentValue);
  }
  const simByAsset = new Map<string, number>();
  for (const lot of simEval.lots) {
    simByAsset.set(lot.asset.id, (simByAsset.get(lot.asset.id) ?? 0) + lot.currentValue);
  }

  const allIds = Array.from(new Set([...realByAsset.keys(), ...simByAsset.keys()]));
  const orders: ValoriaApplyOrderCandidate[] = [];

  for (const assetId of allIds) {
    const deltaCad = Math.round((simByAsset.get(assetId) ?? 0) - (realByAsset.get(assetId) ?? 0));
    if (Math.abs(deltaCad) < 25) continue;
    const asset = ASSETS.find((a) => a.id === assetId);
    const spotCad = livePrices[assetId] ?? asset?.initialPrice2015 ?? 100;
    if (!Number.isFinite(spotCad) || spotCad <= 0) continue;
    const symbol = asset?.ticker ?? assetId;
    orders.push({
      symbol,
      name: asset?.name ?? symbol,
      deltaCad,
      spotPriceCad: Number(spotCad.toFixed(4)),
      suggestedAccount: suggestOptimalCanadianAccount(symbol, asset?.category, undefined),
    });
  }

  return orders.sort((a, b) => Math.abs(b.deltaCad) - Math.abs(a.deltaCad));
}

function sameAssetSymbol(a: string, b: string): boolean {
  const normA = a.trim().toUpperCase();
  const normB = b.trim().toUpperCase();
  if (normA === normB) return true;
  return resolveSymbolToValoriaId(normA) === resolveSymbolToValoriaId(normB);
}

/**
 * Applique des ordres Valoria confirmés explicitement par l'utilisateur dans les vraies tranches
 * FinanceAI (`assets`, `investmentAccounts`, `investmentTransactions`).
 * Fonction pure — aucune écriture directe au store ici ; appelée seulement après clic de confirmation.
 */
export function applyValoriaOrdersToRealPortfolio(params: {
  assets: ReadonlyArray<Asset>;
  investmentAccounts: ReadonlyArray<InvestmentAccount>;
  investmentTransactions: ReadonlyArray<InvestmentTransaction>;
  orders: ReadonlyArray<ValoriaRealOrderExecution>;
  fxRates: Record<string, number>;
  dateIso: string;
}): {
  assets: Asset[];
  investmentAccounts: InvestmentAccount[];
  investmentTransactions: InvestmentTransaction[];
  appliedCount: number;
} {
  const nextAssets: Asset[] = structuredClone([...params.assets]);
  const nextAccounts: InvestmentAccount[] = structuredClone([...params.investmentAccounts]);
  const nextTxs: InvestmentTransaction[] = structuredClone([...params.investmentTransactions]);
  let appliedCount = 0;

  const ensureAccount = (accountType: RegisteredAccountType, owner: AssetOwner): string => {
    const userId = owner === 'user2' ? 1 : 0;
    const existing = nextAccounts.find((acc) => acc.type === accountType && acc.userId === userId);
    if (existing) return existing.id;
    const newId = `acc-valoria-${accountType.toLowerCase()}-${userId}-${nextAccounts.length + 1}`;
    nextAccounts.push({
      id: newId,
      userId,
      name: `${accountType} (${userId === 1 ? 'Conjoint 2' : 'Principal'})`,
      type: accountType,
    });
    return newId;
  };

  params.orders.forEach((order, idx) => {
    const { symbol, name, deltaCad, spotPriceCad, accountType, owner } = order;
    if (!symbol.trim() || !Number.isFinite(deltaCad) || Math.abs(deltaCad) < 1 || !Number.isFinite(spotPriceCad) || spotPriceCad <= 0) {
      return;
    }

    const accountId = ensureAccount(accountType, owner);
    const cleanSymbol = symbol.trim().toUpperCase();

    if (deltaCad > 0) {
      const existingIdx = nextAssets.findIndex(
        (a) =>
          sameAssetSymbol(a.symbol, cleanSymbol) &&
          (a.accountType ?? 'NON-ENREG') === accountType &&
          ((a.owner ?? owner) === owner)
      );

      if (existingIdx >= 0) {
        const target = nextAssets[existingIdx];
        const fx = toCurrencyFactor(params.fxRates, target.currency || 'CAD');
        const unitPriceNative = Number((spotPriceCad / Math.max(0.0001, fx)).toFixed(4));
        const qtyDelta = Number((deltaCad / spotPriceCad).toFixed(4));
        target.quantity = Number((target.quantity + qtyDelta).toFixed(4));
        target.currentPrice = unitPriceNative;
        target.purchases = [
          ...(target.purchases ?? []),
          { date: params.dateIso, quantity: qtyDelta, price: unitPriceNative },
        ];
        nextTxs.push({
          id: `tx-valoria-${params.dateIso}-${idx}-${appliedCount}`,
          date: params.dateIso,
          type: 'BUY',
          symbol: target.symbol,
          name: target.name,
          quantity: qtyDelta,
          price: unitPriceNative,
          amount: Math.round(deltaCad),
          currency: target.currency || 'CAD',
          accountId,
        });
      } else {
        const qtyDelta = Number((deltaCad / spotPriceCad).toFixed(4));
        const newAsset: Asset = {
          symbol: cleanSymbol,
          name: name.trim() || cleanSymbol,
          quantity: qtyDelta,
          currency: 'CAD',
          currentPrice: Number(spotPriceCad.toFixed(4)),
          buyPrice: Number(spotPriceCad.toFixed(4)),
          dateBought: params.dateIso,
          performance: 0,
          accountType,
          owner,
          purchases: [{ date: params.dateIso, quantity: qtyDelta, price: Number(spotPriceCad.toFixed(4)) }],
        };
        nextAssets.push(newAsset);
        nextTxs.push({
          id: `tx-valoria-${params.dateIso}-${idx}-${appliedCount}`,
          date: params.dateIso,
          type: 'BUY',
          symbol: cleanSymbol,
          name: newAsset.name,
          quantity: qtyDelta,
          price: Number(spotPriceCad.toFixed(4)),
          amount: Math.round(deltaCad),
          currency: 'CAD',
          accountId,
        });
      }
      appliedCount += 1;
      return;
    }

    // Vente / allègement sur une position réelle correspondante
    const sellIdx =
      nextAssets.findIndex(
        (a) => sameAssetSymbol(a.symbol, cleanSymbol) && (a.accountType ?? 'NON-ENREG') === accountType
      ) !== -1
        ? nextAssets.findIndex(
            (a) => sameAssetSymbol(a.symbol, cleanSymbol) && (a.accountType ?? 'NON-ENREG') === accountType
          )
        : nextAssets.findIndex((a) => sameAssetSymbol(a.symbol, cleanSymbol));

    if (sellIdx >= 0) {
      const target = nextAssets[sellIdx];
      const currentCad = assetValueCad(target, params.fxRates);
      const effectiveSellCad = Math.min(Math.abs(deltaCad), currentCad);
      if (effectiveSellCad < 1) return;
      const ratioKept = currentCad > 0 ? Math.max(0, (currentCad - effectiveSellCad) / currentCad) : 0;
      const qtySold = Number((target.quantity * (1 - ratioKept)).toFixed(4));
      const remainingQty = Number((target.quantity - qtySold).toFixed(4));

      nextTxs.push({
        id: `tx-valoria-${params.dateIso}-${idx}-${appliedCount}`,
        date: params.dateIso,
        type: 'SELL',
        symbol: target.symbol,
        name: target.name,
        quantity: qtySold,
        price: target.currentPrice,
        amount: Math.round(effectiveSellCad),
        currency: target.currency || 'CAD',
        accountId,
      });

      if (remainingQty <= 0.0001) {
        nextAssets.splice(sellIdx, 1);
      } else {
        target.quantity = remainingQty;
      }
      appliedCount += 1;
    }
  });

  return {
    assets: nextAssets,
    investmentAccounts: nextAccounts,
    investmentTransactions: nextTxs,
    appliedCount,
  };
}

/**
 * Construit une synthèse JSON structurée pour l'outil `consulter_diagnostic_valoria` de
 * l'assistant Gemini global (AUCUNE donnée fabriquée si le portefeuille ou la projection est vide).
 */
export function buildValoriaAssistantDiagnostic(
  state: AppState,
  year: number,
  filterSymbol?: string,
  lastProjection: ProjectionResult | null = null
): Record<string, unknown> {
  const assets = state.assets ?? [];
  const fxRates = state.fxRates ?? {};
  const risk = deriveRiskProfile(state.valoriaRiskProfile, state.projection?.appliedReturnProfile);
  const macro = MARKET_REGIMES[0].indicators;
  const watchlistIds = (state.valoriaWatchlist ?? []).map((s) => resolveSymbolToValoriaId(s)).filter(Boolean);

  const fiscalAndFuture = buildValoriaFiscalAndFutureContext({
    assets,
    fxRates,
    config: state.config,
    lastProjection,
    year,
  });

  const signals = computeValoriaQuickSignals({
    assets,
    watchlistSymbols: state.valoriaWatchlist ?? [],
    fxRates,
    riskProfile: state.valoriaRiskProfile,
    appliedReturnProfile: state.projection?.appliedReturnProfile,
  });

  const { lots, livePrices } = buildQuickLotsAndPrices(assets, fxRates);
  const advisory =
    lots.length > 0
      ? buildProAnalystAdvisory({
          lots,
          livePrices,
          macro,
          riskProfile: risk,
          availableCashCad: 0,
          watchlistIds,
        })
      : null;

  const focusResolved = filterSymbol?.trim()
    ? signals[filterSymbol.trim().toUpperCase()] ??
      signals[resolveSymbolToValoriaId(filterSymbol.trim())] ??
      null
    : null;

  return {
    portefeuilleVide: assets.length === 0,
    profilRisque: risk,
    listeSuivie: state.valoriaWatchlist ?? [],
    santePortefeuilleAvant100: advisory ? advisory.healthScoreBefore100 : null,
    santePortefeuilleApres100: advisory ? advisory.healthScoreAfter100 : null,
    cagrAttenduAvantPct: advisory ? Number(advisory.multiAgent.expectedCagrBeforePct.toFixed(2)) : null,
    cagrAttenduApresPct: advisory ? Number(advisory.multiAgent.expectedCagrAfterPct.toFixed(2)) : null,
    positions: assets.slice(0, 20).map((a) => {
      const sig = signals[(a.symbol ?? '').toUpperCase()] ?? null;
      return {
        symbole: a.symbol,
        compte: a.accountType ?? 'NON-ENREG',
        valeurCad: Math.round(assetValueCad(a, fxRates)),
        scoreValoria100: sig ? sig.score100 : null,
        signalValoria: sig ? sig.labelCourt : null,
      };
    }),
    recommandationsAchat: (advisory?.buyRecommendations ?? []).slice(0, 5).map((r) => ({
      ticker: r.ticker,
      deltaCad: Math.round(r.deltaCad),
      scoreQuant100: r.quantScore,
      compteSuggere: suggestOptimalCanadianAccount(r.ticker),
      motif: r.headlineReason,
    })),
    recommandationsVente: (advisory?.sellRecommendations ?? []).slice(0, 5).map((r) => ({
      ticker: r.ticker,
      deltaCad: Math.round(r.deltaCad),
      scoreQuant100: r.quantScore,
      motif: r.headlineReason,
    })),
    emplacementFiscalQcCa: {
      revenuBrutAnnuelMenageCad: fiscalAndFuture.annualGrossIncomeCad,
      efficacite100: fiscalAndFuture.efficiencyScore100,
      perteAnnuelleEvitableCad: fiscalAndFuture.totalAnnualTaxLossCad,
      repartitionEnveloppes: fiscalAndFuture.envelopes,
      recommandations: fiscalAndFuture.taxRecommendations,
    },
    pontFutur5Ans: {
      disponible: fiscalAndFuture.futureAvailable,
      patrimoineProjete5AnsCad: fiscalAndFuture.projected5yNetWorthCad,
      anneeProjetee5Ans: fiscalAndFuture.projected5yYear,
      valoriaMediane5AnsCad: advisory
        ? Math.round(advisory.institutionalQuant.jumpMonteCarlo.after.p50Median5yCad)
        : null,
    },
    ...(filterSymbol?.trim() ? { titreDemande: focusResolved } : {}),
  };
}

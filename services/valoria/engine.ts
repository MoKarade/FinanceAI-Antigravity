import {
  ASSETS,
  type AssetCategory,
  type FinancialAsset,
  HISTORICAL_SERIES,
  type InvestmentGoal,
  type MacroIndicators,
  type RiskProfile,
  getAssetById,
  getPriceAtYearMonth,
} from './marketData';

type SignalStance = 'favorable' | 'neutre' | 'prudent';

export interface ScoredAsset {
  asset: FinancialAsset;
  predictiveScore: number;
  expectedAnnualReturnPct: number;
  expectedVolatilityPct: number;
  sharpeRatio: number;
  stance: SignalStance;
  stanceLabel: string;
  rationale: string;
}

interface AllocationSlice {
  assetId: string;
  ticker: string;
  name: string;
  category: AssetCategory;
  categoryLabel: string;
  weightPct: number;
  expectedReturnPct: number;
  rationale: string;
}

export interface RecommendedPortfolio {
  slices: AllocationSlice[];
  expectedAnnualReturnPct: number;
  expectedVolatilityPct: number;
  sharpeRatio: number;
  estimatedMaxDrawdownPct: number;
  categoryTotals: Record<AssetCategory, number>;
}

export interface PortfolioLot {
  id: string;
  assetId: string;
  investedAmount: number;
  purchaseYearMonth: string; // 'YYYY-MM'
  note?: string;
  quantity?: number;
  entryPriceCad?: number;
  baseSpotPriceCad?: number;
  purchaseDate?: string; // 'YYYY-MM-DD'
  dailyHistoryCad?: [string, number][]; // compact [YYYY-MM-DD, priceCad]
}

export interface EvaluatedPortfolioLot {
  lot: PortfolioLot;
  asset: FinancialAsset;
  purchaseLabel: string;
  entryPrice: number;
  currentPrice: number;
  units: number;
  currentValue: number;
  gainLossEuro: number;
  gainLossPct: number;
  periodReturnPct?: number;
  weightPct: number;
}

interface PortfolioHistoryPoint {
  yearMonth: string;
  label: string;
  portfolioValue: number;
  investedCumulative: number;
  livretEquivalent: number;
}

export interface PortfolioSummary {
  lots: EvaluatedPortfolioLot[];
  totalInvested: number;
  totalCurrentValue: number;
  totalGainLossEuro: number;
  totalGainLossPct: number;
  categoryValues: Record<AssetCategory, number>;
  categoryWeightsPct: Record<AssetCategory, number>;
  estimatedAnnualReturnPct: number;
  estimatedVolatilityPct: number;
  history: PortfolioHistoryPoint[];
}

export interface MonteCarloYearPoint {
  year: number;
  calendarYear: number;
  totalInvested: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface BacktestInput {
  assetId: string;
  startYearMonth: string;
  endYearMonth: string;
  mode: 'lump_sum' | 'dca';
  amount: number;
}

interface BacktestMonthlyPoint {
  yearMonth: string;
  label: string;
  unitPrice: number;
  portfolioValue: number;
  totalInvested: number;
  livretValue: number;
  inflationAdjustedCapital: number;
  drawdownPct: number;
  regimeNote?: string;
}

export interface BacktestResult {
  asset: FinancialAsset;
  mode: 'lump_sum' | 'dca';
  amount: number;
  startLabel: string;
  endLabel: string;
  monthsCount: number;
  totalInvested: number;
  finalValue: number;
  netProfit: number;
  roiPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  worstDrawdownDate: string;
  livretFinalValue: number;
  outperformanceVsLivret: number;
  realPurchasingPowerGain: number;
  alternativeModeFinalValue: number;
  alternativeModeInvested: number;
  alternativeModeRoiPct: number;
  series: BacktestMonthlyPoint[];
}

/**
 * Simulates a realistic real-time market price tick around latest prices
 * using asset volatility and deterministic/seeded or step-based micro-movements.
 */
export function applyLiveMarketTick(
  currentPrices: Record<string, number>,
  tickStep: number,
  macro: MacroIndicators
): Record<string, number> {
  const next: Record<string, number> = {};
  const vixFactor = Math.max(0.6, macro.vixLevel / 16);

  ASSETS.forEach((asset, idx) => {
    const prev = currentPrices[asset.id] ?? getPriceAtYearMonth(asset.id, '2026-11');
    if (asset.id === 'CASH') {
      // Cash accrues tiny positive interest monotonically
      next[asset.id] = Number((prev * (1 + 0.00002)).toFixed(4));
      return;
    }
    const wave =
      Math.sin(tickStep * 0.93 + idx * 2.17) * 0.55 +
      Math.cos(tickStep * 1.67 + idx * 1.13) * 0.45;
    // Scale intraday tick amplitude to annual volatility (e.g. ~0.08% for stocks, ~0.35% for crypto)
    const amplitude = (asset.baseVolatilityPct / 100) * 0.0055 * vixFactor;
    const delta = wave * amplitude;
    next[asset.id] = Number(Math.max(0.01, prev * (1 + delta)).toFixed(4));
  });

  return next;
}

const SHORT_MONTHS_LOWER = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

function formatIsoDateLabelFr(isoDate?: string, fallbackLabel = ''): string {
  if (!isoDate) return fallbackLabel;
  const m = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fallbackLabel;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (monthIdx < 0 || monthIdx > 11 || !day) return fallbackLabel;
  return `${day} ${SHORT_MONTHS_LOWER[monthIdx]} ${year}`;
}

/**
 * Evaluates a single lot's entry price, current price, units, and current market value in $ CAD,
 * honoring real imported FinanceAI quantities & spot prices when available while still reacting to live ticks.
 */
export function evaluateLotMarketPosition(
  lot: PortfolioLot,
  livePrices: Record<string, number>
): {
  entryPrice: number;
  currentPrice: number;
  units: number;
  currentValue: number;
  purchaseLabel: string;
  periodReturnPct?: number;
} {
  const latestSeriesPoint = HISTORICAL_SERIES[HISTORICAL_SERIES.length - 1];
  const point =
    HISTORICAL_SERIES.find((p) => p.yearMonth === lot.purchaseYearMonth) ??
    latestSeriesPoint;

  const seriesLatestPx = latestSeriesPoint.prices[lot.assetId] ?? 100;
  const livePx = livePrices[lot.assetId] ?? seriesLatestPx;
  const liveTickRatio = seriesLatestPx > 0 ? livePx / seriesLatestPx : 1;

  if (
    lot.quantity &&
    lot.quantity > 0 &&
    lot.entryPriceCad &&
    lot.entryPriceCad > 0
  ) {
    const units = lot.quantity;
    const entryPrice = lot.entryPriceCad;
    const baseSpot =
      lot.baseSpotPriceCad && lot.baseSpotPriceCad > 0
        ? lot.baseSpotPriceCad
        : seriesLatestPx;
    const currentPrice = baseSpot * liveTickRatio;
    const currentValue = units * currentPrice;

    let periodReturnPct: number | undefined;
    if (lot.dailyHistoryCad && lot.dailyHistoryCad.length >= 2) {
      const p0 = lot.dailyHistoryCad[0][1];
      if (p0 > 0) {
        periodReturnPct = Number((((currentPrice - p0) / p0) * 100).toFixed(2));
      }
    }

    return {
      entryPrice,
      currentPrice,
      units,
      currentValue,
      purchaseLabel: formatIsoDateLabelFr(lot.purchaseDate, point.label),
      periodReturnPct,
    };
  }

  const entryPrice = point.prices[lot.assetId] ?? seriesLatestPx;
  const currentPrice = livePx;
  const units = entryPrice > 0 ? lot.investedAmount / entryPrice : 0;
  const currentValue = units * currentPrice;

  return {
    entryPrice,
    currentPrice,
    units,
    currentValue,
    purchaseLabel: formatIsoDateLabelFr(lot.purchaseDate, point.label),
  };
}

/**
 * Evaluates a multi-lot virtual portfolio in real time from historical purchase dates
 * up to the current live market prices ($ CAD).
 */
export function evaluatePortfolioRealTime(
  lots: PortfolioLot[],
  livePrices: Record<string, number>
): PortfolioSummary {
  const validLots = lots.filter(
    (l) => l.investedAmount > 0 && Boolean(getAssetById(l.assetId))
  );

  let totalInvested = 0;
  let totalCurrentValue = 0;

  const categoryValues: Record<AssetCategory, number> = {
    actions: 0,
    obligations: 0,
    crypto: 0,
    refuge: 0,
  };

  const rawEvaluated = validLots.map((lot) => {
    const asset = getAssetById(lot.assetId)!;
    const pos = evaluateLotMarketPosition(lot, livePrices);
    const gainLossEuro = pos.currentValue - lot.investedAmount;
    const gainLossPct = (gainLossEuro / lot.investedAmount) * 100;

    totalInvested += lot.investedAmount;
    totalCurrentValue += pos.currentValue;
    categoryValues[asset.category] += pos.currentValue;

    return {
      lot,
      asset,
      purchaseLabel: pos.purchaseLabel,
      entryPrice: Number(pos.entryPrice.toFixed(2)),
      currentPrice: Number(pos.currentPrice.toFixed(2)),
      units: Number(pos.units.toFixed(6)),
      currentValue: Number(pos.currentValue.toFixed(2)),
      gainLossEuro: Number(gainLossEuro.toFixed(2)),
      gainLossPct: Number(gainLossPct.toFixed(2)),
      periodReturnPct: pos.periodReturnPct,
      weightPct: 0,
    };
  });

  const evaluatedLots: EvaluatedPortfolioLot[] = rawEvaluated.map((item) => ({
    ...item,
    weightPct:
      totalCurrentValue > 0
        ? Number(((item.currentValue / totalCurrentValue) * 100).toFixed(1))
        : 0,
  }));

  const categoryWeightsPct: Record<AssetCategory, number> = {
    actions:
      totalCurrentValue > 0
        ? Number(((categoryValues.actions / totalCurrentValue) * 100).toFixed(1))
        : 0,
    obligations:
      totalCurrentValue > 0
        ? Number(((categoryValues.obligations / totalCurrentValue) * 100).toFixed(1))
        : 0,
    crypto:
      totalCurrentValue > 0
        ? Number(((categoryValues.crypto / totalCurrentValue) * 100).toFixed(1))
        : 0,
    refuge:
      totalCurrentValue > 0
        ? Number(((categoryValues.refuge / totalCurrentValue) * 100).toFixed(1))
        : 0,
  };

  let weightedRet = 0;
  let weightedVol = 0;
  for (const item of evaluatedLots) {
    const w = item.weightPct / 100;
    weightedRet += w * (item.asset.baseExpectedReturnPct - item.asset.annualFeePct);
    weightedVol += w * item.asset.baseVolatilityPct;
  }
  const diversificationDiscount = evaluatedLots.length >= 3 ? 0.84 : 0.95;

  // Build portfolio historical curve from earliest lot purchase date to present
  let history: PortfolioHistoryPoint[] = [];
  if (validLots.length > 0) {
    const earliestIdx = Math.min(
      ...validLots.map((l) => {
        const idx = HISTORICAL_SERIES.findIndex((p) => p.yearMonth === l.purchaseYearMonth);
        return idx === -1 ? HISTORICAL_SERIES.length - 1 : idx;
      })
    );

    const startIdx = Math.max(0, earliestIdx);
    const slice = HISTORICAL_SERIES.slice(startIdx);

    history = slice.map((point, idx) => {
      const isLast = idx === slice.length - 1;
      let val = 0;
      let inv = 0;
      let livretVal = 0;

      for (const lot of validLots) {
        if (lot.purchaseYearMonth <= point.yearMonth) {
          const buyPoint =
            HISTORICAL_SERIES.find((p) => p.yearMonth === lot.purchaseYearMonth) ?? point;
          const entry = buyPoint.prices[lot.assetId];
          const px = isLast
            ? livePrices[lot.assetId] ?? point.prices[lot.assetId]
            : point.prices[lot.assetId];
          val += (lot.investedAmount / entry) * px;
          inv += lot.investedAmount;
          livretVal += (lot.investedAmount / buyPoint.livretIndex) * point.livretIndex;
        }
      }

      return {
        yearMonth: point.yearMonth,
        label: isLast ? 'Temps réel' : point.label,
        portfolioValue: Number(val.toFixed(2)),
        investedCumulative: Number(inv.toFixed(2)),
        livretEquivalent: Number(livretVal.toFixed(2)),
      };
    });
  }

  const totalGainLossEuro = Number((totalCurrentValue - totalInvested).toFixed(2));
  const totalGainLossPct =
    totalInvested > 0 ? Number(((totalGainLossEuro / totalInvested) * 100).toFixed(2)) : 0;

  return {
    lots: evaluatedLots,
    totalInvested: Number(totalInvested.toFixed(2)),
    totalCurrentValue: Number(totalCurrentValue.toFixed(2)),
    totalGainLossEuro,
    totalGainLossPct,
    categoryValues: {
      actions: Number(categoryValues.actions.toFixed(2)),
      obligations: Number(categoryValues.obligations.toFixed(2)),
      crypto: Number(categoryValues.crypto.toFixed(2)),
      refuge: Number(categoryValues.refuge.toFixed(2)),
    },
    categoryWeightsPct,
    estimatedAnnualReturnPct: Number(weightedRet.toFixed(2)),
    estimatedVolatilityPct: Number((weightedVol * diversificationDiscount).toFixed(2)),
    history,
  };
}

/**
 * Multi-factor quantitative scoring of assets given macroeconomic conditions, risk profile, and goal.
 */
export function scoreAssetsForMacro(
  macro: MacroIndicators,
  riskProfile: RiskProfile,
  goal: InvestmentGoal = 'croissance_long_terme'
): ScoredAsset[] {
  const growthDelta = macro.gdpGrowthPct - 1.6;
  const inflationDelta = macro.inflationPct - 2.0;
  const rateDelta = macro.centralBankRatePct - 2.5;
  const stressLevel = Math.max(0, (macro.vixLevel - 18) / 10);

  const riskAversionMultiplier: Record<RiskProfile, number> = {
    prudent: 1.65,
    equilibre: 1.05,
    dynamique: 0.6,
    offensif: 0.3,
  };

  const riskPenaltyFactor = riskAversionMultiplier[riskProfile];

  const scored = ASSETS.map((asset): ScoredAsset => {
    let expectedReturn = asset.baseExpectedReturnPct - asset.annualFeePct;

    if (asset.id === 'CASH') {
      expectedReturn = Math.max(0.2, macro.centralBankRatePct - asset.annualFeePct);
    } else if (asset.category === 'obligations') {
      const carryBoost = (macro.centralBankRatePct - 2.0) * 0.45;
      const inflationDrag = inflationDelta * asset.inflationBeta * 0.9;
      const crisisBoost = stressLevel * asset.crisisConvexity * 2.4;
      expectedReturn =
        asset.baseExpectedReturnPct + carryBoost + inflationDrag + crisisBoost - asset.annualFeePct;
    } else {
      const growthImpact = growthDelta * asset.growthBeta * 1.15;
      const inflationImpact = inflationDelta * asset.inflationBeta * 0.95;
      const rateImpact = rateDelta * asset.rateSensitivity * 0.85;
      const crisisImpact = stressLevel * asset.crisisConvexity * 3.2;
      expectedReturn =
        asset.baseExpectedReturnPct +
        growthImpact +
        inflationImpact +
        rateImpact +
        crisisImpact -
        asset.annualFeePct;
    }

    expectedReturn = Number(Math.max(-9.0, Math.min(22.0, expectedReturn)).toFixed(2));

    const volMultiplier =
      asset.id === 'CASH' ? 1 : 1 + Math.max(-0.15, (macro.vixLevel - 16) * 0.022);
    const expectedVol = Number((asset.baseVolatilityPct * volMultiplier).toFixed(2));

    const riskFreeRate = Math.max(0.5, macro.centralBankRatePct * 0.85);
    const sharpe =
      expectedVol > 0.5
        ? Number(((expectedReturn - riskFreeRate) / expectedVol).toFixed(2))
        : Number(((expectedReturn - riskFreeRate + 0.6) / 1.2).toFixed(2));

    // Goal-based adjustment
    let goalBonus = 0;
    if (goal === 'revenu_complementaire' && asset.dividendYieldPct >= 2.5) goalBonus += 9;
    if (goal === 'projet_moyen_terme' && expectedVol > 20) goalBonus -= 14;
    if (goal === 'projet_moyen_terme' && (asset.category === 'obligations' || asset.id === 'CASH')) {
      goalBonus += 10;
    }
    if (goal === 'croissance_long_terme' && asset.category === 'actions') goalBonus += 5;

    const volPenalty = expectedVol * 0.34 * riskPenaltyFactor;
    const rawUtility =
      54 +
      expectedReturn * 4.1 -
      volPenalty +
      sharpe * 14 +
      goalBonus +
      (stressLevel > 0.5 ? asset.crisisConvexity * 16 : 0);

    const predictiveScore = Math.round(Math.max(12, Math.min(98, rawUtility)));

    let stance: SignalStance = 'neutre';
    let stanceLabel = '◆ Pondération neutre';
    if (predictiveScore >= 70) {
      stance = 'favorable';
      stanceLabel = '▲ Surpondérer';
    } else if (predictiveScore < 50) {
      stance = 'prudent';
      stanceLabel = '▼ Sous-pondérer';
    }

    return {
      asset,
      predictiveScore,
      expectedAnnualReturnPct: expectedReturn,
      expectedVolatilityPct: expectedVol,
      sharpeRatio: sharpe,
      stance,
      stanceLabel,
      rationale: buildMacroRationale(asset, macro, expectedReturn, stance),
    };
  });

  return scored.sort((a, b) => b.predictiveScore - a.predictiveScore);
}

function buildMacroRationale(
  asset: FinancialAsset,
  macro: MacroIndicators,
  expectedReturn: number,
  stance: SignalStance
): string {
  if (asset.id === 'CASH') {
    return `Portage monétaire sans risque à ${expectedReturn.toFixed(1)} %/an indexé sur le taux directeur (${macro.centralBankRatePct.toFixed(2)} %).`;
  }
  if (asset.id === 'GOLD') {
    if (macro.inflationPct >= 3.2 || macro.vixLevel >= 24) {
      return `Protection privilégiée contre l’inflation (${macro.inflationPct.toFixed(1)} %) et le stress de marché (VIX ${macro.vixLevel.toFixed(0)}).`;
    }
    return `Diversificateur structurel décorrélé des actions et des obligations.`;
  }
  if (asset.category === 'crypto') {
    if (macro.centralBankRatePct <= 2.25 && macro.vixLevel <= 18) {
      return `Bénéficie de l’assouplissement monétaire et de l’appétit pour le risque, malgré une volatilité de ${asset.baseVolatilityPct.toFixed(0)} %.`;
    }
    return `Actif de diversification satellite à forte volatilité (${asset.baseVolatilityPct.toFixed(0)} %) ; limiter la pondération selon la tolérance au risque.`;
  }
  if (asset.category === 'obligations') {
    if (macro.inflationPct >= 3.8) {
      return `L’inflation élevée (${macro.inflationPct.toFixed(1)} %) réduit le rendement réel des coupons obligataires.`;
    }
    return `Rendement obligataire stabilisé autour de ${expectedReturn.toFixed(1)} %/an amortissant les fluctuations boursières.`;
  }
  if (stance === 'favorable') {
    return `Soutenu par la croissance (${macro.gdpGrowthPct.toFixed(1)} %) et des taux modérés ; rendement espéré de ${expectedReturn.toFixed(1)} %/an.`;
  }
  return `Exposition actions de long terme (${expectedReturn.toFixed(1)} %/an estimé) à lisser par achats programmés.`;
}

/**
 * Generates an optimal regime-aware multi-asset allocation (Actions, Obligations, Crypto, Refuge) summing strictly to 100%.
 */
export function computeOptimalAllocation(
  scoredAssets: ScoredAsset[],
  riskProfile: RiskProfile,
  goal: InvestmentGoal = 'croissance_long_terme'
): RecommendedPortfolio {
  const baseBudgets: Record<RiskProfile, Record<AssetCategory, number>> = {
    prudent: { actions: 24, obligations: 46, crypto: 0, refuge: 30 },
    equilibre: { actions: 52, obligations: 28, crypto: 4, refuge: 16 },
    dynamique: { actions: 68, obligations: 14, crypto: 8, refuge: 10 },
    offensif: { actions: 74, obligations: 5, crypto: 15, refuge: 6 },
  };

  const b = { ...baseBudgets[riskProfile] };
  if (goal === 'projet_moyen_terme') {
    b.actions = Math.max(15, b.actions - 18);
    b.crypto = Math.min(3, b.crypto);
    b.obligations += 12;
    b.refuge += 6;
  } else if (goal === 'revenu_complementaire') {
    b.obligations += 10;
    b.crypto = Math.min(4, b.crypto);
    b.actions = Math.max(20, b.actions - 8);
  }

  const avgCatScore = (cat: AssetCategory): number => {
    const items = scoredAssets.filter((s) => s.asset.category === cat);
    if (items.length === 0) return 50;
    return items.reduce((acc, s) => acc + s.predictiveScore, 0) / items.length;
  };

  let rawActions = Math.max(10, b.actions + (avgCatScore('actions') - 60) * 0.3);
  let rawBonds = Math.max(4, b.obligations + (avgCatScore('obligations') - 60) * 0.25);
  let rawCrypto =
    b.crypto === 0
      ? 0
      : Math.max(2, Math.min(20, b.crypto + (avgCatScore('crypto') - 55) * 0.15));
  let rawRefuge = Math.max(4, b.refuge + (avgCatScore('refuge') - 60) * 0.3);

  const rawTotal = rawActions + rawBonds + rawCrypto + rawRefuge;
  const catBudgets: Record<AssetCategory, number> = {
    actions: Math.round((rawActions / rawTotal) * 100),
    obligations: Math.round((rawBonds / rawTotal) * 100),
    crypto: Math.round((rawCrypto / rawTotal) * 100),
    refuge: 0,
  };
  catBudgets.refuge =
    100 - catBudgets.actions - catBudgets.obligations - catBudgets.crypto;

  const pickTop = (cat: AssetCategory, maxCount: number): ScoredAsset[] => {
    const candidates = scoredAssets
      .filter((s) => s.asset.category === cat)
      .filter(
        (s) =>
          !(
            (riskProfile === 'prudent' || riskProfile === 'equilibre') &&
            s.asset.isIndividualStock
          )
      );
    if (cat === 'actions' && candidates.length > 0) {
      const xbb = candidates.find((c) => c.asset.id === 'XBB');
      const others = candidates.filter((c) => c.asset.id !== 'XBB');
      return xbb ? [xbb, ...others].slice(0, maxCount) : candidates.slice(0, maxCount);
    }
    return candidates.slice(0, maxCount);
  };

  const groups: { cat: AssetCategory; items: ScoredAsset[] }[] = [
    { cat: 'actions', items: pickTop('actions', riskProfile === 'prudent' ? 2 : 2) },
    { cat: 'obligations', items: pickTop('obligations', 2) },
    { cat: 'crypto', items: pickTop('crypto', riskProfile === 'offensif' ? 2 : 1) },
    { cat: 'refuge', items: pickTop('refuge', 2) },
  ];

  const slices: AllocationSlice[] = [];

  for (const group of groups) {
    const budget = catBudgets[group.cat];
    if (budget <= 0 || group.items.length === 0) continue;

    const scoreSum = group.items.reduce((acc, item) => acc + Math.max(10, item.predictiveScore), 0);
    let allocated = 0;

    group.items.forEach((item, idx) => {
      const isLast = idx === group.items.length - 1;
      const weight = isLast
        ? budget - allocated
        : Math.max(2, Math.round((Math.max(10, item.predictiveScore) / scoreSum) * budget));
      allocated += weight;

      if (weight > 0) {
        slices.push({
          assetId: item.asset.id,
          ticker: item.asset.ticker,
          name: item.asset.name,
          category: item.asset.category,
          categoryLabel: item.asset.categoryLabel,
          weightPct: weight,
          expectedReturnPct: item.expectedAnnualReturnPct,
          rationale: item.rationale,
        });
      }
    });
  }

  const totalWeight = slices.reduce((s, item) => s + item.weightPct, 0);
  if (slices.length > 0 && totalWeight !== 100) {
    slices[0].weightPct += 100 - totalWeight;
  }

  slices.sort((a, b) => b.weightPct - a.weightPct);

  let portReturn = 0;
  let weightedVol = 0;
  for (const slice of slices) {
    const scored = scoredAssets.find((s) => s.asset.id === slice.assetId);
    const w = slice.weightPct / 100;
    portReturn += w * slice.expectedReturnPct;
    weightedVol += w * (scored ? scored.expectedVolatilityPct : 12);
  }

  const riskyShare = (catBudgets.actions + catBudgets.crypto) / 100;
  const diversificationFactor = 0.66 + 0.24 * Math.pow(riskyShare, 1.5);
  const portVol = Number(Math.max(1.2, weightedVol * diversificationFactor).toFixed(2));
  portReturn = Number(portReturn.toFixed(2));

  const sharpeRatio = Number(((portReturn - 2.4) / portVol).toFixed(2));
  const estimatedMaxDrawdownPct = Number((-Math.min(55, portVol * 1.6)).toFixed(1));

  return {
    slices,
    expectedAnnualReturnPct: portReturn,
    expectedVolatilityPct: portVol,
    sharpeRatio,
    estimatedMaxDrawdownPct,
    categoryTotals: catBudgets,
  };
}

export function runMonteCarloProjection(params: {
  initialCapital: number;
  monthlyContribution: number;
  horizonYears: number;
  expectedReturnPct: number;
  annualVolatilityPct: number;
  baseYear?: number;
}): MonteCarloYearPoint[] {
  const {
    initialCapital,
    monthlyContribution,
    horizonYears,
    expectedReturnPct,
    annualVolatilityPct,
    baseYear = 2026,
  } = params;

  const cap0 = Math.max(0, initialCapital);
  const pmtMonthly = Math.max(0, monthlyContribution);
  const years = Math.max(1, Math.min(35, Math.round(horizonYears)));
  const mu = expectedReturnPct / 100;
  const sigma = Math.max(0, annualVolatilityPct / 100);

  const Z = {
    p10: -1.28155,
    p25: -0.67449,
    p50: 0,
    p75: 0.67449,
    p90: 1.28155,
  };

  const results: MonteCarloYearPoint[] = [
    {
      year: 0,
      calendarYear: baseYear,
      totalInvested: Math.round(cap0),
      p10: Math.round(cap0),
      p25: Math.round(cap0),
      p50: Math.round(cap0),
      p75: Math.round(cap0),
      p90: Math.round(cap0),
    },
  ];

  const drift = mu - 0.5 * sigma * sigma;

  for (let t = 1; t <= years; t++) {
    const totalInvested = cap0 + pmtMonthly * 12 * t;

    const projectQuantile = (z: number): number => {
      if (sigma === 0) {
        const rM = mu / 12;
        if (Math.abs(rM) < 1e-8) return totalInvested;
        const n = t * 12;
        return cap0 * Math.pow(1 + rM, n) + pmtMonthly * ((Math.pow(1 + rM, n) - 1) / rM);
      }

      const fvInitial = cap0 * Math.exp(drift * t + sigma * Math.sqrt(t) * z);
      const effectiveAnnualLogRate = drift + (sigma * z) / Math.sqrt(Math.max(1, t * 1.35));
      const rMonthlyQuantile = Math.exp(effectiveAnnualLogRate / 12) - 1;
      const nMonths = t * 12;
      const fvContributions =
        Math.abs(rMonthlyQuantile) < 1e-8
          ? pmtMonthly * nMonths
          : pmtMonthly * ((Math.pow(1 + rMonthlyQuantile, nMonths) - 1) / rMonthlyQuantile);

      return Math.max(0, fvInitial + fvContributions);
    };

    results.push({
      year: t,
      calendarYear: baseYear + t,
      totalInvested: Math.round(totalInvested),
      p10: Math.round(projectQuantile(Z.p10)),
      p25: Math.round(projectQuantile(Z.p25)),
      p50: Math.round(projectQuantile(Z.p50)),
      p75: Math.round(projectQuantile(Z.p75)),
      p90: Math.round(projectQuantile(Z.p90)),
    });
  }

  return results;
}

export function runHistoricalBacktest(input: BacktestInput): BacktestResult {
  const { assetId, startYearMonth, endYearMonth, mode, amount } = input;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Le montant investi doit être strictement supérieur à 0 $ CAD.');
  }

  const asset = getAssetById(assetId);
  if (!asset) {
    throw new Error(`Actif introuvable : ${assetId}`);
  }

  const startIdx = HISTORICAL_SERIES.findIndex((p) => p.yearMonth === startYearMonth);
  const endIdx = HISTORICAL_SERIES.findIndex((p) => p.yearMonth === endYearMonth);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Période historique sélectionnée invalide.');
  }
  if (startIdx >= endIdx) {
    throw new Error('La date d’achat doit être antérieure à la date de fin.');
  }

  const slice = HISTORICAL_SERIES.slice(startIdx, endIdx + 1);
  const monthsCount = slice.length;

  let unitsHeld = 0;
  let totalInvested = 0;
  let livretUnits = 0;
  let inflationBaselineUnits = 0;
  let peakValue = 0;
  let maxDrawdownPct = 0;
  let worstDrawdownDate = slice[0].label;

  const altEquivalentAmount =
    mode === 'lump_sum' ? amount / monthsCount : amount * monthsCount;
  let altUnits = 0;
  let altInvested = 0;

  const series: BacktestMonthlyPoint[] = slice.map((point, idx) => {
    const price = point.prices[asset.id];

    if (mode === 'lump_sum') {
      if (idx === 0) {
        unitsHeld = amount / price;
        totalInvested = amount;
        livretUnits = amount / point.livretIndex;
        inflationBaselineUnits = amount / point.inflationIndex;
      }
      altUnits += altEquivalentAmount / price;
      altInvested += altEquivalentAmount;
    } else {
      unitsHeld += amount / price;
      totalInvested += amount;
      livretUnits += amount / point.livretIndex;
      inflationBaselineUnits += amount / point.inflationIndex;
      if (idx === 0) {
        altUnits = altEquivalentAmount / price;
        altInvested = altEquivalentAmount;
      }
    }

    const portfolioValue = unitsHeld * price;
    const livretValue = livretUnits * point.livretIndex;
    const inflationAdjustedCapital = inflationBaselineUnits * point.inflationIndex;

    if (portfolioValue > peakValue) {
      peakValue = portfolioValue;
    }
    const drawdownPct =
      peakValue > 0 ? Number((((portfolioValue - peakValue) / peakValue) * 100).toFixed(2)) : 0;

    if (drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
      worstDrawdownDate = point.label;
    }

    return {
      yearMonth: point.yearMonth,
      label: point.label,
      unitPrice: Number(price.toFixed(2)),
      portfolioValue: Number(portfolioValue.toFixed(2)),
      totalInvested: Number(totalInvested.toFixed(2)),
      livretValue: Number(livretValue.toFixed(2)),
      inflationAdjustedCapital: Number(inflationAdjustedCapital.toFixed(2)),
      drawdownPct,
      regimeNote: point.regimeNote,
    };
  });

  const lastPoint = series[series.length - 1];
  const lastPrice = slice[slice.length - 1].prices[asset.id];
  const finalValue = lastPoint.portfolioValue;
  const netProfit = Number((finalValue - totalInvested).toFixed(2));
  const roiPct = Number(((netProfit / totalInvested) * 100).toFixed(2));

  const yearsElapsed = Math.max(1 / 12, (monthsCount - 1) / 12);
  const effectiveDurationYears =
    mode === 'lump_sum' ? yearsElapsed : Math.max(0.25, yearsElapsed * 0.54);
  const cagrPct = Number(
    (
      (Math.pow(Math.max(0.01, finalValue / totalInvested), 1 / effectiveDurationYears) - 1) *
      100
    ).toFixed(2)
  );

  const altFinalValue = Number((altUnits * lastPrice).toFixed(2));
  const altRoiPct = Number((((altFinalValue - altInvested) / altInvested) * 100).toFixed(2));

  return {
    asset,
    mode,
    amount,
    startLabel: slice[0].label,
    endLabel: slice[slice.length - 1].label,
    monthsCount,
    totalInvested: Number(totalInvested.toFixed(2)),
    finalValue,
    netProfit,
    roiPct,
    cagrPct,
    maxDrawdownPct,
    worstDrawdownDate,
    livretFinalValue: lastPoint.livretValue,
    outperformanceVsLivret: Number((finalValue - lastPoint.livretValue).toFixed(2)),
    realPurchasingPowerGain: Number(
      (finalValue - lastPoint.inflationAdjustedCapital).toFixed(2)
    ),
    alternativeModeFinalValue: altFinalValue,
    alternativeModeInvested: Number(altInvested.toFixed(2)),
    alternativeModeRoiPct: altRoiPct,
    series,
  };
}

export function simulateFeeImpact(params: {
  initialCapital: number;
  monthlyContribution: number;
  years: number;
  grossReturnPct: number;
  etfFeePct: number;
  activeFundFeePct: number;
}): {
  year: number;
  invested: number;
  etfValue: number;
  activeValue: number;
  feesLost: number;
}[] {
  const {
    initialCapital,
    monthlyContribution,
    years,
    grossReturnPct,
    etfFeePct,
    activeFundFeePct,
  } = params;

  const rEtfMonthly = (grossReturnPct - etfFeePct) / 100 / 12;
  const rActiveMonthly = (grossReturnPct - activeFundFeePct) / 100 / 12;

  let vEtf = initialCapital;
  let vActive = initialCapital;
  let invested = initialCapital;

  const points = [
    {
      year: 0,
      invested: Math.round(invested),
      etfValue: Math.round(vEtf),
      activeValue: Math.round(vActive),
      feesLost: 0,
    },
  ];

  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      vEtf = vEtf * (1 + rEtfMonthly) + monthlyContribution;
      vActive = vActive * (1 + rActiveMonthly) + monthlyContribution;
      invested += monthlyContribution;
    }
    points.push({
      year: y,
      invested: Math.round(invested),
      etfValue: Math.round(vEtf),
      activeValue: Math.round(vActive),
      feesLost: Math.round(vEtf - vActive),
    });
  }

  return points;
}

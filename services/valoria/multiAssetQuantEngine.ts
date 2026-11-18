import {
  ASSETS,
  type FinancialAsset,
  HISTORICAL_SERIES,
  type MacroIndicators,
  type RiskProfile,
  VERIFIED_SPOT_CAD_2026_11,
  VERIFIED_TRAILING_RETURNS_CAD_2026_11,
  getAssetById,
} from './marketData';
import {
  type EvaluatedPortfolioLot,
  type PortfolioLot,
  evaluateLotMarketPosition,
} from './engine';
import {
  type EquityActionSignal,
  type EquityQuantAnalysis,
  analyzeEquityUniverse,
} from './equityQuantEngine';
import {
  CRYPTO_FUNDAMENTALS,
  type CryptoAnalystProfile,
  type FundOrMacroAnalystProfile,
  MACRO_FUND_PROFILES,
  type MarketAssetSubClass,
  getAssetSubClass,
} from './globalMarketCatalog';
import { formatCad } from './valoriaFormatters';

interface ConcreteAnalystRatio {
  group: 'Valorisation' | 'Qualité & Rendement' | 'Technique & Momentum' | 'Risque & Fiscalité';
  label: string;
  value: string;
  benchmarkHint: string;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface UniversalAssetAnalysis {
  asset: FinancialAsset;
  subClass: MarketAssetSubClass;
  subClassLabel: string;
  sector: string;
  regionLabel: string;
  underlyingCurrency: 'CAD' | 'USD' | 'EUR' | 'Multi-devises';
  spotPriceCad: number;
  sparkline24m: number[];

  // Universal Valuation & Trade Plan ($ CAD)
  fairValueCad: number;
  fairValueModelLabel: string;
  upsidePct: number;
  entryZoneLowCad: number;
  entryZoneHighCad: number;
  target12mCad: number;
  targetReturn12mPct: number;
  stopLossCad: number;
  stopDistancePct: number;
  rewardRiskRatio: number;
  maxRecommendedWeightPct: number;

  // Canadian Tax Wrapper Optimization
  optimalCanadianWrapper: 'CELI' | 'REER' | 'Non-enregistré' | 'CELI / REER';
  taxWrapperRationale: string;

  // Yield & Fee metrics
  grossYieldPct: number; // Dividend, coupon, or crypto staking yield
  netRealYieldPct: number; // Net of annualFeePct or token issuance inflation
  annualFeeOrInflationPct: number;

  // Technicals & Momentum
  rsi14: number;
  macdLine: number;
  macdHistogram: number;
  macdLabel: string;
  bollingerPctB: number;
  sma6GapPct: number;
  sma12GapPct: number;
  trendRegime: 'Haussier' | 'Consolidation' | 'Baissier';
  momentum1dPct: number;
  momentum5dPct: number;
  momentum1mPct: number;
  momentum3mPct: number;
  momentum6mPct: number;
  momentum12mPct: number;
  drawdownAthPct: number;

  // Risk
  volatilityPct: number;
  betaVsWorld: number;
  sharpeRatio: number;
  monthlyVar95Pct: number;
  cvar95MonthlyPct: number;

  // Institutional Scoring
  pillars: {
    valuation: number;
    quality: number;
    growthOrCarry: number;
    technicals: number;
    macroFit: number;
  };
  quantScore: number;
  signal: EquityActionSignal;
  convictionPct: number;
  catalystHeadline: string;
  keyMetricBadge: string; // Concise primary metric for screener row

  // Domain-specific payloads
  equityDetails?: EquityQuantAnalysis;
  cryptoDetails?: CryptoAnalystProfile & { netStakingRealYieldPct: number };
  fundDetails?: FundOrMacroAnalystProfile & {
    feeDrag10yPer10kCad: number;
    rateCut100bpsImpactPct: number;
    rateHike100bpsImpactPct: number;
  };

  // Held status
  isHeld: boolean;
  heldValueCad: number;
  heldWeightPct: number;

  // 25+ Concrete Ratios for Institutional Tear-Sheet Modal
  concreteRatios: ConcreteAnalystRatio[];
}

export interface MultiAssetUniverseSummary {
  totalAssets: number;
  countsBySubClass: Record<MarketAssetSubClass | 'all', number>;
  countsBySignal: Record<EquityActionSignal, number>;
  allAnalyses: UniversalAssetAnalysis[];
  byId: Map<string, UniversalAssetAnalysis>;
}

interface PortfolioStressScenarioResult {
  id: string;
  title: string;
  historicalRef: string;
  description: string;
  impactBeforePct: number;
  impactBeforeCad: number;
  impactAfterPct: number;
  impactAfterCad: number;
  capitalProtectedCad: number; // positive = after loses less or gains more than before
}

interface CurrencyExposureBreakdown {
  currency: 'CAD' | 'USD' | 'EUR' | 'Crypto & Or';
  weightBeforePct: number;
  weightAfterPct: number;
  valueBeforeCad: number;
  valueAfterCad: number;
}

interface SectorExposureBreakdown {
  sector: string;
  weightBeforePct: number;
  weightAfterPct: number;
  valueBeforeCad: number;
}

interface TaxWrapperAuditLine {
  assetId: string;
  ticker: string;
  name: string;
  valueCad: number;
  grossAnnualIncomeCad: number;
  recommendedWrapper: 'CELI' | 'REER' | 'Non-enregistré' | 'CELI / REER';
  estimatedAnnualTaxSavedCad: number;
  concreteRule: string;
}

export interface ConcretePortfolioXRay {
  stressScenarios: PortfolioStressScenarioResult[];
  incomeAndFees: {
    grossAnnualIncomeBeforeCad: number;
    grossAnnualIncomeAfterCad: number;
    monthlyPassiveIncomeBeforeCad: number;
    monthlyPassiveIncomeAfterCad: number;
    portfolioYieldBeforePct: number;
    portfolioYieldAfterPct: number;
    annualFeesBeforeCad: number;
    annualFeesAfterCad: number;
    compounded10yFeesBeforeCad: number;
    compounded10yFeesAfterCad: number;
    netAnnualCarryBeforeCad: number;
    netAnnualCarryAfterCad: number;
  };
  currencyBreakdown: CurrencyExposureBreakdown[];
  sectorBreakdown: SectorExposureBreakdown[];
  taxWrapperLines: TaxWrapperAuditLine[];
  totalAnnualTaxOptimizedCad: number;
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

function getSubClassLabel(subClass: MarketAssetSubClass): string {
  switch (subClass) {
    case 'action_ca':
      return 'Action Canada (TSX)';
    case 'action_us':
      return 'Action États-Unis';
    case 'action_eu_asia':
      return 'Action Europe & Asie';
    case 'crypto_l1_defi':
      return 'Crypto & Web3';
    case 'etf_indice':
      return 'ETF Indiciel';
    case 'obligation_taux':
      return 'Obligation & Monétaire';
    case 'matiere_premiere':
      return 'Matière 1re & Énergie';
    case 'immobilier_reit':
      return 'Immobilier (REIT)';
  }
}

function inferOptimalCanadianWrapperForStock(params: {
  asset: FinancialAsset;
  subClass: MarketAssetSubClass;
  dividendYieldPct: number;
  upsideDcfPct: number;
}): {
  wrapper: 'CELI' | 'REER' | 'Non-enregistré' | 'CELI / REER';
  rationale: string;
} {
  const { asset, subClass, dividendYieldPct } = params;
  if (subClass === 'immobilier_reit') {
    if (asset.ticker.endsWith('.TO')) {
      return {
        wrapper: 'CELI / REER',
        rationale:
          'Les distributions de FPI (REIT) sont imposées au taux marginal hors abri (pas de crédit pour dividende déterminé) : abriter prioritairement en CELI ou REER.',
      };
    }
    return {
      wrapper: 'REER',
      rationale:
        'REIT américain à fort rendement : loger en REER exonère la retenue à la source américaine de 15 % (IRS) et l’impôt canadien sur les loyers.',
    };
  }

  if (subClass === 'action_ca') {
    if (dividendYieldPct >= 3.2) {
      return {
        wrapper: 'CELI / REER',
        rationale:
          'Action canadienne à dividende déterminé : exonération totale en CELI, ou très avantageux en compte Non-enregistré si votre CELI est plein (crédit d’impôt pour dividendes déterminés).',
      };
    }
    return {
      wrapper: 'CELI',
      rationale:
        'Croissance canadienne à fort potentiel de plus-value : loger en CELI exonère à 100 % les gains en capital futurs.',
    };
  }

  if (subClass === 'action_us') {
    if (dividendYieldPct >= 2.2) {
      return {
        wrapper: 'REER',
        rationale:
          'Action américaine de rendement : en REER, la convention fiscale Canada–É.-U. supprime la retenue IRS de 15 % sur les dividendes (contrairement au CELI).',
      };
    }
    return {
      wrapper: 'CELI',
      rationale:
        'Action US de croissance à faible dividende : la retenue IRS en CELI est négligeable (< 0,15 %/an) tandis que 100 % de la plus-value est exonérée d’impôt.',
    };
  }

  // Europe / Asia
  if (dividendYieldPct >= 2.8) {
    return {
      wrapper: 'Non-enregistré',
      rationale:
        'Dividende international soumis à retenue étrangère : en compte Non-enregistré, le crédit pour impôt étranger (T2209) permet de récupérer la retenue (perdue en CELI).',
    };
  }
  return {
    wrapper: 'CELI',
    rationale:
      'Valeur internationale de croissance : privilégier le CELI pour capitaliser la hausse du titre en franchise totale d’impôt.',
  };
}

function buildTechnicalAndRiskFromSeries(
  assetId: string,
  fullPrices: number[],
  worldRets: number[],
  meanWorld: number,
  varWorld: number,
  fallbackBeta: number,
  baseVolPct: number,
  vixLevel: number,
  forwardAnnualReturnPct: number,
  riskFreePct: number
) {
  const spotPrice = Number(fullPrices[fullPrices.length - 1].toFixed(2));
  const isCashEtf = assetId === 'CASH';
  const verifiedSnap = isCashEtf
    ? { r1dPct: 0.01, r5dPct: 0.06, r1mPct: 0.25, r3mPct: 0.78, r6mPct: 1.62, r12mPct: 3.45, high52wCad: spotPrice }
    : VERIFIED_TRAILING_RETURNS_CAD_2026_11[assetId];
  const verifiedSpot = isCashEtf ? spotPrice : (VERIFIED_SPOT_CAD_2026_11[assetId] || spotPrice);
  const liveDriftRatio =
    !isCashEtf && verifiedSpot > 0 && Math.abs(spotPrice / verifiedSpot - 1) < 0.35
      ? spotPrice / verifiedSpot
      : 1;

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

  const sma6 = slice6.reduce((s, x) => s + x, 0) / Math.max(1, slice6.length);
  const sma12 = slice12.reduce((s, x) => s + x, 0) / Math.max(1, slice12.length);
  const sma20 = slice20.reduce((s, x) => s + x, 0) / Math.max(1, slice20.length);

  const sma6GapPct = sma6 > 0 ? ((spotPrice - sma6) / sma6) * 100 : 0;
  const sma12GapPct = sma12 > 0 ? ((spotPrice - sma12) / sma12) * 100 : 0;

  const std20 = Math.sqrt(
    slice20.reduce((s, x) => s + (x - sma20) * (x - sma20), 0) /
      Math.max(1, slice20.length - 1)
  );
  const upperBand = sma20 + 2 * std20;
  const lowerBand = Math.max(0.0001, sma20 - 2 * std20);
  const bollingerPctB =
    upperBand > lowerBand
      ? Math.max(0, Math.min(100, ((spotPrice - lowerBand) / (upperBand - lowerBand)) * 100))
      : 50;

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
  const rsi14 = Math.max(18, Math.min(85, Math.round(100 - 100 / (1 + rsAdjusted))));

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

  const ath = Math.max(...fullPrices, spotPrice);
  const drawdownAthPct = ath > 0 ? ((spotPrice - ath) / ath) * 100 : 0;

  const assetRets: number[] = [];
  for (let t = 1; t < fullPrices.length; t++) {
    assetRets.push(fullPrices[t - 1] > 0 ? fullPrices[t] / fullPrices[t - 1] - 1 : 0);
  }
  const meanA = assetRets.reduce((s, x) => s + x, 0) / Math.max(1, assetRets.length);
  let covAW = 0;
  for (let t = 0; t < assetRets.length; t++) {
    covAW += (assetRets[t] - meanA) * ((worldRets[t] ?? 0) - meanWorld);
  }
  covAW /= Math.max(1, assetRets.length - 1);
  const rawBeta = varWorld > 1e-9 ? covAW / varWorld : fallbackBeta;
  const betaVsWorld = Number(
    Math.max(-0.25, Math.min(2.45, 0.5 * rawBeta + 0.5 * fallbackBeta)).toFixed(2)
  );

  const volMultiplier = 1 + Math.max(-0.12, (vixLevel - 16) * 0.02);
  const volatilityPct = Number((baseVolPct * volMultiplier).toFixed(1));
  const sharpeRatio = Number(
    ((forwardAnnualReturnPct - riskFreePct) / Math.max(2.5, volatilityPct)).toFixed(2)
  );
  const monthlyVar95Pct = Number(
    Math.max(0.6, (volatilityPct / Math.sqrt(12)) * 1.645).toFixed(1)
  );
  const cvar95MonthlyPct = Number((monthlyVar95Pct * 1.28).toFixed(1));

  return {
    spotPrice,
    momentum1dPct: Number(momentum1dPct.toFixed(1)),
    momentum5dPct: Number(momentum5dPct.toFixed(1)),
    momentum1mPct: Number(momentum1mPct.toFixed(1)),
    momentum3mPct: Number(momentum3mPct.toFixed(1)),
    momentum6mPct: Number(momentum6mPct.toFixed(1)),
    momentum12mPct: Number(momentum12mPct.toFixed(1)),
    sma6GapPct: Number(sma6GapPct.toFixed(1)),
    sma12GapPct: Number(sma12GapPct.toFixed(1)),
    bollingerPctB: Number(bollingerPctB.toFixed(0)),
    rsi14,
    macdLine: Number(macdLine.toFixed(2)),
    macdHistogram: Number(macdHistogram.toFixed(2)),
    macdLabel,
    trendRegime,
    drawdownAthPct: Number(drawdownAthPct.toFixed(1)),
    betaVsWorld,
    volatilityPct,
    sharpeRatio,
    monthlyVar95Pct,
    cvar95MonthlyPct,
  };
}

/**
 * Analyzes EVERY asset in Valoria's market universe (113+ calibrated global stocks, cryptos, ETFs,
 * bonds, commodities, REITs + any dynamically onboarded ticker) in $ CAD with 25+ concrete analyst ratios.
 */
export function analyzeFullMarketUniverse(params: {
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  riskProfile?: RiskProfile;
  evaluatedLots?: EvaluatedPortfolioLot[];
  totalPortfolioValue?: number;
}): MultiAssetUniverseSummary {
  const {
    livePrices,
    macro,
    riskProfile = 'equilibre',
    evaluatedLots = [],
    totalPortfolioValue = 0,
  } = params;

  const eqSummary = analyzeEquityUniverse({
    livePrices,
    macro,
    riskProfile,
    evaluatedLots,
    totalPortfolioValue,
  });
  const eqById = new Map<string, EquityQuantAnalysis>(
    eqSummary.allAnalyses.map((e) => [e.asset.id, e])
  );

  const nSeries = HISTORICAL_SERIES.length;
  const worldRets: number[] = [];
  for (let t = 1; t < nSeries; t++) {
    const p0 = HISTORICAL_SERIES[t - 1].prices.XBB;
    const p1 = HISTORICAL_SERIES[t].prices.XBB;
    worldRets.push(p0 > 0 ? p1 / p0 - 1 : 0);
  }
  const meanWorld = worldRets.reduce((s, x) => s + x, 0) / Math.max(1, worldRets.length);
  const varWorld =
    worldRets.reduce((s, x) => s + (x - meanWorld) * (x - meanWorld), 0) /
    Math.max(1, worldRets.length - 1);

  const riskFreePct = Math.max(1.2, macro.centralBankRatePct * 0.95);
  const rateMacroDelta = macro.centralBankRatePct - 2.5;
  const growthMacroDelta = macro.gdpGrowthPct - 1.6;
  const inflationMacroDelta = macro.inflationPct - 2.0;

  const heldByAssetId = new Map<string, { value: number; weightPct: number }>();
  for (const item of evaluatedLots) {
    const prev = heldByAssetId.get(item.asset.id) ?? { value: 0, weightPct: 0 };
    prev.value += item.currentValue;
    prev.weightPct =
      totalPortfolioValue > 0 ? (prev.value / totalPortfolioValue) * 100 : item.weightPct;
    heldByAssetId.set(item.asset.id, prev);
  }

  const allAnalyses: UniversalAssetAnalysis[] = ASSETS.map((asset) => {
    const subClass = getAssetSubClass(asset);
    const subClassLabel = getSubClassLabel(subClass);
    const heldInfo = heldByAssetId.get(asset.id);
    const isHeld = Boolean(heldInfo && heldInfo.value > 0);
    const heldValueCad = Math.round(heldInfo?.value ?? 0);
    const heldWeightPct = Number((heldInfo?.weightPct ?? 0).toFixed(1));

    const eq = eqById.get(asset.id);

    // -------------------------------------------------------------------------
    // CASE A: Individual Stock or Listed REIT (2-Stage DCF + Quality + Technicals)
    // -------------------------------------------------------------------------
    if (eq) {
      const underlyingCurrency: 'CAD' | 'USD' | 'EUR' = asset.ticker.endsWith('.TO')
        ? 'CAD'
        : asset.region === 'États-Unis (CTO)'
          ? 'USD'
          : 'EUR';

      const regionLabel =
        subClass === 'action_ca'
          ? 'Canada (TSX)'
          : subClass === 'action_us'
            ? 'États-Unis'
            : subClass === 'immobilier_reit'
              ? asset.ticker.endsWith('.TO')
                ? 'Canada (TSX)'
                : 'États-Unis'
              : 'Europe & International';

      const taxWrap = inferOptimalCanadianWrapperForStock({
        asset,
        subClass,
        dividendYieldPct: eq.dividendYieldPct,
        upsideDcfPct: eq.upsideDcfPct,
      });

      const maxRecommendedWeightPct =
        riskProfile === 'prudent'
          ? 7.5
          : riskProfile === 'equilibre'
            ? 10.0
            : riskProfile === 'dynamique'
              ? 12.0
              : 14.0;

      const cvar95MonthlyPct = Number((eq.monthlyVar95Pct * 1.26).toFixed(1));

      const concreteRatios: ConcreteAnalystRatio[] = [
        {
          group: 'Valorisation',
          label: 'Juste Valeur DCF 2-étapes',
          value: `${formatCad(eq.intrinsicValueDcfEur, 2)} CAD (${eq.upsideDcfPct >= 0 ? '+' : ''}${eq.upsideDcfPct.toFixed(1)} %)`,
          benchmarkHint: 'Décote > +10 % recherchée',
          sentiment: eq.upsideDcfPct >= 10 ? 'positive' : eq.upsideDcfPct <= -6 ? 'negative' : 'neutral',
        },
        {
          group: 'Valorisation',
          label: 'PER 12M Forward',
          value: `${eq.peForward.toFixed(1)}x`,
          benchmarkHint: 'Médiane S&P/TSX ~18,5x',
          sentiment: eq.peForward <= 20 ? 'positive' : eq.peForward >= 40 ? 'negative' : 'neutral',
        },
        {
          group: 'Valorisation',
          label: 'Ratio PEG (PER / Croissance)',
          value: `${eq.pegRatio.toFixed(2)}x`,
          benchmarkHint: 'Attractif < 1,50x',
          sentiment: eq.pegRatio <= 1.5 ? 'positive' : eq.pegRatio >= 2.6 ? 'negative' : 'neutral',
        },
        {
          group: 'Valorisation',
          label: 'Multiple VE / EBITDA',
          value: `${eq.evEbitda.toFixed(1)}x`,
          benchmarkHint: 'Valeur d’entreprise / cash op.',
          sentiment: eq.evEbitda <= 14 ? 'positive' : eq.evEbitda >= 28 ? 'negative' : 'neutral',
        },
        {
          group: 'Valorisation',
          label: 'Rendement Free Cash-Flow (FCF Yield)',
          value: `${eq.fcfYieldPct.toFixed(1)} %`,
          benchmarkHint: 'Solide > 4,0 % / an',
          sentiment: eq.fcfYieldPct >= 4.0 ? 'positive' : eq.fcfYieldPct < 1.8 ? 'negative' : 'neutral',
        },
        {
          group: 'Valorisation',
          label: 'Rendement du Dividende',
          value: `${eq.dividendYieldPct.toFixed(2)} %`,
          benchmarkHint: 'Revenu brut distribué',
          sentiment: eq.dividendYieldPct >= 2.5 ? 'positive' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Rentabilité Capital Investi (ROIC)',
          value: `${eq.roicPct.toFixed(1)} %`,
          benchmarkHint: 'Avantage compétitif > 15 %',
          sentiment: eq.roicPct >= 15 ? 'positive' : eq.roicPct < 8 ? 'negative' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Coût Moyen Pondéré du Capital (WACC)',
          value: `${eq.waccPct.toFixed(2)} %`,
          benchmarkHint: 'Taux d’actualisation exigé',
          sentiment: eq.waccPct <= 8.5 ? 'positive' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Création de Valeur (ROIC − WACC)',
          value: `${eq.roicWaccSpreadPct >= 0 ? '+' : ''}${eq.roicWaccSpreadPct.toFixed(1)} pts`,
          benchmarkHint: 'Positif = création de richesse',
          sentiment: eq.roicWaccSpreadPct >= 6 ? 'positive' : eq.roicWaccSpreadPct < 0 ? 'negative' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Rentabilité Capitaux Propres (ROE)',
          value: `${eq.roePct.toFixed(1)} %`,
          benchmarkHint: 'Excellence > 18 %',
          sentiment: eq.roePct >= 18 ? 'positive' : eq.roePct < 9 ? 'negative' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Marge Opérationnelle (EBIT)',
          value: `${eq.operatingMarginPct.toFixed(1)} %`,
          benchmarkHint: 'Pricing power structurel',
          sentiment: eq.operatingMarginPct >= 22 ? 'positive' : eq.operatingMarginPct < 10 ? 'negative' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Croissance BPA Attendue (N+1)',
          value: `${eq.epsGrowthNextYrPct >= 0 ? '+' : ''}${eq.epsGrowthNextYrPct.toFixed(1)} %`,
          benchmarkHint: 'Consensus analystes 12M',
          sentiment: eq.epsGrowthNextYrPct >= 10 ? 'positive' : eq.epsGrowthNextYrPct < 0 ? 'negative' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Levier Dette Nette / EBITDA',
          value:
            eq.netDebtToEbitda < 0
              ? `Trésorerie nette (${eq.netDebtToEbitda.toFixed(1)}x)`
              : `${eq.netDebtToEbitda.toFixed(1)}x`,
          benchmarkHint: 'Sain < 2,0x (< 0 = cash net)',
          sentiment: eq.netDebtToEbitda <= 1.5 ? 'positive' : eq.netDebtToEbitda >= 2.8 ? 'negative' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Score Piotroski F-Score',
          value: `${eq.piotroskiFScore} / 9`,
          benchmarkHint: 'Santé comptable (≥ 7/9 fort)',
          sentiment: eq.piotroskiFScore >= 7 ? 'positive' : eq.piotroskiFScore <= 4 ? 'negative' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Score Altman Z-Score (Solvabilité)',
          value: `${eq.altmanZScore.toFixed(1)}`,
          benchmarkHint: 'Zone sûre > 3,0 (< 1,8 détresse)',
          sentiment: eq.altmanZScore >= 3.0 ? 'positive' : eq.altmanZScore < 2.0 ? 'negative' : 'neutral',
        },
        {
          group: 'Technique & Momentum',
          label: 'RSI-14 (Wilder)',
          value: `${eq.rsi14} / 100`,
          benchmarkHint: '30 survendu · 70 suracheté',
          sentiment: eq.rsi14 >= 42 && eq.rsi14 <= 68 ? 'positive' : eq.rsi14 > 78 ? 'negative' : 'neutral',
        },
        {
          group: 'Technique & Momentum',
          label: 'MACD (12, 26, 9)',
          value: `${eq.macdLabel} (${eq.macdHistogram >= 0 ? '+' : ''}${eq.macdHistogram.toFixed(2)})`,
          benchmarkHint: 'Dynamique directionnelle',
          sentiment: eq.macdHistogram > 0 ? 'positive' : 'negative',
        },
        {
          group: 'Technique & Momentum',
          label: 'Position Bandes de Bollinger %B',
          value: `${eq.bollingerPctB} %`,
          benchmarkHint: '0 % bande basse · 100 % haute',
          sentiment: eq.bollingerPctB >= 25 && eq.bollingerPctB <= 82 ? 'positive' : 'neutral',
        },
        {
          group: 'Technique & Momentum',
          label: 'Écart Moyenne Mobile 12 Mois',
          value: `${eq.sma12GapPct >= 0 ? '+' : ''}${eq.sma12GapPct.toFixed(1)} % (${eq.trendRegime})`,
          benchmarkHint: 'Tendance séculaire > MM12',
          sentiment: eq.trendRegime === 'Haussier' ? 'positive' : eq.trendRegime === 'Baissier' ? 'negative' : 'neutral',
        },
        {
          group: 'Technique & Momentum',
          label: 'Momentum 3M / 6M / 12M',
          value: `${eq.momentum3mPct >= 0 ? '+' : ''}${eq.momentum3mPct}% · ${eq.momentum6mPct >= 0 ? '+' : ''}${eq.momentum6mPct}% · ${eq.momentum12mPct >= 0 ? '+' : ''}${eq.momentum12mPct}%`,
          benchmarkHint: 'Force relative multi-horizons',
          sentiment: eq.momentum6mPct > 0 && eq.momentum12mPct > 0 ? 'positive' : eq.momentum12mPct < -10 ? 'negative' : 'neutral',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'Volatilité Annualisée & Bêta Monde',
          value: `${eq.volatilityPct.toFixed(1)} % · β ${eq.betaVsWorld.toFixed(2)}`,
          benchmarkHint: 'Sensibilité marché mondial',
          sentiment: eq.volatilityPct <= 24 ? 'positive' : eq.volatilityPct >= 38 ? 'negative' : 'neutral',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'VaR 95 % & CVaR Mensuelles',
          value: `-${eq.monthlyVar95Pct.toFixed(1)} % / -${cvar95MonthlyPct.toFixed(1)} %`,
          benchmarkHint: 'Perte extrême sur 1 mois',
          sentiment: eq.monthlyVar95Pct <= 10 ? 'positive' : eq.monthlyVar95Pct >= 16 ? 'negative' : 'neutral',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'Ratio Gain / Risque (Cible vs Stop 2×ATR)',
          value: `${eq.rewardRiskRatio.toFixed(2)}x`,
          benchmarkHint: 'Asymétrie favorable ≥ 1,5x',
          sentiment: eq.rewardRiskRatio >= 1.5 ? 'positive' : eq.rewardRiskRatio < 1.0 ? 'negative' : 'neutral',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'Drawdown depuis Plus Haut (ATH)',
          value: `${eq.drawdownAthPct.toFixed(1)} %`,
          benchmarkHint: 'Recul vs sommet historique',
          sentiment: eq.drawdownAthPct > -12 ? 'positive' : eq.drawdownAthPct < -30 ? 'negative' : 'neutral',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'Enveloppe Canadienne Optimale',
          value: taxWrap.wrapper,
          benchmarkHint: 'Optimisation fiscale ARC / IRS',
          sentiment: 'positive',
        },
      ];

      return {
        asset,
        subClass,
        subClassLabel,
        sector: eq.sector,
        regionLabel,
        underlyingCurrency,
        spotPriceCad: eq.spotPrice,
        sparkline24m: eq.sparkline24m,
        fairValueCad: eq.intrinsicValueDcfEur,
        fairValueModelLabel: 'DCF 2-étapes',
        upsidePct: eq.upsideDcfPct,
        entryZoneLowCad: eq.entryZoneLowEur,
        entryZoneHighCad: eq.entryZoneHighEur,
        target12mCad: eq.targetPrice12mEur,
        targetReturn12mPct: eq.targetReturn12mPct,
        stopLossCad: eq.stopLossEur,
        stopDistancePct: eq.stopDistancePct,
        rewardRiskRatio: eq.rewardRiskRatio,
        maxRecommendedWeightPct,
        optimalCanadianWrapper: taxWrap.wrapper,
        taxWrapperRationale: taxWrap.rationale,
        grossYieldPct: eq.dividendYieldPct,
        netRealYieldPct: Number((eq.dividendYieldPct - asset.annualFeePct).toFixed(2)),
        annualFeeOrInflationPct: asset.annualFeePct,
        rsi14: eq.rsi14,
        macdLine: eq.macdLine,
        macdHistogram: eq.macdHistogram,
        macdLabel: eq.macdLabel,
        bollingerPctB: eq.bollingerPctB,
        sma6GapPct: eq.sma6GapPct,
        sma12GapPct: eq.sma12GapPct,
        trendRegime: eq.trendRegime,
        momentum1dPct: eq.momentum1dPct,
        momentum5dPct: eq.momentum5dPct,
        momentum1mPct: eq.momentum1mPct,
        momentum3mPct: eq.momentum3mPct,
        momentum6mPct: eq.momentum6mPct,
        momentum12mPct: eq.momentum12mPct,
        drawdownAthPct: eq.drawdownAthPct,
        volatilityPct: eq.volatilityPct,
        betaVsWorld: eq.betaVsWorld,
        sharpeRatio: eq.sharpeRatio,
        monthlyVar95Pct: eq.monthlyVar95Pct,
        cvar95MonthlyPct,
        pillars: {
          valuation: eq.pillars.valuation,
          quality: eq.pillars.quality,
          growthOrCarry: eq.pillars.growth,
          technicals: eq.pillars.technicals,
          macroFit: eq.pillars.macroFit,
        },
        quantScore: eq.quantScore,
        signal: eq.signal,
        convictionPct: eq.convictionPct,
        catalystHeadline: eq.catalystHeadline,
        keyMetricBadge: `PER ${eq.peForward.toFixed(1)}x · ROIC ${eq.roicPct.toFixed(0)} % · F ${eq.piotroskiFScore}/9`,
        equityDetails: eq,
        isHeld,
        heldValueCad,
        heldWeightPct,
        concreteRatios,
      };
    }

    // Build price series for Crypto or ETF/Bond/Commodity
    const fullPrices = HISTORICAL_SERIES.map((p, idx) =>
      idx === nSeries - 1 ? livePrices[asset.id] ?? p.prices[asset.id] : p.prices[asset.id]
    );
    const baselineSpot = HISTORICAL_SERIES[nSeries - 1].prices[asset.id] || 100;

    // -------------------------------------------------------------------------
    // CASE B: Cryptocurrencies, Layer-1, DeFi & Decentralized AI (On-Chain Model)
    // -------------------------------------------------------------------------
    if (asset.category === 'crypto') {
      const cryptoProf: CryptoAnalystProfile = CRYPTO_FUNDAMENTALS[asset.id] ?? {
        consensusMechanism: 'Proof-of-Stake / Réseau Décentralisé',
        stakingYieldPct: 2.5,
        annualIssuancePct: 3.0,
        nvtRatio: 38.0,
        mvrvZScore: 1.8,
        defiOrNetworkMoat: asset.description,
        maxKellyPortfolioPct: 2.0,
        baseCycleFairUpsidePct: 8.0,
      };

      const netStakingRealYieldPct = Number(
        (cryptoProf.stakingYieldPct - cryptoProf.annualIssuancePct).toFixed(2)
      );

      // Liquidity, issuance & real-rate cycle discipline on Crypto Fair Value
      const liquidityMacroShiftPct =
        -rateMacroDelta * 9.5 +
        growthMacroDelta * 4.5 -
        Math.max(0, macro.vixLevel - 20) * 1.1;
      const cryptoIssuancePenaltyPct =
        9.4 + Math.max(0, cryptoProf.annualIssuancePct - 1.5) * 1.85;

      const fairValueCad = Number(
        Math.max(
          0.0001,
          baselineSpot *
            (1 +
              (cryptoProf.baseCycleFairUpsidePct -
                cryptoIssuancePenaltyPct +
                liquidityMacroShiftPct) /
                100)
        ).toFixed(asset.id === 'DOGE' || baselineSpot < 2 ? 4 : 2)
      );

      const spotNow = Number(
        fullPrices[fullPrices.length - 1].toFixed(baselineSpot < 2 ? 4 : 2)
      );
      const upsidePct = Number((((fairValueCad - spotNow) / spotNow) * 100).toFixed(1));

      const forwardRetPct = Number(
        (
          asset.baseExpectedReturnPct +
          upsidePct * 0.25 +
          netStakingRealYieldPct * 0.4 -
          rateMacroDelta * 2.2
        ).toFixed(2)
      );

      const tech = buildTechnicalAndRiskFromSeries(
        asset.id,
        fullPrices,
        worldRets,
        meanWorld,
        varWorld,
        asset.growthBeta,
        asset.baseVolatilityPct,
        macro.vixLevel,
        forwardRetPct,
        riskFreePct
      );

      // 5-Pillar On-Chain & Quantitative Crypto Scoring
      const valuationScore = Math.round(
        Math.max(
          8,
          Math.min(
            95,
            52 +
              upsidePct * 1.15 -
              Math.max(0, cryptoProf.nvtRatio - 26) * 0.65 -
              Math.max(0, cryptoProf.mvrvZScore - 2.0) * 14
          )
        )
      );
      const qualityScore = Math.round(
        Math.max(
          10,
          Math.min(
            95,
            60 +
              netStakingRealYieldPct * 4.5 -
              Math.max(0, cryptoProf.annualIssuancePct - 2.5) * 4.4 +
              (asset.id === 'BTC' || asset.id === 'ETH' ? 16 : 0)
          )
        )
      );
      const growthOrCarryScore = Math.round(
        Math.max(
          12,
          Math.min(
            94,
            50 + cryptoProf.stakingYieldPct * 3.6 + cryptoProf.baseCycleFairUpsidePct * 0.75
          )
        )
      );
      const technicalScore = Math.round(
        Math.max(
          12,
          Math.min(
            94,
            50 +
              (tech.trendRegime === 'Haussier' ? 14 : tech.trendRegime === 'Baissier' ? -18 : 0) +
              tech.macdHistogram * 8 +
              (tech.rsi14 >= 40 && tech.rsi14 <= 70 ? 8 : -6)
          )
        )
      );
      const riskPenalty =
        riskProfile === 'prudent'
          ? -35
          : riskProfile === 'equilibre'
            ? -12
            : riskProfile === 'dynamique'
              ? 0
              : 6;
      const macroFitScore = Math.round(
        Math.max(8, Math.min(92, 50 + tech.sharpeRatio * 28 - rateMacroDelta * 8 + riskPenalty))
      );

      const quantScore = Math.round(
        0.28 * valuationScore +
          0.26 * qualityScore +
          0.16 * growthOrCarryScore +
          0.16 * technicalScore +
          0.14 * macroFitScore
      );

      let signal: EquityActionSignal = 'CONSERVER';
      if (riskProfile === 'prudent') {
        signal = quantScore <= 48 ? 'VENDRE' : 'ALLÉGER';
      } else if (
        quantScore >= 80 &&
        upsidePct >= 15 &&
        cryptoProf.mvrvZScore <= 2.2 &&
        tech.trendRegime !== 'Baissier'
      ) {
        signal = 'ACHAT FORT';
      } else if (
        quantScore >= 71 &&
        upsidePct >= 10.5 &&
        (tech.trendRegime !== 'Baissier' || upsidePct >= 18)
      ) {
        signal = 'ACHETER';
      } else if (quantScore <= 45 || upsidePct <= -12 || cryptoProf.nvtRatio >= 58) {
        signal = 'VENDRE';
      } else if (
        quantScore <= 57 ||
        upsidePct <= -4 ||
        cryptoProf.annualIssuancePct >= 5.0 ||
        (tech.trendRegime === 'Baissier' && upsidePct < 6)
      ) {
        signal = 'ALLÉGER';
      }

      const stopDistFrac = Math.max(0.12, Math.min(0.24, (tech.volatilityPct / 100 / Math.sqrt(12)) * 1.45));
      const stopLossCad = Number((spotNow * (1 - stopDistFrac)).toFixed(spotNow < 2 ? 4 : 2));
      const stopDistancePct = Number((-stopDistFrac * 100).toFixed(1));
      const targetRet =
        signal === 'VENDRE' || signal === 'ALLÉGER'
          ? Math.min(-6, upsidePct * 0.85)
          : Math.max(8, upsidePct * 0.9);
      const target12mCad = Number(
        (spotNow * (1 + targetRet / 100)).toFixed(spotNow < 2 ? 4 : 2)
      );
      const rewardRiskRatio = Number(
        (Math.abs(targetRet) / Math.max(1, Math.abs(stopDistancePct))).toFixed(2)
      );

      const maxKellyScaled =
        riskProfile === 'prudent'
          ? 0
          : riskProfile === 'equilibre'
            ? Math.min(3.0, cryptoProf.maxKellyPortfolioPct * 0.7)
            : riskProfile === 'dynamique'
              ? cryptoProf.maxKellyPortfolioPct
              : Number((cryptoProf.maxKellyPortfolioPct * 1.35).toFixed(1));

      const optimalWrapper: 'CELI' | 'Non-enregistré' =
        asset.id === 'BTC' || asset.id === 'ETH' || asset.id === 'SOL'
          ? 'CELI'
          : 'Non-enregistré';
      const taxRationale =
        optimalWrapper === 'CELI'
          ? 'Détenir via FNB Crypto Spot canadien admissible au CELI (ex: BTCC.TO / ETHH.TO / QSOL.TO) pour exonérer 100 % des gains de cycle ; la détention directe sur clé privée reste en compte Non-enregistré.'
          : 'Jeton détenu sur portefeuille Web3 Non-enregistré : conserver le registre du prix de base rajusté (PBR) en $ CAD ; les récompenses de staking sont imposables à réception.';

      const concreteRatios: ConcreteAnalystRatio[] = [
        {
          group: 'Valorisation',
          label: 'Juste Valeur de Cycle On-Chain',
          value: `${formatCad(fairValueCad, 2)} CAD (${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)} %)`,
          benchmarkHint: 'Modèle NVT + MVRV + Liquidité',
          sentiment: upsidePct >= 12 ? 'positive' : upsidePct <= -6 ? 'negative' : 'neutral',
        },
        {
          group: 'Valorisation',
          label: 'Ratio NVT (Network Value / Transactions)',
          value: `${cryptoProf.nvtRatio.toFixed(1)}x`,
          benchmarkHint: 'Équivalent PER crypto (< 32x sain)',
          sentiment: cryptoProf.nvtRatio <= 32 ? 'positive' : cryptoProf.nvtRatio >= 55 ? 'negative' : 'neutral',
        },
        {
          group: 'Valorisation',
          label: 'Score MVRV Z-Score (Cycle)',
          value: `${cryptoProf.mvrvZScore.toFixed(2)}`,
          benchmarkHint: '< 1,0 sous-évalué · > 3,0 euphorie',
          sentiment: cryptoProf.mvrvZScore <= 2.0 ? 'positive' : cryptoProf.mvrvZScore >= 2.8 ? 'negative' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Consensus & Sécurité Réseau',
          value: cryptoProf.consensusMechanism,
          benchmarkHint: 'Architecture protocolaire',
          sentiment: 'positive',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Rendement de Staking Brut',
          value: `${cryptoProf.stakingYieldPct.toFixed(2)} % / an`,
          benchmarkHint: 'Récompense validateurs / frais',
          sentiment: cryptoProf.stakingYieldPct >= 3.0 ? 'positive' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Inflation / Émission Annuelle Tokens',
          value: `${cryptoProf.annualIssuancePct.toFixed(2)} % / an`,
          benchmarkHint: 'Dilution offre (< 2 % sobre)',
          sentiment: cryptoProf.annualIssuancePct <= 2.0 ? 'positive' : cryptoProf.annualIssuancePct >= 5.0 ? 'negative' : 'neutral',
        },
        {
          group: 'Qualité & Rendement',
          label: 'Rendement Réel Net (Staking − Émission)',
          value: `${netStakingRealYieldPct >= 0 ? '+' : ''}${netStakingRealYieldPct.toFixed(2)} % / an`,
          benchmarkHint: 'Positif = portage non dilutif',
          sentiment: netStakingRealYieldPct >= 0 ? 'positive' : netStakingRealYieldPct <= -2.5 ? 'negative' : 'neutral',
        },
        {
          group: 'Technique & Momentum',
          label: 'RSI-14 & Régime de Tendance',
          value: `RSI ${tech.rsi14} · ${tech.trendRegime}`,
          benchmarkHint: 'Écart MM12 : ' + `${tech.sma12GapPct >= 0 ? '+' : ''}${tech.sma12GapPct}%`,
          sentiment: tech.trendRegime === 'Haussier' ? 'positive' : tech.trendRegime === 'Baissier' ? 'negative' : 'neutral',
        },
        {
          group: 'Technique & Momentum',
          label: 'MACD & Bandes de Bollinger %B',
          value: `${tech.macdLabel} · %B ${tech.bollingerPctB} %`,
          benchmarkHint: 'Position dans le canal 20 périodes',
          sentiment: tech.macdHistogram >= 0 ? 'positive' : 'negative',
        },
        {
          group: 'Technique & Momentum',
          label: 'Momentum 3M / 6M / 12M',
          value: `${tech.momentum3mPct >= 0 ? '+' : ''}${tech.momentum3mPct}% · ${tech.momentum6mPct >= 0 ? '+' : ''}${tech.momentum6mPct}% · ${tech.momentum12mPct >= 0 ? '+' : ''}${tech.momentum12mPct}%`,
          benchmarkHint: 'Vélocité haussière / baissière',
          sentiment: tech.momentum6mPct > 0 ? 'positive' : 'negative',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'Volatilité Annuelle & Bêta Monde',
          value: `${tech.volatilityPct.toFixed(1)} % · β ${tech.betaVsWorld.toFixed(2)}`,
          benchmarkHint: 'Classe d’actifs à haute convexité',
          sentiment: tech.volatilityPct <= 70 ? 'neutral' : 'negative',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'Perte Extrême VaR 95 % & CVaR / mois',
          value: `-${tech.monthlyVar95Pct.toFixed(1)} % / -${tech.cvar95MonthlyPct.toFixed(1)} %`,
          benchmarkHint: 'Risque de queue mensuel',
          sentiment: 'negative',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'Plafond Prudentiel de Kelly Fractionnel',
          value: `Max ${maxKellyScaled.toFixed(1)} % du portefeuille`,
          benchmarkHint: 'Dimensionnement anti-ruine',
          sentiment: 'positive',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'Ratio Gain / Risque (12M vs Stop)',
          value: `${rewardRiskRatio.toFixed(2)}x`,
          benchmarkHint: `Stop discipliné à ${formatCad(stopLossCad, 2)} CAD`,
          sentiment: rewardRiskRatio >= 1.4 ? 'positive' : 'neutral',
        },
        {
          group: 'Risque & Fiscalité',
          label: 'Fiscalité Canadienne Optimale',
          value: optimalWrapper === 'CELI' ? 'CELI (via FNB Spot TSX)' : 'Non-enregistré (PBR)',
          benchmarkHint: 'Traitement ARC crypto-actifs',
          sentiment: 'positive',
        },
      ];

      return {
        asset,
        subClass,
        subClassLabel,
        sector: asset.sector ?? 'Crypto & Web3',
        regionLabel: 'Global / On-Chain',
        underlyingCurrency: 'USD',
        spotPriceCad: spotNow,
        sparkline24m: fullPrices.slice(-24),
        fairValueCad,
        fairValueModelLabel: 'Cycle NVT / MVRV',
        upsidePct,
        entryZoneLowCad: Number((spotNow * 0.94).toFixed(spotNow < 2 ? 4 : 2)),
        entryZoneHighCad: Number((spotNow * 1.015).toFixed(spotNow < 2 ? 4 : 2)),
        target12mCad,
        targetReturn12mPct: Number(targetRet.toFixed(1)),
        stopLossCad,
        stopDistancePct,
        rewardRiskRatio,
        maxRecommendedWeightPct: maxKellyScaled,
        optimalCanadianWrapper: optimalWrapper,
        taxWrapperRationale: taxRationale,
        grossYieldPct: cryptoProf.stakingYieldPct,
        netRealYieldPct: netStakingRealYieldPct,
        annualFeeOrInflationPct: cryptoProf.annualIssuancePct,
        rsi14: tech.rsi14,
        macdLine: tech.macdLine,
        macdHistogram: tech.macdHistogram,
        macdLabel: tech.macdLabel,
        bollingerPctB: tech.bollingerPctB,
        sma6GapPct: tech.sma6GapPct,
        sma12GapPct: tech.sma12GapPct,
        trendRegime: tech.trendRegime,
        momentum1dPct: tech.momentum1dPct,
        momentum5dPct: tech.momentum5dPct,
        momentum1mPct: tech.momentum1mPct,
        momentum3mPct: tech.momentum3mPct,
        momentum6mPct: tech.momentum6mPct,
        momentum12mPct: tech.momentum12mPct,
        drawdownAthPct: tech.drawdownAthPct,
        volatilityPct: tech.volatilityPct,
        betaVsWorld: tech.betaVsWorld,
        sharpeRatio: tech.sharpeRatio,
        monthlyVar95Pct: tech.monthlyVar95Pct,
        cvar95MonthlyPct: tech.cvar95MonthlyPct,
        pillars: {
          valuation: valuationScore,
          quality: qualityScore,
          growthOrCarry: growthOrCarryScore,
          technicals: technicalScore,
          macroFit: macroFitScore,
        },
        quantScore,
        signal,
        convictionPct: Math.min(93, Math.max(54, Math.round(58 + Math.abs(quantScore - 55) * 0.7))),
        catalystHeadline: cryptoProf.defiOrNetworkMoat,
        keyMetricBadge: `NVT ${cryptoProf.nvtRatio.toFixed(0)}x · MVRV ${cryptoProf.mvrvZScore.toFixed(1)} · Net ${netStakingRealYieldPct >= 0 ? '+' : ''}${netStakingRealYieldPct.toFixed(1)} %`,
        cryptoDetails: { ...cryptoProf, netStakingRealYieldPct },
        isHeld,
        heldValueCad,
        heldWeightPct,
        concreteRatios,
      };
    }

    // -------------------------------------------------------------------------
    // CASE C: ETFs, Sovereign/Corporate Bonds, Cash & Commodities (NAV/Carry/Duration Model)
    // -------------------------------------------------------------------------
    const fundProf: FundOrMacroAnalystProfile = MACRO_FUND_PROFILES[asset.id] ?? {
      effectiveDurationYears: asset.category === 'obligations' ? 6.2 : 0,
      underlyingCurrency: asset.ticker.endsWith('.TO') ? 'CAD' : 'Multi-devises',
      issuerAndStructure: asset.name,
      indexMethodology: asset.description,
      optimalCanadianWrapper: 'CELI / REER',
      taxWrapperRationale:
        'Loger en CELI ou REER pour composer les distributions et plus-values à l’abri de l’impôt.',
      baseNavFairUpsidePct: asset.baseExpectedReturnPct,
    };

    const durationEffectPct = -rateMacroDelta * fundProf.effectiveDurationYears * 0.92;
    const macroNavShiftPct =
      durationEffectPct +
      growthMacroDelta * asset.growthBeta * 2.4 +
      inflationMacroDelta * asset.inflationBeta * 2.6;

    const spotNow = Number(fullPrices[fullPrices.length - 1].toFixed(2));
    const navDisciplineDragPct =
      6.4 + asset.annualFeePct * 4.5 + (fundProf.effectiveDurationYears > 8 ? 3.2 : 0);
    const fairValueCad = Number(
      Math.max(
        0.5,
        baselineSpot *
          (1 +
            (fundProf.baseNavFairUpsidePct - navDisciplineDragPct + macroNavShiftPct) / 100)
      ).toFixed(2)
    );
    const upsidePct = Number((((fairValueCad - spotNow) / spotNow) * 100).toFixed(1));

    const netCarryPct = Number((asset.dividendYieldPct - asset.annualFeePct).toFixed(2));
    const forwardRetPct = Number(
      (
        asset.baseExpectedReturnPct -
        asset.annualFeePct +
        macroNavShiftPct * 0.35
      ).toFixed(2)
    );

    const tech = buildTechnicalAndRiskFromSeries(
      asset.id,
      fullPrices,
      worldRets,
      meanWorld,
      varWorld,
      asset.growthBeta,
      asset.baseVolatilityPct,
      macro.vixLevel,
      forwardRetPct,
      riskFreePct
    );

    const feeDrag10yPer10kCad = Math.round(
      10000 * (Math.pow(1.07, 10) - Math.pow(1.07 - asset.annualFeePct / 100, 10))
    );
    const rateCut100bpsImpactPct = Number(
      (fundProf.effectiveDurationYears > 0
        ? fundProf.effectiveDurationYears + asset.dividendYieldPct * 0.5
        : Math.max(2.0, -asset.rateSensitivity * 4.5)
      ).toFixed(1)
    );
    const rateHike100bpsImpactPct = Number(
      (fundProf.effectiveDurationYears > 0
        ? -fundProf.effectiveDurationYears + asset.dividendYieldPct * 0.5
        : Math.min(-1.5, asset.rateSensitivity * 4.5)
      ).toFixed(1)
    );

    const feeEfficiencyBonus = asset.annualFeePct <= 0.15 ? 14 : asset.annualFeePct <= 0.28 ? 8 : -6;
    const valuationScore = Math.round(
      Math.max(22, Math.min(93, 52 + upsidePct * 1.65 + netCarryPct * 2.0))
    );
    const qualityScore = Math.round(
      Math.max(35, Math.min(96, 68 + feeEfficiencyBonus + (asset.category === 'obligations' ? 5 : 3)))
    );
    const growthOrCarryScore = Math.round(
      Math.max(25, Math.min(92, 46 + forwardRetPct * 3.6 + netCarryPct * 1.8))
    );
    const technicalScore = Math.round(
      Math.max(
        25,
        Math.min(
          92,
          52 +
            (tech.trendRegime === 'Haussier' ? 12 : tech.trendRegime === 'Baissier' ? -14 : 0) +
            tech.macdHistogram * 9
        )
      )
    );
    const macroFitScore = Math.round(
      Math.max(
        25,
        Math.min(
          95,
          54 +
            tech.sharpeRatio * 30 +
            (riskProfile === 'prudent' && asset.category === 'obligations' ? 14 : 0)
        )
      )
    );

    const quantScore = Math.round(
      0.24 * valuationScore +
        0.26 * qualityScore +
        0.18 * growthOrCarryScore +
        0.14 * technicalScore +
        0.18 * macroFitScore
    );

    let signal: EquityActionSignal = 'CONSERVER';
    if (quantScore >= 79 && upsidePct >= 7.5 && tech.trendRegime !== 'Baissier') {
      signal = 'ACHAT FORT';
    } else if (quantScore >= 73 && upsidePct >= 5.5 && tech.trendRegime !== 'Baissier') {
      signal = 'ACHETER';
    } else if (quantScore <= 46 || upsidePct <= -5) {
      signal = 'VENDRE';
    } else if (quantScore <= 55 || upsidePct <= -1.5 || (asset.annualFeePct >= 0.45 && upsidePct < 4)) {
      signal = 'ALLÉGER';
    }

    const stopDistFrac = Math.max(
      0.035,
      Math.min(0.14, (tech.volatilityPct / 100 / Math.sqrt(12)) * 1.75)
    );
    const stopLossCad = Number((spotNow * (1 - stopDistFrac)).toFixed(2));
    const stopDistancePct = Number((-stopDistFrac * 100).toFixed(1));
    const targetRet = Math.max(2.5, upsidePct);
    const target12mCad = Number((spotNow * (1 + targetRet / 100)).toFixed(2));
    const rewardRiskRatio = Number(
      (Math.abs(targetRet) / Math.max(1, Math.abs(stopDistancePct))).toFixed(2)
    );

    const normalizedWrapper: 'CELI' | 'REER' | 'Non-enregistré' | 'CELI / REER' =
      fundProf.optimalCanadianWrapper === 'REER / CELI'
        ? 'CELI / REER'
        : fundProf.optimalCanadianWrapper;

    const concreteRatios: ConcreteAnalystRatio[] = [
      {
        group: 'Valorisation',
        label: 'Cible Macro / Valeur Intrinsèque 12M',
        value: `${formatCad(fairValueCad, 2)} CAD (${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)} %)`,
        benchmarkHint: 'Espérance totale dividendes inclus',
        sentiment: upsidePct >= 7 ? 'positive' : 'neutral',
      },
      {
        group: 'Valorisation',
        label: 'Frais de Gestion Annuels (RFG / TER)',
        value: `${asset.annualFeePct.toFixed(2)} % / an`,
        benchmarkHint: `Coût 10A sur 10k$ : ~${formatCad(feeDrag10yPer10kCad, 0)} CAD`,
        sentiment: asset.annualFeePct <= 0.22 ? 'positive' : asset.annualFeePct >= 0.55 ? 'negative' : 'neutral',
      },
      {
        group: 'Qualité & Rendement',
        label: 'Rendement de Distribution / Coupon Brut',
        value: `${asset.dividendYieldPct.toFixed(2)} % / an`,
        benchmarkHint: 'Flux annuel versé ou capitalisé',
        sentiment: asset.dividendYieldPct >= 2.5 ? 'positive' : 'neutral',
      },
      {
        group: 'Qualité & Rendement',
        label: 'Portage Net après Frais (Yield − RFG)',
        value: `${netCarryPct >= 0 ? '+' : ''}${netCarryPct.toFixed(2)} % / an`,
        benchmarkHint: 'Revenu net de frais de gestion',
        sentiment: netCarryPct >= 2.0 ? 'positive' : 'neutral',
      },
      {
        group: 'Qualité & Rendement',
        label: 'Duration Effective (Sensibilité Taux)',
        value:
          fundProf.effectiveDurationYears > 0
            ? `${fundProf.effectiveDurationYears.toFixed(1)} ans`
            : '0,0 an (Actif réel / Actions)',
        benchmarkHint: 'Variation de prix par 100 pb de taux',
        sentiment: 'neutral',
      },
      {
        group: 'Qualité & Rendement',
        label: 'Scénario Baisse des Taux (-100 pb) / Hausse (+100 pb)',
        value: `${rateCut100bpsImpactPct >= 0 ? '+' : ''}${rateCut100bpsImpactPct}% / ${rateHike100bpsImpactPct >= 0 ? '+' : ''}${rateHike100bpsImpactPct}%`,
        benchmarkHint: 'Convexité obligataire & macro',
        sentiment: rateCut100bpsImpactPct >= 5 ? 'positive' : 'neutral',
      },
      {
        group: 'Qualité & Rendement',
        label: 'Émetteur & Méthodologie Indicielle',
        value: fundProf.issuerAndStructure,
        benchmarkHint: fundProf.indexMethodology,
        sentiment: 'positive',
      },
      {
        group: 'Technique & Momentum',
        label: 'RSI-14 & Tendance Moyenne Mobile 12M',
        value: `RSI ${tech.rsi14} · ${tech.trendRegime} (${tech.sma12GapPct >= 0 ? '+' : ''}${tech.sma12GapPct}%)`,
        benchmarkHint: 'Position par rapport à MM12',
        sentiment: tech.trendRegime === 'Haussier' ? 'positive' : tech.trendRegime === 'Baissier' ? 'negative' : 'neutral',
      },
      {
        group: 'Technique & Momentum',
        label: 'Momentum 3M / 6M / 12M',
        value: `${tech.momentum3mPct >= 0 ? '+' : ''}${tech.momentum3mPct}% · ${tech.momentum6mPct >= 0 ? '+' : ''}${tech.momentum6mPct}% · ${tech.momentum12mPct >= 0 ? '+' : ''}${tech.momentum12mPct}%`,
        benchmarkHint: 'Performance glissante en $ CAD',
        sentiment: tech.momentum12mPct >= 0 ? 'positive' : 'neutral',
      },
      {
        group: 'Risque & Fiscalité',
        label: 'Volatilité Annuelle & Ratio de Sharpe',
        value: `${tech.volatilityPct.toFixed(1)} % · Sharpe ${tech.sharpeRatio.toFixed(2)}`,
        benchmarkHint: `Bêta MSCI World : ${tech.betaVsWorld.toFixed(2)}`,
        sentiment: tech.volatilityPct <= 16 ? 'positive' : 'neutral',
      },
      {
        group: 'Risque & Fiscalité',
        label: 'VaR Mensuelle 95 % & Drawdown vs ATH',
        value: `-${tech.monthlyVar95Pct.toFixed(1)} % · ATH ${tech.drawdownAthPct.toFixed(1)} %`,
        benchmarkHint: 'Risque de repli mensuel',
        sentiment: tech.monthlyVar95Pct <= 7 ? 'positive' : 'neutral',
      },
      {
        group: 'Risque & Fiscalité',
        label: 'Devise Sous-Jacente & Enveloppe Optimale',
        value: `${fundProf.underlyingCurrency} → ${normalizedWrapper}`,
        benchmarkHint: 'Optimisation retenues fiscales',
        sentiment: 'positive',
      },
    ];

    return {
      asset,
      subClass,
      subClassLabel,
      sector: asset.sector ?? subClassLabel,
      regionLabel:
        asset.ticker.endsWith('.TO')
          ? 'Canada (TSX)'
          : fundProf.underlyingCurrency === 'USD'
            ? 'États-Unis / Global'
            : fundProf.underlyingCurrency === 'EUR'
              ? 'Europe'
              : 'Mondial',
      underlyingCurrency: fundProf.underlyingCurrency,
      spotPriceCad: spotNow,
      sparkline24m: fullPrices.slice(-24),
      fairValueCad,
      fairValueModelLabel:
        fundProf.effectiveDurationYears > 0 ? 'Portage + Duration' : 'NAV Macro 12M',
      upsidePct,
      entryZoneLowCad: Number((spotNow * 0.985).toFixed(2)),
      entryZoneHighCad: Number((spotNow * 1.008).toFixed(2)),
      target12mCad,
      targetReturn12mPct: Number(targetRet.toFixed(1)),
      stopLossCad,
      stopDistancePct,
      rewardRiskRatio,
      maxRecommendedWeightPct: subClass === 'matiere_premiere' ? 12.0 : 38.0,
      optimalCanadianWrapper: normalizedWrapper,
      taxWrapperRationale: fundProf.taxWrapperRationale,
      grossYieldPct: asset.dividendYieldPct,
      netRealYieldPct: netCarryPct,
      annualFeeOrInflationPct: asset.annualFeePct,
      rsi14: tech.rsi14,
      macdLine: tech.macdLine,
      macdHistogram: tech.macdHistogram,
      macdLabel: tech.macdLabel,
      bollingerPctB: tech.bollingerPctB,
      sma6GapPct: tech.sma6GapPct,
      sma12GapPct: tech.sma12GapPct,
      trendRegime: tech.trendRegime,
      momentum1dPct: tech.momentum1dPct,
      momentum5dPct: tech.momentum5dPct,
      momentum1mPct: tech.momentum1mPct,
      momentum3mPct: tech.momentum3mPct,
      momentum6mPct: tech.momentum6mPct,
      momentum12mPct: tech.momentum12mPct,
      drawdownAthPct: tech.drawdownAthPct,
      volatilityPct: tech.volatilityPct,
      betaVsWorld: tech.betaVsWorld,
      sharpeRatio: tech.sharpeRatio,
      monthlyVar95Pct: tech.monthlyVar95Pct,
      cvar95MonthlyPct: tech.cvar95MonthlyPct,
      pillars: {
        valuation: valuationScore,
        quality: qualityScore,
        growthOrCarry: growthOrCarryScore,
        technicals: technicalScore,
        macroFit: macroFitScore,
      },
      quantScore,
      signal,
      convictionPct: Math.min(92, Math.max(58, Math.round(62 + Math.abs(quantScore - 58) * 0.7))),
      catalystHeadline: asset.description,
      keyMetricBadge:
        fundProf.effectiveDurationYears > 0
          ? `Rdt ${asset.dividendYieldPct.toFixed(1)} % · Dur. ${fundProf.effectiveDurationYears.toFixed(1)}a · RFG ${asset.annualFeePct.toFixed(2)} %`
          : `RFG ${asset.annualFeePct.toFixed(2)} % · Rdt ${asset.dividendYieldPct.toFixed(1)} % · Vol ${tech.volatilityPct.toFixed(0)} %`,
      fundDetails: {
        ...fundProf,
        feeDrag10yPer10kCad,
        rateCut100bpsImpactPct,
        rateHike100bpsImpactPct,
      },
      isHeld,
      heldValueCad,
      heldWeightPct,
      concreteRatios,
    };
  });

  allAnalyses.sort((a, b) => b.quantScore - a.quantScore);

  const countsBySubClass: Record<MarketAssetSubClass | 'all', number> = {
    all: allAnalyses.length,
    action_ca: 0,
    action_us: 0,
    action_eu_asia: 0,
    crypto_l1_defi: 0,
    etf_indice: 0,
    obligation_taux: 0,
    matiere_premiere: 0,
    immobilier_reit: 0,
  };
  const countsBySignal: Record<EquityActionSignal, number> = {
    'ACHAT FORT': 0,
    ACHETER: 0,
    CONSERVER: 0,
    ALLÉGER: 0,
    VENDRE: 0,
  };

  const byId = new Map<string, UniversalAssetAnalysis>();
  for (const item of allAnalyses) {
    countsBySubClass[item.subClass] += 1;
    countsBySignal[item.signal] += 1;
    byId.set(item.asset.id, item);
  }

  return {
    totalAssets: allAnalyses.length,
    countsBySubClass,
    countsBySignal,
    allAnalyses,
    byId,
  };
}

/**
 * Computes Concrete Portfolio X-Ray Diagnostics in $ CAD (Before vs After Arbitrages):
 * 1) 4 Historical & Macro Stress-Tests in $ CAD & %
 * 2) Annual Passive Income (Dividends + Coupons + Staking) vs Annual Management Fees (RFG/TER)
 * 3) Underlying Currency Exposure (CAD / USD / EUR / Crypto & Gold) + Sector Breakdown
 * 4) Line-by-Line Canadian Tax Wrapper Optimization (CELI / REER / Non-enregistré)
 */
export function computeConcretePortfolioXRay(params: {
  lots: PortfolioLot[];
  afterLots: PortfolioLot[];
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  riskProfile?: RiskProfile;
}): ConcretePortfolioXRay {
  const { lots, afterLots, livePrices, macro, riskProfile = 'equilibre' } = params;
  const universe = analyzeFullMarketUniverse({ livePrices, macro, riskProfile });

  const aggregateMap = (inputLots: PortfolioLot[]) => {
    const map = new Map<string, number>();
    let total = 0;
    for (const lot of inputLots) {
      if (!getAssetById(lot.assetId) || lot.investedAmount <= 0) continue;
      const pos = evaluateLotMarketPosition(lot, livePrices);
      map.set(lot.assetId, (map.get(lot.assetId) ?? 0) + pos.currentValue);
      total += pos.currentValue;
    }
    return { map, total };
  };

  const beforeAgg = aggregateMap(lots);
  const afterAgg = afterLots.length > 0 ? aggregateMap(afterLots) : beforeAgg;

  // Lookup historical indices for COVID (2020-01 -> 2020-03) and Rate Shock (2021-12 -> 2022-10)
  const idxCovidStart = HISTORICAL_SERIES.findIndex((p) => p.yearMonth === '2020-01');
  const idxCovidTrough = HISTORICAL_SERIES.findIndex((p) => p.yearMonth === '2020-03');
  const idx2022Start = HISTORICAL_SERIES.findIndex((p) => p.yearMonth === '2021-12');
  const idx2022Trough = HISTORICAL_SERIES.findIndex((p) => p.yearMonth === '2022-10');

  const computeScenarioPct = (
    weightsMap: Map<string, number>,
    totalVal: number,
    scenario: 'covid_2020' | 'rates_2022' | 'ai_crypto_bust' | 'rate_cut_100bps'
  ): number => {
    if (totalVal <= 0) return 0;
    let portShock = 0;
    for (const [assetId, val] of weightsMap.entries()) {
      const w = val / totalVal;
      const item = universe.byId.get(assetId);
      const asset = item?.asset ?? getAssetById(assetId);
      if (!asset) continue;

      let assetShockPct = 0;
      if (scenario === 'covid_2020' && idxCovidStart >= 0 && idxCovidTrough > idxCovidStart) {
        const p0 = HISTORICAL_SERIES[idxCovidStart].prices[assetId];
        const p1 = HISTORICAL_SERIES[idxCovidTrough].prices[assetId];
        assetShockPct = p0 > 0 ? ((p1 - p0) / p0) * 100 : -18;
      } else if (scenario === 'rates_2022' && idx2022Start >= 0 && idx2022Trough > idx2022Start) {
        const p0 = HISTORICAL_SERIES[idx2022Start].prices[assetId];
        const p1 = HISTORICAL_SERIES[idx2022Trough].prices[assetId];
        assetShockPct = p0 > 0 ? ((p1 - p0) / p0) * 100 : -15;
      } else if (scenario === 'ai_crypto_bust') {
        if (asset.category === 'crypto') {
          assetShockPct = -Math.min(68, Math.max(42, asset.baseVolatilityPct * 0.68));
        } else if (asset.category === 'obligations') {
          assetShockPct = asset.id === 'CASH' ? 0.4 : 4.2;
        } else if (asset.category === 'refuge') {
          assetShockPct = asset.id === 'GOLD' ? 7.5 : -6.0;
        } else if (item?.equityDetails) {
          const eq = item.equityDetails;
          if (eq.peForward >= 42 || eq.sector === 'Tech & Semi-Conducteurs') {
            assetShockPct = eq.peForward >= 50 ? -36.0 : -24.5;
          } else if (
            eq.sector === 'Santé & Pharma' ||
            eq.sector === 'Consommation & Télécoms' ||
            eq.sector === 'Banques & Assurance'
          ) {
            assetShockPct = -7.5;
          } else {
            assetShockPct = -13.5;
          }
        } else {
          assetShockPct = asset.ticker.includes('QQQ') || asset.ticker.includes('TEC') ? -25.0 : -14.0;
        }
      } else if (scenario === 'rate_cut_100bps') {
        if (item?.fundDetails && item.fundDetails.effectiveDurationYears > 0) {
          assetShockPct = item.fundDetails.rateCut100bpsImpactPct;
        } else if (asset.category === 'crypto') {
          assetShockPct = 14.5;
        } else if (item?.subClass === 'immobilier_reit') {
          assetShockPct = 11.2;
        } else {
          assetShockPct = Math.max(2.5, -asset.rateSensitivity * 6.5 + 3.2);
        }
      }

      portShock += w * assetShockPct;
    }
    return Number(portShock.toFixed(1));
  };

  const scenarioDefs: {
    id: 'covid_2020' | 'rates_2022' | 'ai_crypto_bust' | 'rate_cut_100bps';
    title: string;
    historicalRef: string;
    description: string;
  }[] = [
    {
      id: 'covid_2020',
      title: 'Krach de Liquidité & Pandémie',
      historicalRef: 'Févr.–Mars 2020',
      description: 'Choc brutal de croissance mondiale, envolée du VIX > 65 et fuite vers le souverain / l’or.',
    },
    {
      id: 'rates_2022',
      title: 'Choc d’Inflation & Hausse des Taux (+200 pb)',
      historicalRef: 'Cycle 2022',
      description: 'Compression simultanée des multiples de croissance (PER) et des obligations longues.',
    },
    {
      id: 'ai_crypto_bust',
      title: 'Purge Multiples Tech IA (-30 %) & Crypto (-50 %)',
      historicalRef: 'Dégonflement bulle',
      description: 'Correction sévère des valeurs à haut PER (> 40x) et actifs numériques spéculatifs.',
    },
    {
      id: 'rate_cut_100bps',
      title: 'Assouplissement Monétaire (-100 pb BdC / Fed)',
      historicalRef: 'Baisse de taux',
      description: 'Revalorisation des obligations à longue duration, foncières (REIT) et actions de qualité.',
    },
  ];

  const stressScenarios: PortfolioStressScenarioResult[] = scenarioDefs.map((def) => {
    const pctBefore = computeScenarioPct(beforeAgg.map, beforeAgg.total, def.id);
    const pctAfter = computeScenarioPct(afterAgg.map, afterAgg.total, def.id);
    const cadBefore = Math.round((pctBefore / 100) * beforeAgg.total);
    const cadAfter = Math.round((pctAfter / 100) * afterAgg.total);
    // Compare on equal base (beforeAgg.total) so cash injections don't distort risk protection measurement
    const normalizedCadAfterOnSameBase = Math.round((pctAfter / 100) * beforeAgg.total);
    const capitalProtectedCad = normalizedCadAfterOnSameBase - cadBefore;

    return {
      id: def.id,
      title: def.title,
      historicalRef: def.historicalRef,
      description: def.description,
      impactBeforePct: pctBefore,
      impactBeforeCad: cadBefore,
      impactAfterPct: pctAfter,
      impactAfterCad: cadAfter,
      capitalProtectedCad,
    };
  });

  // 2. Passive Income & Fee Drag Audit ($ CAD / year)
  const calcIncomeAndFees = (weightsMap: Map<string, number>, totalVal: number) => {
    let grossInc = 0;
    let annualFees = 0;
    for (const [assetId, val] of weightsMap.entries()) {
      const item = universe.byId.get(assetId);
      const asset = item?.asset ?? getAssetById(assetId);
      if (!asset) continue;
      const yieldPct = item ? item.grossYieldPct : asset.dividendYieldPct;
      grossInc += (val * yieldPct) / 100;
      annualFees += (val * asset.annualFeePct) / 100;
    }
    const weightedFeeRate = totalVal > 0 ? annualFees / totalVal : 0;
    const comp10yFees =
      totalVal > 0
        ? totalVal * (Math.pow(1.07, 10) - Math.pow(1.07 - weightedFeeRate, 10))
        : 0;
    return {
      grossInc: Math.round(grossInc),
      annualFees: Math.round(annualFees),
      yieldPct: totalVal > 0 ? Number(((grossInc / totalVal) * 100).toFixed(2)) : 0,
      comp10yFees: Math.round(comp10yFees),
    };
  };

  const incBefore = calcIncomeAndFees(beforeAgg.map, beforeAgg.total);
  const incAfter = calcIncomeAndFees(afterAgg.map, afterAgg.total);

  // 3. Underlying Currency Exposure & Sector Breakdown
  const mapCurrencyBucket = (
    item: UniversalAssetAnalysis | undefined,
    asset: FinancialAsset
  ): 'CAD' | 'USD' | 'EUR' | 'Crypto & Or' => {
    if (asset.category === 'crypto' || asset.id === 'GOLD' || asset.id === 'SLV') {
      return 'Crypto & Or';
    }
    if (asset.ticker.endsWith('.TO') || asset.id === 'CASH') return 'CAD';
    if (item?.underlyingCurrency === 'CAD') return 'CAD';
    if (item?.underlyingCurrency === 'EUR') return 'EUR';
    return 'USD';
  };

  const ccyBuckets: ('CAD' | 'USD' | 'EUR' | 'Crypto & Or')[] = [
    'CAD',
    'USD',
    'EUR',
    'Crypto & Or',
  ];
  const ccyBefore = new Map<string, number>();
  const ccyAfter = new Map<string, number>();
  const secBefore = new Map<string, number>();
  const secAfter = new Map<string, number>();

  for (const [id, val] of beforeAgg.map.entries()) {
    const item = universe.byId.get(id);
    const asset = item?.asset ?? getAssetById(id);
    if (!asset) continue;
    const ccy = mapCurrencyBucket(item, asset);
    ccyBefore.set(ccy, (ccyBefore.get(ccy) ?? 0) + val);
    const sec = item?.sector ?? asset.categoryLabel;
    secBefore.set(sec, (secBefore.get(sec) ?? 0) + val);
  }

  for (const [id, val] of afterAgg.map.entries()) {
    const item = universe.byId.get(id);
    const asset = item?.asset ?? getAssetById(id);
    if (!asset) continue;
    const ccy = mapCurrencyBucket(item, asset);
    ccyAfter.set(ccy, (ccyAfter.get(ccy) ?? 0) + val);
    const sec = item?.sector ?? asset.categoryLabel;
    secAfter.set(sec, (secAfter.get(sec) ?? 0) + val);
  }

  const currencyBreakdown: CurrencyExposureBreakdown[] = ccyBuckets.map((currency) => {
    const vB = ccyBefore.get(currency) ?? 0;
    const vA = ccyAfter.get(currency) ?? 0;
    return {
      currency,
      valueBeforeCad: Math.round(vB),
      valueAfterCad: Math.round(vA),
      weightBeforePct:
        beforeAgg.total > 0 ? Number(((vB / beforeAgg.total) * 100).toFixed(1)) : 0,
      weightAfterPct:
        afterAgg.total > 0 ? Number(((vA / afterAgg.total) * 100).toFixed(1)) : 0,
    };
  });

  const allSectors = Array.from(new Set([...secBefore.keys(), ...secAfter.keys()]));
  const sectorBreakdown: SectorExposureBreakdown[] = allSectors
    .map((sector) => {
      const vB = secBefore.get(sector) ?? 0;
      const vA = secAfter.get(sector) ?? 0;
      return {
        sector,
        valueBeforeCad: Math.round(vB),
        weightBeforePct:
          beforeAgg.total > 0 ? Number(((vB / beforeAgg.total) * 100).toFixed(1)) : 0,
        weightAfterPct:
          afterAgg.total > 0 ? Number(((vA / afterAgg.total) * 100).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => Math.max(b.weightBeforePct, b.weightAfterPct) - Math.max(a.weightBeforePct, a.weightAfterPct));

  // 4. Canadian Tax Wrapper Optimization Lines (evaluated on active/post-arbitrage target portfolio)
  const targetMapForTax = afterAgg.total > 0 ? afterAgg.map : beforeAgg.map;
  const taxWrapperLines: TaxWrapperAuditLine[] = [];
  let totalAnnualTaxOptimizedCad = 0;

  for (const [assetId, val] of targetMapForTax.entries()) {
    if (val < 50) continue;
    const item = universe.byId.get(assetId);
    if (!item) continue;
    const grossIncomeCad = (val * item.grossYieldPct) / 100;
    // Estimate annual tax drag avoided vs holding in suboptimal taxable / wrong account:
    // - REER on US div/bond saves 15% IRS withholding + ~35% income tax on coupons
    // - CELI on high-growth / bond / Canadian div saves ~20%–38% tax on distributions & realized gains
    const impliedExpectedGainCad = (val * Math.max(3, item.asset.baseExpectedReturnPct)) / 100;
    const taxSaved =
      item.optimalCanadianWrapper === 'REER'
        ? grossIncomeCad * 0.38 + impliedExpectedGainCad * 0.08
        : item.optimalCanadianWrapper === 'Non-enregistré'
          ? grossIncomeCad * 0.15 // foreign tax credit recovery vs CELI leakage
          : grossIncomeCad * 0.32 + impliedExpectedGainCad * 0.12;

    const roundedSaved = Math.max(8, Math.round(taxSaved));
    totalAnnualTaxOptimizedCad += roundedSaved;

    taxWrapperLines.push({
      assetId,
      ticker: item.asset.ticker,
      name: item.asset.name.split(' (')[0],
      valueCad: Math.round(val),
      grossAnnualIncomeCad: Math.round(grossIncomeCad),
      recommendedWrapper: item.optimalCanadianWrapper,
      estimatedAnnualTaxSavedCad: roundedSaved,
      concreteRule: item.taxWrapperRationale,
    });
  }

  taxWrapperLines.sort((a, b) => b.valueCad - a.valueCad);

  return {
    stressScenarios,
    incomeAndFees: {
      grossAnnualIncomeBeforeCad: incBefore.grossInc,
      grossAnnualIncomeAfterCad: incAfter.grossInc,
      monthlyPassiveIncomeBeforeCad: Math.round(incBefore.grossInc / 12),
      monthlyPassiveIncomeAfterCad: Math.round(incAfter.grossInc / 12),
      portfolioYieldBeforePct: incBefore.yieldPct,
      portfolioYieldAfterPct: incAfter.yieldPct,
      annualFeesBeforeCad: incBefore.annualFees,
      annualFeesAfterCad: incAfter.annualFees,
      compounded10yFeesBeforeCad: incBefore.comp10yFees,
      compounded10yFeesAfterCad: incAfter.comp10yFees,
      netAnnualCarryBeforeCad: incBefore.grossInc - incBefore.annualFees,
      netAnnualCarryAfterCad: incAfter.grossInc - incAfter.annualFees,
    },
    currencyBreakdown,
    sectorBreakdown,
    taxWrapperLines,
    totalAnnualTaxOptimizedCad,
  };
}

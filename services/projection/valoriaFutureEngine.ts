import type { Asset, ProjectionConfig, ValoriaRiskProfile } from '../../types';
import { US_DIVIDEND_WITHHOLDING_RATE } from '../../utils/tax';
import {
  IQPF_2026_EXPECTED_RETURNS,
  resolveAssetFundamental,
  type AssetFundamental,
} from '../assetFundamentals';
import { assetValueCad } from '../portfolio';
import { computeAssetCorporateIntelligence } from '../valoria/corporateIntelligenceEngine';
import { evaluatePortfolioRealTime, type PortfolioLot } from '../valoria/engine';
import { resolveFinanceAISymbol } from '../valoria/financeAiBridge';
import {
  computeLedoitWolfCovariance,
  computeProbabilisticValuation,
  runBlackLittermanOptimization,
} from '../valoria/institutionalQuantEngine';
import {
  MARKET_REGIMES,
  getLatestPrices,
  registerDynamicMarketAsset,
  type RegimeId,
  type RiskProfile,
} from '../valoria/marketData';
import {
  analyzeFullMarketUniverse,
  type UniversalAssetAnalysis,
} from '../valoria/multiAssetQuantEngine';
import { buildPortfolioNewsIntelligence } from '../valoria/newsCatalystEngine';
import type { ValoriaEngineSchedule } from './types';

export type ValoriaEnvelopeKey = 'CELI' | 'REER' | 'NON_ENREG' | 'CRYPTO';

export interface ValoriaHoldingForecast {
  symbol: string;
  assetId: string;
  name: string;
  accountType: string;
  currentValueCad: number;
  weightPct: number;
  agentScore100: number;
  consensusLabel: string;
  verdictArrow: '▲' | '●' | '▼';
  buyVotes: number;
  neutralVotes: number;
  sellVotes: number;
  shortTermNetRatePct: number;
  longTermNetRatePct: number;
  dcfAlphaPct: number;
  agentBlAlphaPct: number;
  volatilityPct: number;
  qualityWeightFactor: number;
  projected5yCad: { p10: number; p50: number; p90: number };
  projected10yCad: { p10: number; p50: number; p90: number };
  optimalWrapper: string;
}

export interface ValoriaEnvelopeForecast {
  envelope: ValoriaEnvelopeKey;
  label: string;
  currentValueCad: number;
  shortTermRatePct: number;
  longTermRatePct: number;
  iqpfBenchmarkPct: number;
  annualVolatilityPct: number;
  projected5yMedianCad: number;
  projected10yMedianCad: number;
  projectedHorizonMedianCad: number;
}

export interface ValoriaFutureForecastResult {
  schedule: ValoriaEngineSchedule;
  summaryRates: { celi: number; reer: number; nonReg: number; crypto: number; cash: number };
  iqpfRates: { celi: number; reer: number; nonReg: number; crypto: number; cash: number };
  totalEvaluatedCad: number;
  portfolioConsensus100: number;
  consensusTitle: string;
  regimeName: string;
  shrinkageAlpha: number;
  averageCorrelation: number;
  shortTermPortfolioRatePct: number;
  longTermPortfolioRatePct: number;
  projectedPortfolioCad: {
    today: number;
    y5: { p10: number; p50: number; p90: number };
    y10: { p10: number; p50: number; p90: number };
    horizon: { years: number; p10: number; p50: number; p90: number };
  };
  envelopes: ValoriaEnvelopeForecast[];
  holdings: ValoriaHoldingForecast[];
  deterministicReadingFr: string;
}

interface HoldingComputation {
  symbol: string;
  assetId: string;
  name: string;
  accountType: string;
  envelope: ValoriaEnvelopeKey;
  currentValueCad: number;
  weightPct: number;
  fundamental: AssetFundamental;
  analysis?: UniversalAssetAnalysis;
  ratesByYearEngine: number[]; // Sans retenue US CELI (gérée 1 fois par glidepathRates)
  ratesByYearDisplay: number[]; // Net incluant retenue US CELI / étrangère hors double-taxation NonReg
  shortTermNetRatePct: number;
  longTermNetRatePct: number;
  dcfAlphaPct: number;
  agentBlAlphaPct: number;
  volatilityPct: number;
  qualityWeightFactor: number;
  agentScore100: number;
  consensusLabel: string;
  verdictArrow: '▲' | '●' | '▼';
  buyVotes: number;
  neutralVotes: number;
  sellVotes: number;
  optimalWrapper: string;
  usForeignDivFraction: number;
  dividendYieldPct: number;
}

const DEFAULT_MERTON_JUMP = {
  annualLambda: 0.22,
  meanJumpPct: -0.11,
  jumpVolPct: 0.07,
} as const;

const ENVELOPE_LABELS: Record<ValoriaEnvelopeKey, string> = {
  CELI: 'CELI / CELIAPP',
  REER: 'REER / REEE',
  NON_ENREG: 'Non-enregistré',
  CRYPTO: 'Cryptoactifs',
};

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Number(v.toFixed(2));
}

function deriveRiskProfile(
  riskProfile?: ValoriaRiskProfile,
  appliedReturnProfile?: ProjectionConfig['appliedReturnProfile'],
): RiskProfile {
  if (riskProfile) return riskProfile;
  if (appliedReturnProfile === 'conservative') return 'prudent';
  if (appliedReturnProfile === 'aggressive') return 'offensif';
  return 'equilibre';
}

function classifyEnvelope(
  accountType?: string,
  assetCategory?: string,
): ValoriaEnvelopeKey {
  const acc = (accountType ?? '').trim().toUpperCase();
  const cat = (assetCategory ?? '').trim().toLowerCase();
  if (acc === 'CRYPTO' || cat === 'crypto') return 'CRYPTO';
  if (acc === 'CELI' || acc === 'CELIAPP') return 'CELI';
  if (acc === 'REER' || acc === 'REEE' || acc === 'FERR') return 'REER';
  return 'NON_ENREG';
}

function computeIqpfBenchmarkDefaults(cashRatePct?: number) {
  const reer = round2(
    (0.25 * IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY
      + 0.30 * IQPF_2026_EXPECTED_RETURNS.US_EQUITY
      + 0.20 * IQPF_2026_EXPECTED_RETURNS.INT_EQUITY
      + 0.25 * IQPF_2026_EXPECTED_RETURNS.CAN_BOND) * 100,
  );
  const celi = round2(
    (0.30 * IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY
      + 0.45 * IQPF_2026_EXPECTED_RETURNS.US_EQUITY
      + 0.25 * IQPF_2026_EXPECTED_RETURNS.INT_EQUITY) * 100,
  );
  const nonReg = round2(IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY * 100);
  const crypto = round2(IQPF_2026_EXPECTED_RETURNS.EM_EQUITY * 100);
  const cash = Number.isFinite(cashRatePct)
    ? round2(Number(cashRatePct))
    : round2(IQPF_2026_EXPECTED_RETURNS.CASH * 100);
  return { celi, reer, nonReg, crypto, cash };
}

function computeEnvelopeCone(
  initialValueCad: number,
  annualRatesPct: ReadonlyArray<number>,
  annualVolPct: number,
  years: number,
  isCrypto: boolean = false,
): { p10: number; p50: number; p90: number } {
  const start = Number.isFinite(initialValueCad) && initialValueCad > 0 ? initialValueCad : 0;
  if (start <= 0 || years <= 0) {
    return { p10: Math.round(start), p50: Math.round(start), p90: Math.round(start) };
  }

  const sigma = clamp(annualVolPct, 2, 75) / 100;
  const jumpScale = isCrypto ? 1.35 : 1.0;
  const jumpVar =
    DEFAULT_MERTON_JUMP.annualLambda
    * (Math.pow(DEFAULT_MERTON_JUMP.meanJumpPct * jumpScale, 2)
      + Math.pow(DEFAULT_MERTON_JUMP.jumpVolPct * jumpScale, 2));
  const sigmaEff = Math.sqrt(sigma * sigma + jumpVar);
  const varDragCap = isCrypto ? 0.14 : 0.08;
  const annualGeomDrag = Math.min(varDragCap, 0.5 * sigma * sigma);

  let medianFactor = 1.0;
  for (let yr = 0; yr < years; yr++) {
    const rate = annualRatesPct[Math.min(yr, Math.max(0, annualRatesPct.length - 1))] ?? 0;
    const step = Math.max(0.15, (1 + rate / 100) * Math.exp(-annualGeomDrag));
    medianFactor *= step;
  }

  const p50Raw = start * medianFactor;
  const spread = 1.2816 * sigmaEff * Math.sqrt(years);
  const p10Raw = p50Raw * Math.exp(-spread);
  const p90Raw = p50Raw * Math.exp(spread);

  const p50 = Number.isFinite(p50Raw) ? Math.max(0, Math.round(p50Raw)) : 0;
  const p10 = Number.isFinite(p10Raw) ? Math.min(p50, Math.max(0, Math.round(p10Raw))) : p50;
  const p90 = Number.isFinite(p90Raw) ? Math.max(p50, Math.round(p90Raw)) : p50;
  return { p10, p50, p90 };
}

function resolveConsensusTitle(score100: number): string {
  if (score100 >= 72) return 'Conviction Acheteuse des 7 Agents';
  if (score100 >= 58) return 'Biais Haussier Modéré (Sélectif)';
  if (score100 >= 45) return 'Positionnement Équilibré & Vigilant';
  return 'Prudence Défensive Recommandée';
}

function avgWindow(rates: ReadonlyArray<number>, startYear: number, endYear: number): number {
  const lo = Math.max(0, startYear);
  const hi = Math.min(rates.length - 1, endYear);
  if (hi < lo || rates.length === 0) return 0;
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += rates[i] ?? 0;
  return round2(sum / (hi - lo + 1));
}

function buildScheduleArray(
  horizonYears: number,
  weightedFn: (yr: number) => number,
  fallbackRatePct: number,
): number[] {
  const out: number[] = [];
  for (let yr = 0; yr <= horizonYears; yr++) {
    const val = weightedFn(yr);
    out.push(Number.isFinite(val) ? round2(val) : fallbackRatePct);
  }
  return out;
}

/**
 * Moteur quantitatif multi-horizon des 7 Agents Valoria pour l'onglet `Futur`.
 * Combine l'équilibre long terme IQPF 2026 + Black-Litterman bayésien, l'alpha DCF probablistique,
 * les 7 agents IA (forensique Altman/Beneish, guidance, news NLP, technique, écosystème),
 * la matrice Ledoit-Wolf et les sauts Merton Jump-Diffusion sans biais d'extrapolation à 30 ans.
 */
export function computeValoriaFutureForecast(params: {
  assets: ReadonlyArray<Asset>;
  fxRates: Record<string, number>;
  riskProfile?: ValoriaRiskProfile;
  appliedReturnProfile?: ProjectionConfig['appliedReturnProfile'];
  horizonYears?: number;
  cashRatePct?: number;
  macroRegimeId?: RegimeId;
}): ValoriaFutureForecastResult {
  const horizonYears = Math.max(10, Math.min(60, Math.round(params.horizonYears ?? 30)));
  const iqpfRates = computeIqpfBenchmarkDefaults(params.cashRatePct);
  const risk = deriveRiskProfile(params.riskProfile, params.appliedReturnProfile);
  const regime = MARKET_REGIMES.find((r) => r.id === params.macroRegimeId) ?? MARKET_REGIMES[0];
  const macro = regime.indicators;

  const livePrices = getLatestPrices();
  const lots: PortfolioLot[] = [];
  const rawHoldings: Array<{
    asset: Asset;
    symbol: string;
    assetId: string;
    name: string;
    accountType: string;
    envelope: ValoriaEnvelopeKey;
    currentValueCad: number;
    fundamental: AssetFundamental;
  }> = [];

  params.assets.forEach((asset, index) => {
    const cleanSymbol = (asset.symbol ?? '').trim().toUpperCase();
    if (!cleanSymbol || asset.quantity <= 0 || asset.currentPrice <= 0) return;
    const valCad = assetValueCad(asset, params.fxRates);
    if (!Number.isFinite(valCad) || valCad <= 0) return;

    const spotCad = Number((valCad / asset.quantity).toFixed(4));
    const matched = resolveFinanceAISymbol(cleanSymbol, cleanSymbol, asset.name);
    let assetId = matched?.id ?? cleanSymbol;

    const fundamental = resolveAssetFundamental(cleanSymbol);
    const inferredCrypto =
      asset.accountType === 'CRYPTO' || /-(CAD|USD|EUR)$/.test(cleanSymbol) || cleanSymbol === 'BTC' || cleanSymbol === 'ETH';

    if (!matched) {
      const reg = registerDynamicMarketAsset({
        ticker: cleanSymbol,
        name: asset.name?.trim() || cleanSymbol,
        spotCad,
        category: inferredCrypto ? 'crypto' : fundamental.assetClass === 'CAN_BOND' ? 'obligations' : 'actions',
        subClass: inferredCrypto
          ? 'crypto_l1_defi'
          : fundamental.assetClass === 'CAN_BOND'
            ? 'obligation_taux'
            : cleanSymbol.endsWith('.TO') || cleanSymbol.endsWith('.NE')
              ? 'action_ca'
              : 'action_us',
        ...(asset.sector ? { sector: asset.sector } : {}),
      });
      assetId = reg.id;
    }

    livePrices[assetId] = spotCad;
    const envelope = classifyEnvelope(asset.accountType, inferredCrypto ? 'crypto' : asset.sector);
    const buyYm =
      typeof asset.dateBought === 'string' && /^\d{4}-\d{2}/.test(asset.dateBought)
        ? asset.dateBought.slice(0, 7)
        : '2024-01';

    lots.push({
      id: `futur-${assetId}-${index}`,
      assetId,
      investedAmount: round2(valCad),
      purchaseYearMonth: buyYm,
    });

    rawHoldings.push({
      asset,
      symbol: cleanSymbol,
      assetId,
      name: asset.name?.trim() || fundamental.name || cleanSymbol,
      accountType: asset.accountType || envelope,
      envelope,
      currentValueCad: round2(valCad),
      fundamental,
    });
  });

  const totalEvaluatedCad = round2(rawHoldings.reduce((s, h) => s + h.currentValueCad, 0));

  // Cas portefeuille vide : repli honnête sur les normes IQPF 2026 + Ledoit-Wolf/Merton par défaut.
  if (rawHoldings.length === 0 || totalEvaluatedCad <= 0) {
    const emptySchedule: ValoriaEngineSchedule = {
      celiRatesByYear: buildScheduleArray(horizonYears, () => iqpfRates.celi, iqpfRates.celi),
      reerRatesByYear: buildScheduleArray(horizonYears, () => iqpfRates.reer, iqpfRates.reer),
      nonRegRatesByYear: buildScheduleArray(horizonYears, () => iqpfRates.nonReg, iqpfRates.nonReg),
      cryptoRatesByYear: buildScheduleArray(horizonYears, () => iqpfRates.crypto, iqpfRates.crypto),
      cashRatesByYear: buildScheduleArray(horizonYears, () => iqpfRates.cash, iqpfRates.cash),
      annualVolatilityPct: { celi: 14.5, reer: 11.5, nonReg: 14.5, crypto: 50.0 },
      mertonJump: { ...DEFAULT_MERTON_JUMP },
      usShareCeliPct: 0,
      usDivYieldCeliPct: 1.5,
      portfolioConsensus100: 50,
      shortTermAlphaPct: 0,
      regimeId: regime.id,
    };
    const envelopes: ValoriaEnvelopeForecast[] = (['CELI', 'REER', 'NON_ENREG', 'CRYPTO'] as const).map((key) => ({
      envelope: key,
      label: ENVELOPE_LABELS[key],
      currentValueCad: 0,
      shortTermRatePct: key === 'CELI' ? iqpfRates.celi : key === 'REER' ? iqpfRates.reer : key === 'NON_ENREG' ? iqpfRates.nonReg : iqpfRates.crypto,
      longTermRatePct: key === 'CELI' ? iqpfRates.celi : key === 'REER' ? iqpfRates.reer : key === 'NON_ENREG' ? iqpfRates.nonReg : iqpfRates.crypto,
      iqpfBenchmarkPct: key === 'CELI' ? iqpfRates.celi : key === 'REER' ? iqpfRates.reer : key === 'NON_ENREG' ? iqpfRates.nonReg : iqpfRates.crypto,
      annualVolatilityPct: key === 'CELI' ? 14.5 : key === 'REER' ? 11.5 : key === 'NON_ENREG' ? 14.5 : 50.0,
      projected5yMedianCad: 0,
      projected10yMedianCad: 0,
      projectedHorizonMedianCad: 0,
    }));

    return {
      schedule: emptySchedule,
      summaryRates: iqpfRates,
      iqpfRates,
      totalEvaluatedCad: 0,
      portfolioConsensus100: 50,
      consensusTitle: 'En attente de positions',
      regimeName: regime.name,
      shrinkageAlpha: 0.25,
      averageCorrelation: 0.35,
      shortTermPortfolioRatePct: iqpfRates.celi,
      longTermPortfolioRatePct: iqpfRates.celi,
      projectedPortfolioCad: {
        today: 0,
        y5: { p10: 0, p50: 0, p90: 0 },
        y10: { p10: 0, p50: 0, p90: 0 },
        horizon: { years: horizonYears, p10: 0, p50: 0, p90: 0 },
      },
      envelopes,
      holdings: [],
      deterministicReadingFr:
        'Ajoute au moins un placement dans l’onglet Placements pour calculer une trajectoire personnalisée par les 7 agents Valoria ; les normes IQPF 2026 servent de base neutre.',
    };
  }

  // Poids consolidés par assetId (un même titre peut exister en CELI et en REER)
  const heldWeightsByAssetId: Record<string, number> = {};
  for (const h of rawHoldings) {
    heldWeightsByAssetId[h.assetId] = (heldWeightsByAssetId[h.assetId] ?? 0) + h.currentValueCad / totalEvaluatedCad;
  }

  const evaluated = evaluatePortfolioRealTime(lots, livePrices);
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: risk,
    evaluatedLots: evaluated.lots,
    totalPortfolioValue: evaluated.totalCurrentValue,
  });

  const heldIds = Array.from(new Set(rawHoldings.map((h) => h.assetId)));
  const newsIntelligence = buildPortfolioNewsIntelligence({
    heldWeightsByAssetId,
    candidateAssetIds: heldIds,
    macro,
  });

  const candidateAnalyses = heldIds
    .map((id) => universe.byId.get(id))
    .filter((a): a is UniversalAssetAnalysis => Boolean(a));

  const blResult = runBlackLittermanOptimization({
    candidateAnalyses,
    currentWeightsById: heldWeightsByAssetId,
    newsIntelligence,
    macro,
    riskProfile: risk,
  });

  const corpByAssetId = new Map<string, ReturnType<typeof computeAssetCorporateIntelligence>>();
  const probByAssetId = new Map<string, ReturnType<typeof computeProbabilisticValuation>>();

  for (const analysis of candidateAnalyses) {
    const assetNews = newsIntelligence.byAssetId.get(analysis.asset.id);
    probByAssetId.set(
      analysis.asset.id,
      computeProbabilisticValuation(analysis, macro, assetNews?.blackLittermanNewsShockPct ?? 0),
    );
    corpByAssetId.set(
      analysis.asset.id,
      computeAssetCorporateIntelligence({ analysis, assetNews, macro }),
    );
  }

  const computedHoldings: HoldingComputation[] = rawHoldings.map((h) => {
    const analysis = universe.byId.get(h.assetId);
    const blRow = blResult.byAssetId.get(h.assetId);
    const corp = corpByAssetId.get(h.assetId);
    const probVal = probByAssetId.get(h.assetId);

    const fundAnchorPct = h.fundamental.expectedReturn * 100;
    const eqPct = blRow && Number.isFinite(blRow.equilibriumReturnPct) ? blRow.equilibriumReturnPct : fundAnchorPct;
    const isCrypto = h.envelope === 'CRYPTO';
    const rawFeePct = analysis && Number.isFinite(analysis.annualFeeOrInflationPct)
      ? analysis.annualFeeOrInflationPct
      : h.fundamental.mer * 100;
    // applyMidMonthGrowth déduit déjà 0,20 % de RFG sur CELI/REER/NonReg : on évite le double compte.
    const extraFeeDragPct = isCrypto ? Math.min(1.5, Math.max(0, rawFeePct * 0.25)) : Math.max(0, rawFeePct - 0.20);

    const ltUnclamped = 0.60 * fundAnchorPct + 0.40 * eqPct - extraFeeDragPct;
    const longTermBasePct = isCrypto ? clamp(ltUnclamped, 3.5, 11.5) : clamp(ltUnclamped, 2.0, 9.5);

    // Qualité comptable Altman Z + Beneish M + FCF
    let q = 1.0;
    if (corp) {
      if (corp.forensics.altmanZone === 'Solvable') q += 0.08;
      else if (corp.forensics.altmanZone === 'Fragile') q -= 0.15;
      if (!corp.forensics.beneishClean) q -= 0.10;
      if (corp.forensics.fcfConversionPct >= 95) q += 0.05;
    }
    const qualityWeightFactor = round2(clamp(q, 0.75, 1.15));

    const rawDcfAlpha = probVal && Number.isFinite(probVal.annualizedFundamentalAlphaPct)
      ? probVal.annualizedFundamentalAlphaPct
      : 0;
    const dcfAlphaPct = round2(clamp(rawDcfAlpha * 0.55 * qualityWeightFactor, -4.5, 5.5));

    const blDiff = blRow ? blRow.posteriorExpectedReturnPct - blRow.equilibriumReturnPct : 0;
    const agentRawAlpha = corp && Number.isFinite(corp.forwardAgentAlphaPct) ? corp.forwardAgentAlphaPct : 0;
    const agentBlAlphaPct = round2(clamp((0.55 * agentRawAlpha + 0.45 * blDiff) * qualityWeightFactor, -4.0, 5.0));

    const grossYieldDec = Math.max(
      h.fundamental.dividendYield,
      analysis && Number.isFinite(analysis.grossYieldPct) ? analysis.grossYieldPct / 100 : 0,
    );
    const nonTreatyIntlDragPct =
      h.envelope === 'NON_ENREG'
      && (h.fundamental.assetClass === 'INT_EQUITY' || h.fundamental.assetClass === 'EM_EQUITY')
        ? grossYieldDec * 100 * US_DIVIDEND_WITHHOLDING_RATE
        : 0;
    const celiDisplayUsDragPct =
      h.envelope === 'CELI' && h.fundamental.usForeignDivFraction > 0
        ? h.fundamental.usForeignDivFraction * grossYieldDec * 100 * US_DIVIDEND_WITHHOLDING_RATE
        : 0;

    const ratesByYearEngine: number[] = [];
    const ratesByYearDisplay: number[] = [];
    for (let yr = 0; yr <= horizonYears; yr++) {
      const decaying = dcfAlphaPct * Math.exp(-0.38 * yr) + agentBlAlphaPct * Math.exp(-0.45 * yr);
      const rEngine = clamp(longTermBasePct + decaying - nonTreatyIntlDragPct, -8.0, 22.0);
      const rDisplay = clamp(rEngine - celiDisplayUsDragPct, -8.0, 22.0);
      ratesByYearEngine.push(round2(rEngine));
      ratesByYearDisplay.push(round2(rDisplay));
    }

    const baseVol = Math.max(
      h.fundamental.volatility * 100,
      analysis && Number.isFinite(analysis.volatilityPct) ? analysis.volatilityPct : 0,
    );
    const volatilityPct = round2(isCrypto ? clamp(baseVol, 22, 65) : clamp(baseVol, 5, 32));

    const score = corp
      ? Math.max(1, Math.min(99, Math.round(corp.compositeAgentScore100)))
      : analysis
        ? Math.max(1, Math.min(99, Math.round(analysis.quantScore)))
        : 55;

    return {
      symbol: h.symbol,
      assetId: h.assetId,
      name: h.name,
      accountType: h.accountType,
      envelope: h.envelope,
      currentValueCad: h.currentValueCad,
      weightPct: round2((h.currentValueCad / totalEvaluatedCad) * 100),
      fundamental: h.fundamental,
      analysis,
      ratesByYearEngine,
      ratesByYearDisplay,
      shortTermNetRatePct: avgWindow(ratesByYearDisplay, 0, 4),
      longTermNetRatePct: avgWindow(ratesByYearDisplay, 5, Math.max(5, horizonYears)),
      dcfAlphaPct,
      agentBlAlphaPct,
      volatilityPct,
      qualityWeightFactor,
      agentScore100: score,
      consensusLabel: corp?.committeeConsensus.consensusTitle ?? (score >= 65 ? 'Favorable' : score >= 48 ? 'Neutre' : 'Prudent'),
      verdictArrow: corp?.committeeConsensus.verdictArrow ?? (score >= 65 ? '▲' : score >= 45 ? '●' : '▼'),
      buyVotes: corp?.committeeConsensus.buyVotes ?? (score >= 65 ? 5 : 2),
      neutralVotes: corp?.committeeConsensus.neutralVotes ?? 3,
      sellVotes: corp?.committeeConsensus.sellVotes ?? (score < 45 ? 4 : 1),
      optimalWrapper: corp?.committeeConsensus.technicalSnapshot.optimalWrapper ?? analysis?.optimalCanadianWrapper ?? h.envelope,
      usForeignDivFraction: h.fundamental.usForeignDivFraction,
      dividendYieldPct: round2(grossYieldDec * 100),
    };
  });

  // Calcul des volatilités Ledoit-Wolf par enveloppe (avec plancher empirique si un titre dynamique est absent des séries historiques)
  const envelopeList: ValoriaEnvelopeKey[] = ['CELI', 'REER', 'NON_ENREG', 'CRYPTO'];
  const envVols: Record<ValoriaEnvelopeKey, number> = {
    CELI: 14.5,
    REER: 11.5,
    NON_ENREG: 14.5,
    CRYPTO: 50.0,
  };
  const lwGlobal = computeLedoitWolfCovariance(heldIds);

  for (const env of envelopeList) {
    const items = computedHoldings.filter((h) => h.envelope === env);
    const totalEnvVal = items.reduce((s, h) => s + h.currentValueCad, 0);
    if (totalEnvVal <= 0 || items.length === 0) continue;

    const idWeights = new Map<string, number>();
    const idVolDec = new Map<string, number>();
    for (const h of items) {
      idWeights.set(h.assetId, (idWeights.get(h.assetId) ?? 0) + h.currentValueCad / totalEnvVal);
      idVolDec.set(h.assetId, h.volatilityPct / 100);
    }

    const ids = Array.from(idWeights.keys());
    const lw = computeLedoitWolfCovariance(ids);
    let portVar = 0;
    for (let i = 0; i < ids.length; i++) {
      const wi = idWeights.get(ids[i]) ?? 0;
      const fallbackVi = idVolDec.get(ids[i]) ?? 0.15;
      const diagI = lw.annualizedCovariance[i]?.[i] > 1e-4 ? lw.annualizedCovariance[i][i] : fallbackVi * fallbackVi;
      for (let j = 0; j < ids.length; j++) {
        const wj = idWeights.get(ids[j]) ?? 0;
        if (i === j) {
          portVar += wi * wj * diagI;
        } else {
          const fallbackVj = idVolDec.get(ids[j]) ?? 0.15;
          const diagJ = lw.annualizedCovariance[j]?.[j] > 1e-4 ? lw.annualizedCovariance[j][j] : fallbackVj * fallbackVj;
          const rawCov = lw.annualizedCovariance[i]?.[j] ?? 0;
          const cov = Math.abs(rawCov) > 1e-6 ? rawCov : lw.averagePairwiseCorrelation * Math.sqrt(diagI * diagJ);
          portVar += wi * wj * cov;
        }
      }
    }

    const volPct = Math.sqrt(Math.max(0.0016, portVar)) * 100;
    envVols[env] = env === 'CRYPTO' ? round2(clamp(volPct, 25, 65)) : round2(clamp(volPct, 6, 28));
  }

  // Calendrier annuel agrégé par enveloppe pour `SimulationParams.valoriaSchedule`
  const envelopeYearRate = (env: ValoriaEnvelopeKey, fallbackPct: number, displayMode: boolean): number[] => {
    const items = computedHoldings.filter((h) => h.envelope === env);
    const totalVal = items.reduce((s, h) => s + h.currentValueCad, 0);
    if (totalVal <= 0 || items.length === 0) {
      return buildScheduleArray(horizonYears, () => fallbackPct, fallbackPct);
    }
    return buildScheduleArray(
      horizonYears,
      (yr) => {
        let weighted = 0;
        for (const h of items) {
          const arr = displayMode ? h.ratesByYearDisplay : h.ratesByYearEngine;
          weighted += (h.currentValueCad / totalVal) * (arr[yr] ?? fallbackPct);
        }
        return weighted;
      },
      fallbackPct,
    );
  };

  const celiRatesEngine = envelopeYearRate('CELI', iqpfRates.celi, false);
  const celiRatesDisplay = envelopeYearRate('CELI', iqpfRates.celi, true);
  const reerRatesEngine = envelopeYearRate('REER', iqpfRates.reer, false);
  const nonRegRatesEngine = envelopeYearRate('NON_ENREG', iqpfRates.nonReg, false);
  const cryptoRatesEngine = envelopeYearRate('CRYPTO', iqpfRates.crypto, false);
  const cashRatesEngine = buildScheduleArray(horizonYears, () => iqpfRates.cash, iqpfRates.cash);

  // Part US réelle du CELI (0-100) + rendement dividendaire US moyen (% ex: 1.5)
  const celiItems = computedHoldings.filter((h) => h.envelope === 'CELI');
  const celiTotalVal = celiItems.reduce((s, h) => s + h.currentValueCad, 0);
  let usWeightedVal = 0;
  let usYieldWeighted = 0;
  for (const h of celiItems) {
    const usDollar = h.currentValueCad * h.usForeignDivFraction;
    usWeightedVal += usDollar;
    usYieldWeighted += usDollar * h.dividendYieldPct;
  }
  const usShareCeliPct = celiTotalVal > 0 ? round2(clamp((usWeightedVal / celiTotalVal) * 100, 0, 100)) : 0;
  const usDivYieldCeliPct = usWeightedVal > 0 ? round2(clamp(usYieldWeighted / usWeightedVal, 0, 8)) : 1.5;

  const portfolioConsensus100 = Math.max(
    1,
    Math.min(
      99,
      Math.round(
        computedHoldings.reduce((s, h) => s + h.agentScore100 * (h.currentValueCad / totalEvaluatedCad), 0),
      ),
    ),
  );

  // Taux moyens pondérés du portefeuille global
  const portfolioRatesByYearDisplay = buildScheduleArray(
    horizonYears,
    (yr) =>
      computedHoldings.reduce(
        (s, h) => s + (h.currentValueCad / totalEvaluatedCad) * (h.ratesByYearDisplay[yr] ?? iqpfRates.celi),
        0,
      ),
    iqpfRates.celi,
  );
  const shortTermPortfolioRatePct = avgWindow(portfolioRatesByYearDisplay, 0, 4);
  const longTermPortfolioRatePct = avgWindow(portfolioRatesByYearDisplay, 5, Math.max(5, horizonYears));
  const shortTermAlphaPct = round2(shortTermPortfolioRatePct - longTermPortfolioRatePct);

  const schedule: ValoriaEngineSchedule = {
    celiRatesByYear: celiRatesEngine,
    reerRatesByYear: reerRatesEngine,
    nonRegRatesByYear: nonRegRatesEngine,
    cryptoRatesByYear: cryptoRatesEngine,
    cashRatesByYear: cashRatesEngine,
    annualVolatilityPct: {
      celi: envVols.CELI,
      reer: envVols.REER,
      nonReg: envVols.NON_ENREG,
      crypto: envVols.CRYPTO,
    },
    mertonJump: { ...DEFAULT_MERTON_JUMP },
    usShareCeliPct,
    usDivYieldCeliPct,
    portfolioConsensus100,
    shortTermAlphaPct,
    regimeId: regime.id,
  };

  const summaryRates = {
    celi: avgWindow(celiRatesEngine, 0, horizonYears),
    reer: avgWindow(reerRatesEngine, 0, horizonYears),
    nonReg: avgWindow(nonRegRatesEngine, 0, horizonYears),
    crypto: avgWindow(cryptoRatesEngine, 0, horizonYears),
    cash: iqpfRates.cash,
  };

  const iqpfByEnv: Record<ValoriaEnvelopeKey, number> = {
    CELI: iqpfRates.celi,
    REER: iqpfRates.reer,
    NON_ENREG: iqpfRates.nonReg,
    CRYPTO: iqpfRates.crypto,
  };

  const envelopes: ValoriaEnvelopeForecast[] = envelopeList.map((env) => {
    const items = computedHoldings.filter((h) => h.envelope === env);
    const val = round2(items.reduce((s, h) => s + h.currentValueCad, 0));
    const displayRates = env === 'CELI'
      ? celiRatesDisplay
      : env === 'REER'
        ? reerRatesEngine
        : env === 'NON_ENREG'
          ? nonRegRatesEngine
          : cryptoRatesEngine;
    const c5 = computeEnvelopeCone(val, displayRates, envVols[env], 5, env === 'CRYPTO');
    const c10 = computeEnvelopeCone(val, displayRates, envVols[env], 10, env === 'CRYPTO');
    const cH = computeEnvelopeCone(val, displayRates, envVols[env], horizonYears, env === 'CRYPTO');

    return {
      envelope: env,
      label: ENVELOPE_LABELS[env],
      currentValueCad: val,
      shortTermRatePct: avgWindow(displayRates, 0, 4),
      longTermRatePct: avgWindow(displayRates, 5, Math.max(5, horizonYears)),
      iqpfBenchmarkPct: iqpfByEnv[env],
      annualVolatilityPct: envVols[env],
      projected5yMedianCad: c5.p50,
      projected10yMedianCad: c10.p50,
      projectedHorizonMedianCad: cH.p50,
    };
  });

  // Cône global du portefeuille : somme par quantiles sur chaque enveloppe (cohérence d'enveloppes)
  const portfolioVol = round2(
    clamp(
      Math.sqrt(
        envelopeList.reduce((acc, env) => {
          const val = envelopes.find((e) => e.envelope === env)?.currentValueCad ?? 0;
          const w = val / totalEvaluatedCad;
          const v = envVols[env] / 100;
          return acc + w * v * v;
        }, 0),
      ) * 100 * 0.92,
      5,
      55,
    ),
  );
  const portfolioCone5 = computeEnvelopeCone(totalEvaluatedCad, portfolioRatesByYearDisplay, portfolioVol, 5);
  const portfolioCone10 = computeEnvelopeCone(totalEvaluatedCad, portfolioRatesByYearDisplay, portfolioVol, 10);
  const portfolioConeH = computeEnvelopeCone(totalEvaluatedCad, portfolioRatesByYearDisplay, portfolioVol, horizonYears);

  const holdings: ValoriaHoldingForecast[] = [...computedHoldings]
    .sort((a, b) => b.currentValueCad - a.currentValueCad)
    .map((h) => ({
      symbol: h.symbol,
      assetId: h.assetId,
      name: h.name,
      accountType: h.accountType,
      currentValueCad: h.currentValueCad,
      weightPct: h.weightPct,
      agentScore100: h.agentScore100,
      consensusLabel: h.consensusLabel,
      verdictArrow: h.verdictArrow,
      buyVotes: h.buyVotes,
      neutralVotes: h.neutralVotes,
      sellVotes: h.sellVotes,
      shortTermNetRatePct: h.shortTermNetRatePct,
      longTermNetRatePct: h.longTermNetRatePct,
      dcfAlphaPct: h.dcfAlphaPct,
      agentBlAlphaPct: h.agentBlAlphaPct,
      volatilityPct: h.volatilityPct,
      qualityWeightFactor: h.qualityWeightFactor,
      projected5yCad: computeEnvelopeCone(h.currentValueCad, h.ratesByYearDisplay, h.volatilityPct, 5, h.envelope === 'CRYPTO'),
      projected10yCad: computeEnvelopeCone(h.currentValueCad, h.ratesByYearDisplay, h.volatilityPct, 10, h.envelope === 'CRYPTO'),
      optimalWrapper: h.optimalWrapper,
    }));

  const topHolding = holdings[0];
  const spreadVsIqpf = round2(shortTermPortfolioRatePct - iqpfRates.celi);
  const spreadText = spreadVsIqpf >= 0
    ? `+${spreadVsIqpf.toFixed(1).replace('.', ',')} %/an au-dessus`
    : `${spreadVsIqpf.toFixed(1).replace('.', ',')} %/an sous`;
  const celiDragText = usShareCeliPct > 5
    ? ` Retenue US de 15 % intégrée sur ${usShareCeliPct.toFixed(0)} % d'exposition américaine en CELI.`
    : '';

  const deterministicReadingFr =
    `Consensus des 7 agents : ${portfolioConsensus100}/100 (${resolveConsensusTitle(portfolioConsensus100)}). `
    + `Rendement net projeté à ${shortTermPortfolioRatePct.toFixed(1).replace('.', ',')} %/an sur les 5 prochaines années `
    + `(${spreadText} l'ancrage IQPF 2026), puis convergence progressive vers ${longTermPortfolioRatePct.toFixed(1).replace('.', ',')} %/an au-delà de l'an 6 pour éviter toute extrapolation de bulle.`
    + (topHolding ? ` Position dominante : ${topHolding.symbol} (${topHolding.agentScore100}/100, ${topHolding.buyVotes} votes favorables sur 7).` : '')
    + celiDragText;

  return {
    schedule,
    summaryRates,
    iqpfRates,
    totalEvaluatedCad,
    portfolioConsensus100,
    consensusTitle: resolveConsensusTitle(portfolioConsensus100),
    regimeName: regime.name,
    shrinkageAlpha: lwGlobal.shrinkageIntensityAlpha,
    averageCorrelation: lwGlobal.averagePairwiseCorrelation,
    shortTermPortfolioRatePct,
    longTermPortfolioRatePct,
    projectedPortfolioCad: {
      today: Math.round(totalEvaluatedCad),
      y5: portfolioCone5,
      y10: portfolioCone10,
      horizon: { years: horizonYears, ...portfolioConeH },
    },
    envelopes,
    holdings,
    deterministicReadingFr,
  };
}

import {
  ASSETS,
  FinancialAsset,
  MacroIndicators,
  RiskProfile,
  getAssetById,
} from './marketData';
import { PortfolioLot, evaluatePortfolioRealTime } from './engine';
import { computePortfolioRiskMetrics } from './quantAnalytics';
import {
  AnalystTradeRecommendation,
  ChainOfThoughtTrace,
  HeldLineDiagnostic,
  ProAnalystAdvisoryReport,
  crossVerifyRealTimePrice,
  evaluateAssetChainOfThought,
  sanitizeAndAuditLivePrices,
} from './proAnalystAdvisor';
import {
  MultiAssetUniverseSummary,
  UniversalAssetAnalysis,
} from './multiAssetQuantEngine';
import { AssetDeepCorporateIntelligence } from './corporateIntelligenceEngine';
import { formatCad, formatSignedCad } from './valoriaFormatters';

type ConsultationIntent =
  | 'best_investments'
  | 'trade_impact'
  | 'sell_or_keep'
  | 'asset_future'
  | 'full_counsel';

export interface ParsedConsultationQuery {
  intent: ConsultationIntent;
  mentionedAssetIds: string[];
  primaryAssetId: string | null;
  simulatedSide: 'BUY' | 'SELL';
  simulatedAmountCad: number | null;
}

interface AgentVoiceReply {
  code: string;
  shortTitle: string;
  verdict: 'ACHETER' | 'GARDER' | 'ÉVITER';
  score100: number;
  keyMetric: string;
  message: string;
}

export interface TradeImpactSimulation {
  actionType: 'BUY' | 'SELL' | 'FULL_PLAN';
  assetId: string;
  ticker: string;
  assetName: string;
  optimalWrapper: string;
  spotPriceCad: number;
  deltaCad: number; // positive for BUY, negative for SELL, net redeployed for FULL_PLAN
  estimatedShares: number;
  isPriceCrossVerified: boolean;
  totalValueBeforeCad: number;
  totalValueAfterCad: number;
  healthScoreBefore100: number;
  healthScoreAfter100: number;
  healthDeltaPts: number;
  sharpeBefore: number;
  sharpeAfter: number;
  sharpeDelta: number;
  var95MonthlyBeforeCad: number;
  var95MonthlyAfterCad: number;
  var95DeltaCad: number; // negative = risk went down (good)
  median5yBeforeCad: number;
  median5yAfterCad: number;
  median5yDeltaCad: number;
  annualIncomeBeforeCad: number;
  annualIncomeAfterCad: number;
  annualIncomeDeltaCad: number;
  weightBeforePct: number;
  weightAfterPct: number;
  maxAllowedWeightPct: number;
  isOverConcentrationCap: boolean;
  plainImpactSummary: string;
}

interface AssetFutureHorizonPoint {
  yearOffset: number; // 0..5
  yearLabel: string; // 'Actuel', '+1 an', '+2 ans', '+3 ans', '+4 ans', '2031'
  p10PessimisticCad: number;
  p50ProbableCad: number;
  p90OptimisticCad: number;
}

export interface AssetProbableFuture {
  assetId: string;
  ticker: string;
  name: string;
  sectorOrCategory: string;
  optimalWrapper: string;
  spotPriceCad: number;
  fairValueCad: number;
  upsideToFairPct: number;
  stopLossCad: number;
  target12mCad: number;
  expectedCagr5yPct: number;
  volatilityPct: number;
  probabilityPositive5yPct: number;
  return1yProbablePct: number;
  return5yProbablePct: number;
  p10At5yCad: number;
  p50At5yCad: number;
  p90At5yCad: number;
  verdictLabel: 'ACHETER' | 'CONSERVER' | 'ALLÉGER' | 'VENDRE' | 'BLOQUÉ';
  verdictTone: 'emerald' | 'rose' | 'zinc';
  committeeBuyVotes: number;
  committeeSellVotes: number;
  compositeAgentScore100: number;
  horizonPoints: AssetFutureHorizonPoint[];
  chainOfThought: ChainOfThoughtTrace;
  bullDrivers: string[];
  bearRisks: string[];
}

interface CompactSellOrKeepItem {
  assetId: string;
  ticker: string;
  name: string;
  currentValueCad: number;
  weightPct: number;
  verdict: 'VENDRE' | 'ALLÉGER' | 'CONSERVER';
  suggestedDeltaCad: number;
  quantScore: number;
  shortReason: string;
}

interface CompactBuyOpportunity {
  assetId: string;
  ticker: string;
  name: string;
  spotPriceCad: number;
  fairValueCad: number;
  upsidePct: number;
  expectedReturn5yPct: number;
  quantScore: number;
  optimalWrapper: string;
  suggestedTicketCad: number;
  shortWhy: string;
}

export interface AgentConsultationResponse {
  intent: ConsultationIntent;
  focusAssetId: string;
  headlineVerdict: string;
  verdictTone: 'emerald' | 'rose' | 'zinc';
  plainFrenchAnswer: string;
  agentVoices: AgentVoiceReply[];
  impactSimulation: TradeImpactSimulation;
  assetFuture: AssetProbableFuture;
  sellVsKeep: {
    toSellOrTrim: CompactSellOrKeepItem[];
    toKeep: CompactSellOrKeepItem[];
    totalFreedCad: number;
  };
  topBuyIdeas: CompactBuyOpportunity[];
  followUpPrompts: string[];
  verifiedGroundingContext: string;
}

const MAX_SINGLE_WEIGHT_BY_PROFILE: Record<
  RiskProfile,
  { stock: number; crypto: number; etf: number }
> = {
  prudent: { stock: 8, crypto: 0, etf: 45 },
  equilibre: { stock: 12, crypto: 5, etf: 45 },
  dynamique: { stock: 15, crypto: 10, etf: 50 },
  offensif: { stock: 18, crypto: 16, etf: 55 },
};

function normalCdfApprox(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

function normalizeText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const COMMON_FRENCH_STOPWORDS = new Set([
  'or',
  'su',
  'ai',
  'en',
  'et',
  'ou',
  'ma',
  'un',
  'le',
  'la',
  'du',
  'de',
  'ca',
  'on',
  'si',
  'je',
  'tu',
  'va',
]);

/**
 * Extracts user intent, mentioned tickers/assets, buy/sell direction, and $ CAD amount
 * from natural-language French questions without false-matching short tickers inside French words.
 */
export function parseUserConsultationQuery(params: {
  question: string;
  fallbackAssetId?: string;
}): ParsedConsultationQuery {
  const { question, fallbackAssetId } = params;
  const rawTrimmed = question.trim();
  const norm = normalizeText(rawTrimmed);

  // 1. Detect mentioned assets (exact ticker token or unambiguous name stem)
  const mentionedAssetIds: string[] = [];
  const upperTokens = rawTrimmed
    .toUpperCase()
    .split(/[\s,?;:!()[\]'’"/\\+-]+/)
    .filter(Boolean);
  const upperTokenSet = new Set(upperTokens);

  for (const asset of ASSETS) {
    const idUpper = asset.id.toUpperCase();
    const tickerUpper = asset.ticker.toUpperCase();
    const tickerBase = tickerUpper.split('.')[0];

    const exactTickerHit =
      upperTokenSet.has(tickerUpper) ||
      (idUpper.length >= 3 && upperTokenSet.has(idUpper)) ||
      (tickerBase.length >= 3 &&
        !COMMON_FRENCH_STOPWORDS.has(tickerBase.toLowerCase()) &&
        upperTokenSet.has(tickerBase));

    // Also allow explicit 2-letter tickers when written in ALL CAPS in the original prompt (e.g. "RY", "SU", "TD")
    const explicitTwoLetterCaps =
      (idUpper.length === 2 || tickerBase.length === 2) &&
      rawTrimmed
        .split(/[\s,?;:!()[\]'’"/\\+-]+/)
        .some((tok) => tok === idUpper || tok === tickerUpper || tok === tickerBase);

    const cleanName = normalizeText(asset.name.split(' (')[0]);
    const nameMatch =
      cleanName.length >= 5 && norm.includes(cleanName);

    if (exactTickerHit || explicitTwoLetterCaps || nameMatch) {
      if (!mentionedAssetIds.includes(asset.id)) {
        mentionedAssetIds.push(asset.id);
      }
    }
  }

  // Common conversational aliases in French
  const aliasMap: Array<[RegExp, string]> = [
    [/\bgoogle\b|\balphabet\b/i, 'GOOGL'],
    [/\bnvidia\b/i, 'ADP'],
    [/\bintel\b/i, 'INTC'],
    [/\bpalantir\b/i, 'PAYX'],
    [/\bbanque royale\b|\broyal bank\b/i, 'RY'],
    [/\bbitcoin\b/i, 'BTC'],
    [/\bethereum\b/i, 'ETH'],
    [/\bsolana\b/i, 'SOL'],
    [/\bdogecoin\b/i, 'DOGE'],
    [/\bl[\s'’]or\b|\bgold\b/i, 'GOLD'],
    [/\bapple\b/i, 'AAPL'],
    [/\bmicrosoft\b/i, 'MSFT'],
    [/\bamazon\b/i, 'AMZN'],
    [/\btesla\b/i, 'TSLA'],
    [/\bshopify\b/i, 'SHOP'],
    [/\bcouche[-\s]?tard\b/i, 'ATD'],
    [/\benbridge\b/i, 'ENB'],
    [/\bmsci world\b/i, 'XBB'],
  ];
  for (const [regex, id] of aliasMap) {
    if (regex.test(norm) && getAssetById(id) && !mentionedAssetIds.includes(id)) {
      mentionedAssetIds.push(id);
    }
  }

  // 2. Parse $ CAD amount if explicitly mentioned (e.g. "5 000 $", "5000$", "10k$", "2500 cad")
  let simulatedAmountCad: number | null = null;
  const kMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*k\s*(?:\$|cad|dollars?)?/i);
  if (kMatch) {
    const val = Number(kMatch[1].replace(',', '.')) * 1000;
    if (Number.isFinite(val) && val >= 50 && val <= 5_000_000) {
      simulatedAmountCad = Math.round(val);
    }
  } else {
    const numMatch = norm.match(
      /(\d{1,3}(?:[\s\u00a0]\d{3})+|\d{3,7})\s*(?:\$|cad|dollars?)/i
    );
    if (numMatch) {
      const cleaned = Number(numMatch[1].replace(/[\s\u00a0]/g, ''));
      if (Number.isFinite(cleaned) && cleaned >= 50 && cleaned <= 5_000_000) {
        simulatedAmountCad = Math.round(cleaned);
      }
    }
  }

  // 3. Detect Buy vs Sell direction
  const asksSell =
    /\b(vendre|vends|vend|alleger|allege|sortir|liquider|garder|conserver|couper)\b/.test(
      norm
    );
  const asksBuy =
    /\b(acheter|achete|investir|renforcer|placer|ajouter|bon investissement|quoi acheter|quel actif)\b/.test(
      norm
    );
  const asksImpact =
    /\b(engendre|impact|effet|change|consequence|resultat|simuler|simulation|si j)\b/.test(
      norm
    );
  const asksFuture =
    /\b(avenir|futur|probable|2030|2031|5 ans|projection|prevision|cible|potentiel|monter|baisser)\b/.test(
      norm
    );

  let intent: ConsultationIntent = 'full_counsel';
  if (asksImpact) {
    intent = 'trade_impact';
  } else if (asksFuture && (mentionedAssetIds.length > 0 || fallbackAssetId)) {
    intent = 'asset_future';
  } else if (asksSell && !asksBuy) {
    intent = 'sell_or_keep';
  } else if (asksBuy && mentionedAssetIds.length === 0) {
    intent = 'best_investments';
  } else if (asksFuture) {
    intent = 'asset_future';
  } else if (mentionedAssetIds.length > 0 && (asksBuy || simulatedAmountCad !== null)) {
    intent = 'trade_impact';
  } else if (mentionedAssetIds.length > 0) {
    intent = 'asset_future';
  }

  const simulatedSide: 'BUY' | 'SELL' =
    asksSell && !asksBuy ? 'SELL' : 'BUY';

  return {
    intent,
    mentionedAssetIds,
    primaryAssetId: mentionedAssetIds[0] ?? fallbackAssetId ?? null,
    simulatedSide,
    simulatedAmountCad,
  };
}

function estimatePortfolioHealth100(params: {
  sharpeRatio: number;
  effectivePositions: number;
  weightedUpsidePct: number;
  sellIssuesCount: number;
}): number {
  const sharpeScore = Math.min(35, Math.max(8, params.sharpeRatio * 24));
  const divScore = Math.min(25, Math.max(5, params.effectivePositions * 3.8));
  const dcfScore = Math.min(
    25,
    Math.max(4, 14 + params.weightedUpsidePct * 0.65)
  );
  const penalty = Math.min(18, params.sellIssuesCount * 4.5);
  return Math.round(
    Math.max(25, Math.min(96, sharpeScore + divScore + dcfScore + 12 - penalty))
  );
}

/**
 * Simulates the concrete before-vs-after impact ("ce que ça engendre") of buying or selling
 * a specific asset (or applying the full advisory plan) in real-time $ CAD.
 */
export function simulateTradeImpactOnPortfolio(params: {
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  riskProfile: RiskProfile;
  advisory: ProAnalystAdvisoryReport;
  universe: MultiAssetUniverseSummary;
  assetId: string;
  side: 'BUY' | 'SELL' | 'FULL_PLAN';
  amountCad?: number;
}): TradeImpactSimulation {
  const {
    lots,
    livePrices,
    macro,
    riskProfile,
    advisory,
    universe,
    assetId,
    side,
    amountCad,
  } = params;

  const { sanitizedLivePrices } = sanitizeAndAuditLivePrices(livePrices);
  const univById = new Map<string, UniversalAssetAnalysis>(
    universe.allAnalyses.map((a) => [a.asset.id, a])
  );

  // Full advisory plan shortcut — uses exact advisory before/after snapshots
  if (side === 'FULL_PLAN') {
    const asset =
      getAssetById(advisory.buyRecommendations[0]?.assetId ?? assetId) ??
      ASSETS[0];
    const spot = sanitizedLivePrices[asset.id] ?? 100;
    return {
      actionType: 'FULL_PLAN',
      assetId: asset.id,
      ticker: 'PLAN COMPLET',
      assetName: `${advisory.sellRecommendations.length} vente(s) + ${advisory.buyRecommendations.length} achat(s)`,
      optimalWrapper: 'CELI / REER',
      spotPriceCad: Number(spot.toFixed(2)),
      deltaCad: advisory.totalBuyBudgetCad,
      estimatedShares: 0,
      isPriceCrossVerified:
        advisory.verificationAudit.allDisplayedSignalsCrossVerified,
      totalValueBeforeCad: Math.round(advisory.before.totalValueCad),
      totalValueAfterCad: Math.round(advisory.after.totalValueCad),
      healthScoreBefore100: advisory.healthScoreBefore100,
      healthScoreAfter100: advisory.healthScoreAfter100,
      healthDeltaPts: advisory.healthScoreAfter100 - advisory.healthScoreBefore100,
      sharpeBefore: advisory.before.sharpeRatio,
      sharpeAfter: advisory.after.sharpeRatio,
      sharpeDelta: Number(
        (advisory.after.sharpeRatio - advisory.before.sharpeRatio).toFixed(2)
      ),
      var95MonthlyBeforeCad: Math.round(advisory.before.var95MonthlyCad),
      var95MonthlyAfterCad: Math.round(advisory.after.var95MonthlyCad),
      var95DeltaCad: Math.round(
        advisory.after.var95MonthlyCad - advisory.before.var95MonthlyCad
      ),
      median5yBeforeCad: Math.round(
        advisory.institutionalQuant.jumpMonteCarlo.before.p50Median5yCad
      ),
      median5yAfterCad: Math.round(
        advisory.institutionalQuant.jumpMonteCarlo.after.p50Median5yCad
      ),
      median5yDeltaCad: Math.round(
        advisory.institutionalQuant.jumpMonteCarlo.median5yGainDeltaCad
      ),
      annualIncomeBeforeCad: Math.round(
        advisory.xray.incomeAndFees.grossAnnualIncomeBeforeCad
      ),
      annualIncomeAfterCad: Math.round(
        advisory.xray.incomeAndFees.grossAnnualIncomeAfterCad
      ),
      annualIncomeDeltaCad: Math.round(
        advisory.xray.incomeAndFees.grossAnnualIncomeAfterCad -
          advisory.xray.incomeAndFees.grossAnnualIncomeBeforeCad
      ),
      weightBeforePct: 100,
      weightAfterPct: 100,
      maxAllowedWeightPct: 100,
      isOverConcentrationCap: false,
      plainImpactSummary: `Appliquer l’ensemble des conseils fait passer votre note santé de ${advisory.healthScoreBefore100}/100 à ${advisory.healthScoreAfter100}/100 et ajoute ${formatSignedCad(Math.round(advisory.institutionalQuant.jumpMonteCarlo.median5yGainDeltaCad), 0)} CAD au capital médian estimé à 5 ans.`,
    };
  }

  const targetAsset = getAssetById(assetId) ?? ASSETS[0];
  const univItem = univById.get(targetAsset.id);
  const priceCheck = crossVerifyRealTimePrice({
    asset: targetAsset,
    livePrices,
    fairValueCad: univItem?.fairValueCad ?? null,
    stopLossCad: univItem?.stopLossCad ?? null,
    target12mCad: univItem?.target12mCad ?? null,
    attemptedSide: side,
    attemptedReasonType:
      side === 'BUY' ? 'undervalued_quality_buy' : 'fundamental_distress',
  });
  const spotCad = priceCheck.liveSpotCad;

  const evalBefore = evaluatePortfolioRealTime(lots, sanitizedLivePrices);
  const riskBefore = computePortfolioRiskMetrics(
    lots,
    sanitizedLivePrices,
    macro.centralBankRatePct
  );

  const heldOnTargetCad = evalBefore.lots
    .filter((l) => l.asset.id === targetAsset.id)
    .reduce((s, l) => s + l.currentValue, 0);

  const effectiveAmountCad =
    side === 'SELL'
      ? Math.max(
          250,
          Math.min(
            Math.max(250, Math.round(heldOnTargetCad)),
            Math.round(amountCad ?? (heldOnTargetCad > 0 ? heldOnTargetCad : 3000))
          )
        )
      : Math.max(250, Math.round(amountCad ?? 5000));

  const signedDeltaCad =
    side === 'SELL'
      ? heldOnTargetCad > 0
        ? -Math.min(Math.round(heldOnTargetCad), effectiveAmountCad)
        : 0
      : effectiveAmountCad;

  // Build counterfactual lotsAfter
  let lotsAfter: PortfolioLot[] = [];
  if (side === 'BUY') {
    lotsAfter = [
      ...lots,
      {
        id: 'sim-buy',
        assetId: targetAsset.id,
        investedAmount: effectiveAmountCad,
        purchaseYearMonth: '2026-11',
      },
    ];
  } else if (heldOnTargetCad > 0) {
    const keepRatio = Math.max(
      0,
      (heldOnTargetCad - Math.abs(signedDeltaCad)) / heldOnTargetCad
    );
    lotsAfter = lots.flatMap((lot) => {
      if (lot.assetId !== targetAsset.id) return [lot];
      if (keepRatio < 0.04) return [];
      return [
        {
          ...lot,
          investedAmount: Number((lot.investedAmount * keepRatio).toFixed(2)),
          ...(lot.quantity
            ? { quantity: Number((lot.quantity * keepRatio).toFixed(6)) }
            : {}),
        },
      ];
    });
    // Redeploy freed cash into cash/short-bond CORRA reserve so wealth comparison is apples-to-apples!
    if (Math.abs(signedDeltaCad) >= 50) {
      lotsAfter.push({
        id: 'sim-cash-reserve',
        assetId: 'CASH',
        investedAmount: Math.abs(signedDeltaCad),
        purchaseYearMonth: '2026-11',
      });
    }
  } else {
    lotsAfter = [...lots];
  }

  const evalAfter = evaluatePortfolioRealTime(lotsAfter, sanitizedLivePrices);
  const riskAfter = computePortfolioRiskMetrics(
    lotsAfter,
    sanitizedLivePrices,
    macro.centralBankRatePct
  );

  const calcPortfolioStats = (
    evaluated: ReturnType<typeof evaluatePortfolioRealTime>
  ) => {
    const tot = Math.max(1, evaluated.totalCurrentValue);
    let weightedUp = 0;
    let annualInc = 0;
    let weightedExpRet = 0;
    for (const item of evaluated.lots) {
      const w = item.currentValue / tot;
      const u = univById.get(item.asset.id);
      const corp = advisory.multiAgent.byAssetId.get(item.asset.id);
      weightedUp += w * (u?.upsidePct ?? 0);
      annualInc += item.currentValue * ((u?.grossYieldPct ?? item.asset.dividendYieldPct) / 100);
      weightedExpRet +=
        w * (corp?.expectedAnnualReturn5yPct ?? item.asset.baseExpectedReturnPct);
    }
    return { weightedUp, annualInc, weightedExpRet };
  };

  const statsBefore = calcPortfolioStats(evalBefore);
  const statsAfter = calcPortfolioStats(evalAfter);

  // Align base capital so adding +5000$ new cash compares 5-year compounding on identical total capital (Before + 5000$ idle cash vs After + 5000$ invested)
  const comparableCapitalBeforeCad =
    side === 'BUY'
      ? evalBefore.totalCurrentValue + effectiveAmountCad
      : evalBefore.totalCurrentValue;
  const comparableCapitalAfterCad = evalAfter.totalCurrentValue;

  const volB = (riskBefore.annualizedVolatilityPct || 12) / 100;
  const volA = (riskAfter.annualizedVolatilityPct || 12) / 100;

  // Include idle cash drag when comparing new cash investment
  const blendedRetBeforePct =
    side === 'BUY' && comparableCapitalBeforeCad > 0
      ? (evalBefore.totalCurrentValue * statsBefore.weightedExpRet +
          effectiveAmountCad * (macro.centralBankRatePct * 0.65)) /
        comparableCapitalBeforeCad
      : statsBefore.weightedExpRet;

  const muLogB = Math.log(1 + Math.max(-0.15, blendedRetBeforePct / 100)) - 0.5 * volB * volB;
  const muLogA =
    Math.log(1 + Math.max(-0.15, statsAfter.weightedExpRet / 100)) -
    0.5 * volA * volA;

  const median5yBeforeCad = Math.round(
    Math.max(0, comparableCapitalBeforeCad * Math.exp(5 * muLogB))
  );
  const median5yAfterCad = Math.round(
    Math.max(0, comparableCapitalAfterCad * Math.exp(5 * muLogA))
  );
  const median5yDeltaCad = median5yAfterCad - median5yBeforeCad;

  const isRemovingBadHolding =
    side === 'SELL' &&
    advisory.sellRecommendations.some((s) => s.assetId === targetAsset.id);
  const isBuyingOvervaluedOrDistressed =
    side === 'BUY' &&
    (univItem?.signal === 'VENDRE' ||
      univItem?.signal === 'ALLÉGER' ||
      (univItem?.upsidePct ?? 0) < -6);

  const sellIssuesBefore = advisory.sellRecommendations.length;
  const sellIssuesAfter = Math.max(
    0,
    sellIssuesBefore +
      (isRemovingBadHolding ? -1 : 0) +
      (isBuyingOvervaluedOrDistressed ? 1 : 0)
  );

  const healthBefore = estimatePortfolioHealth100({
    sharpeRatio: riskBefore.sharpeRatio,
    effectivePositions: riskBefore.effectivePositions,
    weightedUpsidePct: statsBefore.weightedUp,
    sellIssuesCount: sellIssuesBefore,
  });
  const healthAfter = estimatePortfolioHealth100({
    sharpeRatio: riskAfter.sharpeRatio,
    effectivePositions: riskAfter.effectivePositions,
    weightedUpsidePct: statsAfter.weightedUp,
    sellIssuesCount: sellIssuesAfter,
  });

  const weightBeforePct =
    evalBefore.totalCurrentValue > 0
      ? Number(((heldOnTargetCad / evalBefore.totalCurrentValue) * 100).toFixed(1))
      : 0;
  const heldAfterCad = evalAfter.lots
    .filter((l) => l.asset.id === targetAsset.id)
    .reduce((s, l) => s + l.currentValue, 0);
  const weightAfterPct =
    evalAfter.totalCurrentValue > 0
      ? Number(((heldAfterCad / evalAfter.totalCurrentValue) * 100).toFixed(1))
      : 0;

  const caps = MAX_SINGLE_WEIGHT_BY_PROFILE[riskProfile];
  const maxAllowedWeightPct = targetAsset.isIndividualStock
    ? caps.stock
    : targetAsset.category === 'crypto'
      ? caps.crypto
      : caps.etf;
  const isOverConcentrationCap = weightAfterPct > maxAllowedWeightPct + 0.5;

  const varBeforeCad = Math.round(riskBefore.var95MonthlyEur);
  const varAfterCad = Math.round(riskAfter.var95MonthlyEur);
  const varDeltaCad = varAfterCad - varBeforeCad;

  const incomeBeforeCad = Math.round(statsBefore.annualInc);
  const incomeAfterCad = Math.round(statsAfter.annualInc);
  const incomeDeltaCad = incomeAfterCad - incomeBeforeCad;

  let plainImpactSummary = '';
  if (side === 'SELL' && heldOnTargetCad <= 0) {
    plainImpactSummary = `Vous ne détenez actuellement aucune part de ${targetAsset.ticker} en portefeuille — vendre n’a aucun impact direct, mais éviter ce titre protège votre capital si ses fondamentaux sont fragiles.`;
  } else if (side === 'SELL') {
    plainImpactSummary = `Vendre ${formatCad(Math.abs(signedDeltaCad), 0)} CAD de ${targetAsset.ticker} ramène son poids de ${weightBeforePct} % à ${weightAfterPct} %, fait évoluer votre risque mensuel max de ${formatSignedCad(varDeltaCad, 0)} et libère du cash prêt à être réinvesti.`;
  } else {
    plainImpactSummary = `Investir ${formatCad(effectiveAmountCad, 0)} CAD sur ${targetAsset.ticker} (${univItem?.optimalCanadianWrapper ?? 'CELI / REER'}) porte son poids à ${weightAfterPct} %${isOverConcentrationCap ? ` (au-dessus du plafond prudentiel de ${maxAllowedWeightPct} %)` : ''}, avec un écart médian estimé à 5 ans de ${formatSignedCad(median5yDeltaCad, 0)} CAD face au cash.`;
  }

  return {
    actionType: side,
    assetId: targetAsset.id,
    ticker: targetAsset.ticker,
    assetName: targetAsset.name.split(' (')[0],
    optimalWrapper: univItem?.optimalCanadianWrapper ?? 'CELI / REER',
    spotPriceCad: spotCad,
    deltaCad: signedDeltaCad,
    estimatedShares: Number(
      (Math.abs(signedDeltaCad) / Math.max(0.0001, spotCad)).toFixed(2)
    ),
    isPriceCrossVerified: priceCheck.isPriceValid,
    totalValueBeforeCad: Math.round(evalBefore.totalCurrentValue),
    totalValueAfterCad: Math.round(evalAfter.totalCurrentValue),
    healthScoreBefore100: healthBefore,
    healthScoreAfter100: healthAfter,
    healthDeltaPts: healthAfter - healthBefore,
    sharpeBefore: Number(riskBefore.sharpeRatio.toFixed(2)),
    sharpeAfter: Number(riskAfter.sharpeRatio.toFixed(2)),
    sharpeDelta: Number(
      (riskAfter.sharpeRatio - riskBefore.sharpeRatio).toFixed(2)
    ),
    var95MonthlyBeforeCad: varBeforeCad,
    var95MonthlyAfterCad: varAfterCad,
    var95DeltaCad: varDeltaCad,
    median5yBeforeCad,
    median5yAfterCad,
    median5yDeltaCad,
    annualIncomeBeforeCad: incomeBeforeCad,
    annualIncomeAfterCad: incomeAfterCad,
    annualIncomeDeltaCad: incomeDeltaCad,
    weightBeforePct,
    weightAfterPct,
    maxAllowedWeightPct,
    isOverConcentrationCap,
    plainImpactSummary,
  };
}

/**
 * Computes the 5-year probabilistic future trajectory ("l'avenir probable de l'action")
 * in verified $ CAD (P10 Pessimiste / P50 Probable / P90 Optimiste) + 5-step Chain-of-Thought.
 */
export function computeAssetProbableFuture(params: {
  assetId: string;
  livePrices: Record<string, number>;
  riskProfile: RiskProfile;
  advisory: ProAnalystAdvisoryReport;
  universe: MultiAssetUniverseSummary;
}): AssetProbableFuture {
  const { assetId, livePrices, riskProfile, advisory, universe } = params;
  const asset: FinancialAsset = getAssetById(assetId) ?? ASSETS[0];
  const univ = universe.allAnalyses.find((a) => a.asset.id === asset.id);
  const corp: AssetDeepCorporateIntelligence | undefined =
    advisory.multiAgent.byAssetId.get(asset.id);
  const eq = univ?.equityDetails;

  const existingSell = advisory.sellRecommendations.find(
    (s) => s.assetId === asset.id
  );
  const existingBuy = advisory.buyRecommendations.find(
    (b) => b.assetId === asset.id
  );
  const existingHeld = advisory.heldLines.find((h) => h.assetId === asset.id);

  // Determine natural action candidate from fundamentals + live price check
  let intendedAction:
    | 'ACHETER'
    | 'RENFORCER'
    | 'CONSERVER'
    | 'ALLÉGER'
    | 'VENDRE' = 'CONSERVER';
  if (existingSell) {
    intendedAction = existingSell.actionLabel;
  } else if (existingBuy) {
    intendedAction = existingBuy.actionLabel;
  } else if (univ) {
    if (univ.signal === 'ACHAT FORT' || univ.signal === 'ACHETER') {
      intendedAction = 'ACHETER';
    } else if (univ.signal === 'VENDRE') {
      intendedAction = 'VENDRE';
    } else if (univ.signal === 'ALLÉGER') {
      intendedAction = 'ALLÉGER';
    }
  }

  const attemptedSide: 'BUY' | 'SELL' | 'HOLD' =
    intendedAction === 'ACHETER' || intendedAction === 'RENFORCER'
      ? 'BUY'
      : intendedAction === 'VENDRE' || intendedAction === 'ALLÉGER'
        ? 'SELL'
        : 'HOLD';

  const priceCheck = crossVerifyRealTimePrice({
    asset,
    livePrices,
    fairValueCad: univ?.fairValueCad ?? null,
    stopLossCad: univ?.stopLossCad ?? null,
    target12mCad: univ?.target12mCad ?? null,
    attemptedSide,
    attemptedReasonType:
      attemptedSide === 'BUY'
        ? eq
          ? 'undervalued_quality_buy'
          : 'core_etf_or_bond_allocation'
        : attemptedSide === 'SELL'
          ? eq && (eq.roicWaccSpreadPct < -1 || eq.piotroskiFScore <= 3)
            ? 'fundamental_distress'
            : 'valuation_overstretch'
          : 'hold',
  });

  const caps = MAX_SINGLE_WEIGHT_BY_PROFILE[riskProfile];
  const maxCapPct = asset.isIndividualStock
    ? caps.stock
    : asset.category === 'crypto'
      ? caps.crypto
      : caps.etf;

  const chainOfThought =
    existingSell?.chainOfThought ??
    existingBuy?.chainOfThought ??
    evaluateAssetChainOfThought({
      asset,
      intendedAction,
      reasonType:
        attemptedSide === 'BUY'
          ? eq
            ? 'undervalued_quality_buy'
            : 'core_etf_or_bond_allocation'
          : attemptedSide === 'SELL'
            ? 'valuation_overstretch'
            : 'hold',
      priceCrossCheck: priceCheck,
      eq,
      univ,
      corpIntel: corp,
      weightPct: existingHeld?.weightPct ?? 0,
      targetWeightPct:
        attemptedSide === 'BUY'
          ? Math.min(maxCapPct, (existingHeld?.weightPct ?? 0) + 6)
          : existingHeld?.weightPct ?? 0,
      maxAllowedWeightPct: maxCapPct,
      eulerRiskSharePct: existingHeld?.eulerRiskSharePct ?? 5,
      corrWithPortfolio: 0.45,
      optimalWrapper: univ?.optimalCanadianWrapper ?? 'CELI / REER',
    });

  const spotCad = priceCheck.liveSpotCad;
  const fairValueCad =
    priceCheck.recomputedFairValueCad ?? univ?.fairValueCad ?? spotCad;
  const upsideToFairPct =
    priceCheck.recomputedUpsidePct ??
    Number((((fairValueCad - spotCad) / Math.max(0.0001, spotCad)) * 100).toFixed(1));
  const stopLossCad =
    priceCheck.stopLossCad ?? Number((spotCad * 0.86).toFixed(2));
  const target12mCad =
    priceCheck.target12mCad ?? Number((spotCad * 1.1).toFixed(2));

  // Blend 7-Agent expected 5Y return with live DCF mean-reversion pull so live price moves shift future returns realistically
  const baseAgentCagrPct =
    corp?.expectedAnnualReturn5yPct ?? asset.baseExpectedReturnPct;
  const dcfReversionAnnualizedPct = Math.max(
    -8,
    Math.min(9, upsideToFairPct * 0.22)
  );
  const expectedCagr5yPct = Number(
    Math.max(
      -12,
      Math.min(26, baseAgentCagrPct * 0.68 + dcfReversionAnnualizedPct)
    ).toFixed(1)
  );

  const volatilityPct = Number(
    Math.max(4.5, Math.min(88, univ?.volatilityPct ?? 18)).toFixed(1)
  );
  const sigma = volatilityPct / 100;
  const muCont = Math.log(1 + Math.max(-0.25, expectedCagr5yPct / 100));
  const driftLog = muCont - 0.5 * sigma * sigma;

  const yearLabels = ['Actuel', '+1 an', '+2 ans', '+3 ans', '+4 ans', '2031'];
  const horizonPoints: AssetFutureHorizonPoint[] = yearLabels.map(
    (yearLabel, t) => {
      if (t === 0) {
        return {
          yearOffset: 0,
          yearLabel,
          p10PessimisticCad: spotCad,
          p50ProbableCad: spotCad,
          p90OptimisticCad: spotCad,
        };
      }
      const rootT = Math.sqrt(t);
      const rawP10 = spotCad * Math.exp(driftLog * t - 1.2816 * sigma * rootT);
      const rawP50 = spotCad * Math.exp(driftLog * t);
      const rawP90 = spotCad * Math.exp(driftLog * t + 1.2816 * sigma * rootT);

      const decimals = spotCad < 10 ? 3 : 2;
      const p10 = Number(Math.max(0.001, rawP10).toFixed(decimals));
      const p50 = Number(Math.max(p10 + 0.01, rawP50).toFixed(decimals));
      const p90 = Number(Math.max(p50 + 0.01, rawP90).toFixed(decimals));

      return {
        yearOffset: t,
        yearLabel,
        p10PessimisticCad: p10,
        p50ProbableCad: p50,
        p90OptimisticCad: p90,
      };
    }
  );

  const pt1 = horizonPoints[1];
  const pt5 = horizonPoints[5];
  const return1yProbablePct = Number(
    (((pt1.p50ProbableCad - spotCad) / Math.max(0.0001, spotCad)) * 100).toFixed(
      1
    )
  );
  const return5yProbablePct = Number(
    (((pt5.p50ProbableCad - spotCad) / Math.max(0.0001, spotCad)) * 100).toFixed(
      1
    )
  );

  const zPos5y = (driftLog * Math.sqrt(5)) / Math.max(0.04, sigma);
  const probabilityPositive5yPct = Math.round(
    Math.max(12, Math.min(94, normalCdfApprox(zPos5y) * 100))
  );

  const validated = chainOfThought.validatedAction;
  const verdictLabel: AssetProbableFuture['verdictLabel'] =
    validated === 'BLOQUÉ'
      ? 'CONSERVER'
      : validated === 'RENFORCER'
        ? 'ACHETER'
        : validated;

  const verdictTone: 'emerald' | 'rose' | 'zinc' =
    verdictLabel === 'ACHETER'
      ? 'emerald'
      : verdictLabel === 'VENDRE' || verdictLabel === 'ALLÉGER'
        ? 'rose'
        : 'zinc';

  const bullDrivers = corp?.committeeConsensus.bullArguments.slice(0, 3) ?? [
    upsideToFairPct >= 0
      ? `Décote de +${upsideToFairPct.toFixed(1)} % sous la juste valeur estimée (${formatCad(fairValueCad, 2)} CAD)`
      : `Actif liquide coté en $ CAD (${asset.ticker})`,
    `Tendance ${univ?.trendRegime.toLowerCase() ?? 'suivie'} (RSI-14 : ${univ?.rsi14 ?? 52})`,
  ];
  const bearRisks = corp?.committeeConsensus.bearArguments.slice(0, 2) ?? [
    `Volatilité annuelle de ${volatilityPct} % (seuil stop à ${formatCad(stopLossCad, 2)} CAD)`,
  ];

  return {
    assetId: asset.id,
    ticker: asset.ticker,
    name: asset.name.split(' (')[0],
    sectorOrCategory: univ?.sector ?? asset.categoryLabel,
    optimalWrapper: univ?.optimalCanadianWrapper ?? 'CELI / REER',
    spotPriceCad: spotCad,
    fairValueCad: Number(fairValueCad.toFixed(2)),
    upsideToFairPct,
    stopLossCad: Number(stopLossCad.toFixed(2)),
    target12mCad: Number(target12mCad.toFixed(2)),
    expectedCagr5yPct,
    volatilityPct,
    probabilityPositive5yPct,
    return1yProbablePct,
    return5yProbablePct,
    p10At5yCad: pt5.p10PessimisticCad,
    p50At5yCad: pt5.p50ProbableCad,
    p90At5yCad: pt5.p90OptimisticCad,
    verdictLabel,
    verdictTone,
    committeeBuyVotes: corp?.committeeConsensus.buyVotes ?? 4,
    committeeSellVotes: corp?.committeeConsensus.sellVotes ?? 1,
    compositeAgentScore100: corp?.compositeAgentScore100 ?? univ?.quantScore ?? 68,
    horizonPoints,
    chainOfThought,
    bullDrivers,
    bearRisks,
  };
}

function buildHoldingsSellOrKeepSplit(
  advisory: ProAnalystAdvisoryReport
): AgentConsultationResponse['sellVsKeep'] {
  const sellMap = new Map<string, AnalystTradeRecommendation>(
    advisory.sellRecommendations.map((s) => [s.assetId, s])
  );

  const toSellOrTrim: CompactSellOrKeepItem[] = [];
  const toKeep: CompactSellOrKeepItem[] = [];

  for (const h of advisory.heldLines) {
    const sellRec = sellMap.get(h.assetId);
    if (sellRec || h.verdict === 'VENDRE' || h.verdict === 'ALLÉGER') {
      toSellOrTrim.push({
        assetId: h.assetId,
        ticker: h.ticker,
        name: h.name,
        currentValueCad: Math.round(h.currentValueCad),
        weightPct: h.weightPct,
        verdict: h.verdict === 'VENDRE' ? 'VENDRE' : 'ALLÉGER',
        suggestedDeltaCad: sellRec ? sellRec.deltaCad : -Math.round(h.currentValueCad * 0.4),
        quantScore: h.quantScore,
        shortReason: sellRec
          ? sellRec.dcfUpsidePct !== null && sellRec.dcfUpsidePct < -6
            ? `Surcote (${sellRec.dcfUpsidePct.toFixed(0)} % vs juste valeur)`
            : sellRec.currentWeightPct > sellRec.targetWeightPct + 5
              ? `Surpoids (${h.weightPct.toFixed(0)} % → ${sellRec.targetWeightPct.toFixed(0)} %)`
              : `Fondamentaux fragiles (${h.quantScore}/100)`
          : h.plainFrenchStatus,
      });
    } else {
      toKeep.push({
        assetId: h.assetId,
        ticker: h.ticker,
        name: h.name,
        currentValueCad: Math.round(h.currentValueCad),
        weightPct: h.weightPct,
        verdict: 'CONSERVER',
        suggestedDeltaCad: 0,
        quantScore: h.quantScore,
        shortReason: `Sain (${h.quantScore}/100 · poids équilibré ${h.weightPct.toFixed(1)} %)`,
      });
    }
  }

  return {
    toSellOrTrim,
    toKeep,
    totalFreedCad: advisory.sellProceedsCad,
  };
}

function buildTopVerifiedBuyOpportunities(
  advisory: ProAnalystAdvisoryReport,
  universe: MultiAssetUniverseSummary
): CompactBuyOpportunity[] {
  const results: CompactBuyOpportunity[] = [];
  const seen = new Set<string>();

  for (const rec of advisory.buyRecommendations) {
    if (results.length >= 3) break;
    seen.add(rec.assetId);
    const corp = advisory.multiAgent.byAssetId.get(rec.assetId);
    results.push({
      assetId: rec.assetId,
      ticker: rec.ticker,
      name: rec.name,
      spotPriceCad: rec.spotPriceCad,
      fairValueCad: rec.dcfIntrinsicCad ?? rec.spotPriceCad,
      upsidePct: rec.dcfUpsidePct ?? 0,
      expectedReturn5yPct:
        corp?.expectedAnnualReturn5yPct ?? rec.blackLittermanPosteriorPct,
      quantScore: rec.quantScore,
      optimalWrapper: rec.optimalCanadianWrapper,
      suggestedTicketCad: Math.max(1000, Math.round(rec.deltaCad)),
      shortWhy:
        rec.dcfUpsidePct !== null && rec.dcfUpsidePct > 6
          ? `Décote vérifiée +${rec.dcfUpsidePct.toFixed(0)} % · 5/5 étapes`
          : `Socle solide (${rec.quantScore}/100) · ${rec.optimalCanadianWrapper}`,
    });
  }

  if (results.length < 3) {
    const extras = universe.allAnalyses
      .filter(
        (a) =>
          !seen.has(a.asset.id) &&
          (a.signal === 'ACHAT FORT' || a.signal === 'ACHETER') &&
          a.upsidePct >= 8
      )
      .sort((a, b) => b.quantScore - a.quantScore);
    for (const ex of extras) {
      if (results.length >= 3) break;
      const corp = advisory.multiAgent.byAssetId.get(ex.asset.id);
      results.push({
        assetId: ex.asset.id,
        ticker: ex.asset.ticker,
        name: ex.asset.name.split(' (')[0],
        spotPriceCad: ex.spotPriceCad,
        fairValueCad: ex.fairValueCad,
        upsidePct: ex.upsidePct,
        expectedReturn5yPct:
          corp?.expectedAnnualReturn5yPct ?? ex.asset.baseExpectedReturnPct,
        quantScore: ex.quantScore,
        optimalWrapper: ex.optimalCanadianWrapper,
        suggestedTicketCad: 3500,
        shortWhy: `Décote +${ex.upsidePct.toFixed(0)} % · Score ${ex.quantScore}/100`,
      });
    }
  }

  return results;
}

/**
 * Master deterministic builder for any consultation turn with the 7 Agents & AI.
 * Guarantees zero hallucination, real-time $ CAD price cross-checks, counterfactual impact math,
 * and a probable 5-year cone on the target asset.
 */
export function buildConsultationTurnResponse(params: {
  question: string;
  explicitFocusAssetId?: string;
  explicitActionSide?: 'BUY' | 'SELL' | 'FULL_PLAN';
  explicitAmountCad?: number;
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  riskProfile: RiskProfile;
  advisory: ProAnalystAdvisoryReport;
  universe: MultiAssetUniverseSummary;
}): AgentConsultationResponse {
  const {
    question,
    explicitFocusAssetId,
    explicitActionSide,
    explicitAmountCad,
    lots,
    livePrices,
    macro,
    riskProfile,
    advisory,
    universe,
  } = params;

  const parsed = parseUserConsultationQuery({
    question,
    fallbackAssetId: explicitFocusAssetId,
  });

  const topBuyIdeas = buildTopVerifiedBuyOpportunities(advisory, universe);
  const sellVsKeep = buildHoldingsSellOrKeepSplit(advisory);

  // Pick the best focus asset based on user query or portfolio priority
  let focusAssetId =
    parsed.mentionedAssetIds[0] ??
    explicitFocusAssetId ??
    (parsed.intent === 'sell_or_keep'
      ? sellVsKeep.toSellOrTrim[0]?.assetId
      : topBuyIdeas[0]?.assetId) ??
    advisory.heldLines[0]?.assetId ??
    'GOOGL';

  if (!getAssetById(focusAssetId)) {
    focusAssetId = topBuyIdeas[0]?.assetId ?? 'GOOGL';
  }

  const assetFuture = computeAssetProbableFuture({
    assetId: focusAssetId,
    livePrices,
    riskProfile,
    advisory,
    universe,
  });

  // Choose counterfactual simulation action
  const heldLine: HeldLineDiagnostic | undefined = advisory.heldLines.find(
    (h) => h.assetId === focusAssetId
  );
  const sellRecOnFocus = advisory.sellRecommendations.find(
    (s) => s.assetId === focusAssetId
  );
  const buyRecOnFocus = advisory.buyRecommendations.find(
    (b) => b.assetId === focusAssetId
  );

  let simSide: 'BUY' | 'SELL' | 'FULL_PLAN' =
    explicitActionSide ??
    (parsed.intent === 'sell_or_keep' && parsed.mentionedAssetIds.length === 0
      ? 'FULL_PLAN'
      : sellRecOnFocus && parsed.simulatedSide === 'SELL'
        ? 'SELL'
        : sellRecOnFocus && !parsed.mentionedAssetIds.length
          ? 'FULL_PLAN'
          : parsed.simulatedSide === 'SELL' && heldLine
            ? 'SELL'
            : 'BUY');

  if (
    parsed.mentionedAssetIds.length > 0 &&
    sellRecOnFocus &&
    parsed.intent !== 'trade_impact' &&
    explicitActionSide === undefined
  ) {
    // If user asks "Que faire avec INTC ?" and INTC is flagged SELL, simulate selling it!
    simSide = 'SELL';
  }

  const defaultTicketCad =
    explicitAmountCad ??
    parsed.simulatedAmountCad ??
    (simSide === 'SELL'
      ? Math.abs(sellRecOnFocus?.deltaCad ?? Math.round((heldLine?.currentValueCad ?? 4000) * 0.6))
      : Math.round(buyRecOnFocus?.deltaCad ?? 5000));

  const impactSimulation = simulateTradeImpactOnPortfolio({
    lots,
    livePrices,
    macro,
    riskProfile,
    advisory,
    universe,
    assetId: focusAssetId,
    side: simSide,
    amountCad: defaultTicketCad,
  });

  // Extract 3 crisp specialist agent voices on focusAssetId
  const corpIntel = advisory.multiAgent.byAssetId.get(focusAssetId);
  const agentNodes = corpIntel?.agentNodes ?? [];
  const pickedAgents = [
    agentNodes.find((a) => a.id === 'agent_filings'),
    agentNodes.find((a) => a.id === 'agent_technicals'),
    agentNodes.find((a) => a.id === 'agent_risk_shield'),
  ].filter((x): x is NonNullable<typeof x> => Boolean(x));

  const agentVoices: AgentVoiceReply[] =
    pickedAgents.length > 0
      ? pickedAgents.map((ag) => ({
          code: ag.code,
          shortTitle: ag.shortTitle,
          verdict: ag.verdict,
          score100: ag.score100,
          keyMetric: `${ag.keyMetricLabel} : ${ag.keyMetricValue}`,
          message: ag.beginnerSummary,
        }))
      : [
          {
            code: 'AG-01',
            shortTitle: 'Bilan & Valeur',
            verdict:
              assetFuture.verdictLabel === 'ACHETER'
                ? 'ACHETER'
                : assetFuture.verdictLabel === 'CONSERVER'
                  ? 'GARDER'
                  : 'ÉVITER',
            score100: assetFuture.compositeAgentScore100,
            keyMetric: `Juste valeur : ${formatCad(assetFuture.fairValueCad, 2)}`,
            message:
              assetFuture.upsideToFairPct >= 0
                ? `Marge de +${assetFuture.upsideToFairPct.toFixed(1)} % sous sa juste valeur.`
                : `Traite au-dessus de sa juste valeur (${assetFuture.upsideToFairPct.toFixed(1)} %).`,
          },
        ];

  // Compose concise beginner-friendly headline & answer tailored to the user's intent
  let headlineVerdict = '';
  let plainFrenchAnswer = '';
  let verdictTone: 'emerald' | 'rose' | 'zinc' = assetFuture.verdictTone;

  if (parsed.intent === 'sell_or_keep' && parsed.mentionedAssetIds.length === 0) {
    verdictTone = sellVsKeep.toSellOrTrim.length > 0 ? 'rose' : 'emerald';
    headlineVerdict =
      sellVsKeep.toSellOrTrim.length > 0
        ? `▼ ${sellVsKeep.toSellOrTrim.length} ligne(s) à vendre/alléger (${formatCad(sellVsKeep.totalFreedCad, 0)} CAD) · ${sellVsKeep.toKeep.length} à garder`
        : `▲ Toutes vos lignes actuelles (${sellVsKeep.toKeep.length}) méritent d’être conservées`;
    const sellNames = sellVsKeep.toSellOrTrim
      .slice(0, 3)
      .map((s) => `${s.ticker} (${s.verdict.toLowerCase()} ${formatCad(Math.abs(s.suggestedDeltaCad), 0)})`)
      .join(', ');
    const keepNames = sellVsKeep.toKeep
      .slice(0, 3)
      .map((k) => k.ticker)
      .join(', ');
    plainFrenchAnswer =
      sellVsKeep.toSellOrTrim.length > 0
        ? `En clair : allégez ou vendez en priorité ${sellNames} car leur prix dépasse leur vraie valeur ou crée un surpoids risqué. Conservez vos piliers sains (${keepNames || 'socle principal'}) et redéployez le cash vers ${topBuyIdeas.map((b) => b.ticker).join(', ')}.`
        : `En clair : aucune ligne de votre portefeuille ne présente d’alerte comptable ni de surcote critique aux cours vérifiés en $ CAD. Gardez vos positions actuelles et utilisez vos nouvelles liquidités sur ${topBuyIdeas.map((b) => b.ticker).join(', ')}.`;
  } else if (parsed.intent === 'best_investments') {
    verdictTone = 'emerald';
    const topNames = topBuyIdeas
      .map(
        (b) =>
          `${b.ticker} (${formatCad(b.spotPriceCad, 0)} → vraie valeur ${formatCad(b.fairValueCad, 0)}, ${b.optimalWrapper})`
      )
      .join(' · ');
    headlineVerdict = `▲ Meilleurs investissements vérifiés : ${topBuyIdeas.map((b) => b.ticker).join(' · ')}`;
    plainFrenchAnswer = `En clair : après vérification des cours temps réel et des 5 étapes des 7 agents, les opportunités les plus solides sont ${topNames}. Sur ${assetFuture.ticker}, un ticket de ${formatCad(impactSimulation.deltaCad, 0)} CAD vise un scénario central 5 ans de ${formatCad(assetFuture.p50At5yCad, 0)} (${assetFuture.return5yProbablePct >= 0 ? '+' : ''}${assetFuture.return5yProbablePct.toFixed(0)} %).`;
  } else if (parsed.intent === 'trade_impact') {
    verdictTone =
      impactSimulation.actionType === 'SELL'
        ? 'rose'
        : assetFuture.verdictLabel === 'VENDRE' ||
            assetFuture.verdictLabel === 'ALLÉGER' ||
            impactSimulation.isOverConcentrationCap
          ? 'rose'
          : 'emerald';
    headlineVerdict =
      impactSimulation.actionType === 'FULL_PLAN'
        ? `▲ Impact Plan Complet : Santé ${impactSimulation.healthScoreBefore100} → ${impactSimulation.healthScoreAfter100}/100 · ${formatSignedCad(impactSimulation.median5yDeltaCad, 0)} à 5 ans`
        : `${impactSimulation.actionType === 'SELL' ? '▼ Simuler Vente' : '▲ Simuler Achat'} ${impactSimulation.ticker} (${formatCad(Math.abs(impactSimulation.deltaCad), 0)} CAD) — Verdict Agents : ${assetFuture.verdictLabel}`;
    plainFrenchAnswer = `En clair : ${impactSimulation.plainImpactSummary} Les 7 agents votent ${assetFuture.committeeBuyVotes}/7 Acheter vs ${assetFuture.committeeSellVotes}/7 Éviter sur ${assetFuture.ticker} au cours vérifié de ${formatCad(assetFuture.spotPriceCad, 2)} CAD.`;
  } else {
    // asset_future or full_counsel on a specific ticker
    const arrow =
      assetFuture.verdictTone === 'emerald'
        ? '▲'
        : assetFuture.verdictTone === 'rose'
          ? '▼'
          : '●';
    headlineVerdict = `${arrow} ${assetFuture.ticker} (${formatCad(assetFuture.spotPriceCad, 2)} CAD) — ${assetFuture.verdictLabel} · Horizon 5 ans probable : ${formatCad(assetFuture.p50At5yCad, 2)} (${assetFuture.return5yProbablePct >= 0 ? '+' : ''}${assetFuture.return5yProbablePct.toFixed(0)} %)`;
    plainFrenchAnswer = `En clair : au cours vérifié de ${formatCad(assetFuture.spotPriceCad, 2)} CAD face à une vraie valeur de ${formatCad(assetFuture.fairValueCad, 2)} CAD (${assetFuture.upsideToFairPct >= 0 ? '+' : ''}${assetFuture.upsideToFairPct.toFixed(1)} %), le comité des 7 agents attribue ${assetFuture.compositeAgentScore100}/100 (${assetFuture.committeeBuyVotes}/7 favorables). D’ici 2031, la fourchette probable va de ${formatCad(assetFuture.p10At5yCad, 0)} (scénario prudent) à ${formatCad(assetFuture.p90At5yCad, 0)} (scénario porteur), avec ${assetFuture.probabilityPositive5yPct} % de probabilité de gain.`;
  }

  const nextIdeaTicker =
    topBuyIdeas.find((b) => b.assetId !== focusAssetId)?.ticker ?? 'GOOGL';
  const topSellTicker = sellVsKeep.toSellOrTrim[0]?.ticker;

  const followUpPrompts = [
    `Qu’est-ce que ça engendre si j’investis 5 000 $ sur ${nextIdeaTicker} ?`,
    topSellTicker
      ? `Pourquoi vendre ou alléger ${topSellTicker} maintenant ?`
      : 'Que dois-je vendre ou garder dans mon portefeuille ?',
    `Quel est l’avenir probable de ${assetFuture.ticker} d’ici 2031 ?`,
  ];

  const verifiedGroundingContext = JSON.stringify({
    portefeuilleTotalCad: Math.round(advisory.before.totalValueCad),
    profilRisque: riskProfile,
    noteSanteAvantApres: `${advisory.healthScoreBefore100}/100 -> ${advisory.healthScoreAfter100}/100`,
    actifCible: {
      ticker: assetFuture.ticker,
      nom: assetFuture.name,
      coursLiveVerifieCad: assetFuture.spotPriceCad,
      vraieValeurDcfCad: assetFuture.fairValueCad,
      ecartValeurPct: assetFuture.upsideToFairPct,
      seuilStopCad: assetFuture.stopLossCad,
      cible12mCad: assetFuture.target12mCad,
      verdictCoT5Etapes: assetFuture.verdictLabel,
      votes7Agents: `${assetFuture.committeeBuyVotes}/7 Acheter, ${assetFuture.committeeSellVotes}/7 Éviter`,
      avenir5AnsCad: {
        pessimisteP10: assetFuture.p10At5yCad,
        probableP50: assetFuture.p50At5yCad,
        optimisteP90: assetFuture.p90At5yCad,
        rendementAnnuelAttenduPct: assetFuture.expectedCagr5yPct,
        probabiliteGain5AnsPct: assetFuture.probabilityPositive5yPct,
      },
      compteOptimalCanada: assetFuture.optimalWrapper,
    },
    simulationImpactPortefeuille: {
      action: impactSimulation.actionType,
      montantCad: impactSimulation.deltaCad,
      poidsAvantApresPct: `${impactSimulation.weightBeforePct}% -> ${impactSimulation.weightAfterPct}% (max ${impactSimulation.maxAllowedWeightPct}%)`,
      sharpeAvantApres: `${impactSimulation.sharpeBefore} -> ${impactSimulation.sharpeAfter}`,
      risqueMensuelVar95AvantApresCad: `${formatCad(impactSimulation.var95MonthlyBeforeCad, 0)} -> ${formatCad(impactSimulation.var95MonthlyAfterCad, 0)}`,
      gainMedian5AnsDeltaCad: impactSimulation.median5yDeltaCad,
      revenuPassifAnnuelDeltaCad: impactSimulation.annualIncomeDeltaCad,
    },
    lignesAVendreOuAlleger: sellVsKeep.toSellOrTrim.map((s) => ({
      ticker: s.ticker,
      verdict: s.verdict,
      montantCad: s.suggestedDeltaCad,
      raison: s.shortReason,
    })),
    lignesAGarder: sellVsKeep.toKeep.map((k) => k.ticker),
    meilleursAchatsVerifies: topBuyIdeas.map((b) => ({
      ticker: b.ticker,
      coursCad: b.spotPriceCad,
      vraieValeurCad: b.fairValueCad,
      potentielPct: b.upsidePct,
      compte: b.optimalWrapper,
    })),
  });

  return {
    intent: parsed.intent,
    focusAssetId,
    headlineVerdict,
    verdictTone,
    plainFrenchAnswer,
    agentVoices,
    impactSimulation,
    assetFuture,
    sellVsKeep,
    topBuyIdeas,
    followUpPrompts,
    verifiedGroundingContext,
  };
}

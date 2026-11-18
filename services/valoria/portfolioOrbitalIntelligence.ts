import { type MacroIndicators, getAssetById } from './marketData';
import { getAssetSubClass } from './globalMarketCatalog';
import type {
  HeldLineDiagnostic,
  ProAnalystAdvisoryReport,
} from './proAnalystAdvisor';
import type { PortfolioInstitutionalNewsSummary } from './institutionalCurveAndNewsEngine';
import type { MultiAssetUniverseSummary } from './multiAssetQuantEngine';
import { buildAsset30DaySparklineSeries } from './sparkline30d';
import { formatCad } from './valoriaFormatters';

// ============================================================================
// 1. Portfolio Asset-Type Donut Taxonomy & Orbital Sector Intelligence ($ CAD)
// ============================================================================

export type PortfolioSliceId =
  | 'tech_ia'
  | 'actions_value'
  | 'etf_monde'
  | 'or_refuges'
  | 'obligations_cash'
  | 'crypto_web3'
  | 'immobilier_reit';

export interface PortfolioDonutSlice {
  id: PortfolioSliceId;
  label: string;
  shortLabel: string;
  colorHex: string;
  valueCad: number;
  investedCad: number;
  pnlCad: number;
  pnlPct: number;
  weightPct: number;
  eulerRiskSharePct: number;
  riskGapPct: number; // eulerRiskSharePct - weightPct (> +6% means disproportionate crash risk)
  holdingsCount: number;
  assetIds: string[];
  tickers: string[];
  aiScore100: number;
  aiTone: 'positive' | 'neutral' | 'negative';
  aiVerdictLabel: string;
  newsImpulseScore: number; // -100 .. +100
  newsAnnualShockPct: number; // annualized % return impact from news
  significantShocksCount: number;
  dominantCatalystCode: string;
  dominantCatalystHeadline: string;
  recommendedDeltaCad: number; // net recommended buy/sell adjustment on this sector in $ CAD
}

export interface PortfolioDonutSummary {
  totalValueCad: number;
  totalInvestedCad: number;
  totalPnlCad: number;
  totalPnlPct: number;
  weightedAiScore100: number;
  weightedNewsImpulse: number;
  dominantSlice: PortfolioDonutSlice | null;
  topRiskSlice: PortfolioDonutSlice | null;
  slices: PortfolioDonutSlice[];
}

const SLICE_META: Record<
  PortfolioSliceId,
  { label: string; shortLabel: string; colorHex: string }
> = {
  etf_monde: {
    label: 'ETF Mondiaux',
    shortLabel: 'ETF Monde',
    colorHex: '#10b981', // Emerald
  },
  actions_value: {
    label: 'Actions & Banques',
    shortLabel: 'Actions',
    colorHex: '#818cf8', // Indigo
  },
  tech_ia: {
    label: 'Tech & IA',
    shortLabel: 'Tech & IA',
    colorHex: '#38bdf8', // Sky
  },
  or_refuges: {
    label: 'Or & Matières 1res',
    shortLabel: 'Or & Refuges',
    colorHex: '#eab308', // Gold
  },
  obligations_cash: {
    label: 'Obligations & Liquidités',
    shortLabel: 'Obligations',
    colorHex: '#2dd4bf', // Teal
  },
  crypto_web3: {
    label: 'Crypto & Web3',
    shortLabel: 'Crypto',
    colorHex: '#fb7185', // Rose
  },
  immobilier_reit: {
    label: 'Immobilier (REIT)',
    shortLabel: 'Immobilier',
    colorHex: '#f97316', // Amber-Orange
  },
};

const TECH_SECTOR_REGEX =
  /semi-conducteur|logiciel|cloud|technologie|internet|ia\b|intelligence artificielle|cyber|matériel informatique|électronique|plateforme|numérique/i;

const KNOWN_TECH_IDS = new Set([
  'ADP',
  'PAYX',
  'INTC',
  'MSFT',
  'GOOGL',
  'AAPL',
  'AMZN',
  'META',
  'TSLA',
  'VCN',
  'AMD',
  'CRM',
  'ADBE',
  'NOW',
  'PANW',
  'CRWD',
  'SNOW',
  'ORCL',
  'SHOP',
  'CSU',
  'OTEX',
  'ASML',
  'SAP',
  'EMR',
  'BABA',
  'SONY',
  'ARM',
  'SMCI',
  'QCOM',
  'TXN',
  'AMAT',
  'LRCX',
  'MU',
]);

export function classifyAssetAllocationSlice(assetId: string): PortfolioSliceId {
  if (assetId === 'CASH') return 'obligations_cash';
  const asset = getAssetById(assetId);
  if (!asset) return 'actions_value';

  const subClass = getAssetSubClass(asset);
  if (subClass === 'crypto_l1_defi' || asset.category === 'crypto') {
    return 'crypto_web3';
  }
  if (subClass === 'matiere_premiere' || asset.category === 'refuge') {
    return 'or_refuges';
  }
  if (subClass === 'obligation_taux' || asset.category === 'obligations') {
    return 'obligations_cash';
  }
  if (subClass === 'immobilier_reit') {
    return 'immobilier_reit';
  }
  if (subClass === 'etf_indice') {
    return 'etf_monde';
  }

  const sectorText = `${asset.sector ?? ''} ${asset.name} ${asset.description ?? ''}`;
  if (
    KNOWN_TECH_IDS.has(asset.id.toUpperCase()) ||
    TECH_SECTOR_REGEX.test(sectorText)
  ) {
    return 'tech_ia';
  }

  return 'actions_value';
}

export function buildPortfolioDonutAllocation(params: {
  advisory: ProAnalystAdvisoryReport;
  institutionalNews: PortfolioInstitutionalNewsSummary;
  availableCashCad?: number;
}): PortfolioDonutSummary {
  const { advisory, institutionalNews, availableCashCad = 0 } = params;
  const heldLines = advisory.heldLines;

  interface MutableBucket {
    id: PortfolioSliceId;
    valueCad: number;
    investedCad: number;
    eulerRiskSum: number;
    weightedAiSum: number;
    weightedNewsSum: number;
    weightedShockPctSum: number;
    shocksCount: number;
    assetIds: string[];
    tickers: string[];
    bestCatalystAbs: number;
    dominantCatalystCode: string;
    dominantCatalystHeadline: string;
    recommendedDeltaCad: number;
  }

  const buckets = new Map<PortfolioSliceId, MutableBucket>();
  const ensureBucket = (id: PortfolioSliceId): MutableBucket => {
    let b = buckets.get(id);
    if (!b) {
      b = {
        id,
        valueCad: 0,
        investedCad: 0,
        eulerRiskSum: 0,
        weightedAiSum: 0,
        weightedNewsSum: 0,
        weightedShockPctSum: 0,
        shocksCount: 0,
        assetIds: [],
        tickers: [],
        bestCatalystAbs: -1,
        dominantCatalystCode: 'Flux calme',
        dominantCatalystHeadline:
          'Aucun choc réglementaire anormal détecté sur ce compartiment.',
        recommendedDeltaCad: 0,
      };
      buckets.set(id, b);
    }
    return b;
  };

  for (const line of heldLines) {
    const sliceId = classifyAssetAllocationSlice(line.assetId);
    const b = ensureBucket(sliceId);

    const corp = advisory.multiAgent.byAssetId.get(line.assetId);
    const aiScore = corp ? corp.compositeAgentScore100 : line.quantScore;
    const instProf = institutionalNews.byAssetId.get(line.assetId);
    const newsAsset = advisory.newsIntelligence.byAssetId.get(line.assetId);

    const combinedNewsScore = instProf
      ? Math.round(instProf.institutionalScore * 0.65 + line.newsSentimentScore * 0.35)
      : line.newsSentimentScore;
    const newsShockPct = newsAsset?.blackLittermanNewsShockPct ?? 0;

    b.valueCad += line.currentValueCad;
    b.investedCad += line.investedCad;
    b.eulerRiskSum += line.eulerRiskSharePct;
    b.weightedAiSum += aiScore * line.currentValueCad;
    b.weightedNewsSum += combinedNewsScore * line.currentValueCad;
    b.weightedShockPctSum += newsShockPct * line.currentValueCad;
    b.assetIds.push(line.assetId);
    b.tickers.push(line.ticker);

    if (instProf && instProf.events.length > 0) {
      const sigCount = instProf.events.filter(
        (e) => e.isStatisticallySignificant
      ).length;
      b.shocksCount += sigCount;
      const topEv = instProf.events[0];
      const mag = Math.abs(topEv.institutionalConvictionScore) + Math.abs(topEv.abnormalReturnCarPct) * 2;
      if (mag > b.bestCatalystAbs) {
        b.bestCatalystAbs = mag;
        b.dominantCatalystCode = `${topEv.ticker} · ${topEv.filingOrEventCode}`;
        b.dominantCatalystHeadline = topEv.headline;
      }
    } else if (line.newsHeadline && Math.abs(line.newsSentimentScore) > b.bestCatalystAbs) {
      b.bestCatalystAbs = Math.abs(line.newsSentimentScore);
      b.dominantCatalystCode = `${line.ticker} · Actu`;
      b.dominantCatalystHeadline = line.newsHeadline;
    }
  }

  if (availableCashCad >= 50) {
    const b = ensureBucket('obligations_cash');
    b.valueCad += availableCashCad;
    b.investedCad += availableCashCad;
    b.weightedAiSum += 68 * availableCashCad;
    b.weightedNewsSum += 8 * availableCashCad;
    if (!b.tickers.includes('CASH $ CAD')) {
      b.tickers.push('CASH $ CAD');
    }
    if (b.bestCatalystAbs < 0) {
      b.dominantCatalystCode = 'Liquidités $ CAD';
      b.dominantCatalystHeadline =
        'Réserve sèche disponible immédiatement pour saisir les décotes vérifiées.';
    }
  }

  for (const sell of advisory.sellRecommendations) {
    const sid = classifyAssetAllocationSlice(sell.assetId);
    if (buckets.has(sid)) {
      ensureBucket(sid).recommendedDeltaCad += sell.deltaCad;
    }
  }
  for (const buy of advisory.buyRecommendations) {
    const sid = classifyAssetAllocationSlice(buy.assetId);
    if (buckets.has(sid)) {
      ensureBucket(sid).recommendedDeltaCad += buy.deltaCad;
    }
  }

  const totalValueCad = Array.from(buckets.values()).reduce(
    (s, b) => s + b.valueCad,
    0
  );
  const totalInvestedCad = Array.from(buckets.values()).reduce(
    (s, b) => s + b.investedCad,
    0
  );
  const rawRiskTotal = Array.from(buckets.values()).reduce(
    (s, b) => s + b.eulerRiskSum,
    0
  );

  if (totalValueCad <= 0) {
    return {
      totalValueCad: 0,
      totalInvestedCad: 0,
      totalPnlCad: 0,
      totalPnlPct: 0,
      weightedAiScore100: 50,
      weightedNewsImpulse: 0,
      dominantSlice: null,
      topRiskSlice: null,
      slices: [],
    };
  }

  const rawSlices = Array.from(buckets.values())
    .filter((b) => b.valueCad > 0)
    .sort((a, b) => b.valueCad - a.valueCad);

  const slices: PortfolioDonutSlice[] = rawSlices.map((b) => {
    const meta = SLICE_META[b.id];
    const weightPct = Number(((b.valueCad / totalValueCad) * 100).toFixed(1));
    const eulerRiskSharePct =
      rawRiskTotal > 0
        ? Number(((b.eulerRiskSum / rawRiskTotal) * 100).toFixed(1))
        : weightPct;
    const riskGapPct = Number((eulerRiskSharePct - weightPct).toFixed(1));
    const pnlCad = Math.round(b.valueCad - b.investedCad);
    const pnlPct =
      b.investedCad > 0
        ? Number((((b.valueCad - b.investedCad) / b.investedCad) * 100).toFixed(1))
        : 0;
    const aiScore100 = Math.max(
      15,
      Math.min(98, Math.round(b.weightedAiSum / Math.max(1, b.valueCad)))
    );
    const newsImpulseScore = Math.max(
      -95,
      Math.min(95, Math.round(b.weightedNewsSum / Math.max(1, b.valueCad)))
    );
    const newsAnnualShockPct = Number(
      (b.weightedShockPctSum / Math.max(1, b.valueCad)).toFixed(2)
    );

    const aiTone: 'positive' | 'neutral' | 'negative' =
      b.recommendedDeltaCad <= -1000 || aiScore100 <= 48 || newsImpulseScore <= -28
        ? 'negative'
        : aiScore100 >= 66 && newsImpulseScore >= -10
          ? 'positive'
          : 'neutral';

    let aiVerdictLabel = 'Socle équilibré à conserver';
    if (b.recommendedDeltaCad <= -1000 && riskGapPct >= 5) {
      aiVerdictLabel = 'Sur-risque détecté — Alléger';
    } else if (b.recommendedDeltaCad <= -1000) {
      aiVerdictLabel = 'Valorisation/Bilan tendu — Écrêter';
    } else if (b.recommendedDeltaCad >= 1000) {
      aiVerdictLabel = 'Conviction IA forte — Renforcer';
    } else if (aiTone === 'positive') {
      aiVerdictLabel = 'Pilier sain validé par les 7 agents';
    }

    return {
      id: b.id,
      label: meta.label,
      shortLabel: meta.shortLabel,
      colorHex: meta.colorHex,
      valueCad: Math.round(b.valueCad),
      investedCad: Math.round(b.investedCad),
      pnlCad,
      pnlPct,
      weightPct,
      eulerRiskSharePct,
      riskGapPct,
      holdingsCount: b.assetIds.length || 1,
      assetIds: b.assetIds,
      tickers: b.tickers,
      aiScore100,
      aiTone,
      aiVerdictLabel,
      newsImpulseScore,
      newsAnnualShockPct,
      significantShocksCount: b.shocksCount,
      dominantCatalystCode: b.dominantCatalystCode,
      dominantCatalystHeadline: b.dominantCatalystHeadline,
      recommendedDeltaCad: Math.round(b.recommendedDeltaCad),
    };
  });

  // Normalize rounding drift on largest slice so weights sum cleanly to 100.0%
  if (slices.length > 0) {
    const sumW = slices.reduce((s, x) => s + x.weightPct, 0);
    const diff = Number((100 - sumW).toFixed(1));
    if (Math.abs(diff) > 0 && Math.abs(diff) <= 0.5) {
      slices[0].weightPct = Number((slices[0].weightPct + diff).toFixed(1));
    }
  }

  const weightedAiScore100 = Math.round(
    slices.reduce((s, x) => s + x.aiScore100 * x.valueCad, 0) /
      Math.max(1, totalValueCad)
  );
  const weightedNewsImpulse = Math.round(
    slices.reduce((s, x) => s + x.newsImpulseScore * x.valueCad, 0) /
      Math.max(1, totalValueCad)
  );
  const topRiskSlice =
    [...slices].sort((a, b) => b.eulerRiskSharePct - a.eulerRiskSharePct)[0] ??
    null;

  return {
    totalValueCad: Math.round(totalValueCad),
    totalInvestedCad: Math.round(totalInvestedCad),
    totalPnlCad: Math.round(totalValueCad - totalInvestedCad),
    totalPnlPct:
      totalInvestedCad > 0
        ? Number(
            (((totalValueCad - totalInvestedCad) / totalInvestedCad) * 100).toFixed(
              1
            )
          )
        : 0,
    weightedAiScore100,
    weightedNewsImpulse,
    dominantSlice: slices[0] ?? null,
    topRiskSlice,
    slices,
  };
}

// ============================================================================
// 2. Deep AI & News Causal Contagion + Narrative-vs-Price Divergence Engine
// ============================================================================

type DivergenceRegimeCode =
  | 'OPPORTUNITE_CONTRARIANTE'
  | 'CATALYSEUR_CONFIRME'
  | 'EUPHORIE_PRICEE'
  | 'PIEGE_FONDAMENTAL'
  | 'NEUTRE_EQUILIBRE';

interface CausalShockChain {
  id: string;
  sourceCode: string;
  triggerTitle: string;
  firstOrderChannel: string;
  secondOrderContagion: string;
  impactedTickers: string[];
  impactedAssetIds: string[];
  portfolioExposureCad: number;
  estimatedShockCad: number; // signed $ CAD impact on current portfolio
  tone: 'positive' | 'negative' | 'neutral';
  confidencePct: number;
  persistenceDays: number;
  aiCounterAction: string;
}

export interface NarrativePriceDivergenceItem {
  assetId: string;
  ticker: string;
  name: string;
  isHeld: boolean;
  heldValueCad: number;
  spotCad: number;
  fairValueCad: number;
  dcfUpsidePct: number;
  priceChange30dPct: number;
  newsImpulseScore: number; // -100 .. +100
  abnormalCarPct: number;
  priorFundamentalPct: number; // 7-agent base score
  posteriorBayesianConvictionPct: number; // fused AI + News + Price conviction (5..99)
  regimeCode: DivergenceRegimeCode;
  regimeLabel: string;
  regimeTone: 'positive' | 'negative' | 'caution' | 'neutral';
  causalDiagnosis: string;
  filingProofCode: string;
}

export interface CentralRadialShockNode {
  id: string;
  ticker: string;
  sliceLabel: string;
  colorHex: string;
  isHeld: boolean;
  weightOrRelevancePct: number;
  valueCad: number;
  bayesianConvictionPct: number;
  newsImpulseScore: number;
  priceChange30dPct: number;
  dcfUpsidePct: number;
  regimeLabel: string;
  tone: 'positive' | 'negative' | 'neutral';
  dominantShockCode: string;
}

export interface LiveGeminiDeepSynthesisPayload {
  generatedAt: string;
  sourceMode: 'gemini_search_grounded' | 'quant_causal_engine';
  executiveThesis: string;
  macroRegimeReading: string;
  topBlindSpotRisk: string;
  topContrarianOpportunity: string;
  causalHighlights?: Array<{
    trigger: string;
    transmission: string;
    portfolioImpactSummary: string;
    action: string;
  }>;
  webSources?: Array<{ uri: string; title: string }>;
}

export interface DeepAiNewsIntelligenceLab {
  bayesianPortfolioConfidencePct: number;
  capitalBullishAlignedCad: number;
  capitalVulnerableToShocksCad: number;
  netExpectedShockCad: number;
  macroRegimeSummary: string;
  executiveAiThesis: string;
  causalChains: CausalShockChain[];
  divergenceRows: NarrativePriceDivergenceItem[];
  radialNodes: CentralRadialShockNode[];
}

export function filterHoldingsBySlice(
  heldLines: HeldLineDiagnostic[],
  sliceId: PortfolioSliceId | null
): HeldLineDiagnostic[] {
  if (!sliceId) return heldLines;
  return heldLines.filter(
    (h) => classifyAssetAllocationSlice(h.assetId) === sliceId
  );
}

export function buildDeepAiNewsIntelligenceLab(params: {
  advisory: ProAnalystAdvisoryReport;
  institutionalNews: PortfolioInstitutionalNewsSummary;
  universe: MultiAssetUniverseSummary;
  macro: MacroIndicators;
  donutSummary?: PortfolioDonutSummary;
}): DeepAiNewsIntelligenceLab {
  const { advisory, institutionalNews, universe, macro } = params;
  const donut =
    params.donutSummary ??
    buildPortfolioDonutAllocation({ advisory, institutionalNews });

  const heldMap = new Map<string, HeldLineDiagnostic>();
  for (const h of advisory.heldLines) {
    heldMap.set(h.assetId, h);
  }

  // Candidate assets: all held assets + top recommended buys + key market barometers
  const candidateIds = Array.from(
    new Set([
      ...advisory.heldLines.map((h) => h.assetId),
      ...advisory.buyRecommendations.slice(0, 4).map((b) => b.assetId),
      'ADP',
      'GOOGL',
      'RY',
      'INTC',
      'PAYX',
      'LLY',
    ])
  ).slice(0, 12);

  const divergenceRows: NarrativePriceDivergenceItem[] = [];

  for (const assetId of candidateIds) {
    const uItem = universe.byId.get(assetId);
    if (!uItem) continue;

    const held = heldMap.get(assetId);
    const corp = advisory.multiAgent.byAssetId.get(assetId);
    const instProf = institutionalNews.byAssetId.get(assetId);
    const newsSummary = advisory.newsIntelligence.byAssetId.get(assetId);
    const spk30 = buildAsset30DaySparklineSeries(assetId, uItem.spotPriceCad);

    const priorFundamentalPct = corp
      ? corp.compositeAgentScore100
      : uItem.quantScore;
    const newsImpulseScore = instProf
      ? Math.round(
          instProf.institutionalScore * 0.65 +
            (newsSummary?.compositeSentimentScore ?? 0) * 0.35
        )
      : newsSummary?.compositeSentimentScore ?? 0;
    const abnormalCarPct = instProf?.cumulativeCarPct ?? spk30.change30dPct * 0.5;
    const dcfUpsidePct = Number(uItem.upsidePct.toFixed(1));
    const priceChange30dPct = spk30.change30dPct;

    // Bayesian log-odds style update combining 7-agent prior + verified filing impulse + DCF safety margin
    const newsShift = newsImpulseScore * 0.16;
    const valuationShift = Math.max(-18, Math.min(16, dcfUpsidePct * 0.38));
    const distressPenalty =
      corp && corp.forensics.altmanZone === 'Fragile' ? -14 : 0;
    const posteriorBayesianConvictionPct = Math.max(
      6,
      Math.min(
        98,
        Math.round(
          priorFundamentalPct + newsShift + valuationShift + distressPenalty
        )
      )
    );

    let regimeCode: DivergenceRegimeCode = 'NEUTRE_EQUILIBRE';
    let regimeLabel = 'Prix & Actu équilibrés';
    let regimeTone: 'positive' | 'negative' | 'caution' | 'neutral' = 'neutral';
    let causalDiagnosis =
      'Les annonces récentes sont cohérentes avec la valorisation fondamentale actuelle.';

    const isSolvent = !corp || corp.forensics.altmanZone !== 'Fragile';

    if (
      dcfUpsidePct <= -14 &&
      (newsImpulseScore >= -15 || priorFundamentalPct >= 52)
    ) {
      regimeCode = 'EUPHORIE_PRICEE';
      regimeLabel = 'Sur-payé · Sell-the-News';
      regimeTone = 'caution';
      causalDiagnosis = `Le cours (${formatCad(uItem.spotPriceCad, 0)}) intègre déjà un scénario parfait (${Math.abs(Math.round(dcfUpsidePct))} % au-dessus de sa vraie valeur) : vulnérable aux taux.`;
    } else if (
      (dcfUpsidePct <= -10 && newsImpulseScore < -15) ||
      (!isSolvent && newsImpulseScore <= -20) ||
      posteriorBayesianConvictionPct <= 38
    ) {
      regimeCode = 'PIEGE_FONDAMENTAL';
      regimeLabel = 'Piège Fondamental Confirmé';
      regimeTone = 'negative';
      causalDiagnosis = `Les dépôts officiels confirment une érosion structurelle des marges/flux (${priceChange30dPct.toFixed(1)} % sur 30j) : éviter de moyenner à la baisse.`;
    } else if (
      priceChange30dPct <= -8 &&
      dcfUpsidePct >= 7 &&
      isSolvent &&
      priorFundamentalPct >= 64
    ) {
      regimeCode = 'OPPORTUNITE_CONTRARIANTE';
      regimeLabel = 'Sur-réaction · Décote IA';
      regimeTone = 'positive';
      causalDiagnosis = `Repli court terme (${priceChange30dPct.toFixed(1)} % sur 30j) sur bruit macro alors que le bilan reste solide : décote de +${dcfUpsidePct.toFixed(0)} % vers la vraie valeur.`;
    } else if (
      newsImpulseScore >= 12 &&
      dcfUpsidePct >= 4 &&
      posteriorBayesianConvictionPct >= 66
    ) {
      regimeCode = 'CATALYSEUR_CONFIRME';
      regimeLabel = 'Catalyseur Haussier Actif';
      regimeTone = 'positive';
      causalDiagnosis = `Publications et révisions bénéficiaires alignées avec une marge de sécurité positive (+${dcfUpsidePct.toFixed(0)} %).`;
    }

    const topEv = instProf?.events[0];
    const filingProofCode = topEv
      ? `${topEv.filingOrEventCode} (${topEv.publishedAt.slice(5)})`
      : newsSummary?.dominantCatalystLabel ?? 'Analyse 7 Agents';

    divergenceRows.push({
      assetId,
      ticker: uItem.asset.ticker,
      name: uItem.asset.name.split(' (')[0],
      isHeld: Boolean(held),
      heldValueCad: held ? Math.round(held.currentValueCad) : 0,
      spotCad: uItem.spotPriceCad,
      fairValueCad: uItem.fairValueCad,
      dcfUpsidePct,
      priceChange30dPct,
      newsImpulseScore,
      abnormalCarPct: Number(abnormalCarPct.toFixed(1)),
      priorFundamentalPct,
      posteriorBayesianConvictionPct,
      regimeCode,
      regimeLabel,
      regimeTone,
      causalDiagnosis,
      filingProofCode,
    });
  }

  // Sort held items & strongest divergences first
  divergenceRows.sort((a, b) => {
    if (a.isHeld !== b.isHeld) return a.isHeld ? -1 : 1;
    return (
      Math.abs(b.posteriorBayesianConvictionPct - 55) -
      Math.abs(a.posteriorBayesianConvictionPct - 55)
    );
  });

  // Build 1st-order & 2nd-order Causal Shock Chains grounded in the user's real slices
  const causalChains: CausalShockChain[] = [];
  const techSlice = donut.slices.find((s) => s.id === 'tech_ia');
  const actionsSlice = donut.slices.find((s) => s.id === 'actions_value');
  const etfSlice = donut.slices.find((s) => s.id === 'etf_monde');
  const goldSlice = donut.slices.find((s) => s.id === 'or_refuges');
  const bondSlice = donut.slices.find((s) => s.id === 'obligations_cash');

  if (techSlice && techSlice.valueCad > 0) {
    const hasDistressedSemi = techSlice.assetIds.includes('INTC');
    const hasHighMultiple = techSlice.assetIds.includes('PAYX');
    const shockRate = hasDistressedSemi || hasHighMultiple ? -0.095 : -0.045;
    const estShock = Math.round(techSlice.valueCad * shockRate);
    causalChains.push({
      id: 'chain-rates-tech-capex',
      sourceCode: 'SEC 10-Q · Trésor US 10A',
      triggerTitle:
        'Taux longs > 5 % & examen strict du retour sur CapEx IA',
      firstOrderChannel:
        '1er ordre : Hausse du taux d’actualisation (WACC) comprimant les multiples PER > 50x et pénalisant les fonderies déficitaires.',
      secondOrderContagion:
        '2e ordre : Rotation des flux institutionnels des logiciels chers vers les géants profitables à fort cash-flow libre et obligations.',
      impactedTickers: techSlice.tickers.slice(0, 4),
      impactedAssetIds: techSlice.assetIds,
      portfolioExposureCad: techSlice.valueCad,
      estimatedShockCad: estShock,
      tone: 'negative',
      confidencePct: 88,
      persistenceDays: 60,
      aiCounterAction:
        techSlice.recommendedDeltaCad < 0
          ? `Écrêter ${formatCad(Math.abs(techSlice.recommendedDeltaCad), 0)} CAD sur les multiples tendus/fragiles.`
          : 'Conserver uniquement les leaders IA solvables sous leur vraie valeur DCF.',
    });
  }

  if (actionsSlice && actionsSlice.valueCad > 0) {
    const isOverweightBank = actionsSlice.weightPct >= 22;
    const estShock = Math.round(
      actionsSlice.valueCad * (isOverweightBank ? 0.032 : 0.048)
    );
    causalChains.push({
      id: 'chain-boc-canadian-banks',
      sourceCode: 'Banque du Canada · SEDAR+',
      triggerTitle: `Pentification de la courbe canadienne (Taux BoC ${macro.centralBankRatePct.toFixed(1)} % · IPC ${macro.inflationPct.toFixed(1)} %)`,
      firstOrderChannel:
        '1er ordre : Stabilisation de la marge nette d’intérêt (NIM) des grandes banques TSX et maintien des dividendes en $ CAD.',
      secondOrderContagion:
        isOverweightBank
          ? '2e ordre : Concentration domestique élevée si un seul titre bancaire dépasse 20 % du portefeuille.'
          : '2e ordre : Flux de dividendes canadiens réinvestis amortissant la volatilité boursière mondiale.',
      impactedTickers: actionsSlice.tickers.slice(0, 4),
      impactedAssetIds: actionsSlice.assetIds,
      portfolioExposureCad: actionsSlice.valueCad,
      estimatedShockCad: estShock,
      tone: 'positive',
      confidencePct: 84,
      persistenceDays: 90,
      aiCounterAction: isOverweightBank
        ? 'Plafonner toute ligne individuelle à ~12-15 % pour éviter le risque idiosyncratique.'
        : 'Conserver en CELI/REER pour capitaliser les dividendes sans friction fiscale.',
    });
  }

  if ((goldSlice && goldSlice.valueCad > 0) || (etfSlice && etfSlice.valueCad > 0)) {
    const refugeCad = (goldSlice?.valueCad ?? 0) + (bondSlice?.valueCad ?? 0);
    const worldCad = etfSlice?.valueCad ?? 0;
    const estShock = Math.round(refugeCad * 0.042 + worldCad * 0.055);
    causalChains.push({
      id: 'chain-fx-cad-global-shield',
      sourceCode: 'BoC FX · Banques Centrales',
      triggerTitle:
        'Achats d’or souverains & diversification mondiale hors risque devise unique',
      firstOrderChannel:
        '1er ordre : Décorrélation entre les actifs tangibles/indiciels mondiaux et les chocs spécifiques d’entreprises.',
      secondOrderContagion:
        '2e ordre : Amortisseur automatique en $ CAD lorsque le VIX accélère ou que le dollar US fluctue.',
      impactedTickers: [
        ...(etfSlice?.tickers ?? []),
        ...(goldSlice?.tickers ?? []),
      ].slice(0, 4),
      impactedAssetIds: [
        ...(etfSlice?.assetIds ?? []),
        ...(goldSlice?.assetIds ?? []),
      ],
      portfolioExposureCad: refugeCad + worldCad,
      estimatedShockCad: estShock,
      tone: 'positive',
      confidencePct: 86,
      persistenceDays: 120,
      aiCounterAction:
        advisory.buyRecommendations.length > 0
          ? `Redéployer les prises de profits vers ${advisory.buyRecommendations
              .slice(0, 2)
              .map((b) => b.ticker)
              .join(' et ')}.`
          : 'Maintenir ce socle central comme ancre de long terme.',
    });
  }

  // Always add an opportunity chain from top AI buy recommendations if any
  if (advisory.buyRecommendations.length > 0) {
    const topBuys = advisory.buyRecommendations.slice(0, 3);
    const budget = topBuys.reduce((s, b) => s + b.deltaCad, 0);
    causalChains.push({
      id: 'chain-ai-redeployment-alpha',
      sourceCode: 'Comité 7 Agents · DCF Live',
      triggerTitle: `Arbitrage Qualité & Décote vers ${topBuys.map((b) => b.ticker).join(', ')}`,
      firstOrderChannel:
        '1er ordre : Remplacement de capital exposé aux compressions de multiples par des flux de trésorerie décotés ou défensifs.',
      secondOrderContagion: `2e ordre : Hausse du score santé portefeuille de ${advisory.healthScoreBefore100} à ${advisory.healthScoreAfter100}/100 et réduction du risque extrême.`,
      impactedTickers: topBuys.map((b) => b.ticker),
      impactedAssetIds: topBuys.map((b) => b.assetId),
      portfolioExposureCad: Math.round(budget),
      estimatedShockCad: Math.round(budget * 0.085),
      tone: 'positive',
      confidencePct: 91,
      persistenceDays: 180,
      aiCounterAction: `Exécuter le plan d’arbitrage vérifié (+${formatCad(Math.round(budget), 0)} CAD).`,
    });
  }

  const radialNodes: CentralRadialShockNode[] = divergenceRows
    .slice(0, 10)
    .map((row) => {
      const sliceId = classifyAssetAllocationSlice(row.assetId);
      const meta = SLICE_META[sliceId];
      const weightPct =
        donut.totalValueCad > 0 && row.heldValueCad > 0
          ? Number(((row.heldValueCad / donut.totalValueCad) * 100).toFixed(1))
          : 6;
      const tone: 'positive' | 'negative' | 'neutral' =
        row.regimeTone === 'positive'
          ? 'positive'
          : row.regimeTone === 'negative' || row.regimeTone === 'caution'
            ? 'negative'
            : 'neutral';

      return {
        id: row.assetId,
        ticker: row.ticker,
        sliceLabel: meta.shortLabel,
        colorHex: meta.colorHex,
        isHeld: row.isHeld,
        weightOrRelevancePct: Math.max(4, weightPct),
        valueCad: row.heldValueCad,
        bayesianConvictionPct: row.posteriorBayesianConvictionPct,
        newsImpulseScore: row.newsImpulseScore,
        priceChange30dPct: row.priceChange30dPct,
        dcfUpsidePct: row.dcfUpsidePct,
        regimeLabel: row.regimeLabel,
        tone,
        dominantShockCode: row.filingProofCode,
      };
    });

  const heldDivergences = divergenceRows.filter((d) => d.isHeld);
  const capitalBullishAlignedCad = heldDivergences
    .filter((d) => d.posteriorBayesianConvictionPct >= 62 && d.regimeTone !== 'negative' && d.regimeTone !== 'caution')
    .reduce((s, d) => s + d.heldValueCad, 0);

  const capitalVulnerableToShocksCad = heldDivergences
    .filter((d) => d.regimeTone === 'negative' || d.regimeTone === 'caution')
    .reduce((s, d) => s + d.heldValueCad, 0);

  const netExpectedShockCad = causalChains.reduce(
    (s, c) => s + c.estimatedShockCad,
    0
  );

  const bayesianPortfolioConfidencePct =
    heldDivergences.length > 0
      ? Math.round(
          heldDivergences.reduce(
            (s, d) => s + d.posteriorBayesianConvictionPct * Math.max(1, d.heldValueCad),
            0
          ) /
            Math.max(
              1,
              heldDivergences.reduce((s, d) => s + Math.max(1, d.heldValueCad), 0)
            )
        )
      : 68;

  const macroRegimeSummary = `IPC ${macro.inflationPct.toFixed(1)} % · Taux directeur ${macro.centralBankRatePct.toFixed(2)} % · VIX ${macro.vixLevel.toFixed(1)} — Les publications SEC/SEDAR+ favorisent les bilans à flux libres réels et pénalisent les multiples tendus.`;

  const executiveAiThesis =
    capitalVulnerableToShocksCad > 0
      ? `${formatCad(capitalVulnerableToShocksCad, 0)} CAD de vos positions actuelles présentent une divergence entre actualité/taux et valorisation, tandis que ${formatCad(capitalBullishAlignedCad, 0)} CAD reposent sur des catalyseurs solides.`
      : `Vos ${formatCad(donut.totalValueCad, 0)} CAD sont alignés avec les fondamentaux vérifiés et les catalyseurs macro actuels.`;

  return {
    bayesianPortfolioConfidencePct,
    capitalBullishAlignedCad: Math.round(capitalBullishAlignedCad),
    capitalVulnerableToShocksCad: Math.round(capitalVulnerableToShocksCad),
    netExpectedShockCad: Math.round(netExpectedShockCad),
    macroRegimeSummary,
    executiveAiThesis,
    causalChains,
    divergenceRows,
    radialNodes,
  };
}

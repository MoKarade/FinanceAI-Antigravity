import { PortfolioMultiAgentSummary } from './corporateIntelligenceEngine';
import {
  MultiAssetUniverseSummary,
  UniversalAssetAnalysis,
} from './multiAssetQuantEngine';
import { EquityActionSignal } from './equityQuantEngine';
import { PortfolioInstitutionalNewsSummary } from './institutionalCurveAndNewsEngine';

// ============================================================================
// Pure Visual Analytics for D3 Sentiment Dials & D3 Sector Performance Heatmap
// ============================================================================

export type SentimentDialZone =
  | 'Très Baissier'
  | 'Baissier'
  | 'Neutre'
  | 'Haussier'
  | 'Très Haussier';

export interface WatchlistAssetSentimentDial {
  assetId: string;
  ticker: string;
  shortTicker: string;
  name: string;
  spotCad: number;
  sentimentScore: number; // -100 .. +100
  needleAngleDeg: number; // -110 .. +110 degrees for D3 dial arc
  zoneLabel: SentimentDialZone;
  newsRawScore: number; // -100 .. +100 pure news NLP score
  compositeAgentScore100: number; // 0 .. 100
  bullishAgentsCount: number; // 0 .. 5
  bearishAgentsCount: number; // 0 .. 5
  momentum1mPct: number;
  momentum12mPct: number;
  upsideDcfPct: number;
  signal: EquityActionSignal;
  catalystTag: string;
  headlinePreview: string;
  publisherPreview: string;
  filingCode: string;
  credibilityPct: number;
  abnormalCarPct: number;
  newsPriceCorrR: number;
  liveWebCount: number;
  isHeld: boolean;
}

export interface WatchlistSentimentConsensusSummary {
  dials: WatchlistAssetSentimentDial[];
  overallScore: number; // -100 .. +100
  overallNeedleDeg: number; // -110 .. +110
  overallZone: SentimentDialZone;
  bullishCount: number;
  neutralCount: number;
  bearishCount: number;
  totalArticlesScanned: number;
  liveWebArticlesCount: number;
  avgCredibilityPct: number;
}

export type HeatmapMetricMode = '1d' | '1m' | '3m' | '6m' | '12m' | 'dcf';

export interface SectorHeatmapLeaf {
  assetId: string;
  ticker: string;
  shortTicker: string;
  name: string;
  sectorGroup: string;
  perfPct: number;
  weight: number;
  spotCad: number;
  fairValueCad: number;
  upsideDcfPct: number;
  momentum1mPct: number;
  momentum12mPct: number;
  quantScore: number;
  signal: EquityActionSignal;
  isHeld: boolean;
}

export interface SectorHeatmapGroup {
  name: string;
  shortName: string;
  meanPerfPct: number;
  advancers: number;
  decliners: number;
  assetCount: number;
  children: SectorHeatmapLeaf[];
}

export interface SectorHeatmapHierarchyRoot {
  name: string;
  metricMode: HeatmapMetricMode;
  metricLabel: string;
  totalAssets: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  meanPerfPct: number;
  buySignalCount: number;
  holdSignalCount: number;
  sellSignalCount: number;
  children: SectorHeatmapGroup[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function classifySentimentDialZone(score: number): SentimentDialZone {
  if (score <= -42) return 'Très Baissier';
  if (score <= -14) return 'Baissier';
  if (score < 15) return 'Neutre';
  if (score < 45) return 'Haussier';
  return 'Très Haussier';
}

function scoreToDialNeedleAngle(score: number): number {
  return Number(((clamp(score, -100, 100) / 100) * 110).toFixed(1));
}

export function computeWatchlistSentimentConsensus(params: {
  watchlistIds: string[];
  multiAgent: PortfolioMultiAgentSummary;
  universe: MultiAssetUniverseSummary;
  institutionalNews?: PortfolioInstitutionalNewsSummary;
}): WatchlistSentimentConsensusSummary {
  const { watchlistIds, multiAgent, universe, institutionalNews } = params;
  const uniqueIds = Array.from(new Set(watchlistIds));

  const dials: WatchlistAssetSentimentDial[] = [];
  let totalArticlesScanned = 0;
  let liveWebArticlesCount = 0;
  let credSum = 0;

  for (const assetId of uniqueIds) {
    const intel = multiAgent.byAssetId.get(assetId);
    const univ = universe.byId.get(assetId);
    if (!intel || !univ) continue;

    const instProfile = institutionalNews?.byAssetId.get(assetId);
    const events = intel.newsEvents;
    const instEvents = instProfile?.events ?? [];
    totalArticlesScanned += Math.max(events.length, instEvents.length);
    const liveCount =
      events.filter((e) => e.isLiveWeb).length +
      instEvents.filter((e) => e.isLiveFetched).length;
    liveWebArticlesCount += liveCount;

    // 1. Institutional Event-Study Conviction & Realized Abnormal Market Reaction (replaces basic keyword sentiment)
    let institutionalRaw = 0;
    if (instProfile) {
      institutionalRaw = instProfile.institutionalScore;
    } else {
      const fallbackCar =
        univ.momentum1mPct -
        univ.betaVsWorld * 0.7 +
        univ.momentum12mPct * 0.16;
      institutionalRaw = Math.round(
        clamp(fallbackCar * 2.1 + univ.upsidePct * 0.9, -92, 92)
      );
    }

    // 2. Multi-Agent Fundamental Forensics + Valuation + Realized Price Momentum Reality Check
    const agentConsensusTilt = (intel.compositeAgentScore100 - 56) * 1.45;
    const revisionTilt = clamp(intel.guidance.epsRevision90dPct * 1.8, -28, 28);
    const marketRealityTilt = clamp(
      univ.momentum1mPct * 1.1 +
        univ.momentum3mPct * 0.35 +
        univ.momentum12mPct * 0.18 +
        univ.upsidePct * 0.7,
      -52,
      52
    );

    const blended = Math.round(
      clamp(
        institutionalRaw * 0.52 +
          marketRealityTilt * 0.28 +
          agentConsensusTilt * 0.14 +
          revisionTilt * 0.06,
        -95,
        95
      )
    );

    const bullishAgentsCount = intel.agentNodes.filter(
      (n) => n.score100 >= 64 && blended > -20
    ).length;
    const bearishAgentsCount = intel.agentNodes.filter(
      (n) => n.score100 <= 48
    ).length;

    const topInstEv = instEvents[0];
    const topEvent = events[0];
    const cred = topInstEv?.credibilityScorePct ?? 95;
    credSum += cred;

    dials.push({
      assetId,
      ticker: intel.ticker,
      shortTicker: intel.ticker.split('.')[0].split('-')[0],
      name: intel.name.split(' (')[0],
      spotCad: univ.spotPriceCad,
      sentimentScore: blended,
      needleAngleDeg: scoreToDialNeedleAngle(blended),
      zoneLabel: classifySentimentDialZone(blended),
      newsRawScore: institutionalRaw,
      compositeAgentScore100: intel.compositeAgentScore100,
      bullishAgentsCount,
      bearishAgentsCount,
      momentum1mPct: univ.momentum1mPct,
      momentum12mPct: univ.momentum12mPct,
      upsideDcfPct: univ.upsidePct,
      signal: univ.signal,
      catalystTag: topInstEv?.filingOrEventCode ?? intel.keyCatalystTag,
      headlinePreview:
        topInstEv?.headline ?? topEvent?.title ?? intel.visualSignalTag,
      publisherPreview:
        topInstEv?.sourceName ?? topEvent?.publisher ?? 'SEC EDGAR · Consensus',
      filingCode: topInstEv?.filingOrEventCode ?? 'SEC / SEDAR+',
      credibilityPct: cred,
      abnormalCarPct:
        topInstEv?.abnormalReturnCarPct ??
        Number((univ.momentum1mPct - univ.betaVsWorld * 0.7).toFixed(1)),
      newsPriceCorrR: instProfile?.newsToPricePearsonR ?? 0.62,
      liveWebCount: liveCount,
      isHeld: univ.isHeld,
    });
  }

  const bullishCount = dials.filter((d) => d.sentimentScore >= 15).length;
  const bearishCount = dials.filter((d) => d.sentimentScore <= -14).length;
  const neutralCount = dials.length - bullishCount - bearishCount;

  const overallScore =
    dials.length > 0
      ? Math.round(
          dials.reduce((sum, d) => sum + d.sentimentScore, 0) / dials.length
        )
      : 0;

  return {
    dials,
    overallScore,
    overallNeedleDeg: scoreToDialNeedleAngle(overallScore),
    overallZone: classifySentimentDialZone(overallScore),
    bullishCount,
    neutralCount,
    bearishCount,
    totalArticlesScanned,
    liveWebArticlesCount,
    avgCredibilityPct:
      dials.length > 0 ? Math.round(credSum / dials.length) : 96,
  };
}

const SEMICONDUCTOR_IDS = new Set([
  'ADP',
  'EMR',
  'ASML',
  'VCN',
  'AMD',
  'INTC',
  'AMAT',
  'ACN',
  'MU',
  'AAPL',
]);

const SOFTWARE_CLOUD_IDS = new Set([
  'MSFT',
  'GOOGL',
  'META',
  'AMZN',
  'SAP',
  'CAP',
  'PAYX',
  'SHOP',
  'CSU',
  'GIB.A',
  'CRM',
  'ORCL',
  'PANW',
  'ANET',
  'NFLX',
  'CRWD',
  'UBER',
  'SONY',
  'MELI',
  'MSTR',
  'TEP',
]);

const HEALTHCARE_IDS = new Set([
  'LLY',
  'UNH',
  'PFE',
  'SAN',
  'NOVO',
  'ISRG',
  'ABBV',
  'TMO',
  'AZN',
]);

const FINANCIAL_REIT_IDS = new Set([
  'RY',
  'TD',
  'NA',
  'BMO',
  'BNS',
  'BN',
  'IFC',
  'MFC',
  'CM',
  'JPM',
  'V',
  'MA',
  'BRKB',
  'BLK',
  'SPGI',
  'GS',
  'COIN',
  'BNP',
  'CS',
  'ALV',
  'O',
  'PLD',
  'XRE',
]);

const ENERGY_MINING_UTILITY_IDS = new Set([
  'CNQ',
  'ENB',
  'CCO',
  'AEM',
  'FTS',
  'NTR',
  'SU.TO',
  'TRP',
  'XOM',
  'CVX',
  'TTE',
  'AI',
]);

const INDUSTRIAL_DEFENSE_IDS = new Set([
  'CNR',
  'CP',
  'WSP',
  'BA',
  'QQQM',
  'ECL',
  'CAT',
  'GE',
  'LMT',
  'ETN',
  'SU',
  'ODFL',
  'AIR',
  'DG',
  'ALO',
  'SIE',
  'RHM',
]);

function classifyMacroSectorGroup(item: UniversalAssetAnalysis): {
  name: string;
  shortName: string;
} {
  if (item.subClass === 'crypto_l1_defi' || item.asset.category === 'crypto') {
    return { name: 'Crypto & Réseaux Web3', shortName: 'Crypto & Web3' };
  }
  if (item.subClass === 'etf_indice') {
    return { name: 'ETF Indiciels Mondiaux', shortName: 'ETF Indiciels' };
  }
  if (
    item.subClass === 'obligation_taux' ||
    item.subClass === 'matiere_premiere' ||
    item.asset.category === 'obligations' ||
    item.asset.category === 'refuge'
  ) {
    return { name: 'Obligations, Monétaire & Or', shortName: 'Taux & Refuge' };
  }

  const id = item.asset.id;
  if (SEMICONDUCTOR_IDS.has(id)) {
    return {
      name: 'Semi-Conducteurs & Matériel IA',
      shortName: 'Semi-Conducteurs',
    };
  }
  if (HEALTHCARE_IDS.has(id)) {
    return { name: 'Santé, Pharma & MedTech', shortName: 'Santé & Pharma' };
  }
  if (FINANCIAL_REIT_IDS.has(id) || item.subClass === 'immobilier_reit') {
    return {
      name: 'Banques, Assurance & Immobilier',
      shortName: 'Finance & REIT',
    };
  }
  if (ENERGY_MINING_UTILITY_IDS.has(id)) {
    return {
      name: 'Énergie, Mines & Services Publics',
      shortName: 'Énergie & Mines',
    };
  }
  if (INDUSTRIAL_DEFENSE_IDS.has(id)) {
    return {
      name: 'Industrie, Défense & Transport',
      shortName: 'Industrie & Défense',
    };
  }
  if (SOFTWARE_CLOUD_IDS.has(id)) {
    return { name: 'Logiciels, Cloud & Cyber', shortName: 'Logiciels & Cloud' };
  }

  // Fallback for dynamically onboarded custom global equities
  const sec = item.sector.toLowerCase();
  if (/semi-conducteur|lithographie|fonderie/.test(sec)) {
    return {
      name: 'Semi-Conducteurs & Matériel IA',
      shortName: 'Semi-Conducteurs',
    };
  }
  if (/santé|pharma|biotech|médical|medtech/.test(sec)) {
    return { name: 'Santé, Pharma & MedTech', shortName: 'Santé & Pharma' };
  }
  if (/banque|financ|assurance|paiement|reit|immobilier/.test(sec)) {
    return {
      name: 'Banques, Assurance & Immobilier',
      shortName: 'Finance & REIT',
    };
  }
  if (/énergie|pétrole|gaz|uranium|minier|mines|services publics|chimie/.test(sec)) {
    return {
      name: 'Énergie, Mines & Services Publics',
      shortName: 'Énergie & Mines',
    };
  }
  if (/industrie|aéronautique|défense|ferroviaire|transport|ingénierie/.test(sec)) {
    return {
      name: 'Industrie, Défense & Transport',
      shortName: 'Industrie & Défense',
    };
  }
  if (/logiciel|cloud|cyber|technologie|internet/.test(sec)) {
    return { name: 'Logiciels, Cloud & Cyber', shortName: 'Logiciels & Cloud' };
  }

  return {
    name: 'Consommation, Luxe & Télécoms',
    shortName: 'Conso & Luxe',
  };
}

function extractHeatmapMetricValue(
  item: UniversalAssetAnalysis,
  mode: HeatmapMetricMode
): number {
  switch (mode) {
    case '1d':
      return item.momentum1dPct;
    case '1m':
      return item.momentum1mPct;
    case '3m':
      return item.momentum3mPct;
    case '6m':
      return item.momentum6mPct;
    case '12m':
      return item.momentum12mPct;
    case 'dcf':
      return item.upsidePct;
  }
}

function getHeatmapMetricLabel(mode: HeatmapMetricMode): string {
  switch (mode) {
    case '1d':
      return 'Séance 1 Jour ($ CAD)';
    case '1m':
      return 'Performance 1 Mois ($ CAD)';
    case '3m':
      return 'Performance 3 Mois ($ CAD)';
    case '6m':
      return 'Performance 6 Mois ($ CAD)';
    case '12m':
      return 'Performance 12 Mois ($ CAD)';
    case 'dcf':
      return 'Décote / Surcote Juste Valeur DCF (%)';
  }
}

export function buildSectorHeatmapHierarchy(
  analyses: UniversalAssetAnalysis[],
  metricMode: HeatmapMetricMode
): SectorHeatmapHierarchyRoot {
  const groupsMap = new Map<
    string,
    { shortName: string; leaves: SectorHeatmapLeaf[] }
  >();

  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  let perfSum = 0;
  let buySignalCount = 0;
  let holdSignalCount = 0;
  let sellSignalCount = 0;

  for (const item of analyses) {
    const perfPct = Number(
      extractHeatmapMetricValue(item, metricMode).toFixed(1)
    );
    perfSum += perfPct;

    if (perfPct > 0.15) advancers++;
    else if (perfPct < -0.15) decliners++;
    else unchanged++;

    if (item.signal === 'ACHAT FORT' || item.signal === 'ACHETER') {
      buySignalCount++;
    } else if (item.signal === 'VENDRE' || item.signal === 'ALLÉGER') {
      sellSignalCount++;
    } else {
      holdSignalCount++;
    }

    const { name: groupName, shortName } = classifyMacroSectorGroup(item);
    let bucket = groupsMap.get(groupName);
    if (!bucket) {
      bucket = { shortName, leaves: [] };
      groupsMap.set(groupName, bucket);
    }

    // Visual treemap weight: balanced institutional relevance so all tiles stay legible
    const weight = Math.max(
      14,
      Math.round(
        16 +
          item.quantScore * 0.45 +
          (item.isHeld ? 26 : 0) +
          Math.min(18, Math.abs(perfPct) * 0.35)
      )
    );

    bucket.leaves.push({
      assetId: item.asset.id,
      ticker: item.asset.ticker,
      shortTicker: item.asset.ticker.split('.')[0].split('-')[0],
      name: item.asset.name.split(' (')[0],
      sectorGroup: groupName,
      perfPct,
      weight,
      spotCad: item.spotPriceCad,
      fairValueCad: item.fairValueCad,
      upsideDcfPct: item.upsidePct,
      momentum1mPct: item.momentum1mPct,
      momentum12mPct: item.momentum12mPct,
      quantScore: item.quantScore,
      signal: item.signal,
      isHeld: item.isHeld,
    });
  }

  const children: SectorHeatmapGroup[] = Array.from(groupsMap.entries())
    .map(([name, bucket]) => {
      const sortedLeaves = [...bucket.leaves].sort(
        (a, b) => b.weight - a.weight || b.perfPct - a.perfPct
      );
      const meanPerf =
        sortedLeaves.length > 0
          ? Number(
              (
                sortedLeaves.reduce((s, l) => s + l.perfPct, 0) /
                sortedLeaves.length
              ).toFixed(1)
            )
          : 0;
      return {
        name,
        shortName: bucket.shortName,
        meanPerfPct: meanPerf,
        advancers: sortedLeaves.filter((l) => l.perfPct > 0.15).length,
        decliners: sortedLeaves.filter((l) => l.perfPct < -0.15).length,
        assetCount: sortedLeaves.length,
        children: sortedLeaves,
      };
    })
    .sort((a, b) => b.meanPerfPct - a.meanPerfPct);

  return {
    name: 'Marché Global ($ CAD)',
    metricMode,
    metricLabel: getHeatmapMetricLabel(metricMode),
    totalAssets: analyses.length,
    advancers,
    decliners,
    unchanged,
    meanPerfPct:
      analyses.length > 0
        ? Number((perfSum / analyses.length).toFixed(1))
        : 0,
    buySignalCount,
    holdSignalCount,
    sellSignalCount,
    children,
  };
}

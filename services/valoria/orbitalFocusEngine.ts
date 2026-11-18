import * as d3 from 'd3';
import { HISTORICAL_SERIES, getAssetById } from './marketData';
import type { PortfolioLot } from './engine';
import {
  type MonteCarlo10kResult,
  runPortfolioMonteCarlo10k,
} from './monteCarlo10k';
import type {
  AnalystTradeRecommendation,
  HeldLineDiagnostic,
  ProAnalystAdvisoryReport,
} from './proAnalystAdvisor';
import type {
  MultiAssetUniverseSummary,
  UniversalAssetAnalysis,
} from './multiAssetQuantEngine';
import {
  type PortfolioSliceId,
  classifyAssetAllocationSlice,
} from './portfolioOrbitalIntelligence';
import { formatCad } from './valoriaFormatters';

export type OrbitalLayoutMode = 'radial' | 'force';

type OrbitalNodeKind =
  | 'core_holding'
  | 'orbit_holding'
  | 'cash_reserve'
  | 'buy_recommendation';

type OrbitalSignalAction =
  | 'ACHETER'
  | 'RENFORCER'
  | 'CONSERVER'
  | 'ALLÉGER'
  | 'VENDRE';

type OrbitBandId =
  | 'center'
  | 'high_corr'
  | 'moderate_corr'
  | 'diversifier'
  | 'recommendation';

export interface PortfolioOrbitalNode {
  id: string;
  ticker: string;
  name: string;
  kind: OrbitalNodeKind;
  sliceId: PortfolioSliceId;
  colorHex: string;
  isHeld: boolean;
  currentValueCad: number;
  investedCad: number;
  weightPct: number;
  targetWeightPct: number;
  recommendedDeltaCad: number;
  signalAction: OrbitalSignalAction;
  corrWithCore: number;
  spotPriceCad: number;
  fairValueCad: number | null;
  upsidePct: number | null;
  pnlPct: number;
  aiScore100: number;
  orbitBand: OrbitBandId;
  targetOrbitRadius: number;
  nodeRadius: number;
  angleRad: number;
  x: number;
  y: number;
}

interface PortfolioOrbitalLink {
  id: string;
  sourceId: string;
  targetId: string;
  correlation: number;
  kind: 'core_tether' | 'cross_asset_corr' | 'recommendation_vector';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface OrbitalRingGuide {
  id: OrbitBandId;
  radius: number;
  label: string;
  corrRangeLabel: string;
}

export interface PortfolioOrbitalGraphModel {
  coreNode: PortfolioOrbitalNode | null;
  nodes: PortfolioOrbitalNode[];
  links: PortfolioOrbitalLink[];
  rings: OrbitalRingGuide[];
  totalCapitalWithCashCad: number;
  cashReserveCad: number;
  recommendedAdjustmentsCount: number;
}

interface FocusedAssetSignalTrigger {
  id: 'valuation' | 'technical' | 'portfolio';
  label: string;
  metricText: string;
  tone: 'positive' | 'negative' | 'neutral';
}

export interface FocusedAssetIsolationSnapshot {
  assetId: string;
  ticker: string;
  name: string;
  categoryLabel: string;
  colorHex: string;
  isHeld: boolean;
  isCash: boolean;
  isCoreAsset: boolean;
  spotPriceCad: number;
  currentValueCad: number;
  simulatedStakeCad: number;
  weightPct: number;
  targetWeightPct: number;
  pnlCad: number;
  pnlPct: number;
  corrWithCore: number;
  coreTicker: string;
  signalAction: OrbitalSignalAction;
  signalTone: 'positive' | 'negative' | 'neutral';
  signalConvictionPct: number;
  recommendedDeltaCad: number;
  quickBuyAmountCad: number;
  quickTrimAmountCad: number;
  fairValueCad: number | null;
  upsidePct: number | null;
  stopLossCad: number | null;
  target12mCad: number | null;
  rsi14: number;
  trendRegime: string;
  smaGapPct: number;
  buyVotesOutOf7: number;
  conciseSignalSummary: string;
  triggers: [
    FocusedAssetSignalTrigger,
    FocusedAssetSignalTrigger,
    FocusedAssetSignalTrigger,
  ];
  monteCarlo: MonteCarlo10kResult;
}

const SLICE_COLOR_HEX: Record<PortfolioSliceId, string> = {
  etf_monde: '#10b981',
  actions_value: '#818cf8',
  tech_ia: '#38bdf8',
  or_refuges: '#eab308',
  obligations_cash: '#2dd4bf',
  crypto_web3: '#fb7185',
  immobilier_reit: '#f97316',
};

const SLICE_BASE_ANGLE_RAD: Record<PortfolioSliceId, number> = {
  etf_monde: -Math.PI * 0.78,
  tech_ia: -Math.PI * 0.22,
  crypto_web3: -Math.PI * 0.04,
  actions_value: Math.PI * 0.2,
  immobilier_reit: Math.PI * 0.44,
  or_refuges: Math.PI * 0.66,
  obligations_cash: Math.PI * 0.88,
};

function deterministicIdHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function getMonthlySimpleReturns(assetId: string): number[] {
  if (assetId === 'CASH') {
    return new Array(Math.max(1, HISTORICAL_SERIES.length - 1)).fill(0.002);
  }
  const rets: number[] = [];
  for (let t = 1; t < HISTORICAL_SERIES.length; t++) {
    const p0 = HISTORICAL_SERIES[t - 1].prices[assetId] ?? 100;
    const p1 = HISTORICAL_SERIES[t].prices[assetId] ?? p0;
    rets.push(p0 > 0 ? p1 / p0 - 1 : 0);
  }
  return rets;
}

/**
 * Computes empirical Pearson correlation in [-1, 1] between two assets across HISTORICAL_SERIES.
 */
export function computePairwiseAssetCorrelation(
  assetIdA: string,
  assetIdB: string
): number {
  if (assetIdA === assetIdB) return 1;
  if (assetIdA === 'CASH' || assetIdB === 'CASH') return 0.02;

  const a = getMonthlySimpleReturns(assetIdA);
  const b = getMonthlySimpleReturns(assetIdB);
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;

  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;

  let num = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    varA += da * da;
    varB += db * db;
  }

  const den = Math.sqrt(varA * varB);
  if (den < 1e-9) return 0;
  return Number(Math.max(-1, Math.min(1, num / den)).toFixed(2));
}

function mapCorrelationToOrbit(
  corr: number,
  kind: OrbitalNodeKind
): { band: OrbitBandId; radius: number } {
  if (kind === 'core_holding') {
    return { band: 'center', radius: 0 };
  }
  if (kind === 'buy_recommendation') {
    return { band: 'recommendation', radius: 206 };
  }
  if (kind === 'cash_reserve') {
    return { band: 'diversifier', radius: 170 };
  }

  // Higher correlation with the principal asset orbits closer; low/negative correlation orbits wider
  if (corr >= 0.62) {
    const t = Math.min(1, (corr - 0.62) / 0.38);
    return {
      band: 'high_corr',
      radius: Math.round(112 - t * 20), // 92 .. 112
    };
  }
  if (corr >= 0.22) {
    const t = (corr - 0.22) / 0.4;
    return {
      band: 'moderate_corr',
      radius: Math.round(148 - t * 24), // 124 .. 148
    };
  }
  const t = Math.max(0, Math.min(1, (0.22 - corr) / 0.75));
  return {
    band: 'diversifier',
    radius: Math.round(160 + t * 20), // 160 .. 180
  };
}

function computeNodeVisualRadius(
  weightPct: number,
  kind: OrbitalNodeKind,
  recommendedDeltaCad: number
): number {
  if (kind === 'core_holding') {
    return Math.round(Math.max(34, Math.min(46, 26 + Math.sqrt(Math.max(1, weightPct)) * 3.1)));
  }
  if (kind === 'buy_recommendation') {
    const mag = Math.min(12000, Math.max(1000, Math.abs(recommendedDeltaCad)));
    return Math.round(17 + (mag / 12000) * 6); // 17 .. 23
  }
  if (kind === 'cash_reserve' && weightPct < 0.5) {
    return 18;
  }
  return Math.round(
    Math.max(18, Math.min(34, 14 + Math.sqrt(Math.max(0.5, weightPct)) * 3.2))
  );
}

interface SimDatum extends d3.SimulationNodeDatum {
  id: string;
  kind: OrbitalNodeKind;
  targetRadius: number;
  nodeRadius: number;
  preferredAngle: number;
  x: number;
  y: number;
}

interface SimLinkDatum extends d3.SimulationLinkDatum<SimDatum> {
  source: string | SimDatum;
  target: string | SimDatum;
  correlation: number;
  kind: PortfolioOrbitalLink['kind'];
}

/**
 * Builds the central D3 radial / force-directed portfolio orbital model for 'Ce que j'ai':
 * - Principal asset (#1 holding by $ CAD value) anchored at (0, 0)
 * - Other held assets orbiting by Pearson correlation & scaled by portfolio weight
 * - Cash / Liquidités ($ CAD) orbiting in the low-correlation stabilizer ring
 * - Buy / Sell adjustment recommendations integrated on held nodes + outer opportunity satellites
 */
export function buildPortfolioOrbitalGraph(params: {
  advisory: ProAnalystAdvisoryReport;
  universe: MultiAssetUniverseSummary;
  availableCashCad: number;
  layoutMode?: OrbitalLayoutMode;
}): PortfolioOrbitalGraphModel {
  const {
    advisory,
    universe,
    availableCashCad,
    layoutMode = 'radial',
  } = params;

  const rings: OrbitalRingGuide[] = [
    {
      id: 'high_corr',
      radius: 102,
      label: 'Orbite Proche',
      corrRangeLabel: 'ρ ≥ 0,62',
    },
    {
      id: 'moderate_corr',
      radius: 138,
      label: 'Orbite Médiane',
      corrRangeLabel: 'ρ 0,22–0,61',
    },
    {
      id: 'diversifier',
      radius: 170,
      label: 'Stabilisateurs & Liquidités',
      corrRangeLabel: 'ρ < 0,22',
    },
    {
      id: 'recommendation',
      radius: 206,
      label: 'Opportunités IA Recommandées',
      corrRangeLabel: 'Candidats IA',
    },
  ];

  const sellMap = new Map<string, AnalystTradeRecommendation>(
    advisory.sellRecommendations.map((s) => [s.assetId, s])
  );
  const buyMap = new Map<string, AnalystTradeRecommendation>(
    advisory.buyRecommendations.map((b) => [b.assetId, b])
  );

  // Merge any explicit CASH holding with availableCashCad dry powder
  const nonCashHeld: HeldLineDiagnostic[] = [];
  let heldCashValueCad = 0;
  let heldCashInvestedCad = 0;

  for (const line of advisory.heldLines) {
    if (line.assetId === 'CASH') {
      heldCashValueCad += line.currentValueCad;
      heldCashInvestedCad += line.investedCad;
    } else {
      nonCashHeld.push(line);
    }
  }

  const sortedHeld = [...nonCashHeld].sort(
    (a, b) => b.currentValueCad - a.currentValueCad
  );

  const totalCashCad = Math.max(0, Math.round(availableCashCad + heldCashValueCad));
  const totalHeldAssetsCad = sortedHeld.reduce(
    (s, h) => s + h.currentValueCad,
    0
  );
  const totalCapitalWithCashCad = Math.max(0, totalHeldAssetsCad + totalCashCad);

  if (sortedHeld.length === 0 && totalCashCad <= 0) {
    return {
      coreNode: null,
      nodes: [],
      links: [],
      rings,
      totalCapitalWithCashCad: 0,
      cashReserveCad: 0,
      recommendedAdjustmentsCount: 0,
    };
  }

  const coreAssetId = sortedHeld[0]?.assetId ?? 'CASH';
  const denomCap = Math.max(1, totalCapitalWithCashCad);

  const rawNodes: Omit<PortfolioOrbitalNode, 'x' | 'y' | 'angleRad'>[] = [];

  for (let i = 0; i < sortedHeld.length; i++) {
    const line = sortedHeld[i];
    const isCore = i === 0;
    const kind: OrbitalNodeKind = isCore ? 'core_holding' : 'orbit_holding';
    const sliceId = classifyAssetAllocationSlice(line.assetId);
    const uItem = universe.byId.get(line.assetId);
    const corp = advisory.multiAgent.byAssetId.get(line.assetId);
    const sellRec = sellMap.get(line.assetId);
    const buyRec = buyMap.get(line.assetId);

    const recommendedDeltaCad = sellRec
      ? Math.round(sellRec.deltaCad)
      : buyRec
        ? Math.round(buyRec.deltaCad)
        : 0;

    const signalAction: OrbitalSignalAction = sellRec
      ? sellRec.actionLabel === 'VENDRE'
        ? 'VENDRE'
        : 'ALLÉGER'
      : buyRec
        ? 'RENFORCER'
        : line.verdict;

    const weightPct = Number(((line.currentValueCad / denomCap) * 100).toFixed(1));
    const targetWeightPct = sellRec
      ? sellRec.targetWeightPct
      : buyRec
        ? buyRec.targetWeightPct
        : weightPct;

    const corrWithCore = isCore
      ? 1
      : computePairwiseAssetCorrelation(line.assetId, coreAssetId);
    const orbit = mapCorrelationToOrbit(corrWithCore, kind);
    const nodeRadius = computeNodeVisualRadius(
      weightPct,
      kind,
      recommendedDeltaCad
    );

    rawNodes.push({
      id: line.assetId,
      ticker: line.ticker.split('.')[0],
      name: line.name.split(' (')[0],
      kind,
      sliceId,
      colorHex: SLICE_COLOR_HEX[sliceId],
      isHeld: true,
      currentValueCad: Math.round(line.currentValueCad),
      investedCad: Math.round(line.investedCad),
      weightPct,
      targetWeightPct: Number(targetWeightPct.toFixed(1)),
      recommendedDeltaCad,
      signalAction,
      corrWithCore,
      spotPriceCad: line.spotPriceCad,
      fairValueCad: uItem ? uItem.fairValueCad : null,
      upsidePct: uItem ? Number(uItem.upsidePct.toFixed(1)) : null,
      pnlPct: Number(line.pnlPct.toFixed(1)),
      aiScore100: corp ? corp.compositeAgentScore100 : line.quantScore,
      orbitBand: orbit.band,
      targetOrbitRadius: orbit.radius,
      nodeRadius,
    });
  }

  // Always include Liquidités ($ CAD) in the orbital model (core if cash-only, otherwise stabilizer orbit)
  const isCashCore = sortedHeld.length === 0;
  const cashWeightPct = Number(((totalCashCad / denomCap) * 100).toFixed(1));
  const cashKind: OrbitalNodeKind = isCashCore ? 'core_holding' : 'cash_reserve';
  const cashOrbit = mapCorrelationToOrbit(isCashCore ? 1 : 0.02, cashKind);
  const cashDeployDelta =
    totalCashCad >= 100 && advisory.cashUsedCad > 0
      ? -Math.round(advisory.cashUsedCad)
      : 0;

  rawNodes.push({
    id: 'CASH',
    ticker: 'CASH',
    name: 'Liquidités ($ CAD)',
    kind: cashKind,
    sliceId: 'obligations_cash',
    colorHex: '#2dd4bf',
    isHeld: totalCashCad > 0,
    currentValueCad: totalCashCad,
    investedCad: heldCashInvestedCad + availableCashCad,
    weightPct: cashWeightPct,
    targetWeightPct: Math.max(
      0,
      Number((((totalCashCad + cashDeployDelta) / denomCap) * 100).toFixed(1))
    ),
    recommendedDeltaCad: cashDeployDelta,
    signalAction: 'CONSERVER',
    corrWithCore: isCashCore ? 1 : 0.02,
    spotPriceCad: 100,
    fairValueCad: 100,
    upsidePct: 0,
    pnlPct: 0,
    aiScore100: 70,
    orbitBand: cashOrbit.band,
    targetOrbitRadius: cashOrbit.radius,
    nodeRadius: computeNodeVisualRadius(cashWeightPct, cashKind, cashDeployDelta),
  });

  // Unowned Buy Recommendations orbiting on the outer ring (ready to glide inward when bought!)
  const heldIdSet = new Set(rawNodes.map((n) => n.id));
  const unownedBuys = advisory.buyRecommendations
    .filter((b) => !heldIdSet.has(b.assetId) && b.deltaCad >= 100)
    .slice(0, 4);

  for (const buy of unownedBuys) {
    const sliceId = classifyAssetAllocationSlice(buy.assetId);
    const corrWithCore = computePairwiseAssetCorrelation(
      buy.assetId,
      coreAssetId
    );
    const orbit = mapCorrelationToOrbit(corrWithCore, 'buy_recommendation');
    const nodeRadius = computeNodeVisualRadius(
      0,
      'buy_recommendation',
      buy.deltaCad
    );

    rawNodes.push({
      id: buy.assetId,
      ticker: buy.ticker.split('.')[0],
      name: buy.name.split(' (')[0],
      kind: 'buy_recommendation',
      sliceId,
      colorHex: SLICE_COLOR_HEX[sliceId],
      isHeld: false,
      currentValueCad: 0,
      investedCad: 0,
      weightPct: 0,
      targetWeightPct: Number(buy.targetWeightPct.toFixed(1)),
      recommendedDeltaCad: Math.round(buy.deltaCad),
      signalAction: 'ACHETER',
      corrWithCore,
      spotPriceCad: buy.spotPriceCad,
      fairValueCad: buy.dcfIntrinsicCad,
      upsidePct: buy.dcfUpsidePct,
      pnlPct: 0,
      aiScore100: buy.quantScore,
      orbitBand: orbit.band,
      targetOrbitRadius: orbit.radius,
      nodeRadius,
    });
  }

  // Deterministic initial angular distribution so Framer Motion transitions smoothly on weight changes
  const simNodes: SimDatum[] = rawNodes.map((n) => {
    if (n.kind === 'core_holding') {
      return {
        id: n.id,
        kind: n.kind,
        targetRadius: 0,
        nodeRadius: n.nodeRadius,
        preferredAngle: 0,
        x: 0,
        y: 0,
        fx: 0,
        fy: 0,
      };
    }

    const baseSectorAngle = SLICE_BASE_ANGLE_RAD[n.sliceId] ?? 0;
    const hashOffset = (deterministicIdHash(n.id) - 0.5) * 1.15;
    const preferredAngle = baseSectorAngle + hashOffset;
    const initX = Math.cos(preferredAngle) * n.targetOrbitRadius;
    const initY = Math.sin(preferredAngle) * n.targetOrbitRadius;

    return {
      id: n.id,
      kind: n.kind,
      targetRadius: n.targetOrbitRadius,
      nodeRadius: n.nodeRadius,
      preferredAngle,
      x: initX,
      y: initY,
    };
  });

  // Build correlation & tether links
  const simLinks: SimLinkDatum[] = [];
  for (const n of rawNodes) {
    if (n.id === coreAssetId) continue;
    simLinks.push({
      source: coreAssetId,
      target: n.id,
      correlation: n.corrWithCore,
      kind:
        n.kind === 'buy_recommendation'
          ? 'recommendation_vector'
          : 'core_tether',
    });
  }

  // Strong cross-asset correlations among orbiting holdings (|rho| >= 0.55)
  const orbitHoldings = rawNodes.filter((n) => n.kind === 'orbit_holding');
  for (let i = 0; i < orbitHoldings.length; i++) {
    for (let j = i + 1; j < orbitHoldings.length; j++) {
      const corr = computePairwiseAssetCorrelation(
        orbitHoldings[i].id,
        orbitHoldings[j].id
      );
      if (Math.abs(corr) >= 0.55) {
        simLinks.push({
          source: orbitHoldings[i].id,
          target: orbitHoldings[j].id,
          correlation: corr,
          kind: 'cross_asset_corr',
        });
      }
    }
  }

  // Run synchronous D3 force simulation to equilibrium
  const simulation = d3
    .forceSimulation<SimDatum>(simNodes)
    .stop()
    .force(
      'radial',
      d3
        .forceRadial<SimDatum>((d) => d.targetRadius, 0, 0)
        .strength(layoutMode === 'radial' ? 0.92 : 0.52)
    )
    .force(
      'collide',
      d3
        .forceCollide<SimDatum>((d) => d.nodeRadius + 13)
        .iterations(3)
        .strength(0.95)
    );

  if (layoutMode === 'force') {
    simulation
      .force(
        'charge',
        d3
          .forceManyBody<SimDatum>()
          .strength((d) => (d.kind === 'core_holding' ? -240 : -115))
      )
      .force(
        'link',
        d3
          .forceLink<SimDatum, SimLinkDatum>(
            simLinks.map((l) => ({ ...l }))
          )
          .id((d) => d.id)
          .distance((l) => {
            if (l.kind === 'recommendation_vector') return 205;
            const c = Math.max(-0.6, Math.min(1, l.correlation));
            return 165 - c * 62;
          })
          .strength((l) =>
            l.kind === 'cross_asset_corr' ? 0.24 : 0.32
          )
      );
  } else {
    // Gentle angular anchor in radial mode + clear -122deg label axis corridor
    const labelAxisRad = -Math.PI * 0.68;
    simulation.force('angularAnchor', (alpha) => {
      for (const d of simNodes) {
        if (d.kind === 'core_holding') continue;
        let angle = d.preferredAngle;
        const diffFromLabelAxis = Math.atan2(
          Math.sin(angle - labelAxisRad),
          Math.cos(angle - labelAxisRad)
        );
        if (Math.abs(diffFromLabelAxis) < 0.42) {
          angle = labelAxisRad + (diffFromLabelAxis >= 0 ? 0.44 : -0.44);
        }
        const tx = Math.cos(angle) * d.targetRadius;
        const ty = Math.sin(angle) * d.targetRadius;
        d.vx = (d.vx ?? 0) + (tx - d.x) * 0.18 * alpha;
        d.vy = (d.vy ?? 0) + (ty - d.y) * 0.18 * alpha;
      }
    });
  }

  for (let tick = 0; tick < 150; tick++) {
    simulation.tick();
    // Clamp within SVG viewport [-226, 226] so labels never clip
    for (const d of simNodes) {
      if (d.kind === 'core_holding') {
        d.x = 0;
        d.y = 0;
      } else {
        const dist = Math.hypot(d.x, d.y);
        const maxR = d.kind === 'buy_recommendation' ? 214 : 188;
        const minR = d.nodeRadius + 46;
        if (dist > maxR && dist > 0) {
          d.x = (d.x / dist) * maxR;
          d.y = (d.y / dist) * maxR;
        } else if (dist < minR && dist > 0) {
          d.x = (d.x / dist) * minR;
          d.y = (d.y / dist) * minR;
        }
      }
    }
  }

  const posById = new Map<string, SimDatum>(simNodes.map((d) => [d.id, d]));

  const settledNodes: PortfolioOrbitalNode[] = rawNodes.map((n) => {
    const sim = posById.get(n.id);
    const x = Number((sim?.x ?? 0).toFixed(1));
    const y = Number((sim?.y ?? 0).toFixed(1));
    const angleRad = Number(Math.atan2(y, x).toFixed(4));
    return {
      ...n,
      x,
      y,
      angleRad,
    };
  });

  const nodeLookup = new Map<string, PortfolioOrbitalNode>(
    settledNodes.map((n) => [n.id, n])
  );

  const settledLinks: PortfolioOrbitalLink[] = simLinks
    .map((l): PortfolioOrbitalLink | null => {
      const srcId = typeof l.source === 'string' ? l.source : l.source.id;
      const tgtId = typeof l.target === 'string' ? l.target : l.target.id;
      const src = nodeLookup.get(srcId);
      const tgt = nodeLookup.get(tgtId);
      if (!src || !tgt) return null;
      return {
        id: `orb-link-${srcId}-${tgtId}`,
        sourceId: srcId,
        targetId: tgtId,
        correlation: l.correlation,
        kind: l.kind,
        x1: src.x,
        y1: src.y,
        x2: tgt.x,
        y2: tgt.y,
      };
    })
    .filter((x): x is PortfolioOrbitalLink => x !== null);

  const coreNode =
    settledNodes.find((n) => n.kind === 'core_holding') ?? settledNodes[0] ?? null;

  const recommendedAdjustmentsCount = settledNodes.filter(
    (n) => Math.abs(n.recommendedDeltaCad) >= 100 && n.id !== 'CASH'
  ).length;

  return {
    coreNode,
    nodes: settledNodes,
    links: settledLinks,
    rings,
    totalCapitalWithCashCad: Math.round(totalCapitalWithCashCad),
    cashReserveCad: totalCashCad,
    recommendedAdjustmentsCount,
  };
}

/**
 * Computes the isolated single-asset Focus Mode snapshot:
 * 1) 10,000-scenario Monte Carlo projection strictly for the clicked asset
 * 2) Clean, actionable Buy / Sell signal diagnostics & execution sizing
 */
export function buildFocusedAssetSnapshot(params: {
  assetId: string;
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  availableCashCad: number;
  advisory: ProAnalystAdvisoryReport;
  universe: MultiAssetUniverseSummary;
  horizonYears?: number;
  seed?: number;
}): FocusedAssetIsolationSnapshot | null {
  const {
    assetId,
    lots,
    livePrices,
    availableCashCad,
    advisory,
    universe,
    horizonYears = 10,
    seed = 20261113,
  } = params;

  const asset = getAssetById(assetId);
  if (!asset) return null;

  const sliceId = classifyAssetAllocationSlice(assetId);
  const colorHex = SLICE_COLOR_HEX[sliceId];
  const isCash = assetId === 'CASH';

  const heldLine = advisory.heldLines.find((h) => h.assetId === assetId) ?? null;
  const sellRec =
    advisory.sellRecommendations.find((s) => s.assetId === assetId) ?? null;
  const buyRec =
    advisory.buyRecommendations.find((b) => b.assetId === assetId) ?? null;
  const uItem: UniversalAssetAnalysis | null =
    universe.byId.get(assetId) ?? null;
  const corp = advisory.multiAgent.byAssetId.get(assetId) ?? null;

  const nonCashHeld = [...advisory.heldLines]
    .filter((h) => h.assetId !== 'CASH')
    .sort((a, b) => b.currentValueCad - a.currentValueCad);
  const coreHolding = nonCashHeld[0] ?? null;
  const coreAssetId = coreHolding?.assetId ?? 'XBB';
  const coreTicker = coreHolding?.ticker.split('.')[0] ?? 'XBB';
  const isCoreAsset = coreHolding?.assetId === assetId;

  const totalCapitalWithCash = Math.max(
    1,
    advisory.heldLines.reduce((s, h) => s + h.currentValueCad, 0) +
      Math.max(0, availableCashCad)
  );

  const currentValueCad = isCash
    ? Math.round((heldLine?.currentValueCad ?? 0) + Math.max(0, availableCashCad))
    : Math.round(heldLine?.currentValueCad ?? 0);

  const isHeld = currentValueCad >= 25;
  const weightPct = Number(
    ((currentValueCad / totalCapitalWithCash) * 100).toFixed(1)
  );

  const recommendedDeltaCad = sellRec
    ? Math.round(sellRec.deltaCad)
    : buyRec
      ? Math.round(buyRec.deltaCad)
      : 0;

  // Stake simulated in single-asset Monte Carlo: owned value if held, else recommended buy or 5 000 $ CAD
  const simulatedStakeCad =
    currentValueCad >= 100
      ? currentValueCad
      : buyRec && buyRec.deltaCad >= 250
        ? Math.round(buyRec.deltaCad)
        : 5000;

  const assetLots = lots.filter(
    (l) => l.assetId === assetId && l.investedAmount > 0
  );
  const isolatedLots: PortfolioLot[] =
    assetLots.length > 0 && !isCash
      ? assetLots
      : [
          {
            id: `focus-sim-${assetId}`,
            assetId,
            investedAmount: simulatedStakeCad,
            purchaseYearMonth: '2026-11',
          },
        ];

  const monteCarlo = runPortfolioMonteCarlo10k({
    lots: isolatedLots,
    livePrices,
    initialCapitalOverride: simulatedStakeCad,
    monthlyContribution: 0,
    horizonYears,
    scenarioCount: 10000,
    seed: seed + Math.round(deterministicIdHash(assetId) * 9973),
  });

  const spotPriceCad = isCash
    ? 100
    : heldLine?.spotPriceCad ?? uItem?.spotPriceCad ?? livePrices[assetId] ?? 100;

  const fairValueCad = isCash
    ? 100
    : sellRec?.dcfIntrinsicCad ??
      buyRec?.dcfIntrinsicCad ??
      (uItem ? uItem.fairValueCad : null);

  const upsidePct = isCash
    ? 0
    : sellRec?.dcfUpsidePct ??
      buyRec?.dcfUpsidePct ??
      (uItem ? Number(uItem.upsidePct.toFixed(1)) : null);

  const stopLossCad = isCash
    ? null
    : sellRec?.stopLossCad ??
      buyRec?.stopLossCad ??
      (uItem ? Number((spotPriceCad * 0.88).toFixed(2)) : null);

  const target12mCad = isCash
    ? null
    : sellRec?.target12mCad ??
      buyRec?.target12mCad ??
      (fairValueCad && fairValueCad > spotPriceCad
        ? Number(fairValueCad.toFixed(2))
        : Number((spotPriceCad * 1.12).toFixed(2)));

  let signalAction: OrbitalSignalAction = 'CONSERVER';
  if (sellRec) {
    signalAction = sellRec.actionLabel === 'VENDRE' ? 'VENDRE' : 'ALLÉGER';
  } else if (buyRec) {
    signalAction = isHeld ? 'RENFORCER' : 'ACHETER';
  } else if (heldLine) {
    signalAction = heldLine.verdict;
  } else if (uItem) {
    if (uItem.signal === 'ACHAT FORT' || uItem.signal === 'ACHETER') {
      signalAction = 'ACHETER';
    } else if (uItem.signal === 'VENDRE' || uItem.signal === 'ALLÉGER') {
      signalAction = uItem.signal;
    }
  }

  const signalTone: 'positive' | 'negative' | 'neutral' =
    signalAction === 'ACHETER' || signalAction === 'RENFORCER'
      ? 'positive'
      : signalAction === 'VENDRE' || signalAction === 'ALLÉGER'
        ? 'negative'
        : 'neutral';

  const signalConvictionPct =
    sellRec?.chainOfThought.confidencePct ??
    buyRec?.chainOfThought.confidencePct ??
    heldLine?.chainOfThought.confidencePct ??
    (corp ? corp.compositeAgentScore100 : uItem?.quantScore ?? 70);

  const targetWeightPct = sellRec
    ? sellRec.targetWeightPct
    : buyRec
      ? buyRec.targetWeightPct
      : weightPct;

  const corrWithCore = isCoreAsset
    ? 1
    : computePairwiseAssetCorrelation(assetId, coreAssetId);

  const rsi14 = uItem?.rsi14 ?? 52;
  const trendRegime = uItem?.trendRegime ?? 'Consolidation';
  const smaGapPct =
    corp?.committeeConsensus.technicalSnapshot.gapVsSma200Pct ??
    uItem?.sma12GapPct ??
    0;
  const buyVotesOutOf7 = corp?.committeeConsensus.buyVotes ?? (signalTone === 'positive' ? 5 : signalTone === 'negative' ? 2 : 4);

  const conciseSignalSummary = isCash
    ? `Réserve monétaire liquide (${formatCad(currentValueCad, 0)} CAD) prête à être déployée sur les décotes vérifiées.`
    : sellRec
      ? sellRec.plainFrenchWhy
      : buyRec
        ? buyRec.plainFrenchWhy
        : heldLine
          ? heldLine.plainFrenchStatus
          : uItem?.catalystHeadline ??
            'Position équilibrée au cours temps réel vérifié.';

  const valuationTrigger: FocusedAssetSignalTrigger = {
    id: 'valuation',
    label: 'Valorisation intrinsèque',
    metricText:
      fairValueCad !== null && upsidePct !== null && !isCash
        ? `Juste valeur ${formatCad(fairValueCad, 0)} (${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)} %)`
        : `Rendement attendu ${asset.baseExpectedReturnPct.toFixed(1)} %/an`,
    tone:
      upsidePct !== null
        ? upsidePct >= 5
          ? 'positive'
          : upsidePct <= -8
            ? 'negative'
            : 'neutral'
        : 'neutral',
  };

  const technicalTrigger: FocusedAssetSignalTrigger = {
    id: 'technical',
    label: 'Technique & Comité',
    metricText: isCash
      ? 'Capital garanti · Vol. ~0,5 %'
      : `RSI ${rsi14} · MM200 ${smaGapPct >= 0 ? '+' : ''}${smaGapPct.toFixed(0)} % · ${buyVotesOutOf7}/7 IA`,
    tone:
      rsi14 <= 68 && buyVotesOutOf7 >= 5
        ? 'positive'
        : rsi14 >= 75 || buyVotesOutOf7 <= 2
          ? 'negative'
          : 'neutral',
  };

  const portfolioTrigger: FocusedAssetSignalTrigger = {
    id: 'portfolio',
    label: 'Poids & Corrélation',
    metricText: isCoreAsset
      ? `Centre n°1 · ${weightPct.toFixed(1)} % du total`
      : `${weightPct.toFixed(1)} % → ${targetWeightPct.toFixed(1)} % · ρ ${corrWithCore >= 0 ? '+' : ''}${corrWithCore.toFixed(2)}`,
    tone:
      corrWithCore <= 0.25
        ? 'positive'
        : weightPct > targetWeightPct + 5
          ? 'negative'
          : 'neutral',
  };

  const quickBuyAmountCad =
    buyRec && buyRec.deltaCad >= 250 ? Math.round(buyRec.deltaCad) : 2000;
  const quickTrimAmountCad =
    sellRec && Math.abs(sellRec.deltaCad) >= 250
      ? Math.round(Math.abs(sellRec.deltaCad))
      : Math.max(500, Math.min(currentValueCad, Math.round(currentValueCad * 0.25)));

  return {
    assetId,
    ticker: asset.ticker.split('.')[0],
    name: asset.name.split(' (')[0],
    categoryLabel: uItem?.subClassLabel ?? asset.sector ?? 'Actif coté',
    colorHex,
    isHeld,
    isCash,
    isCoreAsset,
    spotPriceCad,
    currentValueCad,
    simulatedStakeCad,
    weightPct,
    targetWeightPct: Number(targetWeightPct.toFixed(1)),
    pnlCad: Math.round(heldLine?.pnlCad ?? 0),
    pnlPct: Number((heldLine?.pnlPct ?? 0).toFixed(1)),
    corrWithCore,
    coreTicker,
    signalAction,
    signalTone,
    signalConvictionPct,
    recommendedDeltaCad,
    quickBuyAmountCad,
    quickTrimAmountCad,
    fairValueCad,
    upsidePct,
    stopLossCad,
    target12mCad,
    rsi14,
    trendRegime,
    smaGapPct: Number(smaGapPct.toFixed(1)),
    buyVotesOutOf7,
    conciseSignalSummary,
    triggers: [valuationTrigger, technicalTrigger, portfolioTrigger],
    monteCarlo,
  };
}

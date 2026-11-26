import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Crosshair,
  MessageSquare,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DynamicMarketAssetRegistration,
  MARKET_REGIMES,
  MacroIndicators,
  RegimeId,
  RiskProfile,
  getAssetById,
} from '../../services/valoria/marketData';
import { PortfolioLot, PortfolioSummary } from '../../services/valoria/engine';
import {
  AnalystTradeRecommendation,
  buildProAnalystAdvisory,
} from '../../services/valoria/proAnalystAdvisor';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import { RawNewsFeedItem } from '../../services/valoria/newsCatalystEngine';
import { LiveAgentTickerOverride } from '../../services/valoria/corporateIntelligenceEngine';
import {
  RawInstitutionalDispatch,
  computeInstitutionalNewsMarketCorrelation,
} from '../../services/valoria/institutionalCurveAndNewsEngine';
import {
  DivergingTradeButterflyChart,
  PriceTargetRangeBar,
  RadarComparisonSvg,
  RadialBeforeAfterGauge,
} from './VisualPrimitives';
import {
  AnimatedMeterBar,
  AnimatedNumber,
} from './MotionPrimitives';
import { D3BenchmarkChart } from './D3BenchmarkChart';
import { MultiAgentSwarmView } from './MultiAgentSwarmView';
import { VisualFutureProjectionsView } from './VisualFutureProjectionsView';
import { GlobalMarketExplorerSection } from './GlobalMarketExplorerSection';
import { AgentConsultationChatView } from './AgentConsultationChatView';
import { AssetTearSheetModal } from './AssetTearSheetModal';
import { D3InflationPurchasingPowerWidget } from './D3InflationPurchasingPowerWidget';
import { D3PriceSparkline30d } from './D3PriceSparkline30d';
import { D3PortfolioOrbitalDonutHub } from './D3PortfolioOrbitalDonutHub';
import { D3PortfolioRadialForceGraph } from './D3PortfolioRadialForceGraph';
import { AssetFocusSidePanel } from './AssetFocusSidePanel';
import { D3DeepAiNewsCausalHub } from './D3DeepAiNewsCausalHub';
import { PortfolioControlHubModal } from './PortfolioControlHubModal';
import { AiTimeMachineProofView } from './AiTimeMachineProofView';
import { ValoriaFinanceAiHubCard } from './ValoriaFinanceAiHubCard';
import {
  suggestOptimalCanadianAccount,
  type ValoriaApplyOrderCandidate,
} from '../../services/valoria/valoriaIntegration';
import {
  type OrbitalLayoutMode,
  buildPortfolioOrbitalGraph,
} from '../../services/valoria/orbitalFocusEngine';
import {
  type LiveGeminiDeepSynthesisPayload,
  type PortfolioSliceId,
  buildDeepAiNewsIntelligenceLab,
  buildPortfolioDonutAllocation,
} from '../../services/valoria/portfolioOrbitalIntelligence';
import { formatCompactEur, formatEur, formatPct, formatSignedEur, formatSignedPct } from '../../services/valoria/valoriaFormatters';
import {
  fetchValoriaDeepIntelligenceLab,
  fetchValoriaDeepResearch,
} from '../../services/valoria/valoriaAiClient';
import { PrivateAmount } from '../ui/PrivateAmount';
import { useFinanceStore } from '../../store/useFinanceStore';

export type WorkspaceTabId =
  | 'portfolio'
  | 'recommendations'
  | 'ai_proof'
  | 'dialogue'
  | 'market'
  | 'intelligence';

interface ProAdvisorUnifiedViewProps {
  activeTab: WorkspaceTabId;
  onSelectTab: (tab: WorkspaceTabId) => void;
  lots: PortfolioLot[];
  portfolioSummary: PortfolioSummary;
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  regimeId: RegimeId;
  riskProfile: RiskProfile;
  watchlistIds: string[];
  availableCashCad: number;
  marketUniverseVersion: number;
  onChangeAvailableCashCad: (val: number) => void;
  onSelectRiskProfile: (profile: RiskProfile) => void;
  onSelectRegime: (id: RegimeId) => void;
  onAddLot: (lot: Omit<PortfolioLot, 'id'>) => void;
  onRemoveAssetHoldings: (assetId: string) => void;
  onExecuteSingleOrder: (assetId: string, deltaCad: number) => void;
  onApplyFullAdvisoryPlan: (
    sells: AnalystTradeRecommendation[],
    buys: AnalystTradeRecommendation[]
  ) => void;
  onResetDemoPortfolio: () => void;
  onClearPortfolio: () => void;
  isControlHubOpen: boolean;
  onOpenControlHub: () => void;
  onCloseControlHub: () => void;
  onAddWatchlistAsset: (assetId: string) => void;
  onRemoveWatchlistAsset: (assetId: string) => void;
  onRegisterCustomOrLiveAsset: (spec: DynamicMarketAssetRegistration) => string;
  isRefreshingVerified?: boolean;
  verifiedFeedStatus?: string | null;
  onRefreshVerifiedPrices?: () => void;
  focusedAssetId?: string | null;
  onChangeFocusedAssetId?: (assetId: string | null) => void;
  externalInspectedAssetId?: string | null;
  onClearExternalInspectedAsset?: () => void;
  onRequestApplyRealOrder?: (order: ValoriaApplyOrderCandidate) => void;
  geminiApiKey?: string;
}

const RISK_LABEL_MAP: Record<RiskProfile, string> = {
  prudent: 'Prudent',
  equilibre: 'Équilibré',
  dynamique: 'Dynamique',
  offensif: 'Offensif',
};

function plainBeginnerReason(
  rec: AnalystTradeRecommendation,
  isPrivacyMode: boolean
): string {
  if (rec.side === 'SELL') {
    if (rec.dcfIntrinsicCad && rec.spotPriceCad > rec.dcfIntrinsicCad * 1.06) {
      const overPct = Math.round(
        ((rec.spotPriceCad - rec.dcfIntrinsicCad) / rec.dcfIntrinsicCad) * 100
      );
      return `Surévalué (+${overPct} % vs vraie valeur)`;
    }
    if (rec.currentWeightPct > rec.targetWeightPct + 8) {
      return isPrivacyMode
        ? 'Poids excessif (•••)'
        : `Poids excessif (${rec.currentWeightPct.toFixed(0)} % → ${rec.targetWeightPct.toFixed(0)} %)`;
    }
    return `Élan fragile — sécuriser les gains`;
  }

  if (rec.dcfIntrinsicCad && rec.dcfIntrinsicCad > rec.spotPriceCad * 1.06) {
    const upPct = Math.round(
      ((rec.dcfIntrinsicCad - rec.spotPriceCad) / rec.spotPriceCad) * 100
    );
    return `Décote +${upPct} % vers sa vraie valeur`;
  }
  // NOMBRE-NON-MONETAIRE : score quantitatif d'actif public
  return `Fondamentaux solides (${rec.quantScore}/100)`;
}

export const ProAdvisorUnifiedView: React.FC<ProAdvisorUnifiedViewProps> = ({
  activeTab,
  onSelectTab,
  lots,
  portfolioSummary,
  livePrices,
  macro,
  regimeId,
  riskProfile,
  watchlistIds,
  availableCashCad,
  marketUniverseVersion,
  onChangeAvailableCashCad,
  onSelectRiskProfile,
  onSelectRegime,
  onAddLot,
  onRemoveAssetHoldings,
  onExecuteSingleOrder,
  onApplyFullAdvisoryPlan,
  onResetDemoPortfolio,
  onClearPortfolio,
  isControlHubOpen,
  onOpenControlHub,
  onCloseControlHub,
  onAddWatchlistAsset,
  onRemoveWatchlistAsset,
  onRegisterCustomOrLiveAsset,
  isRefreshingVerified = false,
  verifiedFeedStatus = null,
  onRefreshVerifiedPrices,
  focusedAssetId: controlledFocusedAssetId,
  onChangeFocusedAssetId,
  externalInspectedAssetId,
  onClearExternalInspectedAsset,
  onRequestApplyRealOrder,
  geminiApiKey = '',
}) => {
  const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
  const [executionNotice, setExecutionNotice] = useState<string | null>(null);
  const [inspectedAssetId, setInspectedAssetId] = useState<string | null>(null);
  const [internalFocusedAssetId, setInternalFocusedAssetId] = useState<
    string | null
  >(null);
  const [orbitalLayoutMode, setOrbitalLayoutMode] =
    useState<OrbitalLayoutMode>('radial');
  const [portfolioStageView, setPortfolioStageView] = useState<
    'orbit' | 'allocation' | 'history'
  >('orbit');
  const [showRecCharts, setShowRecCharts] = useState<boolean>(false);
  const [expandedCotKey, setExpandedCotKey] = useState<string | null>(null);
  const [chatFocusAssetId, setChatFocusAssetId] = useState<string | null>(null);
  const [selectedDonutSliceId, setSelectedDonutSliceId] =
    useState<PortfolioSliceId | null>(null);

  const focusedAssetId =
    controlledFocusedAssetId !== undefined
      ? controlledFocusedAssetId
      : internalFocusedAssetId;
  const setFocusedAssetId = useCallback(
    (nextId: string | null) => {
      if (onChangeFocusedAssetId) {
        onChangeFocusedAssetId(nextId);
      } else {
        setInternalFocusedAssetId(nextId);
      }
    },
    [onChangeFocusedAssetId]
  );
  const [intelSubView, setIntelSubView] = useState<
    'causal_ia' | 'inflation' | 'agents' | 'future'
  >('causal_ia');
  const [liveDeepSynthesis, setLiveDeepSynthesis] =
    useState<LiveGeminiDeepSynthesisPayload | null>(null);
  const [isRunningDeepSynthesis, setIsRunningDeepSynthesis] =
    useState<boolean>(false);

  const [liveArticles, setLiveArticles] = useState<RawNewsFeedItem[]>([]);
  const [liveInstitutionalDispatches, setLiveInstitutionalDispatches] = useState<
    RawInstitutionalDispatch[]
  >([]);
  const [liveSourcesVerified, setLiveSourcesVerified] = useState<string[]>([]);
  const [isFetchingLiveInstitutional, setIsFetchingLiveInstitutional] =
    useState<boolean>(false);
  const [liveAgentOverrides, setLiveAgentOverrides] = useState<
    Record<string, LiveAgentTickerOverride>
  >({});
  const [isRunningSwarm, setIsRunningSwarm] = useState<boolean>(false);
  const [lastSwarmMode, setLastSwarmMode] = useState<
    'idle' | 'gemini_live_swarm' | 'live_market_quant'
  >('idle');
  const [lastSwarmElapsedMs, setLastSwarmElapsedMs] = useState<number | null>(
    null
  );
  const [groundingSources, setGroundingSources] = useState<
    Array<{ uri: string; title: string }>
  >([]);
  const [swarmNotice, setSwarmNotice] = useState<string | null>(null);

  const currentRegimeName =
    MARKET_REGIMES.find((r) => r.id === regimeId)?.name ??
    'Désinflation & Croissance';

  const targetTickerList = useMemo(() => {
    void marketUniverseVersion;
    const heldTickers = Array.from(
      new Set(
        lots
          .map((l) => getAssetById(l.assetId)?.ticker)
          .filter((t): t is string => Boolean(t))
      )
    );
    const watchTickers = watchlistIds
      .map((id) => getAssetById(id)?.ticker)
      .filter((t): t is string => Boolean(t));
    return Array.from(
      new Set([...heldTickers, ...watchTickers, 'ADP', 'INTC', 'GOOGL', 'RY.TO', 'LLY'])
    ).slice(0, 10);
  }, [lots, watchlistIds, marketUniverseVersion]);

  const fetchLiveInstitutionalSources = useCallback(async () => {
    if (targetTickerList.length === 0) return;
    setIsFetchingLiveInstitutional(true);
    try {
      const resp = await fetch(
        `/api/news/institutional-correlated?tickers=${encodeURIComponent(
          targetTickerList.join(',')
        )}`
      );
      if (resp.ok) {
        const data = (await resp.json()) as {
          ok?: boolean;
          sourcesVerified?: string[];
          dispatches?: RawInstitutionalDispatch[];
        };
        if (data.ok && Array.isArray(data.dispatches)) {
          setLiveInstitutionalDispatches(data.dispatches);
          if (Array.isArray(data.sourcesVerified)) {
            setLiveSourcesVerified(data.sourcesVerified);
          }
        }
      }
    } catch {
      // Curated SEC EDGAR / SEDAR+ / BoC baseline remains active
    } finally {
      setIsFetchingLiveInstitutional(false);
    }
  }, [targetTickerList]);

  const fetchLiveMarketNews = useCallback(async () => {
    if (targetTickerList.length === 0) return;
    try {
      const resp = await fetch(
        `/api/news/intelligence?tickers=${encodeURIComponent(
          targetTickerList.join(',')
        )}`
      );
      if (resp.ok) {
        const payload = (await resp.json()) as {
          ok?: boolean;
          articles?: RawNewsFeedItem[];
        };
        if (payload.ok && Array.isArray(payload.articles)) {
          setLiveArticles(payload.articles);
        }
      }
    } catch {
      // Deterministic curated intelligence remains active offline
    }
  }, [targetTickerList]);

  useEffect(() => {
    fetchLiveMarketNews();
    fetchLiveInstitutionalSources();
  }, [fetchLiveMarketNews, fetchLiveInstitutionalSources]);

  const handleRunLiveAgentSwarm = useCallback(
    async (focusTicker?: string) => {
      if (isRunningSwarm) return;
      setIsRunningSwarm(true);
      setSwarmNotice(null);
      try {
        const data = await fetchValoriaDeepResearch(geminiApiKey, {
          tickers: targetTickerList.slice(0, 8),
          focusTicker:
            typeof focusTicker === 'string' && focusTicker.trim().length > 0
              ? focusTicker.trim()
              : undefined,
          regimeName: currentRegimeName,
          riskProfile,
        });
        if (data.ok) {
          if (Array.isArray(data.liveArticles) && data.liveArticles.length > 0) {
            setLiveArticles(data.liveArticles);
          }
          if (data.overrides && Object.keys(data.overrides).length > 0) {
            setLiveAgentOverrides((prev) => ({
              ...prev,
              ...(data.overrides as Record<string, LiveAgentTickerOverride>),
            }));
          }
          if (Array.isArray(data.groundingSources)) {
            setGroundingSources(data.groundingSources);
          }
          setLastSwarmMode(data.mode ?? 'live_market_quant');
          setLastSwarmElapsedMs(data.elapsedMs ?? null);
          setSwarmNotice(
            data.geminiNotice ??
              `${data.scannedTickersCount ?? targetTickerList.length} actifs scannés`
          );
        }
      } catch {
        setLastSwarmMode('live_market_quant');
        setSwarmNotice('Analyse actualisée');
      } finally {
        setIsRunningSwarm(false);
      }
    },
    [geminiApiKey, isRunningSwarm, targetTickerList, currentRegimeName, riskProfile]
  );

  const fullUniverse = useMemo(
    () => {
      void marketUniverseVersion;
      return analyzeFullMarketUniverse({
        livePrices,
        macro,
        riskProfile,
        evaluatedLots: portfolioSummary.lots,
        totalPortfolioValue: portfolioSummary.totalCurrentValue,
      });
    },
    [
      livePrices,
      macro,
      riskProfile,
      portfolioSummary.lots,
      portfolioSummary.totalCurrentValue,
      marketUniverseVersion,
    ]
  );

  const advisory = useMemo(
    () => {
      void marketUniverseVersion;
      return buildProAnalystAdvisory({
        lots,
        livePrices,
        macro,
        riskProfile,
        availableCashCad,
        watchlistIds,
        liveArticles,
        liveAgentOverrides,
      });
    },
    [
      lots,
      livePrices,
      macro,
      riskProfile,
      availableCashCad,
      watchlistIds,
      liveArticles,
      liveAgentOverrides,
      marketUniverseVersion,
    ]
  );

  const institutionalNews = useMemo(
    () =>
      computeInstitutionalNewsMarketCorrelation({
        universe: fullUniverse,
        livePrices,
        heldAssetIds: advisory.heldLines.map((h) => h.assetId),
        watchlistIds,
        liveDispatches: liveInstitutionalDispatches,
      }),
    [
      fullUniverse,
      livePrices,
      advisory.heldLines,
      watchlistIds,
      liveInstitutionalDispatches,
    ]
  );

  const handleExecuteAll = () => {
    onApplyFullAdvisoryPlan(
      advisory.sellRecommendations,
      advisory.buyRecommendations
    );
    setExecutionNotice(
      `Conseils appliqués : ${advisory.sellRecommendations.length} vente(s) · ${advisory.buyRecommendations.length} achat(s) ($ CAD)`
    );
  };

  const resolvedInspectedAssetId = useMemo(() => {
    if (!inspectedAssetId) return null;
    if (fullUniverse.byId.has(inspectedAssetId)) return inspectedAssetId;
    const upper = inspectedAssetId.trim().toUpperCase();
    const matched = fullUniverse.allAnalyses.find(
      (item) =>
        item.asset.id.toUpperCase() === upper ||
        item.asset.ticker.toUpperCase() === upper ||
        item.asset.ticker.split('.')[0].toUpperCase() === upper
    );
    return matched ? matched.asset.id : inspectedAssetId;
  }, [inspectedAssetId, fullUniverse]);

  useEffect(() => {
    if (externalInspectedAssetId) {
      setInspectedAssetId(externalInspectedAssetId);
    }
  }, [externalInspectedAssetId]);

  const inspectedAnalysis = resolvedInspectedAssetId
    ? fullUniverse.byId.get(resolvedInspectedAssetId) ?? null
    : null;
  const inspectedNews = resolvedInspectedAssetId
    ? advisory.newsIntelligence.byAssetId.get(resolvedInspectedAssetId) ?? null
    : null;
  const inspectedCorporateIntel = resolvedInspectedAssetId
    ? advisory.multiAgent.byAssetId.get(resolvedInspectedAssetId) ?? null
    : null;
  const inspectedInstitutionalProfile = resolvedInspectedAssetId
    ? institutionalNews.byAssetId.get(resolvedInspectedAssetId) ?? null
    : null;

  const jumpMc = advisory.institutionalQuant.jumpMonteCarlo;
  const healthGainPts = advisory.healthScoreAfter100 - advisory.healthScoreBefore100;
  const tradesCount =
    advisory.sellRecommendations.length + advisory.buyRecommendations.length;

  const miniConePaths = useMemo(() => {
    const forecast = advisory.multiAgent.futureConeSeries.filter(
      (p) => p.afterP50Cad !== null
    );
    if (forecast.length < 2) return null;
    const vals = forecast.flatMap((p) => [
      p.afterP5Cad ?? 0,
      p.afterP95Cad ?? 0,
      p.beforeP50Cad ?? 0,
    ]);
    const minV = Math.min(...vals) * 0.95;
    const maxV = Math.max(...vals) * 1.04;
    const span = Math.max(1, maxV - minV);
    const w = 128;
    const h = 42;
    const toX = (i: number) => (i / (forecast.length - 1)) * w;
    const toY = (v: number) => h - ((v - minV) / span) * (h - 6) - 3;

    const topPts = forecast.map(
      (p, i) => `${toX(i).toFixed(1)},${toY(p.afterP95Cad ?? 0).toFixed(1)}`
    );
    const botPts = [...forecast]
      .reverse()
      .map((p, idx) => {
        const i = forecast.length - 1 - idx;
        return `${toX(i).toFixed(1)},${toY(p.afterP5Cad ?? 0).toFixed(1)}`;
      });

    return {
      fanPolygon: [...topPts, ...botPts].join(' '),
      afterLine: forecast
        .map((p, i) => `${toX(i).toFixed(1)},${toY(p.afterP50Cad ?? 0).toFixed(1)}`)
        .join(' '),
      beforeLine: forecast
        .map((p, i) => `${toX(i).toFixed(1)},${toY(p.beforeP50Cad ?? 0).toFixed(1)}`)
        .join(' '),
    };
  }, [advisory.multiAgent.futureConeSeries]);

  const donutSummary = useMemo(
    () =>
      buildPortfolioDonutAllocation({
        advisory,
        institutionalNews,
        availableCashCad,
      }),
    [advisory, institutionalNews, availableCashCad]
  );

  const deepAiNewsLab = useMemo(
    () =>
      buildDeepAiNewsIntelligenceLab({
        advisory,
        institutionalNews,
        universe: fullUniverse,
        macro,
        donutSummary,
      }),
    [advisory, institutionalNews, fullUniverse, macro, donutSummary]
  );

  const orbitalGraph = useMemo(
    () =>
      buildPortfolioOrbitalGraph({
        advisory,
        universe: fullUniverse,
        availableCashCad,
        layoutMode: orbitalLayoutMode,
      }),
    [advisory, fullUniverse, availableCashCad, orbitalLayoutMode]
  );

  const handleRunDeepAiSynthesis = useCallback(async () => {
    if (isRunningDeepSynthesis) return;
    setIsRunningDeepSynthesis(true);
    try {
      const focusSlice = selectedDonutSliceId
        ? donutSummary.slices.find((s) => s.id === selectedDonutSliceId)
        : null;
      const data = await fetchValoriaDeepIntelligenceLab(geminiApiKey, {
        tickers: focusSlice?.tickers?.length
          ? focusSlice.tickers.slice(0, 6)
          : targetTickerList.slice(0, 7),
        focusSliceLabel: focusSlice?.label,
        portfolioTotalCad: donutSummary.totalValueCad,
        macroSummary: deepAiNewsLab.macroRegimeSummary,
        localThesis: deepAiNewsLab.executiveAiThesis,
      });
      if (data.ok && data.synthesis) {
        setLiveDeepSynthesis({
          generatedAt: data.synthesis.generatedAt,
          sourceMode:
            data.synthesis.sourceMode === 'gemini_search_grounded'
              ? 'gemini_search_grounded'
              : 'quant_causal_engine',
          executiveThesis: data.synthesis.executiveThesis,
          macroRegimeReading: data.synthesis.macroRegimeReading,
          topBlindSpotRisk: data.synthesis.topBlindSpotRisk,
          topContrarianOpportunity: data.synthesis.topContrarianOpportunity,
          webSources: data.synthesis.webSources,
        });
      }
    } catch {
      // Deterministic + RSS/SEC causal intelligence remains active
    } finally {
      setIsRunningDeepSynthesis(false);
    }
  }, [
    geminiApiKey,
    isRunningDeepSynthesis,
    selectedDonutSliceId,
    donutSummary,
    targetTickerList,
    deepAiNewsLab.macroRegimeSummary,
    deepAiNewsLab.executiveAiThesis,
  ]);

  const openAssetInDialogue = useCallback(
    (assetId: string) => {
      setChatFocusAssetId(assetId);
      onSelectTab('dialogue');
    },
    [onSelectTab]
  );

  const openDeepAiNewsLabFromPortfolio = useCallback(
    (focusSliceId: PortfolioSliceId | null) => {
      setSelectedDonutSliceId(focusSliceId);
      setIntelSubView('causal_ia');
      onSelectTab('intelligence');
    },
    [onSelectTab]
  );

  const renderRecommendationCotCard = (rec: AnalystTradeRecommendation) => {
    const isSell = rec.side === 'SELL';
    const isNewUnownedPosition = !isSell && rec.currentValueCad < 25;
    const cotKey = `${rec.side}-${rec.assetId}`;
    const isCotExpanded = expandedCotKey === cotKey;
    const cot = rec.chainOfThought;

    return (
      <div
        key={`ruler-${cotKey}`}
        className="py-4 first:pt-1 last:pb-1 space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums text-xs min-w-0">
          <button
            type="button"
            onClick={() => setInspectedAssetId(rec.assetId)}
            className="min-h-11 font-bold text-texte hover:underline text-left min-w-0 flex-1 basis-[170px] truncate cursor-pointer"
          >
            <span className={isSell ? 'text-erreur-texte' : 'text-succes-texte'}>
              {isSell ? '▼' : '▲'}
            </span>{' '}
            {rec.ticker}
            <span className="font-sans font-normal text-texte-doux ml-1.5">
              ·{' '}
              {isSell ? (
                <>
                  Détenu <PrivateAmount>{formatCompactEur(rec.currentValueCad)}</PrivateAmount>
                </>
              ) : isNewUnownedPosition ? (
                'Nouveau titre'
              ) : (
                <>
                  Renforcer (<PrivateAmount>{formatCompactEur(rec.currentValueCad)}</PrivateAmount>)
                </>
              )}
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-2 max-w-full shrink-0">
            <span className="hidden sm:inline-flex">
              <D3PriceSparkline30d
                assetId={rec.assetId}
                spotPriceCad={rec.spotPriceCad}
                width={58}
                height={20}
              />
            </span>
            <button
              type="button"
              onClick={() => {
                onExecuteSingleOrder(rec.assetId, rec.deltaCad);
                setExecutionNotice(
                  `Ordre exécuté : ${rec.ticker} (${formatSignedEur(rec.deltaCad, 0)})`
                );
              }}
              className={`min-h-11 px-3 py-1.5 text-[11px] font-mono tabular-nums font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                isSell
                  ? 'text-erreur-texte bg-erreur-fond hover:bg-erreur-fond border-erreur-texte/40'
                  : 'text-succes-texte bg-succes-fond hover:bg-succes-fond border-succes-texte/40'
              }`}
            >
              {isSell
                ? `Vendre ${formatEur(Math.abs(rec.deltaCad), 0)}`
                : `Acheter +${formatEur(rec.deltaCad, 0)}`}
            </button>
            {onRequestApplyRealOrder && (
              <button
                type="button"
                onClick={() =>
                  onRequestApplyRealOrder({
                    symbol: rec.ticker,
                    name: rec.name,
                    deltaCad: rec.deltaCad,
                    spotPriceCad: rec.spotPriceCad,
                    suggestedAccount: suggestOptimalCanadianAccount(rec.ticker),
                  })
                }
                className="min-h-11 px-3 py-1.5 text-[11px] font-medium rounded-lg border border-bordure-champ bg-fond hover:bg-surface-douce text-texte transition-colors whitespace-nowrap shrink-0 focus-ring cursor-pointer"
              >
                Appliquer au réel
              </button>
            )}
          </div>
        </div>

        <div
          onClick={() => setInspectedAssetId(rec.assetId)}
          className="cursor-pointer"
        >
          <PriceTargetRangeBar
            spotCad={rec.spotPriceCad}
            fairCad={rec.dcfIntrinsicCad}
            stopCad={rec.stopLossCad}
            targetCad={rec.target12mCad}
          />
        </div>

        {/* Minimal 5-Segment Visual Verification Bar + 1-Line Summary */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-5 gap-1.5">
            {cot.steps.map((step) => {
              const barColor =
                step.status === 'pass'
                  ? isSell
                    ? 'bg-erreur-texte'
                    : 'bg-accent'
                  : step.status === 'caution'
                    ? 'bg-bordure-champ'
                    : 'bg-erreur-texte';
              return (
                <div
                  key={step.id}
                  title={`${step.stepNumber}. ${step.shortLabel} : ${step.metricBadge}`}
                  className={`h-1 rounded-full ${barColor}`}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-texte-doux truncate">
              {plainBeginnerReason(rec, isPrivacyMode)}
            </span>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                aria-expanded={isCotExpanded}
                onClick={() =>
                  setExpandedCotKey((prev) => (prev === cotKey ? null : cotKey))
                }
                className="min-h-11 min-w-11 inline-flex items-center gap-1 font-mono text-[11px] text-texte-doux hover:text-texte whitespace-nowrap cursor-pointer"
              >
                <span>{cot.passedStepsCount}/5</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform duration-150 ${
                    isCotExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => openAssetInDialogue(rec.assetId)}
                className="min-h-11 text-[11px] text-texte-doux hover:text-texte underline whitespace-nowrap cursor-pointer"
              >
                Discuter IA
              </button>
            </div>
          </div>

          {isCotExpanded && (
            <div className="pt-2 border-t border-bordure divide-y divide-bordure text-[11px]">
              {cot.steps.map((step) => (
                <div key={step.id} className="py-1.5 flex items-center justify-between gap-2">
                  <span className="text-texte truncate">
                    {step.stepNumber}. {step.shortLabel} — {step.deduction}
                  </span>
                  <span className="font-mono text-texte-doux shrink-0">
                    {step.metricBadge}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 sm:space-y-10">
      {/* Compact 1-Line Mobile Context Bar on Secondary Tabs (Discuter IA, Marché, Agents & Futur) */}
      {activeTab !== 'portfolio' && activeTab !== 'recommendations' && (
        <div className="sm:hidden flex items-center justify-between gap-2 pb-3 border-b border-bordure text-xs font-mono tabular-nums">
          <div className="min-w-0 truncate">
            <span className="font-sans text-texte-doux">Portefeuille : </span>
            <PrivateAmount className="font-bold text-texte">
              {formatEur(portfolioSummary.totalCurrentValue, 0)}
            </PrivateAmount>{' '}
            <PrivateAmount
              className={
                portfolioSummary.totalGainLossEuro >= 0
                  ? 'text-succes-texte'
                  : 'text-erreur-texte'
              }
            >
              ({formatSignedPct(portfolioSummary.totalGainLossPct, 1)})
            </PrivateAmount>
          </div>
          <button
            type="button"
            onClick={() => onSelectTab('recommendations')}
            className="min-w-11 min-h-11 px-2.5 py-1 rounded-lg bg-surface border border-bordure text-texte font-sans font-medium text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {tradesCount} conseils →
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SYNTHÈSE COMPACTE NATIVE (UNIQUEMENT PORTEFEUILLE & RECOMMANDÉS)      */}
      {/* ===================================================================== */}
      <section
        aria-label="Synthèse quantitative du portefeuille"
        className={`${
          activeTab !== 'portfolio' && activeTab !== 'recommendations'
            ? 'hidden'
            : 'grid'
        } ${
          focusedAssetId
            ? 'opacity-20 saturate-50 pointer-events-none'
            : 'opacity-100'
        } bg-surface border border-bordure rounded-2xl p-4 sm:p-5 grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-end transition-all duration-300`}
      >
        {/* Left: Strictly What You Currently Own */}
        <div className="lg:col-span-7 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-texte-doux">
            <span className="font-medium text-texte">Ce que j’ai</span>
            <span aria-hidden="true" className="text-texte-doux">·</span>
            <span>{advisory.heldLines.length} positions</span>
            <span aria-hidden="true" className="text-texte-doux">·</span>
            <button
              type="button"
              onClick={onOpenControlHub}
              className="min-w-11 min-h-11 px-2 py-1 text-texte-doux hover:text-texte underline decoration-bordure-champ hover:decoration-accent underline-offset-4 transition-colors cursor-pointer"
            >
              Profil {RISK_LABEL_MAP[riskProfile]}
            </button>
            <span aria-hidden="true" className="text-texte-doux">·</span>
            <span className="font-mono tabular-nums text-texte-doux">
              Investi{' '}
              <PrivateAmount className="text-texte font-medium">
                {formatEur(portfolioSummary.totalInvested, 0)}
              </PrivateAmount>
            </span>
            <span aria-hidden="true" className="text-texte-doux">·</span>
            <span className="font-mono tabular-nums text-texte-doux">
              Liquidités{' '}
              <PrivateAmount className="text-texte font-medium">
                {formatEur(availableCashCad, 0)}
              </PrivateAmount>
            </span>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <div className="text-2xl sm:text-3xl leading-none font-semibold tracking-tight text-texte font-mono tabular-nums">
              <PrivateAmount>
                <AnimatedNumber
                  value={portfolioSummary.totalCurrentValue}
                  formatter={(n) => formatEur(n, 0)}
                />
              </PrivateAmount>
            </div>
            <PrivateAmount
              className={`text-xs sm:text-sm font-mono tabular-nums font-medium ${
                portfolioSummary.totalGainLossEuro >= 0
                  ? 'text-succes-texte'
                  : 'text-erreur-texte'
              }`}
            >
              {portfolioSummary.totalGainLossEuro >= 0 ? '▲ ' : '▼ '}
              {formatSignedEur(portfolioSummary.totalGainLossEuro, 0)} (
              {formatSignedPct(portfolioSummary.totalGainLossPct, 1)})
            </PrivateAmount>
          </div>
        </div>

        {/* Right: Quiet Counterfactual Potential & 1 Focused Action */}
        <div className="lg:col-span-5 pt-3.5 border-t border-bordure lg:pt-0 lg:border-t-0 lg:border-l lg:border-bordure lg:pl-7 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="space-y-1">
            <div className="text-xs text-texte-doux">
              <span className="text-texte font-medium">
                Potentiel 2031
              </span>
              <span aria-hidden="true" className="text-texte-doux"> · </span>
              <PrivateAmount className="font-mono tabular-nums text-texte-doux">
                Santé {advisory.healthScoreBefore100} →{' '}
                <strong className="text-succes-texte font-semibold">
                  {advisory.healthScoreAfter100}/100
                </strong>
              </PrivateAmount>
            </div>

            <div className="flex items-baseline gap-2.5 font-mono tabular-nums">
              <PrivateAmount className="text-lg sm:text-xl font-semibold text-texte">
                {formatEur(jumpMc.after.p50Median5yCad, 0)}
              </PrivateAmount>
              <PrivateAmount className="text-xs font-medium text-succes-texte">
                ▲ {formatSignedEur(jumpMc.median5yGainDeltaCad, 0)}
              </PrivateAmount>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
            {activeTab !== 'recommendations' ? (
              <button
                type="button"
                onClick={() => onSelectTab('recommendations')}
                className="w-full sm:w-auto min-h-11 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl transition-colors whitespace-nowrap cursor-pointer"
              >
                <span>Voir les {tradesCount} conseils</span>
                <ArrowRight className="w-3.5 h-3.5 text-succes-texte" />
              </button>
            ) : (
              tradesCount > 0 && (
                <button
                  type="button"
                  onClick={handleExecuteAll}
                  className="w-full sm:w-auto min-h-11 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Tout appliquer ({tradesCount})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )
            )}
          </div>
        </div>
      </section>

      {executionNotice && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          className="px-4 py-2.5 bg-succes-fond border border-succes-texte/40 rounded-xl flex items-center gap-2 text-xs font-mono text-succes-texte"
        >
          <Check className="w-4 h-4 text-succes-texte shrink-0" />
          <span>{executionNotice}</span>
        </motion.div>
      )}

      {/* ===================================================================== */}
      {/* ANIMATED WORKSPACE CONTENT (ONE DOMINANT ANCHOR PER VIEWPORT)         */}
      {/* ===================================================================== */}
      <div>
        {/* TAB 1: STRICTLY WHAT THE USER OWNS ("CE QUE J'AI") */}
        {activeTab === 'portfolio' && (
          <motion.div
            key="tab-portfolio"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-8 sm:space-y-10"
          >
            {advisory.heldLines.length === 0 && availableCashCad <= 0 ? (
              <section className="bg-surface/25 border border-bordure rounded-2xl p-10 text-center space-y-4">
                <h2 className="text-base font-semibold text-texte">
                  Aucune position dans votre portefeuille ($ CAD)
                </h2>
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={onOpenControlHub}
                    className="min-h-11 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl cursor-pointer"
                  >
                    Ajouter ou importer mes positions
                  </button>
                  <button
                    type="button"
                    onClick={onResetDemoPortfolio}
                    className="min-h-11 px-4 py-2 text-xs font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure rounded-xl cursor-pointer"
                  >
                    Charger l’exemple
                  </button>
                </div>
              </section>
            ) : (
              <>
                {/* Sleek Perspective Selector: One Visual Anchor at a Time */}
                <div
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all duration-300 ${
                    focusedAssetId
                      ? 'opacity-20 saturate-50 pointer-events-none'
                      : 'opacity-100'
                  }`}
                >
                  <div
                    role="group"
                    aria-label="Vue de mon portefeuille"
                    className="inline-flex items-center gap-1 p-1 bg-surface/60 border border-bordure rounded-xl overflow-x-auto no-scrollbar max-w-full"
                  >
                    {(
                      [
                        { id: 'orbit', label: 'Orbite & Gravité' },
                        { id: 'allocation', label: 'Répartition & Risque' },
                        { id: 'history', label: 'Performance vs Indice' },
                      ] as const
                    ).map((view) => {
                      const isCurrent = portfolioStageView === view.id;
                      return (
                        <button
                          key={view.id}
                          type="button"
                          aria-pressed={isCurrent}
                          onClick={() => setPortfolioStageView(view.id)}
                          className={`relative min-h-11 px-3 sm:px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            isCurrent
                              ? 'text-sur-accent font-semibold'
                              : 'text-texte-doux hover:text-texte'
                          }`}
                        >
                          {isCurrent && (
                            <motion.span
                              layoutId="portfolio-stage-pill"
                              transition={{
                                type: 'spring',
                                stiffness: 420,
                                damping: 34,
                              }}
                              className="absolute inset-0 bg-accent rounded-lg"
                            />
                          )}
                          <span className="relative z-10">{view.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={onOpenControlHub}
                    className="min-w-11 self-start sm:self-auto min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-texte-doux hover:text-texte transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Modifier mes positions ou liquidités</span>
                  </button>
                </div>

                {/* Single Dominant Central Visualization Stage */}
                <div>
                  {portfolioStageView === 'orbit' && (
                    <motion.div
                      key="stage-orbit"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <D3PortfolioRadialForceGraph
                        graph={orbitalGraph}
                        layoutMode={orbitalLayoutMode}
                        onChangeLayoutMode={setOrbitalLayoutMode}
                        focusedAssetId={focusedAssetId}
                        onSelectFocusAsset={setFocusedAssetId}
                        onExecuteOrbitalAdjustment={(assetId, deltaCad) => {
                          onExecuteSingleOrder(assetId, deltaCad);
                          setExecutionNotice(
                            `Ajustement orbital exécuté : ${assetId} (${formatSignedEur(deltaCad, 0)})`
                          );
                        }}
                        onAdjustAvailableCash={onChangeAvailableCashCad}
                      />
                    </motion.div>
                  )}

                  {portfolioStageView === 'allocation' && (
                    <motion.div
                      key="stage-allocation"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className={`transition-all duration-300 ${
                        focusedAssetId
                          ? 'opacity-20 saturate-50 pointer-events-none'
                          : 'opacity-100'
                      }`}
                    >
                      <D3PortfolioOrbitalDonutHub
                        donutSummary={donutSummary}
                        heldLines={advisory.heldLines}
                        selectedSliceId={selectedDonutSliceId}
                        onSelectSliceId={setSelectedDonutSliceId}
                        focusedAssetId={focusedAssetId}
                        onFocusAsset={(id) => setFocusedAssetId(id)}
                        onInspectAsset={(id) => setInspectedAssetId(id)}
                        onOpenAssetInDialogue={openAssetInDialogue}
                        onOpenControlHub={onOpenControlHub}
                        onOpenDeepAiNewsLab={openDeepAiNewsLabFromPortfolio}
                      />
                    </motion.div>
                  )}

                  {portfolioStageView === 'history' && (
                    <motion.div
                      key="stage-history"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className={`transition-all duration-300 ${
                        focusedAssetId
                          ? 'opacity-20 saturate-50 pointer-events-none'
                          : 'opacity-100'
                      }`}
                    >
                      <D3BenchmarkChart lots={lots} livePrices={livePrices} />
                    </motion.div>
                  )}
                </div>

                {/* Serene Unboxed Holdings Ledger (shown under Orbit & History; Allocation has its own filtered list) */}
                {portfolioStageView !== 'allocation' && (
                  <section
                    aria-label="Positions détenues en dollars canadiens"
                    className={`space-y-3 pt-1 transition-all duration-300 ${
                      focusedAssetId
                        ? 'opacity-20 saturate-50 pointer-events-none'
                        : 'opacity-100'
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="text-sm font-medium text-texte">
                        Positions détenues ({advisory.heldLines.length})
                      </h2>
                      <span className="text-xs font-mono tabular-nums text-texte-doux">
                        Liquidités disponibles :{' '}
                        <PrivateAmount className="text-texte font-medium">
                          {formatEur(availableCashCad, 0)}
                        </PrivateAmount>
                      </span>
                    </div>

                    <div className="border-y border-bordure divide-y divide-bordure">
                      {advisory.heldLines.map((h) => {
                        const isAlert =
                          h.verdict === 'VENDRE' || h.verdict === 'ALLÉGER';
                        const isFocusedRow = focusedAssetId === h.assetId;
                        return (
                          <div
                            key={`ledger-${h.assetId}`}
                            className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-surface/20 transition-colors px-1"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <button
                                type="button"
                                onClick={() => setInspectedAssetId(h.assetId)}
                                className="min-h-11 text-left min-w-0 cursor-pointer group"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-semibold text-sm text-texte group-hover:text-texte">
                                    {h.ticker}
                                  </span>
                                  <span className="text-xs text-texte-doux truncate max-w-[180px] sm:max-w-[240px]">
                                    {h.name.split(' (')[0]}
                                  </span>
                                </div>
                                <div className="text-[11px] font-mono tabular-nums text-texte-doux mt-0.5">
                                  <PrivateAmount>{h.weightPct.toFixed(1)} %</PrivateAmount> · {h.optimalCanadianWrapper} ·{' '}
                                  <span
                                    className={
                                      isAlert
                                        ? 'text-erreur-texte'
                                        : 'text-succes-texte'
                                    }
                                  >
                                    {h.verdict}
                                  </span>
                                </div>
                              </button>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-5 shrink-0">
                              <div className="hidden md:block">
                                <D3PriceSparkline30d
                                  assetId={h.assetId}
                                  spotPriceCad={h.spotPriceCad}
                                  width={68}
                                  height={22}
                                />
                              </div>

                              <div className="text-left sm:text-right font-mono tabular-nums">
                                <div className="text-sm font-semibold text-texte">
                                  <PrivateAmount>{formatEur(h.currentValueCad, 0)}</PrivateAmount>
                                </div>
                                <div
                                  className={`text-[11px] ${
                                    h.pnlPct >= 0
                                      ? 'text-succes-texte'
                                      : 'text-erreur-texte'
                                  }`}
                                >
                                  <PrivateAmount>{formatSignedPct(h.pnlPct, 1)}</PrivateAmount>
                                </div>
                              </div>

                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setFocusedAssetId(h.assetId)}
                                  aria-label={`Activer le mode Focus sur ${h.ticker}`}
                                  className={`min-w-11 min-h-11 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer border ${
                                    isFocusedRow
                                      ? 'bg-accent text-sur-accent border-succes-texte font-semibold'
                                      : 'bg-surface/60 hover:bg-surface-douce text-texte border-bordure'
                                  }`}
                                >
                                  <Crosshair className="w-3 h-3" />
                                  <span>Focus</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openAssetInDialogue(h.assetId)}
                                  aria-label={`Discuter de ${h.ticker} avec les 7 agents`}
                                  className="min-w-11 min-h-11 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-texte-doux hover:text-texte bg-surface/40 hover:bg-surface-douce/80 border border-bordure transition-colors whitespace-nowrap cursor-pointer"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  <span className="hidden sm:inline">Avis IA</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                <ValoriaFinanceAiHubCard
                  valoria5yMedianCad={jumpMc.after.p50Median5yCad}
                  expectedCagrBeforePct={advisory.multiAgent.expectedCagrBeforePct}
                  expectedCagrAfterPct={advisory.multiAgent.expectedCagrAfterPct}
                />
              </>
            )}
          </motion.div>
        )}

        {/* TAB 2: STRICTLY WHAT IS RECOMMENDED ("RECOMMANDÉ") */}
        {activeTab === 'recommendations' && (
          <motion.div
            key="tab-recommendations"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-8 sm:space-y-10"
          >
            {/* Serene Unboxed 3-Column Metric Ribbon (Zero Nested Card Clutter, Zero Duplicate CTA) */}
            <section
              aria-label="Impact global du plan recommandé"
              className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-bordure py-2 border-b border-bordure"
            >
              <div className="pb-4 md:pb-3 md:pr-6 flex items-center justify-between">
                <RadialBeforeAfterGauge
                  before100={advisory.healthScoreBefore100}
                  after100={advisory.healthScoreAfter100}
                  label="Note Santé Globale"
                  subValue={`${healthGainPts >= 0 ? `▲ +${healthGainPts}` : `▼ ${healthGainPts}`} pts`}
                  accentColor={VALORIA_PALETTE.emerald}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setIntelSubView('future');
                  onSelectTab('intelligence');
                }}
                className="min-h-11 py-4 md:py-1 md:px-6 flex items-center justify-between gap-4 text-left hover:opacity-90 transition-opacity cursor-pointer"
              >
                <div className="space-y-1 font-mono tabular-nums">
                  <span className="block font-sans text-xs text-texte-doux">
                    Projection médiane 2031
                  </span>
                  <div className="text-xl font-semibold text-texte">
                    <AnimatedNumber
                      value={jumpMc.after.p50Median5yCad}
                      formatter={(n) => formatEur(n, 0)}
                    />
                  </div>
                  <div className="text-xs text-succes-texte">
                    ▲ {formatSignedEur(jumpMc.median5yGainDeltaCad, 0)} vs statu quo
                  </div>
                </div>

                {miniConePaths && (
                  <svg
                    width="112"
                    height="40"
                    viewBox="0 0 128 42"
                    aria-hidden="true"
                    className="shrink-0 overflow-visible"
                  >
                    <polygon
                      points={miniConePaths.fanPolygon}
                      fill={VALORIA_PALETTE.emerald}
                      fillOpacity="0.14"
                    />
                    <polyline
                      points={miniConePaths.beforeLine}
                      fill="none"
                      stroke={VALORIA_PALETTE.mutedZinc}
                      strokeWidth="1.4"
                      strokeDasharray="3 2"
                    />
                    <polyline
                      points={miniConePaths.afterLine}
                      fill="none"
                      stroke={VALORIA_PALETTE.emerald}
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </button>

              <div className="pt-4 md:pt-1 md:pl-6 flex flex-col justify-center gap-2.5 font-mono tabular-nums">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-sans text-xs text-texte-doux">
                    Protection Anti-Krach (CVaR 99%)
                  </span>
                  <span className="text-xs font-medium text-succes-texte">
                    {jumpMc.tailRiskSaved99Cad >= 0
                      ? `▲ +${formatCompactEur(jumpMc.tailRiskSaved99Cad)} protégé`
                      : `Vol. ${formatPct(advisory.after.annualizedVolatilityPct, 1)}`}
                  </span>
                </div>

                <AnimatedMeterBar
                  pct={Math.max(
                    22,
                    Math.min(
                      95,
                      100 -
                        (jumpMc.after.cvar99AnnualCad /
                          Math.max(1, portfolioSummary.totalCurrentValue)) *
                          100
                    )
                  )}
                  tone="positive"
                  heightClass="h-1.5"
                  immediate
                />

                <span className="font-sans text-[11px] text-texte-doux">
                  Volatilité annualisée :{' '}
                  {formatPct(advisory.before.annualizedVolatilityPct, 1)} →{' '}
                  {formatPct(advisory.after.annualizedVolatilityPct, 1)}
                </span>
              </div>
            </section>

            {/* Primary Focus: Clean Side-by-Side Action Lists (01. Alléger | 02. Acheter) */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 items-start">
              {/* Left: What to Sell/Trim in Owned Positions */}
              <div className="bg-surface/25 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
                <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-bordure">
                  <h2 className="text-xs sm:text-sm font-semibold text-texte">
                    01. Sur ce que j’ai · Alléger ({advisory.sellRecommendations.length})
                  </h2>
                  <span className="font-mono tabular-nums text-xs text-erreur-texte shrink-0">
                    +{formatEur(advisory.sellProceedsCad, 0)} libérés
                  </span>
                </div>

                {advisory.sellRecommendations.length === 0 ? (
                  <p className="py-6 text-xs text-texte-doux text-center">
                    Aucune vente recommandée sur vos lignes actuelles.
                  </p>
                ) : (
                  <div className="divide-y divide-bordure">
                    {advisory.sellRecommendations.map(renderRecommendationCotCard)}
                  </div>
                )}
              </div>

              {/* Right: Recommended Buys */}
              <div className="bg-surface/25 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
                <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-bordure">
                  <h2 className="text-xs sm:text-sm font-semibold text-texte">
                    02. Recommandé · Renforcer &amp; Acheter ({advisory.buyRecommendations.length})
                  </h2>
                  <span className="font-mono tabular-nums text-xs text-succes-texte shrink-0">
                    +{formatEur(advisory.totalBuyBudgetCad, 0)} déployés
                  </span>
                </div>

                {advisory.buyRecommendations.length === 0 ? (
                  <p className="py-6 text-xs text-texte-doux text-center">
                    Aucun nouvel achat requis actuellement.
                  </p>
                ) : (
                  <div className="divide-y divide-bordure">
                    {advisory.buyRecommendations.map(renderRecommendationCotCard)}
                  </div>
                )}
              </div>
            </section>

            {/* Progressive Disclosure: Visual Before/After Arbitrage & Equilibrium Charts */}
            <section className="space-y-4 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
                <button
                  type="button"
                  aria-expanded={showRecCharts}
                  onClick={() => setShowRecCharts((v) => !v)}
                  className="min-h-11 min-w-11 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface/50 hover:bg-surface border border-bordure text-xs font-medium text-texte hover:text-texte transition-colors cursor-pointer text-left max-w-full"
                >
                  <BarChart3 className="w-3.5 h-3.5 text-texte-doux shrink-0" />
                  <span>
                    {showRecCharts
                      ? 'Masquer les graphiques comparatifs Avant / Après'
                      : 'Afficher les graphiques comparatifs Avant / Après'}
                  </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-texte-doux transition-transform duration-200 shrink-0 ${
                        showRecCharts ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectTab('ai_proof')}
                    className="min-h-11 min-w-11 inline-flex items-center gap-1.5 text-xs font-medium text-texte-doux hover:text-texte transition-colors cursor-pointer text-left max-w-full"
                  >
                    <span>Vérifier si l’IA avait raison (1M, 1A, 5A, 10A)</span>
                    <ArrowRight className="w-3.5 h-3.5 text-succes-texte shrink-0" />
                  </button>
                </div>

              <AnimatePresence initial={false}>
                {showRecCharts && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch pt-1">
                      <div className="lg:col-span-7 bg-surface/25 border border-bordure rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-sm font-semibold text-texte">
                            Flux des Arbitrages ($ CAD)
                          </h3>
                          <span className="font-mono tabular-nums text-xs text-texte-doux">
                            <span className="text-erreur-texte">
                              −{formatCompactEur(advisory.sellProceedsCad)}
                            </span>
                            {' → '}
                            <span className="text-succes-texte">
                              +{formatCompactEur(advisory.totalBuyBudgetCad)}
                            </span>
                          </span>
                        </div>

                        <DivergingTradeButterflyChart
                          sells={advisory.sellRecommendations}
                          buys={advisory.buyRecommendations}
                          onInspectAsset={(id) => setInspectedAssetId(id)}
                          onExecuteOrder={(assetId, deltaCad) => {
                            onExecuteSingleOrder(assetId, deltaCad);
                            setExecutionNotice(
                              `Ordre exécuté : ${assetId} (${formatSignedEur(deltaCad, 0)})`
                            );
                          }}
                        />
                      </div>

                      <div className="lg:col-span-5 bg-surface/25 border border-bordure rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4">
                        <h3 className="text-sm font-semibold text-texte">
                          Équilibre : Ce que j’ai vs Recommandé
                        </h3>

                        <div className="flex-1 flex items-center justify-center">
                          <RadarComparisonSvg
                            primary={advisory.multiAgent.radarAfter}
                            baseline={advisory.multiAgent.radarBefore}
                            primaryLabel="Recommandé"
                            baselineLabel="Ce que j’ai"
                            size={224}
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </motion.div>
        )}

        {/* TAB 2B: RETROSPECTIVE AI USEFULNESS LAB ("PREUVE IA") */}
        {activeTab === 'ai_proof' && (
          <motion.div
            key="tab-ai-proof"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <AiTimeMachineProofView
              lots={lots}
              livePrices={livePrices}
              riskProfile={riskProfile}
              geminiApiKey={geminiApiKey}
              onInspectAsset={(id) => setInspectedAssetId(id)}
              onNavigateToRecommendations={() => onSelectTab('recommendations')}
            />
          </motion.div>
        )}

        {/* TAB 3: INTERACTIVE 7-AGENT & AI CONSULTATION + TRADE IMPACT SIMULATOR */}
        {activeTab === 'dialogue' && (
          <motion.div
            key="tab-dialogue"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <AgentConsultationChatView
              lots={lots}
              livePrices={livePrices}
              macro={macro}
              riskProfile={riskProfile}
              advisory={advisory}
              universe={fullUniverse}
              geminiApiKey={geminiApiKey}
              initialFocusAssetId={chatFocusAssetId}
              onInspectAsset={(id) => setInspectedAssetId(id)}
              onExecuteSingleOrder={(assetId, deltaCad) => {
                onExecuteSingleOrder(assetId, deltaCad);
                setExecutionNotice(
                  `Ordre exécuté : ${assetId} (${formatSignedEur(deltaCad, 0)})`
                );
              }}
              onApplyFullAdvisoryPlan={onApplyFullAdvisoryPlan}
            />
          </motion.div>
        )}

        {/* TAB 4: GLOBAL MARKET EXPLORER & D3 SECTOR HEATMAP */}
        {activeTab === 'market' && (
          <motion.div
            key="tab-market"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <GlobalMarketExplorerSection
              universe={fullUniverse}
              watchlistIds={watchlistIds}
              onInspectAsset={(id) => setInspectedAssetId(id)}
              onQuickInvestCad={(assetId, amountCad) => {
                onExecuteSingleOrder(assetId, amountCad);
                setExecutionNotice(
                  `Ordre exécuté : +${formatEur(amountCad, 0)} sur ${assetId}`
                );
              }}
              onAddWatchlist={onAddWatchlistAsset}
              onRegisterCustomOrLiveAsset={onRegisterCustomOrLiveAsset}
              isRefreshingVerified={isRefreshingVerified}
              verifiedFeedStatus={verifiedFeedStatus}
              onRefreshVerifiedPrices={onRefreshVerifiedPrices}
            />
          </motion.div>
        )}

        {/* TAB 5: PURCHASING POWER / INFLATION + 7 AGENTS + 2031 PROJECTIONS */}
        {activeTab === 'intelligence' && (
          <motion.div
            key="tab-intelligence"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-7"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-bordure">
              <div
                role="group"
                aria-label="Sous-laboratoires Agents et Futur"
                className="grid grid-cols-2 sm:inline-flex items-center gap-1 p-1 bg-surface/60 border border-bordure rounded-xl w-full sm:w-auto"
              >
                {(
                  [
                    {
                      id: 'causal_ia',
                      mobile: 'Causal IA',
                      desktop: 'Radar IA & Actus Causal',
                    },
                    {
                      id: 'inflation',
                      mobile: 'Inflation',
                      desktop: 'Pouvoir d’Achat',
                    },
                    {
                      id: 'agents',
                      mobile: '7 Agents',
                      desktop: 'Comité 7 Agents',
                    },
                    {
                      id: 'future',
                      mobile: 'Futur 2031',
                      desktop: 'Trajectoire 2031',
                    },
                  ] as const
                ).map((sub) => {
                  const isActiveSub = intelSubView === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      aria-pressed={isActiveSub}
                      onClick={() => setIntelSubView(sub.id)}
                      className={`min-w-11 relative min-h-11 px-2.5 sm:px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                        isActiveSub
                          ? 'text-sur-accent font-semibold'
                          : 'text-texte-doux hover:text-texte'
                      }`}
                    >
                      {isActiveSub && (
                        <motion.span
                          layoutId="intel-subview-pill"
                          transition={{
                            type: 'spring',
                            stiffness: 420,
                            damping: 34,
                          }}
                          className="absolute inset-0 bg-accent rounded-lg"
                        />
                      )}
                      <span className="relative z-10 sm:hidden">{sub.mobile}</span>
                      <span className="relative z-10 hidden sm:inline">
                        {sub.desktop}
                      </span>
                    </button>
                  );
                })}
              </div>

              {intelSubView !== 'causal_ia' && (
                <button
                  type="button"
                  onClick={() => handleRunLiveAgentSwarm()}
                  disabled={isRunningSwarm}
                  className="min-w-11 min-h-11 self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-texte hover:text-texte bg-surface/60 hover:bg-surface-douce border border-bordure rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isRunningSwarm ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3 text-succes-texte fill-current" />
                  )}
                  <span>
                    {isRunningSwarm
                      ? 'Scan des 7 Agents…'
                      : lastSwarmMode === 'idle'
                        ? 'Scanner Actus Direct'
                        : 'Relancer Scan IA'}
                  </span>
                </button>
              )}
            </div>

            {intelSubView === 'causal_ia' && (
              <D3DeepAiNewsCausalHub
                lab={deepAiNewsLab}
                focusSliceId={selectedDonutSliceId}
                onClearFocusSlice={() => setSelectedDonutSliceId(null)}
                liveSynthesis={liveDeepSynthesis}
                isRunningSynthesis={isRunningDeepSynthesis}
                onRunLiveSynthesis={handleRunDeepAiSynthesis}
                onInspectAsset={(id) => setInspectedAssetId(id)}
                onOpenAssetInDialogue={openAssetInDialogue}
              />
            )}

            {intelSubView === 'inflation' && (
              <D3InflationPurchasingPowerWidget
                portfolioCapitalCad={portfolioSummary.totalCurrentValue}
                currentNominalReturnPct={advisory.multiAgent.expectedCagrBeforePct}
                recommendedNominalReturnPct={advisory.multiAgent.expectedCagrAfterPct}
              />
            )}

            {intelSubView === 'agents' && (
              <MultiAgentSwarmView
                multiAgent={advisory.multiAgent}
                universe={fullUniverse}
                institutionalNews={institutionalNews}
                heldAssetIds={advisory.heldLines.map((h) => h.assetId)}
                recommendedBuyIds={advisory.buyRecommendations.map((b) => b.assetId)}
                watchlistIds={watchlistIds}
                isRunningSwarm={isRunningSwarm}
                lastSwarmMode={lastSwarmMode}
                lastSwarmElapsedMs={lastSwarmElapsedMs}
                groundingSources={groundingSources}
                swarmNotice={swarmNotice}
                isFetchingLiveInstitutional={isFetchingLiveInstitutional}
                liveSourcesVerified={liveSourcesVerified}
                onRefreshInstitutionalSources={fetchLiveInstitutionalSources}
                onRunLiveSwarm={handleRunLiveAgentSwarm}
                onInspectAssetModal={(id) => setInspectedAssetId(id)}
                onQuickInvestCad={(assetId, amountCad) => {
                  onExecuteSingleOrder(assetId, amountCad);
                  setExecutionNotice(
                    `Ordre exécuté : +${formatEur(amountCad, 0)} sur ${assetId}`
                  );
                }}
                onAddWatchlistAsset={onAddWatchlistAsset}
                onRemoveWatchlistAsset={onRemoveWatchlistAsset}
              />
            )}

            {intelSubView === 'future' && (
              <VisualFutureProjectionsView
                advisory={advisory}
                lots={lots}
                livePrices={livePrices}
                macro={macro}
                watchlistIds={watchlistIds}
                marketUniverseVersion={marketUniverseVersion}
                onInspectAsset={(id) => setInspectedAssetId(id)}
                onAddWatchlistAsset={onAddWatchlistAsset}
                onRemoveWatchlistAsset={onRemoveWatchlistAsset}
                onQuickInvestAsset={(assetId, amountCad) => {
                  onExecuteSingleOrder(assetId, amountCad);
                  setExecutionNotice(
                    `Ordre exécuté : +${formatEur(amountCad, 0)} sur ${assetId}`
                  );
                }}
              />
            )}
          </motion.div>
        )}
      </div>

      {/* Unified Management & Settings Slide-Over Hub */}
      <PortfolioControlHubModal
        isOpen={isControlHubOpen}
        onClose={onCloseControlHub}
        heldLines={advisory.heldLines}
        lots={lots}
        riskProfile={riskProfile}
        regimeId={regimeId}
        availableCashCad={availableCashCad}
        marketUniverseVersion={marketUniverseVersion}
        isRefreshingVerified={isRefreshingVerified}
        verifiedFeedStatus={verifiedFeedStatus}
        onSelectRiskProfile={onSelectRiskProfile}
        onSelectRegime={onSelectRegime}
        onChangeAvailableCashCad={onChangeAvailableCashCad}
        onAddLot={onAddLot}
        onExecuteSingleOrder={(assetId, deltaCad) => {
          onExecuteSingleOrder(assetId, deltaCad);
          setExecutionNotice(
            `Ordre exécuté : ${assetId} (${formatSignedEur(deltaCad, 0)})`
          );
        }}
        onRemoveAssetHoldings={onRemoveAssetHoldings}
        onResetDemoPortfolio={onResetDemoPortfolio}
        onClearPortfolio={onClearPortfolio}
        onRefreshVerifiedPrices={onRefreshVerifiedPrices}
      />

      {/* Visual Asset Tear-Sheet Modal (MM 50/200 · RSI · MACD) */}
      <AssetTearSheetModal
        analysis={inspectedAnalysis}
        macro={macro}
        livePrices={livePrices}
        assetNews={inspectedNews}
        corporateIntel={inspectedCorporateIntel}
        institutionalProfile={inspectedInstitutionalProfile}
        isWatched={
          resolvedInspectedAssetId ? watchlistIds.includes(resolvedInspectedAssetId) : false
        }
        onClose={() => {
          setInspectedAssetId(null);
          onClearExternalInspectedAsset?.();
        }}
        onInvestCad={(assetId, amountCad) => {
          onExecuteSingleOrder(assetId, amountCad);
          setExecutionNotice(
            `Ordre exécuté : +${formatEur(amountCad, 0)} sur ${assetId}`
          );
        }}
        onAddWatchlist={onAddWatchlistAsset}
      />

      {/* Sleek Asset Focus Side Panel (Monte Carlo 10k + Buy/Sell Signals Only) */}
      <AssetFocusSidePanel
        focusedAssetId={focusedAssetId}
        lots={lots}
        livePrices={livePrices}
        availableCashCad={availableCashCad}
        advisory={advisory}
        universe={fullUniverse}
        onClose={() => setFocusedAssetId(null)}
        onExecuteOrder={(assetId, deltaCad) => {
          onExecuteSingleOrder(assetId, deltaCad);
          setExecutionNotice(
            `Ordre Focus exécuté : ${assetId} (${formatSignedEur(deltaCad, 0)})`
          );
        }}
        onAdjustAvailableCash={onChangeAvailableCashCad}
      />
    </div>
  );
};

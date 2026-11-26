import React, { useEffect, useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import {
  ExternalLink,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  AgentMatrixFilterMode,
  AssetDeepCorporateIntelligence,
  PortfolioMultiAgentSummary,
  ResearchAgentId,
  buildAgentVoteMatrixRows,
  getAgentSpecialistLeaderboard,
} from '../../services/valoria/corporateIntelligenceEngine';
import { MultiAssetUniverseSummary } from '../../services/valoria/multiAssetQuantEngine';
import { PortfolioInstitutionalNewsSummary } from '../../services/valoria/institutionalCurveAndNewsEngine';
import {
  QuarterlyBeatAndMarginSvg,
  RadarComparisonSvg,
  SupplyChainGraphSvg,
} from './VisualPrimitives';
import { D3WatchlistSentimentDials } from './D3WatchlistSentimentDials';
import { D3InstitutionalNewsCorrelationSection } from './D3InstitutionalNewsCorrelationSection';
import { safeExternalHttpUrl } from '../../utils/safeExternalUrl';
import {
  AnimatedMeterBar,
  HoverLiftCard,
  ScrollReveal,
  StaggerCard,
  StaggerGrid,
} from './MotionPrimitives';
import { formatEur, formatPriceCad, formatSignedPct } from '../../services/valoria/valoriaFormatters';
import { PrivateAmount } from '../ui/PrivateAmount';

interface MultiAgentSwarmViewProps {
  multiAgent: PortfolioMultiAgentSummary;
  universe: MultiAssetUniverseSummary;
  institutionalNews: PortfolioInstitutionalNewsSummary;
  heldAssetIds: string[];
  recommendedBuyIds: string[];
  watchlistIds: string[];
  isRunningSwarm: boolean;
  lastSwarmMode: 'idle' | 'gemini_live_swarm' | 'live_market_quant';
  lastSwarmElapsedMs: number | null;
  groundingSources: Array<{ uri: string; title: string }>;
  swarmNotice: string | null;
  isFetchingLiveInstitutional: boolean;
  liveSourcesVerified: string[];
  onRefreshInstitutionalSources: () => void;
  onRunLiveSwarm: (focusTicker?: string) => void;
  onInspectAssetModal: (assetId: string) => void;
  onQuickInvestCad: (assetId: string, amountCad: number) => void;
  onAddWatchlistAsset: (assetId: string) => void;
  onRemoveWatchlistAsset: (assetId: string) => void;
}

const MATRIX_MODES: { id: AgentMatrixFilterMode; label: string }[] = [
  { id: 'portfolio', label: 'Mon Portefeuille & Conseils' },
  { id: 'top_consensus', label: '▲ Top Unanimité (7/7)' },
  { id: 'red_alerts', label: '▼ Alertes Rouges' },
];

export const MultiAgentSwarmView: React.FC<MultiAgentSwarmViewProps> = ({
  multiAgent,
  universe,
  institutionalNews,
  heldAssetIds,
  recommendedBuyIds,
  watchlistIds,
  isRunningSwarm,
  lastSwarmMode,
  lastSwarmElapsedMs,
  groundingSources,
  swarmNotice,
  isFetchingLiveInstitutional,
  liveSourcesVerified,
  onRefreshInstitutionalSources,
  onRunLiveSwarm,
  onInspectAssetModal,
  onQuickInvestCad,
  onAddWatchlistAsset,
  onRemoveWatchlistAsset,
}) => {
  const firstCorporateId =
    [...heldAssetIds, ...recommendedBuyIds].find((id) =>
      Boolean(universe.byId.get(id)?.equityDetails)
    ) ??
    heldAssetIds[0] ??
    recommendedBuyIds[0] ??
    'ADP';

  const [selectedAssetId, setSelectedAssetId] = useState<string>(firstCorporateId);
  const [focusedAgentId, setFocusedAgentId] =
    useState<ResearchAgentId>('agent_filings');
  const [matrixMode, setMatrixMode] =
    useState<AgentMatrixFilterMode>('portfolio');
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [scanStepIndex, setScanStepIndex] = useState<number>(-1);
  const [swarmFocusView, setSwarmFocusView] = useState<
    'committee' | 'stock_xray' | 'dials_news'
  >('committee');

  // Visual stepped scan indicator across AG-01 -> AG-07 when live scan runs
  useEffect(() => {
    if (!isRunningSwarm) {
      setScanStepIndex(-1);
      return;
    }
    setScanStepIndex(0);
    const interval = window.setInterval(() => {
      setScanStepIndex((prev) => (prev + 1) % 7);
    }, 220);
    return () => window.clearInterval(interval);
  }, [isRunningSwarm]);

  const specialistBoard = useMemo(
    () =>
      getAgentSpecialistLeaderboard(multiAgent.byAssetId, focusedAgentId, 4),
    [multiAgent.byAssetId, focusedAgentId]
  );

  const matrixRows = useMemo(
    () =>
      buildAgentVoteMatrixRows({
        byAssetId: multiAgent.byAssetId,
        heldAssetIds,
        recommendedBuyIds,
        mode: matrixMode,
        limit: 10,
      }),
    [multiAgent.byAssetId, heldAssetIds, recommendedBuyIds, matrixMode]
  );

  const quickChips = useMemo(() => {
    const priorityIds = Array.from(
      new Set([
        ...heldAssetIds,
        ...recommendedBuyIds,
        'ADP',
        'GOOGL',
        'INTC',
        'RY',
        'SHOP',
        'LLY',
        'BTC',
      ])
    ).slice(0, 12);

    const q = filterQuery.trim().toUpperCase();
    if (!q) {
      return priorityIds
        .map((id) => multiAgent.byAssetId.get(id))
        .filter((x): x is AssetDeepCorporateIntelligence => Boolean(x));
    }

    return Array.from(multiAgent.byAssetId.values())
      .filter((item) =>
        `${item.ticker} ${item.name} ${item.assetId}`.toUpperCase().includes(q)
      )
      .slice(0, 14);
  }, [multiAgent.byAssetId, heldAssetIds, recommendedBuyIds, filterQuery]);

  const activeIntel =
    multiAgent.byAssetId.get(selectedAssetId) ??
    quickChips[0] ??
    Array.from(multiAgent.byAssetId.values())[0];

  const activeUniv = activeIntel
    ? universe.byId.get(activeIntel.assetId)
    : undefined;

  if (!activeIntel) return null;

  const priceDecimals = activeIntel.spotCad < 2 ? 4 : 2;
  const hoveredNews =
    activeIntel.newsEvents.find((e) => e.id === hoveredEventId) ??
    activeIntel.newsEvents[0];

  const consensus = activeIntel.committeeConsensus;
  const buyPct = Math.round((consensus.buyVotes / consensus.totalAgents) * 100);
  const neutralPct = Math.round(
    (consensus.neutralVotes / consensus.totalAgents) * 100
  );
  const sellPct = Math.max(0, 100 - buyPct - neutralPct);

  return (
    <div className="space-y-5">
      {/* Compact Sub-Lens Bar to Keep View Airy & Focused */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-surface border border-bordure rounded-xl">
          <button aria-pressed={Boolean(swarmFocusView === 'committee')}
            type="button"
            onClick={() => setSwarmFocusView('committee')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              swarmFocusView === 'committee'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Comité &amp; Votes (7 Agents)
          </button>
          <button aria-pressed={Boolean(swarmFocusView === 'stock_xray')}
            type="button"
            onClick={() => setSwarmFocusView('stock_xray')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              swarmFocusView === 'stock_xray'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Focus Action ({activeIntel.ticker})
          </button>
          <button aria-pressed={Boolean(swarmFocusView === 'dials_news')}
            type="button"
            onClick={() => setSwarmFocusView('dials_news')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              swarmFocusView === 'dials_news'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Jauges Sentiment &amp; Actus
          </button>
        </div>
      </div>

      {swarmFocusView === 'committee' && (
        <>
      {/* =================================================================== */}
      {/* 1. 7-AGENT INTERACTIVE COMMITTEE + SPECIALIST SPOTLIGHT             */}
      {/* =================================================================== */}
      <ScrollReveal className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-4 border-b border-bordure">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-texte-doux font-mono tabular-nums">
              <span>{multiAgent.totalSignalsProcessed.toLocaleString('fr-CA')} points vérifiés</span>
              <span aria-hidden="true">·</span>
              <span>
                Note Portefeuille{' '}
                <PrivateAmount>
                  <strong className="text-succes-texte">
                    {multiAgent.portfolioAgentScoreBefore100} →{' '}
                    {multiAgent.portfolioAgentScoreAfter100}/100
                  </strong>
                </PrivateAmount>
              </span>
              {lastSwarmElapsedMs !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{lastSwarmElapsedMs} ms</span>
                </>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-texte">
              Comité Autonome des 7 Agents Spécialisés ($ CAD)
            </h2>
            <p className="text-xs text-texte-doux">
              Cliquez sur n’importe quel agent ci-dessous pour voir ce qu’il vérifie et ses 4 meilleures actions vertes / pièges rouges.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {swarmNotice && (
              <span className="text-[11px] font-mono text-texte-doux">
                {swarmNotice}
              </span>
            )}
            <button
              type="button"
              onClick={() => onRunLiveSwarm()}
              disabled={isRunningSwarm}
              className="min-h-11 min-w-11 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isRunningSwarm ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>
                {isRunningSwarm
                  ? `Scan ${multiAgent.fleetNodes[Math.max(0, scanStepIndex)]?.code ?? 'AG'} en cours…`
                  : lastSwarmMode === 'idle'
                    ? 'Lancer les 7 Agents en Direct'
                    : 'Actualiser les 7 Agents'}
              </span>
            </button>
          </div>
        </div>

        {/* 7 Clickable Specialist Cards */}
        <StaggerGrid className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 font-mono tabular-nums">
          {multiAgent.fleetNodes.map((node, idx) => {
            const isFocused = node.id === focusedAgentId;
            const isScanningNow = isRunningSwarm && scanStepIndex === idx;
            return (
              <StaggerCard key={node.id} index={idx}>
                <button
                  type="button"
                  onClick={() => setFocusedAgentId(node.id)}
                  aria-pressed={isFocused}
                  className={`min-h-11 w-full text-left p-3 rounded-xl border transition-all duration-150 space-y-2 h-full flex flex-col justify-between cursor-pointer ${
                    isScanningNow
                      ? 'bg-surface-douce border-succes-texte'
                      : isFocused
                        ? 'bg-surface border-accent'
                        : 'bg-surface/55 border-bordure hover:border-bordure-champ'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span
                        className={
                          isFocused
                            ? 'text-texte font-bold'
                            : 'text-texte-doux font-bold'
                        }
                      >
                        {node.code}
                      </span>
                      <span
                        className={
                          node.tone === 'positive'
                            ? 'text-succes-texte font-bold'
                            : node.tone === 'negative'
                              ? 'text-erreur-texte font-bold'
                              : 'text-texte font-bold'
                        }
                      >
                        {/* NOMBRE-NON-MONETAIRE : score d'agent spécialiste sur l'univers */}
                        {node.score100}/100
                      </span>
                    </div>
                    <div className="font-sans text-xs font-semibold text-texte truncate">
                      {node.shortTitle}
                    </div>
                    <div className="font-sans text-[10px] text-texte-doux truncate">
                      {node.domainTag}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <AnimatedMeterBar
                      pct={node.score100}
                      tone={node.tone}
                      heightClass="h-1.5"
                      immediate
                    />
                    <div className="flex items-center justify-between text-[10px] text-texte-doux">
                      <span className="truncate">{node.keyMetricValue}</span>
                      <span
                        className={
                          node.alphaContributionPct >= 0
                            ? 'text-succes-texte'
                            : 'text-erreur-texte'
                        }
                      >
                        {formatSignedPct(node.alphaContributionPct, 1)}
                      </span>
                    </div>
                  </div>
                </button>
              </StaggerCard>
            );
          })}
        </StaggerGrid>

        {/* Interactive Specialist Focus Strip (Updates on Agent Click) */}
        <motion.div
          key={specialistBoard.agentId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="pt-4 border-t border-bordure space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-texte-doux">
                <span className="text-texte font-bold">
                  FOCUS {specialistBoard.code} · {specialistBoard.shortTitle}
                </span>
                <span aria-hidden="true">·</span>
                <span>{specialistBoard.domainTag}</span>
              </div>
              <p className="text-xs text-texte">
                {specialistBoard.specialtyExplain}
              </p>
            </div>

            <div className="flex items-center gap-3 font-mono tabular-nums text-xs shrink-0">
              <span className="text-succes-texte">
                ▲ {specialistBoard.bullishMarketCount} validés
              </span>
              <span className="text-texte-doux">·</span>
              <span className="text-erreur-texte">
                ▼ {specialistBoard.bearishMarketCount} alertes
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top 4 Green Picks of this Specialist */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold pb-1.5 border-b border-bordure">
                <span className="text-succes-texte">
                  ▲ Top 4 Coups de Cœur ({specialistBoard.shortTitle})
                </span>
                <span className="font-mono text-[11px] text-texte-doux">
                  Cliquer pour inspecter
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {specialistBoard.topBuys.map((pick) => {
                  const active = pick.assetId === activeIntel.assetId;
                  return (
                    <button
                      key={pick.assetId}
                      type="button"
                      onClick={() => setSelectedAssetId(pick.assetId)}
                      className={`min-h-11 text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                        active
                          ? 'bg-surface-douce border-succes-texte'
                          : 'bg-surface/55 border-bordure hover:border-bordure-champ'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-mono tabular-nums text-xs">
                        <span className="font-bold text-texte">
                          {pick.ticker}{' '}
                          <span className="font-sans font-normal text-texte-doux text-[11px]">
                            · {formatPriceCad(pick.spotCad)}
                          </span>
                        </span>
                        <span className="text-succes-texte font-bold">
                          ▲ {pick.agentScore100}
                        </span>
                      </div>
                      <div className="text-[11px] text-texte truncate mt-1">
                        {pick.beginnerSummary}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Top 4 Red Traps Detected by this Specialist */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold pb-1.5 border-b border-bordure">
                <span className="text-erreur-texte">
                  ▼ Top 4 Pièges &amp; Dangers ({specialistBoard.shortTitle})
                </span>
                <span className="font-mono text-[11px] text-texte-doux">
                  À éviter / alléger
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {specialistBoard.topTraps.map((trap) => {
                  const active = trap.assetId === activeIntel.assetId;
                  return (
                    <button
                      key={trap.assetId}
                      type="button"
                      onClick={() => setSelectedAssetId(trap.assetId)}
                      className={`min-h-11 text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                        active
                          ? 'bg-surface-douce border-erreur-texte'
                          : 'bg-surface/55 border-bordure hover:border-bordure-champ'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-mono tabular-nums text-xs">
                        <span className="font-bold text-texte">
                          {trap.ticker}{' '}
                          <span className="font-sans font-normal text-texte-doux text-[11px]">
                            · {formatPriceCad(trap.spotCad)}
                          </span>
                        </span>
                        <span className="text-erreur-texte font-bold">
                          ▼ {trap.agentScore100}
                        </span>
                      </div>
                      <div className="text-[11px] text-texte truncate mt-1">
                        {trap.beginnerSummary}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>

        {groundingSources.length > 0 && (
          <div className="pt-3 border-t border-bordure flex flex-wrap items-center gap-3 text-[11px]">
            <span className="text-texte-doux font-mono">SOURCES WEB :</span>
            {groundingSources.map((src) => {
              const safeUri = safeExternalHttpUrl(src.uri);
              if (!safeUri) return null;
              return (
                <a
                  key={safeUri}
                  href={safeUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-texte hover:underline truncate max-w-[220px]"
                >
                  <span className="truncate">{src.title}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              );
            })}
          </div>
        )}
      </ScrollReveal>

      {/* =================================================================== */}
      {/* 2. 7-AGENT VOTE HEATMAP MATRIX (PORTFOLIO & MARKET CONSENSUS)       */}
      {/* =================================================================== */}
      <ScrollReveal className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <h3 className="text-base sm:text-lg font-bold text-texte">
              Matrice de Vote des 7 Agents en 1 Coup d’Œil
            </h3>
            <p className="text-xs text-texte-doux">
              ▲ Vert = Acheter · ● Gris = Neutre · ▼ Rouge = Danger. Cliquez une ligne pour voir le débat complet.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-surface border border-bordure rounded-xl shrink-0 overflow-x-auto">
            {MATRIX_MODES.map((m) => (
              <button aria-pressed={Boolean(matrixMode === m.id)}
                key={m.id}
                type="button"
                onClick={() => setMatrixMode(m.id)}
                className={`min-h-11 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  matrixMode === m.id
                    ? 'bg-accent text-sur-accent'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse font-mono tabular-nums">
            <thead>
              <tr className="border-b border-bordure text-texte-doux text-[11px]">
                <th className="py-2 pr-3 text-left font-sans font-medium">
                  Actif ($ CAD)
                </th>
                <th className="py-2 px-1.5 text-center font-sans font-medium">
                  Bilan
                </th>
                <th className="py-2 px-1.5 text-center font-sans font-medium">
                  BPA 8T
                </th>
                <th className="py-2 px-1.5 text-center font-sans font-medium">
                  Actus
                </th>
                <th className="py-2 px-1.5 text-center font-sans font-medium">
                  Courbes
                </th>
                <th className="py-2 px-1.5 text-center font-sans font-medium">
                  Initiés
                </th>
                <th className="py-2 px-1.5 text-center font-sans font-medium">
                  Chaîne
                </th>
                <th className="py-2 px-1.5 text-center font-sans font-medium">
                  Bouclier
                </th>
                <th className="py-2 px-2 text-right font-sans font-medium">
                  Vote 7 Agents
                </th>
                <th className="py-2 pl-2 text-right font-sans font-medium">
                  Courbes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bordure">
              {matrixRows.map((row) => {
                const isSelected = row.assetId === activeIntel.assetId;
                return (
                  <tr
                    key={row.assetId}
                    onClick={() => {
                      setSelectedAssetId(row.assetId);
                      setSwarmFocusView('stock_xray');
                    }}
                    className={`transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-surface'
                        : 'hover:bg-surface/50'
                    }`}
                  >
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-texte">
                          {row.ticker}
                        </span>
                        <span className="font-sans text-texte-doux truncate max-w-[130px]">
                          {row.name}
                        </span>
                        {row.isHeld && (
                          <span className="font-sans text-[10px] text-texte">
                            · Détenu
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-texte-doux">
                        {/* NOMBRE-NON-MONETAIRE : score composite public de l'actif */}
                        {formatPriceCad(row.spotCad)} · Score {row.compositeScore100}/100
                      </div>
                    </td>

                    {row.cells.map((cell) => {
                      const cellStyle =
                        cell.tone === 'positive'
                          ? 'bg-succes-fond text-succes-texte border-succes-texte/40'
                          : cell.tone === 'negative'
                            ? 'bg-erreur-fond text-erreur-texte border-erreur-texte/40'
                            : 'bg-surface text-texte border-bordure';
                      const sym =
                        cell.tone === 'positive'
                          ? '▲'
                          : cell.tone === 'negative'
                            ? '▼'
                            : '●';
                      return (
                        <td
                          key={cell.agentId}
                          title={`${cell.code} : ${cell.summary}`}
                          className="py-2 px-1 text-center"
                        >
                          <span
                            className={`inline-block w-12 py-1 rounded-md border text-[11px] font-semibold ${cellStyle}`}
                          >
                            {sym} {cell.score100}
                          </span>
                        </td>
                      );
                    })}

                    <td className="py-2.5 px-2 text-right whitespace-nowrap">
                      <span
                        className={`font-bold ${
                          row.verdictTone === 'positive'
                            ? 'text-succes-texte'
                            : row.verdictTone === 'negative'
                              ? 'text-erreur-texte'
                              : 'text-texte'
                        }`}
                      >
                        {row.buyVotes}▲ · {row.neutralVotes}● · {row.sellVotes}▼
                      </span>
                    </td>

                    <td
                      className="py-2.5 pl-2 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onInspectAssetModal(row.assetId)}
                        className="min-h-11 min-w-11 px-2.5 py-1 rounded-lg border border-bordure-champ bg-surface hover:bg-accent text-texte hover:text-sur-accent font-sans text-[11px] font-medium transition-colors cursor-pointer"
                      >
                        MM / RSI
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ScrollReveal>
        </>
      )}

      {swarmFocusView === 'stock_xray' && (
        <>
      {/* =================================================================== */}
      {/* 3. SELECTED STOCK: 7-AGENT TUG-OF-WAR & BEGINNER VERDICT CARD       */}
      {/* =================================================================== */}
      <ScrollReveal className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-5">
        {/* Quick Asset Chips + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-bordure">
          <div className="flex flex-wrap items-center gap-1.5">
            {quickChips.map((item) => {
              const isSelected = item.assetId === activeIntel.assetId;
              const isHeld = heldAssetIds.includes(item.assetId);
              return (
                <button
                  key={item.assetId}
                  type="button"
                  onClick={() => setSelectedAssetId(item.assetId)}
                  className={`min-h-11 min-w-11 px-2.5 py-1.5 text-xs font-mono rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-accent text-sur-accent font-bold'
                      : 'bg-surface text-texte hover:text-texte border border-bordure'
                  }`}
                >
                  {item.ticker}{' '}
                  <span className="opacity-75 text-[10px]">
                    {item.compositeAgentScore100}
                    {isHeld ? '★' : ''}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-60 shrink-0">
            <Search className="w-3.5 h-3.5 text-texte-doux absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <label htmlFor="agent-asset-search" className="sr-only">
              Chercher une entreprise ou actif
            </label>
            <input
              id="agent-asset-search"
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={`Chercher parmi ${universe.totalAssets} actifs…`}
              className="min-h-11 w-full pl-8 pr-2.5 py-1.5 text-xs bg-surface border border-bordure rounded-xl text-texte placeholder:text-texte-doux outline-hidden focus-ring focus:border-bordure-champ"
            />
          </div>
        </div>

        {/* Selected Asset Header + Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-3 font-mono tabular-nums">
              <h3 className="text-lg sm:text-xl font-bold text-texte">
                {activeIntel.ticker} ·{' '}
                <span className="font-sans font-semibold">
                  {activeIntel.name}
                </span>
              </h3>
              <span className="text-base font-bold text-texte">
                {formatEur(activeIntel.spotCad, priceDecimals)}
              </span>
              <span
                className={`text-xs font-bold ${
                  consensus.verdictTone === 'positive'
                    ? 'text-succes-texte'
                    : consensus.verdictTone === 'negative'
                      ? 'text-erreur-texte'
                      : 'text-texte'
                }`}
              >
                {consensus.verdictArrow} {consensus.consensusTitle}
              </span>
            </div>
            <p className="text-xs text-texte">{consensus.timingSummary}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onRunLiveSwarm(activeIntel.ticker)}
              disabled={isRunningSwarm}
              className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRunningSwarm ? 'animate-spin' : ''}`}
              />
              <span>Scanner {activeIntel.ticker} en direct</span>
            </button>

            <button
              type="button"
              onClick={() => onInspectAssetModal(activeIntel.assetId)}
              className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-texte bg-surface hover:bg-accent hover:text-sur-accent border border-bordure-champ rounded-xl whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>MM 50/200 · RSI · MACD</span>
            </button>

            <button
              type="button"
              onClick={() => onQuickInvestCad(activeIntel.assetId, 2500)}
              className="min-h-11 px-3.5 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              + 2 500 $ CAD
            </button>
          </div>
        </div>

        {/* Visual Tug-of-War Vote Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-succes-texte font-bold">
              ▲ {consensus.buyVotes} Pour Acheter
            </span>
            <span className="text-texte-doux">
              ● {consensus.neutralVotes} Neutre{consensus.neutralVotes > 1 ? 's' : ''}
            </span>
            <span className="text-erreur-texte font-bold">
              ▼ {consensus.sellVotes} Contre / Prudence
            </span>
          </div>
          <div className="w-full h-3 rounded-full bg-surface overflow-hidden flex border border-bordure">
            {buyPct > 0 && (
              <div
                // NOMBRE-NON-MONETAIRE : part votes favorables 7 agents
                style={{ width: `${buyPct}%` }}
                className="h-full bg-succes-texte transition-all duration-300"
              />
            )}
            {neutralPct > 0 && (
              <div
                // NOMBRE-NON-MONETAIRE : part votes neutres 7 agents
                style={{ width: `${neutralPct}%` }}
                className="h-full bg-bordure-champ transition-all duration-300"
              />
            )}
            {sellPct > 0 && (
              <div
                // NOMBRE-NON-MONETAIRE : part votes contre 7 agents
                style={{ width: `${sellPct}%` }}
                className="h-full bg-erreur-texte transition-all duration-300"
              />
            )}
          </div>
        </div>

        {/* Bull Arguments vs Bear Risks + 7 Individual Specialist Verdicts */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pt-3 border-t border-bordure">
          {/* Left 5 cols: Green Pros vs Red Risks */}
          <div className="lg:col-span-5 space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-bold text-succes-texte pb-1 border-b border-bordure">
                ▲ Pourquoi Acheter / Garder ({activeIntel.ticker})
              </div>
              <ul className="space-y-2 text-xs text-texte">
                {consensus.bullArguments.map((arg) => (
                  <li key={arg} className="flex items-start gap-2">
                    <span className="text-succes-texte font-mono shrink-0">▲</span>
                    <span>{arg}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2 pt-2">
              <div className="text-xs font-bold text-erreur-texte pb-1 border-b border-bordure">
                ▼ Risques &amp; Points de Vigilance
              </div>
              <ul className="space-y-2 text-xs text-texte">
                {consensus.bearArguments.map((arg) => (
                  <li key={arg} className="flex items-start gap-2">
                    <span className="text-erreur-texte font-mono shrink-0">▼</span>
                    <span>{arg}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right 7 cols: Individual Votes of All 7 Agents */}
          <div className="lg:col-span-7 lg:pl-6 lg:border-l lg:border-bordure space-y-3">
            <div className="flex items-center justify-between text-xs pb-1.5 border-b border-bordure">
              <span className="font-semibold text-texte">
                Détail des 7 Votes Spécialisés sur {activeIntel.ticker}
              </span>
              <span className="font-mono tabular-nums text-texte-doux">
                {/* NOMBRE-NON-MONETAIRE : score consensus public de l'actif */}
                Score Global {activeIntel.compositeAgentScore100}/100
              </span>
            </div>

            <div className="space-y-2.5">
              {activeIntel.agentNodes.map((n) => (
                <HoverLiftCard
                  key={n.id}
                  onClick={() => setFocusedAgentId(n.id)}
                  className="grid grid-cols-12 items-center gap-2 text-xs cursor-pointer"
                >
                  <div className="col-span-5 min-w-0">
                    <div className="font-semibold text-texte truncate">
                      <span className="font-mono text-texte-doux mr-1">{n.code}</span>
                      {n.shortTitle}
                    </div>
                    <div className="text-[11px] text-texte-doux truncate">
                      {n.beginnerSummary}
                    </div>
                  </div>

                  <div className="col-span-5">
                    <AnimatedMeterBar
                      pct={n.score100}
                      tone={n.tone}
                      heightClass="h-2"
                      immediate
                    />
                  </div>

                  <div className="col-span-2 text-right font-mono tabular-nums whitespace-nowrap">
                    <span
                      className={`font-bold ${
                        n.tone === 'positive'
                          ? 'text-succes-texte'
                          : n.tone === 'negative'
                            ? 'text-erreur-texte'
                            : 'text-texte'
                      }`}
                    >
                      {n.tone === 'positive'
                        ? '▲'
                        : n.tone === 'negative'
                          ? '▼'
                          : '●'}{' '}
                      {n.score100}
                    </span>
                  </div>
                </HoverLiftCard>
              ))}
            </div>
          </div>
        </div>
      </ScrollReveal>

      {/* =================================================================== */}
      {/* 4. VISUAL CORPORATE X-RAY GRID (6-AXIS RADAR + 8 QUARTERS)          */}
      {/* =================================================================== */}
      <ScrollReveal className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-4 bg-fond/90 border border-bordure rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="flex items-baseline justify-between pb-2 border-b border-bordure">
            <h3 className="text-sm font-semibold text-texte">
              Radar 6 Forces ({activeIntel.ticker})
            </h3>
            <span
              className={`font-mono tabular-nums text-xs font-bold ${
                activeIntel.expectedAnnualReturn5yPct >= 6
                  ? 'text-succes-texte'
                  : 'text-texte'
              }`}
            >
              Potentiel 5A {formatSignedPct(activeIntel.expectedAnnualReturn5yPct, 1)}/an
            </span>
          </div>

          <RadarComparisonSvg primary={activeIntel.radar6} size={232} />

          <div className="pt-3 border-t border-bordure space-y-1.5 font-mono tabular-nums text-[11px]">
            {activeIntel.agentNodes.map((n) => (
              <div key={n.id} className="flex items-center justify-between gap-2">
                <span className="font-sans text-texte-doux truncate">
                  {n.code} {n.shortTitle}
                </span>
                <span className="text-texte">{n.keyMetricValue}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 bg-fond/90 border border-bordure rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-bordure">
            <h3 className="text-sm font-semibold text-texte">
              8 Trimestres de Profits &amp; Marges ({activeIntel.ticker})
            </h3>
            <span className="font-mono tabular-nums text-xs text-succes-texte">
              ▲ {activeIntel.guidance.beatStreakCount8Q}/8 trimestres au-dessus des attentes
            </span>
          </div>

          <QuarterlyBeatAndMarginSvg quarters={activeIntel.quarterlyHistory} />

          <div className="pt-3 border-t border-bordure grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono tabular-nums text-xs">
            <div>
              <span className="block font-sans text-[11px] text-texte-doux">
                Solidité Bilan (Altman)
              </span>
              <span
                className={`text-sm font-bold ${
                  activeIntel.forensics.altmanZone === 'Solvable'
                    ? 'text-succes-texte'
                    : activeIntel.forensics.altmanZone === 'Fragile'
                      ? 'text-erreur-texte'
                      : 'text-texte'
                }`}
              >
                {activeIntel.forensics.altmanZScore} ({activeIntel.forensics.altmanZone})
              </span>
            </div>

            <div>
              <span className="block font-sans text-[11px] text-texte-doux">
                Qualité Comptable
              </span>
              <span
                className={`text-sm font-bold ${
                  activeIntel.forensics.beneishClean
                    ? 'text-succes-texte'
                    : 'text-erreur-texte'
                }`}
              >
                {activeIntel.forensics.beneishMScore} (
                {activeIntel.forensics.beneishClean ? 'Sain' : 'Alerte'})
              </span>
            </div>

            <div>
              <span className="block font-sans text-[11px] text-texte-doux">
                Cash Réel · R&amp;D
              </span>
              <span className="text-sm font-bold text-texte">
                {activeIntel.forensics.fcfConversionPct}% ·{' '}
                {activeIntel.forensics.rdAndCapexIntensityPct}%
              </span>
            </div>

            <div>
              <span className="block font-sans text-[11px] text-texte-doux">
                Commandes · Croissance 3A
              </span>
              <span
                className={`text-sm font-bold ${
                  activeIntel.guidance.epsCagrForward3yPct >= 0
                    ? 'text-succes-texte'
                    : 'text-erreur-texte'
                }`}
              >
                {formatSignedPct(activeIntel.guidance.backlogOrRpoGrowthPct, 0)} ·{' '}
                {formatSignedPct(activeIntel.guidance.epsCagrForward3yPct, 1)}/an
              </span>
            </div>
          </div>
        </div>
      </ScrollReveal>

      {/* =================================================================== */}
      {/* 5. SUPPLY CHAIN + INSIDERS/FUNDS + NEWS SCATTER                     */}
      {/* =================================================================== */}
      <ScrollReveal className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-5 bg-fond/90 border border-bordure rounded-2xl p-5 space-y-3">
          <div className="flex items-baseline justify-between pb-2 border-b border-bordure">
            <h3 className="text-sm font-semibold text-texte">
              Fournisseurs → {activeIntel.ticker} → Clients
            </h3>
            <span className="font-mono text-[11px] text-texte-doux">
              Part du chiffre d’affaires
            </span>
          </div>

          <SupplyChainGraphSvg
            ticker={activeIntel.ticker}
            score100={activeIntel.compositeAgentScore100}
            links={activeIntel.ecosystemLinks}
          />

          <div className="pt-2 border-t border-bordure grid grid-cols-4 gap-2 text-center font-mono tabular-nums text-[11px]">
            <div>
              <span className="block font-sans text-[10px] text-texte-doux">
                Taux −1%
              </span>
              <span className="text-succes-texte font-semibold">
                {formatSignedPct(activeIntel.macroSensitivity.ratesCut100bpsImpactPct, 1)}
              </span>
            </div>
            <div>
              <span className="block font-sans text-[10px] text-texte-doux">
                Inflation
              </span>
              <span
                className={`font-semibold ${
                  activeIntel.macroSensitivity.inflationSpikeImpactPct >= 0
                    ? 'text-succes-texte'
                    : 'text-erreur-texte'
                }`}
              >
                {formatSignedPct(activeIntel.macroSensitivity.inflationSpikeImpactPct, 1)}
              </span>
            </div>
            <div>
              <span className="block font-sans text-[10px] text-texte-doux">
                USD +5 %
              </span>
              <span className="text-texte font-semibold">
                {formatSignedPct(activeIntel.macroSensitivity.usdCadUp5PctImpactPct, 1)}
              </span>
            </div>
            <div>
              <span className="block font-sans text-[10px] text-texte-doux">
                Cycle Tech
              </span>
              <span className="text-succes-texte font-semibold">
                {/* NOMBRE-NON-MONETAIRE : sensibilité publique au cycle capex IA */}
                +{activeIntel.macroSensitivity.aiCapexCycleSensitivityPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 bg-fond/90 border border-bordure rounded-2xl p-5 flex flex-col justify-between space-y-4 font-mono tabular-nums">
          <div className="pb-2 border-b border-bordure flex items-baseline justify-between">
            <h3 className="font-sans text-sm font-semibold text-texte">
              Dirigeants &amp; Fonds
            </h3>
            <span className="text-xs text-texte">
              {/* NOMBRE-NON-MONETAIRE : score public flux institutionnels */}
              {activeIntel.radar6.smartMoneyFlow}/100
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="font-sans text-texte-doux">Achats Dirigeants 6M</span>
                <span
                  className={
                    activeIntel.positioning.insiderNetFlow6mCad >= 0
                      ? 'text-succes-texte font-bold'
                      : 'text-erreur-texte font-bold'
                  }
                >
                  {activeIntel.positioning.insiderNetFlow6mCad >= 0 ? '+' : ''}
                  {activeIntel.positioning.insiderNetFlow6mCad} M$ CAD
                </span>
              </div>
              <div className="w-full h-2 bg-surface-douce rounded-full overflow-hidden flex">
                <div
                  className="bg-succes-texte h-full"
                  style={{
                    width: `${Math.round(
                      (activeIntel.positioning.insiderBuyTxCount6m /
                        Math.max(
                          1,
                          activeIntel.positioning.insiderBuyTxCount6m +
                            activeIntel.positioning.insiderSellTxCount6m
                        )) *
                        100
                    )}%`,
                  }}
                />
                <div className="bg-erreur-texte h-full flex-1" />
              </div>
              <div className="flex justify-between text-[10px] text-texte-doux">
                <span>{activeIntel.positioning.insiderBuyTxCount6m} achats</span>
                <span>{activeIntel.positioning.insiderSellTxCount6m} ventes</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="font-sans text-texte-doux">Grands Fonds</span>
                <span className="text-texte font-semibold">
                  {activeIntel.positioning.institutionalOwnershipPct}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface-douce rounded-full overflow-hidden">
                <div
                  className="h-full bg-texte"
                  // NOMBRE-NON-MONETAIRE : détention institutionnelle publique du titre
                  style={{ width: `${activeIntel.positioning.institutionalOwnershipPct}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="font-sans text-texte-doux">Paris à la baisse</span>
                <span
                  className={
                    activeIntel.positioning.shortInterestFloatPct > 8
                      ? 'text-erreur-texte font-semibold'
                      : 'text-texte'
                  }
                >
                  {activeIntel.positioning.shortInterestFloatPct}% (
                  {activeIntel.positioning.daysToCover}j)
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface-douce rounded-full overflow-hidden">
                <div
                  className="h-full bg-erreur-texte"
                  style={{
                    // NOMBRE-NON-MONETAIRE : taux public d'intérêt à la baisse (short float)
                    width: `${Math.min(100, activeIntel.positioning.shortInterestFloatPct * 4)}%`,
                  }}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-bordure grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="block font-sans text-[10px] text-texte-doux">
                  Options Put/Call
                </span>
                <span
                  className={
                    activeIntel.positioning.optionsPutCallRatio <= 0.85
                      ? 'text-succes-texte font-bold'
                      : activeIntel.positioning.optionsPutCallRatio >= 1.1
                        ? 'text-erreur-texte font-bold'
                        : 'text-texte font-bold'
                  }
                >
                  {activeIntel.positioning.optionsPutCallRatio}x
                </span>
              </div>
              <div>
                <span className="block font-sans text-[10px] text-texte-doux">
                  Rachats d’actions
                </span>
                <span
                  className={
                    activeIntel.forensics.netShareBuybackYieldPct >= 0
                      ? 'text-succes-texte font-bold'
                      : 'text-erreur-texte font-bold'
                  }
                >
                  {formatSignedPct(activeIntel.forensics.netShareBuybackYieldPct, 1)}/an
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 bg-fond/90 border border-bordure rounded-2xl p-5 flex flex-col justify-between space-y-3">
          <div className="pb-2 border-b border-bordure flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-texte">
              Impacts Actualités ({activeIntel.newsEvents.length})
            </h3>
            <span className="font-mono text-xs text-texte-doux">
              {activeUniv ? activeUniv.optimalCanadianWrapper : 'CELI / REER'}
            </span>
          </div>

          <svg
            width="100%"
            viewBox="0 0 320 142"
            role="img"
            aria-label="Nuage d’impact des actualités récentes"
            className="block select-none"
          >
            <line
              x1="28"
              y1="71"
              x2="308"
              y2="71"
              stroke={VALORIA_PALETTE.axisZinc}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x="4"
              y="20"
              fill={VALORIA_PALETTE.emerald}
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              +100
            </text>
            <text
              x="10"
              y="74"
              fill={VALORIA_PALETTE.mutedZinc}
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              0
            </text>
            <text
              x="4"
              y="132"
              fill={VALORIA_PALETTE.rose}
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              −100
            </text>

            {activeIntel.newsEvents.map((ev, idx) => {
              const x = 290 - Math.min(250, ev.daysAgo * 8.2) - idx * 18;
              const cx = Math.max(42, Math.min(296, x));
              const cy = 71 - (ev.sentimentScore / 100) * 54;
              const r = Math.max(
                6,
                Math.min(13, 6 + Math.abs(ev.returnShockBps) / 45)
              );
              const fill =
                ev.sentimentScore >= 12
                  ? VALORIA_PALETTE.emerald
                  : ev.sentimentScore <= -12
                    ? VALORIA_PALETTE.rose
                    : VALORIA_PALETTE.textZinc;

              return (
                <g
                  key={ev.id}
                  onMouseEnter={() => setHoveredEventId(ev.id)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={fill}
                    fillOpacity="0.85"
                    stroke={VALORIA_PALETTE.bgDeep}
                    strokeWidth="1.5"
                  />
                  <text
                    x={cx}
                    y={cy - r - 3}
                    textAnchor="middle"
                    fill={VALORIA_PALETTE.textZincLight}
                    fontSize="8.5"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {ev.sentimentScore >= 0
                      ? `+${ev.sentimentScore}`
                      : ev.sentimentScore}
                  </text>
                </g>
              );
            })}
          </svg>

          {hoveredNews && (
            <div className="pt-2 border-t border-bordure space-y-1 text-xs">
              <div className="flex items-center justify-between font-mono text-[10px] text-texte-doux">
                <span>
                  {hoveredNews.publisher} · {hoveredNews.dateIso}
                </span>
                <span
                  className={
                    hoveredNews.returnShockBps >= 0
                      ? 'text-succes-texte font-bold'
                      : 'text-erreur-texte font-bold'
                  }
                >
                  {hoveredNews.returnShockBps >= 0 ? '+' : ''}
                  {hoveredNews.returnShockBps} pb/an
                </span>
              </div>
              <div className="text-texte font-medium line-clamp-2 leading-snug">
                {(() => {
                  const safeUrl = safeExternalHttpUrl(hoveredNews.url);
                  return safeUrl ? (
                    <a
                      href={safeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-texte inline-flex items-center gap-1"
                    >
                      <span>{hoveredNews.title}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    hoveredNews.title
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </ScrollReveal>
        </>
      )}

      {swarmFocusView === 'dials_news' && (
        <>
      {/* =================================================================== */}
      {/* 6. D3 WATCHLIST DIALS & VERIFIED INSTITUTIONAL NEWS CORRELATION     */}
      {/* =================================================================== */}
      <D3WatchlistSentimentDials
        watchlistIds={watchlistIds}
        selectedAssetId={activeIntel.assetId}
        multiAgent={multiAgent}
        universe={universe}
        institutionalNews={institutionalNews}
        onSelectAsset={(id) => setSelectedAssetId(id)}
        onAddWatchlistAsset={onAddWatchlistAsset}
        onRemoveWatchlistAsset={onRemoveWatchlistAsset}
      />

      <D3InstitutionalNewsCorrelationSection
        institutionalNews={institutionalNews}
        selectedAssetId={activeIntel.assetId}
        heldAssetIds={heldAssetIds}
        watchlistIds={watchlistIds}
        isFetchingLiveInstitutional={isFetchingLiveInstitutional}
        liveSourcesVerified={liveSourcesVerified}
        onRefreshInstitutionalSources={onRefreshInstitutionalSources}
        onSelectAsset={(id) => setSelectedAssetId(id)}
        onInspectAssetModal={onInspectAssetModal}
      />
        </>
      )}
    </div>
  );
};

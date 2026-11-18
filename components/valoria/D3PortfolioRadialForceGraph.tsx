import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Crosshair,
  GitBranch,
  Orbit,
  Plus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import {
  type OrbitalLayoutMode,
  type PortfolioOrbitalGraphModel,
  type PortfolioOrbitalNode,
} from '../../services/valoria/orbitalFocusEngine';
import {
  formatCompactEur,
  formatEur,
  formatSignedEur,
} from '../../services/valoria/valoriaFormatters';
import { PrivateAmount } from '../ui/PrivateAmount';
import { useFinanceStore } from '../../store/useFinanceStore';

interface D3PortfolioRadialForceGraphProps {
  graph: PortfolioOrbitalGraphModel;
  layoutMode: OrbitalLayoutMode;
  onChangeLayoutMode: (mode: OrbitalLayoutMode) => void;
  focusedAssetId: string | null;
  onSelectFocusAsset: (assetId: string | null) => void;
  onExecuteOrbitalAdjustment: (assetId: string, deltaCad: number) => void;
  onAdjustAvailableCash: (nextCashCad: number) => void;
}

const ORBIT_SPRING = {
  type: 'spring' as const,
  stiffness: 112,
  damping: 19,
  mass: 0.9,
};

export const D3PortfolioRadialForceGraph: React.FC<
  D3PortfolioRadialForceGraphProps
> = ({
  graph,
  layoutMode,
  onChangeLayoutMode,
  focusedAssetId,
  onSelectFocusAsset,
  onExecuteOrbitalAdjustment,
  onAdjustAvailableCash,
}) => {
  const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
  const prefersReducedMotion = useReducedMotion();
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const activeHighlightId = focusedAssetId ?? hoveredNodeId;

  const quickAdjustments = useMemo(() => {
    return graph.nodes
      .filter((n) => n.id !== 'CASH' && Math.abs(n.recommendedDeltaCad) >= 250)
      .sort(
        (a, b) =>
          Math.abs(b.recommendedDeltaCad) - Math.abs(a.recommendedDeltaCad)
      )
      .slice(0, 4);
  }, [graph.nodes]);

  const activeNode = useMemo(
    () =>
      activeHighlightId
        ? graph.nodes.find((n) => n.id === activeHighlightId) ?? null
        : graph.coreNode,
    [activeHighlightId, graph.nodes, graph.coreNode]
  );

  const transitionSpec = prefersReducedMotion
    ? { duration: 0 }
    : ORBIT_SPRING;

  return (
    <section
      aria-label="Visualisation orbitale D3 du portefeuille centrée sur l'actif principal"
      data-testid="d3-portfolio-radial-force-section"
      className={`relative rounded-2xl border p-5 sm:p-7 transition-all duration-300 ${
        focusedAssetId
          ? 'z-40 bg-fond/95 border-bordure-champ shadow-2xl'
          : 'bg-surface/25 border-bordure'
      }`}
    >
      {/* Header & Layout Mode Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-bordure">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-texte-doux">
            <span className="font-medium text-texte">
              Centre de gravité :{' '}
              <strong className="font-mono text-texte">
                {graph.coreNode?.ticker ?? '—'}
              </strong>{' '}
              ({graph.coreNode?.weightPct.toFixed(1) ?? 0} %)
            </span>
            <span aria-hidden="true" className="text-texte-doux">
              ·
            </span>
            <span>Cliquez un actif pour isoler son mode Focus</span>
          </div>
          <p className="text-xs text-texte-doux">
            Rayon proportionnel au poids ($ CAD) · Distance selon la corrélation (ρ) avec l’actif central.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {focusedAssetId && (
            <button
              type="button"
              onClick={() => onSelectFocusAsset(null)}
              className="min-w-11 min-h-11 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-sur-accent bg-accent hover:bg-accent-fonce rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Quitter Focus</span>
            </button>
          )}

          {/* Segmented D3 Layout Selector with Fluid Pill */}
          <div
            role="group"
            aria-label="Mode de disposition D3"
            className="inline-flex items-center gap-0.5 p-1 bg-fond/90 border border-bordure rounded-lg shrink-0"
          >
            {(
              [
                { id: 'radial', label: 'Orbite Radiale', Icon: Orbit },
                { id: 'force', label: 'Force Dirigée D3', Icon: GitBranch },
              ] as const
            ).map(({ id, label, Icon }) => {
              const isSelected = layoutMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeLayoutMode(id)}
                  aria-pressed={isSelected}
                  className={`min-w-11 relative min-h-11 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'text-texte'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="orbital-d3-mode-pill"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                      className="absolute inset-0 bg-surface-douce/90 rounded-md"
                    />
                  )}
                  <Icon className="relative z-10 w-3.5 h-3.5" />
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Cash Reserve Adjuster */}
          <button
            type="button"
            data-testid="orbital-cash-adjust-btn"
            onClick={() =>
              onAdjustAvailableCash(
                graph.cashReserveCad >= 10000 ? 0 : graph.cashReserveCad + 2500
              )
            }
            title="Simuler un ajout ou redéploiement de liquidités $ CAD dans l'orbite"
            className="min-w-11 min-h-11 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-mono tabular-nums text-texte bg-fond/90 hover:bg-surface border border-bordure rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5 text-succes-texte" />
            <span>Liquidités {formatCompactEur(graph.cashReserveCad)}</span>
            <span className="text-succes-texte">
              {graph.cashReserveCad >= 10000 ? '· Réinitialiser' : '+2,5 k$'}
            </span>
          </button>
        </div>
      </div>

      {/* Main Split Stage: Breathable Central Animated SVG + Unboxed Sober Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-6 items-center">
        {/* Left/Center: Interactive D3 + Framer Motion Orbital Canvas */}
        <div className="lg:col-span-8 flex flex-col items-center justify-center">
          <div className="w-full max-w-[520px] relative">
            <svg
              data-testid="d3-portfolio-orbital-force-svg"
              viewBox="-250 -236 500 472"
              role="img"
              aria-label="Graphique radial et de force dirigée D3 du portefeuille actuel avec transitions orbitales fluides"
              className="w-full h-auto select-none overflow-visible"
              onClick={(e) => {
                if (e.target === e.currentTarget && focusedAssetId) {
                  onSelectFocusAsset(null);
                }
              }}
            >
              <defs>
                <radialGradient id="orbital-core-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={VALORIA_PALETTE.emerald} stopOpacity="0.16" />
                  <stop offset="65%" stopColor={VALORIA_PALETTE.bgDeep} stopOpacity="0.03" />
                  <stop offset="100%" stopColor={VALORIA_PALETTE.bgDeep} stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Subtle central gravity field */}
              <circle cx="0" cy="0" r="222" fill="url(#orbital-core-glow)" />

              {/* Concentric Correlation & Opportunity Guide Orbits */}
              {graph.rings.map((ring) => {
                const isRecRing = ring.id === 'recommendation';
                return (
                  <g
                    key={ring.id}
                    opacity={focusedAssetId ? 0.22 : 1}
                    className="transition-opacity duration-300 pointer-events-none"
                  >
                    <circle
                      cx="0"
                      cy="0"
                      r={ring.radius}
                      fill="none"
                      stroke={isRecRing ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.gridZinc}
                      strokeOpacity={isRecRing ? 0.28 : 0.72}
                      strokeWidth={isRecRing ? 1 : 0.85}
                      strokeDasharray={isRecRing ? '4 5' : '2 4'}
                    />
                    {layoutMode === 'radial' && (
                      <text
                        x={Math.cos(-Math.PI * 0.68) * ring.radius}
                        y={Math.sin(-Math.PI * 0.68) * ring.radius}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={isRecRing ? VALORIA_PALETTE.emeraldLight : VALORIA_PALETTE.textZinc}
                        fillOpacity={0.85}
                        fontSize="8"
                        fontFamily="var(--font-mono)"
                        stroke={VALORIA_PALETTE.bgDeep}
                        strokeWidth="5"
                        strokeLinejoin="round"
                        paintOrder="stroke"
                      >
                        {ring.corrRangeLabel}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Animated Correlation & Recommendation Tether Links */}
              {graph.links.map((link) => {
                const isConnectedToActive =
                  activeHighlightId !== null &&
                  (link.sourceId === activeHighlightId ||
                    link.targetId === activeHighlightId);

                const isDimmedByFocus =
                  focusedAssetId !== null &&
                  link.sourceId !== focusedAssetId &&
                  link.targetId !== focusedAssetId;

                const strokeColor =
                  link.kind === 'recommendation_vector'
                    ? VALORIA_PALETTE.emerald
                    : link.correlation >= 0.58
                      ? VALORIA_PALETTE.sky
                      : link.correlation <= 0.15
                        ? VALORIA_PALETTE.gold
                        : VALORIA_PALETTE.strokeZinc;

                const targetOpacity = isDimmedByFocus
                  ? 0.05
                  : isConnectedToActive
                    ? 0.82
                    : link.kind === 'cross_asset_corr'
                      ? 0.22
                      : 0.34;

                return (
                  <motion.line
                    key={link.id}
                    initial={false}
                    animate={{
                      x1: link.x1,
                      y1: link.y1,
                      x2: link.x2,
                      y2: link.y2,
                      opacity: targetOpacity,
                    }}
                    transition={transitionSpec}
                    stroke={strokeColor}
                    strokeWidth={
                      isConnectedToActive
                        ? 1.9
                        : link.kind === 'core_tether'
                          ? 1.2
                          : 0.95
                    }
                    strokeDasharray={
                      link.kind === 'recommendation_vector'
                        ? '4 4'
                        : link.correlation < 0.2
                          ? '2 3'
                          : undefined
                    }
                    pointerEvents="none"
                  />
                );
              })}

              {/* Animated Orbital Nodes (Core + Holdings + Cash + Buy Recommendations) */}
              {graph.nodes.map((node) => {
                const isFocused = focusedAssetId === node.id;
                const isDimmed =
                  focusedAssetId !== null && focusedAssetId !== node.id;
                const isHovered = hoveredNodeId === node.id;
                const isBuySignal =
                  node.signalAction === 'ACHETER' ||
                  node.signalAction === 'RENFORCER';
                const isSellSignal =
                  node.signalAction === 'VENDRE' ||
                  node.signalAction === 'ALLÉGER';

                const ringAccent = isBuySignal
                  ? VALORIA_PALETTE.emerald
                  : isSellSignal
                    ? VALORIA_PALETTE.rose
                    : node.colorHex;

                const subLabel = isPrivacyMode
                  ? '•••'
                  : node.kind === 'buy_recommendation'
                    ? `+${formatCompactEur(node.recommendedDeltaCad)}`
                    : node.id === 'CASH'
                      ? formatCompactEur(node.currentValueCad)
                      // NOMBRE-NON-MONETAIRE : masqué en Mode Discret ci-dessus
                      : `${node.weightPct.toFixed(0)}%`;

                return (
                  <motion.g
                    key={node.id}
                    data-testid={`orbital-node-${node.id}`}
                    data-node-kind={node.kind}
                    data-node-weight={node.weightPct}
                    initial={false}
                    animate={{
                      x: node.x,
                      y: node.y,
                      opacity: isDimmed ? 0.14 : 1,
                      scale: isFocused ? 1.12 : isHovered ? 1.05 : 1,
                    }}
                    transition={transitionSpec}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectFocusAsset(isFocused ? null : node.id);
                    }}
                    className="cursor-pointer"
                  >
                    {/* Focus Spotlight Outer Ring */}
                    {(isFocused || isHovered) && (
                      <motion.circle
                        initial={false}
                        animate={{ r: node.nodeRadius + 7 }}
                        transition={transitionSpec}
                        fill="none"
                        stroke={isFocused ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.lineZinc}
                        strokeWidth={isFocused ? 2 : 1.2}
                        strokeOpacity={isFocused ? 0.95 : 0.5}
                      />
                    )}

                    {/* Signal / Recommendation Outer Halo */}
                    {(isBuySignal || isSellSignal || node.kind === 'core_holding') && (
                      <motion.circle
                        initial={false}
                        animate={{ r: node.nodeRadius + 3.2 }}
                        transition={transitionSpec}
                        fill="none"
                        stroke={ringAccent}
                        strokeWidth={node.kind === 'core_holding' ? 1.6 : 1.3}
                        strokeOpacity={0.78}
                        strokeDasharray={
                          node.kind === 'buy_recommendation' ? '3 2.5' : undefined
                        }
                      />
                    )}

                    {/* Main Node Body */}
                    <motion.circle
                      initial={false}
                      animate={{ r: node.nodeRadius }}
                      transition={transitionSpec}
                      fill={
                        node.kind === 'buy_recommendation'
                          ? VALORIA_PALETTE.bgEmeraldTint
                          : VALORIA_PALETTE.bgNode
                      }
                      stroke={node.colorHex}
                      strokeWidth={node.kind === 'core_holding' ? 2.6 : 1.8}
                    />

                    {/* Ticker Label */}
                    <text
                      x="0"
                      y={node.nodeRadius >= 26 ? -4 : -2.5}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={VALORIA_PALETTE.textBright}
                      fontSize={node.kind === 'core_holding' ? '11.5' : '9.5'}
                      fontWeight="700"
                      fontFamily="var(--font-mono)"
                      pointerEvents="none"
                    >
                      {node.ticker}
                    </text>

                    {/* Weight % or Recommended Buy Amount */}
                    <text
                      x="0"
                      y={node.nodeRadius >= 26 ? 9 : 8}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={
                        node.kind === 'buy_recommendation'
                          ? VALORIA_PALETTE.emeraldLight
                          : VALORIA_PALETTE.textZinc
                      }
                      fontSize={node.kind === 'core_holding' ? '9.5' : '8.2'}
                      fontWeight="600"
                      fontFamily="var(--font-mono)"
                      pointerEvents="none"
                    >
                      {subLabel}
                    </text>

                    {/* Delta Callout Tag Below Held Node when Rebalancing Recommended */}
                    {node.isHeld &&
                      node.id !== 'CASH' &&
                      Math.abs(node.recommendedDeltaCad) >= 400 && (
                        <text
                          x="0"
                          y={node.nodeRadius + 12}
                          textAnchor="middle"
                          fill={
                            node.recommendedDeltaCad > 0
                              ? VALORIA_PALETTE.emeraldLight
                              : VALORIA_PALETTE.roseLight
                          }
                          fontSize="8"
                          fontWeight="600"
                          fontFamily="var(--font-mono)"
                          pointerEvents="none"
                        >
                          {node.recommendedDeltaCad > 0 ? '▲ +' : '▼ '}
                          {formatCompactEur(node.recommendedDeltaCad)}
                        </text>
                      )}
                  </motion.g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Right Column: Unboxed Sober Active Readout + Subtle Orbital Adjustments */}
        <div
          className={`lg:col-span-4 space-y-6 lg:border-l lg:border-bordure lg:pl-7 transition-opacity duration-300 ${
            focusedAssetId ? 'opacity-30' : 'opacity-100'
          }`}
        >
          {/* Active / Hovered Orbital Node Summary (Unboxed — No Card Within Card) */}
          {activeNode && (
            <div className="space-y-3 pb-5 border-b border-bordure">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0 truncate">
                  <span className="font-mono font-bold text-sm text-texte">
                    {activeNode.ticker}
                  </span>
                  <span className="text-xs text-texte-doux ml-1.5 truncate">
                    · {activeNode.name}
                  </span>
                </div>
                <span className="font-mono tabular-nums text-xs text-texte-doux shrink-0">
                  {activeNode.kind === 'core_holding'
                    ? 'Centre n°1'
                    : `ρ ${activeNode.corrWithCore >= 0 ? '+' : ''}${activeNode.corrWithCore.toFixed(2)}`}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums text-xs">
                <span className="font-sans text-texte-doux">
                  {activeNode.isHeld
                    ? 'Pondération actuelle'
                    : 'Candidat recommandé'}
                </span>
                <PrivateAmount className="font-semibold text-texte">
                  {activeNode.isHeld
                    ? `${formatEur(activeNode.currentValueCad, 0)} (${activeNode.weightPct.toFixed(1)} %)`
                    : `+${formatEur(activeNode.recommendedDeltaCad, 0)} cible`}
                </PrivateAmount>
              </div>

              <button
                type="button"
                onClick={() => onSelectFocusAsset(activeNode.id)}
                className="w-full min-h-11 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-lg transition-colors duration-150 whitespace-nowrap cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5 text-succes-texte" />
                <span>Isoler {activeNode.ticker} en mode Focus</span>
              </button>
            </div>
          )}

          {/* Dynamic Orbital Adjustments List (Sober Ghost/Outline Buttons) */}
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-medium text-texte truncate">
                Ajustements suggérés
              </h3>
              <span className="font-mono tabular-nums text-[11px] text-texte-doux whitespace-nowrap shrink-0">
                Orbite dynamique
              </span>
            </div>

            {quickAdjustments.length === 0 ? (
              <p className="text-xs text-texte-doux py-2">
                Les pondérations actuelles sont équilibrées.
              </p>
            ) : (
              <div className="divide-y divide-bordure">
                {quickAdjustments.map((item: PortfolioOrbitalNode) => {
                  const isBuy = item.recommendedDeltaCad > 0;
                  return (
                    <div
                      key={`orb-adj-${item.id}`}
                      onMouseEnter={() => setHoveredNodeId(item.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      className="py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectFocusAsset(item.id)}
                        className="min-h-11 min-w-0 text-left flex-1 group cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          {isBuy ? (
                            <TrendingUp className="w-3.5 h-3.5 text-succes-texte shrink-0" />
                          ) : (
                            <TrendingDown className="w-3.5 h-3.5 text-erreur-texte shrink-0" />
                          )}
                          <span className="font-mono font-semibold text-texte group-hover:underline">
                            {item.ticker}
                          </span>
                          <PrivateAmount className="font-mono tabular-nums text-[11px] text-texte-doux">
                            {item.weightPct.toFixed(0)}% →{' '}
                            {item.targetWeightPct.toFixed(0)}%
                          </PrivateAmount>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onExecuteOrbitalAdjustment(
                            item.id,
                            item.recommendedDeltaCad
                          )
                        }
                        aria-label={`${isBuy ? 'Acheter' : 'Alléger'} ${item.ticker} (${formatSignedEur(item.recommendedDeltaCad, 0)})`}
                        className={`min-w-11 min-h-11 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono tabular-nums font-medium border transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                          isBuy
                            ? 'bg-succes-fond text-succes-texte border-succes-texte/40 hover:bg-succes-fond hover:text-succes-texte'
                            : 'bg-erreur-fond text-erreur-texte border-erreur-texte/40 hover:bg-erreur-fond hover:text-erreur-texte'
                        }`}
                      >
                        {isBuy ? (
                          <Plus className="w-3 h-3 shrink-0" />
                        ) : (
                          <Sparkles className="w-3 h-3 shrink-0" />
                        )}
                        <span>{formatSignedEur(item.recommendedDeltaCad, 0)}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quiet Unboxed Legend */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-texte-doux pt-1">
            <span>Halo vert : Renforcer</span>
            <span aria-hidden="true">·</span>
            <span>Halo rose : Alléger</span>
            <span aria-hidden="true">·</span>
            <span>Pointillés : Hors portefeuille</span>
          </div>
        </div>
      </div>
    </section>
  );
};

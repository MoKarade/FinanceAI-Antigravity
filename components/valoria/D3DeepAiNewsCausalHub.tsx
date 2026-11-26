import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import {
  ExternalLink,
  MessageSquare,
  Play,
  RefreshCw,
} from 'lucide-react';
import type {
  CentralRadialShockNode,
  DeepAiNewsIntelligenceLab,
  LiveGeminiDeepSynthesisPayload,
  NarrativePriceDivergenceItem,
  PortfolioSliceId,
} from '../../services/valoria/portfolioOrbitalIntelligence';
import { classifyAssetAllocationSlice } from '../../services/valoria/portfolioOrbitalIntelligence';
import { D3PriceSparkline30d } from './D3PriceSparkline30d';
import {
  formatCompactEur,
  formatEur,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';
import { safeExternalHttpUrl } from '../../utils/safeExternalUrl';

interface D3DeepAiNewsCausalHubProps {
  lab: DeepAiNewsIntelligenceLab;
  focusSliceId: PortfolioSliceId | null;
  onClearFocusSlice?: () => void;
  liveSynthesis: LiveGeminiDeepSynthesisPayload | null;
  isRunningSynthesis: boolean;
  onRunLiveSynthesis: () => void;
  onInspectAsset: (assetId: string) => void;
  onOpenAssetInDialogue: (assetId: string) => void;
}

interface ComputedOrbitalNode {
  node: CentralRadialShockNode;
  cx: number;
  cy: number;
  r: number;
  arcPath: string;
  shockCurvePath: string;
  strokeColor: string;
  strokeWidth: number;
}

export const D3DeepAiNewsCausalHub: React.FC<D3DeepAiNewsCausalHubProps> = ({
  lab,
  focusSliceId,
  onClearFocusSlice,
  liveSynthesis,
  isRunningSynthesis,
  onRunLiveSynthesis,
  onInspectAsset,
  onOpenAssetInDialogue,
}) => {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [matrixFilter, setMatrixFilter] = useState<
    'all' | 'opportunities' | 'risks' | 'held'
  >('all');

  const activeNodeId = hoveredAssetId ?? selectedAssetId;

  const activeNode = useMemo(
    () => lab.radialNodes.find((n) => n.id === activeNodeId) ?? null,
    [lab.radialNodes, activeNodeId]
  );

  // Central D3 Radial Shock & Bayesian Conviction Wheel (8 evenly spaced orbital slots so nodes never overlap)
  const displayedRadialNodes = useMemo(
    () => lab.radialNodes.slice(0, 8),
    [lab.radialNodes]
  );

  const orbitalGeometry = useMemo<ComputedOrbitalNode[]>(() => {
    if (displayedRadialNodes.length === 0) return [];

    const pieGen = d3
      .pie<CentralRadialShockNode>()
      .value(() => 1)
      .sort(null)
      .padAngle(0.045);

    const arcs = pieGen(displayedRadialNodes);
    const rScale = d3
      .scaleSqrt()
      .domain([4, 38])
      .range([13.5, 19.5])
      .clamp(true);

    return arcs.map((arcDatum) => {
      const midAngle =
        (arcDatum.startAngle + arcDatum.endAngle) / 2 - Math.PI / 2;
      const orbitRadius = 105;
      const cx = Math.cos(midAngle) * orbitRadius;
      const cy = Math.sin(midAngle) * orbitRadius;
      const r = rScale(arcDatum.data.weightOrRelevancePct);

      // Outer sector identity arc
      const outerArcGen = d3
        .arc<d3.PieArcDatum<CentralRadialShockNode>>()
        .innerRadius(132)
        .outerRadius(138)
        .cornerRadius(2.5);

      // Curved Bezier shock transmission path from Macro/News Core (r=44) to Asset Node
      const startR = 45;
      const sx = Math.cos(midAngle) * startR;
      const sy = Math.sin(midAngle) * startR;
      const endR = orbitRadius - r - 2;
      const ex = Math.cos(midAngle) * endR;
      const ey = Math.sin(midAngle) * endR;

      const swirlOffset =
        arcDatum.data.tone === 'positive'
          ? 0.22
          : arcDatum.data.tone === 'negative'
            ? -0.22
            : 0.08;
      const ctrlR = (startR + endR) * 0.52;
      const ctrlX = Math.cos(midAngle + swirlOffset) * ctrlR;
      const ctrlY = Math.sin(midAngle + swirlOffset) * ctrlR;
      const shockCurvePath = `M ${sx.toFixed(1)},${sy.toFixed(1)} Q ${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;

      const strokeColor =
        arcDatum.data.tone === 'positive'
          ? VALORIA_PALETTE.emerald
          : arcDatum.data.tone === 'negative'
            ? VALORIA_PALETTE.rose
            : VALORIA_PALETTE.mutedZinc;

      const impulseMagnitude = Math.abs(arcDatum.data.newsImpulseScore);
      const strokeWidth = Math.max(
        1.4,
        Math.min(3.4, 1.3 + impulseMagnitude / 34)
      );

      return {
        node: arcDatum.data,
        cx,
        cy,
        r,
        arcPath: outerArcGen(arcDatum) ?? '',
        shockCurvePath,
        strokeColor,
        strokeWidth,
      };
    });
  }, [displayedRadialNodes]);

  // Filter causal chains if an asset or slice is focused
  const visibleCausalChains = useMemo(() => {
    if (selectedAssetId) {
      const matching = lab.causalChains.filter((c) =>
        c.impactedAssetIds.includes(selectedAssetId)
      );
      if (matching.length > 0) return matching;
    }
    if (focusSliceId) {
      const matching = lab.causalChains.filter((c) =>
        c.impactedAssetIds.some(
          (id) => classifyAssetAllocationSlice(id) === focusSliceId
        )
      );
      if (matching.length > 0) return matching;
    }
    return lab.causalChains;
  }, [lab.causalChains, selectedAssetId, focusSliceId]);

  const filteredDivergenceRows = useMemo<NarrativePriceDivergenceItem[]>(() => {
    return lab.divergenceRows.filter((row) => {
      if (selectedAssetId && row.assetId !== selectedAssetId) {
        return false;
      }
      if (matrixFilter === 'opportunities') {
        return (
          row.regimeCode === 'OPPORTUNITE_CONTRARIANTE' ||
          row.regimeCode === 'CATALYSEUR_CONFIRME'
        );
      }
      if (matrixFilter === 'risks') {
        return (
          row.regimeCode === 'EUPHORIE_PRICEE' ||
          row.regimeCode === 'PIEGE_FONDAMENTAL'
        );
      }
      if (matrixFilter === 'held') {
        return row.isHeld;
      }
      return true;
    });
  }, [lab.divergenceRows, selectedAssetId, matrixFilter]);

  const totalCapitalForSplit = Math.max(
    1,
    lab.capitalBullishAlignedCad + lab.capitalVulnerableToShocksCad
  );
  const alignedSharePct = Math.round(
    (lab.capitalBullishAlignedCad / totalCapitalForSplit) * 100
  );

  const executiveText =
    liveSynthesis?.executiveThesis || lab.executiveAiThesis;
  const macroText =
    liveSynthesis?.macroRegimeReading || lab.macroRegimeSummary;

  return (
    <div className="space-y-6">
      {/* ===================================================================== */}
      {/* TOP 3-COLUMN ORBITAL ARCHITECTURE:                                    */}
      {/* Left: Causal Chains · CENTER: D3 Radial Shock Hub · Right: Live AI    */}
      {/* ===================================================================== */}
      <section
        aria-label="Radar causal IA et actualités en architecture orbitale"
        className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-stretch"
      >
        {/* CENTER GRAPHIC (Order 1 on Mobile, Order 2 Center on Desktop) */}
        <div className="order-1 lg:order-2 lg:col-span-4 bg-surface/55 border border-bordure rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <h2 className="font-bold text-texte">
              Roue Causale IA ↔ Actus
            </h2>
            {selectedAssetId ? (
              <button
                type="button"
                onClick={() => setSelectedAssetId(null)}
                className="min-h-11 font-mono text-[11px] text-succes-texte hover:text-succes-texte underline whitespace-nowrap cursor-pointer"
              >
                Tout le réseau
              </button>
            ) : (
              <span className="font-mono tabular-nums text-[11px] text-texte-doux">
                1er &amp; 2e ordre
              </span>
            )}
          </div>

          {/* Central D3 Radial Contagion & Conviction SVG */}
          <div className="relative flex items-center justify-center my-auto">
            <svg
              data-testid="d3-causal-hub-svg"
              viewBox="-155 -155 310 310"
              role="img"
              aria-label="Graphique radial D3 reliant le noyau d'actualités macroéconomiques aux actifs du portefeuille"
              className="w-full max-w-[276px] sm:max-w-[292px] h-auto select-none overflow-visible"
            >
              {/* Concentric subtle orbital rings */}
              <circle
                cx="0"
                cy="0"
                r="104"
                fill="none"
                stroke={VALORIA_PALETTE.gridZinc}
                strokeWidth="0.9"
                strokeDasharray="2 4"
              />
              <circle
                cx="0"
                cy="0"
                r="72"
                fill="none"
                stroke={VALORIA_PALETTE.gridZinc}
                strokeWidth="0.6"
              />

              {/* Outer sector arcs & shock Bezier links */}
              {orbitalGeometry.map((item) => {
                const isSelected = selectedAssetId === item.node.id;
                const isDimmed =
                  activeNodeId !== null && activeNodeId !== item.node.id;

                return (
                  <g
                    key={`orbit-${item.node.id}`}
                    onMouseEnter={() => setHoveredAssetId(item.node.id)}
                    onMouseLeave={() => setHoveredAssetId(null)}
                    onClick={() =>
                      setSelectedAssetId(isSelected ? null : item.node.id)
                    }
                    className="cursor-pointer"
                  >
                    {/* Outer Sector Identity Arc */}
                    <path
                      d={item.arcPath}
                      fill={item.node.colorHex}
                      fillOpacity={isDimmed ? 0.22 : 0.88}
                    />

                    {/* Curved Shock Transmission Link */}
                    <path
                      d={item.shockCurvePath}
                      fill="none"
                      stroke={item.strokeColor}
                      strokeWidth={isSelected ? item.strokeWidth + 1 : item.strokeWidth}
                      strokeOpacity={isDimmed ? 0.18 : 0.78}
                      strokeDasharray={item.node.isHeld ? undefined : '3 2'}
                    />

                    {/* Satellite Asset Node */}
                    <circle
                      cx={item.cx}
                      cy={item.cy}
                      r={isSelected ? item.r + 2 : item.r}
                      fill={VALORIA_PALETTE.bgDeep}
                      stroke={isSelected ? VALORIA_PALETTE.textBright : item.strokeColor}
                      strokeWidth={isSelected ? 2.4 : 1.7}
                      opacity={isDimmed ? 0.35 : 1}
                    >
                      <title>
                        {`${item.node.ticker} (${item.node.sliceLabel}) · Conviction Bayésienne ${item.node.bayesianConvictionPct} % · ${item.node.regimeLabel}`}
                      </title>
                    </circle>

                    <text
                      x={item.cx}
                      y={item.cy - 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={VALORIA_PALETTE.textBright}
                      fontSize="8.5"
                      fontWeight="700"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      opacity={isDimmed ? 0.45 : 1}
                      pointerEvents="none"
                    >
                      {item.node.ticker.split('.')[0].slice(0, 5)}
                    </text>

                    <text
                      x={item.cx}
                      y={item.cy + 7.5}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={
                        item.node.tone === 'positive'
                          ? VALORIA_PALETTE.emeraldLight
                          : item.node.tone === 'negative'
                            ? VALORIA_PALETTE.roseLight
                            : VALORIA_PALETTE.textZinc
                      }
                      fontSize="7.2"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      opacity={isDimmed ? 0.45 : 0.95}
                      pointerEvents="none"
                    >
                      {item.node.bayesianConvictionPct}%
                    </text>
                  </g>
                );
              })}

              {/* Central Macro + News Core */}
              <circle
                cx="0"
                cy="0"
                r="45"
                fill={VALORIA_PALETTE.bgDeep}
                stroke={VALORIA_PALETTE.axisZinc}
                strokeWidth="1.4"
              />

              <text
                x="0"
                y="-17"
                textAnchor="middle"
                fill={VALORIA_PALETTE.textZinc}
                fontSize="8.5"
                fontWeight="600"
              >
                {activeNode ? activeNode.ticker : 'Noyau Bayésien'}
              </text>

              <text
                x="0"
                y="-1"
                textAnchor="middle"
                fill={VALORIA_PALETTE.textBright}
                fontSize="15"
                fontWeight="700"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {activeNode
                  ? `${activeNode.bayesianConvictionPct} %`
                  : `${lab.bayesianPortfolioConfidencePct} %`}
              </text>

              <text
                x="0"
                y="14"
                textAnchor="middle"
                fill={
                  activeNode
                    ? activeNode.tone === 'positive'
                      ? VALORIA_PALETTE.emeraldLight
                      : activeNode.tone === 'negative'
                        ? VALORIA_PALETTE.roseLight
                        : VALORIA_PALETTE.textZincLight
                    : lab.netExpectedShockCad >= 0
                      ? VALORIA_PALETTE.emeraldLight
                      : VALORIA_PALETTE.roseLight
                }
                fontSize="8.5"
                fontWeight="600"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {activeNode
                  ? `DCF ${formatSignedPct(activeNode.dcfUpsidePct, 0)}`
                  : formatSignedEur(lab.netExpectedShockCad, 0)}
              </text>

              <text
                x="0"
                y="27"
                textAnchor="middle"
                fill={VALORIA_PALETTE.mutedZinc}
                fontSize="7.5"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {activeNode
                  ? `Actu ${activeNode.newsImpulseScore >= 0 ? '+' : ''}${activeNode.newsImpulseScore}`
                  : 'Impact net estimé'}
              </text>
            </svg>
          </div>

          {/* Accessible Quick Satellite Selector Buttons */}
          <div
            role="group"
            aria-label="Cibler un actif dans le réseau causal"
            className="flex flex-wrap items-center justify-center gap-1.5 pt-2 border-t border-bordure"
          >
            <button
              type="button"
              onClick={() => setSelectedAssetId(null)}
              aria-pressed={selectedAssetId === null}
              className={`min-w-11 min-h-11 px-2.5 py-1 rounded-lg text-[11px] font-mono tabular-nums transition-colors whitespace-nowrap cursor-pointer ${
                selectedAssetId === null
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'bg-fond text-texte hover:text-texte border border-bordure'
              }`}
            >
              Tous
            </button>
            {lab.radialNodes.slice(0, 7).map((node) => {
              const isSelected = selectedAssetId === node.id;
              return (
                <button
                  key={`node-btn-${node.id}`}
                  type="button"
                  onClick={() =>
                    setSelectedAssetId(isSelected ? null : node.id)
                  }
                  aria-pressed={isSelected}
                  className={`min-w-11 min-h-11 px-2 py-1 rounded-lg text-[11px] font-mono tabular-nums transition-colors whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? 'bg-accent text-sur-accent font-semibold'
                      : 'bg-fond text-texte hover:text-texte border border-bordure'
                  }`}
                >
                  {node.ticker.split('.')[0]}
                </button>
              );
            })}
          </div>
        </div>

        {/* LEFT SATELLITE (Order 2 on Mobile, Order 1 Left on Desktop): 1st & 2nd Order Causal Chains */}
        <div className="order-2 lg:order-1 lg:col-span-4 bg-surface/45 border border-bordure rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="pb-2.5 border-b border-bordure flex items-baseline justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-semibold text-texte">
                Chaînes Causales 1er &amp; 2e Ordre
              </h3>
              {focusSliceId &&
              visibleCausalChains.length < lab.causalChains.length &&
              onClearFocusSlice ? (
                <button
                  type="button"
                  onClick={onClearFocusSlice}
                  className="min-h-11 font-mono tabular-nums text-[11px] text-succes-texte hover:underline shrink-0 cursor-pointer"
                >
                  Voir les {lab.causalChains.length} canaux
                </button>
              ) : (
                <span className="font-mono tabular-nums text-[11px] text-texte-doux shrink-0">
                  {visibleCausalChains.length}{' '}
                  {visibleCausalChains.length === 1 ? 'canal actif' : 'canaux actifs'}
                </span>
              )}
            </div>

            <div className="divide-y divide-bordure max-h-[385px] overflow-y-auto pr-0.5">
              {visibleCausalChains.map((chain) => (
                <div
                  key={chain.id}
                  className="py-3 first:pt-0.5 last:pb-0.5 space-y-2"
                >
                  {/* Unboxed metadata line */}
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-texte-doux">
                    <span className="truncate">{chain.sourceCode}</span>
                    <span className="shrink-0">
                      Fiabilité {chain.confidencePct}% · ~{chain.persistenceDays}j
                    </span>
                  </div>

                  {/* Trigger + Quantified $ CAD Shock */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold text-texte leading-snug">
                      {chain.triggerTitle}
                    </div>
                    <span
                      className={`font-mono tabular-nums text-xs font-bold shrink-0 ${
                        chain.estimatedShockCad >= 0
                          ? 'text-succes-texte'
                          : 'text-erreur-texte'
                      }`}
                    >
                      {chain.estimatedShockCad >= 0 ? '▲ ' : '▼ '}
                      {formatSignedEur(chain.estimatedShockCad, 0)}
                    </span>
                  </div>

                  {/* 1st & 2nd order transmission */}
                  <p className="text-[11px] text-texte leading-relaxed">
                    {chain.firstOrderChannel}
                  </p>
                  <p className="text-[11px] text-texte-doux leading-relaxed">
                    {chain.secondOrderContagion}
                  </p>

                  {/* Counter-Action & Tickers */}
                  <div className="text-[11px] text-succes-texte font-medium">
                    → {chain.aiCounterAction}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2.5 border-t border-bordure flex items-center justify-between text-xs font-mono tabular-nums text-texte-doux">
            <span className="font-sans">Résultante causale estimée</span>
            <strong
              className={
                lab.netExpectedShockCad >= 0
                  ? 'text-succes-texte'
                  : 'text-erreur-texte'
              }
            >
              {formatSignedEur(lab.netExpectedShockCad, 0)}
            </strong>
          </div>
        </div>

        {/* RIGHT SATELLITE (Order 3 on Mobile & Desktop): Live Gemini Web Synthesis & Capital Alignment */}
        <div className="order-3 lg:order-3 lg:col-span-4 bg-surface/45 border border-bordure rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="pb-2.5 border-b border-bordure flex items-center justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-semibold text-texte">
                Synthèse IA &amp; Recherche Direct
              </h3>

              <button
                type="button"
                onClick={onRunLiveSynthesis}
                disabled={isRunningSynthesis}
                className="min-w-11 min-h-11 inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-sur-accent bg-accent hover:bg-accent-fonce disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isRunningSynthesis ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3 fill-current" />
                )}
                <span>
                  {isRunningSynthesis ? 'Analyse en cours…' : 'Scanner IA & Web'}
                </span>
              </button>
            </div>

            {/* Capital Bullish Aligned vs Shock-Vulnerable Split Bar */}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 text-[11px] font-mono tabular-nums">
                <span className="text-succes-texte">
                  Aligné : {formatCompactEur(lab.capitalBullishAlignedCad)}
                </span>
                <span className="text-erreur-texte">
                  Exposé chocs : {formatCompactEur(lab.capitalVulnerableToShocksCad)}
                </span>
              </div>
              <svg
                viewBox="0 0 100 6"
                preserveAspectRatio="none"
                aria-hidden="true"
                className="w-full h-1.5 bg-fond rounded-full overflow-hidden"
              >
                <rect
                  x="0"
                  y="0"
                  width={Math.max(4, alignedSharePct)}
                  height="6"
                  fill={VALORIA_PALETTE.emerald}
                />
                <rect
                  x={Math.max(4, alignedSharePct)}
                  y="0"
                  width={Math.max(0, 100 - alignedSharePct)}
                  height="6"
                  fill={VALORIA_PALETTE.rose}
                />
              </svg>
            </div>

            {/* Executive AI Thesis */}
            <div className="space-y-1.5">
              <div className="text-[11px] text-texte-doux">
                Thèse Exécutive ($ CAD)
              </div>
              <p className="text-xs text-texte leading-relaxed">
                {executiveText}
              </p>
              <p className="text-[11px] text-texte-doux leading-relaxed">
                {macroText}
              </p>
            </div>

            {/* Blind-Spot Risk & Contrarian Opportunity when available */}
            <div className="space-y-2.5 pt-2 border-t border-bordure text-xs">
              <div>
                <span className="font-semibold text-erreur-texte">
                  Angle mort 2e ordre :{' '}
                </span>
                <span className="text-texte">
                  {liveSynthesis?.topBlindSpotRisk ||
                    'Les multiples PER > 50x et bilans en restructuration subissent une double pénalité si les taux longs restent élevés.'}
                </span>
              </div>

              <div>
                <span className="font-semibold text-succes-texte">
                  Asymétrie favorable :{' '}
                </span>
                <span className="text-texte">
                  {liveSynthesis?.topContrarianOpportunity ||
                    'Les leaders profitables temporairement repliés sous leur vraie valeur DCF offrent le meilleur couple rendement/protection.'}
                </span>
              </div>
            </div>

            {/* Verified Web & Institutional Sources */}
            {liveSynthesis?.webSources && liveSynthesis.webSources.length > 0 && (
              <div className="pt-2 border-t border-bordure space-y-1.5">
                <div className="text-[11px] text-texte-doux">
                  Sources Web &amp; Réglementaires Vérifiées
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {liveSynthesis.webSources.slice(0, 4).map((src, idx) => {
                    const safeUri = safeExternalHttpUrl(src.uri);
                    if (!safeUri) return null;
                    return (
                      <a
                        key={`${safeUri}-${idx}`}
                        href={safeUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-succes-texte hover:underline max-w-[180px] truncate"
                      >
                        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{src.title}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="pt-2.5 border-t border-bordure text-[11px] text-texte-doux flex items-center justify-between gap-2">
            <span>
              {liveSynthesis
                ? liveSynthesis.sourceMode === 'gemini_search_grounded'
                  ? 'Croisé Gemini Web + SEC/SEDAR+'
                  : 'Moteur Causal + Flux RSS Direct'
                : 'SEC EDGAR · SEDAR+ · Banque du Canada'}
            </span>
            <span className="font-mono tabular-nums text-texte">
              100 % $ CAD
            </span>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* BOTTOM MATRIX: BAYESIAN NARRATIVE-VS-PRICE DIVERGENCE DETECTOR        */}
      {/* ===================================================================== */}
      <section className="bg-surface/45 border border-bordure rounded-2xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-texte">
              Matrice de Divergence Bayésienne (Actu ↔ Prix 30j ↔ Vraie Valeur DCF)
            </h3>
            <p className="text-xs text-texte-doux">
              Détecte quand le marché sur-réagit à une nouvelle court terme sur un
              bilan sain, ou quand l’euphorie dépasse la vraie valeur.
            </p>
          </div>

          {/* Segmented Regime Filter */}
          <div className="grid grid-cols-2 sm:inline-flex items-center gap-1 p-1 bg-fond border border-bordure rounded-xl shrink-0">
            <button aria-pressed={Boolean(matrixFilter === 'all')}
              type="button"
              onClick={() => setMatrixFilter('all')}
              className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                matrixFilter === 'all'
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              Tous ({lab.divergenceRows.length})
            </button>
            <button aria-pressed={Boolean(matrixFilter === 'held')}
              type="button"
              onClick={() => setMatrixFilter('held')}
              className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                matrixFilter === 'held'
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              Ce que j’ai
            </button>
            <button aria-pressed={Boolean(matrixFilter === 'opportunities')}
              type="button"
              onClick={() => setMatrixFilter('opportunities')}
              className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                matrixFilter === 'opportunities'
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              Décotes &amp; Catalyseurs
            </button>
            <button aria-pressed={Boolean(matrixFilter === 'risks')}
              type="button"
              onClick={() => setMatrixFilter('risks')}
              className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                matrixFilter === 'risks'
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              Sur-payés &amp; Pièges
            </button>
          </div>
        </div>

        {filteredDivergenceRows.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-xs text-texte-doux">
              Aucun titre ne correspond à ce filtre.
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedAssetId(null);
                setMatrixFilter('all');
              }}
              className="min-h-11 text-xs text-succes-texte hover:underline cursor-pointer"
            >
              Réinitialiser les filtres
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Stacked Cards (< md) — Zero Horizontal Overflow */}
            <div className="md:hidden divide-y divide-bordure">
              {filteredDivergenceRows.map((row) => (
                <div key={`mob-div-${row.assetId}`} className="py-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onInspectAsset(row.assetId)}
                      className="min-h-11 text-left min-w-0 flex-1 truncate cursor-pointer"
                    >
                      <span className="font-mono font-bold text-sm text-texte">
                        {row.ticker}
                      </span>
                      <span className="text-xs text-texte-doux ml-1.5">
                        · {row.isHeld ? `Détenu ${formatCompactEur(row.heldValueCad)}` : row.name}
                      </span>
                    </button>

                    <D3PriceSparkline30d
                      assetId={row.assetId}
                      spotPriceCad={row.spotCad}
                      width={56}
                      height={20}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                    <span
                      className={
                        row.regimeTone === 'positive'
                          ? 'text-succes-texte font-semibold font-sans'
                          : row.regimeTone === 'negative' || row.regimeTone === 'caution'
                            ? 'text-erreur-texte font-semibold font-sans'
                            : 'text-texte font-sans'
                      }
                    >
                      {row.regimeLabel}
                    </span>
                    <span className="text-texte">
                      Bayésien {row.priorFundamentalPct} →{' '}
                      <strong>{row.posteriorBayesianConvictionPct}%</strong>
                    </span>
                  </div>

                  <p className="text-xs text-texte-doux leading-snug">
                    {row.causalDiagnosis}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-1 text-[11px] font-mono tabular-nums text-texte-doux">
                    <span>
                      Spot {formatEur(row.spotCad, 0)} · Vraie val.{' '}
                      {formatEur(row.fairValueCad, 0)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenAssetInDialogue(row.assetId)}
                      className="min-h-11 font-sans text-texte hover:text-texte underline cursor-pointer"
                    >
                      Discuter IA
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Precision Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-bordure text-[11px] text-texte-doux">
                    <th className="py-2.5 pr-3 font-medium">Actif &amp; Preuve</th>
                    <th className="py-2.5 px-3 font-medium">30 Jours</th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      Spot vs Vraie Valeur
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      Actu / CAR
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      Conviction Bayésienne
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      Régime &amp; Diagnostic Causal
                    </th>
                    <th className="py-2.5 pl-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bordure text-xs">
                  {filteredDivergenceRows.map((row) => (
                    <tr
                      key={`desk-div-${row.assetId}`}
                      className="hover:bg-surface/60 transition-colors"
                    >
                      <td className="py-3 pr-3 max-w-[180px]">
                        <button
                          type="button"
                          onClick={() => onInspectAsset(row.assetId)}
                          className="min-h-11 text-left group cursor-pointer block truncate max-w-full"
                        >
                          <span className="font-mono font-bold text-texte group-hover:underline">
                            {row.ticker}
                          </span>
                          {row.isHeld && (
                            <span className="text-[11px] text-succes-texte font-mono ml-1.5">
                              · {formatCompactEur(row.heldValueCad)}
                            </span>
                          )}
                          <span className="block text-[11px] text-texte-doux truncate">
                            {row.filingProofCode}
                          </span>
                        </button>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <D3PriceSparkline30d
                          assetId={row.assetId}
                          spotPriceCad={row.spotCad}
                          width={64}
                          height={22}
                        />
                      </td>

                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="text-texte font-semibold">
                          {formatEur(row.spotCad, 0)}{' '}
                          <span className="text-texte-doux">→</span>{' '}
                          {formatEur(row.fairValueCad, 0)}
                        </div>
                        <div
                          className={`text-[11px] ${
                            row.dcfUpsidePct >= 0
                              ? 'text-succes-texte'
                              : 'text-erreur-texte'
                          }`}
                        >
                          {formatSignedPct(row.dcfUpsidePct, 1)} DCF
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div
                          className={
                            row.newsImpulseScore >= 10
                              ? 'text-succes-texte font-semibold'
                              : row.newsImpulseScore <= -10
                                ? 'text-erreur-texte font-semibold'
                                : 'text-texte'
                          }
                        >
                          {row.newsImpulseScore >= 0 ? '+' : ''}
                          {row.newsImpulseScore}
                        </div>
                        <div className="text-[11px] text-texte-doux">
                          CAR {formatSignedPct(row.abnormalCarPct, 1)}
                        </div>
                      </td>

                      <td className="py-3 px-3 w-40">
                        <div className="font-mono tabular-nums text-[11px] text-texte mb-1">
                          {row.priorFundamentalPct}% →{' '}
                          <strong className="text-texte">
                            {row.posteriorBayesianConvictionPct}%
                          </strong>
                        </div>
                        <svg
                          viewBox="0 0 100 5"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                          className="w-full h-1.5 bg-fond rounded-full overflow-hidden"
                        >
                          <rect
                            x="0"
                            y="0"
                            width={row.posteriorBayesianConvictionPct}
                            height="5"
                            fill={
                              row.posteriorBayesianConvictionPct >= 65
                                ? VALORIA_PALETTE.emerald
                                : row.posteriorBayesianConvictionPct <= 42
                                  ? VALORIA_PALETTE.rose
                                  : VALORIA_PALETTE.mutedZinc
                            }
                          />
                        </svg>
                      </td>

                      <td className="py-3 px-3 max-w-[290px]">
                        <div
                          className={`font-semibold text-xs ${
                            row.regimeTone === 'positive'
                              ? 'text-succes-texte'
                              : row.regimeTone === 'negative' ||
                                  row.regimeTone === 'caution'
                                ? 'text-erreur-texte'
                                : 'text-texte'
                          }`}
                        >
                          {row.regimeLabel}
                        </div>
                        <p className="text-[11px] text-texte-doux line-clamp-2 leading-snug mt-0.5">
                          {row.causalDiagnosis}
                        </p>
                      </td>

                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenAssetInDialogue(row.assetId)}
                          className="min-w-11 min-h-11 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-texte hover:text-texte bg-fond border border-bordure rounded-lg cursor-pointer"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>Discuter IA</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

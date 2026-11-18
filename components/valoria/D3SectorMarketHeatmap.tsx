import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { RefreshCw } from 'lucide-react';
import { VERIFIED_BOC_FX_DATE, VERIFIED_BOC_FX_TO_CAD } from '../../services/valoria/marketData';
import { UniversalAssetAnalysis } from '../../services/valoria/multiAssetQuantEngine';
import {
  HeatmapMetricMode,
  SectorHeatmapGroup,
  SectorHeatmapHierarchyRoot,
  SectorHeatmapLeaf,
  buildSectorHeatmapHierarchy,
} from '../../services/valoria/marketVisualAnalytics';
import { ScrollReveal } from './MotionPrimitives';
import { formatEur, formatSignedPct } from '../../services/valoria/valoriaFormatters';

interface D3SectorMarketHeatmapProps {
  analyses: UniversalAssetAnalysis[];
  onInspectAsset: (assetId: string) => void;
  isRefreshingVerified?: boolean;
  verifiedFeedStatus?: string | null;
  onRefreshVerifiedPrices?: () => void;
}

type HierarchyDatum =
  | SectorHeatmapHierarchyRoot
  | SectorHeatmapGroup
  | SectorHeatmapLeaf;

const HORIZON_OPTIONS: Array<{ id: HeatmapMetricMode; label: string }> = [
  { id: '1d', label: '1J' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '12m', label: '1A' },
  { id: 'dcf', label: 'Aubaine vs Cher' },
];

export const D3SectorMarketHeatmap: React.FC<D3SectorMarketHeatmapProps> = ({
  analyses,
  onInspectAsset,
  isRefreshingVerified = false,
  verifiedFeedStatus = null,
  onRefreshVerifiedPrices,
}) => {
  const [metricMode, setMetricMode] = useState<HeatmapMetricMode>('3m');
  const [hoveredLeaf, setHoveredLeaf] = useState<SectorHeatmapLeaf | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1060);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w >= 280) setContainerWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hierarchyRoot = useMemo(
    () => buildSectorHeatmapHierarchy(analyses, metricMode),
    [analyses, metricMode]
  );

  const treemapHeight = containerWidth < 640 ? 560 : 470;

  // Strict Diverging Crimson-to-Zinc-to-Emerald Color Scale (Zero Teal/Blue)
  const { sectorNodes, leafNodes, colorScale } = useMemo(() => {
    const domainExtent =
      metricMode === '1d'
        ? 4.2
        : metricMode === '12m'
          ? 36
          : metricMode === 'dcf'
            ? 24
            : 16;
    const neutralDeadzone =
      metricMode === '1d' ? 0.35 : metricMode === 'dcf' ? 2.5 : 1.4;
    const scale = d3
      .scaleLinear<string>()
      .domain([
        -domainExtent,
        -domainExtent * 0.42,
        -neutralDeadzone,
        neutralDeadzone,
        domainExtent * 0.42,
        domainExtent,
      ])
      .range([VALORIA_PALETTE.crimsonDeep, VALORIA_PALETTE.roseDark, VALORIA_PALETTE.bgCard, VALORIA_PALETTE.bgCard, VALORIA_PALETTE.emeraldDark, VALORIA_PALETTE.emerald])
      .clamp(true);

    const root = d3
      .hierarchy<HierarchyDatum>(hierarchyRoot, (d) =>
        'children' in d ? (d.children as HierarchyDatum[]) : undefined
      )
      .sum((d) => ('weight' in d ? d.weight : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const treemapLayout = d3
      .treemap<HierarchyDatum>()
      .tile(d3.treemapSquarify.ratio(1.18))
      .size([containerWidth, treemapHeight])
      .paddingOuter(3)
      .paddingTop(22)
      .paddingInner(2)
      .round(true);

    const laidOut = treemapLayout(root);

    const sectors = (laidOut.children ?? []).map((node) => ({
      data: node.data as SectorHeatmapGroup,
      x0: node.x0,
      y0: node.y0,
      x1: node.x1,
      y1: node.y1,
    }));

    const leaves = laidOut.leaves().map((node) => ({
      data: node.data as SectorHeatmapLeaf,
      x0: node.x0,
      y0: node.y0,
      x1: node.x1,
      y1: node.y1,
    }));

    return {
      sectorNodes: sectors,
      leafNodes: leaves,
      colorScale: scale,
    };
  }, [hierarchyRoot, containerWidth, treemapHeight, metricMode]);

  const activeInspect = hoveredLeaf ?? leafNodes[0]?.data ?? null;
  const totalDirectional = Math.max(
    1,
    hierarchyRoot.advancers + hierarchyRoot.decliners + hierarchyRoot.unchanged
  );
  const advPct = Math.round((hierarchyRoot.advancers / totalDirectional) * 100);
  const decPct = Math.round((hierarchyRoot.decliners / totalDirectional) * 100);

  return (
    <ScrollReveal>
      <section
        data-testid="d3-sector-heatmap-section"
        className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4"
      >
        {/* Top Bar: Title + Horizon Segmented Selector + Live Verified Sources Action */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-3 border-b border-bordure">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-texte">
              Carte Thermique Mondiale ({hierarchyRoot.totalAssets} actifs en $ CAD)
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-texte-doux">
              <span>Vert = En hausse · Rouge = En baisse · Gris = Stable</span>
              <span aria-hidden="true">·</span>
              <span>Banque du Canada ({VERIFIED_BOC_FX_DATE} · 1 USD = {VERIFIED_BOC_FX_TO_CAD.USD.toFixed(4)} CAD)</span>
              {verifiedFeedStatus && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-succes-texte">{verifiedFeedStatus}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Horizon Segmented Buttons */}
            <div
              role="group"
              aria-label="Horizon de performance de la heatmap"
              className="inline-flex items-center gap-1 p-1 bg-surface border border-bordure rounded-xl"
            >
              {HORIZON_OPTIONS.map((opt) => (
                <button aria-pressed={Boolean(metricMode === opt.id)}
                  key={opt.id}
                  type="button"
                  onClick={() => setMetricMode(opt.id)}
                  className={`min-h-11 min-w-11 px-2.5 py-1 text-xs font-mono rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    metricMode === opt.id
                      ? 'bg-accent text-sur-accent font-bold'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {onRefreshVerifiedPrices && (
              <button
                type="button"
                onClick={onRefreshVerifiedPrices}
                disabled={isRefreshingVerified}
                className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-texte bg-surface hover:bg-surface-douce disabled:opacity-60 border border-bordure-champ rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-texte ${isRefreshingVerified ? 'animate-spin' : ''}`}
                />
                <span>
                  {isRefreshingVerified
                    ? 'Vérification…'
                    : 'Actualiser cours réels'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Market Breadth Strip + Hovered Tile Telemetry */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs font-mono tabular-nums">
          <div className="flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-succes-texte font-semibold">
                  ▲ {hierarchyRoot.advancers}{' '}
                  {metricMode === 'dcf' ? 'aubaines' : 'en hausse'} ({advPct}%)
                </span>
                <span className="text-texte-doux">·</span>
                <span className="text-erreur-texte font-semibold">
                  ▼ {hierarchyRoot.decliners}{' '}
                  {metricMode === 'dcf' ? 'trop chers' : 'en baisse'} ({decPct}%)
                </span>
                <span className="text-texte-doux">·</span>
                <span className="text-texte">
                  Moy. {formatSignedPct(hierarchyRoot.meanPerfPct, 1)}
                </span>
              </div>
              <div className="text-[11px] text-texte-doux">
                Verdicts :{' '}
                <span className="text-succes-texte">
                  ▲ {hierarchyRoot.buySignalCount} Acheter
                </span>{' '}
                ·{' '}
                <span className="text-texte">
                  {hierarchyRoot.holdSignalCount} Garder
                </span>{' '}
                ·{' '}
                <span className="text-erreur-texte">
                  ▼ {hierarchyRoot.sellSignalCount} Vendre/Éviter
                </span>
              </div>
            </div>

            <div className="w-full h-1.5 bg-surface-douce rounded-full overflow-hidden flex">
              <div
                className="bg-succes-texte h-full transition-opacity"
                // NOMBRE-NON-MONETAIRE : part publique du marché en hausse
                style={{ width: `${advPct}%` }}
              />
              <div
                className="bg-bordure-champ h-full"
                // NOMBRE-NON-MONETAIRE : part publique du marché neutre
                style={{ width: `${Math.max(0, 100 - advPct - decPct)}%` }}
              />
              <div
                className="bg-erreur-texte h-full transition-opacity"
                // NOMBRE-NON-MONETAIRE : part publique du marché en baisse
                style={{ width: `${decPct}%` }}
              />
            </div>
          </div>

          {activeInspect && (
            <div className="lg:pl-4 lg:border-l border-bordure flex flex-wrap items-center gap-2 text-xs shrink-0">
              <span className="font-bold text-texte">
                {activeInspect.ticker}
              </span>
              <span className="font-sans text-texte-doux truncate max-w-[150px]">
                {activeInspect.name}
              </span>
              <span className="text-texte">
                {formatEur(activeInspect.spotCad, activeInspect.spotCad < 2 ? 4 : 2)}
              </span>
              <span
                className={
                  activeInspect.perfPct >= 0
                    ? 'text-succes-texte font-bold'
                    : 'text-erreur-texte font-bold'
                }
              >
                {formatSignedPct(activeInspect.perfPct, 1)}
              </span>
              <span className="text-texte-doux">
                {/* NOMBRE-NON-MONETAIRE : score quantitatif d'actif public */}
                · {activeInspect.signal} ({activeInspect.quantScore}/100)
              </span>
            </div>
          )}
        </div>

        {/* Pure D3 Squarified Hierarchical Treemap */}
        <div ref={containerRef} className="w-full overflow-hidden rounded-xl border border-bordure bg-fond">
          <svg
            data-testid="d3-sector-heatmap-svg"
            width="100%"
            height={treemapHeight}
            viewBox={`0 0 ${containerWidth} ${treemapHeight}`}
            role="img"
            aria-label={`Heatmap D3 des performances relatives par secteur (${hierarchyRoot.metricLabel})`}
            className="block select-none"
          >
            {/* 1. Macro-Sector Group Frames & Headers */}
            {sectorNodes.map((sec) => {
              const w = Math.max(0, sec.x1 - sec.x0);
              const h = Math.max(0, sec.y1 - sec.y0);
              if (w < 24 || h < 24) return null;
              const meanSign = sec.data.meanPerfPct >= 0 ? '▲' : '▼';
              const meanColor =
                sec.data.meanPerfPct > 0.2
                  ? VALORIA_PALETTE.emeraldLight
                  : sec.data.meanPerfPct < -0.2
                    ? VALORIA_PALETTE.roseLight
                    : VALORIA_PALETTE.textZincLight;

              return (
                <g
                  key={sec.data.name}
                  transform={`translate(${sec.x0}, ${sec.y0})`}
                >
                  <rect
                    width={w}
                    height={h}
                    rx={4}
                    fill={VALORIA_PALETTE.bgHeatTile}
                    stroke={VALORIA_PALETTE.gridZinc}
                    strokeWidth={1}
                  />
                  {w >= 80 && (() => {
                    const showMeanBadge = w >= 156;
                    const rawTitle = w < 310 ? sec.data.shortName : sec.data.name;
                    const availPx = w - (showMeanBadge ? 72 : 12);
                    const maxChars = Math.max(6, Math.floor(availPx / 6.1));
                    const safeTitle =
                      rawTitle.length > maxChars
                        ? `${rawTitle.slice(0, Math.max(5, maxChars - 1))}…`
                        : rawTitle;
                    return (
                      <>
                        <text
                          x={6}
                          y={14.5}
                          fill={VALORIA_PALETTE.lineZinc}
                          fontSize={w < 195 ? '9.5' : '10.5'}
                          fontWeight="600"
                          fontFamily="Plus Jakarta Sans, sans-serif"
                        >
                          {safeTitle}
                        </text>
                        {showMeanBadge && (
                          <text
                            x={w - 6}
                            y={14.5}
                            textAnchor="end"
                            fill={meanColor}
                            fontSize="10"
                            fontWeight="700"
                            fontFamily="IBM Plex Mono, monospace"
                          >
                            {meanSign} {formatSignedPct(sec.data.meanPerfPct, 1)}
                          </text>
                        )}
                      </>
                    );
                  })()}
                </g>
              );
            })}

            {/* 2. Individual Asset Performance Tiles */}
            {leafNodes.map((leaf) => {
              const w = Math.max(0, leaf.x1 - leaf.x0);
              const h = Math.max(0, leaf.y1 - leaf.y0);
              if (w <= 2 || h <= 2) return null;

              const isHovered = hoveredLeaf?.assetId === leaf.data.assetId;
              const bgFill = colorScale(leaf.data.perfPct);
              const showTicker = w >= 34 && h >= 18;
              const showPct = w >= 42 && h >= 30;
              const showSpot = w >= 86 && h >= 48;

              return (
                <g
                  key={leaf.data.assetId}
                  transform={`translate(${leaf.x0}, ${leaf.y0})`}
                  onClick={() => onInspectAsset(leaf.data.assetId)}
                  onMouseEnter={() => setHoveredLeaf(leaf.data)}
                  className="cursor-pointer"
                >
                  <rect
                    width={w}
                    height={h}
                    rx={2}
                    fill={bgFill}
                    fillOpacity={isHovered ? 1 : 0.92}
                    stroke={
                      isHovered
                        ? VALORIA_PALETTE.textWhiteSoft
                        : leaf.data.isHeld
                          ? VALORIA_PALETTE.textBright
                          : VALORIA_PALETTE.bgDeep
                    }
                    strokeWidth={isHovered ? 1.8 : leaf.data.isHeld ? 1.4 : 0.8}
                  />

                  {showTicker && (
                    <text
                      x={w / 2}
                      y={showPct ? h / 2 - (showSpot ? 6 : 2) : h / 2 + 3.5}
                      textAnchor="middle"
                      fill={VALORIA_PALETTE.textWhiteSoft}
                      fontSize={w >= 68 ? '10.5' : '8.5'}
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {leaf.data.shortTicker.slice(0, w >= 54 ? 6 : 4)}
                      {leaf.data.isHeld && w >= 56 ? '★' : ''}
                    </text>
                  )}

                  {showPct && (
                    <text
                      x={w / 2}
                      y={h / 2 + (showSpot ? 6 : 10)}
                      textAnchor="middle"
                      fill={VALORIA_PALETTE.textBright}
                      fontSize={w >= 68 ? '9.5' : '8'}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {formatSignedPct(leaf.data.perfPct, 1)}
                    </text>
                  )}

                  {showSpot && (
                    <text
                      x={w / 2}
                      y={h / 2 + 18}
                      textAnchor="middle"
                      fill={VALORIA_PALETTE.textZincLight}
                      fontSize="8.5"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {formatEur(leaf.data.spotCad, leaf.data.spotCad < 2 ? 2 : 0)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Diverging Color Scale Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-texte-doux">
          <div className="flex items-center gap-2">
            <span className="text-erreur-texte">▼ Baisse</span>
            <div className="flex items-center h-2.5 w-36 rounded-sm overflow-hidden border border-bordure">
              <span className="flex-1 h-full bg-erreur-fond" />
              <span className="flex-1 h-full bg-erreur-texte" />
              <span className="flex-1 h-full bg-surface-douce" />
              <span className="flex-1 h-full bg-succes-fond" />
              <span className="flex-1 h-full bg-succes-texte" />
            </div>
            <span className="text-succes-texte">▲ Hausse</span>
          </div>
          <span>★ Détenu · Cliquez sur une case pour voir MM 50/200j, RSI et MACD</span>
        </div>
      </section>
    </ScrollReveal>
  );
};

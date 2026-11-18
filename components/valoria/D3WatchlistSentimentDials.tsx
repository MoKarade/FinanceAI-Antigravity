import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { Plus, X } from 'lucide-react';
import { PortfolioMultiAgentSummary } from '../../services/valoria/corporateIntelligenceEngine';
import { MultiAssetUniverseSummary } from '../../services/valoria/multiAssetQuantEngine';
import {
  SentimentDialZone,
  WatchlistAssetSentimentDial,
  computeWatchlistSentimentConsensus,
} from '../../services/valoria/marketVisualAnalytics';
import { PortfolioInstitutionalNewsSummary } from '../../services/valoria/institutionalCurveAndNewsEngine';
import { HoverLiftCard, ScrollReveal } from './MotionPrimitives';
import { formatEur, formatSignedPct } from '../../services/valoria/valoriaFormatters';

interface D3DialSvgProps {
  score: number; // -100 .. +100
  zoneLabel: SentimentDialZone;
  width?: number;
  height?: number;
  ariaLabel: string;
}

const DIAL_ZONES: Array<{
  from: number;
  to: number;
  color: string;
}> = [
  { from: -100, to: -42, color: VALORIA_PALETTE.roseDark }, // Très Baissier
  { from: -42, to: -14, color: VALORIA_PALETTE.rose }, // Baissier
  { from: -14, to: 15, color: VALORIA_PALETTE.strokeZinc }, // Neutre (sober zinc)
  { from: 15, to: 45, color: VALORIA_PALETTE.emerald }, // Haussier
  { from: 45, to: 100, color: VALORIA_PALETTE.green }, // Très Haussier
];

function getScoreTextColor(score: number): string {
  if (score >= 15) return 'text-succes-texte';
  if (score <= -14) return 'text-erreur-texte';
  return 'text-texte';
}

function getNeedleStrokeColor(score: number): string {
  if (score >= 15) return VALORIA_PALETTE.emeraldLight;
  if (score <= -14) return VALORIA_PALETTE.roseLight;
  return VALORIA_PALETTE.textZincLight;
}

const D3SentimentDialGaugeSvg: React.FC<D3DialSvgProps> = ({
  score,
  zoneLabel,
  width = 164,
  height = 104,
  ariaLabel,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const clamped = Math.max(-100, Math.min(100, score));
    const cx = width / 2;
    const cy = height * 0.77;
    const outerR = Math.min(width * 0.44, height * 0.69);
    const innerR = outerR * 0.74;

    const maxRad = (110 * Math.PI) / 180;
    const angleScale = d3
      .scaleLinear()
      .domain([-100, 100])
      .range([-maxRad, maxRad])
      .clamp(true);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${cx}, ${cy})`);

    const bgArcGen = d3
      .arc<{ from: number; to: number }>()
      .innerRadius(innerR)
      .outerRadius(outerR)
      .startAngle((d) => angleScale(d.from) + 0.012)
      .endAngle((d) => angleScale(d.to) - 0.012)
      .cornerRadius(2);

    g.selectAll('path.dial-zone')
      .data(DIAL_ZONES)
      .enter()
      .append('path')
      .attr('class', 'dial-zone')
      .attr('d', (d) => bgArcGen(d) ?? '')
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.24);

    if (Math.abs(clamped) >= 2) {
      const activeArcGen = d3
        .arc<{ start: number; end: number }>()
        .innerRadius(innerR)
        .outerRadius(outerR)
        .startAngle((d) => angleScale(Math.min(d.start, d.end)))
        .endAngle((d) => angleScale(Math.max(d.start, d.end)))
        .cornerRadius(2);

      g.append('path')
        .datum({ start: 0, end: clamped })
        .attr('d', (d) => activeArcGen(d) ?? '')
        .attr('fill', getNeedleStrokeColor(clamped))
        .attr('fill-opacity', 0.92);
    }

    const ticks = [-100, -50, 0, 50, 100];
    for (const t of ticks) {
      const a = angleScale(t) - Math.PI / 2;
      const r1 = outerR + 2;
      const r2 = outerR + (t === 0 ? 6.5 : 4.5);
      g.append('line')
        .attr('x1', Math.cos(a) * r1)
        .attr('y1', Math.sin(a) * r1)
        .attr('x2', Math.cos(a) * r2)
        .attr('y2', Math.sin(a) * r2)
        .attr('stroke', t === 0 ? VALORIA_PALETTE.textZinc : VALORIA_PALETTE.strokeZinc)
        .attr('stroke-width', t === 0 ? 1.5 : 1);
    }

    if (width >= 185) {
      const leftA = angleScale(-100) - Math.PI / 2;
      const rightA = angleScale(100) - Math.PI / 2;
      const labelR = outerR + 12;
      g.append('text')
        .attr('x', Math.cos(leftA) * labelR + 4)
        .attr('y', Math.sin(leftA) * labelR + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', VALORIA_PALETTE.roseLight)
        .attr('font-size', '9')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text('−100');

      g.append('text')
        .attr('x', Math.cos(rightA) * labelR - 4)
        .attr('y', Math.sin(rightA) * labelR + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', VALORIA_PALETTE.emeraldLight)
        .attr('font-size', '9')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text('+100');

      g.append('text')
        .attr('x', 0)
        .attr('y', -(outerR + 8))
        .attr('text-anchor', 'middle')
        .attr('fill', VALORIA_PALETTE.textZinc)
        .attr('font-size', '9')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text('0');
    }

    const needleRad = angleScale(clamped) - Math.PI / 2;
    const needleLen = innerR - 3;
    const baseHalf = width >= 185 ? 3.4 : 2.6;
    const perpRad = needleRad + Math.PI / 2;

    const tipX = Math.cos(needleRad) * needleLen;
    const tipY = Math.sin(needleRad) * needleLen;
    const tailX = -Math.cos(needleRad) * 6;
    const tailY = -Math.sin(needleRad) * 6;
    const leftBaseX = Math.cos(perpRad) * baseHalf;
    const leftBaseY = Math.sin(perpRad) * baseHalf;
    const rightBaseX = -Math.cos(perpRad) * baseHalf;
    const rightBaseY = -Math.sin(perpRad) * baseHalf;

    g.append('polygon')
      .attr(
        'points',
        `${leftBaseX.toFixed(2)},${leftBaseY.toFixed(2)} ${tipX.toFixed(2)},${tipY.toFixed(2)} ${rightBaseX.toFixed(2)},${rightBaseY.toFixed(2)} ${tailX.toFixed(2)},${tailY.toFixed(2)}`
      )
      .attr('fill', VALORIA_PALETTE.textWhiteSoft);

    g.append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', width >= 185 ? 5.2 : 4.2)
      .attr('fill', VALORIA_PALETTE.bgDeep)
      .attr('stroke', getNeedleStrokeColor(clamped))
      .attr('stroke-width', 2);

    const formattedScore = clamped > 0 ? `+${clamped}` : `${clamped}`;
    g.append('text')
      .attr('x', 0)
      .attr('y', width >= 185 ? 19 : 16)
      .attr('text-anchor', 'middle')
      .attr('fill', VALORIA_PALETTE.textWhiteSoft)
      .attr('font-size', width >= 185 ? '14' : '11.5')
      .attr('font-weight', '700')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(formattedScore);
  }, [score, zoneLabel, width, height]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="block mx-auto select-none overflow-visible"
    />
  );
};

interface D3WatchlistSentimentDialsProps {
  watchlistIds: string[];
  selectedAssetId: string;
  multiAgent: PortfolioMultiAgentSummary;
  universe: MultiAssetUniverseSummary;
  institutionalNews?: PortfolioInstitutionalNewsSummary;
  onSelectAsset: (assetId: string) => void;
  onAddWatchlistAsset: (assetId: string) => void;
  onRemoveWatchlistAsset: (assetId: string) => void;
}

export const D3WatchlistSentimentDials: React.FC<
  D3WatchlistSentimentDialsProps
> = ({
  watchlistIds,
  selectedAssetId,
  multiAgent,
  universe,
  institutionalNews,
  onSelectAsset,
  onAddWatchlistAsset,
  onRemoveWatchlistAsset,
}) => {
  const [candidateAssetId, setCandidateAssetId] = useState<string>('XBB');
  const [hoveredDialId, setHoveredDialId] = useState<string | null>(null);

  const consensus = useMemo(
    () =>
      computeWatchlistSentimentConsensus({
        watchlistIds,
        multiAgent,
        universe,
        institutionalNews,
      }),
    [watchlistIds, multiAgent, universe, institutionalNews]
  );

  const addableAssets = useMemo(() => {
    const watchSet = new Set(watchlistIds);
    return universe.allAnalyses
      .filter((a) => !watchSet.has(a.asset.id))
      .slice(0, 60);
  }, [universe.allAnalyses, watchlistIds]);

  const effectiveCandidateId = useMemo(() => {
    if (addableAssets.some((a) => a.asset.id === candidateAssetId)) {
      return candidateAssetId;
    }
    return addableAssets[0]?.asset.id ?? '';
  }, [addableAssets, candidateAssetId]);

  const focusedDial: WatchlistAssetSentimentDial | undefined =
    consensus.dials.find((d) => d.assetId === hoveredDialId) ??
    consensus.dials.find((d) => d.assetId === selectedAssetId) ??
    consensus.dials[0];

  return (
    <ScrollReveal>
      <section
        data-testid="d3-watchlist-sentiment-section"
        className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4"
      >
        {/* Header Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-bordure">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-texte">
              Cadrans d’Humeur du Marché &amp; Actualités (D3.js)
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-texte-doux">
              <span>{consensus.dials.length} suivis</span>
              <span aria-hidden="true">·</span>
              <span className="text-succes-texte">
                ▲ {consensus.bullishCount} positifs
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-texte">
                {consensus.neutralCount} neutres
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-erreur-texte">
                ▼ {consensus.bearishCount} négatifs
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-texte">
                Sources vérifiées {consensus.avgCredibilityPct} %
              </span>
            </div>
          </div>

          {addableAssets.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <label htmlFor="watchlist-sentiment-add" className="sr-only">
                Ajouter un actif à la watchlist
              </label>
              <select
                id="watchlist-sentiment-add"
                value={effectiveCandidateId}
                onChange={(e) => setCandidateAssetId(e.target.value)}
                className="min-h-11 px-2.5 py-1.5 text-xs font-mono bg-surface border border-bordure rounded-xl text-texte outline-hidden focus-ring focus:border-bordure-champ max-w-[210px]"
              >
                {addableAssets.map((item) => (
                  <option key={item.asset.id} value={item.asset.id}>
                    {item.asset.ticker} · {item.asset.name.split(' (')[0]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (effectiveCandidateId) {
                    onAddWatchlistAsset(effectiveCandidateId);
                  }
                }}
                className="min-h-11 min-w-11 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Suivre</span>
              </button>
            </div>
          )}
        </div>

        {consensus.dials.length === 0 ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-xs font-mono text-texte-doux">
              Aucun actif suivi dans les cadrans d’actualité.
            </p>
            {effectiveCandidateId && (
              <button
                type="button"
                onClick={() => onAddWatchlistAsset(effectiveCandidateId)}
                className="min-h-11 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl whitespace-nowrap cursor-pointer"
              >
                Ajouter un premier actif
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            {/* Left Anchor (4 cols): Master Watchlist Consensus D3 Dial */}
            <div className="lg:col-span-4 lg:pr-5 lg:border-r border-bordure flex flex-col justify-between space-y-3">
              <div className="flex items-baseline justify-between font-mono tabular-nums text-xs">
                <span className="font-sans font-semibold text-texte">
                  Humeur Globale
                </span>
                <span className={`font-bold ${getScoreTextColor(consensus.overallScore)}`}>
                  {consensus.overallZone}
                </span>
              </div>

              <D3SentimentDialGaugeSvg
                score={consensus.overallScore}
                zoneLabel={consensus.overallZone}
                width={216}
                height={132}
                ariaLabel={`Cadran D3 consensus watchlist : ${consensus.overallScore} sur 100 (${consensus.overallZone})`}
              />

              {focusedDial && (
                <div className="pt-3 border-t border-bordure space-y-1.5 text-xs">
                  <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-texte-doux">
                    <span>
                      <strong className="text-texte">{focusedDial.ticker}</strong> ·{' '}
                      <span className="text-texte">{focusedDial.filingCode}</span> ({focusedDial.credibilityPct}%)
                    </span>
                    <span
                      className={
                        focusedDial.abnormalCarPct >= 0
                          ? 'text-succes-texte font-semibold'
                          : 'text-erreur-texte font-semibold'
                      }
                    >
                      Impact {formatSignedPct(focusedDial.abnormalCarPct, 1)}
                    </span>
                  </div>
                  <p className="text-texte font-medium line-clamp-2 leading-snug">
                    {focusedDial.headlinePreview}
                  </p>
                </div>
              )}
            </div>

            {/* Right Grid (8 cols): Individual D3 Dial Gauge per Watchlist Asset */}
            <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {consensus.dials.map((dial) => {
                const isSelected = dial.assetId === selectedAssetId;
                const decimals = dial.spotCad < 2 ? 4 : 2;
                return (
                  <HoverLiftCard
                    key={dial.assetId}
                    className={`relative rounded-xl p-3 transition-colors border ${
                      isSelected
                        ? 'bg-surface border-accent'
                        : 'bg-surface/55 border-bordure hover:border-bordure-champ'
                    }`}
                  >
                    <div
                      data-testid={`sentiment-dial-card-${dial.assetId}`}
                      onMouseEnter={() => setHoveredDialId(dial.assetId)}
                      onMouseLeave={() => setHoveredDialId(null)}
                    >
                      <button
                        type="button"
                        onClick={() => onRemoveWatchlistAsset(dial.assetId)}
                        aria-label={`Retirer ${dial.ticker} de la watchlist`}
                        className="min-h-11 min-w-11 absolute top-2 right-2 p-1 text-texte-doux hover:text-erreur-texte rounded-sm transition-colors cursor-pointer z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectAsset(dial.assetId)}
                        aria-label={`Inspecter le sentiment de ${dial.ticker} (${dial.sentimentScore}, ${dial.zoneLabel})`}
                        className="min-h-11 w-full text-left space-y-1.5 cursor-pointer outline-hidden focus-ring"
                      >
                        <div className="flex items-baseline justify-between pr-5 font-mono tabular-nums">
                          <span className="text-xs font-bold text-texte truncate">
                            {dial.ticker}
                            {dial.isHeld ? ' ★' : ''}
                          </span>
                          <span
                            className={`text-[11px] font-semibold ${
                              dial.momentum1mPct >= 0
                                ? 'text-succes-texte'
                                : 'text-erreur-texte'
                            }`}
                          >
                            1M {formatSignedPct(dial.momentum1mPct, 1)}
                          </span>
                        </div>

                        <D3SentimentDialGaugeSvg
                          score={dial.sentimentScore}
                          zoneLabel={dial.zoneLabel}
                          width={142}
                          height={88}
                          ariaLabel={`Cadran D3 ${dial.ticker} : score ${dial.sentimentScore} (${dial.zoneLabel})`}
                        />

                        <div className="pt-1 border-t border-bordure flex items-center justify-between text-[11px] font-mono tabular-nums">
                          <span className={`font-semibold ${getScoreTextColor(dial.sentimentScore)}`}>
                            {dial.zoneLabel}
                          </span>
                          <span className="text-texte-doux">
                            CAR {formatSignedPct(dial.abnormalCarPct, 0)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-texte-doux">
                          <span>{formatEur(dial.spotCad, decimals)}</span>
                          <span className="truncate max-w-[96px] text-right text-texte">
                            {dial.filingCode}
                          </span>
                        </div>
                      </button>
                    </div>
                  </HoverLiftCard>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </ScrollReveal>
  );
};

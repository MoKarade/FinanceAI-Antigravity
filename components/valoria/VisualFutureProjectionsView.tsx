import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { MacroIndicators } from '../../services/valoria/marketData';
import { PortfolioLot } from '../../services/valoria/engine';
import { ProAnalystAdvisoryReport } from '../../services/valoria/proAnalystAdvisor';
import { FutureConePoint } from '../../services/valoria/corporateIntelligenceEngine';
import { D3BenchmarkChart } from './D3BenchmarkChart';
import { D3WatchlistVolatilityChart } from './D3WatchlistVolatilityChart';
import { D3DeepCurveLab } from './D3DeepCurveLab';
import { ScrollReveal } from './MotionPrimitives';
import {
  formatCompactEur,
  formatEur,
  formatPct,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';
import { PrivateAmount } from '../ui/PrivateAmount';
import { useFinanceStore } from '../../store/useFinanceStore';

interface VisualFutureProjectionsViewProps {
  advisory: ProAnalystAdvisoryReport;
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  watchlistIds: string[];
  marketUniverseVersion: number;
  onInspectAsset: (assetId: string) => void;
  onAddWatchlistAsset: (assetId: string) => void;
  onRemoveWatchlistAsset: (assetId: string) => void;
  onQuickInvestAsset: (assetId: string, amountCad: number) => void;
}

type ProjectionLens = 'deep_curves' | 'cone_2031' | 'bl_factors' | 'history_vol';

export const VisualFutureProjectionsView: React.FC<
  VisualFutureProjectionsViewProps
> = ({
  advisory,
  lots,
  livePrices,
  macro,
  watchlistIds,
  marketUniverseVersion,
  onInspectAsset,
  onAddWatchlistAsset,
  onRemoveWatchlistAsset,
  onQuickInvestAsset,
}) => {
  const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
  const [lens, setLens] = useState<ProjectionLens>('deep_curves');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [svgWidth, setSvgWidth] = useState<number>(960);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const coneSeries = advisory.multiAgent.futureConeSeries;
  const jumpMc = advisory.institutionalQuant.jumpMonteCarlo;
  const bl = advisory.institutionalQuant.blackLitterman;
  const ff = advisory.institutionalQuant.factorAttribution;

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 280) setSvgWidth(Math.floor(w));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [lens]);

  const activePoint: FutureConePoint | undefined = useMemo(() => {
    if (hoveredIdx !== null && coneSeries[hoveredIdx]) {
      return coneSeries[hoveredIdx];
    }
    return coneSeries[coneSeries.length - 1];
  }, [coneSeries, hoveredIdx]);

  // Render D3 Historical + 5-Year Probabilistic Cone (2023 -> 2031)
  useEffect(() => {
    if (lens !== 'cone_2031') return;
    const svgEl = svgRef.current;
    if (!svgEl || coneSeries.length < 4) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const height = 340;
    const margin = { top: 24, right: 118, bottom: 32, left: 68 };
    const innerW = Math.max(220, svgWidth - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${svgWidth} ${height}`);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const parseDate = d3.utcParse('%Y-%m-%d');
    const dates = coneSeries.map((d) => parseDate(d.dateIso) ?? new Date());

    const xScale = d3
      .scaleUtc()
      .domain(d3.extent(dates) as [Date, Date])
      .range([0, innerW]);

    const allVals: number[] = [];
    coneSeries.forEach((pt) => {
      if (pt.historicalCad !== null) allVals.push(pt.historicalCad);
      if (pt.afterP5Cad !== null) allVals.push(pt.afterP5Cad);
      if (pt.afterP95Cad !== null) allVals.push(pt.afterP95Cad);
      if (pt.beforeP5Cad !== null) allVals.push(pt.beforeP5Cad);
    });

    const yMin = Math.max(0, (d3.min(allVals) ?? 20000) * 0.88);
    const yMax = (d3.max(allVals) ?? 120000) * 1.06;
    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

    // Gridlines
    const yTicks = yScale.ticks(5);
    g.append('g')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', VALORIA_PALETTE.gridZinc)
      .attr('stroke-dasharray', '3 3');

    const xAxis = d3
      .axisBottom(xScale)
      .ticks(Math.max(5, Math.floor(innerW / 110)))
      .tickSizeOuter(0);
    const yAxis = d3
      .axisLeft(yScale)
      .ticks(5)
      .tickSize(0)
      .tickPadding(10)
      .tickFormat((v) => formatCompactEur(Number(v)));

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call((s) => s.select('.domain').attr('stroke', VALORIA_PALETTE.gridZinc))
      .call((s) => s.selectAll('line').attr('stroke', VALORIA_PALETTE.gridZinc))
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '11px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    g.append('g')
      .call(yAxis)
      .call((s) => s.select('.domain').remove())
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '11px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    const histPts = coneSeries
      .map((d, i) => ({ d, dt: dates[i] }))
      .filter((x) => x.d.historicalCad !== null);

    const forecastPts = coneSeries
      .map((d, i) => ({ d, dt: dates[i] }))
      .filter((x) => x.d.afterP50Cad !== null);

    const anchorItem = histPts[histPts.length - 1];
    if (anchorItem) {
      const ax = xScale(anchorItem.dt);
      g.append('line')
        .attr('x1', ax)
        .attr('x2', ax)
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', VALORIA_PALETTE.strokeZinc)
        .attr('stroke-width', 1.3)
        .attr('stroke-dasharray', '4 3');

      g.append('text')
        .attr('x', ax + 6)
        .attr('y', 12)
        .attr('fill', VALORIA_PALETTE.textZincLight)
        .attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text('AUJOURD’HUI → FUTUR 2031');
    }

    // Outer P5-P95 Fan Band
    const area90 = d3
      .area<{ d: FutureConePoint; dt: Date }>()
      .x((x) => xScale(x.dt))
      .y0((x) => yScale(x.d.afterP5Cad ?? 0))
      .y1((x) => yScale(x.d.afterP95Cad ?? 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(forecastPts)
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('fill-opacity', 0.08)
      .attr('d', area90);

    // Inner P25-P75 Interquartile Band
    const area50 = d3
      .area<{ d: FutureConePoint; dt: Date }>()
      .x((x) => xScale(x.dt))
      .y0((x) => yScale(x.d.afterP25Cad ?? 0))
      .y1((x) => yScale(x.d.afterP75Cad ?? 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(forecastPts)
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('fill-opacity', 0.16)
      .attr('d', area50);

    // Historical Solid Line (Crisp White)
    const histLine = d3
      .line<{ d: FutureConePoint; dt: Date }>()
      .x((x) => xScale(x.dt))
      .y((x) => yScale(x.d.historicalCad ?? 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(histPts)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.textBright)
      .attr('stroke-width', 2.2)
      .attr('d', histLine);

    // Before Baseline Median (Dashed Zinc)
    const beforeMedLine = d3
      .line<{ d: FutureConePoint; dt: Date }>()
      .x((x) => xScale(x.dt))
      .y((x) => yScale(x.d.beforeP50Cad ?? 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(forecastPts)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.textZinc)
      .attr('stroke-width', 1.8)
      .attr('stroke-dasharray', '5 4')
      .attr('d', beforeMedLine);

    const p95Line = d3
      .line<{ d: FutureConePoint; dt: Date }>()
      .x((x) => xScale(x.dt))
      .y((x) => yScale(x.d.afterP95Cad ?? 0))
      .curve(d3.curveMonotoneX);

    const p5Line = d3
      .line<{ d: FutureConePoint; dt: Date }>()
      .x((x) => xScale(x.dt))
      .y((x) => yScale(x.d.afterP5Cad ?? 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(forecastPts)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.emeraldLight)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1.2)
      .attr('d', p95Line);

    g.append('path')
      .datum(forecastPts)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.roseLight)
      .attr('stroke-opacity', 0.65)
      .attr('stroke-width', 1.2)
      .attr('d', p5Line);

    // Optimized P50 Median Line (Bold Emerald)
    const afterMedLine = d3
      .line<{ d: FutureConePoint; dt: Date }>()
      .x((x) => xScale(x.dt))
      .y((x) => yScale(x.d.afterP50Cad ?? 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(forecastPts)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.emerald)
      .attr('stroke-width', 2.8)
      .attr('pathLength', 1)
      .attr('class', 'animate-curve-draw')
      .attr('d', afterMedLine);

    const lastPt = forecastPts[forecastPts.length - 1];
    if (lastPt) {
      const endTags = [
        { val: lastPt.d.afterP95Cad ?? 0, label: 'Optimiste', color: VALORIA_PALETTE.emeraldLight, y: 0 },
        { val: lastPt.d.afterP50Cad ?? 0, label: 'Optimisé', color: VALORIA_PALETTE.emerald, y: 0 },
        { val: lastPt.d.beforeP50Cad ?? 0, label: 'Sans agir', color: VALORIA_PALETTE.textZinc, y: 0 },
        { val: lastPt.d.afterP5Cad ?? 0, label: 'Krach P5', color: VALORIA_PALETTE.roseLight, y: 0 },
      ].map((t) => ({ ...t, y: yScale(t.val) + 3 }));

      endTags.sort((a, b) => a.y - b.y);
      for (let i = 1; i < endTags.length; i++) {
        if (endTags[i].y - endTags[i - 1].y < 13) {
          endTags[i].y = endTags[i - 1].y + 13;
        }
      }

      endTags.forEach((t) => {
        g.append('text')
          .attr('x', innerW + 6)
          .attr('y', t.y)
          .attr('fill', t.color)
          .attr('font-size', '10px')
          .attr('font-weight', '600')
          .attr('font-family', 'JetBrains Mono, monospace')
          .text(`${t.label} ${formatCompactEur(t.val)}`);
      });
    }

    const idx = hoveredIdx ?? coneSeries.length - 1;
    const cx = xScale(dates[idx]);
    g.append('line')
      .attr('x1', cx)
      .attr('x2', cx)
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.textWhiteSoft)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-dasharray', '2 2');

    const pt = coneSeries[idx];
    const dotVal = pt.afterP50Cad ?? pt.historicalCad;
    if (dotVal !== null) {
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', yScale(dotVal))
        .attr('r', 4.5)
        .attr('fill', VALORIA_PALETTE.emerald)
        .attr('stroke', VALORIA_PALETTE.bgDeep)
        .attr('stroke-width', 1.5);
    }

    const bisect = d3.bisector((d: Date) => d.getTime()).center;
    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const dt = xScale.invert(mx);
        const i = bisect(dates, dt);
        setHoveredIdx(Math.max(0, Math.min(dates.length - 1, i)));
      })
      .on('mouseleave', () => setHoveredIdx(null));
  }, [coneSeries, svgWidth, hoveredIdx, lens]);

  return (
    <div className="space-y-6">
      {/* Sub-Lens Switcher */}
      <ScrollReveal className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-fond/90 border border-bordure rounded-2xl p-3.5">
        <div className="inline-flex flex-wrap gap-1 p-1 bg-surface border border-bordure rounded-xl">
          <button aria-pressed={Boolean(lens === 'deep_curves')}
            type="button"
            onClick={() => setLens('deep_curves')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              lens === 'deep_curves'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Courbes &amp; Taux
          </button>
          <button aria-pressed={Boolean(lens === 'cone_2031')}
            type="button"
            onClick={() => setLens('cone_2031')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              lens === 'cone_2031'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Projection 2031
          </button>
          <button aria-pressed={Boolean(lens === 'bl_factors')}
            type="button"
            onClick={() => setLens('bl_factors')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              lens === 'bl_factors'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Moteurs de Rendement
          </button>
          <button aria-pressed={Boolean(lens === 'history_vol')}
            type="button"
            onClick={() => setLens('history_vol')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              lens === 'history_vol'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Historique &amp; Risque 10A
          </button>
        </div>

        <div className="font-mono tabular-nums text-xs text-texte flex items-center gap-3">
          <span>
            Rythme 5A :{' '}
            <strong className="text-texte-doux">
              {formatPct(advisory.multiAgent.expectedCagrBeforePct, 1)}
            </strong>{' '}
            →{' '}
            <strong className="text-succes-texte">
              {formatPct(advisory.multiAgent.expectedCagrAfterPct, 1)}/an
            </strong>
          </span>
          <span className="text-texte-doux">·</span>
          <span>
            Gain estimé 2031 :{' '}
            <strong className="text-succes-texte">
              {formatSignedEur(jumpMc.median5yGainDeltaCad, 0)}
            </strong>
          </span>
        </div>
      </ScrollReveal>

      {lens === 'deep_curves' && (
        <D3DeepCurveLab
          lots={lots}
          livePrices={livePrices}
          macro={macro}
          watchlistIds={watchlistIds}
          onInspectAsset={onInspectAsset}
        />
      )}

      {lens === 'cone_2031' && (
        <div className="space-y-6">
          <ScrollReveal className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
            {activePoint && (
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-bordure font-mono tabular-nums text-xs">
                <span className="font-bold text-texte">
                  {activePoint.label}{' '}
                  <span className="text-texte-doux font-normal">
                    ({activePoint.isForecast ? 'Simulation 10 000 scénarios' : 'Historique Réel'})
                  </span>
                </span>

                {activePoint.isForecast ? (
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="text-succes-texte">
                      Optimiste {formatEur(activePoint.afterP95Cad ?? 0, 0)}
                    </span>
                    <span className="text-succes-texte font-bold">
                      Scénario Central {formatEur(activePoint.afterP50Cad ?? 0, 0)}
                    </span>
                    <span className="text-texte-doux">
                      Sans agir {formatEur(activePoint.beforeP50Cad ?? 0, 0)}
                    </span>
                    <span className="text-erreur-texte">
                      En cas de krach {formatEur(activePoint.afterP5Cad ?? 0, 0)}
                    </span>
                  </div>
                ) : (
                  <span className="text-texte font-bold">
                    Valeur : {formatEur(activePoint.historicalCad ?? 0, 0)}
                  </span>
                )}
              </div>
            )}

            <div ref={containerRef} className="w-full overflow-hidden">
              <svg
                ref={svgRef}
                data-testid="d3-future-cone-svg"
                role="img"
                aria-label="Cône prédictif D3 2023-2031 en dollars canadiens"
                className="w-full block select-none"
              />
            </div>

            <div className="pt-3 border-t border-bordure grid grid-cols-2 sm:grid-cols-5 gap-4 font-mono tabular-nums text-xs">
              <div>
                <span className="block font-sans text-[11px] text-texte-doux">
                  Scénario Central 2031
                </span>
                <span className="text-sm font-bold text-succes-texte">
                  {formatEur(jumpMc.after.p50Median5yCad, 0)}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[11px] text-texte-doux">
                  Scénario Optimiste (P95)
                </span>
                <span className="text-sm font-bold text-succes-texte">
                  {formatEur(jumpMc.after.p95Bull5yCad, 0)}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[11px] text-texte-doux">
                  Pire Année Extrême (1%)
                </span>
                <span className="text-sm font-bold text-erreur-texte">
                  −{formatEur(jumpMc.after.cvar99AnnualCad, 0)}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[11px] text-texte-doux">
                  Efficacité (Omega · Sortino)
                </span>
                <span className="text-sm font-bold text-texte">
                  {jumpMc.after.omegaRatio.toFixed(2)} · {jumpMc.after.sortinoRatio.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[11px] text-texte-doux">
                  Risque de Perte sur 5A
                </span>
                <span className="text-sm font-bold text-succes-texte">
                  {formatPct(jumpMc.after.probLoss5yPct, 1)}
                </span>
              </div>
            </div>
          </ScrollReveal>

          {/* Visual 4 Crisis Stress Test Bars ($ CAD) */}
          <ScrollReveal className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-baseline justify-between pb-2 border-b border-bordure">
              <h3 className="text-sm font-semibold text-texte">
                Protection contre 4 Grandes Crises Historiques ($ CAD)
              </h3>
              <span className="font-mono text-xs text-succes-texte">
                ▲ Argent épargné en cas de tempête
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono tabular-nums text-xs">
              {advisory.xray.stressScenarios.map((sc) => {
                const maxLoss = Math.max(
                  1000,
                  Math.abs(sc.impactBeforeCad),
                  Math.abs(sc.impactAfterCad)
                );
                const wBefore = Math.min(100, (Math.abs(sc.impactBeforeCad) / maxLoss) * 100);
                const wAfter = Math.min(100, (Math.abs(sc.impactAfterCad) / maxLoss) * 100);

                return (
                  <div
                    key={sc.id}
                    className="p-4 bg-surface/60 border border-bordure rounded-xl space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-sans font-semibold text-texte">
                        {sc.title}
                      </span>
                      <span className="text-succes-texte font-bold">
                        {sc.capitalProtectedCad >= 0
                          ? `+${formatEur(sc.capitalProtectedCad, 0)} sauvé`
                          : formatEur(sc.capitalProtectedCad, 0)}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-16 text-[10px] text-texte-doux font-sans">
                          Actuel
                        </span>
                        <div className="flex-1 h-2 bg-surface-douce rounded-full overflow-hidden">
                          <div
                            className="h-full bg-erreur-texte"
                            style={{ width: isPrivacyMode ? '0%' : `${wBefore}%` }}
                          />
                        </div>
                        <PrivateAmount className="w-20 text-right text-erreur-texte">
                          {formatSignedEur(sc.impactBeforeCad, 0)}
                        </PrivateAmount>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="w-16 text-[10px] text-succes-texte font-sans">
                          Optimisé
                        </span>
                        <div className="flex-1 h-2 bg-surface-douce rounded-full overflow-hidden">
                          <div
                            className="h-full bg-succes-texte"
                            style={{ width: isPrivacyMode ? '0%' : `${wAfter}%` }}
                          />
                        </div>
                        <PrivateAmount className="w-20 text-right text-succes-texte font-semibold">
                          {formatSignedEur(sc.impactAfterCad, 0)}
                        </PrivateAmount>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollReveal>
        </div>
      )}

      {lens === 'bl_factors' && (
        <ScrollReveal className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <section className="lg:col-span-7 bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-baseline justify-between pb-2 border-b border-bordure">
              <h3 className="text-sm font-semibold text-texte">
                Rendement Annuel Attendu par Actif (Black-Litterman)
              </h3>
              <span className="font-mono text-xs text-texte-doux">
                Corrélation moy. {bl.averageCorrelation}
              </span>
            </div>

            <div className="space-y-2.5 font-mono tabular-nums text-xs">
              {bl.rows.slice(0, 10).map((row) => {
                const maxMu = 18;
                const barW = Math.max(6, Math.min(100, (Math.max(0, row.posteriorExpectedReturnPct) / maxMu) * 100));
                return (
                  <button
                    key={row.assetId}
                    type="button"
                    onClick={() => onInspectAsset(row.assetId)}
                    className="min-h-11 w-full text-left grid grid-cols-[88px_1fr_118px] items-center gap-3 py-1.5 px-2 hover:bg-surface rounded-xl transition-colors cursor-pointer"
                  >
                    <div>
                      <span className="font-bold text-texte">{row.ticker}</span>
                      <span className="block text-[10px] text-texte-doux">
                        Fiab. {row.viewConfidencePct}%
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="w-full h-2 bg-surface border border-bordure rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            row.posteriorExpectedReturnPct >= 8
                              ? 'bg-succes-texte'
                              : row.posteriorExpectedReturnPct <= 4
                                ? 'bg-erreur-texte'
                                : 'bg-texte'
                          }`}
                          // NOMBRE-NON-MONETAIRE : rendement attendu annuel Black-Litterman d'actif
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-texte-doux">
                        <span>Marché {formatPct(row.equilibriumReturnPct, 1)}</span>
                        <span>Valeur {formatPct(row.dcfFundamentalViewPct, 1)}</span>
                        <span
                          className={
                            row.newsCatalystShockPct >= 0
                              ? 'text-succes-texte'
                              : 'text-erreur-texte'
                          }
                        >
                          Actus {formatSignedPct(row.newsCatalystShockPct, 1)}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`font-bold ${
                          row.posteriorExpectedReturnPct >= 7
                            ? 'text-succes-texte'
                            : 'text-texte'
                        }`}
                      >
                        {formatSignedPct(row.posteriorExpectedReturnPct, 1)}/an
                      </span>
                      <PrivateAmount className="block text-[10px] text-texte-doux">
                        {row.currentWeightPct.toFixed(0)}% → {row.optimalWeightPct.toFixed(0)}%
                      </PrivateAmount>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="lg:col-span-5 bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4">
            <div className="flex items-baseline justify-between pb-2 border-b border-bordure">
              <h3 className="text-sm font-semibold text-texte">
                6 Moteurs de Performance (Fama-French)
              </h3>
              <span className="font-mono text-xs text-succes-texte">
                Surperformance {formatSignedPct(ff.annualizedAlphaAfterPct, 2)}
              </span>
            </div>

            <div className="space-y-3.5 font-mono tabular-nums text-xs">
              {ff.factors.map((f) => {
                const toPct = (beta: number) =>
                  Math.min(48, Math.abs(beta) * 34);
                return (
                  <div key={f.code} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-sans font-medium text-texte">
                        {f.code} · {f.name}
                      </span>
                      <span>
                        <span className="text-texte-doux">
                          {f.betaBefore >= 0 ? '+' : ''}
                          {f.betaBefore.toFixed(2)}
                        </span>{' '}
                        →{' '}
                        <strong
                          className={
                            f.betaAfter >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                          }
                        >
                          {f.betaAfter >= 0 ? '+' : ''}
                          {f.betaAfter.toFixed(2)}
                        </strong>
                      </span>
                    </div>

                    <div className="h-3 bg-surface border border-bordure rounded-sm relative overflow-hidden">
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-bordure-champ" />
                      <div
                        className={`absolute top-0.5 bottom-0.5 rounded-sm ${
                          f.betaAfter >= 0 ? 'bg-succes-texte' : 'bg-erreur-texte'
                        }`}
                        style={{
                          left:
                            f.betaAfter >= 0
                              ? '50%'
                              : `${50 - toPct(f.betaAfter)}%`,
                          // NOMBRE-NON-MONETAIRE : exposition factorielle Fama-French bêta
                          width: `${toPct(f.betaAfter)}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-bordure flex items-center justify-between font-mono text-xs text-texte-doux">
              <span>Avant : {formatSignedPct(ff.annualizedAlphaBeforePct, 2)}/an</span>
              <span className="text-succes-texte font-bold">
                Après : {formatSignedPct(ff.annualizedAlphaAfterPct, 2)}/an
              </span>
            </div>
          </section>
        </ScrollReveal>
      )}

      {lens === 'history_vol' && (
        <div className="space-y-6">
          <D3BenchmarkChart lots={lots} livePrices={livePrices} />
          <D3WatchlistVolatilityChart
            watchlistIds={watchlistIds}
            lots={lots}
            livePrices={livePrices}
            riskFreeRatePct={macro.centralBankRatePct}
            marketUniverseVersion={marketUniverseVersion}
            onAddWatchlistAsset={onAddWatchlistAsset}
            onRemoveWatchlistAsset={onRemoveWatchlistAsset}
            onQuickInvestAsset={onQuickInvestAsset}
            onInspectAsset={onInspectAsset}
          />
        </div>
      )}
    </div>
  );
};

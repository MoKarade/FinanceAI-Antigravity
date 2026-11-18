import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { TimeMachineCurvePoint } from '../../services/valoria/aiTimeMachineEngine';
import {
  formatCompactEur,
  formatEur,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface D3AiTimeMachineChartProps {
  series: TimeMachineCurvePoint[];
  initialCapitalCad: number;
  epochHorizonLabel: string;
}

const FR_SHORT_MONTHS = [
  'Janv.',
  'Févr.',
  'Mars',
  'Avr.',
  'Mai',
  'Juin',
  'Juil.',
  'Août',
  'Sept.',
  'Oct.',
  'Nov.',
  'Déc.',
];

export const D3AiTimeMachineChart: React.FC<D3AiTimeMachineChartProps> = ({
  series,
  initialCapitalCad,
  epochHorizonLabel,
}) => {
  const [metricMode, setMetricMode] = useState<'cad' | 'pct'>('cad');
  const [showRandomBand, setShowRandomBand] = useState<boolean>(true);
  const [hoveredPoint, setHoveredPoint] = useState<TimeMachineCurvePoint | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [svgWidth, setSvgWidth] = useState<number>(760);

  useEffect(() => {
    setHoveredPoint(null);
  }, [series, initialCapitalCad]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const measured = Math.round(el.getBoundingClientRect().width);
      if (measured >= 260) {
        setSvgWidth(measured);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(() => updateWidth());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isCompact = svgWidth < 520;
  const svgHeight = isCompact ? 256 : 308;

  const lastPoint = series[series.length - 1] ?? null;
  const activePoint = hoveredPoint ?? lastPoint;

  const regimeMarkers = useMemo(
    () => series.filter((pt) => Boolean(pt.regimeMarker)),
    [series]
  );

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (series.length < 2) return;

    const width = Math.max(280, svgWidth);
    const height = svgHeight;
    const margin = isCompact
      ? { top: 18, right: 12, bottom: 32, left: 54 }
      : { top: 22, right: 24, bottom: 36, left: 70 };
    const innerW = Math.max(140, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xExtent = d3.extent(series, (d) => d.date) as [Date, Date];
    const spanDays = Math.max(
      1,
      (xExtent[1].getTime() - xExtent[0].getTime()) / (1000 * 3600 * 24)
    );
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerW]);

    const getAi = (d: TimeMachineCurvePoint) =>
      metricMode === 'cad' ? d.aiValueCad : d.aiCumPct;
    const getUser = (d: TimeMachineCurvePoint) =>
      metricMode === 'cad' ? d.userPortfolioValueCad : d.userPortfolioCumPct;
    const getWorld = (d: TimeMachineCurvePoint) =>
      metricMode === 'cad' ? d.worldIndexValueCad : d.worldIndexCumPct;
    const getRandMed = (d: TimeMachineCurvePoint) =>
      metricMode === 'cad' ? d.randomMedianCad : d.randomMedianCumPct;
    const getRandP25 = (d: TimeMachineCurvePoint) =>
      metricMode === 'cad' ? d.randomP25Cad : d.randomP25CumPct;
    const getRandP75 = (d: TimeMachineCurvePoint) =>
      metricMode === 'cad' ? d.randomP75Cad : d.randomP75CumPct;

    const allValues = series.flatMap((d) => {
      const base = [getAi(d), getUser(d), getWorld(d), getRandMed(d)];
      if (showRandomBand) {
        base.push(getRandP25(d), getRandP75(d));
      }
      if (metricMode === 'cad') base.push(initialCapitalCad);
      else base.push(0);
      return base;
    });

    const rawMin = d3.min(allValues) ?? 0;
    const rawMax = d3.max(allValues) ?? 100;
    const pad = Math.max(1.5, (rawMax - rawMin) * 0.09);

    const yScale = d3
      .scaleLinear()
      .domain([
        metricMode === 'cad' ? Math.max(0, rawMin - pad * 0.6) : rawMin - pad * 0.6,
        rawMax + pad * 0.7,
      ])
      .range([innerH, 0]);

    // Horizontal gridlines
    const yTicks = yScale.ticks(isCompact ? 4 : 5);
    g.append('g')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', (d) =>
        (metricMode === 'pct' && d === 0) ||
        (metricMode === 'cad' && Math.abs(d - initialCapitalCad) < 1)
          ? VALORIA_PALETTE.strokeZinc
          : VALORIA_PALETTE.gridZinc
      )
      .attr('stroke-dasharray', '3 3');

    // Y-axis
    const yAxis = d3
      .axisLeft(yScale)
      .ticks(isCompact ? 4 : 5)
      .tickSize(0)
      .tickPadding(isCompact ? 6 : 10)
      .tickFormat((val) => {
        const num = Number(val);
        if (metricMode === 'pct') {
          const formatted = Number.isInteger(num)
            ? String(num)
            : num.toFixed(0);
          return `${num > 0 ? '+' : ''}${formatted}%`;
        }
        return formatCompactEur(num);
      });

    const yAxisGroup = g.append('g').call(yAxis);
    yAxisGroup.select('.domain').remove();
    yAxisGroup
      .selectAll('text')
      .attr('fill', VALORIA_PALETTE.textZinc)
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', isCompact ? '9.5px' : '10.5px');

    // X-axis
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(Math.min(isCompact ? 4 : 6, series.length))
      .tickSize(0)
      .tickPadding(10)
      .tickFormat((d) => {
        const dt = d as Date;
        const mIdx = dt.getUTCMonth();
        const yr = dt.getUTCFullYear();
        const day = dt.getUTCDate();
        if (spanDays <= 45) {
          return `${day} ${FR_SHORT_MONTHS[mIdx].toLowerCase()}`;
        }
        if (spanDays <= 420) {
          return `${FR_SHORT_MONTHS[mIdx]} ${String(yr).slice(-2)}`;
        }
        return isCompact
          ? `${FR_SHORT_MONTHS[mIdx]} ${String(yr).slice(-2)}`
          : `${FR_SHORT_MONTHS[mIdx]} ${yr}`;
      });

    const xAxisGroup = g
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis);
    xAxisGroup.select('.domain').attr('stroke', VALORIA_PALETTE.gridZinc);
    xAxisGroup
      .selectAll('text')
      .attr('fill', VALORIA_PALETTE.textZinc)
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', isCompact ? '9.5px' : '10.5px');

    const curveFactory = series.length > 45 ? d3.curveLinear : d3.curveMonotoneX;

    // 1. Random Luck P25–P75 interquartile band ("Bande du Hasard")
    if (showRandomBand) {
      const randomBandArea = d3
        .area<TimeMachineCurvePoint>()
        .x((d) => xScale(d.date))
        .y0((d) => yScale(getRandP25(d)))
        .y1((d) => yScale(getRandP75(d)))
        .curve(curveFactory);

      g.append('path')
        .datum(series)
        .attr('fill', VALORIA_PALETTE.mutedZinc)
        .attr('fill-opacity', 0.14)
        .attr('d', randomBandArea);
    }

    // Subtle Regime Event Vertical Guides on multi-year histories (e.g., 2020 COVID, 2022 Rate Shock)
    if (!isCompact && regimeMarkers.length > 0) {
      const markerG = g.append('g');
      regimeMarkers.forEach((m) => {
        const mx = xScale(m.date);
        if (mx < 36 || mx > innerW - 44) return;
        markerG
          .append('line')
          .attr('x1', mx)
          .attr('x2', mx)
          .attr('y1', 0)
          .attr('y2', innerH)
          .attr('stroke', VALORIA_PALETTE.axisZinc)
          .attr('stroke-dasharray', '2 3');
        markerG
          .append('text')
          .attr('x', mx + 4)
          .attr('y', 10)
          .attr('fill', VALORIA_PALETTE.mutedZinc)
          .attr('font-family', 'Plus Jakarta Sans, sans-serif')
          .attr('font-size', '9.5px')
          .text(m.regimeMarker ?? '');
      });
    }

    // Gradient under AI curve
    const defs = svg.append('defs');
    const aiGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-ai-retro-grad')
      .attr('x1', '0')
      .attr('y1', '0')
      .attr('x2', '0')
      .attr('y2', '1');
    aiGrad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', VALORIA_PALETTE.emerald)
      .attr('stop-opacity', 0.2);
    aiGrad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', VALORIA_PALETTE.emerald)
      .attr('stop-opacity', 0.0);

    const baselineY =
      metricMode === 'pct'
        ? yScale(0)
        : Math.min(innerH, yScale(initialCapitalCad));

    const aiArea = d3
      .area<TimeMachineCurvePoint>()
      .x((d) => xScale(d.date))
      .y0(baselineY)
      .y1((d) => yScale(getAi(d)))
      .curve(curveFactory);

    g.append('path')
      .datum(series)
      .attr('fill', 'url(#d3-ai-retro-grad)')
      .attr('d', aiArea);

    // 2. Random Median Line (Dotted Muted Zinc)
    const randLine = d3
      .line<TimeMachineCurvePoint>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(getRandMed(d)))
      .curve(curveFactory);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.mutedZinc)
      .attr('stroke-width', 1.45)
      .attr('stroke-dasharray', '2 3')
      .attr('d', randLine);

    // 3. MSCI World Benchmark Line (Dashed Cool Slate/Sky)
    const worldLine = d3
      .line<TimeMachineCurvePoint>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(getWorld(d)))
      .curve(curveFactory);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.blue)
      .attr('stroke-width', 1.7)
      .attr('stroke-dasharray', '5 3')
      .attr('d', worldLine);

    // 4. User's Current Portfolio Replay Line (Solid Crisp Zinc)
    const userLine = d3
      .line<TimeMachineCurvePoint>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(getUser(d)))
      .curve(curveFactory);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.lineZinc)
      .attr('stroke-width', 1.75)
      .attr('stroke-opacity', 0.88)
      .attr('d', userLine);

    // 5. AI Epoch Selection Curve (Primary Emerald Anchor)
    const aiLine = d3
      .line<TimeMachineCurvePoint>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(getAi(d)))
      .curve(curveFactory);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.emerald)
      .attr('stroke-width', 2.6)
      .attr('stroke-linejoin', 'round')
      .attr('pathLength', 1)
      .attr('class', 'animate-curve-draw')
      .attr('d', aiLine);

    // Interactive Crosshair
    const focusGroup = g.append('g').attr('class', 'hidden');

    const crossLine = focusGroup
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.textBright)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 1);

    const randDot = focusGroup
      .append('circle')
      .attr('r', 3)
      .attr('fill', VALORIA_PALETTE.mutedZinc)
      .attr('stroke', VALORIA_PALETTE.bgDeep)
      .attr('stroke-width', 1.2);

    const worldDot = focusGroup
      .append('circle')
      .attr('r', 3.5)
      .attr('fill', VALORIA_PALETTE.blue)
      .attr('stroke', VALORIA_PALETTE.bgDeep)
      .attr('stroke-width', 1.4);

    const userDot = focusGroup
      .append('circle')
      .attr('r', 3.8)
      .attr('fill', VALORIA_PALETTE.lineZinc)
      .attr('stroke', VALORIA_PALETTE.bgDeep)
      .attr('stroke-width', 1.4);

    const aiDot = focusGroup
      .append('circle')
      .attr('r', 4.6)
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('stroke', VALORIA_PALETTE.bgDeep)
      .attr('stroke-width', 1.6);

    const bisectDate = d3.bisector((d: TimeMachineCurvePoint) => d.date).left;

    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .attr('class', 'cursor-crosshair')
      .on('pointerenter', () => {
        focusGroup.classed('hidden', false);
      })
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event);
        const xDate = xScale.invert(mx);
        const idx = bisectDate(series, xDate, 1);
        const d0 = series[idx - 1];
        const d1 = series[idx];
        const d =
          d1 && xDate.getTime() - d0.date.getTime() > d1.date.getTime() - xDate.getTime()
            ? d1
            : d0;

        if (d) {
          const cx = xScale(d.date);
          crossLine.attr('x1', cx).attr('x2', cx);
          aiDot.attr('cx', cx).attr('cy', yScale(getAi(d)));
          userDot.attr('cx', cx).attr('cy', yScale(getUser(d)));
          worldDot.attr('cx', cx).attr('cy', yScale(getWorld(d)));
          randDot.attr('cx', cx).attr('cy', yScale(getRandMed(d)));
          setHoveredPoint(d);
        }
      })
      .on('pointerleave', () => {
        focusGroup.classed('hidden', true);
        setHoveredPoint(null);
      });
  }, [
    series,
    metricMode,
    showRandomBand,
    initialCapitalCad,
    svgWidth,
    svgHeight,
    isCompact,
    regimeMarkers,
  ]);

  return (
    <div className="bg-surface/35 border border-bordure rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-texte">
            Trajectoire Réelle : Sélection IA d’Époque vs Témoins ($ CAD)
          </h3>
          <p className="text-xs text-texte-doux mt-0.5">{epochHorizonLabel}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRandomBand((v) => !v)}
            className={`min-h-11 px-3 py-1 text-xs font-medium border rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showRandomBand
                ? 'bg-surface-douce/90 text-texte border-bordure-champ'
                : 'bg-fond text-texte-doux border-bordure hover:text-texte'
            }`}
          >
            {showRandomBand ? 'Bande Hasard P25–P75 active' : 'Afficher bande Hasard'}
          </button>

          <div
            role="group"
            aria-label="Unité de comparaison"
            className="inline-flex items-center gap-0.5 p-1 bg-fond border border-bordure rounded-xl"
          >
            <button aria-pressed={Boolean(metricMode === 'cad')}
              type="button"
              onClick={() => setMetricMode('cad')}
              className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                metricMode === 'cad'
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              Valeur ($ CAD)
            </button>
            <button aria-pressed={Boolean(metricMode === 'pct')}
              type="button"
              onClick={() => setMetricMode('pct')}
              className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                metricMode === 'pct'
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              Gain (%)
            </button>
          </div>
        </div>
      </div>

      {/* Synchronized Tabular Readout Bar */}
      {activePoint && (
        <div className="py-2.5 px-3.5 bg-fond/75 border border-bordure rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs font-mono tabular-nums">
          <span className="font-sans text-texte-doux shrink-0">
            Point lu :{' '}
            <strong className="font-mono text-texte font-medium">
              {activePoint.label}
            </strong>
          </span>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <span className="font-sans text-texte-doux">IA d’époque : </span>
              <strong className="text-succes-texte">
                {metricMode === 'cad'
                  ? formatEur(activePoint.aiValueCad, 0)
                  : formatSignedPct(activePoint.aiCumPct, 1)}
              </strong>
            </span>

            <span>
              <span className="font-sans text-texte-doux">Mon portefeuille : </span>
              <strong className="text-texte">
                {metricMode === 'cad'
                  ? formatEur(activePoint.userPortfolioValueCad, 0)
                  : formatSignedPct(activePoint.userPortfolioCumPct, 1)}
              </strong>
            </span>

            <span>
              <span className="font-sans text-texte-doux">MSCI World : </span>
              <strong className="text-accent">
                {metricMode === 'cad'
                  ? formatEur(activePoint.worldIndexValueCad, 0)
                  : formatSignedPct(activePoint.worldIndexCumPct, 1)}
              </strong>
            </span>

            <span>
              <span className="font-sans text-texte-doux">Hasard médian : </span>
              <strong className="text-texte-doux">
                {metricMode === 'cad'
                  ? formatEur(activePoint.randomMedianCad, 0)
                  : formatSignedPct(activePoint.randomMedianCumPct, 1)}
              </strong>
              {metricMode === 'cad' && (
                <span className="text-texte-doux ml-1">
                  ({formatSignedEur(activePoint.aiValueCad - activePoint.randomMedianCad, 0)} IA)
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      <div ref={containerRef}>
        <div className="w-full overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${Math.max(280, svgWidth)} ${svgHeight}`}
            className="w-full h-auto select-none block"
            role="img"
            aria-label="Graphique D3 comparant les prédictions passées de l’IA à votre portefeuille, au MSCI World et à 250 portefeuilles tirés au hasard"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-1 border-t border-bordure text-[11px] sm:text-xs text-texte-doux">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 bg-accent inline-block" />
              <span className="text-texte font-medium">Sélection IA à l’époque</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 bg-texte inline-block" />
              <span>Mon portefeuille actuel (rejoué)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 border-t-2 border-dashed border-accent inline-block" />
              <span>Indice Mondial (XEQT)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 border-t border-dotted border-bordure-champ inline-block" />
              <span>Hasard (250 tirages · médiane &amp; P25–P75)</span>
            </span>
          </div>
          <span className="text-texte-doux hidden lg:inline">
            Survolez la courbe pour inspecter chaque mois jusqu’à aujourd’hui
          </span>
        </div>
      </div>
    </div>
  );
};

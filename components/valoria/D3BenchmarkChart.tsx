import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { PortfolioLot } from '../../services/valoria/engine';
import {
  BenchmarkPeriod,
  BenchmarkSeriesPoint,
  buildBenchmarkComparisonSeries,
} from '../../services/valoria/monteCarlo10k';
import {
  formatCompactEur,
  formatEur,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface D3BenchmarkChartProps {
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
}

const BENCHMARKS = [
  { id: 'XEQT', label: 'Actions Mondiales (XEQT)' },
  { id: 'ESE', label: 'S&P 500 (ESE)' },
  { id: 'MEUD', label: 'Stoxx Europe 600' },
  { id: 'GOLD', label: 'Or Physique' },
  { id: 'LIVRET_A', label: 'Épargne CPG Garanti' },
] as const;

const PERIOD_OPTIONS: { id: BenchmarkPeriod; label: string; title: string }[] = [
  { id: '1M', label: '1M', title: '1 dernier mois' },
  { id: '3M', label: '3M', title: '3 derniers mois' },
  { id: '6M', label: '6M', title: '6 derniers mois' },
  { id: 'ALL_HOLDING', label: 'Depuis achat', title: 'Depuis le premier achat (FinanceAI)' },
  { id: '1Y', label: '1A', title: '1 an glissant' },
  { id: '3Y', label: '3A', title: '3 ans (reconstitué avant achat)' },
  { id: '5Y', label: '5A', title: '5 ans (reconstitué avant achat)' },
  { id: 'MAX', label: 'MAX', title: 'Historique complet depuis 2015' },
];

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

const FR_LOWER_MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

export const D3BenchmarkChart: React.FC<D3BenchmarkChartProps> = ({
  lots,
  livePrices,
}) => {
  const hasDailyHistory = useMemo(
    () => lots.some((l) => l.dailyHistoryCad && l.dailyHistoryCad.length >= 2),
    [lots]
  );

  const [period, setPeriod] = useState<BenchmarkPeriod>(() =>
    hasDailyHistory ? 'ALL_HOLDING' : 'MAX'
  );
  const [benchmarkId, setBenchmarkId] = useState<string>('XEQT');
  const [metricMode, setMetricMode] = useState<'pct' | 'cad'>('pct');
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [hoveredPoint, setHoveredPoint] = useState<BenchmarkSeriesPoint | null>(null);

  const prevHadDailyRef = useRef<boolean>(hasDailyHistory);
  useEffect(() => {
    if (hasDailyHistory && !prevHadDailyRef.current) {
      setPeriod('ALL_HOLDING');
      setHoveredPoint(null);
    }
    prevHadDailyRef.current = hasDailyHistory;
  }, [hasDailyHistory]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [svgWidth, setSvgWidth] = useState<number>(760);

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
  const svgHeight = isCompact ? 236 : 280;

  const benchmarkLabel =
    BENCHMARKS.find((b) => b.id === benchmarkId)?.label ?? 'MSCI World';

  const series = useMemo(
    () =>
      buildBenchmarkComparisonSeries({
        lots,
        livePrices,
        benchmarkAssetId: benchmarkId,
        period,
      }),
    [lots, livePrices, benchmarkId, period]
  );

  const lastPoint = series[series.length - 1] ?? null;
  const isPositivePortfolio = (lastPoint?.portfolioCumPct ?? 0) >= 0;
  const portfolioStrokeColor = isPositivePortfolio ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose;

  const activePoint = hoveredPoint ?? lastPoint;

  const windowSpanSummary = useMemo(() => {
    if (series.length < 2) return '';
    const startLbl = series[0].label.replace(' (Spot)', '');
    const endLbl = series[series.length - 1].label.replace(' (Spot)', '');
    const unit = series.length > 45 && period !== '3Y' && period !== '5Y' && period !== 'MAX'
      ? 'séances'
      : 'pts';
    return `${startLbl} → ${endLbl} · ${series.length} ${unit}`;
  }, [series, period]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (series.length < 2) return;

    const width = Math.max(280, svgWidth);
    const height = svgHeight;
    const margin = isCompact
      ? { top: 16, right: 12, bottom: 30, left: 52 }
      : { top: 20, right: 24, bottom: 34, left: 68 };
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

    const getPortVal = (d: BenchmarkSeriesPoint) =>
      metricMode === 'pct' ? d.portfolioCumPct : d.portfolioValueEur;
    const getBenchVal = (d: BenchmarkSeriesPoint) =>
      metricMode === 'pct' ? d.benchmarkCumPct : d.benchmarkValueEur;

    const allValues = series.flatMap((d) => {
      if (metricMode === 'pct') {
        return showOverlay
          ? [0, d.portfolioCumPct, d.benchmarkCumPct]
          : [0, d.portfolioCumPct];
      }
      return showOverlay
        ? [d.portfolioValueEur, d.benchmarkValueEur, d.investedCumulativeEur]
        : [d.portfolioValueEur, d.investedCumulativeEur];
    });

    const rawMin = d3.min(allValues) ?? 0;
    const rawMax = d3.max(allValues) ?? 100;
    const pad = Math.max(1.5, (rawMax - rawMin) * 0.08);

    const yScale = d3
      .scaleLinear()
      .domain([
        metricMode === 'cad' ? Math.max(0, rawMin - pad * 0.6) : rawMin - pad * 0.6,
        rawMax + pad * 0.65,
      ])
      .range([innerH, 0]);

    // Sober zinc horizontal gridlines
    const yTicks = yScale.ticks(isCompact ? 4 : 5);
    g.append('g')
      .attr('class', 'grid-lines')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', (d) => (d === 0 && metricMode === 'pct' ? VALORIA_PALETTE.strokeZinc : VALORIA_PALETTE.gridZinc))
      .attr('stroke-dasharray', (d) =>
        d === 0 && metricMode === 'pct' ? '4 3' : '3 3'
      );

    // Y-axis labels
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
            : num.toFixed(1).replace('.', ',');
          return `${num > 0 ? '+' : ''}${formatted}%`;
        }
        return formatCompactEur(num);
      });

    const yAxisGroup = g.append('g').call(yAxis);
    yAxisGroup.select('.domain').remove();
    yAxisGroup
      .selectAll('text')
      .attr('fill', VALORIA_PALETTE.textZinc)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', isCompact ? '9.5px' : '10.5px');

    // X-axis with adaptive daily/monthly/multi-year French labels
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
        if (spanDays <= 195) {
          return `${day} ${FR_LOWER_MONTHS[mIdx]}`;
        }
        if (spanDays <= 410) {
          return `${FR_LOWER_MONTHS[mIdx]} ${String(yr).slice(-2)}`;
        }
        return isCompact
          ? `${FR_LOWER_MONTHS[mIdx]} ${String(yr).slice(-2)}`
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
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', isCompact ? '9.5px' : '10.5px');

    const curveFactory = series.length > 45 ? d3.curveLinear : d3.curveMonotoneX;

    // Semantic green/red gradient fill under portfolio curve
    const defs = svg.append('defs');
    const grad = defs
      .append('linearGradient')
      .attr('id', 'd3-port-grad')
      .attr('x1', '0')
      .attr('y1', '0')
      .attr('x2', '0')
      .attr('y2', '1');
    grad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', portfolioStrokeColor)
      .attr('stop-opacity', 0.22);
    grad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', portfolioStrokeColor)
      .attr('stop-opacity', 0.0);

    const baselineY = metricMode === 'pct' ? yScale(0) : innerH;

    const areaGen = d3
      .area<BenchmarkSeriesPoint>()
      .x((d) => xScale(d.date))
      .y0(baselineY)
      .y1((d) => yScale(getPortVal(d)))
      .curve(curveFactory);

    g.append('path')
      .datum(series)
      .attr('fill', 'url(#d3-port-grad)')
      .attr('d', areaGen);

    if (metricMode === 'cad') {
      const investedLine = d3
        .line<BenchmarkSeriesPoint>()
        .x((d) => xScale(d.date))
        .y((d) => yScale(d.investedCumulativeEur))
        .curve(d3.curveStepAfter);

      g.append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', VALORIA_PALETTE.mutedZinc)
        .attr('stroke-width', 1.4)
        .attr('stroke-dasharray', '2 2')
        .attr('d', investedLine);
    }

    // Benchmark curve (sober zinc dashed overlay)
    if (showOverlay) {
      const benchLine = d3
        .line<BenchmarkSeriesPoint>()
        .x((d) => xScale(d.date))
        .y((d) => yScale(getBenchVal(d)))
        .curve(curveFactory);

      g.append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', VALORIA_PALETTE.textZinc)
        .attr('stroke-width', 1.65)
        .attr('stroke-dasharray', '5 3')
        .attr('d', benchLine);
    }

    // Portfolio curve with draw animation
    const portLine = d3
      .line<BenchmarkSeriesPoint>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(getPortVal(d)))
      .curve(curveFactory);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', portfolioStrokeColor)
      .attr('stroke-width', series.length > 90 ? 2.1 : 2.6)
      .attr('stroke-linejoin', 'round')
      .attr('pathLength', 1)
      .attr('class', 'animate-curve-draw')
      .attr('d', portLine);

    // Interactive Crosshair Layer
    const focusGroup = g.append('g').attr('class', 'hidden');

    const crossLine = focusGroup
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.textBright)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 1);

    const benchDot = focusGroup
      .append('circle')
      .attr('r', 3.5)
      .attr('fill', VALORIA_PALETTE.textZinc)
      .attr('stroke', VALORIA_PALETTE.bgDeep)
      .attr('stroke-width', 1.5)
      .attr('class', showOverlay ? '' : 'hidden');

    const portDot = focusGroup
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', portfolioStrokeColor)
      .attr('stroke', VALORIA_PALETTE.bgDeep)
      .attr('stroke-width', 1.5);

    const bisectDate = d3.bisector((d: BenchmarkSeriesPoint) => d.date).left;

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
          portDot.attr('cx', cx).attr('cy', yScale(getPortVal(d)));
          if (showOverlay) {
            benchDot.attr('cx', cx).attr('cy', yScale(getBenchVal(d)));
          }
          setHoveredPoint(d);
        }
      })
      .on('pointerleave', () => {
        focusGroup.classed('hidden', true);
        setHoveredPoint(null);
      });
  }, [series, metricMode, showOverlay, portfolioStrokeColor, svgWidth, svgHeight, isCompact]);

  return (
    <section className="bg-surface/55 border border-bordure rounded-2xl p-4 sm:p-6 space-y-3.5 sm:space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <div>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm sm:text-base font-bold text-texte">
                Votre Courbe vs Marché ($ CAD)
              </h2>
              {windowSpanSummary && (
                <span
                  data-testid="benchmark-window-badge"
                  className="text-[11px] sm:text-xs font-mono tabular-nums text-texte-doux"
                >
                  · {windowSpanSummary}
                </span>
              )}
            </div>
            <p className="text-xs text-texte-doux mt-0.5">
              {hasDailyHistory
                ? `Courbe réelle convertie en $ CAD et comparée à ${benchmarkLabel}`
                : `Voyez en un coup d’œil si votre argent bat ${benchmarkLabel} en $ CAD`}
            </p>
          </div>
        </div>

        {/* Period, Overlay, Benchmark & Metric Controls */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2">
          <div
            role="group"
            aria-label="Période de comparaison"
            className="flex items-center gap-1 p-1 bg-fond border border-bordure rounded-xl overflow-x-auto no-scrollbar max-w-full"
          >
            {PERIOD_OPTIONS.map((opt) => (
              <button aria-pressed={Boolean(period === opt.id)}
                key={opt.id}
                type="button"
                title={opt.title}
                onClick={() => {
                  setPeriod(opt.id);
                  setHoveredPoint(null);
                }}
                className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-mono font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  period === opt.id
                    ? 'bg-accent text-sur-accent font-semibold'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowOverlay((prev) => !prev)}
              className={`min-h-11 px-3 py-1.5 text-xs font-medium border rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showOverlay
                  ? 'bg-surface-douce text-texte border-bordure-champ'
                  : 'bg-fond text-texte-doux border-bordure hover:text-texte'
              }`}
            >
              {showOverlay ? 'Superposer indice' : 'Focus 1 courbe'}
            </button>

            {showOverlay && (
              <select
                aria-label="Indice de référence"
                value={benchmarkId}
                onChange={(e) => {
                  setBenchmarkId(e.target.value);
                  setHoveredPoint(null);
                }}
                className="min-h-11 px-2.5 py-1.5 text-base sm:text-xs font-medium bg-fond border border-bordure rounded-xl text-texte outline-hidden focus-ring focus:border-bordure-champ max-w-full"
              >
                {BENCHMARKS.map((b) => (
                  <option key={b.id} value={b.id}>
                    vs {b.label}
                  </option>
                ))}
              </select>
            )}

            <div
              role="group"
              aria-label="Unité du graphique"
              className="flex items-center gap-0.5 p-1 bg-fond border border-bordure rounded-xl"
            >
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
            </div>
          </div>
        </div>
      </div>

      {/* Live Readout Strip */}
      {activePoint && (
        <div
          data-testid="benchmark-readout"
          className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-1.5 sm:gap-3 py-2.5 px-3 bg-fond/80 border border-bordure rounded-xl text-[11px] sm:text-xs font-mono tabular-nums"
        >
          <span className="font-sans font-medium text-texte">
            Date : <span className="font-mono text-texte">{activePoint.label}</span>
          </span>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <span>
              <span className="font-sans text-texte-doux">Portefeuille : </span>
              <strong
                className={
                  activePoint.portfolioCumPct >= 0
                    ? 'text-succes-texte'
                    : 'text-erreur-texte'
                }
              >
                {metricMode === 'pct'
                  ? formatSignedPct(activePoint.portfolioCumPct)
                  : formatEur(activePoint.portfolioValueEur, 0)}
              </strong>
            </span>
            {showOverlay && (
              <>
                <span>
                  <span className="font-sans text-texte-doux">{benchmarkLabel} : </span>
                  <strong className="text-texte">
                    {metricMode === 'pct'
                      ? formatSignedPct(activePoint.benchmarkCumPct)
                      : formatEur(activePoint.benchmarkValueEur, 0)}
                  </strong>
                </span>
                <span>
                  <span className="font-sans text-texte-doux">Écart : </span>
                  <strong
                    className={
                      activePoint.alphaPct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                    }
                  >
                    {metricMode === 'pct'
                      ? `${activePoint.alphaPct >= 0 ? '▲ +' : '▼ '}${activePoint.alphaPct.toFixed(2).replace('.', ',')} pts`
                      : formatSignedEur(
                          activePoint.portfolioValueEur - activePoint.benchmarkValueEur,
                          0
                        )}
                  </strong>
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {series.length >= 2 ? (
        <div ref={containerRef}>
          <div className="w-full overflow-hidden">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${Math.max(280, svgWidth)} ${svgHeight}`}
              data-testid="d3-benchmark-svg"
              className="w-full h-auto select-none block"
              role="img"
              aria-label={`Graphique D3 comparant la performance cumulée du portefeuille en dollars canadiens à ${benchmarkLabel}`}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-1 border-t border-bordure text-[11px] sm:text-xs text-texte-doux">
            <div className="flex flex-wrap items-center gap-3.5 sm:gap-5">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`w-3.5 h-0.5 inline-block ${
                    isPositivePortfolio ? 'bg-accent' : 'bg-erreur-texte'
                  }`}
                />
                <span>Votre portefeuille ($ CAD)</span>
              </span>
              {showOverlay && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-0.5 border-t-2 border-dashed border-bordure-champ inline-block" />
                  <span>Indice {benchmarkLabel}</span>
                </span>
              )}
              {metricMode === 'cad' && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-0.5 border-t border-dotted border-bordure-champ inline-block" />
                  <span>Capital versé ($ CAD)</span>
                </span>
              )}
            </div>
            <span className="text-texte-doux hidden sm:inline">
              Glissez la souris sur la courbe pour lire chaque date
            </span>
          </div>
        </div>
      ) : (
        <div className="py-10 text-center text-sm text-texte-doux">
          Ajoutez au moins un actif au portefeuille pour afficher la courbe comparative.
        </div>
      )}
    </section>
  );
};

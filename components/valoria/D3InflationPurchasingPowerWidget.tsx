import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import {
  INFLATION_SCENARIO_PRESETS,
  type InflationScenarioId,
  simulateInflationPurchasingPower,
} from '../../services/valoria/inflationPurchasingPowerEngine';
import { AnimatedNumber } from './MotionPrimitives';
import {
  formatCompactEur,
  formatEur,
  formatPct,
  formatSignedEur,
} from '../../services/valoria/valoriaFormatters';

interface D3InflationPurchasingPowerWidgetProps {
  portfolioCapitalCad: number;
  currentNominalReturnPct: number;
  recommendedNominalReturnPct: number;
}

const HORIZON_OPTIONS = [5, 10, 20] as const;

export const D3InflationPurchasingPowerWidget: React.FC<
  D3InflationPurchasingPowerWidgetProps
> = ({
  portfolioCapitalCad,
  currentNominalReturnPct,
  recommendedNominalReturnPct,
}) => {
  const [scenarioId, setScenarioId] =
    useState<InflationScenarioId>('historical_decade');
  const [customInflationPct, setCustomInflationPct] = useState<number>(2.6);
  const [horizonYears, setHorizonYears] = useState<number>(10);
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const [svgWidth, setSvgWidth] = useState<number>(920);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const activeInflationPct = useMemo(() => {
    if (scenarioId === 'custom') return customInflationPct;
    return (
      INFLATION_SCENARIO_PRESETS.find((s) => s.id === scenarioId)
        ?.annualInflationPct ?? 2.6
    );
  }, [scenarioId, customInflationPct]);

  const sim = useMemo(
    () =>
      simulateInflationPurchasingPower({
        capitalCad: portfolioCapitalCad,
        horizonYears,
        projectedInflationPct: activeInflationPct,
        currentNominalReturnPct,
        recommendedNominalReturnPct,
      }),
    [
      portfolioCapitalCad,
      horizonYears,
      activeInflationPct,
      currentNominalReturnPct,
      recommendedNominalReturnPct,
    ]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 260) setSvgWidth(Math.floor(w));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const inspectedPoint = useMemo(() => {
    if (hoveredYear !== null) {
      const found = sim.timeline.find((p) => p.year === hoveredYear);
      if (found) return found;
    }
    return sim.timeline[sim.timeline.length - 1];
  }, [sim.timeline, hoveredYear]);

  // Render D3 Dual-Era Purchasing Power vs Inflation Erosion Chart
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || sim.timeline.length < 4) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const isCompact = svgWidth < 540;
    const height = isCompact ? 256 : 310;
    const margin = isCompact
      ? { top: 22, right: 76, bottom: 28, left: 46 }
      : { top: 24, right: 124, bottom: 30, left: 64 };
    const innerW = Math.max(130, svgWidth - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${svgWidth} ${height}`);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const minYear = sim.timeline[0].year;
    const maxYear = sim.timeline[sim.timeline.length - 1].year;

    const xScale = d3
      .scaleLinear()
      .domain([minYear, maxYear])
      .range([0, innerW]);

    const allVals = sim.timeline.flatMap((p) => [
      p.cashRealCad,
      p.currentPortfolioRealCad,
      p.recommendedPortfolioRealCad,
      p.recommendedNominalCad,
    ]);

    const yMin = Math.max(0, (d3.min(allVals) ?? 0) * 0.85);
    const yMax = (d3.max(allVals) ?? sim.baseCapitalCad * 1.5) * 1.07;
    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

    // Subtle horizontal gridlines
    const yTicks = yScale.ticks(4);
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

    // Horizontal reference line at Today's Starting Capital (100% purchasing power)
    const baseY = yScale(sim.baseCapitalCad);
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', baseY)
      .attr('y2', baseY)
      .attr('stroke', VALORIA_PALETTE.strokeZinc)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 3');

    // Rose Shaded Inflation Erosion Area on Projected Cash (2026 -> End)
    const projectedPts = sim.timeline.filter((p) => p.year >= 2026);
    const erosionArea = d3
      .area<(typeof projectedPts)[number]>()
      .x((p) => xScale(p.year))
      .y0(() => baseY)
      .y1((p) => yScale(p.cashRealCad))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(projectedPts)
      .attr('fill', VALORIA_PALETTE.rose)
      .attr('fill-opacity', 0.14)
      .attr('d', erosionArea);

    // Emerald Shaded Real Purchasing Power Gain Area (Recommended vs Base Capital, 2026 -> End)
    const realGainArea = d3
      .area<(typeof projectedPts)[number]>()
      .x((p) => xScale(p.year))
      .y0(() => baseY)
      .y1((p) => yScale(p.recommendedPortfolioRealCad))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(projectedPts)
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('fill-opacity', 0.12)
      .attr('d', realGainArea);

    // Vertical 2026 Anchor Divider (Historique IPC Canada | Projection)
    const anchorX = xScale(2026);
    g.append('line')
      .attr('x1', anchorX)
      .attr('x2', anchorX)
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.mutedZinc)
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '4 3');

    g.append('text')
      .attr('x', Math.max(4, anchorX - 5))
      .attr('y', 11)
      .attr('text-anchor', 'end')
      .attr('fill', VALORIA_PALETTE.textZinc)
      .attr('font-size', isCompact ? '9px' : '10px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(isCompact ? '← IPC VÉCU' : '← IPC VÉCU (2016–2026)');

    g.append('text')
      .attr('x', anchorX + 5)
      .attr('y', 11)
      .attr('fill', VALORIA_PALETTE.lineZinc)
      .attr('font-size', isCompact ? '9px' : '10px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(
        isCompact
          // NOMBRE-NON-MONETAIRE : libellé de régime d'inflation futur
          ? `FUTUR ${activeInflationPct.toFixed(1)}% →`
          : `FUTUR (${activeInflationPct.toFixed(1)} %/an) →`
      );

    // 1. Nominal Recommended Curve (Dashed Zinc — Bank statement illusion before inflation)
    const nomLine = d3
      .line<(typeof projectedPts)[number]>()
      .x((p) => xScale(p.year))
      .y((p) => yScale(p.recommendedNominalCad))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(projectedPts)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.textZinc)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4')
      .attr('d', nomLine);

    // 2. Current Portfolio Real Purchasing Power (Subtle Light Zinc)
    const currentRealLine = d3
      .line<(typeof sim.timeline)[number]>()
      .x((p) => xScale(p.year))
      .y((p) => yScale(p.currentPortfolioRealCad))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(sim.timeline)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.textZincLight)
      .attr('stroke-opacity', 0.65)
      .attr('stroke-width', 1.6)
      .attr('d', currentRealLine);

    // 3. Idle Cash Eroded by Inflation (Solid Rose)
    const cashLine = d3
      .line<(typeof sim.timeline)[number]>()
      .x((p) => xScale(p.year))
      .y((p) => yScale(p.cashRealCad))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(sim.timeline)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.rose)
      .attr('stroke-width', 2.3)
      .attr('d', cashLine);

    // 4. Recommended Portfolio Real Purchasing Power (Bold Emerald)
    const recRealLine = d3
      .line<(typeof sim.timeline)[number]>()
      .x((p) => xScale(p.year))
      .y((p) => yScale(p.recommendedPortfolioRealCad))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(sim.timeline)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.emerald)
      .attr('stroke-width', 2.7)
      .attr('d', recRealLine);

    // Axes
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(isCompact ? 4 : Math.min(8, sim.timeline.length))
      .tickFormat((d) => String(d))
      .tickSizeOuter(0);

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(4)
      .tickSize(0)
      .tickPadding(6)
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
          .attr('font-size', isCompact ? '10px' : '11px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    g.append('g')
      .call(yAxis)
      .call((s) => s.select('.domain').remove())
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', isCompact ? '10px' : '11px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    // Right-edge clean labels with anti-collision spacing
    const endPt = sim.timeline[sim.timeline.length - 1];
    const rightLabels = [
      {
        label: isCompact
          ? `Nom. ${formatCompactEur(endPt.recommendedNominalCad)}`
          : `Nominal ${formatCompactEur(endPt.recommendedNominalCad)}`,
        y: yScale(endPt.recommendedNominalCad) + 3,
        color: VALORIA_PALETTE.textZinc,
      },
      {
        label: `Réel ${formatCompactEur(endPt.recommendedPortfolioRealCad)}`,
        y: yScale(endPt.recommendedPortfolioRealCad) + 3,
        color: VALORIA_PALETTE.emerald,
      },
      {
        label: isCompact
          ? `Act. ${formatCompactEur(endPt.currentPortfolioRealCad)}`
          : `Actuel ${formatCompactEur(endPt.currentPortfolioRealCad)}`,
        y: yScale(endPt.currentPortfolioRealCad) + 3,
        color: VALORIA_PALETTE.textZincLight,
      },
      {
        label: `Cash ${formatCompactEur(endPt.cashRealCad)}`,
        y: yScale(endPt.cashRealCad) + 3,
        color: VALORIA_PALETTE.rose,
      },
    ].sort((a, b) => a.y - b.y);

    for (let i = 1; i < rightLabels.length; i++) {
      if (rightLabels[i].y - rightLabels[i - 1].y < 13) {
        rightLabels[i].y = rightLabels[i - 1].y + 13;
      }
    }

    for (const tag of rightLabels) {
      g.append('text')
        .attr('x', innerW + 6)
        .attr('y', tag.y)
        .attr('fill', tag.color)
        .attr('font-size', isCompact ? '9px' : '10px')
        .attr('font-weight', '600')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(tag.label);
    }

    // Active / Hovered Year Scrubber
    const activeYr = inspectedPoint.year;
    const cx = xScale(activeYr);
    g.append('line')
      .attr('x1', cx)
      .attr('x2', cx)
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.textWhiteSoft)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-dasharray', '2 2');

    g.append('circle')
      .attr('cx', cx)
      .attr('cy', yScale(inspectedPoint.recommendedPortfolioRealCad))
      .attr('r', 4.5)
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('stroke', VALORIA_PALETTE.bgDeep)
      .attr('stroke-width', 1.5);

    g.append('circle')
      .attr('cx', cx)
      .attr('cy', yScale(inspectedPoint.cashRealCad))
      .attr('r', 4.5)
      .attr('fill', VALORIA_PALETTE.rose)
      .attr('stroke', VALORIA_PALETTE.bgDeep)
      .attr('stroke-width', 1.5);

    // Interactive pointer overlay
    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .attr('class', 'cursor-crosshair')
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const yr = Math.round(xScale.invert(mx));
        const clamped = Math.max(minYear, Math.min(maxYear, yr));
        setHoveredYear(clamped);
      })
      .on('mouseleave', () => setHoveredYear(null));
  }, [sim, svgWidth, inspectedPoint, activeInflationPct]);

  const maxBarRef = Math.max(
    sim.baseCapitalCad,
    sim.recommendedRealEndCad,
    sim.currentRealEndCad
  );

  const cashWidthPct = Math.min(
    100,
    (sim.projectedCashRealEndCad / Math.max(1, maxBarRef)) * 100
  );
  const currentWidthPct = Math.min(
    100,
    (sim.currentRealEndCad / Math.max(1, maxBarRef)) * 100
  );
  const recWidthPct = Math.min(
    100,
    (sim.recommendedRealEndCad / Math.max(1, maxBarRef)) * 100
  );
  const baseLinePct = Math.min(
    100,
    (sim.baseCapitalCad / Math.max(1, maxBarRef)) * 100
  );

  return (
    <section
      aria-label="Simulateur d’érosion du pouvoir d’achat face à l’inflation"
      className="bg-surface/50 border border-bordure rounded-2xl p-4 sm:p-7 space-y-5 sm:space-y-6"
    >
      {/* Clean Header + Compact Interactive Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5 pb-4 sm:pb-5 border-b border-bordure">
        <div className="space-y-1">
          <h2 className="text-base sm:text-xl font-bold text-texte">
            Pouvoir d’Achat Réel face à l’Inflation ($ CAD)
          </h2>
          <p className="text-xs text-texte-doux">
            Comparez l’érosion de l’argent immobile (rose) à votre vrai pouvoir d’achat investi net d’inflation (vert).
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
          {/* Inflation Scenario Selector */}
          <div
            role="group"
            aria-label="Scénario d’inflation"
            className="grid grid-cols-2 sm:inline-flex items-center gap-1 p-1 bg-fond border border-bordure rounded-xl w-full sm:w-auto"
          >
            {INFLATION_SCENARIO_PRESETS.map((preset) => {
              const active = scenarioId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setScenarioId(preset.id);
                    setCustomInflationPct(preset.annualInflationPct);
                  }}
                  className={`min-w-11 min-h-11 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-accent text-sur-accent font-semibold'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  {preset.shortLabel}
                </button>
              );
            })}
          </div>

          {/* Horizon Selector */}
          <div
            role="group"
            aria-label="Horizon de projection"
            className="grid grid-cols-3 sm:inline-flex items-center gap-1 p-1 bg-fond border border-bordure rounded-xl"
          >
            {HORIZON_OPTIONS.map((yr) => (
              <button aria-pressed={Boolean(horizonYears === yr)}
                key={yr}
                type="button"
                onClick={() => setHorizonYears(yr)}
                className={`min-w-11 min-h-11 px-2.5 py-1.5 text-xs font-mono tabular-nums font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  horizonYears === yr
                    ? 'bg-accent text-sur-accent font-semibold'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                {/* NOMBRE-NON-MONETAIRE : bouton d'horizon temporel */}
                {yr} ans
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Fine Custom Inflation Slider + 3 Crisp Visual KPIs (2x2 on Phone, 4 cols on Desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 items-stretch">
        <div className="col-span-2 sm:col-span-1 p-3 sm:p-3.5 bg-fond/80 border border-bordure rounded-xl flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between text-xs font-mono tabular-nums">
            <label htmlFor="inflation-rate-slider" className="font-sans text-texte-doux">
              Inflation projetée
            </label>
            <span className="font-bold text-texte">
              {formatPct(activeInflationPct, 1)} / an
            </span>
          </div>
          <input
            id="inflation-rate-slider"
            type="range"
            min={0.5}
            max={8.5}
            step={0.1}
            value={activeInflationPct}
            onChange={(e) => {
              setScenarioId('custom');
              setCustomInflationPct(Number(e.target.value));
            }}
            className="w-full h-6 accent-accent cursor-pointer"
          />
          <div className="flex justify-between gap-2 text-[10px] font-mono text-texte-doux">
            <span>IPC 10A : −{formatPct(sim.historicalDecadeCashLossPct, 1)}</span>
            <span>0,5 % → 8,5 %</span>
          </div>
        </div>

        <div className="p-3 sm:p-3.5 bg-fond/80 border border-bordure rounded-xl space-y-1 font-mono tabular-nums">
          <span className="block font-sans text-[11px] sm:text-xs text-texte-doux truncate">
            Cash en {sim.endYear}
          </span>
          <div className="text-base sm:text-lg font-bold text-erreur-texte">
            −<AnimatedNumber
              value={sim.projectedCashLossCad}
              formatter={(n) => formatEur(n, 0)}
            />
          </div>
          <span className="block text-[10px] sm:text-[11px] text-erreur-texte leading-tight">
            ▼ −{formatPct(sim.projectedCashLossPct, 1)} perdu
          </span>
        </div>

        <div className="p-3 sm:p-3.5 bg-fond/80 border border-bordure rounded-xl space-y-1 font-mono tabular-nums">
          <span className="block font-sans text-[11px] sm:text-xs text-texte-doux truncate">
            Pouvoir réel ({sim.endYear})
          </span>
          <div className="text-base sm:text-lg font-bold text-succes-texte">
            <AnimatedNumber
              value={sim.recommendedRealEndCad}
              formatter={(n) => formatEur(n, 0)}
            />
          </div>
          <span className="block text-[10px] sm:text-[11px] text-succes-texte leading-tight">
            ▲ {formatSignedEur(sim.recommendedRealEndCad - sim.baseCapitalCad, 0)} net
          </span>
        </div>

        <div className="col-span-2 lg:col-span-1 p-3 sm:p-3.5 bg-fond/80 border border-bordure rounded-xl space-y-1 font-mono tabular-nums">
          <span className="block font-sans text-[11px] sm:text-xs text-texte-doux">
            Illusion nominale évitée
          </span>
          <div className="text-base sm:text-lg font-bold text-texte">
            {formatEur(sim.recommendedNominalEndCad, 0)}
          </div>
          <span className="block text-[10px] sm:text-[11px] text-texte-doux">
            Affiché avant −{formatCompactEur(sim.nominalIllusionGapCad)} d’inflation
          </span>
        </div>
      </div>

      {/* Interactive Scrubber Strip + D3 Chart */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-texte px-1">
          <span>
            Année <strong className="text-texte">{inspectedPoint.year}</strong>
            {' · '}
            <span className="text-texte-doux">
              {/* NOMBRE-NON-MONETAIRE : taux d'inflation IPC macro */}
              {inspectedPoint.era === 'historical'
                ? `Historique Canada (IPC ${inspectedPoint.annualInflationPct.toFixed(1)} %)`
                : inspectedPoint.era === 'anchor'
                  ? `Capital actuel (${formatEur(sim.baseCapitalCad, 0)})`
                  // NOMBRE-NON-MONETAIRE : taux d'inflation projeté
                  : `Projection (${activeInflationPct.toFixed(1)} %/an)`}
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-succes-texte font-semibold">
              ● Investi réel : {formatEur(inspectedPoint.recommendedPortfolioRealCad, 0)}
            </span>
            <span className="text-texte-doux">
              ● Ce que j’ai : {formatEur(inspectedPoint.currentPortfolioRealCad, 0)}
            </span>
            <span className="text-erreur-texte font-semibold">
              ● Cash érodé : {formatEur(inspectedPoint.cashRealCad, 0)}
            </span>
          </div>
        </div>

        <div ref={containerRef} className="w-full overflow-hidden">
          <svg
            ref={svgRef}
            data-testid="d3-inflation-purchasing-power-svg"
            role="img"
            aria-label="Graphique D3 d’érosion du pouvoir d’achat face à l’inflation historique et projetée en dollars canadiens"
            className="w-full block select-none"
          />
        </div>
      </div>

      {/* Visual 3-Bar Comparison at Horizon (Zero Dense Text) */}
      <div className="pt-4 border-t border-bordure space-y-2.5 font-mono tabular-nums text-xs">
        <div className="flex items-center justify-between text-[11px] text-texte-doux">
          <span className="font-sans">
            Que vaudront réellement vos {formatEur(sim.baseCapitalCad, 0)} d’aujourd’hui en {sim.endYear} ?
          </span>
          <span>Repère 100 % = {formatEur(sim.baseCapitalCad, 0)}</span>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-[120px_1fr_96px] sm:grid-cols-[150px_1fr_110px] items-center gap-3">
            <span className="font-sans text-texte-doux truncate">Cash immobile (0 %)</span>
            <svg
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="w-full h-2.5 rounded-full overflow-hidden border border-bordure bg-fond"
            >
              <rect x="0" y="0" width={cashWidthPct} height="6" className="fill-erreur-texte" />
              <line
                x1={baseLinePct}
                y1="0"
                x2={baseLinePct}
                y2="6"
                className="stroke-texte-doux"
                strokeWidth="0.6"
              />
            </svg>
            <span className="text-right text-erreur-texte font-semibold">
              {formatEur(sim.projectedCashRealEndCad, 0)}
            </span>
          </div>

          <div className="grid grid-cols-[120px_1fr_96px] sm:grid-cols-[150px_1fr_110px] items-center gap-3">
            <span className="font-sans text-texte truncate">Ce que j’ai (réel)</span>
            <svg
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="w-full h-2.5 rounded-full overflow-hidden border border-bordure bg-fond"
            >
              <rect x="0" y="0" width={currentWidthPct} height="6" className="fill-texte" />
              <line
                x1={baseLinePct}
                y1="0"
                x2={baseLinePct}
                y2="6"
                className="stroke-texte-doux"
                strokeWidth="0.6"
              />
            </svg>
            <span className="text-right text-texte font-semibold">
              {formatEur(sim.currentRealEndCad, 0)}
            </span>
          </div>

          <div className="grid grid-cols-[120px_1fr_96px] sm:grid-cols-[150px_1fr_110px] items-center gap-3">
            <span className="font-sans text-succes-texte font-medium truncate">
              Recommandé (réel)
            </span>
            <svg
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="w-full h-2.5 rounded-full overflow-hidden border border-bordure bg-fond"
            >
              <rect x="0" y="0" width={recWidthPct} height="6" className="fill-succes-texte" />
              <line
                x1={baseLinePct}
                y1="0"
                x2={baseLinePct}
                y2="6"
                className="stroke-texte-doux"
                strokeWidth="0.6"
              />
            </svg>
            <span className="text-right text-succes-texte font-bold">
              {formatEur(sim.recommendedRealEndCad, 0)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

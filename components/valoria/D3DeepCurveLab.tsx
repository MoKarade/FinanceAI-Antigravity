import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { ASSETS, MacroIndicators } from '../../services/valoria/marketData';
import { PortfolioLot } from '../../services/valoria/engine';
import {
  CurveHorizonYears,
  analyzeDeepCurveStructure,
  analyzeSovereignYieldCurve,
} from '../../services/valoria/institutionalCurveAndNewsEngine';
import { ScrollReveal } from './MotionPrimitives';
import {
  formatCompactEur,
  formatEur,
  formatPct,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface D3DeepCurveLabProps {
  lots: PortfolioLot[];
  afterLots?: PortfolioLot[];
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  watchlistIds: string[];
  onInspectAsset?: (assetId: string) => void;
}

type EnvelopeMode = 'ols_channel' | 'bollinger';

const HORIZONS: Array<{ years: CurveHorizonYears; label: string }> = [
  { years: 1, label: '1A' },
  { years: 3, label: '3A' },
  { years: 5, label: '5A' },
  { years: 10, label: '10A' },
];

export const D3DeepCurveLab: React.FC<D3DeepCurveLabProps> = ({
  lots,
  afterLots = [],
  livePrices,
  macro,
  watchlistIds,
  onInspectAsset,
}) => {
  const [subjectId, setSubjectId] = useState<string>('PORTFOLIO_BEFORE');
  const [horizonYears, setHorizonYears] = useState<CurveHorizonYears>(3);
  const [envelopeMode, setEnvelopeMode] = useState<EnvelopeMode>('ols_channel');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const [priceSvgWidth, setPriceSvgWidth] = useState<number>(960);
  const [ddSvgWidth, setDdSvgWidth] = useState<number>(520);
  const [yieldSvgWidth, setYieldSvgWidth] = useState<number>(480);

  const priceWrapRef = useRef<HTMLDivElement | null>(null);
  const ddWrapRef = useRef<HTMLDivElement | null>(null);
  const yieldWrapRef = useRef<HTMLDivElement | null>(null);

  const priceSvgRef = useRef<SVGSVGElement | null>(null);
  const ddSvgRef = useRef<SVGSVGElement | null>(null);
  const yieldSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const observers: ResizeObserver[] = [];
    const bind = (
      el: HTMLDivElement | null,
      setter: React.Dispatch<React.SetStateAction<number>>
    ) => {
      if (!el) return;
      const measure = () => {
        const w = Math.floor(el.getBoundingClientRect().width);
        if (w >= 240) setter(w);
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.push(ro);
    };
    bind(priceWrapRef.current, setPriceSvgWidth);
    bind(ddWrapRef.current, setDdSvgWidth);
    bind(yieldWrapRef.current, setYieldSvgWidth);
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const subjectOptions = useMemo(() => {
    const heldIds = Array.from(new Set(lots.map((l) => l.assetId)));
    const priorityIds = Array.from(
      new Set([...heldIds, ...watchlistIds, 'ADP', 'INTC', 'GOOGL', 'RY', 'LLY', 'XEQT', 'BTC'])
    );
    const priorityAssets = priorityIds
      .map((id) => ASSETS.find((a) => a.id === id))
      .filter((a): a is (typeof ASSETS)[number] => Boolean(a));
    const restAssets = ASSETS.filter((a) => !priorityIds.includes(a.id));
    return { priorityAssets, restAssets };
  }, [lots, watchlistIds]);

  const curveAnalysis = useMemo(
    () =>
      analyzeDeepCurveStructure({
        subjectId,
        horizonYears,
        lots,
        afterLots,
        livePrices,
        riskFreeRatePct: macro.centralBankRatePct,
      }),
    [subjectId, horizonYears, lots, afterLots, livePrices, macro.centralBankRatePct]
  );

  const yieldDiagnostics = useMemo(
    () => analyzeSovereignYieldCurve(macro.inflationPct),
    [macro.inflationPct]
  );

  const points = curveAnalysis.points;
  const activePt = points[hoveredIdx ?? points.length - 1] ?? points[0];
  const isPortfolioSubject =
    subjectId === 'PORTFOLIO_BEFORE' || subjectId === 'PORTFOLIO_AFTER';
  const valDecimals = !isPortfolioSubject && curveAnalysis.endValueCad < 2 ? 4 : isPortfolioSubject ? 0 : 2;

  // D3 Chart 1: Structural Price Envelope
  useEffect(() => {
    const svgEl = priceSvgRef.current;
    if (!svgEl || points.length < 4) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const height = 296;
    const margin = { top: 20, right: 24, bottom: 28, left: 66 };
    const innerW = Math.max(200, priceSvgWidth - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${priceSvgWidth} ${height}`);
    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([0, points.length - 1])
      .range([0, innerW]);

    const allYVals = points.flatMap((p) =>
      envelopeMode === 'ols_channel'
        ? [
            p.priceCad,
            p.benchmarkCad,
            p.regLower2SigmaCad,
            p.regUpper2SigmaCad,
            p.sma12Cad,
          ]
        : [
            p.priceCad,
            p.benchmarkCad,
            p.bollingerLowerCad,
            p.bollingerUpperCad,
            p.sma6Cad,
            p.sma12Cad,
          ]
    );

    const yMin = Math.max(0, (d3.min(allYVals) ?? 50) * 0.94);
    const yMax = (d3.max(allYVals) ?? 150) * 1.05;
    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

    // Gridlines
    g.append('g')
      .selectAll('line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', VALORIA_PALETTE.gridZinc)
      .attr('stroke-dasharray', '3 3');

    const tickStep = Math.max(1, Math.floor(points.length / 6));
    const xTicks = points
      .map((p) => p.index)
      .filter((i) => i % tickStep === 0 || i === points.length - 1);

    const xAxis = d3
      .axisBottom(xScale)
      .tickValues(xTicks)
      .tickSize(3)
      .tickFormat((i) => points[Number(i)]?.yearMonth ?? '');

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(5)
      .tickSize(0)
      .tickPadding(8)
      .tickFormat((v) =>
        isPortfolioSubject || Number(v) >= 1000
          ? formatCompactEur(Number(v))
          : formatEur(Number(v), valDecimals === 4 ? 2 : 0)
      );

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call((s) => s.select('.domain').attr('stroke', VALORIA_PALETTE.gridZinc))
      .call((s) => s.selectAll('line').attr('stroke', VALORIA_PALETTE.gridZinc))
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '10px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    g.append('g')
      .call(yAxis)
      .call((s) => s.select('.domain').remove())
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '10px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    if (envelopeMode === 'ols_channel') {
      const band2 = d3
        .area<(typeof points)[number]>()
        .x((d) => xScale(d.index))
        .y0((d) => yScale(d.regLower2SigmaCad))
        .y1((d) => yScale(d.regUpper2SigmaCad))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('fill', VALORIA_PALETTE.textZinc)
        .attr('fill-opacity', 0.08)
        .attr('d', band2);

      const band1 = d3
        .area<(typeof points)[number]>()
        .x((d) => xScale(d.index))
        .y0((d) => yScale(d.regLower1SigmaCad))
        .y1((d) => yScale(d.regUpper1SigmaCad))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('fill', VALORIA_PALETTE.textZincLight)
        .attr('fill-opacity', 0.12)
        .attr('d', band1);

      const midLine = d3
        .line<(typeof points)[number]>()
        .x((d) => xScale(d.index))
        .y((d) => yScale(d.regMidCad))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', VALORIA_PALETTE.lineZinc)
        .attr('stroke-width', 1.4)
        .attr('stroke-dasharray', '5 4')
        .attr('d', midLine);
    } else {
      const bollArea = d3
        .area<(typeof points)[number]>()
        .x((d) => xScale(d.index))
        .y0((d) => yScale(d.bollingerLowerCad))
        .y1((d) => yScale(d.bollingerUpperCad))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('fill', VALORIA_PALETTE.textZinc)
        .attr('fill-opacity', 0.12)
        .attr('d', bollArea);

      const sma6Line = d3
        .line<(typeof points)[number]>()
        .x((d) => xScale(d.index))
        .y((d) => yScale(d.sma6Cad))
        .curve(d3.curveMonotoneX);

      const sma12Line = d3
        .line<(typeof points)[number]>()
        .x((d) => xScale(d.index))
        .y((d) => yScale(d.sma12Cad))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', VALORIA_PALETTE.textBright)
        .attr('stroke-width', 1.3)
        .attr('stroke-opacity', 0.85)
        .attr('d', sma6Line);

      g.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', VALORIA_PALETTE.textZinc)
        .attr('stroke-width', 1.3)
        .attr('stroke-dasharray', '4 3')
        .attr('d', sma12Line);
    }

    const benchLine = d3
      .line<(typeof points)[number]>()
      .x((d) => xScale(d.index))
      .y((d) => yScale(d.benchmarkCad))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.mutedZinc)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3')
      .attr('d', benchLine);

    const mainStroke = curveAnalysis.totalReturnPct >= 0 ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose;
    const priceLine = d3
      .line<(typeof points)[number]>()
      .x((d) => xScale(d.index))
      .y((d) => yScale(d.priceCad))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', mainStroke)
      .attr('stroke-width', 2.5)
      .attr('pathLength', 1)
      .attr('class', 'animate-curve-draw')
      .attr('d', priceLine);

    curveAnalysis.inflections.forEach((inf) => {
      const cx = xScale(inf.index);
      const cy = yScale(inf.priceCad);
      const color =
        inf.kind === 'SOMMET' || inf.kind === 'CROISEMENT_HAUSSIER'
          ? VALORIA_PALETTE.emeraldLight
          : VALORIA_PALETTE.roseLight;
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 4.5)
        .attr('fill', color)
        .attr('stroke', VALORIA_PALETTE.bgDeep)
        .attr('stroke-width', 1.5);

      const anchor =
        cx > innerW - 75 ? 'end' : cx < 65 ? 'start' : 'middle';
      const labelY =
        inf.kind === 'CREUX_MAX_DD'
          ? Math.min(innerH - 6, cy + 14)
          : Math.max(11, cy - 9);
      g.append('text')
        .attr('x', cx)
        .attr('y', labelY)
        .attr('text-anchor', anchor)
        .attr('fill', color)
        .attr('font-size', '9px')
        .attr('font-weight', '700')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(inf.tag);
    });

    const idx = hoveredIdx ?? points.length - 1;
    const pt = points[idx];
    if (pt) {
      const hx = xScale(idx);
      g.append('line')
        .attr('x1', hx)
        .attr('x2', hx)
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', VALORIA_PALETTE.textWhiteSoft)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-dasharray', '2 2');

      g.append('circle')
        .attr('cx', hx)
        .attr('cy', yScale(pt.priceCad))
        .attr('r', 4.5)
        .attr('fill', mainStroke)
        .attr('stroke', VALORIA_PALETTE.bgDeep)
        .attr('stroke-width', 1.6);
    }

    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const i = Math.round(xScale.invert(mx));
        setHoveredIdx(Math.max(0, Math.min(points.length - 1, i)));
      })
      .on('mouseleave', () => setHoveredIdx(null));
  }, [points, curveAnalysis, priceSvgWidth, envelopeMode, hoveredIdx, isPortfolioSubject, valDecimals]);

  // D3 Chart 2: Underwater Drawdown Curve
  useEffect(() => {
    const svgEl = ddSvgRef.current;
    if (!svgEl || points.length < 4) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const height = 210;
    const margin = { top: 18, right: 18, bottom: 26, left: 48 };
    const innerW = Math.max(180, ddSvgWidth - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${ddSvgWidth} ${height}`);
    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([0, points.length - 1])
      .range([0, innerW]);

    const minDd = Math.min(
      -8,
      d3.min(points, (p) => Math.min(p.drawdownPct, p.benchmarkDrawdownPct)) ?? -15
    );
    const yScale = d3.scaleLinear().domain([minDd * 1.1, 0.5]).range([innerH, 0]);

    g.append('g')
      .selectAll('line')
      .data(yScale.ticks(4))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', VALORIA_PALETTE.gridZinc)
      .attr('stroke-dasharray', '3 3');

    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', VALORIA_PALETTE.strokeZinc)
      .attr('stroke-width', 1.2);

    const ddArea = d3
      .area<(typeof points)[number]>()
      .x((d) => xScale(d.index))
      .y0(yScale(0))
      .y1((d) => yScale(d.drawdownPct))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('fill', VALORIA_PALETTE.rose)
      .attr('fill-opacity', 0.22)
      .attr('d', ddArea);

    const benchDdLine = d3
      .line<(typeof points)[number]>()
      .x((d) => xScale(d.index))
      .y((d) => yScale(d.benchmarkDrawdownPct))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.mutedZinc)
      .attr('stroke-width', 1.3)
      .attr('stroke-dasharray', '4 3')
      .attr('d', benchDdLine);

    const ddLine = d3
      .line<(typeof points)[number]>()
      .x((d) => xScale(d.index))
      .y((d) => yScale(d.drawdownPct))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.roseLight)
      .attr('stroke-width', 2)
      .attr('d', ddLine);

    const tickStep = Math.max(1, Math.floor(points.length / 4));
    const xTicks = points
      .map((p) => p.index)
      .filter((i) => i % tickStep === 0 || i === points.length - 1);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(
        d3
          .axisBottom(xScale)
          .tickValues(xTicks)
          .tickSize(3)
          .tickFormat((i) => points[Number(i)]?.yearMonth ?? '')
      )
      .call((s) => s.select('.domain').attr('stroke', VALORIA_PALETTE.gridZinc))
      .call((s) => s.selectAll('line').attr('stroke', VALORIA_PALETTE.gridZinc))
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '9.5px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    g.append('g')
      .call(
        d3
          .axisLeft(yScale)
          .ticks(4)
          .tickSize(0)
          .tickPadding(6)
          .tickFormat((v) => `${Math.round(Number(v))}%`)
      )
      .call((s) => s.select('.domain').remove())
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '9.5px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );
  }, [points, ddSvgWidth]);

  // D3 Chart 3: Official Sovereign Yield Curve (Banque du Canada in Emerald vs US Treasury in Crisp White/Zinc)
  useEffect(() => {
    const svgEl = yieldSvgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const height = 210;
    const margin = { top: 20, right: 24, bottom: 26, left: 46 };
    const innerW = Math.max(180, yieldSvgWidth - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${yieldSvgWidth} ${height}`);
    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const boc = yieldDiagnostics.canadaBoC;
    const ust = yieldDiagnostics.usTreasury;
    const tenors = boc.map((d) => d.tenor);

    const xScale = d3
      .scalePoint<string>()
      .domain(tenors)
      .range([8, innerW - 8]);

    const yScale = d3.scaleLinear().domain([2.4, 6.0]).range([innerH, 0]);

    g.append('g')
      .selectAll('line')
      .data([3, 4, 5, 6])
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', VALORIA_PALETTE.gridZinc)
      .attr('stroke-dasharray', '3 3');

    const paired = boc.map((c, idx) => ({
      tenor: c.tenor,
      ca: c.yieldPct,
      us: ust[idx]?.yieldPct ?? c.yieldPct,
    }));

    const spreadArea = d3
      .area<(typeof paired)[number]>()
      .x((d) => xScale(d.tenor) ?? 0)
      .y0((d) => yScale(d.ca))
      .y1((d) => yScale(d.us))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(paired)
      .attr('fill', VALORIA_PALETTE.textZinc)
      .attr('fill-opacity', 0.1)
      .attr('d', spreadArea);

    // US Treasury Curve (Crisp Zinc White)
    const usLine = d3
      .line<(typeof paired)[number]>()
      .x((d) => xScale(d.tenor) ?? 0)
      .y((d) => yScale(d.us))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(paired)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.lineZinc)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4 3')
      .attr('d', usLine);

    // Bank of Canada GoC Curve (Emerald)
    const caLine = d3
      .line<(typeof paired)[number]>()
      .x((d) => xScale(d.tenor) ?? 0)
      .y((d) => yScale(d.ca))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(paired)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.emerald)
      .attr('stroke-width', 2.3)
      .attr('d', caLine);

    paired.forEach((p) => {
      const cx = xScale(p.tenor) ?? 0;
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', yScale(p.us))
        .attr('r', 3.4)
        .attr('fill', VALORIA_PALETTE.lineZinc);
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', yScale(p.ca))
        .attr('r', 3.6)
        .attr('fill', VALORIA_PALETTE.emerald);

      if (p.tenor === '2A' || p.tenor === '10A' || p.tenor === '30A') {
        g.append('text')
          .attr('x', cx)
          .attr('y', yScale(p.us) - 7)
          .attr('text-anchor', 'middle')
          .attr('fill', VALORIA_PALETTE.lineZinc)
          .attr('font-size', '9px')
          .attr('font-family', 'JetBrains Mono, monospace')
          // NOMBRE-NON-MONETAIRE : taux obligataire souverain US
          .text(`${p.us.toFixed(2)}%`);

        g.append('text')
          .attr('x', cx)
          .attr('y', yScale(p.ca) + 13)
          .attr('text-anchor', 'middle')
          .attr('fill', VALORIA_PALETTE.emeraldLight)
          .attr('font-size', '9px')
          .attr('font-family', 'JetBrains Mono, monospace')
          // NOMBRE-NON-MONETAIRE : taux obligataire souverain Canada
          .text(`${p.ca.toFixed(2)}%`);
      }
    });

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).tickSize(3))
      .call((s) => s.select('.domain').attr('stroke', VALORIA_PALETTE.gridZinc))
      .call((s) => s.selectAll('line').attr('stroke', VALORIA_PALETTE.gridZinc))
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '10px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    g.append('g')
      .call(
        d3
          .axisLeft(yScale)
          .ticks(4)
          .tickSize(0)
          .tickPadding(6)
          // NOMBRE-NON-MONETAIRE : graduation axe des taux souverains
          .tickFormat((v) => `${Number(v).toFixed(1)}%`)
      )
      .call((s) => s.select('.domain').remove())
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '9.5px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );
  }, [yieldDiagnostics, yieldSvgWidth]);

  return (
    <ScrollReveal>
      <section
        data-testid="d3-deep-curve-lab"
        className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-5"
      >
        {/* Top Toolbar */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-3.5 border-b border-bordure">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-texte">
              Analyse des Courbes, Baisses &amp; Taux Directeurs ($ CAD)
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-texte-doux">
              <span>Couloir de tendance ±2σ</span>
              <span aria-hidden="true">·</span>
              <span>Bandes de Bollinger</span>
              <span aria-hidden="true">·</span>
              <span>Pires baisses historiques</span>
              <span aria-hidden="true">·</span>
              <span>Taux Banque du Canada vs US</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label htmlFor="deep-curve-subject" className="sr-only">
              Courbe analysée
            </label>
            <select
              id="deep-curve-subject"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setHoveredIdx(null);
              }}
              className="min-h-11 px-2.5 py-1.5 text-xs font-mono bg-surface border border-bordure rounded-xl text-texte outline-hidden focus-ring focus:border-bordure-champ max-w-[235px]"
            >
              <optgroup label="Portefeuilles ($ CAD)">
                <option value="PORTFOLIO_BEFORE">Portefeuille Actuel ($ CAD)</option>
                {afterLots.length > 0 && (
                  <option value="PORTFOLIO_AFTER">Portefeuille Optimisé ($ CAD)</option>
                )}
              </optgroup>
              <optgroup label="Détenus & Suivis">
                {subjectOptions.priorityAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ticker} · {a.name.split(' (')[0]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Marché Mondial">
                {subjectOptions.restAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ticker} · {a.name.split(' (')[0]}
                  </option>
                ))}
              </optgroup>
            </select>

            <div className="inline-flex items-center gap-1 p-0.5 bg-surface border border-bordure rounded-xl">
              {HORIZONS.map((h) => (
                <button aria-pressed={Boolean(horizonYears === h.years)}
                  key={h.years}
                  type="button"
                  onClick={() => {
                    setHorizonYears(h.years);
                    setHoveredIdx(null);
                  }}
                  className={`min-h-11 min-w-11 px-2.5 py-1 text-xs font-mono rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    horizonYears === h.years
                      ? 'bg-accent text-sur-accent font-bold'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>

            <div className="inline-flex items-center gap-1 p-0.5 bg-surface border border-bordure rounded-xl">
              <button aria-pressed={Boolean(envelopeMode === 'ols_channel')}
                type="button"
                onClick={() => setEnvelopeMode('ols_channel')}
                className={`min-h-11 min-w-11 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  envelopeMode === 'ols_channel'
                    ? 'bg-accent text-sur-accent font-semibold'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                Canal ±2σ
              </button>
              <button aria-pressed={Boolean(envelopeMode === 'bollinger')}
                type="button"
                onClick={() => setEnvelopeMode('bollinger')}
                className={`min-h-11 min-w-11 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  envelopeMode === 'bollinger'
                    ? 'bg-accent text-sur-accent font-semibold'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                Bollinger 20
              </button>
            </div>
          </div>
        </div>

        {/* 6-Metric Quantitative Diagnostics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono tabular-nums text-xs">
          <div className="p-3 bg-surface/60 border border-bordure rounded-xl">
            <span className="block font-sans text-[11px] text-texte-doux">
              Gain Annuel ({horizonYears}A)
            </span>
            <span
              className={`text-sm font-bold ${
                curveAnalysis.cagrPct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
              }`}
            >
              {formatSignedPct(curveAnalysis.cagrPct, 1)}/an
            </span>
            <span className="block text-[10px] text-texte-doux">
              vs marché {formatSignedPct(curveAnalysis.alphaCagrPct, 1)}/an
            </span>
          </div>

          <div className="p-3 bg-surface/60 border border-bordure rounded-xl">
            <span className="block font-sans text-[11px] text-texte-doux">
              Régularité Courbe
            </span>
            <span className="text-sm font-bold text-texte">
              {/* NOMBRE-NON-MONETAIRE : coefficient statistique R2 de courbe */}
              R² {(curveAnalysis.trendLinearityR2 * 100).toFixed(0)} %
            </span>
            <span className="block text-[10px] text-texte-doux">
              Pente {formatSignedPct(curveAnalysis.secularTrendCagrPct, 1)}/an
            </span>
          </div>

          <div className="p-3 bg-surface/60 border border-bordure rounded-xl">
            <span className="block font-sans text-[11px] text-texte-doux">
              Position dans le Couloir
            </span>
            <span
              className={`text-sm font-bold ${
                curveAnalysis.currentChannelZScore <= -1.2
                  ? 'text-succes-texte'
                  : curveAnalysis.currentChannelZScore >= 1.5
                    ? 'text-erreur-texte'
                    : 'text-texte'
              }`}
            >
              {curveAnalysis.currentChannelZScore >= 0 ? '+' : ''}
              {curveAnalysis.currentChannelZScore.toFixed(2)}σ
            </span>
            <span className="block text-[10px] text-texte-doux">
              Larg. {formatPct(curveAnalysis.bollingerBandwidthNowPct, 1)}
            </span>
          </div>

          <div className="p-3 bg-surface/60 border border-bordure rounded-xl">
            <span className="block font-sans text-[11px] text-texte-doux">
              Pire Baisse Subie
            </span>
            <span className="text-sm font-bold text-erreur-texte">
              {formatSignedPct(curveAnalysis.maxDrawdownPct, 1)}
            </span>
            <span className="block text-[10px] text-texte-doux">
              {/* NOMBRE-NON-MONETAIRE : durée statistique historique d'actif */}
              {curveAnalysis.maxTimeUnderWaterMonths} mois pour remonter
            </span>
          </div>

          <div className="p-3 bg-surface/60 border border-bordure rounded-xl">
            <span className="block font-sans text-[11px] text-texte-doux">
              Gain / Stress (Calmar)
            </span>
            <span
              className={`text-sm font-bold ${
                curveAnalysis.calmarRatio >= 0.8 ? 'text-succes-texte' : 'text-texte'
              }`}
            >
              {curveAnalysis.calmarRatio.toFixed(2)} · {curveAnalysis.martinRatio.toFixed(2)}
            </span>
            <span className="block text-[10px] text-texte-doux">
              Écart sommet {formatSignedPct(curveAnalysis.currentDrawdownPct, 1)}
            </span>
          </div>

          <div className="p-3 bg-surface/60 border border-bordure rounded-xl">
            <span className="block font-sans text-[11px] text-texte-doux">
              Mémoire Tendance (Hurst)
            </span>
            <span className="text-sm font-bold text-texte">
              H = {curveAnalysis.hurstExponent.toFixed(2)}
            </span>
            <span className="block text-[10px] text-texte-doux truncate">
              {curveAnalysis.hurstRegimeLabel}
            </span>
          </div>
        </div>

        {/* Panel 1: Full-Width Structural Envelope */}
        <div className="bg-surface/55 border border-bordure rounded-xl p-4 space-y-3">
          {activePt && (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-bordure text-xs font-mono tabular-nums">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-texte">{curveAnalysis.subjectLabel}</strong>
                <span className="text-texte-doux">({activePt.label})</span>
                <span
                  className={`font-bold ${
                    curveAnalysis.totalReturnPct >= 0
                      ? 'text-succes-texte'
                      : 'text-erreur-texte'
                  }`}
                >
                  {formatEur(activePt.priceCad, valDecimals)}
                </span>
                {!isPortfolioSubject && onInspectAsset && (
                  <button
                    type="button"
                    onClick={() => onInspectAsset(curveAnalysis.subjectId)}
                    className="min-h-11 text-[11px] text-texte hover:underline cursor-pointer ml-1"
                  >
                    MM 50/200 · RSI · MACD →
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-texte">
                <span>
                  Tendance {formatEur(activePt.regMidCad, valDecimals)}
                </span>
                <span className="text-texte-doux">·</span>
                <span>
                  Vitesse{' '}
                  <strong
                    className={
                      activePt.velocityPctPerMonth >= 0
                        ? 'text-succes-texte'
                        : 'text-erreur-texte'
                    }
                  >
                    {formatSignedPct(activePt.velocityPctPerMonth, 1)}/m
                  </strong>
                </span>
                <span className="text-texte-doux">·</span>
                <span className="text-texte">{curveAnalysis.kinematicPhase}</span>
              </div>
            </div>
          )}

          <div ref={priceWrapRef} className="w-full overflow-hidden">
            <svg
              ref={priceSvgRef}
              data-testid="d3-deep-curve-envelope-svg"
              role="img"
              aria-label={`Décomposition structurelle D3 de la courbe ${curveAnalysis.subjectLabel}`}
              className="w-full block select-none"
            />
          </div>
        </div>

        {/* Bottom 2-Column Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-6 bg-surface/55 border border-bordure rounded-xl p-4 flex flex-col justify-between space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-bordure">
              <h3 className="text-xs font-semibold text-texte">
                Creux Historiques sous le Sommet (0 % → Pire Baisse)
              </h3>
              <span className="font-mono tabular-nums text-[11px] text-texte-doux">
                Volatilité {formatPct(curveAnalysis.annualizedVolPct, 1)}
              </span>
            </div>

            <div ref={ddWrapRef} className="w-full overflow-hidden">
              <svg
                ref={ddSvgRef}
                data-testid="d3-underwater-drawdown-svg"
                role="img"
                aria-label="Courbe sous-marine des drawdowns en pourcentage"
                className="w-full block select-none"
              />
            </div>

            <div className="pt-1.5 border-t border-bordure flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-texte-doux">
              <span>
                Pire creux : <strong className="text-erreur-texte">{formatSignedPct(curveAnalysis.maxDrawdownPct, 1)}</strong>
              </span>
              <span>
                Aujourd’hui : <strong className="text-texte">{formatSignedPct(curveAnalysis.currentDrawdownPct, 1)}</strong>
              </span>
            </div>
          </div>

          <div className="lg:col-span-6 bg-surface/55 border border-bordure rounded-xl p-4 flex flex-col justify-between space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-bordure">
              <h3 className="text-xs font-semibold text-texte">
                Courbe des Taux : Banque du Canada vs États-Unis
              </h3>
              <div className="flex items-center gap-2 font-mono tabular-nums text-[11px]">
                {/* NOMBRE-NON-MONETAIRE : taux souverains Canada / US */}
                <span className="text-succes-texte">Canada 10A {yieldDiagnostics.boc10yPct.toFixed(2)}%</span>
                <span className="text-texte-doux">·</span>
                {/* NOMBRE-NON-MONETAIRE : taux souverain US */}
                <span className="text-texte">US 10A {yieldDiagnostics.ust10yPct.toFixed(2)}%</span>
              </div>
            </div>

            <div ref={yieldWrapRef} className="w-full overflow-hidden">
              <svg
                ref={yieldSvgRef}
                data-testid="d3-sovereign-yield-curve-svg"
                role="img"
                aria-label="Courbe des rendements obligataires Banque du Canada vs Trésor américain"
                className="w-full block select-none"
              />
            </div>

            <div className="pt-1.5 border-t border-bordure flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-texte-doux">
              <span>
                Pente 10A−2A : CA{' '}
                <strong className="text-succes-texte">
                  +{yieldDiagnostics.bocSpread10y2yBps} pb
                </strong>{' '}
                · US{' '}
                <strong className="text-texte">
                  +{yieldDiagnostics.ustSpread10y2yBps} pb
                </strong>
              </span>
              <span>
                {/* NOMBRE-NON-MONETAIRE : taux réel macroéconomique US */}
                Taux réel US : <strong className="text-texte">+{yieldDiagnostics.realYieldUs10yPct.toFixed(2)}%</strong>
              </span>
            </div>
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
};

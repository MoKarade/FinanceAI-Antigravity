import React, { useId, useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import {
  buildAsset30DaySparklineSeries,
  type Sparkline30dPoint,
} from '../../services/valoria/sparkline30d';
import { formatPriceCad, formatSignedPct } from '../../services/valoria/valoriaFormatters';

interface D3PriceSparkline30dProps {
  assetId: string;
  spotPriceCad?: number;
  customDailyHistoryCad?: { date: string; valueCad: number }[];
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Ultra-lightweight D3 30-day price trend sparkline ($ CAD).
 * Uses d3.scaleLinear, d3.line, d3.area, and d3.pointer with zero text clutter:
 * - Subtle dashed day-0 baseline to show 30-day gain/loss territory immediately
 * - Smooth emerald/rose D3 curve + soft gradient area + terminal day-30 anchor dot
 * - Optional pointer scrub dot with native SVG <title> readout (no floating DOM popups)
 */
export const D3PriceSparkline30d: React.FC<D3PriceSparkline30dProps> = ({
  assetId,
  spotPriceCad,
  customDailyHistoryCad,
  width = 68,
  height = 24,
  className = '',
}) => {
  const gradId = useId().replace(/:/g, '');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const series = useMemo(
    () =>
      buildAsset30DaySparklineSeries(
        assetId,
        spotPriceCad,
        customDailyHistoryCad
      ),
    [assetId, spotPriceCad, customDailyHistoryCad]
  );

  const geometry = useMemo(() => {
    const pts = series.points;
    if (pts.length < 2) return null;

    const padX = 2.5;
    const padY = 3;

    const xScale = d3
      .scaleLinear()
      .domain([0, pts.length - 1])
      .range([padX, width - padX]);

    const extent = d3.extent(pts, (d) => d.closeCad) as [number, number];
    const minV = extent[0] ?? series.minPriceCad;
    const maxV = extent[1] ?? series.maxPriceCad;
    const span = maxV - minV;
    const safeMin = span < 1e-5 ? minV - 1 : minV - span * 0.06;
    const safeMax = span < 1e-5 ? maxV + 1 : maxV + span * 0.06;

    const yScale = d3
      .scaleLinear()
      .domain([safeMin, safeMax])
      .range([height - padY, padY]);

    const lineGen = d3
      .line<Sparkline30dPoint>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d.closeCad))
      .curve(d3.curveMonotoneX);

    const areaGen = d3
      .area<Sparkline30dPoint>()
      .x((_, i) => xScale(i))
      .y0(height - 1)
      .y1((d) => yScale(d.closeCad))
      .curve(d3.curveMonotoneX);

    const linePath = lineGen(pts) ?? '';
    const areaPath = areaGen(pts) ?? '';
    const baselineY = yScale(series.startPriceCad);
    const lastIdx = pts.length - 1;

    return {
      pts,
      xScale,
      yScale,
      linePath,
      areaPath,
      baselineY,
      endX: xScale(lastIdx),
      endY: yScale(pts[lastIdx].closeCad),
    };
  }, [series, width, height]);

  if (!geometry) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className={`shrink-0 ${className}`}
      >
        <rect width={width} height={height} rx="4" className="fill-surface" />
      </svg>
    );
  }

  const strokeColor = series.isPositive30d ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose;
  const activePoint =
    hoverIdx !== null && geometry.pts[hoverIdx]
      ? geometry.pts[hoverIdx]
      : geometry.pts[geometry.pts.length - 1];
  const activeX =
    hoverIdx !== null
      ? geometry.xScale(hoverIdx)
      : geometry.endX;
  const activeY =
    hoverIdx !== null && geometry.pts[hoverIdx]
      ? geometry.yScale(geometry.pts[hoverIdx].closeCad)
      : geometry.endY;

  const titleSummary = `${series.ticker} · 30j ${formatSignedPct(
    series.change30dPct,
    1
  )} · ${activePoint.labelShort} : ${formatPriceCad(activePoint.closeCad)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-testid="d3-sparkline-30d"
      data-asset-id={assetId}
      data-trend-30d={series.isPositive30d ? 'up' : 'down'}
      role="img"
      aria-label={`Tendance 30 jours ${series.ticker} : ${formatSignedPct(
        series.change30dPct,
        1
      )}`}
      className={`overflow-visible shrink-0 select-none ${className}`}
      onPointerMove={(e) => {
        const [mx] = d3.pointer(e);
        const rawIdx = Math.round(geometry.xScale.invert(mx));
        const clamped = Math.max(
          0,
          Math.min(geometry.pts.length - 1, rawIdx)
        );
        setHoverIdx(clamped);
      }}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <title>{titleSummary}</title>
      <defs>
        <linearGradient id={`d3-spk30-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Subtle 30-day starting price reference line */}
      <line
        x1={2}
        x2={width - 2}
        y1={geometry.baselineY}
        y2={geometry.baselineY}
        stroke={VALORIA_PALETTE.axisZinc}
        strokeOpacity="0.65"
        strokeWidth="0.75"
        strokeDasharray="2 2"
      />

      {/* D3 soft area fill */}
      <path d={geometry.areaPath} fill={`url(#d3-spk30-${gradId})`} />

      {/* D3 smooth 30-day price curve */}
      <path
        d={geometry.linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className="animate-curve-draw"
      />

      {/* Hover hairline when scrubbing */}
      {hoverIdx !== null && (
        <line
          x1={activeX}
          x2={activeX}
          y1={2}
          y2={height - 2}
          stroke={VALORIA_PALETTE.textZinc}
          strokeOpacity="0.45"
          strokeWidth="0.8"
        />
      )}

      {/* Terminal or scrubbed price dot */}
      <circle
        cx={activeX}
        cy={activeY}
        r={hoverIdx !== null ? 2.5 : 2}
        fill={strokeColor}
      />
    </svg>
  );
};

import React, { useId, useMemo } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';

interface MiniSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  positive?: boolean;
}

export const MiniSparkline: React.FC<MiniSparklineProps> = ({
  values,
  width = 88,
  height = 28,
  positive,
}) => {
  const gradId = useId().replace(/:/g, '');

  const geometry = useMemo(() => {
    if (!values || values.length < 2) return null;
    const padX = 2;
    const padY = 3;

    const xScale = d3
      .scaleLinear()
      .domain([0, values.length - 1])
      .range([padX, width - padX]);

    const [rawMin = 0, rawMax = 1] = d3.extent(values);
    const span = rawMax - rawMin;
    const yScale = d3
      .scaleLinear()
      .domain([span < 1e-6 ? rawMin - 1 : rawMin, span < 1e-6 ? rawMax + 1 : rawMax])
      .range([height - padY, padY]);

    const lineGen = d3
      .line<number>()
      .x((_, i) => xScale(i))
      .y((v) => yScale(v))
      .curve(d3.curveMonotoneX);

    const areaGen = d3
      .area<number>()
      .x((_, i) => xScale(i))
      .y0(height)
      .y1((v) => yScale(v))
      .curve(d3.curveMonotoneX);

    const lastIdx = values.length - 1;
    return {
      linePath: lineGen(values) ?? '',
      areaPath: areaGen(values) ?? '',
      endX: xScale(lastIdx),
      endY: yScale(values[lastIdx]),
      isUp: positive !== undefined ? positive : values[lastIdx] >= values[0],
    };
  }, [values, width, height, positive]);

  if (!geometry) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width={width} height={height} rx="4" className="fill-surface" />
      </svg>
    );
  }

  const stroke = geometry.isUp ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible shrink-0"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spk-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.24" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={geometry.areaPath} fill={`url(#spk-${gradId})`} />
      <path
        d={geometry.linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className="animate-curve-draw"
      />
      <circle cx={geometry.endX} cy={geometry.endY} r="2.2" fill={stroke} />
    </svg>
  );
};

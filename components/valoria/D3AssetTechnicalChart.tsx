import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { motion } from 'framer-motion';
import {
  buildAssetTechnicalAnalysis,
  sliceTechnicalBarsByTimeframe,
  type TechnicalTimeframe,
} from '../../services/valoria/dailyTechnicalIndicators';
import { formatPriceCad } from '../../services/valoria/valoriaFormatters';
import { AnimatedMeterBar } from './MotionPrimitives';

interface D3AssetTechnicalChartProps {
  assetId: string;
  ticker: string;
  spotPriceCad: number;
}

const TIMEFRAMES: { id: TechnicalTimeframe; label: string; desc: string }[] = [
  { id: '6M', label: '6 Mois', desc: '126 séances' },
  { id: '1A', label: '1 An', desc: '252 séances' },
  { id: '2A', label: '2 Ans', desc: '504 séances' },
];

export const D3AssetTechnicalChart: React.FC<D3AssetTechnicalChartProps> = ({
  assetId,
  ticker,
  spotPriceCad,
}) => {
  const [timeframe, setTimeframe] = useState<TechnicalTimeframe>('1A');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const fullTech = useMemo(
    () => buildAssetTechnicalAnalysis(assetId, spotPriceCad),
    [assetId, spotPriceCad]
  );

  const { bars, crosses } = useMemo(
    () => sliceTechnicalBarsByTimeframe(fullTech, timeframe),
    [fullTech, timeframe]
  );

  const width = 880;
  const margin = { left: 60, right: 20 };
  const plotW = width - margin.left - margin.right;

  // 3 synchronized D3 vertical panes:
  // Pane 1: Price ($ CAD) + MM 50j + MM 200j  [y: 18 .. 232]
  // Pane 2: RSI (14j)                         [y: 266 .. 358]
  // Pane 3: MACD (12, 26, 9)                  [y: 392 .. 486]
  const pane1 = { top: 18, bottom: 232 };
  const pane2 = { top: 268, bottom: 360 };
  const pane3 = { top: 396, bottom: 488 };
  const totalHeight = 516;

  const chartData = useMemo(() => {
    const n = Math.max(2, bars.length);
    const xScale = d3
      .scaleLinear()
      .domain([0, n - 1])
      .range([margin.left, width - margin.right]);

    // Pane 1 Y domain (includes price, SMA50, and SMA200 so moving averages never clip!)
    const allPriceVals: number[] = [];
    for (const b of bars) {
      allPriceVals.push(b.closeCad);
      if (b.sma50 !== null) allPriceVals.push(b.sma50);
      if (b.sma200 !== null) allPriceVals.push(b.sma200);
    }
    const pMin = d3.min(allPriceVals) ?? spotPriceCad * 0.85;
    const pMax = d3.max(allPriceVals) ?? spotPriceCad * 1.15;
    const pPad = Math.max(0.01, (pMax - pMin) * 0.08);
    const yPrice = d3
      .scaleLinear()
      .domain([Math.max(0.001, pMin - pPad), pMax + pPad])
      .range([pane1.bottom, pane1.top]);

    // Pane 2 Y domain: RSI [0..100]
    const yRsi = d3.scaleLinear().domain([0, 100]).range([pane2.bottom, pane2.top]);

    // Pane 3 Y domain: symmetric around 0 so zero-line stays clean
    const macdVals: number[] = [];
    for (const b of bars) {
      if (b.macdLine !== null) macdVals.push(Math.abs(b.macdLine));
      if (b.signalLine !== null) macdVals.push(Math.abs(b.signalLine));
      if (b.histogram !== null) macdVals.push(Math.abs(b.histogram) * 1.25);
    }
    const maxAbsMacd = Math.max(0.05, (d3.max(macdVals) ?? 1) * 1.12);
    const yMacd = d3
      .scaleLinear()
      .domain([-maxAbsMacd, maxAbsMacd])
      .range([pane3.bottom, pane3.top]);

    // Crisp daily financial paths via D3 (linear daily vertices avoid Skia cubic dash-tessellation overhead)
    const priceLineGen = d3
      .line<(typeof bars)[number]>()
      .x((_, i) => xScale(i))
      .y((d) => yPrice(d.closeCad));

    const priceAreaGen = d3
      .area<(typeof bars)[number]>()
      .x((_, i) => xScale(i))
      .y0(pane1.bottom)
      .y1((d) => yPrice(d.closeCad));

    const sma50LineGen = d3
      .line<(typeof bars)[number]>()
      .defined((d) => d.sma50 !== null)
      .x((_, i) => xScale(i))
      .y((d) => yPrice(d.sma50!));

    const sma200LineGen = d3
      .line<(typeof bars)[number]>()
      .defined((d) => d.sma200 !== null)
      .x((_, i) => xScale(i))
      .y((d) => yPrice(d.sma200!));

    const rsiLineGen = d3
      .line<(typeof bars)[number]>()
      .defined((d) => d.rsi14 !== null)
      .x((_, i) => xScale(i))
      .y((d) => yRsi(d.rsi14!));

    const macdLineGen = d3
      .line<(typeof bars)[number]>()
      .defined((d) => d.macdLine !== null)
      .x((_, i) => xScale(i))
      .y((d) => yMacd(d.macdLine!));

    const signalLineGen = d3
      .line<(typeof bars)[number]>()
      .defined((d) => d.signalLine !== null)
      .x((_, i) => xScale(i))
      .y((d) => yMacd(d.signalLine!));

    const startPrice = bars[0]?.closeCad ?? spotPriceCad;
    const endPrice = bars[bars.length - 1]?.closeCad ?? spotPriceCad;
    const periodReturnPct =
      startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;

    // Sample 6 X-axis ticks cleanly
    const xTickIndices = [
      0,
      Math.round((n - 1) * 0.2),
      Math.round((n - 1) * 0.4),
      Math.round((n - 1) * 0.6),
      Math.round((n - 1) * 0.8),
      n - 1,
    ];

    return {
      xScale,
      yPrice,
      yRsi,
      yMacd,
      pricePath: priceLineGen(bars) ?? '',
      priceArea: priceAreaGen(bars) ?? '',
      sma50Path: sma50LineGen(bars) ?? '',
      sma200Path: sma200LineGen(bars) ?? '',
      rsiPath: rsiLineGen(bars) ?? '',
      macdPath: macdLineGen(bars) ?? '',
      signalPath: signalLineGen(bars) ?? '',
      priceTicks: yPrice.ticks(4),
      periodReturnPct,
      isPeriodPositive: periodReturnPct >= 0,
      barWidth: Math.max(1.2, Math.min(4.2, (plotW / n) * 0.72)),
      xTickIndices,
    };
  }, [bars, spotPriceCad, plotW, margin.left, margin.right, pane1.bottom, pane1.top, pane2.bottom, pane2.top, pane3.bottom, pane3.top]);

  const activeIdx =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < bars.length
      ? hoverIndex
      : bars.length - 1;
  const activeBar = bars[activeIdx] ?? bars[bars.length - 1];

  const handlePointerMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const rawIdx = Math.round(chartData.xScale.invert(relX));
    const clamped = Math.max(0, Math.min(bars.length - 1, rawIdx));
    setHoverIndex(clamped);
  };

  const priceStroke = chartData.isPeriodPositive ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose;
  const badges = [
    fullTech.beginnerBadges.movingAverages,
    fullTech.beginnerBadges.rsi,
    fullTech.beginnerBadges.macd,
  ];

  return (
    <div
      data-testid="d3-asset-technical-chart"
      className="rounded-2xl border border-bordure bg-fond/90 p-4 sm:p-5 space-y-4"
    >
      {/* Top Bar: Title + Plain-French Beginner Summary + 6M / 1A / 2A Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-texte-doux">
            <span className="font-mono text-texte">{ticker}</span>
            <span aria-hidden="true">·</span>
            <span>Analyse Technique Historique ($ CAD)</span>
            <span aria-hidden="true">·</span>
            <span
              className={`font-semibold ${
                fullTech.overallTone === 'positive'
                  ? 'text-succes-texte'
                  : fullTech.overallTone === 'negative'
                    ? 'text-erreur-texte'
                    : 'text-texte'
              }`}
            >
              {fullTech.overallTone === 'positive'
                ? '▲'
                : fullTech.overallTone === 'negative'
                  ? '▼'
                  : '●'}{' '}
              {/* NOMBRE-NON-MONETAIRE : score technique public sur 100 */}
              {fullTech.overallVerdictShort} ({fullTech.overallTechnicalScore}/100)
            </span>
          </div>
          <h4 className="text-base font-semibold text-texte mt-0.5">
            Tendances MM 50/200 jours · RSI-14 · MACD
          </h4>
        </div>

        {/* Interactive Timeframe Segmented Buttons */}
        <div
          role="group"
          aria-label="Horizon analyse technique"
          className="flex items-center gap-1 rounded-xl border border-bordure bg-surface p-1"
        >
          {TIMEFRAMES.map((tf) => {
            const active = timeframe === tf.id;
            return (
              <button
                key={tf.id}
                type="button"
                onClick={() => {
                  setTimeframe(tf.id);
                  setHoverIndex(null);
                }}
                className={`min-h-11 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-accent text-sur-accent'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                {tf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3 Beginner Visual Micro-Cards (Zero Jargon, Animated Progress Bars) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {badges.map((b, idx) => {
          const toneText =
            b.tone === 'positive'
              ? 'text-succes-texte'
              : b.tone === 'negative'
                ? 'text-erreur-texte'
                : 'text-texte';
          const prefix =
            b.tone === 'positive' ? '▲' : b.tone === 'negative' ? '▼' : '●';
          return (
            <motion.div
              key={b.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: idx * 0.05 }}
              className="rounded-xl border border-bordure bg-surface/60 p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-texte-doux font-medium">{b.title}</span>
                <span className="font-mono font-semibold text-texte tabular-nums">
                  {b.valueLabel}
                </span>
              </div>
              <AnimatedMeterBar pct={b.meterPct} tone={b.tone} heightClass="h-1.5" immediate />
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={`font-semibold ${toneText}`}>
                  {prefix} {b.plainVerdict}
                </span>
              </div>
              <p className="text-[11px] text-texte-doux leading-snug">{b.microHint}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Live Synchronized Readout Strip (Updates on Mouse Hover) */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5 border-y border-bordure py-2 text-xs tabular-nums">
        <div className="flex items-center gap-2">
          <span className="text-texte-doux">Séance :</span>
          <span className="font-mono font-semibold text-texte">
            {activeBar.labelShort}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span>
            <span className="text-texte-doux">Prix : </span>
            <span
              className={`font-mono font-semibold ${
                chartData.isPeriodPositive ? 'text-succes-texte' : 'text-erreur-texte'
              }`}
            >
              {formatPriceCad(activeBar.closeCad)}
            </span>
          </span>
          <span>
            <span className="text-texte">━ MM 50j : </span>
            <span className="font-mono font-semibold text-texte">
              {activeBar.sma50 !== null ? formatPriceCad(activeBar.sma50) : '—'}
            </span>
          </span>
          <span>
            <span className="text-texte-doux">╌ MM 200j : </span>
            <span className="font-mono text-texte">
              {activeBar.sma200 !== null ? formatPriceCad(activeBar.sma200) : '—'}
            </span>
          </span>
          <span>
            <span className="text-texte-doux">RSI-14 : </span>
            <span
              className={`font-mono font-semibold ${
                (activeBar.rsi14 ?? 50) <= 32
                  ? 'text-succes-texte'
                  : (activeBar.rsi14 ?? 50) >= 70
                    ? 'text-erreur-texte'
                    : 'text-texte'
              }`}
            >
              {activeBar.rsi14 !== null ? activeBar.rsi14.toFixed(1) : '—'}
            </span>
          </span>
          <span>
            <span className="text-texte-doux">MACD Hist : </span>
            <span
              className={`font-mono font-semibold ${
                (activeBar.histogram ?? 0) >= 0
                  ? 'text-succes-texte'
                  : 'text-erreur-texte'
              }`}
            >
              {activeBar.histogram !== null
                ? `${activeBar.histogram >= 0 ? '+' : ''}${activeBar.histogram.toFixed(2)}`
                : '—'}
            </span>
          </span>
        </div>
      </div>

      {/* Interactive 3-Pane D3 SVG */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${totalHeight}`}
          className="w-full h-auto select-none cursor-crosshair"
          role="img"
          aria-label={`Graphique analyse technique ${ticker} moyennes mobiles 50 et 200 jours, RSI et MACD`}
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient
              id={`tech-price-fill-${assetId}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={priceStroke}
                stopOpacity={0.22}
              />
              <stop
                offset="100%"
                stopColor={priceStroke}
                stopOpacity={0.0}
              />
            </linearGradient>
          </defs>

          {/* ==================== PANE 1: PRIX + MM 50j + MM 200j ==================== */}
          <text
            x={margin.left}
            y={pane1.top - 5}
            fill={VALORIA_PALETTE.textZinc}
            fontSize={10.5}
            fontWeight={600}
          >
            1 · PRIX ($ CAD) · MOYENNE RAPIDE 50J (BLANC) · MOYENNE LONGUE 200J (POINTILLÉ)
          </text>

          {chartData.priceTicks.map((tick) => {
            const y = chartData.yPrice(tick);
            return (
              <g key={`ptick-${tick}`}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={y}
                  y2={y}
                  stroke={VALORIA_PALETTE.gridZinc}
                  strokeDasharray="2 4"
                />
                <text
                  x={margin.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill={VALORIA_PALETTE.mutedZinc}
                  fontSize={10}
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {formatPriceCad(tick)}
                </text>
              </g>
            );
          })}

          {/* Area under price */}
          <path
            d={chartData.priceArea}
            fill={`url(#tech-price-fill-${assetId})`}
          />

          {/* MM 200j (sober zinc dashed) */}
          <path
            key={`sma200-${assetId}-${timeframe}`}
            d={chartData.sma200Path}
            fill="none"
            stroke={VALORIA_PALETTE.mutedZinc}
            strokeWidth={1.75}
            strokeDasharray="5 4"
          />

          {/* MM 50j (crisp pure white solid) */}
          <motion.path
            key={`sma50-${assetId}-${timeframe}`}
            d={chartData.sma50Path}
            fill="none"
            stroke={VALORIA_PALETTE.textBright}
            strokeWidth={1.85}
            strokeOpacity={0.92}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          />

          {/* Daily Price ($ CAD) in semantic Green or Red */}
          <motion.path
            key={`price-${assetId}-${timeframe}`}
            d={chartData.pricePath}
            fill="none"
            stroke={priceStroke}
            strokeWidth={2.25}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
          />

          {/* Golden Cross / Death Cross Visual Markers */}
          {crosses.map((c) => {
            const cx = chartData.xScale(c.barIndex);
            const cy = chartData.yPrice(c.sma200Cad);
            const isGolden = c.type === 'golden_cross';
            const pinColor = isGolden ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose;
            return (
              <g key={`${c.type}-${c.dateISO}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill={VALORIA_PALETTE.bgDeep}
                  stroke={pinColor}
                  strokeWidth={2.2}
                />
                <text
                  x={Math.min(width - margin.right - 56, Math.max(margin.left + 44, cx))}
                  y={isGolden ? Math.min(pane1.bottom - 6, cy + 16) : Math.max(pane1.top + 12, cy - 10)}
                  textAnchor="middle"
                  fill={pinColor}
                  fontSize={9.5}
                  fontWeight={700}
                >
                  {isGolden ? '▲ Croisement ↑' : '▼ Croisement ↓'}
                </text>
              </g>
            );
          })}

          {/* ==================== PANE 2: RSI-14 (SURCHAUFFE >70 / SURVENDU <30) ==================== */}
          <text
            x={margin.left}
            y={pane2.top - 7}
            fill={VALORIA_PALETTE.textZinc}
            fontSize={10.5}
            fontWeight={600}
          >
            2 · RSI-14 JOURS — ZONE VERTE (&lt;30 = AUBAINE SURVENDUE) · ZONE ROUGE (&gt;70 = SURCHAUFFE)
          </text>

          {/* Overbought Red Band (70..100) */}
          <rect
            x={margin.left}
            y={chartData.yRsi(100)}
            width={plotW}
            height={chartData.yRsi(70) - chartData.yRsi(100)}
            fill={VALORIA_PALETTE.rose}
            fillOpacity={0.09}
          />
          {/* Oversold Green Band (0..30) */}
          <rect
            x={margin.left}
            y={chartData.yRsi(30)}
            width={plotW}
            height={chartData.yRsi(0) - chartData.yRsi(30)}
            fill={VALORIA_PALETTE.emerald}
            fillOpacity={0.09}
          />

          {[30, 50, 70].map((lvl) => {
            const y = chartData.yRsi(lvl);
            const stroke =
              lvl === 70 ? VALORIA_PALETTE.rose : lvl === 30 ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.gridZinc;
            return (
              <g key={`rsi-lvl-${lvl}`}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={y}
                  y2={y}
                  stroke={stroke}
                  strokeOpacity={lvl === 50 ? 0.8 : 0.45}
                  strokeDasharray="3 3"
                />
                <text
                  x={margin.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill={lvl === 70 ? VALORIA_PALETTE.roseLight : lvl === 30 ? VALORIA_PALETTE.emeraldLight : VALORIA_PALETTE.mutedZinc}
                  fontSize={9.5}
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {lvl}
                </text>
              </g>
            );
          })}

          <motion.path
            key={`rsi-${assetId}-${timeframe}`}
            d={chartData.rsiPath}
            fill="none"
            stroke={VALORIA_PALETTE.lineZinc}
            strokeWidth={1.8}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          />

          {/* ==================== PANE 3: MACD (12, 26, 9) ==================== */}
          <text
            x={margin.left}
            y={pane3.top - 7}
            fill={VALORIA_PALETTE.textZinc}
            fontSize={10.5}
            fontWeight={600}
          >
            3 · MACD (12, 26, 9) — BARRES VERTES = ÉLAN ACHETEUR · BARRES ROUGES = ÉLAN VENDEUR
          </text>

          {/* Zero baseline */}
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={chartData.yMacd(0)}
            y2={chartData.yMacd(0)}
            stroke={VALORIA_PALETTE.axisZinc}
            strokeWidth={1}
          />
          <text
            x={margin.left - 8}
            y={chartData.yMacd(0) + 3.5}
            textAnchor="end"
            fill={VALORIA_PALETTE.mutedZinc}
            fontSize={9.5}
            fontFamily="IBM Plex Mono, monospace"
          >
            0
          </text>

          {/* Green / Red Momentum Histogram Bars */}
          {bars.map((b, i) => {
            if (b.histogram === null) return null;
            const x = chartData.xScale(i) - chartData.barWidth / 2;
            const y0 = chartData.yMacd(0);
            const yVal = chartData.yMacd(b.histogram);
            const barTop = Math.min(y0, yVal);
            const barH = Math.max(1, Math.abs(yVal - y0));
            const isPos = b.histogram >= 0;
            return (
              <rect
                key={`hist-${i}`}
                x={x}
                y={barTop}
                width={chartData.barWidth}
                height={barH}
                fill={isPos ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose}
                fillOpacity={i === activeIdx ? 0.95 : 0.62}
              />
            );
          })}

          {/* Signal Line (sober zinc dashed) */}
          <path
            d={chartData.signalPath}
            fill="none"
            stroke={VALORIA_PALETTE.textZinc}
            strokeWidth={1.4}
            strokeDasharray="3 3"
          />

          {/* MACD Line (crisp white solid) */}
          <motion.path
            key={`macd-${assetId}-${timeframe}`}
            d={chartData.macdPath}
            fill="none"
            stroke={VALORIA_PALETTE.textWhiteSoft}
            strokeWidth={1.75}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          />

          {/* ==================== SYNCHRONIZED HOVER CROSSHAIR ==================== */}
          {activeBar && (
            <g pointerEvents="none">
              <line
                x1={chartData.xScale(activeIdx)}
                x2={chartData.xScale(activeIdx)}
                y1={pane1.top}
                y2={pane3.bottom}
                stroke={VALORIA_PALETTE.strokeZinc}
                strokeDasharray="3 3"
              />
              <circle
                cx={chartData.xScale(activeIdx)}
                cy={chartData.yPrice(activeBar.closeCad)}
                r={4.2}
                fill={priceStroke}
                stroke={VALORIA_PALETTE.bgDeep}
                strokeWidth={1.8}
              />
              {activeBar.rsi14 !== null && (
                <circle
                  cx={chartData.xScale(activeIdx)}
                  cy={chartData.yRsi(activeBar.rsi14)}
                  r={3.6}
                  fill={
                    activeBar.rsi14 <= 32
                      ? VALORIA_PALETTE.emerald
                      : activeBar.rsi14 >= 70
                        ? VALORIA_PALETTE.rose
                        : VALORIA_PALETTE.textWhiteSoft
                  }
                  stroke={VALORIA_PALETTE.bgDeep}
                  strokeWidth={1.5}
                />
              )}
              {activeBar.macdLine !== null && (
                <circle
                  cx={chartData.xScale(activeIdx)}
                  cy={chartData.yMacd(activeBar.macdLine)}
                  r={3.4}
                  fill={VALORIA_PALETTE.textWhiteSoft}
                  stroke={VALORIA_PALETTE.bgDeep}
                  strokeWidth={1.5}
                />
              )}
            </g>
          )}

          {/* ==================== X-AXIS DATES ==================== */}
          {chartData.xTickIndices.map((idx, k) => {
            const b = bars[idx];
            if (!b) return null;
            return (
              <text
                key={`xt-${k}-${idx}`}
                x={chartData.xScale(idx)}
                y={totalHeight - 6}
                textAnchor={
                  k === 0
                    ? 'start'
                    : k === chartData.xTickIndices.length - 1
                      ? 'end'
                      : 'middle'
                }
                fill={VALORIA_PALETTE.mutedZinc}
                fontSize={10}
                fontFamily="IBM Plex Mono, monospace"
              >
                {b.labelShort}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

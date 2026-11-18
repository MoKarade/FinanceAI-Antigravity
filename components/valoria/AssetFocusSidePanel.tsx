import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Minus,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type { PortfolioLot } from '../../services/valoria/engine';
import type { MonteCarlo10kYearPoint } from '../../services/valoria/monteCarlo10k';
import type { ProAnalystAdvisoryReport } from '../../services/valoria/proAnalystAdvisor';
import type { MultiAssetUniverseSummary } from '../../services/valoria/multiAssetQuantEngine';
import { buildFocusedAssetSnapshot } from '../../services/valoria/orbitalFocusEngine';
import { PriceTargetRangeBar } from './VisualPrimitives';
import { AnimatedNumber } from './MotionPrimitives';
import { PrivateAmount } from '../ui/PrivateAmount';
import {
  formatCompactEur,
  formatEur,
  formatPct,
  formatPriceEur,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface AssetFocusSidePanelProps {
  focusedAssetId: string | null;
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  availableCashCad: number;
  advisory: ProAnalystAdvisoryReport;
  universe: MultiAssetUniverseSummary;
  onClose: () => void;
  onExecuteOrder: (assetId: string, deltaCad: number) => void;
  onAdjustAvailableCash: (nextCashCad: number) => void;
}

const HORIZON_OPTIONS = [3, 5, 10, 15] as const;

export const AssetFocusSidePanel: React.FC<AssetFocusSidePanelProps> = ({
  focusedAssetId,
  lots,
  livePrices,
  availableCashCad,
  advisory,
  universe,
  onClose,
  onExecuteOrder,
  onAdjustAvailableCash,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [horizonYears, setHorizonYears] = useState<number>(10);
  const [mcSeed, setMcSeed] = useState<number>(20261113);
  const [hoveredYear, setHoveredYear] =
    useState<MonteCarlo10kYearPoint | null>(null);
  const fanSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setHoveredYear(null);
  }, [focusedAssetId, horizonYears, mcSeed]);

  useEffect(() => {
    if (!focusedAssetId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedAssetId, onClose]);

  const snapshot = useMemo(() => {
    if (!focusedAssetId) return null;
    return buildFocusedAssetSnapshot({
      assetId: focusedAssetId,
      lots,
      livePrices,
      availableCashCad,
      advisory,
      universe,
      horizonYears,
      seed: mcSeed,
    });
  }, [
    focusedAssetId,
    lots,
    livePrices,
    availableCashCad,
    advisory,
    universe,
    horizonYears,
    mcSeed,
  ]);

  // Render clean D3 Monte Carlo Fan Chart exclusively for the isolated asset
  useEffect(() => {
    const svgEl = fanSvgRef.current;
    if (!svgEl || !snapshot) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const data = snapshot.monteCarlo.yearlyQuantiles;
    if (data.length < 2) return;

    const width = 400;
    const height = 168;
    const margin = { top: 10, right: 14, bottom: 24, left: 50 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([data[0].calendarYear, data[data.length - 1].calendarYear])
      .range([0, innerW]);

    const yMax = Math.max(
      d3.max(data, (d) => d.p90) ?? 1000,
      snapshot.simulatedStakeCad * 1.25
    );

    const yScale = d3
      .scaleLinear()
      .domain([0, yMax * 1.06])
      .nice(4)
      .range([innerH, 0]);

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
      .attr('stroke-dasharray', (d) => (d === 0 ? '' : '2 3'));

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(4)
      .tickSize(0)
      .tickPadding(8)
      .tickFormat((v) => formatCompactEur(Number(v)));

    const yG = g.append('g').call(yAxis);
    yG.select('.domain').remove();
    yG.selectAll('text')
      .attr('fill', VALORIA_PALETTE.textZinc)
      .attr('font-family', 'var(--font-mono)')
      .attr('font-size', '9.5px');

    const xAxis = d3
      .axisBottom(xScale)
      .ticks(Math.min(5, data.length - 1))
      .tickSize(0)
      .tickPadding(8)
      .tickFormat((v) => String(Math.round(Number(v))));

    const xG = g
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis);
    xG.select('.domain').attr('stroke', VALORIA_PALETTE.axisZinc);
    xG.selectAll('text')
      .attr('fill', VALORIA_PALETTE.textZinc)
      .attr('font-family', 'var(--font-mono)')
      .attr('font-size', '9.5px');

    // Outer P10 - P90 Band
    const outerBand = d3
      .area<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y0((d) => yScale(Math.min(yScale.domain()[1], d.p10)))
      .y1((d) => yScale(Math.min(yScale.domain()[1], d.p90)))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('fill-opacity', 0.12)
      .attr('d', outerBand);

    // Inner P25 - P75 Band
    const innerBand = d3
      .area<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y0((d) => yScale(Math.min(yScale.domain()[1], d.p25)))
      .y1((d) => yScale(Math.min(yScale.domain()[1], d.p75)))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('fill-opacity', 0.2)
      .attr('d', innerBand);

    // 14 Representative Sample Stochastic Paths
    const sampleLine = d3
      .line<number>()
      .x((_, idx) => xScale(data[0].calendarYear + idx))
      .y((val) => yScale(Math.min(yScale.domain()[1], val)))
      .curve(d3.curveMonotoneX);

    g.append('g')
      .selectAll('path')
      .data(snapshot.monteCarlo.samplePaths.slice(0, 14))
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.emeraldLight)
      .attr('stroke-width', 0.8)
      .attr('stroke-opacity', 0.18)
      .attr('d', (arr) => sampleLine(arr));

    // Initial Capital Reference Line
    const baselineLine = d3
      .line<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y((d) => yScale(d.totalInvested))
      .curve(d3.curveLinear);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.mutedZinc)
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '3 3')
      .attr('d', baselineLine);

    // P10 Downside Decile Line
    const p10Line = d3
      .line<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y((d) => yScale(d.p10))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.roseLight)
      .attr('stroke-width', 1.3)
      .attr('stroke-dasharray', '3 2')
      .attr('d', p10Line);

    // P50 Median Trajectory
    const p50Line = d3
      .line<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y((d) => yScale(d.p50))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.emerald)
      .attr('stroke-width', 2.4)
      .attr('d', p50Line);

    // Hover Crosshair
    const focusG = g.append('g').style('display', 'none');
    const vLine = focusG
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.lineZinc)
      .attr('stroke-opacity', 0.35);
    const dot50 = focusG
      .append('circle')
      .attr('r', 4)
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('stroke', VALORIA_PALETTE.bgDeep)
      .attr('stroke-width', 1.5);

    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('pointerenter', () => focusG.style('display', null))
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event);
        const yr = Math.round(xScale.invert(mx));
        const pt =
          data.find((d) => d.calendarYear === yr) ?? data[data.length - 1];
        if (pt) {
          const cx = xScale(pt.calendarYear);
          vLine.attr('x1', cx).attr('x2', cx);
          dot50.attr('cx', cx).attr('cy', yScale(pt.p50));
          setHoveredYear(pt);
        }
      })
      .on('pointerleave', () => {
        focusG.style('display', 'none');
        setHoveredYear(null);
      });
  }, [snapshot]);

  const terminalPoint = snapshot
    ? snapshot.monteCarlo.yearlyQuantiles[
        snapshot.monteCarlo.yearlyQuantiles.length - 1
      ]
    : null;
  const activeMcPoint = hoveredYear ?? terminalPoint;

  return (
    <AnimatePresence>
      {snapshot && activeMcPoint && (
        <>
          {/* Click-away Dimming Scrim (attenuates the rest of the interface cleanly) */}
          <motion.div
            key="focus-mode-backdrop"
            data-testid="focus-mode-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.22 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-30 bg-fond/70 backdrop-blur-[1.5px]"
          />

          {/* Minimalist Side Panel: Strictly Monte Carlo Projections & Buy/Sell Signals */}
          <motion.aside
            key="asset-focus-side-panel"
            data-testid="asset-focus-side-panel"
            role="dialog"
            aria-modal="true"
            aria-label={`Mode Focus : ${snapshot.ticker} — Projections Monte Carlo et Signaux d'achat/vente`}
            initial={prefersReducedMotion ? { opacity: 0 } : { x: '100%', opacity: 0.6 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { x: '100%', opacity: 0 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 290, damping: 30 }
            }
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[450px] bg-surface/98 border-l border-bordure shadow-2xl flex flex-col overflow-y-auto"
          >
            {/* 1. Clean Isolated Asset Header */}
            <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-md px-5 py-3.5 border-b border-bordure flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-succes-texte font-medium">
                  <Crosshair className="w-3.5 h-3.5 shrink-0" />
                  <span>Mode Focus Actif</span>
                  <span aria-hidden="true" className="text-texte-doux">
                    ·
                  </span>
                  <span className="text-texte-doux truncate">
                    {snapshot.categoryLabel}
                  </span>
                </div>

                <div className="flex items-baseline gap-2.5">
                  <h2 className="text-xl font-bold tracking-tight text-texte font-mono">
                    {snapshot.ticker}
                  </h2>
                  <span className="text-sm text-texte truncate">
                    {snapshot.name}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs font-mono tabular-nums text-texte-doux">
                  {!snapshot.isCash && (
                    <>
                      <span className="text-texte font-semibold">
                        Spot {formatPriceEur(snapshot.spotPriceCad)}
                      </span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span>
                    {snapshot.isHeld ? (
                      <>
                        Détenu{' '}
                        <PrivateAmount>
                          <AnimatedNumber
                            value={snapshot.currentValueCad}
                            formatter={(n) => formatEur(n, 0)}
                            className="text-texte font-semibold"
                          />{' '}
                          ({snapshot.weightPct.toFixed(1)} %)
                        </PrivateAmount>
                      </>
                    ) : (
                      `Simulation sur ${formatEur(snapshot.simulatedStakeCad, 0)}`
                    )}
                  </span>
                  {snapshot.isHeld && !snapshot.isCash && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          snapshot.pnlPct >= 0
                            ? 'text-succes-texte'
                            : 'text-erreur-texte'
                        }
                      >
                        {formatSignedPct(snapshot.pnlPct, 1)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer le panneau Focus"
                className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-texte-doux hover:text-texte hover:bg-surface border border-bordure transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Panel Body: Strictly 2 Pure Analytical Sections */}
            <div className="px-5 py-4 space-y-4 flex-1">
              {/* ============================================================= */}
              {/* SECTION A: ISOLATED MONTE CARLO PROJECTIONS (10,000 PATHS)     */}
              {/* ============================================================= */}
              <section
                aria-label="Projections Monte Carlo de l'actif isolé"
                className="space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-texte">
                      Projections Monte Carlo (10 000 tirages)
                    </h3>
                    <p className="text-[11px] text-texte-doux font-mono tabular-nums">
                      Base {formatEur(snapshot.simulatedStakeCad, 0)} · Vol.{' '}
                      {formatPct(
                        snapshot.monteCarlo.historicalStats
                          .annualizedVolatilityPct,
                        1
                      )}
                      /an
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setMcSeed((s) => s + 7919)}
                    aria-label="Relancer la simulation Monte Carlo"
                    className="min-w-11 min-h-11 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-texte hover:text-texte bg-surface hover:bg-surface-douce border border-bordure rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Relancer</span>
                  </button>
                </div>

                {/* Horizon Segmented Buttons */}
                <div
                  role="group"
                  aria-label="Horizon de projection Monte Carlo"
                  className="grid grid-cols-4 gap-1 p-1 bg-fond border border-bordure rounded-lg"
                >
                  {HORIZON_OPTIONS.map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => setHorizonYears(yr)}
                      aria-pressed={horizonYears === yr}
                      className={`min-h-11 py-1 text-xs font-mono tabular-nums font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        horizonYears === yr
                          ? 'bg-surface-douce text-texte font-semibold'
                          : 'text-texte-doux hover:text-texte'
                      }`}
                    >
                      {/* NOMBRE-NON-MONETAIRE : bouton de sélecteur d'horizon temporel */}
                      {yr} ans
                    </button>
                  ))}
                </div>

                {/* D3 Stochastic Fan Chart */}
                <div className="p-2.5 bg-fond/90 border border-bordure rounded-xl space-y-1.5">
                  <svg
                    ref={fanSvgRef}
                    data-testid="focus-panel-montecarlo-svg"
                    viewBox="0 0 400 168"
                    role="img"
                    aria-label={`Cône Monte Carlo 10 000 scénarios pour ${snapshot.ticker}`}
                    className="w-full h-auto select-none"
                  />
                  <div className="flex items-center justify-between text-[11px] text-texte-doux font-mono tabular-nums pt-1 border-t border-bordure">
                    <span>Échéance {activeMcPoint.calendarYear}</span>
                    <span>
                      Probabilité de gain :{' '}
                      <strong className="text-succes-texte">
                        {formatPct(snapshot.monteCarlo.probabilityOfGainPct, 1)}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* P10 / P50 / P90 Tabular Outcomes */}
                <div className="grid grid-cols-3 gap-2.5 font-mono tabular-nums">
                  <div className="p-2.5 bg-surface/60 border border-bordure rounded-xl">
                    <div className="font-sans text-[11px] text-texte-doux">
                      P10 Prudent
                    </div>
                    <div
                      data-testid="focus-mc-p10"
                      className="text-sm font-semibold text-erreur-texte mt-0.5"
                    >
                      {formatEur(activeMcPoint.p10, 0)}
                    </div>
                  </div>

                  <div className="p-2.5 bg-surface/60 border border-bordure rounded-xl">
                    <div className="font-sans text-[11px] text-texte-doux">
                      P50 Médian
                    </div>
                    <div
                      data-testid="focus-mc-p50"
                      className="text-sm font-bold text-succes-texte mt-0.5"
                    >
                      {formatEur(activeMcPoint.p50, 0)}
                    </div>
                  </div>

                  <div className="p-2.5 bg-surface/60 border border-bordure rounded-xl">
                    <div className="font-sans text-[11px] text-texte-doux">
                      P90 Porteur
                    </div>
                    <div
                      data-testid="focus-mc-p90"
                      className="text-sm font-semibold text-texte mt-0.5"
                    >
                      {formatEur(activeMcPoint.p90, 0)}
                    </div>
                  </div>
                </div>
              </section>

              <hr className="border-bordure" />

              {/* ============================================================= */}
              {/* SECTION B: BUY / SELL SIGNALS & ORBITAL EXECUTION              */}
              {/* ============================================================= */}
              <section
                aria-label="Signaux d'achat et de vente"
                className="space-y-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-bold text-texte">
                    Signaux d’Achat / Vente
                  </h3>
                  <span className="font-mono tabular-nums text-xs text-texte-doux">
                    Conviction {snapshot.signalConvictionPct} %
                  </span>
                </div>

                {/* Signal Verdict Banner (Clean surface contrast, no thick left border) */}
                <div className="p-3.5 bg-surface/65 border border-bordure rounded-xl space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1.5 font-mono text-sm font-bold">
                      {snapshot.signalTone === 'positive' ? (
                        <ArrowUpRight className="w-4 h-4 text-succes-texte shrink-0" />
                      ) : snapshot.signalTone === 'negative' ? (
                        <ArrowDownRight className="w-4 h-4 text-erreur-texte shrink-0" />
                      ) : null}
                      <span
                        data-testid="focus-signal-verdict"
                        className={
                          snapshot.signalTone === 'positive'
                            ? 'text-succes-texte'
                            : snapshot.signalTone === 'negative'
                              ? 'text-erreur-texte'
                              : 'text-texte'
                        }
                      >
                        Signal : {snapshot.signalAction}
                      </span>
                    </div>

                    {snapshot.recommendedDeltaCad !== 0 && !snapshot.isCash && (
                      <span
                        className={`font-mono tabular-nums text-xs font-semibold ${
                          snapshot.recommendedDeltaCad > 0
                            ? 'text-succes-texte'
                            : 'text-erreur-texte'
                        }`}
                      >
                        Cible {formatSignedEur(snapshot.recommendedDeltaCad, 0)}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-texte leading-relaxed">
                    {snapshot.conciseSignalSummary}
                  </p>
                </div>

                {/* Stop / Spot / Fair Value / Target 12M Geometry */}
                {!snapshot.isCash && (
                  <PriceTargetRangeBar
                    spotCad={snapshot.spotPriceCad}
                    fairCad={snapshot.fairValueCad}
                    stopCad={snapshot.stopLossCad}
                    targetCad={snapshot.target12mCad}
                  />
                )}

                {/* 3 Crisp Unboxed Quantitative Signal Rows */}
                <div className="divide-y divide-bordure border-y border-bordure text-xs">
                  {snapshot.triggers.map((trig) => (
                    <div
                      key={trig.id}
                      className="py-2 flex items-center justify-between gap-2"
                    >
                      <span className="text-texte-doux shrink-0">
                        {trig.label}
                      </span>
                      <span
                        className={`font-mono tabular-nums text-right whitespace-nowrap ${
                          trig.tone === 'positive'
                            ? 'text-succes-texte font-medium'
                            : trig.tone === 'negative'
                              ? 'text-erreur-texte font-medium'
                              : 'text-texte'
                        }`}
                      >
                        {trig.metricText}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Direct Execution Controls (Dynamically animates central orbital graph!) */}
                {snapshot.isCash ? (
                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        onAdjustAvailableCash(availableCashCad + 2500)
                      }
                      className="min-w-11 min-h-11 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Ajouter +2 500 $</span>
                    </button>
                    <button
                      type="button"
                      disabled={availableCashCad <= 0}
                      onClick={() =>
                        onAdjustAvailableCash(
                          Math.max(0, availableCashCad - 2500)
                        )
                      }
                      className="min-w-11 min-h-11 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-texte bg-surface hover:bg-surface-douce disabled:opacity-40 border border-bordure rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                      <span>Retirer 2 500 $</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5 pt-1">
                    {/* Primary Signal Execution Action */}
                    {snapshot.recommendedDeltaCad !== 0 && (
                      <button
                        type="button"
                        data-testid="focus-execute-primary-btn"
                        onClick={() =>
                          onExecuteOrder(
                            snapshot.assetId,
                            snapshot.recommendedDeltaCad
                          )
                        }
                        className={`w-full min-h-11 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                          snapshot.recommendedDeltaCad > 0
                            ? 'bg-accent hover:bg-accent-fonce text-sur-accent'
                            : 'bg-erreur-texte hover:bg-erreur-texte text-sur-accent'
                        }`}
                      >
                        <span>
                          {snapshot.recommendedDeltaCad > 0
                            ? `Exécuter le signal (${snapshot.signalAction} +${formatEur(snapshot.recommendedDeltaCad, 0)})`
                            : `Exécuter le signal (${snapshot.signalAction} ${formatSignedEur(snapshot.recommendedDeltaCad, 0)})`}
                        </span>
                      </button>
                    )}

                    {/* Secondary Fine Weight Adjustments to Watch Orbital Motion Live */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        data-testid="focus-quick-buy-btn"
                        onClick={() =>
                          onExecuteOrder(
                            snapshot.assetId,
                            snapshot.recommendedDeltaCad > 0
                              ? 1500
                              : snapshot.quickBuyAmountCad
                          )
                        }
                        className="min-w-11 min-h-11 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-mono tabular-nums font-medium text-succes-texte bg-surface hover:bg-surface-douce border border-bordure rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>
                          Acheter +
                          {formatEur(
                            snapshot.recommendedDeltaCad > 0
                              ? 1500
                              : snapshot.quickBuyAmountCad,
                            0
                          )}
                        </span>
                      </button>

                      <button
                        type="button"
                        data-testid="focus-quick-trim-btn"
                        disabled={!snapshot.isHeld}
                        onClick={() =>
                          onExecuteOrder(
                            snapshot.assetId,
                            -(snapshot.recommendedDeltaCad < 0
                              ? 1500
                              : snapshot.quickTrimAmountCad)
                          )
                        }
                        className="min-w-11 min-h-11 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-mono tabular-nums font-medium text-erreur-texte bg-surface hover:bg-surface-douce disabled:opacity-35 border border-bordure rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                        <span>
                          Alléger −
                          {formatEur(
                            snapshot.recommendedDeltaCad < 0
                              ? 1500
                              : snapshot.quickTrimAmountCad,
                            0
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};

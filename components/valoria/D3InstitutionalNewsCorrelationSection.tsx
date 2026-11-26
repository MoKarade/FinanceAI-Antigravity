import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { ExternalLink, RefreshCw } from 'lucide-react';
import {
  AssetInstitutionalCorrelationProfile,
  CorrelatedInstitutionalEvent,
  PortfolioInstitutionalNewsSummary,
} from '../../services/valoria/institutionalCurveAndNewsEngine';
import { ScrollReveal } from './MotionPrimitives';
import { formatEur, formatSignedPct } from '../../services/valoria/valoriaFormatters';
import { safeExternalHttpUrl } from '../../utils/safeExternalUrl';

interface D3InstitutionalNewsCorrelationSectionProps {
  institutionalNews: PortfolioInstitutionalNewsSummary;
  selectedAssetId: string;
  heldAssetIds: string[];
  watchlistIds: string[];
  isFetchingLiveInstitutional: boolean;
  liveSourcesVerified: string[];
  onRefreshInstitutionalSources: () => void;
  onSelectAsset: (assetId: string) => void;
  onInspectAssetModal: (assetId: string) => void;
}

export const D3InstitutionalNewsCorrelationSection: React.FC<
  D3InstitutionalNewsCorrelationSectionProps
> = ({
  institutionalNews,
  selectedAssetId,
  heldAssetIds,
  watchlistIds,
  isFetchingLiveInstitutional,
  liveSourcesVerified,
  onRefreshInstitutionalSources,
  onSelectAsset,
  onInspectAssetModal,
}) => {
  const [feedScope, setFeedScope] = useState<'asset' | 'global'>('global');
  const [hoveredCurveIdx, setHoveredCurveIdx] = useState<number | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [svgWidth, setSvgWidth] = useState<number>(640);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w >= 260) setSvgWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const quickAssetIds = useMemo(() => {
    return Array.from(
      new Set([
        selectedAssetId,
        ...heldAssetIds,
        ...watchlistIds,
        'ADP',
        'INTC',
        'GOOGL',
        'RY',
        'LLY',
        'BA',
      ])
    )
      .filter((id) => institutionalNews.byAssetId.has(id))
      .slice(0, 10);
  }, [selectedAssetId, heldAssetIds, watchlistIds, institutionalNews.byAssetId]);

  const activeProfile: AssetInstitutionalCorrelationProfile | undefined =
    institutionalNews.byAssetId.get(selectedAssetId) ??
    institutionalNews.byAssetId.get(quickAssetIds[0] ?? 'ADP');

  const displayedEvents: CorrelatedInstitutionalEvent[] = useMemo(() => {
    if (feedScope === 'asset' && activeProfile) {
      return activeProfile.events;
    }
    return institutionalNews.globalFeed;
  }, [feedScope, activeProfile, institutionalNews.globalFeed]);

  // Draw Dual-Pane D3 Event-Study Price Curve (Base 100 $ CAD) + Abnormal Return CAR % Bars
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !activeProfile || activeProfile.curve24m.length < 4) return;

    const curve = activeProfile.curve24m;
    const events = activeProfile.events;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const totalH = 318;
    const margin = { top: 20, right: 20, bottom: 26, left: 52 };
    const innerW = Math.max(200, svgWidth - margin.left - margin.right);
    const pricePaneH = 166;
    const gapH = 24;
    const carPaneTop = pricePaneH + gapH;
    const carPaneH = totalH - margin.top - margin.bottom - carPaneTop;

    svg.attr('viewBox', `0 0 ${svgWidth} ${totalH}`);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([0, curve.length - 1])
      .range([0, innerW]);

    const idxVals = curve.flatMap((c) => [c.assetIndexed100, c.benchmarkIndexed100]);
    const yMin = Math.max(20, (d3.min(idxVals) ?? 80) * 0.92);
    const yMax = (d3.max(idxVals) ?? 130) * 1.08;
    const yPrice = d3.scaleLinear().domain([yMin, yMax]).range([pricePaneH, 0]);

    // Price Gridlines
    g.append('g')
      .selectAll('line')
      .data(yPrice.ticks(4))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yPrice(d))
      .attr('y2', (d) => yPrice(d))
      .attr('stroke', VALORIA_PALETTE.gridZinc)
      .attr('stroke-dasharray', '3 3');

    if (yMin <= 100 && yMax >= 100) {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', yPrice(100))
        .attr('y2', yPrice(100))
        .attr('stroke', VALORIA_PALETTE.strokeZinc)
        .attr('stroke-width', 1);
    }

    const yAxisTop = d3
      .axisLeft(yPrice)
      .ticks(4)
      .tickSize(0)
      .tickPadding(8)
      .tickFormat((v) => `${Math.round(Number(v))}`);

    g.append('g')
      .call(yAxisTop)
      .call((s) => s.select('.domain').remove())
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '10px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    // Benchmark Dashed Line (MSCI World Base 100 $ CAD)
    const benchLine = d3
      .line<(typeof curve)[number]>()
      .x((d) => xScale(d.index))
      .y((d) => yPrice(d.benchmarkIndexed100))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(curve)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.mutedZinc)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 3')
      .attr('d', benchLine);

    // Asset Area + Line ($ CAD Base 100)
    const assetArea = d3
      .area<(typeof curve)[number]>()
      .x((d) => xScale(d.index))
      .y0(pricePaneH)
      .y1((d) => yPrice(d.assetIndexed100))
      .curve(d3.curveMonotoneX);

    const lastVal = curve[curve.length - 1]?.assetIndexed100 ?? 100;
    const mainColor = lastVal >= 100 ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose;

    g.append('path')
      .datum(curve)
      .attr('fill', mainColor)
      .attr('fill-opacity', 0.12)
      .attr('d', assetArea);

    const assetLine = d3
      .line<(typeof curve)[number]>()
      .x((d) => xScale(d.index))
      .y((d) => yPrice(d.assetIndexed100))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(curve)
      .attr('fill', 'none')
      .attr('stroke', mainColor)
      .attr('stroke-width', 2.3)
      .attr('pathLength', 1)
      .attr('class', 'animate-curve-draw')
      .attr('d', assetLine);

    g.append('text')
      .attr('x', 4)
      .attr('y', 10)
      .attr('fill', VALORIA_PALETTE.textZincLight)
      .attr('font-size', '10px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(`${activeProfile.ticker} ($ CAD Base 100) vs Indice Mondial (pointillé)`);

    // Pane 2: Monthly Idiosyncratic Abnormal Return (CAR %)
    const maxAbsAbn = Math.max(
      8,
      d3.max(curve, (d) => Math.abs(d.abnormalReturnPct)) ?? 10,
      d3.max(events, (e) => Math.abs(e.abnormalReturnCarPct)) ?? 10
    );
    const yCar = d3
      .scaleLinear()
      .domain([-maxAbsAbn * 1.12, maxAbsAbn * 1.12])
      .range([carPaneTop + carPaneH, carPaneTop]);

    const zeroCarY = yCar(0);

    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', zeroCarY)
      .attr('y2', zeroCarY)
      .attr('stroke', VALORIA_PALETTE.strokeZinc)
      .attr('stroke-width', 1);

    const sigThreshold = maxAbsAbn * 0.55;
    for (const lv of [sigThreshold, -sigThreshold]) {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', yCar(lv))
        .attr('y2', yCar(lv))
        .attr('stroke', VALORIA_PALETTE.gridZinc)
        .attr('stroke-dasharray', '2 3');
    }

    g.append('text')
      .attr('x', 4)
      .attr('y', carPaneTop - 6)
      .attr('fill', VALORIA_PALETTE.textZinc)
      .attr('font-size', '9.5px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text('EFFET DIRECT DES ANNONCES (CAR % hors marché)');

    const yAxisCar = d3
      .axisLeft(yCar)
      .ticks(3)
      .tickSize(0)
      .tickPadding(8)
      .tickFormat((v) => `${Number(v) > 0 ? '+' : ''}${Math.round(Number(v))}%`);

    g.append('g')
      .call(yAxisCar)
      .call((s) => s.select('.domain').remove())
      .call((s) =>
        s
          .selectAll('text')
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '9.5px')
          .attr('font-family', 'JetBrains Mono, monospace')
      );

    const tickIndices = curve
      .map((c) => c.index)
      .filter((i) => i % 4 === 0 || i === curve.length - 1);

    const xAxis = d3
      .axisBottom(xScale)
      .tickValues(tickIndices)
      .tickSize(3)
      .tickFormat((i) => curve[Number(i)]?.yearMonth ?? '');

    g.append('g')
      .attr('transform', `translate(0,${carPaneTop + carPaneH})`)
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

    const barW = Math.max(4, Math.min(16, (innerW / curve.length) * 0.62));
    const eventIdxMap = new Map<number, CorrelatedInstitutionalEvent>();
    for (const ev of events) {
      if (!eventIdxMap.has(ev.curvePointIndex)) {
        eventIdxMap.set(ev.curvePointIndex, ev);
      }
    }

    curve.forEach((pt) => {
      const pinnedEv = eventIdxMap.get(pt.index);
      const val = pinnedEv ? pinnedEv.abnormalReturnCarPct : pt.abnormalReturnPct;
      const bx = xScale(pt.index) - barW / 2;
      const by = val >= 0 ? yCar(val) : zeroCarY;
      const bh = Math.max(1.5, Math.abs(yCar(val) - zeroCarY));
      const fill =
        val >= 0.4
          ? pinnedEv
            ? VALORIA_PALETTE.emerald
            : VALORIA_PALETTE.emeraldDark
          : val <= -0.4
            ? pinnedEv
              ? VALORIA_PALETTE.rose
              : VALORIA_PALETTE.crimson
            : VALORIA_PALETTE.strokeZinc;

      g.append('rect')
        .attr('x', bx)
        .attr('y', by)
        .attr('width', barW)
        .attr('height', bh)
        .attr('rx', 1.5)
        .attr('fill', fill)
        .attr('fill-opacity', pinnedEv ? 0.95 : 0.55);
    });

    const groupedPins = new Map<
      number,
      { primary: CorrelatedInstitutionalEvent; count: number; hasSelected: boolean }
    >();
    for (const ev of events) {
      const existing = groupedPins.get(ev.curvePointIndex);
      const isSel = activeEventId === ev.id;
      if (!existing) {
        groupedPins.set(ev.curvePointIndex, { primary: ev, count: 1, hasSelected: isSel });
      } else {
        existing.count += 1;
        if (isSel) {
          existing.primary = ev;
          existing.hasSelected = true;
        }
      }
    }

    const sortedPinEntries = Array.from(groupedPins.entries()).sort((a, b) => a[0] - b[0]);
    let lastPlacedLabelX = -999;
    let lastPlacedTier = 0;

    sortedPinEntries.forEach(([ptIdx, group]) => {
      const pt = curve[ptIdx];
      if (!pt) return;
      const ev = group.primary;
      const cx = xScale(pt.index);
      const cy = yPrice(pt.assetIndexed100);
      const isPositive = ev.abnormalReturnCarPct >= 0;
      const pinColor = isPositive ? VALORIA_PALETTE.emeraldLight : VALORIA_PALETTE.roseLight;
      const isSelectedEv = group.hasSelected;

      g.append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', cy)
        .attr('y2', yCar(ev.abnormalReturnCarPct))
        .attr('stroke', pinColor)
        .attr('stroke-opacity', isSelectedEv ? 0.85 : 0.4)
        .attr('stroke-width', isSelectedEv ? 1.5 : 1)
        .attr('stroke-dasharray', '2 2');

      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', isSelectedEv ? 6.5 : 5)
        .attr('fill', pinColor)
        .attr('stroke', VALORIA_PALETTE.bgDeep)
        .attr('stroke-width', 1.8);

      const tooClose = Math.abs(cx - lastPlacedLabelX) < 76;
      const tier = tooClose ? (lastPlacedTier + 1) % 2 : 0;
      const rawLabelY = cy - (tier === 0 ? 11 : 24);
      const labelY = rawLabelY < 20 ? Math.min(pricePaneH - 8, cy + 16 + tier * 11) : rawLabelY;
      lastPlacedLabelX = cx;
      lastPlacedTier = tier;

      const anchor =
        cx > innerW - 75 ? 'end' : cx < 60 ? 'start' : 'middle';
      const labelText =
        group.count > 1 ? `${ev.filingOrEventCode} (+${group.count - 1})` : ev.filingOrEventCode;

      g.append('text')
        .attr('x', cx)
        .attr('y', labelY)
        .attr('text-anchor', anchor)
        .attr('fill', VALORIA_PALETTE.textWhiteSoft)
        .attr('font-size', '9px')
        .attr('font-weight', '700')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(labelText);
    });

    const activeIdx = hoveredCurveIdx ?? curve.length - 1;
    const activePt = curve[activeIdx];
    if (activePt) {
      const hx = xScale(activeIdx);
      g.append('line')
        .attr('x1', hx)
        .attr('x2', hx)
        .attr('y1', 0)
        .attr('y2', carPaneTop + carPaneH)
        .attr('stroke', VALORIA_PALETTE.textBright)
        .attr('stroke-opacity', 0.28)
        .attr('stroke-dasharray', '2 2');
    }

    g.append('rect')
      .attr('width', innerW)
      .attr('height', carPaneTop + carPaneH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const idx = Math.round(xScale.invert(mx));
        const clamped = Math.max(0, Math.min(curve.length - 1, idx));
        setHoveredCurveIdx(clamped);
      })
      .on('mouseleave', () => setHoveredCurveIdx(null));
  }, [activeProfile, svgWidth, hoveredCurveIdx, activeEventId]);

  if (!activeProfile) return null;

  const inspectedPt =
    activeProfile.curve24m[
      hoveredCurveIdx ?? activeProfile.curve24m.length - 1
    ];
  const priceDecimals = activeProfile.spotCad < 2 ? 4 : 2;

  return (
    <ScrollReveal>
      <section
        data-testid="d3-institutional-news-correlation"
        className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-5"
      >
        {/* Header Row */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-3.5 border-b border-bordure">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-texte">
              Actualités Officielles Vérifiées &amp; Effet sur le Prix (D3.js)
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-texte-doux">
              <span>SEC EDGAR (10-Q · 8-K · Form 4)</span>
              <span aria-hidden="true">·</span>
              <span>SEDAR+ Canada</span>
              <span aria-hidden="true">·</span>
              <span>Fiabilité moy. {institutionalNews.avgCredibilityPct} %</span>
              <span aria-hidden="true">·</span>
              <span>{institutionalNews.significantShocksCount} chocs majeurs</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {liveSourcesVerified.length > 0 && (
              <span className="text-[11px] font-mono text-succes-texte">
                {liveSourcesVerified.length} sources synchronisées
              </span>
            )}
            <button
              type="button"
              onClick={onRefreshInstitutionalSources}
              disabled={isFetchingLiveInstitutional}
              className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isFetchingLiveInstitutional ? 'animate-spin' : ''
                }`}
              />
              <span>
                {isFetchingLiveInstitutional
                  ? 'Vérification SEC EDGAR…'
                  : 'Vérifier SEC EDGAR & Sources Live'}
              </span>
            </button>
          </div>
        </div>

        {/* Quick Ticker Selector */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {quickAssetIds.map((id) => {
              const prof = institutionalNews.byAssetId.get(id);
              if (!prof) return null;
              const isSel = id === activeProfile.assetId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectAsset(id)}
                  className={`min-h-11 min-w-11 px-2.5 py-1 text-xs font-mono rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSel
                      ? 'bg-accent text-sur-accent font-bold'
                      : 'bg-surface text-texte hover:text-texte border border-bordure'
                  }`}
                >
                  {prof.ticker}{' '}
                  <span
                    className={
                      isSel
                        ? 'text-texte-doux'
                        : prof.cumulativeCarPct >= 0
                          ? 'text-succes-texte'
                          : 'text-erreur-texte'
                    }
                  >
                    {/* NOMBRE-NON-MONETAIRE : rendement anormal cumulé (CAR) historique d'étude événementielle */}
                    {prof.cumulativeCarPct >= 0 ? '+' : ''}
                    {prof.cumulativeCarPct.toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-texte">
            <span>
              Lien Actus↔Prix <strong className="text-texte">r = {activeProfile.newsToPricePearsonR.toFixed(2)}</strong>
            </span>
            <span aria-hidden="true" className="text-texte-doux">
              ·
            </span>
            <span>
              Effet cumulé{' '}
              <strong
                className={
                  activeProfile.cumulativeCarPct >= 0
                    ? 'text-succes-texte'
                    : 'text-erreur-texte'
                }
              >
                {formatSignedPct(activeProfile.cumulativeCarPct, 1)}
              </strong>
            </span>
          </div>
        </div>

        {/* Main Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-7 bg-surface/55 border border-bordure rounded-xl p-4 flex flex-col justify-between space-y-3">
            {inspectedPt && (
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-bordure text-xs font-mono tabular-nums">
                <div className="flex items-center gap-2">
                  <strong className="text-texte">{activeProfile.ticker}</strong>
                  <span className="text-texte-doux">({inspectedPt.label})</span>
                  <span className="text-texte font-semibold">
                    {formatEur(inspectedPt.assetPriceCad, priceDecimals)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={
                      inspectedPt.monthlyReturnPct >= 0
                        ? 'text-succes-texte'
                        : 'text-erreur-texte'
                    }
                  >
                    Var. {formatSignedPct(inspectedPt.monthlyReturnPct, 1)}
                  </span>
                  <span className="text-texte-doux">·</span>
                  <span
                    className={
                      inspectedPt.abnormalReturnPct >= 0
                        ? 'text-succes-texte font-semibold'
                        : 'text-erreur-texte font-semibold'
                    }
                  >
                    CAR {formatSignedPct(inspectedPt.abnormalReturnPct, 1)}
                  </span>
                </div>
              </div>
            )}

            <div ref={chartContainerRef} className="w-full overflow-hidden">
              <svg
                ref={svgRef}
                data-testid="d3-institutional-event-study-svg"
                role="img"
                aria-label={`Courbe D3 d’attribution événementielle et CAR pour ${activeProfile.ticker}`}
                className="w-full block select-none"
              />
            </div>

            <div className="pt-2 border-t border-bordure flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-texte-doux">
              <span>{activeProfile.regimeVerdict}</span>
              <button
                type="button"
                onClick={() => onInspectAssetModal(activeProfile.assetId)}
                className="min-h-11 text-texte hover:underline cursor-pointer"
              >
                Ouvrir courbes MM 50/200 · RSI · MACD →
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 bg-surface/55 border border-bordure rounded-xl p-4 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-bordure">
              <div className="inline-flex items-center gap-1 p-0.5 bg-fond border border-bordure rounded-lg">
                <button aria-pressed={Boolean(feedScope === 'global')}
                  type="button"
                  onClick={() => setFeedScope('global')}
                  className={`min-h-11 min-w-11 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    feedScope === 'global'
                      ? 'bg-accent text-sur-accent font-semibold'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  Flux Global ({institutionalNews.globalFeed.length})
                </button>
                <button aria-pressed={Boolean(feedScope === 'asset')}
                  type="button"
                  onClick={() => setFeedScope('asset')}
                  className={`min-h-11 min-w-11 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    feedScope === 'asset'
                      ? 'bg-accent text-sur-accent font-semibold'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  {activeProfile.ticker} ({activeProfile.events.length})
                </button>
              </div>

              <span className="text-[11px] font-mono text-texte-doux">
                Réaction Cours
              </span>
            </div>

            <div className="divide-y divide-bordure max-h-[310px] overflow-y-auto pr-1">
              {displayedEvents.map((ev) => {
                const isPos = ev.abnormalReturnCarPct >= 0;
                return (
                  <div
                    key={ev.id}
                    onMouseEnter={() => {
                      setActiveEventId(ev.id);
                      if (ev.assetId === activeProfile.assetId) {
                        setHoveredCurveIdx(ev.curvePointIndex);
                      }
                    }}
                    onMouseLeave={() => {
                      setActiveEventId(null);
                      setHoveredCurveIdx(null);
                    }}
                    className="py-2.5 first:pt-1 last:pb-1 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-texte-doux">
                      <button
                        type="button"
                        onClick={() => onSelectAsset(ev.assetId)}
                        className="min-h-11 text-left hover:text-texte transition-colors truncate cursor-pointer"
                      >
                        <strong className="text-texte">{ev.ticker}</strong>
                        {' · '}
                        <span className="text-texte">{ev.filingOrEventCode}</span>
                        {' · '}
                        <span>{ev.publishedAt}</span>
                      </button>
                      <span className="shrink-0 text-texte-doux">
                        Fiab. {ev.credibilityScorePct}%
                      </span>
                    </div>

                    <div className="text-xs text-texte font-medium leading-snug">
                      {(() => {
                        const safeUrl = safeExternalHttpUrl(ev.url);
                        return safeUrl ? (
                          <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-texte inline-flex items-start gap-1"
                          >
                            <span className="line-clamp-2">{ev.headline}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-texte-doux" />
                          </a>
                        ) : (
                          <span className="line-clamp-2">{ev.headline}</span>
                        );
                      })()}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums pt-0.5">
                      <span className="text-texte-doux">
                        {ev.sourceName} · {ev.alignment}
                      </span>
                      <span
                        className={
                          isPos
                            ? 'text-succes-texte font-semibold'
                            : 'text-erreur-texte font-semibold'
                        }
                      >
                        Cours {formatSignedPct(ev.realizedAssetMovePct, 1)} · CAR{' '}
                        {formatSignedPct(ev.abnormalReturnCarPct, 1)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
};

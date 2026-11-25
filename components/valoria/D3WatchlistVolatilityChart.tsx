import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { Plus, X } from 'lucide-react';
import { ASSETS } from '../../services/valoria/marketData';
import { getAssetSubClass } from '../../services/valoria/globalMarketCatalog';
import { PortfolioLot } from '../../services/valoria/engine';
import {
  WatchlistAssetVolatilityProfile,
  computeWatchlistHistoricalVolatility,
} from '../../services/valoria/proAnalystAdvisor';
import { ScrollReveal } from './MotionPrimitives';
import { formatEur, formatPct } from '../../services/valoria/valoriaFormatters';

interface D3WatchlistVolatilityChartProps {
  watchlistIds: string[];
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  riskFreeRatePct: number;
  marketUniverseVersion?: number;
  onAddWatchlistAsset: (assetId: string) => void;
  onRemoveWatchlistAsset: (assetId: string) => void;
  onQuickInvestAsset: (assetId: string, amountCad: number) => void;
  onInspectAsset?: (assetId: string) => void;
}

type VolChartMode = 'rolling12m' | 'range10y';

function getVolStrokeColor(volPct: number, index: number): string {
  if (volPct <= 16) return VALORIA_PALETTE.emerald;
  if (volPct >= 28) return VALORIA_PALETTE.rose;
  const neutrals = [VALORIA_PALETTE.textBright, VALORIA_PALETTE.textZinc, VALORIA_PALETTE.textZincLight, VALORIA_PALETTE.mutedZinc];
  return neutrals[index % neutrals.length];
}

export const D3WatchlistVolatilityChart: React.FC<
  D3WatchlistVolatilityChartProps
> = ({
  watchlistIds,
  lots,
  livePrices,
  riskFreeRatePct,
  marketUniverseVersion = 0,
  onAddWatchlistAsset,
  onRemoveWatchlistAsset,
  onQuickInvestAsset,
  onInspectAsset,
}) => {
  const [chartMode, setChartMode] = useState<VolChartMode>('rolling12m');
  const [candidateId, setCandidateId] = useState<string>('RY');
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [svgWidth, setSvgWidth] = useState<number>(880);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const volSummary = useMemo(
    () => {
      void marketUniverseVersion;
      return computeWatchlistHistoricalVolatility({
        watchlistIds,
        lots,
        livePrices,
        riskFreeAnnualPct: riskFreeRatePct,
      });
    },
    [watchlistIds, lots, livePrices, riskFreeRatePct, marketUniverseVersion]
  );

  const availableToAdd = useMemo(() => {
    void marketUniverseVersion;
    const watched = new Set(watchlistIds);
    return ASSETS.filter((a) => !watched.has(a.id) && a.id !== 'CASH');
  }, [watchlistIds, marketUniverseVersion]);

  const groupedAvailable = useMemo(() => {
    const groups: { label: string; items: typeof availableToAdd }[] = [
      { label: 'Actions Canada (TSX)', items: [] },
      { label: 'Actions États-Unis', items: [] },
      { label: 'Actions Europe & Asie', items: [] },
      { label: 'Cryptomonnaies & Web3', items: [] },
      { label: 'ETF, Obligations, Matières 1res & REIT', items: [] },
    ];
    for (const a of availableToAdd) {
      const sc = getAssetSubClass(a);
      if (sc === 'action_ca') groups[0].items.push(a);
      else if (sc === 'action_us') groups[1].items.push(a);
      else if (sc === 'action_eu_asia') groups[2].items.push(a);
      else if (sc === 'crypto_l1_defi') groups[3].items.push(a);
      else groups[4].items.push(a);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [availableToAdd]);

  useEffect(() => {
    if (
      availableToAdd.length > 0 &&
      !availableToAdd.some((a) => a.id === candidateId)
    ) {
      setCandidateId(availableToAdd[0].id);
    }
  }, [availableToAdd, candidateId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 240) {
        setSvgWidth(Math.floor(w));
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const colorByAssetId = useMemo(() => {
    const map = new Map<string, string>();
    volSummary.assets.forEach((item, idx) => {
      map.set(item.asset.id, getVolStrokeColor(item.currentVol12mPct, idx));
    });
    return map;
  }, [volSummary.assets]);

  const activePointIndex =
    hoverIndex !== null &&
    hoverIndex >= 0 &&
    hoverIndex < volSummary.portfolioRolling12m.length
      ? hoverIndex
      : Math.max(0, volSummary.portfolioRolling12m.length - 1);

  const inspectedLabel =
    volSummary.portfolioRolling12m[activePointIndex]?.label ?? 'Nov. 2026';
  const inspectedPortVol =
    volSummary.portfolioRolling12m[activePointIndex]?.annualizedVolPct ??
    volSummary.portfolioCurrentVol12mPct;

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (volSummary.assets.length === 0) return;

    if (chartMode === 'rolling12m') {
      const height = 310;
      const margin = { top: 20, right: 88, bottom: 32, left: 48 };
      const innerW = Math.max(180, svgWidth - margin.left - margin.right);
      const innerH = height - margin.top - margin.bottom;

      svg.attr('viewBox', `0 0 ${svgWidth} ${height}`);

      const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      const parseDate = d3.utcParse('%Y-%m-%d');
      const dates = volSummary.portfolioRolling12m.map(
        (pt) => parseDate(pt.dateIso) ?? new Date()
      );

      const xScale = d3
        .scaleUtc()
        .domain(d3.extent(dates) as [Date, Date])
        .range([0, innerW]);

      let maxVol = d3.max(volSummary.portfolioRolling12m, (d) => d.annualizedVolPct) ?? 25;
      for (const item of volSummary.assets) {
        if (focusedAssetId && focusedAssetId !== item.asset.id) continue;
        const m = d3.max(item.rolling12m, (d) => d.annualizedVolPct) ?? 0;
        if (m > maxVol) maxVol = m;
      }
      const yMax = Math.min(115, Math.max(32, Math.ceil(maxVol * 1.12)));

      const yScale = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]);

      const thresholds = [
        { val: 12, label: '12 % Calme' },
        { val: 20, label: '20 % Modéré' },
        { val: 30, label: '30 % Nerveux' },
      ].filter((t) => t.val < yMax - 3);

      thresholds.forEach((t) => {
        const y = yScale(t.val);
        g.append('line')
          .attr('x1', 0)
          .attr('x2', innerW)
          .attr('y1', y)
          .attr('y2', y)
          .attr('stroke', VALORIA_PALETTE.gridZinc)
          .attr('stroke-dasharray', '3,3');

        g.append('text')
          .attr('x', innerW + 8)
          .attr('y', y + 3)
          .attr('text-anchor', 'start')
          .attr('fill', VALORIA_PALETTE.mutedZinc)
          .attr('font-size', '10px')
          .attr('font-family', 'JetBrains Mono, monospace')
          .text(t.label);
      });

      const stressEvents = [
        { dateStr: '2020-03-15', label: 'COVID (2020)' },
        { dateStr: '2022-06-15', label: 'Taux (2022)' },
      ];
      stressEvents.forEach((ev) => {
        const dt = parseDate(ev.dateStr);
        if (!dt) return;
        const x = xScale(dt);
        if (x < 24 || x > innerW - 24) return;
        g.append('line')
          .attr('x1', x)
          .attr('x2', x)
          .attr('y1', 0)
          .attr('y2', innerH)
          .attr('stroke', VALORIA_PALETTE.axisZinc)
          .attr('stroke-opacity', 0.65)
          .attr('stroke-dasharray', '2,4');

        g.append('text')
          .attr('x', x + 4)
          .attr('y', 10)
          .attr('fill', VALORIA_PALETTE.textZinc)
          .attr('font-size', '10px')
          .text(ev.label);
      });

      const xAxis = d3
        .axisBottom(xScale)
        .ticks(Math.max(4, Math.floor(innerW / 115)))
        .tickSizeOuter(0);
      const yAxis = d3
        .axisLeft(yScale)
        .ticks(5)
        .tickFormat((d) => `${d} %`);

      g.append('g')
        .attr('transform', `translate(0,${innerH})`)
        .call(xAxis)
        .call((sel) => sel.select('.domain').attr('stroke', VALORIA_PALETTE.gridZinc))
        .call((sel) => sel.selectAll('line').attr('stroke', VALORIA_PALETTE.gridZinc))
        .call((sel) =>
          sel
            .selectAll('text')
            .attr('fill', VALORIA_PALETTE.textZinc)
            .attr('font-size', '11px')
            .attr('font-family', 'JetBrains Mono, monospace')
        );

      g.append('g')
        .call(yAxis)
        .call((sel) => sel.select('.domain').remove())
        .call((sel) => sel.selectAll('line').attr('stroke', VALORIA_PALETTE.gridZinc))
        .call((sel) =>
          sel
            .selectAll('text')
            .attr('fill', VALORIA_PALETTE.textZinc)
            .attr('font-size', '11px')
            .attr('font-family', 'JetBrains Mono, monospace')
        );

      const lineGen = d3
        .line<{ date: Date; vol: number }>()
        .x((d) => xScale(d.date))
        .y((d) => yScale(d.vol))
        .curve(d3.curveMonotoneX);

      const portSeries = volSummary.portfolioRolling12m.map((pt, i) => ({
        date: dates[i],
        vol: pt.annualizedVolPct,
      }));

      g.append('path')
        .datum(portSeries)
        .attr('fill', 'none')
        .attr('stroke', VALORIA_PALETTE.textWhiteSoft)
        .attr('stroke-width', 1.8)
        .attr('stroke-dasharray', '5,4')
        .attr('opacity', 0.85)
        .attr('d', lineGen);

      volSummary.assets.forEach((item) => {
        const isDimmed =
          focusedAssetId !== null && focusedAssetId !== item.asset.id;
        const color = colorByAssetId.get(item.asset.id) ?? VALORIA_PALETTE.textZinc;
        const series = item.rolling12m.map((pt, i) => ({
          date: dates[i],
          vol: pt.annualizedVolPct,
        }));

        g.append('path')
          .datum(series)
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', focusedAssetId === item.asset.id ? 2.6 : 1.9)
          .attr('opacity', isDimmed ? 0.18 : 0.95)
          .attr('d', lineGen);
      });

      if (dates[activePointIndex]) {
        const cx = xScale(dates[activePointIndex]);
        g.append('line')
          .attr('x1', cx)
          .attr('x2', cx)
          .attr('y1', 0)
          .attr('y2', innerH)
          .attr('stroke', VALORIA_PALETTE.textZinc)
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '2,2');

        const py = yScale(
          volSummary.portfolioRolling12m[activePointIndex].annualizedVolPct
        );
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', py)
          .attr('r', 3.5)
          .attr('fill', VALORIA_PALETTE.textWhiteSoft);

        volSummary.assets.forEach((item) => {
          if (focusedAssetId && focusedAssetId !== item.asset.id) return;
          const pt = item.rolling12m[activePointIndex];
          if (!pt) return;
          g.append('circle')
            .attr('cx', cx)
            .attr('cy', yScale(pt.annualizedVolPct))
            .attr('r', 3.5)
            .attr('fill', colorByAssetId.get(item.asset.id) ?? VALORIA_PALETTE.textZinc)
            .attr('stroke', VALORIA_PALETTE.bgDeep)
            .attr('stroke-width', 1.2);
        });
      }

      const bisect = d3.bisector((d: Date) => d.getTime()).center;
      g.append('rect')
        .attr('width', innerW)
        .attr('height', innerH)
        .attr('fill', 'transparent')
        .style('cursor', 'crosshair')
        .on('mousemove', (event) => {
          const [mx] = d3.pointer(event);
          const hoveredDate = xScale.invert(mx);
          const idx = bisect(dates, hoveredDate);
          setHoverIndex(
            Math.max(0, Math.min(dates.length - 1, idx))
          );
        })
        .on('mouseleave', () => setHoverIndex(null));
    } else {
      const rowHeight = 38;
      const margin = { top: 24, right: 32, bottom: 28, left: 108 };
      const height =
        margin.top + margin.bottom + Math.max(3, volSummary.assets.length) * rowHeight;
      const innerW = Math.max(180, svgWidth - margin.left - margin.right);
      const innerH = height - margin.top - margin.bottom;

      svg.attr('viewBox', `0 0 ${svgWidth} ${height}`);

      const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      const maxPeak = Math.max(
        volSummary.portfolioCurrentVol12mPct * 1.2,
        d3.max(volSummary.assets, (a) => a.maxVol12mPct) ?? 40
      );
      const xMax = Math.min(115, Math.ceil(maxPeak * 1.12));

      const xScale = d3.scaleLinear().domain([0, xMax]).range([0, innerW]);
      const yScale = d3
        .scaleBand<string>()
        .domain(volSummary.assets.map((a) => a.asset.ticker))
        .range([0, innerH])
        .padding(0.35);

      const xAxis = d3
        .axisBottom(xScale)
        .ticks(6)
        .tickFormat((d) => `${d} %`);

      g.append('g')
        .attr('transform', `translate(0,${innerH})`)
        .call(xAxis)
        .call((sel) => sel.select('.domain').attr('stroke', VALORIA_PALETTE.gridZinc))
        .call((sel) =>
          sel
            .selectAll('line')
            .attr('y1', -innerH)
            .attr('stroke', VALORIA_PALETTE.gridZinc)
            .attr('stroke-dasharray', '2,3')
        )
        .call((sel) =>
          sel
            .selectAll('text')
            .attr('fill', VALORIA_PALETTE.textZinc)
            .attr('font-size', '11px')
            .attr('font-family', 'JetBrains Mono, monospace')
        );

      const portX = xScale(volSummary.portfolioCurrentVol12mPct);
      g.append('line')
        .attr('x1', portX)
        .attr('x2', portX)
        .attr('y1', -6)
        .attr('y2', innerH)
        .attr('stroke', VALORIA_PALETTE.textWhiteSoft)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,3');

      g.append('text')
        .attr('x', Math.min(innerW - 4, Math.max(4, portX)))
        .attr('y', -9)
        .attr('text-anchor', portX > innerW - 90 ? 'end' : 'middle')
        .attr('fill', VALORIA_PALETTE.lineZinc)
        .attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`Portefeuille (${volSummary.portfolioCurrentVol12mPct} %)`);

      volSummary.assets.forEach((item) => {
        const yCenter =
          (yScale(item.asset.ticker) ?? 0) + yScale.bandwidth() / 2;
        const color = colorByAssetId.get(item.asset.id) ?? VALORIA_PALETTE.textZinc;

        g.append('text')
          .attr('x', -10)
          .attr('y', yCenter + 4)
          .attr('text-anchor', 'end')
          .attr('fill', VALORIA_PALETTE.textBright)
          .attr('font-size', '11px')
          .attr('font-weight', '600')
          .attr('font-family', 'JetBrains Mono, monospace')
          .text(item.asset.ticker);

        g.append('line')
          .attr('x1', xScale(item.minVol12mPct))
          .attr('x2', xScale(item.maxVol12mPct))
          .attr('y1', yCenter)
          .attr('y2', yCenter)
          .attr('stroke', VALORIA_PALETTE.gridZinc)
          .attr('stroke-width', 6)
          .attr('stroke-linecap', 'round');

        g.append('line')
          .attr('x1', xScale(item.avgVol10yPct))
          .attr('x2', xScale(item.avgVol10yPct))
          .attr('y1', yCenter - 6)
          .attr('y2', yCenter + 6)
          .attr('stroke', VALORIA_PALETTE.textZinc)
          .attr('stroke-width', 2);

        g.append('circle')
          .attr('cx', xScale(item.maxVol12mPct))
          .attr('cy', yCenter)
          .attr('r', 4)
          .attr('fill', VALORIA_PALETTE.bgDeep)
          .attr('stroke', VALORIA_PALETTE.rose)
          .attr('stroke-width', 1.8);

        g.append('circle')
          .attr('cx', xScale(item.currentVol12mPct))
          .attr('cy', yCenter)
          .attr('r', 5.5)
          .attr('fill', color)
          .attr('stroke', VALORIA_PALETTE.bgDeep)
          .attr('stroke-width', 1.5);
      });
    }
  }, [
    volSummary,
    chartMode,
    svgWidth,
    focusedAssetId,
    activePointIndex,
    colorByAssetId,
  ]);

  return (
    <ScrollReveal className="bg-fond/90 border border-bordure rounded-2xl p-5 sm:p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base sm:text-lg font-bold text-texte">
            Nervosité &amp; Volatilité sur 10 Ans (D3.js)
          </h2>
          <p className="text-xs text-texte-doux">
            Vert = calme (&lt; 16 %/an) · Rouge = très nerveux (&gt; 28 %/an) · Pointillé blanc = votre portefeuille.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {availableToAdd.length > 0 && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="watchlist-add-select" className="sr-only">
                Choisir un actif à ajouter à la watchlist
              </label>
              <select
                id="watchlist-add-select"
                value={candidateId}
                onChange={(e) => setCandidateId(e.target.value)}
                className="min-h-11 max-w-[230px] px-2.5 py-1.5 text-xs bg-surface border border-bordure rounded-xl text-texte outline-hidden focus-ring focus:border-bordure-champ"
              >
                {groupedAvailable.map((grp) => (
                  <optgroup key={grp.label} label={grp.label}>
                    {grp.items.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.ticker} — {a.name.split(' (')[0]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onAddWatchlistAsset(candidateId)}
                className="min-h-11 min-w-11 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Suivre</span>
              </button>
            </div>
          )}

          <div className="inline-flex p-0.5 bg-surface border border-bordure rounded-xl">
            <button aria-pressed={Boolean(chartMode === 'rolling12m')}
              type="button"
              onClick={() => setChartMode('rolling12m')}
              className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMode === 'rolling12m'
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              Courbe 10 Ans
            </button>
            <button aria-pressed={Boolean(chartMode === 'range10y')}
              type="button"
              onClick={() => setChartMode('range10y')}
              className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMode === 'range10y'
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              Fourchette &amp; Crises
            </button>
          </div>
        </div>
      </div>

      {volSummary.assets.length === 0 ? (
        <div className="py-10 text-center space-y-3 border-t border-bordure">
          <p className="text-sm text-texte">
            Votre liste de suivi est vide.
          </p>
          <button
            type="button"
            onClick={() => {
              ['GOOGL', 'NOVO', 'SU', 'GOVT'].forEach((id) =>
                onAddWatchlistAsset(id)
              );
            }}
            className="min-h-11 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl cursor-pointer"
          >
            Charger 4 valeurs exemples
          </button>
        </div>
      ) : (
        <>
          <div className="pt-3 border-t border-bordure flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono tabular-nums text-texte mr-1">
                {chartMode === 'rolling12m'
                  ? `${inspectedLabel} · Portefeuille : ${formatPct(inspectedPortVol, 1)}`
                  : `Portefeuille : ${formatPct(volSummary.portfolioCurrentVol12mPct, 1)} (moy. 10A ${formatPct(volSummary.portfolioAvgVol10yPct, 1)})`}
              </span>

              {volSummary.assets.map((item: WatchlistAssetVolatilityProfile) => {
                const color = colorByAssetId.get(item.asset.id) ?? VALORIA_PALETTE.textZinc;
                const isFocused = focusedAssetId === item.asset.id;
                const ptVol =
                  item.rolling12m[activePointIndex]?.annualizedVolPct ??
                  item.currentVol12mPct;

                return (
                  <div
                    key={item.asset.id}
                    className={`inline-flex items-center bg-surface border rounded-lg overflow-hidden transition-colors ${
                      isFocused ? 'border-accent' : 'border-bordure'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setFocusedAssetId((prev) =>
                          prev === item.asset.id ? null : item.asset.id
                        )
                      }
                      className="min-h-11 min-w-11 px-2.5 py-1 flex items-center gap-1.5 text-xs text-texte hover:bg-surface-douce cursor-pointer whitespace-nowrap"
                    >
                      <svg
                        width="10"
                        height="3"
                        viewBox="0 0 10 3"
                        aria-hidden="true"
                        className="shrink-0"
                      >
                        <rect width="10" height="3" rx="1" fill={color} />
                      </svg>
                      <span className="font-mono font-semibold">
                        {item.asset.ticker}
                      </span>
                      <span className="font-mono tabular-nums text-texte-doux">
                        {formatPct(ptVol, 1)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (focusedAssetId === item.asset.id) {
                          setFocusedAssetId(null);
                        }
                        onRemoveWatchlistAsset(item.asset.id);
                      }}
                      aria-label={`Retirer ${item.asset.ticker} de la watchlist`}
                      className="min-h-11 min-w-11 px-1.5 py-1 text-texte-doux hover:text-erreur-texte hover:bg-surface-douce border-l border-bordure cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>

            {chartMode === 'range10y' && (
              <div className="text-[11px] text-texte-doux flex items-center gap-3 font-mono">
                <span>Barre : Min–Max 10A</span>
                <span>·</span>
                <span>Trait : Moyenne</span>
                <span>·</span>
                <span className="text-erreur-texte">Cercle rouge : Pic Crise</span>
              </div>
            )}
          </div>

          <div ref={containerRef} className="w-full overflow-hidden">
            <svg
              ref={svgRef}
              data-testid="d3-watchlist-volatility-svg"
              role="img"
              aria-label="Graphique D3 de volatilité historique des actifs en watchlist"
              className="w-full block select-none"
            />
          </div>

          <div className="overflow-x-auto border-t border-bordure pt-3">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-bordure text-texte-doux">
                  <th className="py-2 pr-3 font-medium">Actif suivi</th>
                  <th className="py-2 px-3 font-medium text-right">Prix ($ CAD)</th>
                  <th className="py-2 px-3 font-medium text-right">Nervosité 12M</th>
                  <th className="py-2 px-3 font-medium text-right">Pire Crise 10A</th>
                  <th className="py-2 px-3 font-medium text-right">Risque Mensuel</th>
                  <th className="py-2 px-3 font-medium text-right">Lien Portefeuille</th>
                  <th className="py-2 pl-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bordure font-mono tabular-nums">
                {volSummary.assets.map((item) => {
                  const isDiversifier = item.corrWithPortfolio < 0.55;
                  return (
                    <tr
                      key={item.asset.id}
                      className="hover:bg-surface/50 transition-colors"
                    >
                      <td className="py-2.5 pr-3 font-sans">
                        <div className="font-semibold text-texte">
                          {item.asset.ticker}{' '}
                          <span className="font-normal text-texte-doux">
                            · {item.asset.name.split(' (')[0]}
                          </span>
                        </div>
                        <div className="text-[11px] text-texte-doux">
                          {item.riskRegime}
                          {item.isHeld ? ' · ★ Détenu' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right text-texte">
                        {formatEur(item.spotPriceCad, 2)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-semibold ${
                          item.currentVol12mPct < 16
                            ? 'text-succes-texte'
                            : item.currentVol12mPct > 28
                              ? 'text-erreur-texte'
                              : 'text-texte'
                        }`}
                      >
                        {formatPct(item.currentVol12mPct, 1)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-erreur-texte">
                        {formatPct(item.maxVol12mPct, 1)}{' '}
                        <span className="text-texte-doux font-sans text-[11px]">
                          ({item.peakCrisisLabel})
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-texte">
                        -{formatPct(item.monthlyVar95Pct, 1)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right ${
                          isDiversifier ? 'text-succes-texte font-semibold' : 'text-texte'
                        }`}
                      >
                        {item.corrWithPortfolio >= 0 ? '+' : ''}
                        {item.corrWithPortfolio.toFixed(2).replace('.', ',')}
                        {isDiversifier ? ' (Protège)' : ''}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-sans">
                        <div className="inline-flex items-center gap-1.5">
                          {onInspectAsset && (
                            <button
                              type="button"
                              onClick={() => onInspectAsset(item.asset.id)}
                              className="min-h-11 min-w-11 px-2.5 py-1 text-[11px] font-medium text-texte hover:text-sur-accent bg-surface hover:bg-accent border border-bordure-champ rounded-lg cursor-pointer transition-colors"
                            >
                              Courbes
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onQuickInvestAsset(item.asset.id, 2500)}
                            className="min-h-11 min-w-11 px-2.5 py-1 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                          >
                            + 2 500 $
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ScrollReveal>
  );
};

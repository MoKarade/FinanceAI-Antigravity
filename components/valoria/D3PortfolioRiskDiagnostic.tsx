import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { AssetCategory } from '../../services/valoria/marketData';
import { RecommendedPortfolio, ScoredAsset } from '../../services/valoria/engine';
import {
  CorrelationMatrixResult,
  FrontierPoint,
  PortfolioRiskMetrics,
  computeCorrelationMatrix,
  computeEfficientFrontier,
} from '../../services/valoria/quantAnalytics';
import { formatPct, formatSignedPct } from '../../services/valoria/valoriaFormatters';

interface D3PortfolioRiskDiagnosticProps {
  heldAssetIds: string[];
  riskMetrics: PortfolioRiskMetrics;
  scoredAssets: ScoredAsset[];
  optimalPortfolio: RecommendedPortfolio;
  onNavigateToAdvice: () => void;
}

const CATEGORY_COLORS: Record<AssetCategory, string> = {
  actions: VALORIA_PALETTE.teal,
  obligations: VALORIA_PALETTE.sky,
  crypto: VALORIA_PALETTE.indigo,
  refuge: VALORIA_PALETTE.amberLight,
};

export const D3PortfolioRiskDiagnostic: React.FC<D3PortfolioRiskDiagnosticProps> = ({
  heldAssetIds,
  riskMetrics,
  scoredAssets,
  optimalPortfolio,
  onNavigateToAdvice,
}) => {
  const frontierSvgRef = useRef<SVGSVGElement | null>(null);
  const corrSvgRef = useRef<SVGSVGElement | null>(null);

  const [hoveredPoint, setHoveredPoint] = useState<FrontierPoint | null>(null);
  const [hoveredCorr, setHoveredCorr] = useState<{
    a: string;
    b: string;
    val: number;
  } | null>(null);

  const frontierData = useMemo(
    () =>
      computeEfficientFrontier({
        scoredAssets,
        currentMetrics: riskMetrics,
        optimalPortfolio,
      }),
    [scoredAssets, riskMetrics, optimalPortfolio]
  );

  const corrData: CorrelationMatrixResult = useMemo(
    () => computeCorrelationMatrix(heldAssetIds),
    [heldAssetIds]
  );

  // Render D3 Markowitz Efficient Frontier
  useEffect(() => {
    const svgEl = frontierSvgRef.current;
    if (!svgEl) return;

    const width = 560;
    const height = 270;
    const margin = { top: 18, right: 22, bottom: 34, left: 46 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const allPts = [
      ...frontierData.frontierCurve,
      ...frontierData.assetPoints,
      frontierData.currentPoint,
      frontierData.optimalPoint,
    ];

    const maxVol = Math.min(
      68,
      Math.max(38, d3.max(allPts, (d) => d.volatilityPct) ?? 40) * 1.06
    );
    const minRet = Math.min(0, d3.min(allPts, (d) => d.returnPct) ?? 0);
    const maxRet = Math.max(16, (d3.max(allPts, (d) => d.returnPct) ?? 15) * 1.12);

    const x = d3.scaleLinear().domain([0, maxVol]).range([0, innerW]);
    const y = d3.scaleLinear().domain([minRet, maxRet]).nice(5).range([innerH, 0]);

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Horizontal & vertical subtle gridlines
    const yTicks = y.ticks(5);
    g.append('g')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', (d) => (d === 0 ? VALORIA_PALETTE.strokeSlate : VALORIA_PALETTE.gridSlate))
      .attr('stroke-dasharray', (d) => (d === 0 ? '' : '3,3'));

    const xTicks = x.ticks(6);
    g.append('g')
      .selectAll('line')
      .data(xTicks)
      .join('line')
      .attr('x1', (d) => x(d))
      .attr('x2', (d) => x(d))
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.gridSlate)
      .attr('stroke-dasharray', '3,3');

    // Axes labels
    g.append('g')
      .selectAll('text')
      .data(yTicks)
      .join('text')
      .attr('x', -8)
      .attr('y', (d) => y(d) + 3.5)
      .attr('text-anchor', 'end')
      .attr('fill', VALORIA_PALETTE.textSlate)
      .attr('font-size', '10px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      // NOMBRE-NON-MONETAIRE : graduation rendement annualisé axe Y
      .text((d) => `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .selectAll('text')
      .data(xTicks)
      .join('text')
      .attr('x', (d) => x(d))
      .attr('y', 16)
      .attr('text-anchor', 'middle')
      .attr('fill', VALORIA_PALETTE.textSlate)
      .attr('font-size', '10px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      // NOMBRE-NON-MONETAIRE : graduation volatilité annualisée axe X
      .text((d) => `${d.toFixed(0)}%`);

    g.append('text')
      .attr('x', innerW)
      .attr('y', innerH + 29)
      .attr('text-anchor', 'end')
      .attr('fill', VALORIA_PALETTE.mutedSlate)
      .attr('font-size', '9.5px')
      .text('Volatilité annualisée (σ) →');

    // Efficient frontier curve + shaded dominated region
    const lineGen = d3
      .line<FrontierPoint>()
      .x((d) => x(Math.min(maxVol, d.volatilityPct)))
      .y((d) => y(d.returnPct))
      .curve(d3.curveMonotoneX);

    const areaGen = d3
      .area<FrontierPoint>()
      .x((d) => x(Math.min(maxVol, d.volatilityPct)))
      .y0(innerH)
      .y1((d) => y(d.returnPct))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(frontierData.frontierCurve)
      .attr('fill', VALORIA_PALETTE.teal)
      .attr('fill-opacity', 0.06)
      .attr('d', areaGen);

    g.append('path')
      .datum(frontierData.frontierCurve)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.teal)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5,3')
      .attr('d', lineGen);

    // Vector arrow from Current Portfolio -> Optimal Target
    const curX = x(Math.min(maxVol, frontierData.currentPoint.volatilityPct));
    const curY = y(frontierData.currentPoint.returnPct);
    const optX = x(Math.min(maxVol, frontierData.optimalPoint.volatilityPct));
    const optY = y(frontierData.optimalPoint.returnPct);

    if (Math.hypot(optX - curX, optY - curY) > 10) {
      g.append('line')
        .attr('x1', curX)
        .attr('y1', curY)
        .attr('x2', optX)
        .attr('y2', optY)
        .attr('stroke', VALORIA_PALETTE.amberLight)
        .attr('stroke-width', 1.4)
        .attr('stroke-dasharray', '3,2');
    }

    // Compute collision-free label placements for scatter dots
    const placedLabels: { px: number; py: number }[] = [];
    const labelOffsets = new Map<string, { dx: number; dy: number; anchor: string }>();
    const sortedAssets = [...frontierData.assetPoints].sort(
      (a, b) => b.returnPct - a.returnPct
    );
    for (const pt of sortedAssets) {
      const px = x(Math.min(maxVol, pt.volatilityPct));
      const py = y(pt.returnPct);
      const candidates = [
        { dx: 7, dy: 3, anchor: 'start' },
        { dx: 7, dy: -7, anchor: 'start' },
        { dx: 7, dy: 11, anchor: 'start' },
        { dx: -7, dy: 3, anchor: 'end' },
        { dx: -7, dy: -7, anchor: 'end' },
      ];
      let chosen = candidates[0];
      for (const cand of candidates) {
        const lx = px + (cand.anchor === 'end' ? -24 : 14);
        const ly = py + cand.dy;
        const collides = placedLabels.some(
          (p) => Math.abs(p.px - lx) < 32 && Math.abs(p.py - ly) < 10
        );
        if (!collides && px + (cand.anchor === 'start' ? 32 : 0) <= innerW + 14) {
          chosen = cand;
          break;
        }
      }
      placedLabels.push({
        px: px + (chosen.anchor === 'end' ? -24 : 14),
        py: py + chosen.dy,
      });
      labelOffsets.set(pt.id, chosen);
    }

    // Individual Asset Scatter Dots
    const assetNodes = g
      .append('g')
      .selectAll('g')
      .data(frontierData.assetPoints)
      .join('g')
      .attr(
        'transform',
        (d) => `translate(${x(Math.min(maxVol, d.volatilityPct))},${y(d.returnPct)})`
      )
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => setHoveredPoint(d))
      .on('mouseleave', () => setHoveredPoint(null));

    assetNodes
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', (d) =>
        d.category ? CATEGORY_COLORS[d.category] : VALORIA_PALETTE.textSlate
      )
      .attr('fill-opacity', 0.88)
      .attr('stroke', VALORIA_PALETTE.bgNavy)
      .attr('stroke-width', 1.2);

    assetNodes
      .append('text')
      .attr('x', (d) => labelOffsets.get(d.id)?.dx ?? 6.5)
      .attr('y', (d) => labelOffsets.get(d.id)?.dy ?? 3)
      .attr('text-anchor', (d) => labelOffsets.get(d.id)?.anchor ?? 'start')
      .attr('fill', VALORIA_PALETTE.textSlateLight)
      .attr('font-size', '9px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .text((d) => d.label);

    // Current Portfolio Marker (amber ring)
    const curG = g
      .append('g')
      .attr('transform', `translate(${curX},${curY})`)
      .style('cursor', 'pointer')
      .on('mouseenter', () => setHoveredPoint(frontierData.currentPoint))
      .on('mouseleave', () => setHoveredPoint(null));

    curG
      .append('circle')
      .attr('r', 8)
      .attr('fill', VALORIA_PALETTE.amber)
      .attr('fill-opacity', 0.22)
      .attr('stroke', VALORIA_PALETTE.amberLight)
      .attr('stroke-width', 2);

    curG.append('circle').attr('r', 3.5).attr('fill', VALORIA_PALETTE.amberLight);

    // Optimal Target Marker (emerald/teal diamond)
    const optG = g
      .append('g')
      .attr('transform', `translate(${optX},${optY})`)
      .style('cursor', 'pointer')
      .on('mouseenter', () => setHoveredPoint(frontierData.optimalPoint))
      .on('mouseleave', () => setHoveredPoint(null));

    optG
      .append('path')
      .attr('d', d3.symbol().type(d3.symbolDiamond).size(95)())
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('stroke', VALORIA_PALETTE.emeraldSoft)
      .attr('stroke-width', 1.3);
  }, [frontierData]);

  // Render D3 Empirical Correlation Heatmap
  useEffect(() => {
    const svgEl = corrSvgRef.current;
    if (!svgEl) return;

    const n = corrData.tickers.length;
    const size = 270;
    const margin = { top: 34, right: 10, bottom: 10, left: 48 };
    const innerW = size - margin.left - margin.right;
    const innerH = size - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const g = svg
      .attr('viewBox', `0 0 ${size} ${size}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const bandX = d3
      .scaleBand<number>()
      .domain(d3.range(n))
      .range([0, innerW])
      .padding(0.08);
    const bandY = d3
      .scaleBand<number>()
      .domain(d3.range(n))
      .range([0, innerH])
      .padding(0.08);

    const colorScale = (corr: number) => {
      if (corr >= 0.99) return VALORIA_PALETTE.gridSlate;
      if (corr >= 0.65) return 'rgba(244, 63, 94, 0.48)'; // High co-movement risk
      if (corr >= 0.3) return 'rgba(251, 191, 36, 0.28)'; // Moderate positive
      if (corr >= -0.1) return 'rgba(56, 189, 248, 0.22)'; // Uncorrelated diversifier
      return 'rgba(16, 185, 129, 0.42)'; // Negative correlation hedge
    };

    // Column labels
    g.append('g')
      .selectAll('text')
      .data(corrData.tickers)
      .join('text')
      .attr('x', (_d, i) => (bandX(i) ?? 0) + bandX.bandwidth() / 2)
      .attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', VALORIA_PALETTE.textSlateLight)
      .attr('font-size', '9.5px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .text((d) => d);

    // Row labels
    g.append('g')
      .selectAll('text')
      .data(corrData.tickers)
      .join('text')
      .attr('x', -6)
      .attr('y', (_d, i) => (bandY(i) ?? 0) + bandY.bandwidth() / 2 + 3.5)
      .attr('text-anchor', 'end')
      .attr('fill', VALORIA_PALETTE.textSlateLight)
      .attr('font-size', '9.5px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .text((d) => d);

    const cells: { i: number; j: number; val: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        cells.push({ i, j, val: corrData.matrix[i][j] });
      }
    }

    const cellGroups = g
      .append('g')
      .selectAll('g')
      .data(cells)
      .join('g')
      .attr(
        'transform',
        (c) => `translate(${bandX(c.j) ?? 0},${bandY(c.i) ?? 0})`
      )
      .style('cursor', 'pointer')
      .on('mouseenter', (_e, c) =>
        setHoveredCorr({
          a: corrData.names[c.i],
          b: corrData.names[c.j],
          val: c.val,
        })
      )
      .on('mouseleave', () => setHoveredCorr(null));

    cellGroups
      .append('rect')
      .attr('width', bandX.bandwidth())
      .attr('height', bandY.bandwidth())
      .attr('rx', 3)
      .attr('fill', (c) => colorScale(c.val))
      .attr('stroke', VALORIA_PALETTE.bgNavy)
      .attr('stroke-width', 1);

    cellGroups
      .append('text')
      .attr('x', bandX.bandwidth() / 2)
      .attr('y', bandY.bandwidth() / 2 + 3.5)
      .attr('text-anchor', 'middle')
      .attr('fill', (c) => (c.i === c.j ? VALORIA_PALETTE.mutedSlate : VALORIA_PALETTE.surfaceLight))
      .attr('font-size', '9px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .text((c) => (c.i === c.j ? '1,00' : c.val.toFixed(2).replace('.', ',')));
  }, [corrData]);

  const activePoint = hoveredPoint ?? frontierData.currentPoint;

  return (
    <section
      aria-label="Diagnostic quantitatif Markowitz et matrice de corrélation"
      className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
    >
      {/* Left: Markowitz Efficient Frontier */}
      <div className="lg:col-span-7 bg-surface border border-bordure rounded-lg p-5 flex flex-col justify-between space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-texte">
              Frontière Efficiente de Markowitz (D3.js)
            </h2>
            <p className="text-xs text-texte-doux">
              Couple Rendement / Volatilité (σ) · Écart d’efficience de votre portefeuille
            </p>
          </div>

          <button
            type="button"
            onClick={onNavigateToAdvice}
            className="min-h-11 px-3 py-1.5 text-xs font-medium text-succes-texte bg-fond hover:bg-surface-douce border border-bordure-champ rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Optimiser vers la cible →
          </button>
        </div>

        {/* Live Telemetry Readout Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-fond/90 border border-bordure rounded-sm text-xs font-mono tabular-nums">
          <span className="font-sans font-medium text-texte truncate max-w-[200px]">
            {activePoint.label}
          </span>
          <div className="flex items-center gap-4">
            <span className="text-texte-doux">
              Rdt{' '}
              <strong className="text-succes-texte">
                {formatSignedPct(activePoint.returnPct, 1)}/an
              </strong>
            </span>
            <span className="text-texte-doux">
              Vol <strong className="text-texte">{formatPct(activePoint.volatilityPct, 1)}</strong>
            </span>
            <span className="text-texte-doux">
              Sharpe{' '}
              <strong className="text-succes-texte">
                {activePoint.sharpe.toFixed(2).replace('.', ',')}
              </strong>
            </span>
          </div>
        </div>

        <div className="w-full">
          <svg
            ref={frontierSvgRef}
            className="w-full h-auto"
            role="img"
            aria-label="Graphique D3 de la frontière efficiente de Markowitz"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-bordure text-[11px] text-texte-doux">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-alerte-texte bg-alerte-fond" />
              Votre portefeuille ({riskMetrics.sharpeRatio.toFixed(2).replace('.', ',')})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rotate-45 bg-accent inline-block" />
              Cible optimale ({optimalPortfolio.sharpeRatio.toFixed(2).replace('.', ',')})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 bg-accent" />
              Frontière efficiente
            </span>
          </div>
          <span className="font-mono tabular-nums text-texte">
            Ratio diversification : {riskMetrics.diversificationRatio.toFixed(2).replace('.', ',')}x
          </span>
        </div>
      </div>

      {/* Right: Empirical Pearson Correlation Matrix */}
      <div className="lg:col-span-5 bg-surface border border-bordure rounded-lg p-5 flex flex-col justify-between space-y-4">
        <div>
          <h2 className="text-base font-semibold text-texte">
            Matrice de Corrélation de Pearson (141M)
          </h2>
          <p className="text-xs text-texte-doux">
            Co-mouvements empiriques 2015–2026 · Vert/Bleu = décorrélation protectrice
          </p>
        </div>

        <div className="px-3 py-2 bg-fond/90 border border-bordure rounded-sm text-xs flex items-center justify-between gap-2 font-mono tabular-nums">
          {hoveredCorr ? (
            <>
              <span className="font-sans text-texte truncate">
                {hoveredCorr.a.split(' (')[0]} × {hoveredCorr.b.split(' (')[0]}
              </span>
              <span
                className={
                  hoveredCorr.val >= 0.65
                    ? 'text-erreur-texte font-semibold shrink-0'
                    : hoveredCorr.val <= 0.15
                      ? 'text-succes-texte font-semibold shrink-0'
                      : 'text-alerte-texte font-semibold shrink-0'
                }
              >
                ρ = {hoveredCorr.val >= 0 ? '+' : ''}
                {hoveredCorr.val.toFixed(2).replace('.', ',')}
              </span>
            </>
          ) : (
            <>
              <span className="font-sans text-texte-doux">
                Corrélation au MSCI World (R²)
              </span>
              <span className="text-texte font-semibold">
                {/* NOMBRE-NON-MONETAIRE : indicateurs statistiques de corrélation au MSCI World */}
                β = {riskMetrics.betaVsWorld.toFixed(2).replace('.', ',')} · R² ={' '}
                {(riskMetrics.rSquaredVsWorld * 100).toFixed(0)} %
              </span>
            </>
          )}
        </div>

        <div className="w-full max-w-[300px] mx-auto">
          <svg
            ref={corrSvgRef}
            className="w-full h-auto"
            role="img"
            aria-label="Matrice de corrélation empirique de Pearson"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-bordure text-[11px] text-texte-doux">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-succes-fond" />
            ρ &lt; 0 Couverture
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-surface-douce" />
            0 Neutre
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-erreur-fond" />
            ρ &gt; 0,65 Doublon
          </span>
        </div>
      </div>
    </section>
  );
};

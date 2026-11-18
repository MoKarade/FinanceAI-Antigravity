import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { RefreshCw } from 'lucide-react';
import { PortfolioLot } from '../../services/valoria/engine';
import {
  MonteCarlo10kYearPoint,
  runPortfolioMonteCarlo10k,
} from '../../services/valoria/monteCarlo10k';
import {
  formatCompactEur,
  formatEur,
  formatPct,
} from '../../services/valoria/valoriaFormatters';
import { PrivateAmount } from '../ui/PrivateAmount';

interface D3MonteCarloModuleProps {
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
}

export const D3MonteCarloModule: React.FC<D3MonteCarloModuleProps> = ({
  lots,
  livePrices,
}) => {
  const [horizonYears, setHorizonYears] = useState<number>(15);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(300);
  const [seed, setSeed] = useState<number>(20261112);
  const [hoveredYear, setHoveredYear] = useState<MonteCarlo10kYearPoint | null>(null);

  const fanSvgRef = useRef<SVGSVGElement | null>(null);
  const histSvgRef = useRef<SVGSVGElement | null>(null);

  const mcResult = useMemo(
    () =>
      runPortfolioMonteCarlo10k({
        lots,
        livePrices,
        monthlyContribution,
        horizonYears,
        scenarioCount: 10000,
        seed,
      }),
    [lots, livePrices, monthlyContribution, horizonYears, seed]
  );

  const finalPoint =
    mcResult.yearlyQuantiles[mcResult.yearlyQuantiles.length - 1];
  const inspectedPoint = hoveredYear ?? finalPoint;

  // Render D3 Stochastic Cone + 24 Sample Trajectories (Dark Mode)
  useEffect(() => {
    const svgEl = fanSvgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const data = mcResult.yearlyQuantiles;
    if (data.length < 2) return;

    const width = 680;
    const height = 270;
    const margin = { top: 18, right: 22, bottom: 32, left: 62 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([data[0].calendarYear, data[data.length - 1].calendarYear])
      .range([0, innerW]);

    const maxSample = d3.max(mcResult.samplePaths.flat()) ?? 0;
    const yMax = Math.max(
      d3.max(data, (d) => d.p90) ?? 1000,
      Math.min(maxSample, (d3.max(data, (d) => d.p95) ?? 1000) * 1.05)
    );

    const yScale = d3
      .scaleLinear()
      .domain([0, yMax * 1.06])
      .nice(5)
      .range([innerH, 0]);

    // Dark-mode gridlines
    const yTicks = yScale.ticks(5);
    g.append('g')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', VALORIA_PALETTE.gridSlate)
      .attr('stroke-dasharray', (d) => (d === 0 ? '' : '3 3'));

    // Y Axis
    const yAxis = d3
      .axisLeft(yScale)
      .ticks(5)
      .tickSize(0)
      .tickPadding(10)
      .tickFormat((v) => formatCompactEur(Number(v)));

    const yG = g.append('g').call(yAxis);
    yG.select('.domain').remove();
    yG.selectAll('text')
      .attr('fill', VALORIA_PALETTE.textSlate)
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', '10.5px');

    // X Axis
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(Math.min(7, data.length - 1))
      .tickSize(0)
      .tickPadding(11)
      .tickFormat((v) => String(Math.round(Number(v))));

    const xG = g
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis);
    xG.select('.domain').attr('stroke', VALORIA_PALETTE.axisSlate);
    xG.selectAll('text')
      .attr('fill', VALORIA_PALETTE.textSlate)
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', '10.5px');

    // Outer P10 - P90 Confidence Band
    const outerBand = d3
      .area<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y0((d) => yScale(Math.min(yScale.domain()[1], d.p10)))
      .y1((d) => yScale(Math.min(yScale.domain()[1], d.p90)))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', VALORIA_PALETTE.teal)
      .attr('fill-opacity', 0.12)
      .attr('d', outerBand);

    // Inner P25 - P75 Interquartile Band
    const innerBand = d3
      .area<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y0((d) => yScale(Math.min(yScale.domain()[1], d.p25)))
      .y1((d) => yScale(Math.min(yScale.domain()[1], d.p75)))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', VALORIA_PALETTE.teal)
      .attr('fill-opacity', 0.18)
      .attr('d', innerBand);

    // 24 Individual Sample Stochastic Paths
    const sampleLine = d3
      .line<number>()
      .x((_, idx) => xScale(data[0].calendarYear + idx))
      .y((val) => yScale(Math.min(yScale.domain()[1], val)))
      .curve(d3.curveMonotoneX);

    g.append('g')
      .selectAll('path')
      .data(mcResult.samplePaths)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.tealLight)
      .attr('stroke-width', 0.9)
      .attr('stroke-opacity', 0.22)
      .attr('d', (pathArr) => sampleLine(pathArr));

    // Cumulative Invested Capital Line
    const investedLine = d3
      .line<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y((d) => yScale(d.totalInvested))
      .curve(d3.curveLinear);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.textSlate)
      .attr('stroke-width', 1.6)
      .attr('stroke-dasharray', '4 3')
      .attr('d', investedLine);

    // P10 Lower Decile Line
    const p10Line = d3
      .line<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y((d) => yScale(d.p10))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.redLight)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3')
      .attr('d', p10Line);

    // P50 Median Line
    const p50Line = d3
      .line<MonteCarlo10kYearPoint>()
      .x((d) => xScale(d.calendarYear))
      .y((d) => yScale(d.p50))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', VALORIA_PALETTE.teal)
      .attr('stroke-width', 2.6)
      .attr('d', p50Line);

    // Interactive Crosshair
    const focus = g.append('g').style('display', 'none');
    const vLine = focus
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.lineSlate)
      .attr('stroke-opacity', 0.3);
    const dot50 = focus
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', VALORIA_PALETTE.teal)
      .attr('stroke', VALORIA_PALETTE.bgNavy)
      .attr('stroke-width', 1.5);

    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('pointerenter', () => focus.style('display', null))
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
        focus.style('display', 'none');
        setHoveredYear(null);
      });
  }, [mcResult]);

  // Render D3 Terminal Wealth Histogram across the 10,000 scenarios (Dark Mode)
  useEffect(() => {
    const svgEl = histSvgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const bins = mcResult.finalDistributionBins;
    if (bins.length === 0) return;

    const width = 360;
    const height = 180;
    const margin = { top: 14, right: 12, bottom: 32, left: 38 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleBand<number>()
      .domain(bins.map((_, i) => i))
      .range([0, innerW])
      .padding(0.18);

    const maxShare = d3.max(bins, (b) => b.sharePct) ?? 20;
    const yScale = d3
      .scaleLinear()
      .domain([0, maxShare * 1.15])
      .range([innerH, 0]);

    const investedFinal = finalPoint.totalInvested;

    g.selectAll('rect')
      .data(bins)
      .join('rect')
      .attr('x', (_, i) => xScale(i) ?? 0)
      .attr('y', (d) => yScale(d.sharePct))
      .attr('width', xScale.bandwidth())
      .attr('height', (d) => Math.max(1, innerH - yScale(d.sharePct)))
      .attr('rx', 2)
      .attr('fill', (d) =>
        d.maxEur < investedFinal ? VALORIA_PALETTE.redLight : VALORIA_PALETTE.teal
      )
      .attr('fill-opacity', 0.85);

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(3)
      .tickSize(0)
      .tickPadding(6)
      .tickFormat((v) => `${Math.round(Number(v))}%`);
    const yG = g.append('g').call(yAxis);
    yG.select('.domain').remove();
    yG.selectAll('text')
      .attr('fill', VALORIA_PALETTE.textSlate)
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', '9.5px');

    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', innerH)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.axisSlate);

    g.append('text')
      .attr('x', 0)
      .attr('y', innerH + 18)
      .attr('fill', VALORIA_PALETTE.textSlate)
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', '9.5px')
      .text(formatCompactEur(bins[0].minEur));

    g.append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 18)
      .attr('text-anchor', 'middle')
      .attr('fill', VALORIA_PALETTE.teal)
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', '9.5px')
      .text(`Méd. ${formatCompactEur(finalPoint.p50)}`);

    g.append('text')
      .attr('x', innerW)
      .attr('y', innerH + 18)
      .attr('text-anchor', 'end')
      .attr('fill', VALORIA_PALETTE.textSlate)
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', '9.5px')
      .text(formatCompactEur(bins[bins.length - 1].maxEur));
  }, [mcResult, finalPoint]);

  return (
    <section
      aria-label="Projection Monte Carlo 10 000 scénarios"
      className="bg-surface border border-bordure rounded-lg p-6 space-y-6"
    >
      {/* Header & Resample CTA */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-bordure">
        <div>
          <p className="text-xs font-medium text-succes-texte mb-0.5">
            Simulation stochastique sur vos actifs sélectionnés · 10 000 trajectoires indépendantes
          </p>
          <h2 className="text-lg font-bold text-texte">
            Projection Monte Carlo (10 000 Scénarios — Volatilité Historique)
          </h2>
          <p className="text-xs text-texte-doux mt-0.5">
            Calibré sur la volatilité historique annualisée de votre portefeuille (
            <span className="font-mono tabular-nums font-medium text-texte">
              {formatPct(mcResult.historicalStats.annualizedVolatilityPct, 2)}
            </span>
            {/* NOMBRE-NON-MONETAIRE : taille de l'échantillon historique mensuel */}
            ) et {mcResult.historicalStats.observationsCount} mois d’historique de corrélations.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setSeed((prev) => prev + 7919);
            setHoveredYear(null);
          }}
          className="min-h-11 min-w-11 inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-texte bg-surface-douce hover:bg-surface-douce border border-bordure-champ rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Relancer 10 000 scénarios</span>
        </button>
      </div>

      {/* Controls: Horizon & Monthly Contribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label
            htmlFor="mc10k-horizon"
            className="flex justify-between text-xs font-medium text-texte mb-1.5"
          >
            <span>Horizon de projection future</span>
            <span className="font-mono tabular-nums font-semibold text-texte">
              {/* NOMBRE-NON-MONETAIRE : horizon temporel du curseur */}
              {horizonYears} ans (échéance {2026 + horizonYears})
            </span>
          </label>
          <input
            id="mc10k-horizon"
            type="range"
            min="3"
            max="25"
            step="1"
            value={horizonYears}
            onChange={(e) => {
              setHorizonYears(Number(e.target.value));
              setHoveredYear(null);
            }}
            className="w-full"
          />
        </div>

        <div>
          <label
            htmlFor="mc10k-monthly"
            className="flex justify-between text-xs font-medium text-texte mb-1.5"
          >
            <span>Versement mensuel programmé ajouté</span>
            <span className="font-mono tabular-nums font-semibold text-texte">
              {formatEur(monthlyContribution, 0)} / mois
            </span>
          </label>
          <input
            id="mc10k-monthly"
            type="range"
            min="0"
            max="2500"
            step="50"
            value={monthlyContribution}
            onChange={(e) => {
              setMonthlyContribution(Number(e.target.value));
              setHoveredYear(null);
            }}
            className="w-full"
          />
        </div>
      </div>

      {/* 4 Key Probabilistic Outcomes Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-fond/80 border border-bordure rounded-md font-mono tabular-nums">
        <div>
          <div className="text-xs font-sans text-texte-doux">
            Scénario défavorable (P10)
          </div>
          <div
            data-testid="mc10k-p10"
            className="text-lg font-semibold text-texte mt-0.5"
          >
            {formatEur(inspectedPoint.p10, 0)}
          </div>
          <div className="text-[11px] font-sans text-texte-doux">
            90 % des tirages font mieux ({inspectedPoint.calendarYear})
          </div>
        </div>

        <div>
          <div className="text-xs font-sans text-texte-doux">
            Scénario médian (P50)
          </div>
          <div
            data-testid="mc10k-p50"
            className="text-lg font-semibold text-succes-texte mt-0.5"
          >
            {formatEur(inspectedPoint.p50, 0)}
          </div>
          <div className="text-[11px] font-sans text-texte-doux">
            Capital versé : {formatEur(inspectedPoint.totalInvested, 0)}
          </div>
        </div>

        <div>
          <div className="text-xs font-sans text-texte-doux">
            Scénario porteur (P90)
          </div>
          <div
            data-testid="mc10k-p90"
            className="text-lg font-semibold text-succes-texte mt-0.5"
          >
            {formatEur(inspectedPoint.p90, 0)}
          </div>
          <div className="text-[11px] font-sans text-texte-doux">
            Moyenne : {formatEur(inspectedPoint.mean, 0)}
          </div>
        </div>

        <div>
          <div className="text-xs font-sans text-texte-doux">
            Probabilité de plus-value
          </div>
          <div className="text-lg font-semibold text-texte mt-0.5">
            {formatPct(mcResult.probabilityOfGainPct, 1)}
          </div>
          <div className="text-[11px] font-sans text-texte-doux">
            Doubler la mise : {formatPct(mcResult.probabilityOfDoublingInvestedPct, 1)}
          </div>
        </div>
      </div>

      {/* Main 2-Column Visual Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-2">
          <div className="w-full overflow-x-auto">
            <svg
              ref={fanSvgRef}
              viewBox="0 0 680 270"
              data-testid="d3-montecarlo-fan-svg"
              className="w-full h-auto select-none"
              role="img"
              aria-label="Cône de projection Monte Carlo D3 sur 10 000 scénarios"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-texte-doux pt-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 bg-accent inline-block" />
              Médiane (P50)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-2.5 bg-succes-fond inline-block rounded-xs" />
              Quartiles (P25–P75) &amp; Déciles (P10–P90)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 bg-erreur-texte inline-block" />
              Seuil prudent P10
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 border-t border-dashed border-bordure-champ inline-block" />
              Capital versé
            </span>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-4 lg:border-l lg:border-bordure lg:pl-6">
          <div>
            <h3 className="text-xs font-semibold text-texte mb-1">
              {/* NOMBRE-NON-MONETAIRE : horizon de distribution sélectionné */}
              Distribution à {horizonYears} ans (10 000 tirages)
            </h3>
            <p className="text-[11px] text-texte-doux mb-2">
              Répartition finale du patrimoine (rouge{'\u00A0'}: inférieur au versé, vert{'\u00A0'}: en gain)
            </p>
            <svg
              ref={histSvgRef}
              viewBox="0 0 360 180"
              className="w-full h-auto select-none"
              role="img"
              aria-label="Histogramme D3 des 10 000 valeurs finales simulées"
            />
          </div>

          {mcResult.historicalStats.assetVolatilities.length > 0 && (
            <div className="pt-3 border-t border-bordure space-y-2">
              <div className="text-xs font-semibold text-texte">
                Volatilité historique des actifs détenus
              </div>
              <div className="space-y-1.5">
                {mcResult.historicalStats.assetVolatilities.slice(0, 5).map((item) => (
                  <div
                    key={item.assetId}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-texte-doux truncate max-w-[180px]">
                      {item.name}
                    </span>
                    <span className="font-mono tabular-nums text-texte whitespace-nowrap">
                      <PrivateAmount>{item.weightPct.toFixed(0)} %</PrivateAmount> · Vol.{' '}
                      {formatPct(item.historicalVolatilityPct, 1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Crosshair,
  MessageSquare,
  SlidersHorizontal,
} from 'lucide-react';
import type { HeldLineDiagnostic } from '../../services/valoria/proAnalystAdvisor';
import {
  type PortfolioDonutSlice,
  type PortfolioDonutSummary,
  type PortfolioSliceId,
  classifyAssetAllocationSlice,
  filterHoldingsBySlice,
} from '../../services/valoria/portfolioOrbitalIntelligence';
import { D3PriceSparkline30d } from './D3PriceSparkline30d';
import {
  formatCompactEur,
  formatEur,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';
import { PrivateAmount } from '../ui/PrivateAmount';
import { useFinanceStore } from '../../store/useFinanceStore';

interface D3PortfolioOrbitalDonutHubProps {
  donutSummary: PortfolioDonutSummary;
  heldLines: HeldLineDiagnostic[];
  selectedSliceId: PortfolioSliceId | null;
  onSelectSliceId: (sliceId: PortfolioSliceId | null) => void;
  focusedAssetId?: string | null;
  onFocusAsset?: (assetId: string) => void;
  onInspectAsset: (assetId: string) => void;
  onOpenAssetInDialogue: (assetId: string) => void;
  onOpenControlHub: () => void;
  onOpenDeepAiNewsLab: (focusSliceId: PortfolioSliceId | null) => void;
}

interface ComputedArcDatum {
  slice: PortfolioDonutSlice;
  mainPath: string;
  haloPath: string;
  haloColor: string;
  tickPoints: string;
  labelX: number;
  labelY: number;
}

export const D3PortfolioOrbitalDonutHub: React.FC<
  D3PortfolioOrbitalDonutHubProps
> = ({
  donutSummary,
  heldLines,
  selectedSliceId,
  onSelectSliceId,
  focusedAssetId = null,
  onFocusAsset,
  onInspectAsset,
  onOpenAssetInDialogue,
  onOpenControlHub,
  onOpenDeepAiNewsLab,
}) => {
  const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
  const [hoveredSliceId, setHoveredSliceId] = useState<PortfolioSliceId | null>(
    null
  );
  const [holdingsFilterMode, setHoldingsFilterMode] = useState<
    'all' | 'keep' | 'alert'
  >('all');

  const activeFocusId = hoveredSliceId ?? selectedSliceId;
  const activeSlice = useMemo(
    () =>
      activeFocusId
        ? donutSummary.slices.find((s) => s.id === activeFocusId) ?? null
        : null,
    [activeFocusId, donutSummary.slices]
  );

  // Selected slice used to filter left-hand holdings and lock right-hand diagnosis
  const lockedSlice = useMemo(
    () =>
      selectedSliceId
        ? donutSummary.slices.find((s) => s.id === selectedSliceId) ?? null
        : null,
    [selectedSliceId, donutSummary.slices]
  );

  const diagnosticSlice = activeSlice ?? lockedSlice;

  // D3 Donut + Outer AI/News Health Halo computation
  const computedArcs = useMemo<ComputedArcDatum[]>(() => {
    if (donutSummary.slices.length === 0) return [];

    const pieGen = d3
      .pie<PortfolioDonutSlice>()
      .value((d) => Math.max(1, d.valueCad))
      .sort(null)
      .padAngle(donutSummary.slices.length > 1 ? 0.026 : 0);

    const pieArcs = pieGen(donutSummary.slices);

    return pieArcs.map((arcDatum) => {
      const isFocused = activeFocusId === arcDatum.data.id;
      const mainArcGen = d3
        .arc<d3.PieArcDatum<PortfolioDonutSlice>>()
        .innerRadius(isFocused ? 75 : 78)
        .outerRadius(isFocused ? 116 : 110)
        .cornerRadius(5);

      const haloArcGen = d3
        .arc<d3.PieArcDatum<PortfolioDonutSlice>>()
        .innerRadius(isFocused ? 120 : 115)
        .outerRadius(isFocused ? 126 : 120)
        .cornerRadius(2.5);

      const midAngle = (arcDatum.startAngle + arcDatum.endAngle) / 2 - Math.PI / 2;
      const rInnerTick = isFocused ? 128 : 123;
      const rOuterTick = isFocused ? 136 : 130;
      const x1 = Math.cos(midAngle) * rInnerTick;
      const y1 = Math.sin(midAngle) * rInnerTick;
      const x2 = Math.cos(midAngle) * rOuterTick;
      const y2 = Math.sin(midAngle) * rOuterTick;

      const labelR = 91;
      const labelX = Math.cos(midAngle) * labelR;
      const labelY = Math.sin(midAngle) * labelR;

      const haloColor =
        arcDatum.data.aiTone === 'positive'
          ? VALORIA_PALETTE.emerald
          : arcDatum.data.aiTone === 'negative'
            ? VALORIA_PALETTE.rose
            : VALORIA_PALETTE.mutedZinc;

      return {
        slice: arcDatum.data,
        mainPath: mainArcGen(arcDatum) ?? '',
        haloPath: haloArcGen(arcDatum) ?? '',
        haloColor,
        tickPoints: `${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`,
        labelX,
        labelY,
      };
    });
  }, [donutSummary.slices, activeFocusId]);

  const sliceFilteredHoldings = useMemo(() => {
    const bySlice = filterHoldingsBySlice(heldLines, selectedSliceId);
    if (holdingsFilterMode === 'keep') {
      return bySlice.filter(
        (h) => h.verdict === 'CONSERVER' || h.verdict === 'RENFORCER'
      );
    }
    if (holdingsFilterMode === 'alert') {
      return bySlice.filter(
        (h) => h.verdict === 'VENDRE' || h.verdict === 'ALLÉGER'
      );
    }
    return bySlice;
  }, [heldLines, selectedSliceId, holdingsFilterMode]);

  const alertCountInSlice = useMemo(
    () =>
      filterHoldingsBySlice(heldLines, selectedSliceId).filter(
        (h) => h.verdict === 'VENDRE' || h.verdict === 'ALLÉGER'
      ).length,
    [heldLines, selectedSliceId]
  );

  const keepCountInSlice = useMemo(
    () =>
      filterHoldingsBySlice(heldLines, selectedSliceId).filter(
        (h) => h.verdict === 'CONSERVER' || h.verdict === 'RENFORCER'
      ).length,
    [heldLines, selectedSliceId]
  );

  const centerTitle = activeSlice
    ? activeSlice.shortLabel
    : 'Ce que j’ai ($ CAD)';
  const centerValueCad = activeSlice
    ? activeSlice.valueCad
    : donutSummary.totalValueCad;
  const centerPnlPct = activeSlice
    ? activeSlice.pnlPct
    : donutSummary.totalPnlPct;
  const centerWeightLabel = activeSlice
    // NOMBRE-NON-MONETAIRE : masquage explicite ci-dessous en Mode Discret
    ? isPrivacyMode ? '•••' : `${activeSlice.weightPct.toFixed(0)} % du total`
    : '100 %';
  const centerAiScore = activeSlice
    ? activeSlice.aiScore100
    : donutSummary.weightedAiScore100;
  const centerNewsScore = activeSlice
    ? activeSlice.newsImpulseScore
    : donutSummary.weightedNewsImpulse;

  // Values for Right Satellite (Sector or Global AI + News Diagnostic)
  const diagLabel = diagnosticSlice
    ? diagnosticSlice.label
    : donutSummary.topRiskSlice
      ? `Vue Globale · Focus ${donutSummary.topRiskSlice.shortLabel}`
      : 'Diagnostic Global IA & Actus';
  const diagAiScore = diagnosticSlice
    ? diagnosticSlice.aiScore100
    : donutSummary.weightedAiScore100;
  const diagVerdict = diagnosticSlice
    ? diagnosticSlice.aiVerdictLabel
    : alertCountInSlice > 0
      ? `${alertCountInSlice} ligne(s) à rééquilibrer selon les 7 agents`
      : 'Portefeuille bien équilibré selon les 7 agents';
  const diagCapitalWeightPct = diagnosticSlice
    ? diagnosticSlice.weightPct
    : donutSummary.topRiskSlice?.weightPct ?? 100;
  const diagEulerRiskPct = diagnosticSlice
    ? diagnosticSlice.eulerRiskSharePct
    : donutSummary.topRiskSlice?.eulerRiskSharePct ?? 100;
  const diagRiskGapPct = diagnosticSlice
    ? diagnosticSlice.riskGapPct
    : donutSummary.topRiskSlice?.riskGapPct ?? 0;
  const diagCatalystCode = diagnosticSlice
    ? diagnosticSlice.dominantCatalystCode
    : donutSummary.topRiskSlice?.dominantCatalystCode ?? 'SEC / SEDAR+ / BoC';
  const diagCatalystHeadline = diagnosticSlice
    ? diagnosticSlice.dominantCatalystHeadline
    : donutSummary.topRiskSlice?.dominantCatalystHeadline ??
      'Flux réglementaires et macroéconomiques synchronisés.';
  const diagNewsScore = diagnosticSlice
    ? diagnosticSlice.newsImpulseScore
    : donutSummary.weightedNewsImpulse;
  const diagRecommendedDeltaCad = diagnosticSlice
    ? diagnosticSlice.recommendedDeltaCad
    : 0;

  return (
    <section
      aria-label="Architecture orbitale de mon portefeuille par type d'actif"
      className="space-y-4"
    >
      {/* Top Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-bold text-texte">
            Cœur du Portefeuille &amp; Satellites IA / Actus
          </h2>
          <p className="text-xs text-texte-doux">
            Cliquez un secteur du graphique central pour filtrer vos positions à
            gauche et cibler l’analyse IA &amp; actus à droite.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenControlHub}
          className="min-w-11 min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="sm:hidden">Modifier / Importer</span>
          <span className="hidden sm:inline">Ajouter, modifier ou importer</span>
        </button>
      </div>

      {/* 3-ZONE ORBITAL GRID: Left Holdings · CENTER D3 DONUT · Right AI & News Satellite */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-stretch">
        {/* =================================================================== */}
        {/* CENTER CORE (Order 1 on Mobile, Order 2 Center on Desktop)          */}
        {/* =================================================================== */}
        <div className="order-1 lg:order-2 lg:col-span-4 bg-surface/25 border border-bordure rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold text-texte">
              Répartition par Type d’Actif
            </span>
            {selectedSliceId ? (
              <button
                type="button"
                onClick={() => onSelectSliceId(null)}
                className="min-h-11 font-mono text-[11px] text-succes-texte hover:text-succes-texte underline whitespace-nowrap cursor-pointer"
              >
                Tout afficher (100 %)
              </button>
            ) : (
              <span className="font-mono tabular-nums text-[11px] text-texte-doux">
                Halo = Santé IA
              </span>
            )}
          </div>

          {/* Central D3 Donut SVG */}
          <div className="relative flex items-center justify-center my-auto">
            <svg
              data-testid="d3-portfolio-donut-svg"
              viewBox="-150 -150 300 300"
              role="img"
              aria-label="Graphique en secteurs D3 de la répartition du portefeuille par type d'actif en dollars canadiens"
              className="w-full max-w-[268px] sm:max-w-[284px] h-auto select-none overflow-visible"
            >
              {/* Subtle orbital guide ring-1 */}
              <circle
                cx="0"
                cy="0"
                r="131"
                fill="none"
                stroke={VALORIA_PALETTE.gridZinc}
                strokeWidth="0.75"
                strokeDasharray="2 4"
              />
              <circle
                cx="0"
                cy="0"
                r="69"
                fill={VALORIA_PALETTE.bgDeep}
                stroke={VALORIA_PALETTE.gridZinc}
                strokeWidth="1"
              />

              {computedArcs.map((arc) => {
                const isSelected = selectedSliceId === arc.slice.id;
                const isDimmed =
                  activeFocusId !== null && activeFocusId !== arc.slice.id;

                return (
                  <g
                    key={arc.slice.id}
                    onMouseEnter={() => setHoveredSliceId(arc.slice.id)}
                    onMouseLeave={() => setHoveredSliceId(null)}
                    onClick={() =>
                      onSelectSliceId(isSelected ? null : arc.slice.id)
                    }
                    className="cursor-pointer transition-opacity duration-150"
                  >
                    {/* Main Capital Allocation Slice */}
                    <motion.path
                      initial={false}
                      animate={{
                        d: arc.mainPath,
                        fillOpacity: isDimmed ? 0.28 : 0.92,
                      }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      fill={arc.slice.colorHex}
                      stroke={VALORIA_PALETTE.bgDeep}
                      strokeWidth={isSelected ? 2.2 : 1.4}
                    >
                      <title>
                        {/* NOMBRE-NON-MONETAIRE : info-bulle SVG masquée si Mode Discret */}
                        {isPrivacyMode
                          ? `${arc.slice.label} : Montant masqué`
                          : `${arc.slice.label} : ${formatEur(arc.slice.valueCad, 0)} (${arc.slice.weightPct.toFixed(1)} %) · Score IA ${arc.slice.aiScore100}/100`}
                      </title>
                    </motion.path>

                    {/* Outer AI & News Health Halo */}
                    <motion.path
                      initial={false}
                      animate={{
                        d: arc.haloPath,
                        fillOpacity: isDimmed ? 0.25 : 0.95,
                      }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      fill={arc.haloColor}
                    />

                    {/* Cardinal Radial Tick */}
                    <polyline
                      points={arc.tickPoints}
                      fill="none"
                      stroke={isSelected ? VALORIA_PALETTE.textBright : arc.slice.colorHex}
                      strokeOpacity={isDimmed ? 0.25 : 0.75}
                      strokeWidth={isSelected ? 1.8 : 1.1}
                    />

                    {/* In-slice % label for slices >= 11% */}
                    {arc.slice.weightPct >= 11 && (
                      <text
                        x={arc.labelX}
                        y={arc.labelY}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={VALORIA_PALETTE.bgDeep}
                        fontSize="10"
                        fontWeight="700"
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        pointerEvents="none"
                        opacity={isDimmed ? 0.45 : 0.95}
                      >
                        {Math.round(arc.slice.weightPct)}%
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Center Live Readout */}
              <text
                x="0"
                y="-26"
                textAnchor="middle"
                fill={VALORIA_PALETTE.textZinc}
                fontSize="10"
                fontWeight="600"
              >
                {centerTitle}
              </text>
              <text
                x="0"
                y="-3"
                textAnchor="middle"
                fill={VALORIA_PALETTE.textBright}
                fontSize="17"
                fontWeight="700"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {isPrivacyMode ? '•••' : formatEur(centerValueCad, 0)}
              </text>
              <text
                x="0"
                y="15"
                textAnchor="middle"
                fill={centerPnlPct >= 0 ? VALORIA_PALETTE.emeraldLight : VALORIA_PALETTE.roseLight}
                fontSize="10"
                fontWeight="600"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {isPrivacyMode ? '•••' : `${centerWeightLabel} · ${formatSignedPct(centerPnlPct, 1)}`}
              </text>
              <text
                x="0"
                y="32"
                textAnchor="middle"
                fill={VALORIA_PALETTE.textZincLight}
                fontSize="9.5"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {/* NOMBRE-NON-MONETAIRE : score IA moyen masqué si Mode Discret */}
                {isPrivacyMode ? '•••' : `IA ${centerAiScore}/100 · Actu ${centerNewsScore >= 0 ? '+' : ''}${centerNewsScore}`}
              </text>
            </svg>
          </div>

          {/* Interactive Accessible Sector Selector Buttons */}
          <div
            role="group"
            aria-label="Filtrer par type d'actif"
            className="flex flex-wrap items-center justify-center gap-1.5 pt-2 border-t border-bordure"
          >
            <button
              type="button"
              onClick={() => onSelectSliceId(null)}
              aria-pressed={selectedSliceId === null}
              className={`min-w-11 min-h-11 px-2.5 py-1 rounded-lg text-[11px] font-mono tabular-nums font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedSliceId === null
                  ? 'bg-accent text-sur-accent font-semibold'
                  : 'bg-fond/80 text-texte hover:text-texte border border-bordure'
              }`}
            >
              Tout · 100 %
            </button>

            {donutSummary.slices.map((slice) => {
              const isSelected = selectedSliceId === slice.id;
              return (
                <button
                  key={`btn-${slice.id}`}
                  type="button"
                  onClick={() =>
                    onSelectSliceId(isSelected ? null : slice.id)
                  }
                  aria-pressed={isSelected}
                  className={`min-w-11 min-h-11 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-accent text-sur-accent font-semibold'
                      : 'bg-fond/80 text-texte hover:text-texte border border-bordure'
                  }`}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    <rect
                      x="0"
                      y="0"
                      width="8"
                      height="8"
                      rx="2"
                      fill={slice.colorHex}
                    />
                  </svg>
                  <span className="font-sans">{slice.shortLabel}</span>
                  <PrivateAmount>
                    <span>{slice.weightPct.toFixed(0)}%</span>
                  </PrivateAmount>
                </button>
              );
            })}
          </div>
        </div>

        {/* =================================================================== */}
        {/* LEFT SATELLITE (Order 2 on Mobile, Order 1 Left on Desktop)         */}
        {/* Owned Positions Reacting to the Central Donut                       */}
        {/* =================================================================== */}
        <div className="order-2 lg:order-1 lg:col-span-4 bg-surface/25 border border-bordure rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-bordure">
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-semibold text-texte truncate">
                  {lockedSlice
                    ? `${lockedSlice.shortLabel} (${sliceFilteredHoldings.length})`
                    : `Mes placements (${sliceFilteredHoldings.length})`}
                </h3>
              </div>

              {/* Clean Segmented Filter (Tous | Solides | À surveiller) */}
              <div className="inline-flex items-center gap-0.5 p-0.5 bg-fond border border-bordure rounded-lg shrink-0">
                <button aria-pressed={Boolean(holdingsFilterMode === 'all')}
                  type="button"
                  onClick={() => setHoldingsFilterMode('all')}
                  className={`min-h-11 min-w-11 px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    holdingsFilterMode === 'all'
                      ? 'bg-surface-douce text-texte'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  Tous
                </button>
                <button aria-pressed={Boolean(holdingsFilterMode === 'keep')}
                  type="button"
                  onClick={() => setHoldingsFilterMode('keep')}
                  className={`min-h-11 min-w-11 px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    holdingsFilterMode === 'keep'
                      ? 'bg-surface-douce text-succes-texte'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  Garder ({keepCountInSlice})
                </button>
                <button aria-pressed={Boolean(holdingsFilterMode === 'alert')}
                  type="button"
                  onClick={() => setHoldingsFilterMode('alert')}
                  className={`min-h-11 min-w-11 px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    holdingsFilterMode === 'alert'
                      ? 'bg-surface-douce text-erreur-texte'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  Alerte ({alertCountInSlice})
                </button>
              </div>
            </div>

            {sliceFilteredHoldings.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-xs text-texte-doux">
                  Aucune position dans ce filtre.
                </p>
                {holdingsFilterMode !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setHoldingsFilterMode('all')}
                    className="min-h-11 text-xs text-succes-texte hover:underline cursor-pointer"
                  >
                    Afficher toutes les lignes
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-bordure max-h-[370px] overflow-y-auto pr-0.5">
                {sliceFilteredHoldings.map((line) => {
                  const isAlert =
                    line.verdict === 'VENDRE' || line.verdict === 'ALLÉGER';
                  const lineSliceId = classifyAssetAllocationSlice(line.assetId);
                  const lineSlice = donutSummary.slices.find(
                    (s) => s.id === lineSliceId
                  );

                  return (
                    <div
                      key={`orbital-line-${line.assetId}`}
                      onMouseEnter={() => setHoveredSliceId(lineSliceId)}
                      onMouseLeave={() => setHoveredSliceId(null)}
                      className="py-2.5 first:pt-0.5 last:pb-0.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onInspectAsset(line.assetId)}
                          className="min-h-11 text-left group min-w-0 flex-1 flex items-center gap-1.5 cursor-pointer"
                        >
                          <svg
                            width="7"
                            height="7"
                            viewBox="0 0 8 8"
                            aria-hidden="true"
                            className="shrink-0"
                          >
                            <circle
                              cx="4"
                              cy="4"
                              r="4"
                              fill={lineSlice?.colorHex ?? VALORIA_PALETTE.mutedZinc}
                            />
                          </svg>
                          <span className="font-mono font-bold text-xs sm:text-sm text-texte group-hover:underline shrink-0">
                            {line.ticker}
                          </span>
                          <span className="text-xs text-texte-doux truncate">
                            {line.name.split(' (')[0]}
                          </span>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          <D3PriceSparkline30d
                            assetId={line.assetId}
                            spotPriceCad={line.spotPriceCad}
                            width={52}
                            height={19}
                          />
                          <div className="text-right font-mono tabular-nums">
                            <PrivateAmount className="text-xs font-bold text-texte">
                              {formatEur(line.currentValueCad, 0)}
                            </PrivateAmount>
                            <PrivateAmount
                              className={`text-[11px] ml-1.5 ${
                                line.pnlPct >= 0
                                  ? 'text-succes-texte'
                                  : 'text-erreur-texte'
                              }`}
                            >
                              {formatSignedPct(line.pnlPct, 1)}
                            </PrivateAmount>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono tabular-nums text-texte-doux truncate">
                          <PrivateAmount>{line.weightPct.toFixed(1)} %</PrivateAmount> · {line.optimalCanadianWrapper}{' '}
                          ·{' '}
                          <span
                            className={
                              isAlert ? 'text-erreur-texte' : 'text-succes-texte'
                            }
                          >
                            {isAlert ? `▼ ${line.verdict}` : `▲ ${line.verdict}`}
                          </span>
                        </span>

                        <div className="flex items-center gap-2.5 shrink-0">
                          {onFocusAsset && (
                            <button
                              type="button"
                              onClick={() => onFocusAsset(line.assetId)}
                              aria-pressed={focusedAssetId === line.assetId}
                              aria-label={`Activer le mode Focus sur ${line.ticker}`}
                              className="min-h-11 min-w-11 inline-flex items-center gap-1 text-[11px] text-succes-texte hover:text-succes-texte whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Crosshair className="w-3 h-3" />
                              <span>Focus</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onOpenAssetInDialogue(line.assetId)}
                            aria-label={`Demander l'avis IA sur ${line.ticker}`}
                            className="min-h-11 min-w-11 inline-flex items-center gap-1 text-[11px] text-texte-doux hover:text-texte whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>Avis IA</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2.5 border-t border-bordure flex items-center justify-between text-xs text-texte-doux font-mono tabular-nums">
            <span className="font-sans">
              {lockedSlice ? `Sous-total ${lockedSlice.shortLabel}` : 'Total détenu'}
            </span>
            <PrivateAmount>
              <strong className="text-texte">
                {formatEur(
                  lockedSlice ? lockedSlice.valueCad : donutSummary.totalValueCad,
                  0
                )}
              </strong>
            </PrivateAmount>
          </div>
        </div>

        {/* =================================================================== */}
        {/* RIGHT SATELLITE (Order 3 on Mobile & Desktop)                       */}
        {/* Live AI & News Sector Diagnostic Revolving Around the Donut         */}
        {/* =================================================================== */}
        <div className="order-3 lg:order-3 lg:col-span-4 bg-surface/25 border border-bordure rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            {/* Header */}
            <div className="pb-2.5 border-b border-bordure flex items-baseline justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-semibold text-texte truncate">
                {diagLabel}
              </h3>
              <span
                className={`font-mono tabular-nums text-xs font-bold shrink-0 ${
                  diagAiScore >= 66
                    ? 'text-succes-texte'
                    : diagAiScore <= 48
                      ? 'text-erreur-texte'
                      : 'text-texte'
                }`}
              >
                <PrivateAmount>IA {diagAiScore}/100</PrivateAmount>
              </span>
            </div>

            {/* 1. Verdict 7 Agents & Arbitrage */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-texte">
                {diagVerdict}
              </div>
              {diagRecommendedDeltaCad !== 0 && (
                <div className="font-mono tabular-nums text-xs">
                  <span className="font-sans text-texte-doux">
                    Ajustement IA recommandé :{' '}
                  </span>
                  <span
                    className={
                      diagRecommendedDeltaCad > 0
                        ? 'text-succes-texte font-semibold'
                        : 'text-erreur-texte font-semibold'
                    }
                  >
                    {formatSignedEur(diagRecommendedDeltaCad, 0)}
                  </span>
                </div>
              )}
            </div>

            {/* 2. Capital Weight vs Crash Risk Share (Euler Tail Risk) */}
            <div className="space-y-2 pt-2 border-t border-bordure">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-texte-doux">
                  Poids Capital vs Part du Risque Krach
                </span>
                <span
                  className={`font-mono tabular-nums text-[11px] font-semibold ${
                    diagRiskGapPct >= 5
                      ? 'text-erreur-texte'
                      : 'text-succes-texte'
                  }`}
                >
                  <PrivateAmount>
                    {diagCapitalWeightPct.toFixed(0)} % cap. /{' '}
                    {diagEulerRiskPct.toFixed(0)} % risque
                  </PrivateAmount>
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-texte-doux">
                  <span className="w-14 shrink-0 font-sans">Capital</span>
                  <svg
                    viewBox="0 0 100 6"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="flex-1 h-1.5 bg-fond rounded-full overflow-hidden"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={Math.min(100, Math.max(4, diagCapitalWeightPct))}
                      height="6"
                      fill={diagnosticSlice?.colorHex ?? VALORIA_PALETTE.sky}
                    />
                  </svg>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-texte-doux">
                  <span className="w-14 shrink-0 font-sans">Risque</span>
                  <svg
                    viewBox="0 0 100 6"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="flex-1 h-1.5 bg-fond rounded-full overflow-hidden"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={Math.min(100, Math.max(4, diagEulerRiskPct))}
                      height="6"
                      fill={diagRiskGapPct >= 5 ? VALORIA_PALETTE.rose : VALORIA_PALETTE.emerald}
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* 3. Verified News & Filing Catalyst */}
            <div className="space-y-1.5 pt-2 border-t border-bordure">
              <div className="flex items-center justify-between gap-2 text-[11px] text-texte-doux font-mono tabular-nums">
                <span>{diagCatalystCode}</span>
                <span
                  className={
                    diagNewsScore >= 10
                      ? 'text-succes-texte'
                      : diagNewsScore <= -10
                        ? 'text-erreur-texte'
                        : 'text-texte'
                  }
                >
                  Impulsion Actu {diagNewsScore >= 0 ? '+' : ''}
                  {diagNewsScore}
                </span>
              </div>
              <p className="text-xs text-texte leading-relaxed line-clamp-2">
                {diagCatalystHeadline}
              </p>
            </div>
          </div>

          {/* Primary Bridge to Deep AI & News Causal Hub */}
          <button
            type="button"
            onClick={() => onOpenDeepAiNewsLab(selectedSliceId)}
            className="w-full min-h-11 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors whitespace-nowrap cursor-pointer"
          >
            <span>Explorer le Radar IA &amp; Actus Causal</span>
            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>
      </div>

      {/* Subtle Secondary Quick Metric Strip when multiple slices exist */}
      {donutSummary.slices.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-4 py-2.5 bg-surface/35 border border-bordure rounded-xl text-xs text-texte-doux">
          <div>
            <span>Pilier majeur : </span>
            <strong className="text-texte font-mono tabular-nums">
              {donutSummary.dominantSlice?.label} (
              <PrivateAmount>
                {donutSummary.dominantSlice?.weightPct.toFixed(0)} % ·{' '}
                {formatCompactEur(donutSummary.dominantSlice?.valueCad ?? 0)}
              </PrivateAmount>)
            </strong>
          </div>
          {donutSummary.topRiskSlice && (
            <div>
              <span>Concentration risque : </span>
              <strong className="text-texte font-mono tabular-nums">
                {donutSummary.topRiskSlice.shortLabel} (
                <PrivateAmount>
                  {donutSummary.topRiskSlice.eulerRiskSharePct.toFixed(0)} % de la
                  volatilité extrême
                </PrivateAmount>)
              </strong>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

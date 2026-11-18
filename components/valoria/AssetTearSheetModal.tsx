import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { MacroIndicators, MARKET_REGIMES } from '../../services/valoria/marketData';
import { UniversalAssetAnalysis } from '../../services/valoria/multiAssetQuantEngine';
import { computeProbabilisticValuation } from '../../services/valoria/institutionalQuantEngine';
import { AssetNewsSummary } from '../../services/valoria/newsCatalystEngine';
import {
  AssetDeepCorporateIntelligence,
  computeAssetCorporateIntelligence,
} from '../../services/valoria/corporateIntelligenceEngine';
import {
  AssetInstitutionalCorrelationProfile,
  analyzeDeepCurveStructure,
} from '../../services/valoria/institutionalCurveAndNewsEngine';
import {
  buildAssetTechnicalAnalysis,
  computeBeginnerStockVisualXRay,
} from '../../services/valoria/dailyTechnicalIndicators';
import { D3AssetTechnicalChart } from './D3AssetTechnicalChart';
import { AnimatedMeterBar } from './MotionPrimitives';
import {
  PriceTargetRangeBar,
  QuarterlyBeatAndMarginSvg,
  RadarComparisonSvg,
} from './VisualPrimitives';
import {
  formatEur,
  formatPct,
  formatPriceCad,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface AssetTearSheetModalProps {
  analysis: UniversalAssetAnalysis | null;
  macro?: MacroIndicators;
  livePrices?: Record<string, number>;
  assetNews?: AssetNewsSummary | null;
  corporateIntel?: AssetDeepCorporateIntelligence | null;
  institutionalProfile?: AssetInstitutionalCorrelationProfile | null;
  isWatched: boolean;
  onClose: () => void;
  onInvestCad: (assetId: string, amountCad: number) => void;
  onAddWatchlist: (assetId: string) => void;
}

export const AssetTearSheetModal: React.FC<AssetTearSheetModalProps> = ({
  analysis,
  macro,
  livePrices = {},
  assetNews,
  corporateIntel,
  institutionalProfile,
  isWatched,
  onClose,
  onInvestCad,
  onAddWatchlist,
}) => {
  const [orderAmountCad, setOrderAmountCad] = useState<string>('2500');
  const [showProDetails, setShowProDetails] = useState<boolean>(false);

  const effectiveMacro = macro ?? MARKET_REGIMES[0].indicators;

  const probVal = useMemo(() => {
    if (!analysis) return null;
    return computeProbabilisticValuation(
      analysis,
      effectiveMacro,
      assetNews?.blackLittermanNewsShockPct ?? 0
    );
  }, [analysis, effectiveMacro, assetNews]);

  const intel = useMemo(() => {
    if (!analysis) return null;
    if (corporateIntel) return corporateIntel;
    return computeAssetCorporateIntelligence({
      analysis,
      assetNews: assetNews ?? undefined,
      macro: effectiveMacro,
    });
  }, [analysis, corporateIntel, assetNews, effectiveMacro]);

  const curveDiag = useMemo(() => {
    if (!analysis) return null;
    return analyzeDeepCurveStructure({
      subjectId: analysis.asset.id,
      horizonYears: 3,
      livePrices,
      riskFreeRatePct: effectiveMacro.centralBankRatePct,
    });
  }, [analysis, livePrices, effectiveMacro.centralBankRatePct]);

  const tech = useMemo(() => {
    if (!analysis) return null;
    return buildAssetTechnicalAnalysis(analysis.asset.id, analysis.spotPriceCad);
  }, [analysis]);

  const xray = useMemo(() => {
    if (!analysis || !tech) return null;
    return computeBeginnerStockVisualXRay(analysis, tech);
  }, [analysis, tech]);

  if (!analysis || !probVal || !intel || !curveDiag || !tech || !xray) return null;

  const priceDecimals = analysis.spotPriceCad < 2 ? 4 : 2;

  const verdictTextColor =
    xray.verdictTone === 'positive'
      ? 'text-succes-texte'
      : xray.verdictTone === 'negative'
        ? 'text-erreur-texte'
        : 'text-texte';

  const handleQuickOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(orderAmountCad.replace(',', '.'));
    if (Number.isFinite(amt) && amt >= 50) {
      onInvestCad(analysis.asset.id, Math.round(amt));
      onClose();
    }
  };

  const thermoX = Math.max(8, Math.min(312, (xray.thermometerPositionPct / 100) * 320));
  const range52X = Math.max(7, Math.min(313, (xray.range52wPct / 100) * 320));

  return (
    <Modal
      isOpen={Boolean(analysis)}
      onClose={onClose}
      title={`${analysis.asset.ticker} — ${analysis.asset.name.split(' (')[0]}`}
      subtitle={`${analysis.subClassLabel} · ${analysis.regionLabel} · Compte : ${analysis.optimalCanadianWrapper} — ${xray.beginnerOneLiner}`}
      size="xl"
    >
      <div className="space-y-5 text-texte">

        {/* ==================== 2. VISUAL VERDICT + VALUATION THERMOMETER + 52W SLIDER ==================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Verdict Summary Box */}
          <div className="lg:col-span-4 rounded-2xl border border-bordure bg-surface/60 p-4 flex flex-col justify-between gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <span className="block text-[11px] text-texte-doux">Conseil Simple</span>
                <span className={`text-lg font-bold tracking-tight ${verdictTextColor}`}>
                  {xray.verdictArrow} {xray.verdictWord}
                </span>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="text-xs text-texte-doux">Note Globale</div>
                <div className="text-lg font-bold text-texte">
                  {/* NOMBRE-NON-MONETAIRE : score quantitatif d'actif public */}
                  {analysis.quantScore} / 100
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-bordure font-mono tabular-nums">
              <div>
                <span className="block font-sans text-[11px] text-texte-doux">
                  Prix Actuel ($ CAD)
                </span>
                <span className="text-base font-bold text-texte">
                  {formatEur(analysis.spotPriceCad, priceDecimals)}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[11px] text-texte-doux">
                  Vraie Valeur Estimée
                </span>
                <span
                  className={`text-base font-bold ${
                    probVal.expectedUpsidePct >= 5
                      ? 'text-succes-texte'
                      : probVal.expectedUpsidePct <= -5
                        ? 'text-erreur-texte'
                        : 'text-texte'
                  }`}
                >
                  {formatEur(probVal.expectedFairValueCad, priceDecimals)}
                </span>
              </div>
            </div>

            {/* 9-Segment Visual Piotroski Health Blocks */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-texte-doux">Santé Bilan (9 critères)</span>
                <span
                  className={`font-mono font-semibold ${
                    xray.piotroskiSegments >= 7
                      ? 'text-succes-texte'
                      : xray.piotroskiSegments <= 4
                        ? 'text-erreur-texte'
                        : 'text-texte'
                  }`}
                >
                  {xray.piotroskiSegments} / 9
                </span>
              </div>
              <div className="grid grid-cols-9 gap-1">
                {Array.from({ length: 9 }, (_, i) => {
                  const lit = i < xray.piotroskiSegments;
                  const segColor = !lit
                    ? 'bg-surface-douce'
                    : xray.piotroskiSegments >= 7
                      ? 'bg-succes-texte'
                      : xray.piotroskiSegments <= 4
                        ? 'bg-erreur-texte'
                        : 'bg-texte';
                  return (
                    <div
                      key={i}
                      className={`h-2 rounded-sm transition-colors ${segColor}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Visual Valuation Thermometer + 52-Week Range Slider */}
          <div className="lg:col-span-8 rounded-2xl border border-bordure bg-surface/60 p-4 flex flex-col justify-between gap-4">
            {/* Thermometer: Aubaine <-> Juste Prix <-> Trop Cher */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-texte">
                  Thermomètre du Prix ($ CAD)
                </span>
                <span
                  className={`font-semibold ${
                    xray.upsidePct >= 8
                      ? 'text-succes-texte'
                      : xray.upsidePct <= -6
                        ? 'text-erreur-texte'
                        : 'text-texte'
                  }`}
                >
                  {xray.thermometerLabel}
                </span>
              </div>

              <svg
                viewBox="0 0 320 20"
                className="w-full h-5 block overflow-visible select-none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="tearsheet-thermo-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={VALORIA_PALETTE.emerald} stopOpacity="0.85" />
                    <stop offset="50%" stopColor={VALORIA_PALETTE.mutedZinc} stopOpacity="0.55" />
                    <stop offset="100%" stopColor={VALORIA_PALETTE.rose} stopOpacity="0.85" />
                  </linearGradient>
                </defs>
                <rect x="0" y="4" width="320" height="12" rx="6" fill="url(#tearsheet-thermo-grad)" />
                <circle
                  cx={thermoX}
                  cy="10"
                  r="7.5"
                  fill={VALORIA_PALETTE.textBright}
                  stroke={VALORIA_PALETTE.bgDeep}
                  strokeWidth="2.2"
                />
              </svg>

              <div className="flex items-center justify-between text-[11px] text-texte-doux">
                <span className="text-succes-texte font-medium">▲ Aubaine (Pas cher)</span>
                <span>Juste prix</span>
                <span className="text-erreur-texte font-medium">▼ Trop cher</span>
              </div>
            </div>

            {/* 52-Week Low <-> Current <-> High Slider */}
            <div className="space-y-2 pt-2 border-t border-bordure">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-texte-doux">Position sur 52 Semaines ($ CAD)</span>
                <span className="font-mono text-texte tabular-nums">
                  1M {formatSignedPct(analysis.momentum1mPct, 1)} · 12M{' '}
                  <span
                    className={
                      analysis.momentum12mPct >= 0
                        ? 'text-succes-texte font-semibold'
                        : 'text-erreur-texte font-semibold'
                    }
                  >
                    {formatSignedPct(analysis.momentum12mPct, 1)}
                  </span>
                </span>
              </div>

              <svg
                viewBox="0 0 320 18"
                className="w-full h-4 block overflow-visible select-none"
                aria-hidden="true"
              >
                <rect x="0" y="4" width="320" height="10" rx="5" fill={VALORIA_PALETTE.gridZinc} />
                <rect
                  x="0"
                  y="4"
                  width={Math.max(8, range52X)}
                  height="10"
                  rx="5"
                  fill={VALORIA_PALETTE.textZincLight}
                />
                <circle
                  cx={range52X}
                  cy="9"
                  r="6.5"
                  fill={VALORIA_PALETTE.white}
                  stroke={VALORIA_PALETTE.bgDeep}
                  strokeWidth="2"
                />
              </svg>

              <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono tabular-nums text-texte-doux">
                <span>Bas 1A : {formatPriceCad(xray.low52wCad)}</span>
                <span className="text-texte font-semibold">
                  Actuel : {formatPriceCad(xray.spotPriceCad)}
                </span>
                <span>Haut 1A : {formatPriceCad(xray.high52wCad)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== 3. DEEP TECHNICAL ANALYSIS (MM 50/200 · RSI · MACD) ==================== */}
        <D3AssetTechnicalChart
          assetId={analysis.asset.id}
          ticker={analysis.asset.ticker}
          spotPriceCad={analysis.spotPriceCad}
        />

        {/* ==================== 4. 6 BEGINNER VISUAL X-RAY BARS ==================== */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-texte">
              Diagnostic Visuel en 6 Barres Simples
            </h3>
            <span className="text-xs text-texte-doux">
              Vert = Point fort · Gris = Normal · Rouge = Vigilance
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {xray.pillars.map((p, idx) => {
              const toneColor =
                p.tone === 'positive'
                  ? 'text-succes-texte'
                  : p.tone === 'negative'
                    ? 'text-erreur-texte'
                    : 'text-texte';
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-bordure bg-surface/50 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-texte">{p.label}</span>
                    <span className={`font-mono font-semibold tabular-nums ${toneColor}`}>
                      {p.valueBadge}
                    </span>
                  </div>
                  <AnimatedMeterBar
                    pct={p.score}
                    tone={p.tone}
                    heightClass="h-2"
                    delay={idx * 0.04}
                    immediate
                  />
                  <div className="text-[11px] text-texte-doux">{p.plainMeaning}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ==================== 5. EXPANDABLE PRO ANALYST DRAWER ==================== */}
        <div className="border-t border-bordure pt-3">
          <button
            type="button"
            onClick={() => setShowProDetails((prev) => !prev)}
            aria-expanded={showProDetails}
            className="min-h-11 w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-bordure bg-surface/70 hover:bg-surface text-xs font-semibold text-texte transition-colors cursor-pointer"
          >
            <span>
              Détails Analyste Pro (Matrice DCF WACC × g · 8 Trimestres · Initiés &amp; Canal 3A)
            </span>
            {showProDetails ? (
              <ChevronUp className="w-4 h-4 text-texte-doux" />
            ) : (
              <ChevronDown className="w-4 h-4 text-texte-doux" />
            )}
          </button>

          <AnimatePresence initial={false}>
            {showProDetails && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="pt-4 space-y-5"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pb-4 border-b border-bordure items-center">
                  <div className="lg:col-span-5 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-texte">
                      <span>Radar 6 Axes (7 Agents)</span>
                      <span className="font-mono text-texte">
                        {/* NOMBRE-NON-MONETAIRE : score composite public 7 agents */}
                        {intel.compositeAgentScore100}/100
                      </span>
                    </div>
                    <RadarComparisonSvg primary={intel.radar6} size={198} />
                  </div>

                  <div className="lg:col-span-7 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-texte">
                        Fourchette 3 Scénarios &amp; Matrice WACC × g ($ CAD)
                      </span>
                      <span className="font-mono text-texte-doux">
                        WACC {formatPct(probVal.waccBasePct, 1)} · g{' '}
                        {formatPct(probVal.terminalGrowthBasePct, 2)}
                      </span>
                    </div>

                    <PriceTargetRangeBar
                      spotCad={analysis.spotPriceCad}
                      fairCad={probVal.expectedFairValueCad}
                      stopCad={analysis.stopLossCad}
                      targetCad={probVal.bullCaseCad}
                    />

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse font-mono tabular-nums">
                        <thead>
                          <tr className="border-b border-bordure text-texte-doux">
                            <th className="py-1.5 pr-2 text-left font-sans text-[11px]">
                              g \ WACC
                            </th>
                            {probVal.sensitivityWaccHeaders.map((wHeader, idx) => (
                              <th
                                key={wHeader}
                                className={`py-1.5 px-1.5 text-right text-[11px] ${
                                  idx === 2 ? 'text-texte font-bold' : ''
                                }`}
                              >
                                {wHeader}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-bordure">
                          {probVal.sensitivityGrowthRows.map((row, rIdx) => (
                            <tr key={row.growthLabel}>
                              <td
                                className={`py-1.5 pr-2 text-[11px] ${
                                  rIdx === 1 ? 'text-texte font-bold' : 'text-texte-doux'
                                }`}
                              >
                                {row.growthLabel}
                              </td>
                              {row.fairValuesCad.map((valCad, cIdx) => {
                                const isCenter = rIdx === 1 && cIdx === 2;
                                const diffPct =
                                  ((valCad - analysis.spotPriceCad) /
                                    Math.max(0.0001, analysis.spotPriceCad)) *
                                  100;
                                const cellBg = isCenter
                                  ? 'bg-texte text-sur-accent font-bold'
                                  : diffPct >= 10
                                    ? 'bg-succes-fond text-succes-texte'
                                    : diffPct >= 0
                                      ? 'bg-succes-fond/50 text-succes-texte'
                                      : diffPct <= -12
                                        ? 'bg-erreur-fond text-erreur-texte'
                                        : 'bg-erreur-fond/50 text-erreur-texte';
                                return (
                                  <td
                                    key={`${row.growthLabel}-${cIdx}`}
                                    className={`py-1.5 px-1.5 text-right rounded-sm ${cellBg}`}
                                  >
                                    {formatEur(valCad, priceDecimals)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 space-y-2">
                    <div className="text-xs font-semibold text-texte">
                      8 Trimestres — Surprises BPA (%) &amp; Marges Op./FCF
                    </div>
                    <QuarterlyBeatAndMarginSvg quarters={intel.quarterlyHistory} />
                  </div>

                  <div className="lg:col-span-5 space-y-2 font-mono tabular-nums text-xs">
                    <div className="font-sans text-xs font-semibold text-texte pb-1 border-b border-bordure">
                      Ratios Financiers &amp; Initiés
                    </div>
                    <div className="divide-y divide-bordure">
                      <div className="py-1.5 flex justify-between">
                        <span className="font-sans text-texte-doux">Altman Z · Beneish M</span>
                        <span className="text-texte font-semibold">
                          {intel.forensics.altmanZScore} · {intel.forensics.beneishMScore}
                        </span>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="font-sans text-texte-doux">ROIC − WACC</span>
                        <span
                          className={
                            intel.forensics.roicWaccSpreadPct >= 0
                              ? 'text-succes-texte font-semibold'
                              : 'text-erreur-texte font-semibold'
                          }
                        >
                          {formatSignedPct(intel.forensics.roicWaccSpreadPct, 1)}
                        </span>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="font-sans text-texte-doux">Flux Initiés 6M</span>
                        <span
                          className={
                            intel.positioning.insiderNetFlow6mCad >= 0
                              ? 'text-succes-texte font-semibold'
                              : 'text-erreur-texte font-semibold'
                          }
                        >
                          {intel.positioning.insiderNetFlow6mCad >= 0 ? '+' : ''}
                          {intel.positioning.insiderNetFlow6mCad} M$ CAD
                        </span>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="font-sans text-texte-doux">Max Drawdown 3A</span>
                        <span className="text-erreur-texte font-semibold">
                          {formatSignedPct(curveDiag.maxDrawdownPct, 1)}
                        </span>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="font-sans text-texte-doux">CAR Actualités</span>
                        <span
                          className={
                            (institutionalProfile?.cumulativeCarPct ?? 0) >= 0
                              ? 'text-succes-texte font-semibold'
                              : 'text-erreur-texte font-semibold'
                          }
                        >
                          {formatSignedPct(
                            institutionalProfile?.cumulativeCarPct ?? analysis.momentum1mPct,
                            1
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ==================== 6. ACTION FOOTER ($ CAD) ==================== */}
        <form
          onSubmit={handleQuickOrder}
          className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-bordure"
        >
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {!isWatched && (
              <button
                type="button"
                onClick={() => onAddWatchlist(analysis.asset.id)}
                className="min-h-11 px-3 py-2 font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl transition-colors whitespace-nowrap cursor-pointer"
              >
                + Suivre en Watchlist
              </button>
            )}
            <span className="font-mono tabular-nums text-texte-doux">
              {analysis.isHeld
                ? `En portefeuille : ${formatEur(analysis.heldValueCad, 0)} (${formatPct(analysis.heldWeightPct, 1)})`
                : 'Non détenu actuellement'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="tearsheet-invest-cad" className="sr-only">
              Montant à investir en $ CAD
            </label>
            <input
              id="tearsheet-invest-cad"
              type="number"
              min={50}
              step={250}
              value={orderAmountCad}
              onChange={(e) => setOrderAmountCad(e.target.value)}
              className="w-28 sm:w-32 min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-surface border border-bordure-champ rounded-xl text-texte outline-hidden focus-ring focus:border-accent"
            />
            <button
              type="submit"
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span>Ajouter ($ CAD)</span>
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
};

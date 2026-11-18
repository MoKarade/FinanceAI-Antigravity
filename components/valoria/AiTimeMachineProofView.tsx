import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  EyeOff,
  Play,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { PortfolioLot } from '../../services/valoria/engine';
import { RiskProfile } from '../../services/valoria/marketData';
import { fetchValoriaBlindTimeMachineTest } from '../../services/valoria/valoriaAiClient';
import {
  BlindGeminiEpochAuditPayload,
  EpochRetrospectiveAudit,
  TimeMachineEpochId,
  buildGlobalAiUsefulnessSummary,
} from '../../services/valoria/aiTimeMachineEngine';
import { D3AiTimeMachineChart } from './D3AiTimeMachineChart';
import { AnimatedNumber } from './MotionPrimitives';
import {
  formatCompactEur,
  formatEur,
  formatPct,
  formatPriceCad,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface AiTimeMachineProofViewProps {
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  riskProfile: RiskProfile;
  geminiApiKey?: string;
  onInspectAsset: (assetId: string) => void;
  onNavigateToRecommendations: () => void;
}

const STORAGE_BLIND_AUDITS_KEY = 'valoria_ai_blind_time_machine_v1';
const STORAGE_RETRO_CAPITAL_KEY = 'valoria_ai_retro_capital_cad_v1';

const CAPITAL_PRESETS = [5000, 10000, 25000, 50000, 100000] as const;

const EPOCH_TABS: Array<{
  id: TimeMachineEpochId | 'all';
  label: string;
  subDate: string;
}> = [
  { id: '1m', label: 'Il y a 1 mois', subDate: 'Oct. 2026' },
  { id: '1y', label: 'Il y a 1 an', subDate: 'Nov. 2025' },
  { id: '5y', label: 'Il y a 5 ans', subDate: 'Nov. 2021' },
  { id: '10y', label: 'Il y a 10 ans', subDate: 'Nov. 2016' },
  { id: 'all', label: 'Synthèse 4 époques', subDate: 'Vue globale' },
];

export const AiTimeMachineProofView: React.FC<AiTimeMachineProofViewProps> = ({
  lots,
  livePrices,
  riskProfile,
  geminiApiKey = '',
  onInspectAsset,
  onNavigateToRecommendations,
}) => {
  const [selectedView, setSelectedView] = useState<TimeMachineEpochId | 'all'>('5y');
  const [initialCapitalCad, setInitialCapitalCad] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_RETRO_CAPITAL_KEY);
      if (saved) {
        const parsed = Number(saved);
        if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 10_000_000) {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return 10000;
  });
  const [capitalInputRaw, setCapitalInputRaw] = useState<string>(() =>
    String(initialCapitalCad)
  );

  const [blindOverrides, setBlindOverrides] = useState<
    Partial<Record<TimeMachineEpochId, BlindGeminiEpochAuditPayload>>
  >(() => {
    try {
      const saved = localStorage.getItem(STORAGE_BLIND_AUDITS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return {};
  });

  const [useQuantOnlyComparison, setUseQuantOnlyComparison] = useState<boolean>(false);
  const [runningEpochId, setRunningEpochId] = useState<TimeMachineEpochId | 'all' | null>(
    null
  );
  const [auditStatusBanner, setAuditStatusBanner] = useState<string | null>(null);
  const [showBlindProtocolDrawer, setShowBlindProtocolDrawer] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_RETRO_CAPITAL_KEY, String(initialCapitalCad));
    } catch {
      // ignore
    }
  }, [initialCapitalCad]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_BLIND_AUDITS_KEY, JSON.stringify(blindOverrides));
    } catch {
      // ignore
    }
  }, [blindOverrides]);

  const effectiveOverrides = useMemo(
    () => (useQuantOnlyComparison ? {} : blindOverrides),
    [useQuantOnlyComparison, blindOverrides]
  );

  const globalSummary = useMemo(
    () =>
      buildGlobalAiUsefulnessSummary({
        initialCapitalCad,
        lots,
        livePrices,
        riskProfile,
        blindOverridesByEpoch: effectiveOverrides,
      }),
    [initialCapitalCad, lots, livePrices, riskProfile, effectiveOverrides]
  );

  const activeEpochAudit: EpochRetrospectiveAudit = useMemo(() => {
    const targetId: TimeMachineEpochId = selectedView === 'all' ? '5y' : selectedView;
    return (
      globalSummary.epochs.find((e) => e.epochId === targetId) ?? globalSummary.epochs[0]
    );
  }, [globalSummary.epochs, selectedView]);

  const handleSelectCapitalPreset = (amount: number) => {
    setInitialCapitalCad(amount);
    setCapitalInputRaw(String(amount));
  };

  const handleCapitalInputChange = (raw: string) => {
    setCapitalInputRaw(raw);
    const cleaned = Number(raw.replace(/[^\d.]/g, ''));
    if (Number.isFinite(cleaned) && cleaned >= 100 && cleaned <= 10_000_000) {
      setInitialCapitalCad(Math.round(cleaned));
    }
  };

  const runBlindGeminiForSingleEpoch = useCallback(
    async (epochAudit: EpochRetrospectiveAudit): Promise<BlindGeminiEpochAuditPayload | null> => {
      const data = await fetchValoriaBlindTimeMachineTest(geminiApiKey, {
        epochId: epochAudit.epochId,
        riskProfile,
        ...epochAudit.anonymizedServerRequest,
      });
      return data.ok && data.audit ? data.audit : null;
    },
    [geminiApiKey, riskProfile]
  );

  const handleRunBlindTest = async (target: TimeMachineEpochId | 'all') => {
    if (runningEpochId) return;
    setRunningEpochId(target);
    setAuditStatusBanner(null);
    setUseQuantOnlyComparison(false);

    try {
      if (target === 'all') {
        const baselineSummary = buildGlobalAiUsefulnessSummary({
          initialCapitalCad,
          lots,
          livePrices,
          riskProfile,
          blindOverridesByEpoch: {},
        });
        const results = await Promise.allSettled(
          baselineSummary.epochs.map((ep) => runBlindGeminiForSingleEpoch(ep))
        );
        const nextMap: Partial<Record<TimeMachineEpochId, BlindGeminiEpochAuditPayload>> = {
          ...blindOverrides,
        };
        let updatedCount = 0;
        let lastNotice: string | undefined;
        results.forEach((r) => {
          if (r.status === 'fulfilled' && r.value) {
            nextMap[r.value.epochId] = r.value;
            updatedCount++;
            if (r.value.noticeFr) lastNotice = r.value.noticeFr;
          }
        });
        setBlindOverrides(nextMap);
        setAuditStatusBanner(
          lastNotice ??
            `Audit Gemini à l’aveugle terminé sur ${updatedCount}/4 époques (dossiers anonymisés ACTIF_01..12).`
        );
      } else {
        const baselineEpoch =
          buildGlobalAiUsefulnessSummary({
            initialCapitalCad,
            lots,
            livePrices,
            riskProfile,
            blindOverridesByEpoch: {},
          }).epochs.find((e) => e.epochId === target) ?? activeEpochAudit;

        const payload = await runBlindGeminiForSingleEpoch(baselineEpoch);
        if (payload) {
          setBlindOverrides((prev) => ({
            ...prev,
            [target]: payload,
          }));
          setAuditStatusBanner(
            payload.noticeFr ??
              `Audit à l’aveugle validé (${baselineEpoch.shortLabel}) : ${payload.picks.length} achats et ${payload.avoids.length} pièges sélectionnés sans connaître les noms ni le futur.`
          );
        }
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Moteur quantitatif historique actif sur les archives certifiées.';
      setAuditStatusBanner(msg);
    } finally {
      setRunningEpochId(null);
    }
  };

  const hasBlindForActiveEpoch = Boolean(blindOverrides[activeEpochAudit.epochId]);
  const blindAuditedCount = Object.keys(blindOverrides).length;

  return (
    <div className="space-y-8 sm:space-y-10">
      {/* =================================================================== */}
      {/* 01. EDITORIAL VERDICT HEADER: IS THE AI ACTUALLY USEFUL?            */}
      {/* =================================================================== */}
      <section
        aria-label="Verdict global d’utilité de l’IA"
        className="pb-6 border-b border-bordure grid grid-cols-1 lg:grid-cols-12 gap-6 items-end"
      >
        <div className="lg:col-span-7 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-texte-doux">
            <span className="font-medium text-texte">
              Laboratoire Rétrospectif Sans Biais Futur
            </span>
            <span aria-hidden="true" className="text-texte-doux">·</span>
            <span>1 mois · 1 an · 5 ans · 10 ans</span>
            <span aria-hidden="true" className="text-texte-doux">·</span>
            <span className="font-mono tabular-nums">
              {blindAuditedCount > 0
                ? `${blindAuditedCount}/4 époques auditées par Gemini à l’aveugle`
                : 'Hybride Quantitatif + Gemini à l’aveugle'}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-texte">
            {globalSummary.overallVerdictLabel}
          </h1>

          <p className="text-xs sm:text-sm text-texte-doux max-w-2xl leading-relaxed">
            {globalSummary.overallPlainSummaryFr}
          </p>
        </div>

        <div className="lg:col-span-5 pt-4 border-t border-bordure lg:pt-0 lg:border-t-0 lg:border-l lg:border-bordure lg:pl-7 grid grid-cols-3 gap-4 font-mono tabular-nums">
          <div className="space-y-1">
            <span className="block font-sans text-xs text-texte-doux">
              Score d’utilité
            </span>
            <div className="text-xl sm:text-2xl font-semibold text-succes-texte">
              <AnimatedNumber
                value={globalSummary.overallUsefulnessScore100}
                // NOMBRE-NON-MONETAIRE : score méthodologique de l'outil IA
                formatter={(n) => `${Math.round(n)}/100`}
              />
            </div>
            <span className="block font-sans text-[11px] text-texte-doux">
              {globalSummary.epochsWonVsWorldCount}/4 vs Monde
            </span>
          </div>

          <div className="space-y-1">
            <span className="block font-sans text-xs text-texte-doux">
              Paris gagnants
            </span>
            <div className="text-xl sm:text-2xl font-semibold text-texte">
              {globalSummary.globalHitRatePct} %
            </div>
            <span className="block font-sans text-[11px] text-texte-doux">
              {globalSummary.totalWinningPicks}/{globalSummary.totalPicksAudited} titres &gt; indice
            </span>
          </div>

          <div className="space-y-1">
            <span className="block font-sans text-xs text-texte-doux">
              Face au hasard
            </span>
            <div className="text-xl sm:text-2xl font-semibold text-succes-texte">
              Top {Math.max(1, 100 - globalSummary.avgBeatRandomPercentile)} %
            </div>
            <span className="block font-sans text-[11px] text-texte-doux">
              Bat {globalSummary.avgBeatRandomPercentile} % des tirages
            </span>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 02. EPOCH SELECTOR + SIMULATED CAPITAL ($ CAD) + BLIND GEMINI CTA   */}
      {/* =================================================================== */}
      <section
        aria-label="Contrôles temporels et capital simulé"
        className="space-y-4"
      >
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          {/* Segmented Epoch Selector */}
          <div
            role="group"
            aria-label="Choisir l’époque passée à tester"
            className="inline-flex items-center gap-1 p-1 bg-surface/65 border border-bordure rounded-xl overflow-x-auto no-scrollbar max-w-full"
          >
            {EPOCH_TABS.map((tab) => {
              const isSelected = selectedView === tab.id;
              const isBlindDone =
                tab.id !== 'all' && Boolean(blindOverrides[tab.id]);
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedView(tab.id)}
                  className={`relative min-h-11 px-3 sm:px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'text-sur-accent font-semibold'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="retro-epoch-active-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      className="absolute inset-0 bg-accent rounded-lg"
                    />
                  )}
                  <span className="relative z-10 inline-flex items-center gap-1.5">
                    <span>{tab.label}</span>
                    <span
                      className={`hidden sm:inline font-mono text-[10px] ${
                        isSelected ? 'text-sur-accent' : 'text-texte-doux'
                      }`}
                    >
                      · {tab.subDate}
                      {isBlindDone && !useQuantOnlyComparison ? ' · IA' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Capital Simulator ($ CAD) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-texte-doux whitespace-nowrap">
              Mise à l’époque :
            </span>
            <div className="inline-flex items-center gap-1 p-1 bg-surface/60 border border-bordure rounded-xl overflow-x-auto no-scrollbar">
              {CAPITAL_PRESETS.map((amt) => {
                const isActiveAmt = initialCapitalCad === amt;
                return (
                  <button
                    key={amt}
                    type="button"
                    aria-pressed={isActiveAmt}
                    onClick={() => handleSelectCapitalPreset(amt)}
                    className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-mono tabular-nums rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isActiveAmt
                        ? 'bg-surface-douce text-texte font-semibold'
                        : 'text-texte-doux hover:text-texte'
                    }`}
                  >
                    {formatCompactEur(amt)}
                  </button>
                );
              })}
            </div>

            <label className="inline-flex items-center gap-1.5 px-2.5 py-1 min-h-11 bg-fond border border-bordure rounded-xl text-xs font-mono tabular-nums text-texte focus-within:border-accent">
              <input
                type="number"
                min={100}
                max={10000000}
                step={500}
                aria-label="Montant investi simulé en dollars canadiens"
                value={capitalInputRaw}
                onChange={(e) => handleCapitalInputChange(e.target.value)}
                className="min-h-11 w-20 bg-transparent text-right text-texte outline-hidden focus-ring"
              />
              <span className="text-texte-doux">$ CAD</span>
            </label>
          </div>
        </div>

        {/* Action Strip for Blind Gemini Audit & Anti-Lookahead Verification */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 px-4 bg-surface/30 border border-bordure rounded-2xl">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texte">
            <span className="inline-flex items-center gap-1.5 font-medium text-texte">
              <EyeOff className="w-3.5 h-3.5 text-succes-texte shrink-0" />
              <span>
                Mode actif :{' '}
                {selectedView === 'all'
                  ? blindAuditedCount > 0 && !useQuantOnlyComparison
                    ? `Hybride (${blindAuditedCount}/4 époques Gemini à l’aveugle)`
                    : 'Moteur Quantitatif Point-in-Time (0 regard vers le futur)'
                  : activeEpochAudit.sourceMode === 'gemini_blind_verified'
                    ? 'Décision Gemini à l’aveugle (Dossiers anonymisés)'
                    : 'Moteur Quantitatif Point-in-Time + Archives d’époque'}
              </span>
            </span>
            <span aria-hidden="true" className="text-texte-doux hidden sm:inline">
              ·
            </span>
            <button
              type="button"
              onClick={() => setShowBlindProtocolDrawer((v) => !v)}
              className="min-h-11 text-xs text-texte-doux hover:text-texte underline decoration-bordure-champ hover:decoration-accent underline-offset-4 cursor-pointer whitespace-nowrap"
            >
              {showBlindProtocolDrawer
                ? 'Masquer les dossiers anonymisés'
                : 'Vérifier le protocole anti-triche (ACTIF_01..12)'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {blindAuditedCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setUseQuantOnlyComparison((v) => !v)}
                  className="min-h-11 px-3 py-1.5 text-xs font-medium text-texte hover:text-texte bg-surface hover:bg-surface-douce border border-bordure rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                >
                  {useQuantOnlyComparison
                    ? 'Réactiver choix Gemini'
                    : 'Comparer au Quant seul'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBlindOverrides({});
                    setAuditStatusBanner('Cache des tests à l’aveugle réinitialisé.');
                  }}
                  title="Réinitialiser les tests Gemini en cache"
                  className="min-w-11 min-h-11 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-texte-doux hover:text-texte bg-fond border border-bordure rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Réinitialiser</span>
                </button>
              </>
            )}

            <button
              type="button"
              disabled={Boolean(runningEpochId)}
              onClick={() => handleRunBlindTest(selectedView)}
              className="min-w-11 min-h-11 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {runningEpochId ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>
                {runningEpochId
                  ? 'Délibération à l’aveugle en cours…'
                  : selectedView === 'all'
                    ? 'Tester Gemini à l’aveugle (4 époques)'
                    : hasBlindForActiveEpoch
                      ? `Relancer Gemini à l’aveugle (${activeEpochAudit.shortLabel})`
                      : `Tester Gemini à l’aveugle (${activeEpochAudit.shortLabel})`}
              </span>
            </button>
          </div>
        </div>

        {auditStatusBanner && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            role="status"
            className="px-4 py-2.5 bg-surface/75 border border-bordure rounded-xl flex items-center justify-between gap-3 text-xs text-texte"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Check className="w-4 h-4 text-succes-texte shrink-0" />
              <span className="truncate">{auditStatusBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setAuditStatusBanner(null)}
              className="min-h-11 text-texte-doux hover:text-texte text-xs shrink-0 cursor-pointer"
            >
              Fermer
            </button>
          </motion.div>
        )}

        {/* Collapsible Anti-Lookahead Anonymized Dossier Inspector */}
        <AnimatePresence initial={false}>
          {showBlindProtocolDrawer && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-4 sm:p-5 bg-fond border border-bordure rounded-2xl space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                  <h3 className="text-xs sm:text-sm font-semibold text-texte">
                    Protocole d’Anonymisation transmis à Gemini ({activeEpochAudit.shortLabel})
                  </h3>
                  <span className="text-[11px] font-mono text-texte-doux">
                    0 nom de société · 0 ticker · 0 année civile · Ratios arrêtés au{' '}
                    {activeEpochAudit.startDateDisplay}
                  </span>
                </div>
                <p className="text-xs text-texte-doux leading-relaxed">
                  Pour empêcher l’IA d’utiliser sa mémoire pré-entraînée (par exemple savoir en 2016 quelle action explosera en 2024), chaque candidat est mélangé aléatoirement et soumis sous un code neutre. Le serveur ne lève l’anonymat qu’après réception des pondérations.
                </p>

                <div className="overflow-x-auto border-t border-bordure pt-2">
                  <table className="w-full text-left text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="text-texte-doux border-b border-bordure">
                        <th className="py-2 pr-3 font-medium">Code Aveugle</th>
                        <th className="py-2 px-3 font-sans font-medium">Secteur Anonymisé</th>
                        <th className="py-2 px-3 text-right font-medium">PER T0</th>
                        <th className="py-2 px-3 text-right font-medium">ROIC−WACC</th>
                        <th className="py-2 px-3 text-right font-medium">Marge FCF</th>
                        <th className="py-2 pl-3 font-sans font-medium">
                          Résumé transmis à l’aveugle
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-bordure text-texte">
                      {activeEpochAudit.anonymizedServerRequest.dossiers
                        .slice(0, 8)
                        .map((d) => (
                          <tr key={d.blindCode} className="hover:bg-surface/40">
                            <td className="py-2 pr-3 font-semibold text-succes-texte whitespace-nowrap">
                              {d.blindCode}
                            </td>
                            <td className="py-2 px-3 font-sans text-texte whitespace-nowrap">
                              {d.sectorGeneral}
                            </td>
                            <td className="py-2 px-3 text-right">{d.forwardPe.toFixed(1)}x</td>
                            <td className="py-2 px-3 text-right">
                              {formatSignedPct(d.roicMinusWaccPct, 1)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {formatPct(d.fcfMarginPct, 1)}
                            </td>
                            <td className="py-2 pl-3 font-sans text-texte-doux max-w-md truncate">
                              {d.anonymizedCatalystSummary}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* =================================================================== */}
      {/* 03A. SYNTHESIS VIEW ACROSS ALL 4 EPOCHS                             */}
      {/* =================================================================== */}
      {selectedView === 'all' ? (
        <motion.div
          key="retro-all-epochs"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="space-y-8"
        >
          {/* Cumulative 4-Epoch Scorecard */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-bordure bg-surface/25 border border-bordure rounded-2xl p-5 font-mono tabular-nums">
            <div className="pb-4 sm:pb-0 sm:pr-5 space-y-1">
              <span className="block font-sans text-xs text-texte-doux">
                4 mises de {formatEur(initialCapitalCad, 0)} chez l’IA
              </span>
              <div className="text-xl font-semibold text-succes-texte">
                {formatEur(globalSummary.cumulativeAiFinal4EpochsCad, 0)}
              </div>
              <span className="block font-sans text-[11px] text-texte-doux">
                Investi total : {formatEur(globalSummary.cumulativeInvested4EpochsCad, 0)}
              </span>
            </div>

            <div className="py-4 sm:py-0 sm:px-5 space-y-1">
              <span className="block font-sans text-xs text-texte-doux">
                Même effort sur Mon Portefeuille
              </span>
              <div className="text-xl font-semibold text-texte">
                {formatEur(globalSummary.cumulativeUserFinal4EpochsCad, 0)}
              </div>
              <span className="block text-[11px] text-succes-texte">
                {formatSignedEur(
                  globalSummary.cumulativeAiFinal4EpochsCad -
                    globalSummary.cumulativeUserFinal4EpochsCad,
                  0
                )}{' '}
                pour l’IA
              </span>
            </div>

            <div className="py-4 sm:py-0 sm:px-5 space-y-1">
              <span className="block font-sans text-xs text-texte-doux">
                Même effort sur Actions Mondiales (XEQT)
              </span>
              <div className="text-xl font-semibold text-accent">
                {formatEur(globalSummary.cumulativeWorldFinal4EpochsCad, 0)}
              </div>
              <span className="block text-[11px] text-succes-texte">
                {formatSignedEur(
                  globalSummary.cumulativeAiFinal4EpochsCad -
                    globalSummary.cumulativeWorldFinal4EpochsCad,
                  0
                )}{' '}
                d’alpha cumulé
              </span>
            </div>

            <div className="pt-4 sm:pt-0 sm:pl-5 space-y-1">
              <span className="block font-sans text-xs text-texte-doux">
                Même effort tiré au Hasard (Médiane)
              </span>
              <div className="text-xl font-semibold text-texte">
                {formatEur(globalSummary.cumulativeRandomFinal4EpochsCad, 0)}
              </div>
              <span className="block text-[11px] text-succes-texte">
                {formatSignedEur(
                  globalSummary.cumulativeAiFinal4EpochsCad -
                    globalSummary.cumulativeRandomFinal4EpochsCad,
                  0
                )}{' '}
                vs hasard
              </span>
            </div>
          </section>

          {/* 4-Epoch Detailed Comparison Table */}
          <section className="bg-surface/30 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
              <h2 className="text-sm sm:text-base font-semibold text-texte">
                Comparatif Direct des 4 Horizons Rétrospectifs ($ CAD)
              </h2>
              <span className="text-xs text-texte-doux">
                Cliquez sur une époque pour inspecter ses actualités d’archive et sa courbe D3
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead>
                  <tr className="text-texte-doux border-b border-bordure">
                    <th className="py-3 pr-4 font-sans font-medium">Époque &amp; Contexte</th>
                    <th className="py-3 px-3 font-sans font-medium">Top Convictions IA à T0</th>
                    <th className="py-3 px-3 text-right font-medium">IA Aujourd’hui</th>
                    <th className="py-3 px-3 text-right font-medium">Mon Portefeuille</th>
                    <th className="py-3 px-3 text-right font-medium">MSCI World</th>
                    <th className="py-3 px-3 text-right font-medium">Hasard Médian</th>
                    <th className="py-3 pl-3 text-right font-sans font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bordure">
                  {globalSummary.epochs.map((ep) => {
                    const topTickers = ep.picks
                      .slice(0, 3)
                      // NOMBRE-NON-MONETAIRE : pondérations modèles de l'époque historique
                      .map((p) => `${p.ticker} (${p.weightPct.toFixed(0)}%)`)
                      .join(' · ');
                    return (
                      <tr
                        key={ep.epochId}
                        onClick={() => setSelectedView(ep.epochId)}
                        className="hover:bg-surface/60 transition-colors cursor-pointer"
                      >
                        <td className="py-4 pr-4 font-sans">
                          <div className="font-semibold text-texte">
                            {ep.shortLabel} ({ep.startDateDisplay})
                          </div>
                          <div className="text-[11px] text-texte-doux mt-0.5 max-w-[240px] truncate">
                            {ep.macroAtEpoch.regimeTitle}
                          </div>
                        </td>
                        <td className="py-4 px-3 text-texte whitespace-nowrap">
                          <div>{topTickers}</div>
                          <div className="font-sans text-[11px] text-texte-doux mt-0.5">
                            Bat {ep.beatRandomPortfoliosPct} % des tirages aléatoires
                          </div>
                        </td>
                        <td className="py-4 px-3 text-right">
                          <div className="font-semibold text-succes-texte">
                            {formatEur(ep.aiFinalCad, 0)}
                          </div>
                          <div className="text-[11px] text-succes-texte">
                            {formatSignedPct(ep.aiTotalReturnPct, 1)}
                          </div>
                        </td>
                        <td className="py-4 px-3 text-right">
                          <div className="text-texte">
                            {formatEur(ep.userFinalCad, 0)}
                          </div>
                          <div
                            className={`text-[11px] ${
                              ep.userTotalReturnPct >= 0
                                ? 'text-texte-doux'
                                : 'text-erreur-texte'
                            }`}
                          >
                            {formatSignedPct(ep.userTotalReturnPct, 1)}
                          </div>
                        </td>
                        <td className="py-4 px-3 text-right">
                          <div className="text-accent">
                            {formatEur(ep.worldFinalCad, 0)}
                          </div>
                          <div className="text-[11px] text-texte-doux">
                            {formatSignedPct(ep.worldTotalReturnPct, 1)}
                          </div>
                        </td>
                        <td className="py-4 px-3 text-right">
                          <div className="text-texte">
                            {formatEur(ep.randomMedianFinalCad, 0)}
                          </div>
                          <div className="text-[11px] text-texte-doux">
                            {formatSignedPct(ep.randomMedianReturnPct, 1)}
                          </div>
                        </td>
                        <td className="py-4 pl-3 text-right font-sans">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-texte hover:text-texte whitespace-nowrap">
                            <span>Explorer</span>
                            <ArrowRight className="w-3.5 h-3.5 text-succes-texte" />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </motion.div>
      ) : (
        /* =================================================================== */
        /* 03B. SINGLE EPOCH DEEP RETROSPECTIVE WORKSPACE                      */
        /* =================================================================== */
        <motion.div
          key={`retro-epoch-${activeEpochAudit.epochId}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="space-y-8 sm:space-y-10"
        >
          {/* 4-Way Outcome Strip ($ CAD) */}
          <section
            aria-label="Résultat aujourd’hui des 4 approches"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-bordure py-2 border-y border-bordure font-mono tabular-nums"
          >
            <div className="pb-4 sm:pb-2 sm:pr-5 space-y-1">
              <span className="block font-sans text-xs text-texte-doux">
                01. Sélection IA ({activeEpochAudit.startDateDisplay})
              </span>
              <div className="text-2xl font-semibold text-succes-texte">
                <AnimatedNumber
                  value={activeEpochAudit.aiFinalCad}
                  formatter={(n) => formatEur(n, 0)}
                />
              </div>
              <div className="text-xs text-succes-texte">
                ▲ {formatSignedPct(activeEpochAudit.aiTotalReturnPct, 1)} · Repli max −
                {activeEpochAudit.aiMaxDrawdownPct.toFixed(1).replace('.', ',')} %
              </div>
            </div>

            <div className="py-4 sm:py-2 sm:px-5 space-y-1">
              <span className="block font-sans text-xs text-texte-doux">
                02. Mon portefeuille actuel (rejoué)
              </span>
              <div className="text-2xl font-semibold text-texte">
                <AnimatedNumber
                  value={activeEpochAudit.userFinalCad}
                  formatter={(n) => formatEur(n, 0)}
                />
              </div>
              <div className="text-xs text-texte-doux">
                {formatSignedPct(activeEpochAudit.userTotalReturnPct, 1)} · Écart IA{' '}
                <strong
                  className={
                    activeEpochAudit.alphaVsUserPct >= 0
                      ? 'text-succes-texte font-medium'
                      : 'text-erreur-texte font-medium'
                  }
                >
                  {activeEpochAudit.alphaVsUserPct >= 0 ? '+' : ''}
                  {activeEpochAudit.alphaVsUserPct.toFixed(1).replace('.', ',')} pts
                </strong>
              </div>
            </div>

            <div className="py-4 sm:py-2 sm:px-5 space-y-1">
              <span className="block font-sans text-xs text-texte-doux">
                03. Indice Mondial (MSCI World)
              </span>
              <div className="text-2xl font-semibold text-accent">
                <AnimatedNumber
                  value={activeEpochAudit.worldFinalCad}
                  formatter={(n) => formatEur(n, 0)}
                />
              </div>
              <div className="text-xs text-texte-doux">
                {formatSignedPct(activeEpochAudit.worldTotalReturnPct, 1)} · Gain IA{' '}
                <strong
                  className={
                    activeEpochAudit.extraGainVsWorldCad >= 0
                      ? 'text-succes-texte font-medium'
                      : 'text-erreur-texte font-medium'
                  }
                >
                  {formatSignedEur(activeEpochAudit.extraGainVsWorldCad, 0)}
                </strong>
              </div>
            </div>

            <div className="pt-4 sm:pt-2 sm:pl-5 space-y-1">
              <span className="block font-sans text-xs text-texte-doux">
                04. Hasard (250 portefeuilles aléatoires)
              </span>
              <div className="text-2xl font-semibold text-texte">
                <AnimatedNumber
                  value={activeEpochAudit.randomMedianFinalCad}
                  formatter={(n) => formatEur(n, 0)}
                />
              </div>
              <div className="text-xs text-texte-doux">
                Médiane {formatSignedPct(activeEpochAudit.randomMedianReturnPct, 1)} ·{' '}
                <strong className="text-succes-texte font-medium">
                  Bat {activeEpochAudit.beatRandomPortfoliosPct} %
                </strong>
              </div>
            </div>
          </section>

          {/* 2-Column Split: What AI Saw Then (Left) vs Real Outcome Curve Today (Right) */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left Column: Point-in-Time Historical Context & News Archive */}
            <div className="lg:col-span-5 bg-surface/30 border border-bordure rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                <div className="pb-3 border-b border-bordure space-y-1">
                  <div className="text-xs text-alerte-texte font-medium">
                    Ce que l’IA voyait au {activeEpochAudit.startDateDisplay}
                  </div>
                  <h2 className="text-sm sm:text-base font-semibold text-texte">
                    {activeEpochAudit.macroAtEpoch.regimeTitle}
                  </h2>
                  <p className="text-xs font-mono tabular-nums text-texte-doux pt-0.5">
                    Inflation {formatPct(activeEpochAudit.macroAtEpoch.inflationPct, 1)} · Taux{' '}
                    {formatPct(activeEpochAudit.macroAtEpoch.centralBankRatePct, 2)} · PIB{' '}
                    {formatSignedPct(activeEpochAudit.macroAtEpoch.gdpGrowthPct, 1)} · VIX{' '}
                    {activeEpochAudit.macroAtEpoch.vixLevel.toFixed(1).replace('.', ',')}
                  </p>
                </div>

                {/* Point-in-Time News Dispatches */}
                <div className="space-y-3">
                  <div className="text-xs font-medium text-texte">
                    Actualités &amp; signaux dominants à cette date :
                  </div>
                  <div className="divide-y divide-bordure border-y border-bordure">
                    {activeEpochAudit.newsAtEpoch.map((news) => (
                      <article key={news.id} className="py-3 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-texte-doux">
                          <span className="font-mono text-texte">
                            {news.publishedDateLabel}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{news.source}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              news.macroOrSectorImpulse === 'positif'
                                ? 'text-succes-texte'
                                : news.macroOrSectorImpulse === 'negatif'
                                  ? 'text-erreur-texte'
                                  : 'text-alerte-texte'
                            }
                          >
                            {news.sectorTag}
                          </span>
                        </div>
                        <h3 className="text-xs font-semibold text-texte leading-snug">
                          {news.headline}
                        </h3>
                        <p className="text-xs text-texte-doux leading-relaxed">
                          {news.summaryAtEpoch}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              </div>

              {/* AI Point-in-Time Thesis */}
              <div className="pt-2 space-y-2 text-xs">
                <div className="font-semibold text-texte">
                  Décision stratégique formulée à l’époque :
                </div>
                <p className="text-texte leading-relaxed">
                  {activeEpochAudit.macroReadingFr}
                </p>
                <p className="text-texte-doux leading-relaxed">
                  {activeEpochAudit.allocationPhilosophyFr}
                </p>
              </div>
            </div>

            {/* Right Column: D3 Trajectory & Honest Usefulness Verdict */}
            <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
              <D3AiTimeMachineChart
                series={activeEpochAudit.series}
                initialCapitalCad={activeEpochAudit.initialCapitalCad}
                epochHorizonLabel={`${activeEpochAudit.horizonLabel} · Mise initiale ${formatEur(
                  activeEpochAudit.initialCapitalCad,
                  0
                )}`}
              />

              <div className="bg-surface/30 border border-bordure rounded-2xl p-4 sm:p-5 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-succes-texte">
                    {activeEpochAudit.verdictHeadlineFr}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-texte-doux">
                    Précision : {activeEpochAudit.winningPicksCount}/
                    {activeEpochAudit.picks.length} paris positifs
                  </span>
                </div>
                <p className="text-xs text-texte-doux leading-relaxed">
                  {activeEpochAudit.honestNuanceFr}
                </p>
              </div>
            </div>
          </section>

          {/* ================================================================= */}
          {/* 04. AUDITABLE LEDGER: WHAT AI BOUGHT AT T0 vs WORTH TODAY         */}
          {/* ================================================================= */}
          <section className="space-y-6">
            <div className="bg-surface/30 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-3 border-b border-bordure">
                <div>
                  <h2 className="text-sm sm:text-base font-semibold text-texte">
                    01. Ce que l’IA a recommandé d’acheter le{' '}
                    {activeEpochAudit.startDateDisplay} — et ce que ça vaut aujourd’hui
                  </h2>
                  <p className="text-xs text-texte-doux mt-0.5">
                    Cliquez sur un actif pour ouvrir sa fiche fondamentale et technique complète
                  </p>
                </div>
                <span className="font-mono tabular-nums text-xs text-succes-texte shrink-0">
                  {formatEur(activeEpochAudit.initialCapitalCad, 0)} →{' '}
                  {formatEur(activeEpochAudit.aiFinalCad, 0)}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="text-texte-doux border-b border-bordure">
                      <th className="py-2.5 pr-3 font-sans font-medium">Actif choisi à T0</th>
                      <th className="py-2.5 px-2.5 text-right font-medium">Poids &amp; Mise</th>
                      <th className="py-2.5 px-2.5 text-right font-medium">
                        Cours T0 → Auj.
                      </th>
                      <th className="py-2.5 px-3 font-sans font-medium">
                        Pourquoi l’IA l’a choisi à l’époque
                      </th>
                      <th className="py-2.5 px-2.5 text-right font-medium">
                        Valeur Auj. ($ CAD)
                      </th>
                      <th className="py-2.5 pl-3 text-right font-sans font-medium">
                        Verdict Réel
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bordure">
                    {activeEpochAudit.picks.map((pick) => {
                      const isPositive = pick.realizedReturnPct >= 0;
                      return (
                        <tr
                          key={pick.assetId}
                          onClick={() => onInspectAsset(pick.assetId)}
                          className="hover:bg-surface/55 transition-colors cursor-pointer"
                        >
                          <td className="py-3.5 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-texte">
                                {pick.ticker}
                              </span>
                              <span className="text-[11px] text-texte-doux">
                                · {pick.blindCode}
                              </span>
                            </div>
                            <div className="font-sans text-[11px] text-texte-doux truncate max-w-[190px]">
                              {pick.name.split(' (')[0]}
                            </div>
                          </td>

                          <td className="py-3.5 px-2.5 text-right whitespace-nowrap">
                            <div className="text-texte font-medium">
                              {pick.weightPct.toFixed(1).replace('.', ',')} %
                            </div>
                            <div className="text-[11px] text-texte-doux">
                              {formatEur(pick.allocatedCad, 0)}
                            </div>
                          </td>

                          <td className="py-3.5 px-2.5 text-right whitespace-nowrap text-texte">
                            {formatPriceCad(pick.entryPriceCad)} →{' '}
                            <strong className="text-texte">
                              {formatPriceCad(pick.currentPriceCad)}
                            </strong>
                          </td>

                          <td className="py-3.5 px-3 font-sans text-texte max-w-xs leading-relaxed">
                            {pick.pointInTimeThesisFr}
                          </td>

                          <td className="py-3.5 px-2.5 text-right whitespace-nowrap">
                            <div className="font-semibold text-texte">
                              {formatEur(pick.finalValueCad, 0)}
                            </div>
                            <div
                              className={`text-[11px] ${
                                isPositive ? 'text-succes-texte' : 'text-erreur-texte'
                              }`}
                            >
                              {formatSignedPct(pick.realizedReturnPct, 1)} (
                              {formatSignedEur(pick.netProfitCad, 0)})
                            </div>
                          </td>

                          <td className="py-3.5 pl-3 text-right font-sans whitespace-nowrap">
                            <span
                              className={`text-xs font-medium ${
                                pick.verdictBadge === 'PARI GAGNANT'
                                  ? 'text-succes-texte'
                                  : pick.verdictBadge === 'GAIN MODÉRÉ'
                                    ? 'text-alerte-texte'
                                    : 'text-erreur-texte'
                              }`}
                            >
                              {pick.verdictBadge === 'PARI GAGNANT'
                                ? '▲ Pari gagnant'
                                : pick.verdictBadge === 'GAIN MODÉRÉ'
                                  ? '▲ Positif (< indice)'
                                  : '▼ Erreur IA'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 02. Avoided Traps Table */}
            <div className="bg-surface/25 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-3 border-b border-bordure">
                <div>
                  <h2 className="text-sm sm:text-base font-semibold text-texte">
                    02. Les pièges écartés par l’IA le {activeEpochAudit.startDateDisplay}
                  </h2>
                  <p className="text-xs text-texte-doux mt-0.5">
                    Savoir quoi ne pas acheter compte autant que trouver les gagnants (ex. bulles de multiples ou bilans fragiles)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {activeEpochAudit.avoids.map((av) => (
                  <button
                    key={av.assetId}
                    type="button"
                    onClick={() => onInspectAsset(av.assetId)}
                    className="min-h-11 text-left p-4 bg-fond/60 hover:bg-surface/70 border border-bordure rounded-xl space-y-2 transition-colors cursor-pointer"
                  >
                    <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
                      <span className="text-sm font-semibold text-texte">
                        {av.ticker}{' '}
                        <span className="text-[11px] font-normal text-texte-doux">
                          · {av.blindCode}
                        </span>
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          av.realizedReturnPct < 0 ? 'text-erreur-texte' : 'text-texte-doux'
                        }`}
                      >
                        {formatSignedPct(av.realizedReturnPct, 1)} depuis T0
                      </span>
                    </div>

                    <p className="text-xs text-texte-doux leading-relaxed">
                      {av.pointInTimeAvoidReasonFr}
                    </p>

                    <div className="pt-1 border-t border-bordure flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="text-texte-doux">
                        {formatPriceCad(av.entryPriceCad)} → {formatPriceCad(av.currentPriceCad)}
                      </span>
                      <span
                        className={
                          av.avoidCorrect ? 'text-succes-texte' : 'text-alerte-texte'
                        }
                      >
                        {av.avoidCorrect
                          ? `▲ Écarté à raison (+${av.relativeSavedVsAiPct.toFixed(0)} pts IA)`
                          : '● A finalement monté'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </motion.div>
      )}

      {/* Bridge to Current Recommendations */}
      <section className="py-4 px-5 bg-surface/35 border border-bordure rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-texte">
            Appliquer cette même discipline quantitative à votre portefeuille d’aujourd’hui
          </h3>
          <p className="text-xs text-texte-doux">
            Consultez les arbitrages actuels calculés avec le même filtre ROIC-WACC, marge de cash-flow libre et décote DCF en $ CAD.
          </p>
        </div>
        <button
          type="button"
          onClick={onNavigateToRecommendations}
          className="min-w-11 min-h-11 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-texte bg-surface-douce hover:bg-surface-douce border border-bordure-champ rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Voir ce que l’IA recommande aujourd’hui</span>
          <ArrowRight className="w-3.5 h-3.5 text-succes-texte" />
        </button>
      </section>
    </div>
  );
};

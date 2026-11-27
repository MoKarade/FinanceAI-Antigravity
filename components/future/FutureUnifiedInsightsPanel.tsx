// components/future/FutureUnifiedInsightsPanel.tsx
// Futur 4.0 — Bloc 4 : Panneau unifié en 3 parties :
//   A. Ce que ton passé réel & les actualités disent aujourd'hui
//   B. Pourquoi ta courbe évolue ainsi (tournants majeurs + preuves chiffrées dépliables + focus courbe)
//   C. Tes actions concrètes les plus payantes
// Strict : variables sémantiques uniquement, cibles >= 44 px, mode discret protégé.

import React, { useState } from 'react';
import type {
    DeepForecastReport,
    DeepScenarioId,
    DeepScenarioOutput,
    DeepTurningPointKind,
    MacroNewsSignalItem,
} from '../../services/projection/deepForecastTypes';
import type { ReconciledAiAction } from '../../services/projection/aiActionPlan';
import { Tab } from '../../types';
import { formatCAD, formatCompactCAD, formatPercent } from '../../utils/format';
import { Icon } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { PrivateText } from '../ui/PrivateText';

export interface FutureUnifiedInsightsPanelProps {
    report: DeepForecastReport;
    scenario: DeepScenarioOutput;
    onFocusMonth: (monthIndex: number) => void;
    onSelectScenario: (id: DeepScenarioId) => void;
    onNavigateTab?: (tab: Tab) => void;
    reconciledActions?: ReconciledAiAction[];
    completedActionIds?: string[];
    onToggleActionCompleted?: (actionId: string) => void;
    onApplyActionPatch?: (action: ReconciledAiAction) => void;
    sectionMode?: 'all' | 'details' | 'actions';
}

const TURNING_KIND_META: Record<DeepTurningPointKind, { label: string; cls: string }> = {
    past: { label: 'Passé réel', cls: 'bg-surface-douce text-texte border-bordure-champ' },
    macro: { label: 'Macro & actus', cls: 'bg-repere-doux text-repere border-repere/35' },
    fiscal: { label: 'Fiscalité ARC/RQ', cls: 'bg-surface-douce text-texte border-bordure-champ' },
    milestone: { label: 'Jalon clé', cls: 'bg-succes-fond text-succes-texte border-succes-texte/30' },
    risk: { label: 'Vigilance', cls: 'bg-alerte-fond text-alerte-texte border-alerte-texte/35' },
    optimization: { label: 'Optimisation IA', cls: 'bg-succes-fond text-succes-texte border-succes-texte/30' },
};

const SIGNAL_DIRECTION_META: Record<MacroNewsSignalItem['direction'], { label: string; cls: string }> = {
    positif: { label: 'Porteur', cls: 'bg-succes-fond text-succes-texte border-succes-texte/30' },
    neutre: { label: 'Neutre', cls: 'bg-surface-douce text-texte-doux border-bordure' },
    risque: { label: 'Vigilance', cls: 'bg-erreur-fond text-erreur-texte border-erreur-texte/30' },
};

const TAB_LABELS: Partial<Record<Tab, string>> = {
    [Tab.BUDGET]: 'Budget',
    [Tab.INVESTMENTS]: 'Placements',
    [Tab.RETIREMENT]: 'Retraite',
    [Tab.TAX]: 'Impôts',
    [Tab.DEBT]: 'Dettes',
    [Tab.REAL_ESTATE]: 'Immobilier',
    [Tab.REAL_ESTATE_PROJECTS]: 'Projets immo',
    [Tab.LIFE_PROJECTS]: 'Projets de vie',
    [Tab.TRANSACTIONS]: 'Transactions',
    [Tab.PROFILE]: 'Profil',
    [Tab.VALORIA]: 'Valoria',
};

function resolveActionTab(targetTab?: string): Tab | null {
    if (!targetTab) return null;
    const values = Object.values(Tab) as string[];
    if (values.includes(targetTab) && targetTab !== Tab.FUTURE) {
        return targetTab as Tab;
    }
    return null;
}

export const FutureUnifiedInsightsPanel: React.FC<FutureUnifiedInsightsPanelProps> = ({
    report,
    scenario,
    onFocusMonth,
    onSelectScenario,
    onNavigateTab,
    reconciledActions,
    completedActionIds = [],
    onToggleActionCompleted,
    onApplyActionPatch,
    sectionMode = 'all',
}) => {
    const [expandedTurningIds, setExpandedTurningIds] = useState<Record<string, boolean>>({});
    const past = report.pastDiagnostic;
    const news = report.newsBundle;
    const valoria = report.valoriaSummary;

    const toggleTurningDetails = (id: string) => {
        setExpandedTurningIds((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    const isLiveNews = news.liveArticlesUsed > 0 && !news.offlineFallbackUsed;
    const hasPastGap = past.monthlySpendingGapCad !== null && Number.isFinite(past.monthlySpendingGapCad);
    const gapVal = hasPastGap ? (past.monthlySpendingGapCad as number) : null;

    return (
        <section
            aria-labelledby="futur-insights-unifies-titre"
            className="rounded-2xl border border-bordure bg-surface p-4 sm:p-5 lg:p-6 space-y-6"
        >
            <div className="space-y-1 border-b border-bordure pb-3">
                <h2 id="futur-insights-unifies-titre" className="text-h2 text-texte">
                    Analyse unifiée · {scenario.label}
                </h2>
                <p className="text-meta text-texte-doux">
                    <PrivateText quoi="memo">{scenario.shortDescription}</PrivateText>
                </p>
            </div>

            {(sectionMode === 'all' || sectionMode === 'details') && (
            <>
            {/* A. Ce que ton passé réel & les actualités disent aujourd'hui */}
            <div className="space-y-3">
                <h3 className="text-meta font-bold uppercase tracking-wider text-repere flex items-center gap-2">
                    <Icon name="compass" size={16} className="text-repere shrink-0" />
                    <span>A. Ce que ton passé réel &amp; les actualités disent aujourd&apos;hui</span>
                </h3>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Diagnostic du passé réel */}
                    <div className="rounded-xl border border-bordure bg-surface-douce p-4 space-y-3 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-body font-bold text-texte">Diagnostic de ton passé réel</span>
                            <span className="text-tiny text-texte-doux">
                                {past.transactionsAnalyzed > 0 ? (
                                    <PrivateText quoi="memo">
                                        {`${past.transactionsAnalyzed} opérations · ${past.monthsCovered} mois`}
                                    </PrivateText>
                                ) : (
                                    'Historique non mesuré'
                                )}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                            <div className="rounded-lg border border-bordure bg-fond p-2.5 min-w-0">
                                <div className="text-tiny text-texte-doux">Épargne réelle observée</div>
                                <div className="text-body font-mono font-bold text-texte tabular-nums mt-0.5">
                                    <PrivateAmount>
                                        {past.observedSavingsRatePct !== null && Number.isFinite(past.observedSavingsRatePct)
                                            ? formatPercent(past.observedSavingsRatePct, 1)
                                            : '—'}
                                    </PrivateAmount>
                                </div>
                            </div>

                            <div className="rounded-lg border border-bordure bg-fond p-2.5 min-w-0">
                                <div className="text-tiny text-texte-doux">Écart dépenses vs budget</div>
                                <div
                                    className={`text-body font-mono font-bold tabular-nums mt-0.5 ${
                                        gapVal === null
                                            ? 'text-texte'
                                            : gapVal > 40
                                              ? 'text-alerte-texte'
                                              : 'text-succes-texte'
                                    }`}
                                >
                                    <PrivateAmount>
                                        {gapVal !== null
                                            ? `${gapVal > 0 ? '+' : ''}${formatCAD(Math.round(gapVal))}/mois`
                                            : '—'}
                                    </PrivateAmount>
                                </div>
                            </div>

                            <div className="rounded-lg border border-bordure bg-fond p-2.5 min-w-0">
                                <div className="text-tiny text-texte-doux">Dérive du train de vie</div>
                                <div className="text-body font-mono font-bold text-texte tabular-nums mt-0.5">
                                    <PrivateAmount>
                                        {past.lifestyleCreepAnnualPct !== null && Number.isFinite(past.lifestyleCreepAnnualPct)
                                            ? `${past.lifestyleCreepAnnualPct > 0 ? '+' : ''}${formatPercent(past.lifestyleCreepAnnualPct, 1)}/an`
                                            : '—'}
                                    </PrivateAmount>
                                </div>
                            </div>

                            <div className="rounded-lg border border-bordure bg-fond p-2.5 min-w-0">
                                <div className="text-tiny text-texte-doux">RFG moyen &amp; fuite US/frais</div>
                                <div className="text-body font-mono font-bold text-texte tabular-nums mt-0.5 break-words">
                                    <PrivateAmount>
                                        {past.weightedMerPct !== null && Number.isFinite(past.weightedMerPct)
                                            ? formatPercent(past.weightedMerPct, 2)
                                            : '—'}
                                    </PrivateAmount>
                                    {past.estimatedAnnualFeeAndTaxDragCad !== null &&
                                        Number.isFinite(past.estimatedAnnualFeeAndTaxDragCad) && (
                                            <span className="text-tiny font-normal text-texte-doux">
                                                {' · '}
                                                <PrivateAmount>
                                                    {`${formatCAD(Math.round(past.estimatedAnnualFeeAndTaxDragCad))}/an`}
                                                </PrivateAmount>
                                            </span>
                                        )}
                                </div>
                            </div>

                            <div className="rounded-lg border border-bordure bg-fond p-2.5 min-w-0">
                                <div className="text-tiny text-texte-doux">Courbe placements (depuis janv. 2025)</div>
                                <div className="text-body font-mono font-bold text-texte tabular-nums mt-0.5 break-words">
                                    <PrivateAmount>
                                        {past.pastCurveCalibration?.hasUsableCurve &&
                                        past.pastCurveCalibration.realizedAnnualizedReturnPct !== null &&
                                        Number.isFinite(past.pastCurveCalibration.realizedAnnualizedReturnPct)
                                            ? `${past.pastCurveCalibration.realizedAnnualizedReturnPct > 0 ? '+' : ''}${formatPercent(past.pastCurveCalibration.realizedAnnualizedReturnPct, 1)}/an`
                                            : '—'}
                                    </PrivateAmount>
                                    {past.pastCurveCalibration?.hasUsableCurve &&
                                        past.pastCurveCalibration.realizedAnnualizedVolatilityPct !== null &&
                                        Number.isFinite(past.pastCurveCalibration.realizedAnnualizedVolatilityPct) && (
                                            <span className="text-tiny font-normal text-texte-doux">
                                                {' · vol. '}
                                                <PrivateAmount>
                                                    {formatPercent(past.pastCurveCalibration.realizedAnnualizedVolatilityPct, 1)}
                                                </PrivateAmount>
                                            </span>
                                        )}
                                </div>
                            </div>

                            <div className="rounded-lg border border-bordure bg-fond p-2.5 min-w-0">
                                <div className="text-tiny text-texte-doux">Creux max &amp; variation (depuis janv. 2025)</div>
                                <div className="text-body font-mono font-bold text-texte tabular-nums mt-0.5 break-words">
                                    <PrivateAmount>
                                        {past.pastCurveCalibration?.hasUsableCurve &&
                                        past.pastCurveCalibration.realizedMaxDrawdownPct !== null &&
                                        Number.isFinite(past.pastCurveCalibration.realizedMaxDrawdownPct)
                                            ? formatPercent(past.pastCurveCalibration.realizedMaxDrawdownPct, 1)
                                            : '—'}
                                    </PrivateAmount>
                                    {past.pastCurveCalibration?.realizedNetWorthDeltaCad !== null &&
                                        past.pastCurveCalibration?.realizedNetWorthDeltaCad !== undefined &&
                                        Number.isFinite(past.pastCurveCalibration.realizedNetWorthDeltaCad) && (
                                            <span className="text-tiny font-normal text-texte-doux">
                                                {' · '}
                                                <PrivateAmount>
                                                    {`${past.pastCurveCalibration.realizedNetWorthDeltaCad > 0 ? '+' : ''}${formatCAD(Math.round(past.pastCurveCalibration.realizedNetWorthDeltaCad))}`}
                                                </PrivateAmount>
                                            </span>
                                        )}
                                </div>
                            </div>
                        </div>

                        {past.findingsFr.length > 0 && (
                            <ul className="space-y-1.5 pt-1 border-t border-bordure text-tiny text-texte-doux">
                                {past.findingsFr.slice(0, 4).map((finding, idx) => (
                                    <li key={idx} className="flex items-start gap-2 min-w-0">
                                        <span className="text-repere shrink-0" aria-hidden="true">•</span>
                                        <span className="break-words">
                                            <PrivateText quoi="memo">{finding}</PrivateText>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Actualités & Consensus Valoria */}
                    <div className="rounded-xl border border-bordure bg-surface-douce p-4 space-y-3 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-body font-bold text-texte">Actualités &amp; consensus Valoria</span>
                            <span
                                className={`px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${
                                    isLiveNews
                                        ? 'bg-succes-fond text-succes-texte border-succes-texte/30'
                                        : 'bg-fond text-texte-doux border-bordure'
                                }`}
                            >
                                {isLiveNews
                                    ? `En direct (${news.liveArticlesUsed} article${news.liveArticlesUsed > 1 ? 's' : ''})`
                                    : 'Repli hors-ligne'}
                            </span>
                        </div>

                        {valoria && (
                            <div className="rounded-lg border border-bordure bg-fond px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 text-tiny">
                                <span className="font-semibold text-texte">
                                    Valoria : {valoria.consensusTitle} ({valoria.regimeName})
                                </span>
                                <span className="font-mono text-texte tabular-nums">
                                    Score{' '}
                                    <PrivateAmount>
                                        {valoria.consensus100 !== null && Number.isFinite(valoria.consensus100)
                                            ? Math.round(valoria.consensus100)
                                            : '—'}
                                    </PrivateAmount>
                                    /100
                                    {valoria.longTermRatePct !== null && Number.isFinite(valoria.longTermRatePct) && (
                                        <>
                                            {' · '}
                                            <PrivateAmount>{formatPercent(valoria.longTermRatePct, 1)}</PrivateAmount>
                                            /an
                                        </>
                                    )}
                                </span>
                            </div>
                        )}

                        {news.keySignals.length > 0 && (
                            <ul className="space-y-1.5">
                                {news.keySignals.slice(0, 3).map((sig) => {
                                    const dir = SIGNAL_DIRECTION_META[sig.direction];
                                    return (
                                        <li key={sig.id} className="rounded-lg border border-bordure bg-fond px-2.5 py-2 flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                                            <span className="text-tiny font-bold text-texte break-words min-w-0">
                                                <PrivateText quoi="memo">{sig.title}</PrivateText>
                                            </span>
                                            <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold shrink-0 ${dir.cls}`}>
                                                {dir.label} · {sig.impactLabel}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {(news.macroHeadlineFr || news.aiSynthesisFr || news.keySignals.some((s) => Boolean(s.plainFrench))) && (
                            <details className="rounded-lg border border-bordure bg-fond px-3 py-2 text-tiny text-texte-doux">
                                <summary className="cursor-pointer select-none font-semibold text-texte hover:text-repere">
                                    Détails de l’analyse
                                </summary>
                                <div className="mt-2 space-y-2">
                                    {news.macroHeadlineFr && (
                                        <p className="text-texte break-words">
                                            <PrivateText quoi="memo">{news.macroHeadlineFr}</PrivateText>
                                        </p>
                                    )}
                                    {news.keySignals.slice(0, 3).map((sig) =>
                                        sig.plainFrench ? (
                                            <p key={sig.id} className="text-texte-doux break-words">
                                                <strong className="text-texte"><PrivateText quoi="memo">{sig.title}</PrivateText> : </strong>
                                                <PrivateText quoi="memo">{sig.plainFrench}</PrivateText>
                                            </p>
                                        ) : null,
                                    )}
                                    {news.aiSynthesisFr && (
                                        <p className="text-texte break-words pt-1 border-t border-bordure">
                                            <span className="font-bold text-repere">Synthèse Gemini : </span>
                                            <PrivateText quoi="memo">{news.aiSynthesisFr}</PrivateText>
                                        </p>
                                    )}
                                </div>
                            </details>
                        )}
                    </div>
                </div>
            </div>

            {/* B. Pourquoi ta courbe évolue ainsi */}
            <div className="space-y-3 border-t border-bordure pt-5">
                <h3 className="text-meta font-bold uppercase tracking-wider text-repere flex items-center gap-2">
                    <Icon name="future" size={16} className="text-repere shrink-0" />
                    <span>B. Pourquoi ta courbe évolue ainsi</span>
                </h3>

                {scenario.turningPoints.length === 0 ? (
                    <p className="rounded-xl border border-bordure bg-surface-douce p-3.5 text-tiny text-texte-doux">
                        Aucun point d&apos;inflexion majeur détecté sur cet horizon.
                    </p>
                ) : (
                    <ol className="space-y-2.5">
                        {scenario.turningPoints.slice(0, 6).map((tp) => {
                            const kindMeta = TURNING_KIND_META[tp.kind];
                            const isExpanded = Boolean(expandedTurningIds[tp.id]);
                            const hasDetails = Boolean(tp.summaryFr) || tp.proofDetailsFr.length > 0;
                            return (
                                <li
                                    key={tp.id}
                                    className="rounded-xl border border-bordure bg-surface-douce p-3 sm:p-3.5 space-y-2 min-w-0"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="space-y-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 text-tiny">
                                                <span className="font-mono font-bold text-texte tabular-nums">
                                                    {tp.year} · <PrivateAmount>{`${Math.round(tp.age)} ans`}</PrivateAmount>
                                                </span>
                                                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${kindMeta.cls}`}>
                                                    {kindMeta.label}
                                                </span>
                                            </div>
                                            <h4 className="text-body font-bold text-texte break-words">
                                                <PrivateText quoi="memo">{tp.title}</PrivateText>
                                            </h4>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                                            {hasDetails && (
                                                <button
                                                    type="button"
                                                    aria-expanded={isExpanded}
                                                    onClick={() => toggleTurningDetails(tp.id)}
                                                    className="touch-target min-h-11 px-3 py-2 rounded-lg border border-bordure-champ bg-fond hover:bg-surface text-tiny font-semibold text-texte focus-ring transition-colors"
                                                >
                                                    {isExpanded ? 'Masquer les chiffres' : 'Voir les chiffres'}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => onFocusMonth(tp.monthIndex)}
                                                className="touch-target min-h-11 px-3 py-2 rounded-lg border border-bordure-champ bg-surface hover:bg-fond text-tiny font-semibold text-repere focus-ring transition-colors"
                                            >
                                                Voir sur la courbe
                                            </button>
                                        </div>
                                    </div>

                                    {isExpanded && hasDetails && (
                                        <div className="rounded-lg border border-bordure bg-fond p-3 space-y-2 text-tiny text-texte-doux">
                                            {tp.summaryFr && (
                                                <p className="text-texte break-words">
                                                    <PrivateText quoi="memo">{tp.summaryFr}</PrivateText>
                                                </p>
                                            )}
                                            {tp.proofDetailsFr.length > 0 && (
                                                <ul className="space-y-1">
                                                    {tp.proofDetailsFr.map((detail, i) => (
                                                        <li key={i} className="flex items-start gap-2 min-w-0">
                                                            <span className="text-repere shrink-0" aria-hidden="true">→</span>
                                                            <span className="break-words">
                                                                <PrivateText quoi="memo">{detail}</PrivateText>
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>
            </>
            )}

            {/* C. Tes actions concrètes les plus payantes */}
            {(sectionMode === 'all' || sectionMode === 'actions') && (
            <div className={sectionMode === 'actions' ? 'space-y-3' : 'space-y-3 border-t border-bordure pt-5'}>
                <h3 className="text-meta font-bold uppercase tracking-wider text-succes-texte flex items-center gap-2">
                    <Icon name="sparkles" size={16} className="text-succes-texte shrink-0" />
                    <span>C. Ce qu’il faut faire pour atteindre la trajectoire IA</span>
                </h3>

                {(() => {
                    const listeActions: ReconciledAiAction[] =
                        reconciledActions && reconciledActions.length > 0
                            ? reconciledActions
                            : report.concreteActions.slice(0, 4).map((ca, i) => ({
                                  id: ca.id,
                                  title: ca.title,
                                  plainFrenchWhy: ca.plainFrenchWhy,
                                  impactCad: ca.gainCad,
                                  impactMonths: ca.freedomMonthsGained,
                                  priority: i + 1,
                                  isAlreadyApplied: false,
                                  applyLabel: ca.appliesAiScenario ? 'Appliquer dans Optimisé IA' : undefined,
                                  targetTab: resolveActionTab(ca.targetTab) ?? undefined,
                              }));
                    if (listeActions.length === 0) {
                        return (
                            <p className="rounded-xl border border-bordure bg-surface-douce p-3.5 text-tiny text-texte-doux">
                                Aucune action prioritaire supplémentaire identifiée sur ce scénario.
                            </p>
                        );
                    }
                    return (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {listeActions.map((action) => {
                                const isDone = completedActionIds.includes(action.id);
                                const gainOk =
                                    action.impactCad !== null &&
                                    Number.isFinite(action.impactCad) &&
                                    action.impactCad > 0;
                                const monthsOk =
                                    action.impactMonths !== null &&
                                    Number.isFinite(action.impactMonths) &&
                                    action.impactMonths > 0;
                                const targetTab = action.targetTab && action.targetTab !== Tab.FUTURE ? action.targetTab : null;

                                return (
                                    <article
                                        key={action.id}
                                        className={`rounded-xl border p-4 flex flex-col justify-between gap-3 h-full min-w-0 transition-colors ${
                                            isDone
                                                ? 'border-succes-texte/40 bg-succes-fond/40'
                                                : 'border-bordure bg-surface-douce'
                                        }`}
                                    >
                                        <div className="space-y-2 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <h4 className={`text-body font-bold break-words ${isDone ? 'line-through text-texte-doux' : 'text-texte'}`}>
                                                    <PrivateText quoi="memo">{action.title}</PrivateText>
                                                </h4>
                                                {onToggleActionCompleted && (
                                                    <label className="touch-target min-h-11 min-w-11 inline-flex items-center justify-center shrink-0 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={isDone}
                                                            onChange={() => onToggleActionCompleted(action.id)}
                                                            aria-label={`Marquer comme fait : ${action.title}`}
                                                            className="w-5 h-5 accent-accent rounded-sm cursor-pointer"
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                            {action.plainFrenchWhy && (
                                                <details className="text-tiny text-texte-doux">
                                                    <summary className="cursor-pointer select-none hover:text-texte">
                                                        Pourquoi ?
                                                    </summary>
                                                    <p className="mt-1 break-words">
                                                        <PrivateText quoi="memo">{action.plainFrenchWhy}</PrivateText>
                                                    </p>
                                                </details>
                                            )}
                                            {(gainOk || monthsOk || action.isAlreadyApplied) && (
                                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                                    {action.isAlreadyApplied && (
                                                        <span className="px-2.5 py-0.5 rounded-full border border-succes-texte/30 bg-succes-fond text-succes-texte text-tiny font-semibold">
                                                            Déjà actif dans ton plan
                                                        </span>
                                                    )}
                                                    {gainOk && (
                                                        <span className="px-2.5 py-0.5 rounded-full border border-succes-texte/30 bg-succes-fond text-succes-texte text-tiny font-mono font-bold tabular-nums">
                                                            Gain estimé :{' '}
                                                            <PrivateAmount>
                                                                {`+${formatCompactCAD(action.impactCad as number)}`}
                                                            </PrivateAmount>
                                                        </span>
                                                    )}
                                                    {monthsOk && (
                                                        <span className="px-2.5 py-0.5 rounded-full border border-repere/35 bg-repere-doux text-repere text-tiny font-mono font-bold tabular-nums">
                                                            +<PrivateAmount>{`${Math.round(action.impactMonths as number)} mois`}</PrivateAmount> gagnés
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-bordure">
                                            {!action.isAlreadyApplied && action.applyPatch && onApplyActionPatch && (
                                                <button
                                                    type="button"
                                                    onClick={() => onApplyActionPatch(action)}
                                                    className="touch-target min-h-11 px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-fonce text-sur-accent text-tiny font-bold focus-ring transition-colors"
                                                >
                                                    {action.applyLabel ?? 'Appliquer à mon plan'}
                                                </button>
                                            )}
                                            {!action.applyPatch && action.applyLabel && (
                                                <button
                                                    type="button"
                                                    onClick={() => onSelectScenario('ai_optimized')}
                                                    className="touch-target min-h-11 px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-fonce text-sur-accent text-tiny font-bold focus-ring transition-colors"
                                                >
                                                    {action.applyLabel}
                                                </button>
                                            )}
                                            {targetTab && onNavigateTab && (
                                                <button
                                                    type="button"
                                                    onClick={() => onNavigateTab(targetTab)}
                                                    className="touch-target min-h-11 px-3.5 py-2 rounded-xl border border-bordure-champ bg-fond hover:bg-surface text-texte text-tiny font-semibold focus-ring transition-colors"
                                                >
                                                    Ouvrir {TAB_LABELS[targetTab] ?? targetTab} ↗
                                                </button>
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    );
                })()}
            </div>
            )}
        </section>
    );
};

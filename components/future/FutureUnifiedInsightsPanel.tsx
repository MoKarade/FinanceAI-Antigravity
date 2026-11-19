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

                        <p className="text-meta text-texte font-medium break-words">
                            <PrivateText quoi="memo">{news.macroHeadlineFr}</PrivateText>
                        </p>

                        {valoria && (
                            <div className="rounded-lg border border-bordure bg-fond p-2.5 flex flex-wrap items-center justify-between gap-2 text-tiny">
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
                            <ul className="space-y-2">
                                {news.keySignals.slice(0, 3).map((sig) => {
                                    const dir = SIGNAL_DIRECTION_META[sig.direction];
                                    return (
                                        <li key={sig.id} className="rounded-lg border border-bordure bg-fond p-2.5 space-y-1 min-w-0">
                                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                                                <span className="text-tiny font-bold text-texte break-words min-w-0">
                                                    <PrivateText quoi="memo">{sig.title}</PrivateText>
                                                </span>
                                                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold shrink-0 ${dir.cls}`}>
                                                    {dir.label} · {sig.impactLabel}
                                                </span>
                                            </div>
                                            <p className="text-tiny text-texte-doux break-words">
                                                <PrivateText quoi="memo">{sig.plainFrench}</PrivateText>
                                            </p>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {news.aiSynthesisFr && (
                            <div className="rounded-lg border border-bordure-champ bg-fond p-3 text-tiny text-texte break-words">
                                <span className="font-bold text-repere block mb-0.5">Synthèse Gemini</span>
                                <PrivateText quoi="memo">{news.aiSynthesisFr}</PrivateText>
                            </div>
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
                    <ol className="space-y-3">
                        {scenario.turningPoints.slice(0, 6).map((tp) => {
                            const kindMeta = TURNING_KIND_META[tp.kind];
                            const isExpanded = Boolean(expandedTurningIds[tp.id]);
                            return (
                                <li
                                    key={tp.id}
                                    className="rounded-xl border border-bordure bg-surface-douce p-3.5 sm:p-4 space-y-2.5 min-w-0"
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
                                            {tp.proofDetailsFr.length > 0 && (
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

                                    <p className="text-meta text-texte-doux break-words">
                                        <PrivateText quoi="memo">{tp.summaryFr}</PrivateText>
                                    </p>

                                    {isExpanded && tp.proofDetailsFr.length > 0 && (
                                        <ul className="rounded-lg border border-bordure bg-fond p-3 space-y-1 text-tiny text-texte-doux">
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
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>

            {/* C. Tes actions concrètes les plus payantes */}
            <div className="space-y-3 border-t border-bordure pt-5">
                <h3 className="text-meta font-bold uppercase tracking-wider text-succes-texte flex items-center gap-2">
                    <Icon name="sparkles" size={16} className="text-succes-texte shrink-0" />
                    <span>C. Tes actions concrètes les plus payantes</span>
                </h3>

                {report.concreteActions.length === 0 ? (
                    <p className="rounded-xl border border-bordure bg-surface-douce p-3.5 text-tiny text-texte-doux">
                        Aucune action prioritaire supplémentaire identifiée sur ce scénario.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {report.concreteActions.slice(0, 4).map((action) => {
                            const gainOk =
                                action.gainCad !== null &&
                                Number.isFinite(action.gainCad) &&
                                action.gainCad > 0;
                            const monthsOk =
                                action.freedomMonthsGained !== null &&
                                Number.isFinite(action.freedomMonthsGained) &&
                                action.freedomMonthsGained > 0;
                            const targetTab = resolveActionTab(action.targetTab);

                            return (
                                <article
                                    key={action.id}
                                    className="rounded-xl border border-bordure bg-surface-douce p-4 flex flex-col justify-between gap-3 h-full min-w-0"
                                >
                                    <div className="space-y-2 min-w-0">
                                        <h4 className="text-body font-bold text-texte break-words">
                                            <PrivateText quoi="memo">{action.title}</PrivateText>
                                        </h4>
                                        <p className="text-tiny text-texte-doux break-words">
                                            <PrivateText quoi="memo">{action.plainFrenchWhy}</PrivateText>
                                        </p>
                                        {(gainOk || monthsOk) && (
                                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                                {gainOk && (
                                                    <span className="px-2.5 py-0.5 rounded-full border border-succes-texte/30 bg-succes-fond text-succes-texte text-tiny font-mono font-bold tabular-nums">
                                                        Gain estimé :{' '}
                                                        <PrivateAmount>
                                                            {`+${formatCompactCAD(action.gainCad as number)}`}
                                                        </PrivateAmount>
                                                    </span>
                                                )}
                                                {monthsOk && (
                                                    <span className="px-2.5 py-0.5 rounded-full border border-repere/35 bg-repere-doux text-repere text-tiny font-mono font-bold tabular-nums">
                                                        +<PrivateAmount>{`${Math.round(action.freedomMonthsGained as number)} mois`}</PrivateAmount> gagnés
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-bordure">
                                        {action.appliesAiScenario && (
                                            <button
                                                type="button"
                                                onClick={() => onSelectScenario('ai_optimized')}
                                                className="touch-target min-h-11 px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-fonce text-sur-accent text-tiny font-bold focus-ring transition-colors"
                                            >
                                                Appliquer dans Optimisé IA
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
                )}
            </div>
        </section>
    );
};

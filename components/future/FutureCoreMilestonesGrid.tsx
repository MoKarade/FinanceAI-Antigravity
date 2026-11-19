// components/future/FutureCoreMilestonesGrid.tsx
// Futur 4.0 — Bloc 3 : 4 repères de vie pleine largeur (Indépendance financière, Revenu mensuel
// net retraite, Objectifs datés, Patrimoine final & Succession).
// Strict : variables sémantiques uniquement, no-fake-data (« — » si null), <PrivateAmount> / <PrivateText>.

import React from 'react';
import type {
    DeepForecastReport,
    DeepGoalMilestoneSummary,
    DeepScenarioOutput,
} from '../../services/projection/deepForecastTypes';
import { formatCAD, formatCompactCAD, formatIsoDay, formatPercent } from '../../utils/format';
import { Icon } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { PrivateText } from '../ui/PrivateText';

export interface FutureCoreMilestonesGridProps {
    report: DeepForecastReport;
    scenario: DeepScenarioOutput;
}

function formatGoalDate(targetDate: string): string {
    if (!targetDate) return '—';
    if (/^\d{4}-\d{2}-\d{2}/.test(targetDate)) {
        return formatIsoDay(targetDate);
    }
    return targetDate;
}

function pickPriorityGoal(goals: readonly DeepGoalMilestoneSummary[]): DeepGoalMilestoneSummary | null {
    if (goals.length === 0) return null;
    const pending = goals
        .filter((g) => g.status !== 'achieved')
        .slice()
        .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    if (pending.length > 0) return pending[0];
    return goals.slice().sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0] ?? null;
}

function goalStatusBadge(status: DeepGoalMilestoneSummary['status']): { label: string; cls: string } {
    switch (status) {
        case 'achieved':
            return { label: 'Atteint', cls: 'bg-succes-fond text-succes-texte border-succes-texte/30' };
        case 'on_track':
            return { label: 'Sur la cible', cls: 'bg-succes-fond text-succes-texte border-succes-texte/30' };
        case 'at_risk':
            return { label: 'À surveiller', cls: 'bg-alerte-fond text-alerte-texte border-alerte-texte/30' };
        case 'insufficient_data':
        default:
            return { label: 'Hors horizon', cls: 'bg-surface-douce text-texte-doux border-bordure' };
    }
}

export const FutureCoreMilestonesGrid: React.FC<FutureCoreMilestonesGridProps> = ({
    report,
    scenario,
}) => {
    const ms = scenario.milestones;
    const fiAgeOk = ms.fiAge !== null && Number.isFinite(ms.fiAge);
    const fiProbOk = ms.fiProbabilityPct !== null && Number.isFinite(ms.fiProbabilityPct);
    const sustOk =
        ms.sustainableMonthlyNetRetirementCad !== null &&
        Number.isFinite(ms.sustainableMonthlyNetRetirementCad);
    const sustP90Ok =
        ms.sustainableMonthlyNetP90Cad !== null &&
        Number.isFinite(ms.sustainableMonthlyNetP90Cad);
    const finalNwOk = ms.finalNetWorthP50 !== null && Number.isFinite(ms.finalNetWorthP50);
    const estateOk = ms.estateNetWorthP50 !== null && Number.isFinite(ms.estateNetWorthP50);
    const estateTaxOk = ms.estateTaxP50 !== null && Number.isFinite(ms.estateTaxP50);

    const goals = ms.goalsSummary;
    const onTrackCount = goals.filter((g) => g.status === 'achieved' || g.status === 'on_track').length;
    const priorityGoal = pickPriorityGoal(goals);
    const priorityMeta = priorityGoal ? goalStatusBadge(priorityGoal.status) : null;

    return (
        <section
            aria-labelledby="futur-reperes-cles-titre"
            className="space-y-3"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="futur-reperes-cles-titre" className="text-meta font-bold uppercase tracking-wider text-texte-doux">
                    Repères clés de vie · {scenario.label}
                </h2>
                <span className="text-tiny text-texte-doux">
                    {report.isDeepRun ? 'Simulation Monte Carlo profonde' : 'Aperçu rapide instantané'}
                </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 lg:gap-4 items-stretch">
                {/* 1. Indépendance financière */}
                <article className="rounded-2xl border border-bordure bg-surface p-4 flex flex-col justify-between gap-3 h-full min-w-0">
                    <div className="space-y-2 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-tiny font-bold uppercase tracking-wider text-texte-doux">
                                Indépendance financière
                            </span>
                            <Icon name="rocket" size={16} className="text-repere shrink-0" />
                        </div>
                        <div className="text-2xl font-black font-mono text-texte tabular-nums break-words">
                            <PrivateAmount>
                                {fiAgeOk ? `${Math.round(ms.fiAge as number)} ans` : '—'}
                            </PrivateAmount>
                        </div>
                        <p className="text-tiny text-texte-doux break-words">
                            Probabilité d&apos;atteinte :{' '}
                            <strong className="font-mono text-texte tabular-nums">
                                <PrivateAmount>
                                    {fiProbOk ? formatPercent(ms.fiProbabilityPct as number, 1) : '—'}
                                </PrivateAmount>
                            </strong>
                        </p>
                    </div>
                    <p className="text-tiny text-texte-doux border-t border-bordure pt-2 break-words">
                        Âge médian projeté où le capital couvre tes dépenses nettes indexées.
                    </p>
                </article>

                {/* 2. Revenu mensuel net retraite */}
                <article className="rounded-2xl border border-bordure bg-surface p-4 flex flex-col justify-between gap-3 h-full min-w-0">
                    <div className="space-y-2 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-tiny font-bold uppercase tracking-wider text-texte-doux">
                                Revenu mensuel net retraite
                            </span>
                            <Icon name="cash" size={16} className="text-succes-texte shrink-0" />
                        </div>
                        <div className="text-2xl font-black font-mono text-texte tabular-nums break-words">
                            <PrivateAmount>
                                {sustOk ? formatCAD(Math.round(ms.sustainableMonthlyNetRetirementCad as number)) : '—'}
                            </PrivateAmount>
                            {sustOk && <span className="text-meta font-semibold text-texte-doux"> / mois</span>}
                        </div>
                        <p className="text-tiny text-texte-doux break-words">
                            Repère prudent (P90) :{' '}
                            <strong className="font-mono text-texte tabular-nums">
                                <PrivateAmount>
                                    {sustP90Ok ? `${formatCAD(Math.round(ms.sustainableMonthlyNetP90Cad as number))}/mois` : '—'}
                                </PrivateAmount>
                            </strong>
                        </p>
                    </div>
                    <p className="text-tiny text-texte-doux border-t border-bordure pt-2 break-words">
                        Pouvoir d&apos;achat durable en dollars d&apos;aujourd&apos;hui après impôts ARC/RQ.
                    </p>
                </article>

                {/* 3. Objectifs datés */}
                <article className="rounded-2xl border border-bordure bg-surface p-4 flex flex-col justify-between gap-3 h-full min-w-0">
                    <div className="space-y-2 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-tiny font-bold uppercase tracking-wider text-texte-doux">
                                Objectifs datés
                            </span>
                            <Icon name="goal" size={16} className="text-repere shrink-0" />
                        </div>

                        {goals.length === 0 ? (
                            <div className="space-y-1.5">
                                <div className="text-base font-bold text-texte break-words">
                                    Aucun objectif daté configuré
                                </div>
                                <p className="text-tiny text-texte-doux break-words">
                                    Ajoute un projet ou objectif daté pour calculer sa probabilité d&apos;atteinte.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="text-2xl font-black font-mono text-texte tabular-nums break-words">
                                    <PrivateAmount>{`${onTrackCount} / ${goals.length}`}</PrivateAmount>
                                    <span className="text-meta font-semibold text-texte-doux"> sur la cible</span>
                                </div>
                                {priorityGoal && (
                                    <div className="space-y-1">
                                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                                            <span className="text-tiny font-semibold text-texte break-words min-w-0">
                                                Prochain : <PrivateText quoi="memo">{priorityGoal.name}</PrivateText>
                                            </span>
                                            {priorityMeta && (
                                                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${priorityMeta.cls}`}>
                                                    {priorityMeta.label}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-tiny text-texte-doux break-words">
                                            Échéance {formatGoalDate(priorityGoal.targetDate)} ·{' '}
                                            <strong className="font-mono text-texte tabular-nums">
                                                <PrivateAmount>
                                                    {priorityGoal.probabilityPct !== null && Number.isFinite(priorityGoal.probabilityPct)
                                                        ? formatPercent(priorityGoal.probabilityPct, 1)
                                                        : '—'}
                                                </PrivateAmount>
                                            </strong>
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <p className="text-tiny text-texte-doux border-t border-bordure pt-2 break-words">
                        Suivi probabiliste des jalons datés à l&apos;intérieur de l&apos;horizon.
                    </p>
                </article>

                {/* 4. Patrimoine final & Succession */}
                <article className="rounded-2xl border border-bordure bg-surface p-4 flex flex-col justify-between gap-3 h-full min-w-0">
                    <div className="space-y-2 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-tiny font-bold uppercase tracking-wider text-texte-doux">
                                Patrimoine final &amp; Succession
                            </span>
                            <Icon name="shield" size={16} className="text-texte shrink-0" />
                        </div>
                        <div className="text-2xl font-black font-mono text-texte tabular-nums break-words">
                            <PrivateAmount>
                                {finalNwOk ? formatCompactCAD(ms.finalNetWorthP50 as number) : '—'}
                            </PrivateAmount>
                        </div>
                        <div className="space-y-0.5 text-tiny text-texte-doux break-words">
                            <div>
                                Succession nette :{' '}
                                <strong className="font-mono text-succes-texte tabular-nums">
                                    <PrivateAmount>
                                        {estateOk ? formatCompactCAD(ms.estateNetWorthP50 as number) : '—'}
                                    </PrivateAmount>
                                </strong>
                            </div>
                            <div>
                                Impôt au décès ARC/RQ :{' '}
                                <strong className="font-mono text-texte tabular-nums">
                                    <PrivateAmount>
                                        {estateTaxOk ? formatCompactCAD(ms.estateTaxP50 as number) : '—'}
                                    </PrivateAmount>
                                </strong>
                            </div>
                        </div>
                    </div>
                    <p className="text-tiny text-texte-doux border-t border-bordure pt-2 break-words">
                        Médiane P50 en fin d&apos;horizon et legs net après liquidation fiscale.
                    </p>
                </article>
            </div>
        </section>
    );
};

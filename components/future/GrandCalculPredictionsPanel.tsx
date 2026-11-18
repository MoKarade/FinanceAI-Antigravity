import React, { useId } from 'react';
import type { GoalProbabilityResult, GrandCalculResult } from '../../services/projection/types';
import { useFinanceStore } from '../../store/useFinanceStore';
import { formatCAD, formatPercent } from '../../utils/format';
import { PrivateAmount } from '../ui/PrivateAmount';
import { PrivateText } from '../ui/PrivateText';
import { ProjectionRequired } from '../ui/ProjectionRequired';
import { emptyAware } from '../ui/emptyAware';

export interface GrandCalculPredictionsPanelProps {
    result: GrandCalculResult | null;
    isStale?: boolean;
    unreadableStorage?: boolean;
}

const PrivateAge: React.FC<{ age: number | null | undefined }> = ({ age }) => (
    <PrivateAmount>
        {age !== null && age !== undefined && Number.isFinite(age) ? `${Math.round(age)} ans` : '—'}
    </PrivateAmount>
);

function goalStatusMeta(status: GoalProbabilityResult['status']): { label: string; badgeClass: string } {
    switch (status) {
        case 'already_completed':
            return {
                label: 'Atteint',
                badgeClass: 'bg-succes-fond text-succes-texte border-succes-texte/30',
            };
        case 'beyond_horizon':
            return {
                label: 'Hors horizon',
                badgeClass: 'bg-alerte-fond text-alerte-texte border-alerte-texte/30',
            };
        case 'invalid_deadline':
            return {
                label: 'Échéance invalide',
                badgeClass: 'bg-erreur-fond text-erreur-texte border-erreur-texte/30',
            };
        case 'evaluated':
        default:
            return {
                label: 'Évalué',
                badgeClass: 'bg-surface border-bordure text-texte-doux',
            };
    }
}

export const GrandCalculPredictionsPanel: React.FC<GrandCalculPredictionsPanelProps> = ({
    result,
    isStale = false,
    unreadableStorage = false,
}) => {
    const projectionRefus = useFinanceStore((s) => s.projectionRefus);
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const sectionTitleId = useId();
    const fiTitleId = useId();
    const goalsTitleId = useId();
    const purchasingTitleId = useId();
    const estateTitleId = useId();

    if (projectionRefus) {
        return <ProjectionRequired feature="Les prédictions avancées du Grand Calcul" />;
    }

    const fiAge = result?.fiAge ?? null;
    const gp = result?.guaranteedPurchasingPower ?? null;
    const estate = result?.estateTax ?? null;
    const ppMax =
        gp && gp.p50SecurityMonthlyNetReal !== null && gp.p50SecurityMonthlyNetReal > 0
            ? gp.p50SecurityMonthlyNetReal
            : null;

    return (
        <section
            aria-labelledby={sectionTitleId}
            className="rounded-2xl border border-bordure bg-surface px-3.5 py-4 sm:px-5 sm:py-5 space-y-4"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                    <h2 id={sectionTitleId} className="text-h2 text-texte">
                        Prédictions et jalons avancés
                    </h2>
                    <p className="text-meta text-texte-doux">
                        Indicateurs probabilistes issus du dernier Grand Calcul (données manquantes affichées « — »).
                    </p>
                </div>

                {unreadableStorage ? (
                    <div
                        role="status"
                        className="rounded-lg border border-erreur-texte/30 bg-erreur-fond px-3 py-1.5 text-tiny text-erreur-texte"
                    >
                        Sauvegarde locale illisible — relancez le Grand Calcul.
                    </div>
                ) : isStale ? (
                    <div
                        role="status"
                        className="rounded-lg border border-alerte-texte/30 bg-alerte-fond px-3 py-1.5 text-tiny text-alerte-texte"
                    >
                        Paramètres modifiés — résultats à actualiser.
                    </div>
                ) : !result ? (
                    <div
                        role="status"
                        className="rounded-lg border border-bordure bg-surface-douce px-3 py-1.5 text-tiny text-texte-doux"
                    >
                        En attente du Grand Calcul
                    </div>
                ) : null}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Carte 1 : Âge d'indépendance financière */}
                <section
                    aria-labelledby={fiTitleId}
                    className="rounded-xl border border-bordure bg-surface-douce p-4 space-y-3 min-w-0"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 id={fiTitleId} className="text-h3 text-texte">
                            Âge d&apos;indépendance financière
                        </h3>
                        <span className="text-tiny text-texte-doux">
                            Taux d&apos;atteinte :{' '}
                            <strong className="font-mono text-texte tabular-nums">
                                <PrivateAmount>
                                    {fiAge && fiAge.reachedPct !== null
                                        ? formatPercent(fiAge.reachedPct, 1)
                                        : '—'}
                                </PrivateAmount>
                            </strong>
                        </span>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-fond overflow-hidden border border-bordure/60">
                        <div
                            className="h-full rounded-full bg-accent transition-all duration-300"
                            style={{ width: `${isPrivacyMode || !fiAge || fiAge.reachedPct === null || !Number.isFinite(fiAge.reachedPct) ? 0 : Math.min(100, Math.max(0, fiAge.reachedPct))}%` }}
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="rounded-lg border border-bordure bg-fond px-3 py-2.5 space-y-1 min-w-0">
                            <div className="text-tiny text-texte-doux">P5 (optimiste)</div>
                            <div className="text-body font-mono font-semibold text-texte tabular-nums">
                                <PrivateAge age={fiAge?.p5Age} />
                            </div>
                        </div>
                        <div className="rounded-lg border border-bordure bg-fond px-3 py-2.5 space-y-1 min-w-0">
                            <div className="text-tiny text-texte-doux">Médiane (P50)</div>
                            <div className="text-body font-mono font-semibold text-texte tabular-nums">
                                <PrivateAge age={fiAge?.p50Age} />
                            </div>
                        </div>
                        <div className="rounded-lg border border-bordure bg-fond px-3 py-2.5 space-y-1 min-w-0">
                            <div className="text-tiny text-texte-doux">P95 (prudent)</div>
                            <div className="text-body font-mono font-semibold text-texte tabular-nums">
                                <PrivateAge age={fiAge?.p95Age} />
                            </div>
                        </div>
                    </div>

                    <p className="text-tiny text-texte-doux">
                        Horizon simulé :{' '}
                        <span className="font-mono text-texte tabular-nums">
                            <PrivateAge age={fiAge?.horizonAge} />
                        </span>
                    </p>
                </section>

                {/* Carte 2 : Probabilités par objectif financier */}
                <section
                    aria-labelledby={goalsTitleId}
                    className="rounded-xl border border-bordure bg-surface-douce p-4 space-y-3 min-w-0"
                >
                    <h3 id={goalsTitleId} className="text-h3 text-texte">
                        Probabilités par objectif financier
                    </h3>

                    {!result ? (
                        <div className="rounded-lg border border-bordure bg-fond px-3 py-3 text-meta text-texte-doux flex items-center justify-between gap-2">
                            <span>Lancez le Grand Calcul pour évaluer vos objectifs financiers.</span>
                            <PrivateAmount className="font-mono font-semibold text-texte">{'—'}</PrivateAmount>
                        </div>
                    ) : result.goalProbabilities.length === 0 ? (
                        <div className="rounded-lg border border-bordure bg-fond px-3 py-3 text-meta text-texte-doux flex items-center justify-between gap-2">
                            <span>Aucun objectif financier actif configuré.</span>
                            <PrivateAmount className="font-mono font-semibold text-texte">{'—'}</PrivateAmount>
                        </div>
                    ) : (
                        <ul className="space-y-2.5">
                            {result.goalProbabilities.map((g) => {
                                const badge = goalStatusMeta(g.status);
                                return (
                                    <li key={g.goalId}>
                                        <article className="rounded-lg border border-bordure bg-fond p-3 space-y-1.5">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <PrivateText quoi="memo" className="font-medium text-body text-texte truncate">
                                                    {g.name}
                                                </PrivateText>
                                                <span
                                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-tiny ${badge.badgeClass}`}
                                                >
                                                    {badge.label}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-tiny text-texte-doux">
                                                <span>Échéance : {emptyAware(g.deadline || '—')}</span>
                                                <span>
                                                    Cible :{' '}
                                                    <PrivateAmount className="font-mono text-texte tabular-nums">
                                                        {formatCAD(g.targetAmount)}
                                                    </PrivateAmount>
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-meta">
                                                <span className="text-texte-doux">
                                                    Probabilité :{' '}
                                                    <strong className="font-mono text-texte tabular-nums">
                                                        <PrivateAmount>
                                                            {g.probabilityPct !== null
                                                                ? formatPercent(g.probabilityPct, 1)
                                                                : '—'}
                                                        </PrivateAmount>
                                                    </strong>
                                                </span>
                                                <span className="text-texte-doux">
                                                    Déficit médian :{' '}
                                                    <span className="font-mono text-texte tabular-nums">
                                                        <PrivateAmount>
                                                            {g.medianShortfall !== null
                                                                ? formatCAD(g.medianShortfall)
                                                                : '—'}
                                                        </PrivateAmount>
                                                    </span>
                                                </span>
                                            </div>
                                            <div className="h-1.5 w-full rounded-full bg-surface-douce overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-300 ${
                                                        g.probabilityPct !== null && g.probabilityPct >= 80
                                                            ? 'bg-succes-texte'
                                                            : g.probabilityPct !== null && g.probabilityPct >= 50
                                                              ? 'bg-accent'
                                                              : 'bg-alerte-texte'
                                                    }`}
                                                    style={{ width: `${isPrivacyMode || g.probabilityPct === null || !Number.isFinite(g.probabilityPct) ? 0 : Math.min(100, Math.max(0, g.probabilityPct))}%` }}
                                                />
                                            </div>
                                        </article>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                {/* Carte 3 : Pouvoir d'achat réel mensuel net garanti */}
                <section
                    aria-labelledby={purchasingTitleId}
                    className="rounded-xl border border-bordure bg-surface-douce p-4 space-y-3 min-w-0"
                >
                    <div className="space-y-1">
                        <h3 id={purchasingTitleId} className="text-h3 text-texte">
                            Pouvoir d&apos;achat réel mensuel net garanti
                        </h3>
                        <p className="text-tiny text-texte-doux">
                            En dollars constants d&apos;aujourd&apos;hui (mensuel net d&apos;impôts ARC et Revenu Québec, par mois).
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="rounded-lg border border-bordure bg-fond px-3 py-2.5 space-y-1.5">
                            <div className="text-tiny text-texte-doux">P95 (sécurité 95 %)</div>
                            <div className="text-body font-mono font-semibold text-texte tabular-nums">
                                <PrivateAmount>
                                    {gp && gp.p95SecurityMonthlyNetReal !== null
                                        ? formatCAD(gp.p95SecurityMonthlyNetReal)
                                        : '—'}
                                </PrivateAmount>
                                <span className="text-tiny font-normal text-texte-doux"> / mois</span>
                            </div>
                            <div className="h-1 w-full rounded-full bg-surface-douce overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-succes-texte transition-all duration-300"
                                    style={{ width: `${isPrivacyMode || !ppMax || gp?.p95SecurityMonthlyNetReal === null || gp?.p95SecurityMonthlyNetReal === undefined ? 0 : Math.min(100, Math.max(0, Math.round((gp.p95SecurityMonthlyNetReal / ppMax) * 100)))}%` }}
                                />
                            </div>
                        </div>

                        <div className="rounded-lg border border-bordure bg-fond px-3 py-2.5 space-y-1.5">
                            <div className="text-tiny text-texte-doux">P90 (sécurité 90 %)</div>
                            <div className="text-body font-mono font-semibold text-texte tabular-nums">
                                <PrivateAmount>
                                    {gp && gp.p90SecurityMonthlyNetReal !== null
                                        ? formatCAD(gp.p90SecurityMonthlyNetReal)
                                        : '—'}
                                </PrivateAmount>
                                <span className="text-tiny font-normal text-texte-doux"> / mois</span>
                            </div>
                            <div className="h-1 w-full rounded-full bg-surface-douce overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-accent transition-all duration-300"
                                    style={{ width: `${isPrivacyMode || !ppMax || gp?.p90SecurityMonthlyNetReal === null || gp?.p90SecurityMonthlyNetReal === undefined ? 0 : Math.min(100, Math.max(0, Math.round((gp.p90SecurityMonthlyNetReal / ppMax) * 100)))}%` }}
                                />
                            </div>
                        </div>

                        <div className="rounded-lg border border-bordure bg-fond px-3 py-2.5 space-y-1.5">
                            <div className="text-tiny text-texte-doux">P50 (médiane)</div>
                            <div className="text-body font-mono font-semibold text-texte tabular-nums">
                                <PrivateAmount>
                                    {gp && gp.p50SecurityMonthlyNetReal !== null
                                        ? formatCAD(gp.p50SecurityMonthlyNetReal)
                                        : '—'}
                                </PrivateAmount>
                                <span className="text-tiny font-normal text-texte-doux"> / mois</span>
                            </div>
                            <div className="h-1 w-full rounded-full bg-surface-douce overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-repere transition-all duration-300"
                                    style={{ width: `${isPrivacyMode || !ppMax ? 0 : 100}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    <p className="text-tiny text-texte-doux">
                        Mois de retraite évalués :{' '}
                        <span className="font-mono text-texte tabular-nums">
                            <PrivateAmount>
                                {gp && gp.retirementMonthsEvaluated > 0
                                    ? `${gp.retirementMonthsEvaluated} mois`
                                    : '—'}
                            </PrivateAmount>
                        </span>
                    </p>
                </section>

                {/* Carte 4 : Impôt successoral latent au décès */}
                <section
                    aria-labelledby={estateTitleId}
                    className="rounded-xl border border-bordure bg-surface-douce p-4 space-y-3 min-w-0"
                >
                    <h3 id={estateTitleId} className="text-h3 text-texte">
                        Impôt successoral latent au décès
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-bordure bg-fond p-3">
                        <table
                            aria-label="Impôt successoral déterministe"
                            className="w-full border-collapse text-meta"
                        >
                            <tbody>
                                <tr>
                                    <th scope="row" className="py-1 pr-3 text-left font-normal text-texte-doux">
                                        Total (projection de base)
                                    </th>
                                    <td className="py-1 text-right font-mono font-semibold text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.deterministicTotal !== null
                                                ? formatCAD(estate.deterministicTotal)
                                                : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                                <tr>
                                    <th scope="row" className="py-1 pr-3 text-left font-normal text-texte-doux">
                                        ARC (fédéral)
                                    </th>
                                    <td className="py-1 text-right font-mono font-medium text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.deterministicFed !== null
                                                ? formatCAD(estate.deterministicFed)
                                                : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                                <tr>
                                    <th scope="row" className="py-1 pr-3 text-left font-normal text-texte-doux">
                                        Revenu Québec
                                    </th>
                                    <td className="py-1 text-right font-mono font-medium text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.deterministicQc !== null
                                                ? formatCAD(estate.deterministicQc)
                                                : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="rounded-lg border border-bordure bg-fond p-3 space-y-1.5">
                        <div className="text-tiny font-medium text-texte-doux">Distribution Monte Carlo</div>
                        <table
                            aria-label="Distribution Monte Carlo de l'impôt successoral"
                            className="w-full border-collapse text-meta"
                        >
                            <tbody>
                                <tr>
                                    <th scope="row" className="py-1 pr-3 text-left font-normal text-texte-doux">
                                        P5
                                    </th>
                                    <td className="py-1 text-right font-mono font-medium text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.mcTotalP5 !== null ? formatCAD(estate.mcTotalP5) : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                                <tr>
                                    <th scope="row" className="py-1 pr-3 text-left font-normal text-texte-doux">
                                        P50
                                    </th>
                                    <td className="py-1 text-right font-mono font-medium text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.mcTotalP50 !== null ? formatCAD(estate.mcTotalP50) : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                                <tr>
                                    <th scope="row" className="py-1 pr-3 text-left font-normal text-texte-doux">
                                        P95
                                    </th>
                                    <td className="py-1 text-right font-mono font-medium text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.mcTotalP95 !== null ? formatCAD(estate.mcTotalP95) : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                                <tr className="border-t border-bordure">
                                    <th scope="row" className="pt-1.5 pb-1 pr-3 text-left font-normal text-texte-doux">
                                        Médiane réelle (dollars constants)
                                    </th>
                                    <td className="pt-1.5 pb-1 text-right font-mono font-medium text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.mcRealTotalP50 !== null
                                                ? formatCAD(estate.mcRealTotalP50)
                                                : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    </div>

                    <div className="rounded-lg border border-bordure bg-fond p-3 space-y-1.5">
                        <div className="text-tiny font-medium text-texte-doux">Ventilation imposable</div>
                        <table
                            aria-label="Ventilation imposable de la succession"
                            className="w-full border-collapse text-tiny"
                        >
                            <tbody>
                                <tr>
                                    <th scope="row" className="py-1 pr-3 text-left font-normal text-texte-doux">
                                        REER / FERR
                                    </th>
                                    <td className="py-1 text-right font-mono font-medium text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.taxableBreakdown.rrspRrif !== null
                                                ? formatCAD(estate.taxableBreakdown.rrspRrif)
                                                : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                                <tr>
                                    <th scope="row" className="py-1 pr-3 text-left font-normal text-texte-doux">
                                        Gain en capital imposable
                                    </th>
                                    <td className="py-1 text-right font-mono font-medium text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.taxableBreakdown.capitalGainsTaxable !== null
                                                ? formatCAD(estate.taxableBreakdown.capitalGainsTaxable)
                                                : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                                <tr>
                                    <th scope="row" className="py-1 pr-3 text-left font-normal text-texte-doux">
                                        Récupération DPA (locatif)
                                    </th>
                                    <td className="py-1 text-right font-mono font-medium text-texte tabular-nums">
                                        <PrivateAmount>
                                            {estate && estate.taxableBreakdown.rentalRecapture !== null
                                                ? formatCAD(estate.taxableBreakdown.rentalRecapture)
                                                : '—'}
                                        </PrivateAmount>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <p className="text-tiny text-texte-doux">
                        Âge projeté au décès :{' '}
                        <span className="font-mono text-texte tabular-nums">
                            <PrivateAge age={estate?.projectedDeathAge} />
                        </span>
                    </p>
                </section>
            </div>
        </section>
    );
};

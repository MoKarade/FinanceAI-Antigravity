// components/future/FutureScenarioHeader.tsx
// Bloc 1 Futur 4.0 : les 4 scénarios uniques + bandeau compact de mémoire & calcul profond.
// Règles non négociables :
//   - Variables sémantiques du socle visuel uniquement (zéro hex, zéro palette Tailwind, zéro white/black).
//   - Confidentialité stricte : tout montant, âge ou pourcentage personnel est enfant de <PrivateAmount>.
//   - Zéro donnée inventée : toute mesure absente ou non finie est rendue « — ».
//   - Accessibilité : cibles >= 44 px (touch-target min-h-11), aria-pressed sur les cartes, role="alert" / role="progressbar".

import React from 'react';
import {
    DEEP_SCENARIO_IDS,
    type DeepForecastProgress,
    type DeepForecastReport,
    type DeepScenarioId,
} from '../../services/projection/deepForecastTypes';
import type { DeepForecastStatus } from '../../hooks/useDeepForecast';
import { formatCompactCAD, formatDate, formatNumber } from '../../utils/format';
import { PrivateAmount } from '../ui/PrivateAmount';
import { Icon } from '../ui/Icon';

export interface FutureScenarioHeaderProps {
    report: DeepForecastReport;
    appliedReport: DeepForecastReport | null;
    pendingReport: DeepForecastReport | null;
    selectedScenario: DeepScenarioId;
    onSelectScenario: (scenario: DeepScenarioId) => void;
    status: DeepForecastStatus;
    isApplying: boolean;
    progress: DeepForecastProgress | null;
    error: string | null;
    unreadableStorage: boolean;
    isOutdated: boolean;
    hasPendingToApply: boolean;
    refusMessage: string | null;
    onLaunch: () => void;
    onCancel: () => void;
    onApplyPending: () => void;
    onDiscardPending: () => void;
}

const SCENARIO_DEFAULT_LABELS: Record<DeepScenarioId, string> = {
    real_trajectory: 'Trajectoire réelle',
    prudent_stress: 'Prudent / Stress',
    ai_optimized: 'Optimisé IA',
    favorable_tailwinds: 'Favorable',
};

const SCENARIO_FALLBACK_DESCRIPTIONS: Record<DeepScenarioId, string> = {
    real_trajectory: 'Projection ancrée sur ton budget, tes comptes et la fiscalité réelle.',
    prudent_stress: 'Scénario défensif testant marchés difficiles, inflation et hausse de taux.',
    ai_optimized: 'Pistes concrètes de placement fiscal, frais réduits et épargne réaliste.',
    favorable_tailwinds: 'Marchés porteurs, inflation maîtrisée et discipline budgétaire maintenue.',
};

function formatEtaFr(etaSeconds: number | null): string | null {
    if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds < 0) return null;
    const total = Math.round(etaSeconds);
    if (total < 60) return `~${total} s`;
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `~${mins} min ${secs} s`;
}

export const FutureScenarioHeader: React.FC<FutureScenarioHeaderProps> = ({
    report,
    appliedReport,
    pendingReport,
    selectedScenario,
    onSelectScenario,
    status,
    isApplying,
    progress,
    error,
    unreadableStorage,
    isOutdated,
    hasPendingToApply,
    refusMessage,
    onLaunch,
    onCancel,
    onApplyPending,
    onDiscardPending,
}) => {
    const realFinal = report.scenarios.real_trajectory?.milestones?.finalNetWorthP50;
    const aiFinal = report.scenarios.ai_optimized?.milestones?.finalNetWorthP50;
    const aiGainVsReal =
        typeof realFinal === 'number' && Number.isFinite(realFinal)
        && typeof aiFinal === 'number' && Number.isFinite(aiFinal)
            ? aiFinal - realFinal
            : null;

    const pctClamped =
        progress && Number.isFinite(progress.percent)
            ? Math.min(100, Math.max(0, progress.percent))
            : 0;
    const pctRounded = Math.round(pctClamped);
    const etaLabel = progress ? formatEtaFr(progress.etaSeconds) : null;

    const alertMessages: string[] = [];
    if (refusMessage) alertMessages.push(refusMessage);
    if (error) alertMessages.push(error);
    if (unreadableStorage && !error) {
        alertMessages.push(
            'Sauvegarde locale chiffrée illisible — relance l’analyse profonde pour régénérer la mémoire.',
        );
    }

    const launchDisabled = status === 'restoring' || Boolean(refusMessage);

    return (
        <section aria-label="Scénarios de trajectoire future" className="space-y-2 sm:space-y-3">
            <div className="flex overflow-x-auto no-scrollbar snap-x gap-2 pb-0.5 sm:grid sm:grid-cols-2 xl:grid-cols-4 sm:gap-3 sm:pb-0">
                {DEEP_SCENARIO_IDS.map((id) => {
                    const scenario = report.scenarios[id];
                    const isSelected = selectedScenario === id;
                    const label = scenario?.label?.trim() || SCENARIO_DEFAULT_LABELS[id];
                    const description =
                        scenario?.shortDescription?.trim() || SCENARIO_FALLBACK_DESCRIPTIONS[id];
                    const finalP50 = scenario?.milestones?.finalNetWorthP50;
                    const fiAge = scenario?.milestones?.fiAge;
                    const showAiGain = id === 'ai_optimized' && aiGainVsReal !== null && aiGainVsReal > 0;

                    return (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={isSelected}
                            title={description}
                            onClick={() => onSelectScenario(id)}
                            className={`touch-target min-h-11 min-w-[200px] sm:min-w-0 sm:w-full shrink-0 snap-start text-left rounded-card border p-2.5 sm:p-3.5 flex flex-col justify-between gap-1.5 sm:gap-2.5 transition-colors focus-ring ${
                                isSelected
                                    ? 'border-accent bg-surface-douce shadow-sm'
                                    : 'border-bordure bg-surface hover:border-bordure-champ hover:bg-surface-douce'
                            }`}
                        >
                            <span className="flex items-start justify-between gap-1.5 min-w-0">
                                <span className="text-meta sm:text-body font-bold text-texte break-words leading-snug">
                                    {label}
                                </span>
                                {id === 'real_trajectory' && (
                                    <span className="inline-flex items-center rounded-full border border-bordure-champ bg-fond px-2 py-0.5 text-[11px] font-bold text-texte-doux shrink-0">
                                        Défaut
                                    </span>
                                )}
                                {showAiGain && (
                                    <span className="inline-flex items-center rounded-full border border-succes-texte/30 bg-succes-fond px-2 py-0.5 text-[11px] font-bold text-succes-texte shrink-0">
                                        <PrivateAmount>+{formatCompactCAD(aiGainVsReal)}</PrivateAmount>
                                    </span>
                                )}
                            </span>

                            <span className="grid grid-cols-2 gap-1.5 pt-1.5 sm:pt-2 border-t border-bordure w-full min-w-0">
                                <span className="block min-w-0">
                                    <span className="block text-[11px] text-texte-doux truncate">
                                        Patrimoine central
                                    </span>
                                    <PrivateAmount className="block font-mono text-meta sm:text-body font-bold text-texte truncate">
                                        {typeof finalP50 === 'number' && Number.isFinite(finalP50)
                                            ? formatCompactCAD(finalP50)
                                            : '—'}
                                    </PrivateAmount>
                                </span>
                                <span className="block min-w-0 text-right">
                                    <span className="block text-[11px] text-texte-doux truncate">
                                        Indépendance
                                    </span>
                                    <PrivateAmount className="block font-mono text-meta sm:text-body font-bold text-texte truncate">
                                        {typeof fiAge === 'number' && Number.isFinite(fiAge)
                                            ? `${Math.round(fiAge)} ans`
                                            : '—'}
                                    </PrivateAmount>
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="rounded-card border border-bordure bg-surface p-2.5 sm:p-3.5 space-y-2">
                <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-3">
                    <div className="min-w-0 space-y-1 flex-1">
                        {hasPendingToApply && pendingReport ? (
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className="inline-flex items-center gap-1 rounded-full border border-succes-texte/30 bg-succes-fond px-2.5 py-0.5 text-tiny font-bold text-succes-texte">
                                    <Icon name="sparkles" size={13} />
                                    Nouvelle analyse prête
                                </span>
                                <p className="text-meta text-texte break-words m-0">
                                    {/* NOMBRE-NON-MONETAIRE : nombre technique de trajectoires simulées */}
                                    {formatNumber(pendingReport.trajectoriesRun)} trajectoires prêtes
                                </p>
                            </div>
                        ) : appliedReport ? (
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className="inline-flex items-center gap-1 rounded-full border border-bordure-champ bg-surface-douce px-2.5 py-0.5 text-tiny font-bold text-texte">
                                    <Icon name="check" size={13} className="text-succes-texte" />
                                    Analyse profonde en mémoire
                                </span>
                                <span className="hidden sm:inline text-meta text-texte-doux break-words">
                                    {formatDate(appliedReport.createdAt, {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                    })}
                                    {' · '}
                                    {/* NOMBRE-NON-MONETAIRE : nombre technique de trajectoires simulées */}
                                    {formatNumber(appliedReport.trajectoriesRun)} trajectoires
                                </span>
                                {isOutdated && (
                                    <span className="inline-flex items-center rounded-full border border-alerte-texte/30 bg-alerte-fond px-2.5 py-0.5 text-tiny font-bold text-alerte-texte">
                                        Données modifiées — tu peux relancer quand tu veux
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className="inline-flex items-center rounded-full border border-bordure-champ bg-surface-douce px-2.5 py-0.5 text-tiny font-bold text-texte">
                                    Aperçu rapide
                                </span>
                                <span className="hidden sm:inline text-tiny text-texte-doux">Prêt pour l’analyse approfondie</span>
                            </div>
                        )}

                        {status === 'cancelled' && !hasPendingToApply && !error && (
                            <p className="text-tiny text-texte-doux m-0">
                                Calcul interrompu — l’état précédent reste conservé.
                            </p>
                        )}
                    </div>

                    <div className={`flex items-stretch sm:items-center gap-2 shrink-0 ${status === 'running' || hasPendingToApply ? 'w-full sm:w-auto flex-col sm:flex-row' : ''}`}>
                        {status === 'running' && progress ? (
                            <button
                                type="button"
                                onClick={onCancel}
                                className="touch-target min-h-11 focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg border border-bordure-champ bg-surface-douce px-3.5 py-2 text-meta font-bold text-texte hover:bg-bordure transition-colors"
                            >
                                <Icon name="close" size={15} />
                                Annuler
                            </button>
                        ) : hasPendingToApply ? (
                            <>
                                <button
                                    type="button"
                                    disabled={isApplying}
                                    aria-busy={isApplying}
                                    onClick={onApplyPending}
                                    className="touch-target min-h-11 focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-meta font-bold text-sur-accent hover:bg-accent-fonce disabled:opacity-50 disabled:pointer-events-none transition-colors"
                                >
                                    <Icon name="check" size={15} />
                                    Appliquer et mémoriser
                                </button>
                                <button
                                    type="button"
                                    disabled={isApplying}
                                    onClick={onDiscardPending}
                                    className="touch-target min-h-11 focus-ring inline-flex items-center justify-center rounded-lg border border-bordure-champ bg-surface-douce px-3.5 py-2 text-meta font-bold text-texte hover:bg-bordure disabled:opacity-50 disabled:pointer-events-none transition-colors"
                                >
                                    Ignorer
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                disabled={launchDisabled}
                                onClick={onLaunch}
                                className="touch-target min-h-11 focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 sm:px-4 py-2 text-tiny sm:text-meta font-bold text-sur-accent hover:bg-accent-fonce disabled:opacity-50 disabled:pointer-events-none transition-colors whitespace-nowrap"
                            >
                                <Icon name="sparkles" size={15} />
                                {appliedReport !== null
                                    ? 'Relancer l’analyse profonde'
                                    : 'Lancer l’analyse profonde'}
                            </button>
                        )}
                    </div>
                </div>

                {status === 'running' && progress && (
                    <div className="space-y-1.5 pt-1 border-t border-bordure">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-tiny text-texte-doux">
                            <span role="status" className="font-semibold text-texte">
                                Phase {progress.phaseIndex}/{progress.phaseTotal} — {progress.phaseLabel}
                            </span>
                            <span className="font-mono">
                                {/* NOMBRE-NON-MONETAIRE : avancement technique en pourcentage */}
                                {pctRounded} %
                                {etaLabel ? ` · ETA ${etaLabel}` : ''}
                            </span>
                        </div>
                        {/* NOMBRE-NON-MONETAIRE : progression technique (0-100) */}
                        <div role="progressbar" aria-label="Progression de l’analyse profonde"
                            aria-valuenow={pctRounded} aria-valuemin={0} aria-valuemax={100}
                            className="h-2 w-full overflow-hidden rounded-full bg-fond border border-bordure"
                        >
                            {/* NOMBRE-NON-MONETAIRE : largeur de barre d'avancement technique */}
                            <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${pctRounded}%` }} />
                        </div>
                    </div>
                )}

                {alertMessages.length > 0 && (
                    <div
                        role="alert"
                        className="rounded-xl border border-erreur-texte/30 bg-erreur-fond px-3 py-2 text-meta text-erreur-texte break-words"
                    >
                        {alertMessages.join(' — ')}
                    </div>
                )}
            </div>
        </section>
    );
};

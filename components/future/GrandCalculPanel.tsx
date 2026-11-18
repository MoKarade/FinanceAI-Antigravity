import React, { useEffect, useId, useState } from 'react';
import type { GrandCalculConfig, GrandCalculResult } from '../../services/projection/types';
import type { GrandCalculProgress } from '../../services/projection/runAsync';
import type { GrandCalculStatus } from '../../store/types';
import {
    GRAND_CALCUL_ITERATIONS_MAX,
    GRAND_CALCUL_ITERATIONS_MIN,
    clampGrandCalculIterations,
} from '../../services/projection';
import { formatCAD, formatNumber, formatPercent } from '../../utils/format';
import { PrivateAmount } from '../ui/PrivateAmount';

export interface GrandCalculPanelProps {
    result: GrandCalculResult | null;
    status: GrandCalculStatus;
    progress: GrandCalculProgress | null;
    error: string | null;
    config: GrandCalculConfig;
    onUpdateConfig: (patch: Partial<GrandCalculConfig>) => void;
    isStale: boolean;
    showBands: boolean;
    onToggleBands: (show: boolean) => void;
    onLaunch: (overrideConfig?: Partial<GrandCalculConfig>) => void | Promise<void>;
    onCancel: () => void;
    onClear: () => void | Promise<void>;
    isRunning: boolean;
    isRestoring: boolean;
    isSaving?: boolean;
    refusMessage: string | null;
}

const PRESET_ITERATIONS = [50_000, 75_000, 100_000] as const;

function formatEta(etaMs: number | null): string {
    if (etaMs === null || !Number.isFinite(etaMs) || etaMs < 0) return '—';
    const totalSec = Math.max(0, Math.round(etaMs / 1000));
    if (totalSec < 60) return `~${totalSec} s`;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `~${mins} min ${secs} s`;
}

function formatDurationMs(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs < 0) return '—';
    if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
    const sec = durationMs / 1000;
    // NOMBRE-NON-MONETAIRE : durée technique d'exécution du calcul
    if (sec < 60) return `${formatNumber(sec, { decimals: 1 })} s`;
    const mins = Math.floor(sec / 60);
    const remSec = Math.round(sec % 60);
    return `${mins} min ${remSec} s`;
}

export const GrandCalculPanel: React.FC<GrandCalculPanelProps> = ({
    result,
    status,
    progress,
    error,
    config,
    onUpdateConfig,
    isStale,
    showBands,
    onToggleBands,
    onLaunch,
    onCancel,
    onClear,
    isRunning,
    isRestoring,
    isSaving = false,
    refusMessage,
}) => {
    const titleId = useId();
    const iterInputId = useId();
    const [iterDraft, setIterDraft] = useState<string>(() => String(config.iterations));

    useEffect(() => {
        setIterDraft(String(config.iterations));
    }, [config.iterations]);

    const commitIterations = (): number => {
        const parsed = Number(iterDraft.trim().replace(/\s+/g, ''));
        const next = Number.isFinite(parsed) && iterDraft.trim() !== ''
            ? clampGrandCalculIterations(parsed)
            : GRAND_CALCUL_ITERATIONS_MIN;
        setIterDraft(String(next));
        if (next !== config.iterations) {
            onUpdateConfig({ iterations: next });
        }
        return next;
    };

    const handleLaunchClick = () => {
        const clamped = commitIterations();
        void onLaunch({ iterations: clamped });
    };

    const rawPct = progress?.pct;
    const pctClamped = typeof rawPct === 'number' && Number.isFinite(rawPct)
        ? Math.min(100, Math.max(0, rawPct))
        : 0;
    const pctRounded = Math.round(pctClamped);
    const hasBands = Boolean(result && result.monthlyBands.length > 0);
    const disabledControls = isRunning || isRestoring;

    return (
        <section
            aria-labelledby={titleId}
            className="rounded-2xl bg-surface border border-bordure px-3.5 py-4 sm:px-5 sm:py-5 space-y-4"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                    <h2 id={titleId} className="text-h2 text-texte">
                        Grand Calcul Monte Carlo
                    </h2>
                    <p className="text-meta text-texte-doux">
                        {/* NOMBRE-NON-MONETAIRE : plage technique d'itérations Monte Carlo */}
                        Simulation approfondie à la demande ({formatNumber(GRAND_CALCUL_ITERATIONS_MIN)} à{' '}
                        {/* NOMBRE-NON-MONETAIRE : borne supérieure d'itérations Monte Carlo */}
                        {formatNumber(GRAND_CALCUL_ITERATIONS_MAX)} trajectoires) en tâche de fond via Web Worker.
                    </p>
                </div>

                {result && (
                    <div className="flex flex-wrap items-center gap-2">
                        {result.regimesEnabled && (
                            <span className="inline-flex items-center rounded-full bg-surface-douce border border-bordure px-2.5 py-1 text-tiny text-texte-doux">
                                Régimes macroéconomiques
                            </span>
                        )}
                        {result.historicalCrisesEnabled && (
                            <span className="inline-flex items-center rounded-full bg-surface-douce border border-bordure px-2.5 py-1 text-tiny text-texte-doux">
                                Crises historiques
                            </span>
                        )}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                <div className="lg:col-span-5 space-y-2">
                    <label htmlFor={iterInputId} className="block text-meta font-medium text-texte">
                        Nombre de trajectoires
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            id={iterInputId}
                            type="number"
                            min={GRAND_CALCUL_ITERATIONS_MIN}
                            max={GRAND_CALCUL_ITERATIONS_MAX}
                            step={5000}
                            value={iterDraft}
                            disabled={disabledControls}
                            onChange={(e) => {
                                const raw = e.target.value;
                                setIterDraft(raw);
                                const parsed = Number(raw);
                                if (
                                    raw.trim() !== '' &&
                                    Number.isFinite(parsed) &&
                                    parsed >= GRAND_CALCUL_ITERATIONS_MIN &&
                                    parsed <= GRAND_CALCUL_ITERATIONS_MAX
                                ) {
                                    onUpdateConfig({ iterations: Math.round(parsed) });
                                }
                            }}
                            onBlur={commitIterations}
                            className="touch-target min-h-11 w-36 rounded-lg border border-bordure-champ bg-surface-douce px-3 py-2 text-body font-mono text-texte tabular-nums focus-ring disabled:opacity-50"
                        />
                        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Préréglages du nombre de trajectoires">
                            {PRESET_ITERATIONS.map((preset) => {
                                const active = config.iterations === preset;
                                return (
                                    <button
                                        key={preset}
                                        type="button"
                                        aria-pressed={active}
                                        disabled={disabledControls}
                                        onClick={() => {
                                            setIterDraft(String(preset));
                                            onUpdateConfig({ iterations: preset });
                                        }}
                                        className={`touch-target min-h-11 px-3 py-2 rounded-lg border text-meta font-mono tabular-nums transition-colors focus-ring disabled:opacity-50 ${
                                            active
                                                ? 'bg-accent text-sur-accent border-accent font-semibold'
                                                : 'bg-surface-douce text-texte border-bordure-champ hover:bg-bordure'
                                        }`}
                                    >
                                        {/* NOMBRE-NON-MONETAIRE : préréglage technique du nombre de trajectoires */}
                                        {formatNumber(preset)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-7 flex flex-wrap items-center gap-2.5">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={config.enableMacroRegimes}
                        disabled={disabledControls}
                        onClick={() => onUpdateConfig({ enableMacroRegimes: !config.enableMacroRegimes })}
                        className="touch-target min-h-11 inline-flex items-center gap-2.5 px-3 py-2 rounded-lg border border-bordure bg-surface-douce text-meta text-texte transition-colors focus-ring hover:bg-bordure disabled:opacity-50"
                    >
                        <span
                            aria-hidden="true"
                            className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                                config.enableMacroRegimes
                                    ? 'justify-end border-accent bg-accent text-sur-accent'
                                    : 'justify-start border-bordure-champ bg-fond text-texte-doux'
                            }`}
                        >
                            <span
                                className={`h-3.5 w-3.5 rounded-full ${
                                    config.enableMacroRegimes ? 'bg-sur-accent' : 'bg-texte-doux'
                                }`}
                            />
                        </span>
                        <span>Régimes macroéconomiques</span>
                    </button>

                    <button
                        type="button"
                        role="switch"
                        aria-checked={config.includeHistoricalCrises}
                        disabled={disabledControls}
                        onClick={() => onUpdateConfig({ includeHistoricalCrises: !config.includeHistoricalCrises })}
                        className="touch-target min-h-11 inline-flex items-center gap-2.5 px-3 py-2 rounded-lg border border-bordure bg-surface-douce text-meta text-texte transition-colors focus-ring hover:bg-bordure disabled:opacity-50"
                    >
                        <span
                            aria-hidden="true"
                            className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                                config.includeHistoricalCrises
                                    ? 'justify-end border-accent bg-accent text-sur-accent'
                                    : 'justify-start border-bordure-champ bg-fond text-texte-doux'
                            }`}
                        >
                            <span
                                className={`h-3.5 w-3.5 rounded-full ${
                                    config.includeHistoricalCrises ? 'bg-sur-accent' : 'bg-texte-doux'
                                }`}
                            />
                        </span>
                        <span>Crises historiques</span>
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
                <button
                    type="button"
                    onClick={handleLaunchClick}
                    disabled={isRunning || isRestoring || isSaving || Boolean(refusMessage)}
                    className="touch-target min-h-11 px-4 py-2 rounded-xl bg-accent hover:bg-accent-fonce text-sur-accent font-semibold text-body transition-colors focus-ring disabled:opacity-50"
                >
                    {result ? 'Relancer le Grand Calcul' : 'Lancer le Grand Calcul'}
                </button>

                {isRunning && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="touch-target min-h-11 px-4 py-2 rounded-xl border border-bordure-champ bg-surface-douce text-texte font-medium text-body transition-colors focus-ring hover:bg-bordure"
                    >
                        Annuler
                    </button>
                )}

                {hasBands && (
                    <button
                        type="button"
                        aria-pressed={showBands}
                        onClick={() => onToggleBands(!showBands)}
                        className={`touch-target min-h-11 px-3.5 py-2 rounded-xl border text-meta font-medium transition-colors focus-ring ${
                            showBands
                                ? 'border-bordure-champ bg-repere-doux text-repere'
                                : 'border-bordure bg-surface-douce text-texte-doux hover:text-texte'
                        }`}
                    >
                        Afficher les bandes P5–P95 sur la courbe
                    </button>
                )}

                {result && !isRunning && (
                    <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void onClear()}
                        className="touch-target min-h-11 px-3.5 py-2 rounded-xl border border-bordure-champ bg-surface-douce text-texte-doux hover:text-texte text-meta font-medium transition-colors focus-ring disabled:opacity-50"
                    >
                        Effacer les résultats
                    </button>
                )}
            </div>

            {isRestoring && (
                <div role="status" aria-live="polite" className="text-meta text-texte-doux">
                    Restauration de la sauvegarde locale…
                </div>
            )}

            {isSaving && !isRunning && !isRestoring && (
                <div role="status" aria-live="polite" className="text-meta text-texte-doux">
                    Sauvegarde locale en cours…
                </div>
            )}

            {isRunning && (
                <div className="rounded-xl border border-bordure bg-surface-douce p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-meta">
                        <span className="font-medium text-texte">Calcul en cours en arrière-plan…</span>
                        <span role="status" aria-live="polite" className="font-mono text-texte-doux tabular-nums">
                            {/* NOMBRE-NON-MONETAIRE : avancement technique du Grand Calcul */}
                            {pctRounded} % · {formatNumber(progress?.done ?? 0)} / {formatNumber(progress?.total ?? config.iterations)}
                            {' · '}
                            {/* NOMBRE-NON-MONETAIRE : cadence technique de simulation */}
                            {progress?.simPerSec !== null && progress?.simPerSec !== undefined
                                ? `${formatNumber(progress.simPerSec)} sim/s`
                                : '—'}
                            {' · '}
                            ETA {formatEta(progress?.etaMs ?? null)}
                        </span>
                    </div>
                    <div
                        role="progressbar"
                        aria-label="Progression du Grand Calcul"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        /* NOMBRE-NON-MONETAIRE : pourcentage technique d'avancement du worker */
                        aria-valuenow={pctRounded}
                        className="h-2.5 w-full overflow-hidden rounded-full bg-fond border border-bordure"
                    >
                        <div
                            className="h-full bg-accent transition-all duration-150"
                            /* NOMBRE-NON-MONETAIRE : barre de progression technique du worker */
                            style={{ width: `${pctClamped}%` }}
                        />
                    </div>
                </div>
            )}

            {isStale && !isRunning && (
                <div
                    role="status"
                    className="rounded-xl border border-alerte-texte/30 bg-alerte-fond px-3.5 py-2.5 text-meta text-alerte-texte"
                >
                    Paramètres modifiés — le résultat affiché n&apos;est plus à jour. Relancez le Grand Calcul pour actualiser.
                </div>
            )}

            {status === 'cancelled' && !isRunning && (
                <div
                    role="status"
                    className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-2.5 text-meta text-texte-doux"
                >
                    Calcul annulé.
                </div>
            )}

            {status === 'error' && error && !isRunning && (
                <div
                    role="alert"
                    className="rounded-xl border border-erreur-texte/30 bg-erreur-fond px-3.5 py-2.5 text-meta text-erreur-texte"
                >
                    {error}
                </div>
            )}

            {result ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-3 space-y-1">
                        <div className="text-tiny text-texte-doux">Simulations effectuées</div>
                        <div className="text-body font-mono font-semibold text-texte tabular-nums">
                            {/* NOMBRE-NON-MONETAIRE : nombre de trajectoires simulées */}
                            {formatNumber(result.iterationsRun)} simulations
                        </div>
                        <div className="text-tiny text-texte-doux font-mono tabular-nums">
                            {/* NOMBRE-NON-MONETAIRE : durée technique d'exécution */}
                            Durée : {formatDurationMs(result.durationMs)}
                        </div>
                    </div>

                    <div className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-3 space-y-1">
                        <div className="text-tiny text-texte-doux">Taux de survie</div>
                        <div className="text-body font-mono font-semibold text-texte tabular-nums">
                            <PrivateAmount>
                                {result.survivalRatePct !== null
                                    ? formatPercent(result.survivalRatePct, 1)
                                    : '—'}
                            </PrivateAmount>
                        </div>
                    </div>

                    <div className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-3 space-y-1">
                        <div className="text-tiny text-texte-doux">CVaR 95 % (queue pessimiste)</div>
                        <div className="text-body font-mono font-semibold text-texte tabular-nums">
                            <PrivateAmount>
                                {result.cvar95 !== null ? formatCAD(result.cvar95) : '—'}
                            </PrivateAmount>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-3 space-y-1">
                        <div className="text-tiny text-texte-doux">Aucun calcul enregistré</div>
                        <div className="text-body font-mono font-semibold text-texte tabular-nums">
                            <PrivateAmount>{'—'}</PrivateAmount>
                        </div>
                    </div>
                    <div className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-3 space-y-1">
                        <div className="text-tiny text-texte-doux">Dernier résultat</div>
                        <div className="text-body font-mono font-semibold text-texte tabular-nums">
                            <PrivateAmount>{'—'}</PrivateAmount>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};

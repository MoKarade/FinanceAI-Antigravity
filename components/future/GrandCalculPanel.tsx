import React, { useEffect, useId, useMemo, useState } from 'react';
import type { GrandCalculConfig, GrandCalculResult, GrandCalculMonthlyBand } from '../../services/projection/types';
import type { GrandCalculProgress } from '../../services/projection/runAsync';
import type { GrandCalculStatus } from '../../store/types';
import { useFinanceStore } from '../../store/useFinanceStore';
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

interface FanSvgGeometry {
    width: number;
    height: number;
    outerPoly: string;
    midPoly: string;
    iqrPoly: string;
    p90Line: string;
    p50Line: string;
    p10Line: string;
    zeroY: number | null;
}

function buildMonteCarloFanSvg(bands: ReadonlyArray<GrandCalculMonthlyBand>): FanSvgGeometry | null {
    if (bands.length < 2) return null;
    const width = 640;
    const height = 112;
    const padY = 8;
    const usableH = height - padY * 2;

    const sampleStep = bands.length > 72 ? Math.ceil(bands.length / 72) : 1;
    const sampled: GrandCalculMonthlyBand[] = [];
    for (let i = 0; i < bands.length; i += sampleStep) {
        sampled.push(bands[i]);
    }
    if (sampled[sampled.length - 1] !== bands[bands.length - 1]) {
        sampled.push(bands[bands.length - 1]);
    }

    let minVal = Number.POSITIVE_INFINITY;
    let maxVal = Number.NEGATIVE_INFINITY;
    for (const b of sampled) {
        const vals = [b.p5, b.p10, b.p25, b.p50, b.p75, b.p90, b.p95];
        for (const v of vals) {
            if (Number.isFinite(v)) {
                if (v < minVal) minVal = v;
                if (v > maxVal) maxVal = v;
            }
        }
    }
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return null;
    const span = maxVal - minVal > 1 ? maxVal - minVal : 1;

    const xAt = (idx: number): number =>
        sampled.length <= 1 ? 0 : Number(((idx / (sampled.length - 1)) * width).toFixed(1));
    const yAt = (val: number): number => {
        const safe = Number.isFinite(val) ? val : minVal;
        const norm = (safe - minVal) / span;
        return Number((padY + usableH * (1 - norm)).toFixed(1));
    };

    const bandPolygon = (upperKey: 'p95' | 'p90' | 'p75', lowerKey: 'p5' | 'p10' | 'p25'): string => {
        const top = sampled.map((b, i) => `${xAt(i)},${yAt(b[upperKey])}`);
        const bot = [...sampled]
            .reverse()
            .map((b, revI) => `${xAt(sampled.length - 1 - revI)},${yAt(b[lowerKey])}`);
        return [...top, ...bot].join(' ');
    };

    const linePath = (key: 'p90' | 'p50' | 'p10'): string =>
        sampled.map((b, i) => `${xAt(i)},${yAt(b[key])}`).join(' ');

    const zeroY = minVal < 0 && maxVal > 0 ? yAt(0) : null;

    return {
        width,
        height,
        outerPoly: bandPolygon('p95', 'p5'),
        midPoly: bandPolygon('p90', 'p10'),
        iqrPoly: bandPolygon('p75', 'p25'),
        p90Line: linePath('p90'),
        p50Line: linePath('p50'),
        p10Line: linePath('p10'),
        zeroY,
    };
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
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
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

    const lastBand = useMemo(() => {
        if (!result || result.monthlyBands.length === 0) return null;
        return result.monthlyBands[result.monthlyBands.length - 1] ?? null;
    }, [result]);

    const fanSvg = useMemo(
        () => (result ? buildMonteCarloFanSvg(result.monthlyBands) : null),
        [result],
    );

    const safeSurvivalPct =
        result && result.survivalRatePct !== null && Number.isFinite(result.survivalRatePct)
            ? Math.min(100, Math.max(0, result.survivalRatePct))
            : null;
    const survivalBarClass =
        safeSurvivalPct === null
            ? 'bg-texte-doux'
            : safeSurvivalPct >= 85
              ? 'bg-succes-texte'
              : safeSurvivalPct >= 65
                ? 'bg-alerte-texte'
                : 'bg-erreur-texte';

    return (
        <section
            aria-labelledby={titleId}
            className="rounded-2xl bg-surface border border-bordure px-3.5 py-4 sm:px-5 sm:py-5 space-y-4"
        >
            {/* En-tête unifié avec badges et actions post-calcul */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 id={titleId} className="text-h2 text-texte">
                            Grand Calcul Monte Carlo
                        </h2>
                        {result?.regimesEnabled && (
                            <span className="inline-flex items-center rounded-full bg-surface-douce border border-bordure px-2.5 py-0.5 text-tiny text-texte-doux">
                                Régimes macroéconomiques
                            </span>
                        )}
                        {result?.historicalCrisesEnabled && (
                            <span className="inline-flex items-center rounded-full bg-surface-douce border border-bordure px-2.5 py-0.5 text-tiny text-texte-doux">
                                Crises historiques
                            </span>
                        )}
                    </div>
                    <p className="text-meta text-texte-doux">
                        {/* NOMBRE-NON-MONETAIRE : plage technique d'itérations Monte Carlo */}
                        Simulation approfondie ({formatNumber(GRAND_CALCUL_ITERATIONS_MIN)} à{' '}
                        {/* NOMBRE-NON-MONETAIRE : borne supérieure d'itérations Monte Carlo */}
                        {formatNumber(GRAND_CALCUL_ITERATIONS_MAX)} trajectoires) en tâche de fond via Web Worker.
                    </p>
                </div>

                {result && (
                    <div className="flex flex-wrap items-center gap-2">
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
                        {!isRunning && (
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
                )}
            </div>

            {/* Barre de commande compacte sans boutons redondants */}
            <div className="rounded-xl border border-bordure bg-surface-douce/60 p-3 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                    <div className="flex items-center gap-2">
                        <label htmlFor={iterInputId} className="text-meta font-medium text-texte whitespace-nowrap">
                            Nombre de trajectoires
                        </label>
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
                            className="touch-target min-h-11 w-32 rounded-lg border border-bordure-champ bg-fond px-3 py-2 text-body font-mono text-texte tabular-nums focus-ring disabled:opacity-50"
                        />
                    </div>

                    <button
                        type="button"
                        role="switch"
                        aria-checked={config.enableMacroRegimes}
                        disabled={disabledControls}
                        onClick={() => onUpdateConfig({ enableMacroRegimes: !config.enableMacroRegimes })}
                        className="touch-target min-h-11 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-bordure bg-fond text-meta text-texte transition-colors focus-ring hover:bg-bordure disabled:opacity-50"
                    >
                        <span
                            aria-hidden="true"
                            className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                                config.enableMacroRegimes
                                    ? 'justify-end border-accent bg-accent text-sur-accent'
                                    : 'justify-start border-bordure-champ bg-surface-douce text-texte-doux'
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
                        className="touch-target min-h-11 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-bordure bg-fond text-meta text-texte transition-colors focus-ring hover:bg-bordure disabled:opacity-50"
                    >
                        <span
                            aria-hidden="true"
                            className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                                config.includeHistoricalCrises
                                    ? 'justify-end border-accent bg-accent text-sur-accent'
                                    : 'justify-start border-bordure-champ bg-surface-douce text-texte-doux'
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

                <div className="flex flex-wrap items-center gap-2">
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
                            className="touch-target min-h-11 px-4 py-2 rounded-xl border border-bordure-champ bg-surface text-texte font-medium text-body transition-colors focus-ring hover:bg-bordure"
                        >
                            Annuler
                        </button>
                    )}
                </div>
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
                <div className="space-y-3 pt-1">
                    {/* Ligne 1 : 4 tuiles KPI synthétiques + jauge de survie */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-3 space-y-1.5 min-w-0">
                            <div className="text-tiny text-texte-doux">Taux de survie</div>
                            <div className="text-lg font-mono font-bold text-texte tabular-nums">
                                <PrivateAmount>
                                    {result.survivalRatePct !== null
                                        ? formatPercent(result.survivalRatePct, 1)
                                        : '—'}
                                </PrivateAmount>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-fond overflow-hidden border border-bordure/60">
                                <div
                                    className={`h-full rounded-full transition-all duration-300 ${survivalBarClass}`}
                                    style={{ width: `${isPrivacyMode || safeSurvivalPct === null ? 0 : safeSurvivalPct}%` }}
                                />
                            </div>
                        </div>

                        <div className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-3 space-y-1 min-w-0">
                            <div className="text-tiny text-texte-doux">Médiane à l&apos;horizon (P50)</div>
                            <div className="text-lg font-mono font-bold text-texte tabular-nums">
                                <PrivateAmount>{lastBand ? formatCAD(lastBand.p50) : '—'}</PrivateAmount>
                            </div>
                            <div className="text-tiny text-texte-doux truncate">
                                Scénario central en fin de projection
                            </div>
                        </div>

                        <div className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-3 space-y-1 min-w-0">
                            <div className="text-tiny text-texte-doux">Plancher prudent (P10)</div>
                            <div className="text-lg font-mono font-bold text-texte tabular-nums">
                                <PrivateAmount>{lastBand ? formatCAD(lastBand.p10) : '—'}</PrivateAmount>
                            </div>
                            <div className="text-tiny text-texte-doux truncate">
                                Seuil bas hors décile défavorable
                            </div>
                        </div>

                        <div className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-3 space-y-1 min-w-0">
                            <div className="text-tiny text-texte-doux">CVaR 95 % (queue pessimiste)</div>
                            <div className="text-lg font-mono font-bold text-texte tabular-nums">
                                <PrivateAmount>
                                    {result.cvar95 !== null ? formatCAD(result.cvar95) : '—'}
                                </PrivateAmount>
                            </div>
                            <div className="text-tiny text-texte-doux font-mono tabular-nums truncate">
                                {/* NOMBRE-NON-MONETAIRE : nombre de trajectoires simulées et durée technique */}
                                {formatNumber(result.iterationsRun)} simulations · Durée : {formatDurationMs(result.durationMs)}
                            </div>
                        </div>
                    </div>

                    {/* Ligne 2 : Cône probabiliste SVG (P5 -> P95) + spectre des quantiles finaux */}
                    {lastBand && (
                        <div className="rounded-xl border border-bordure bg-surface-douce/60 p-3.5 sm:p-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-meta font-semibold text-texte">
                                    Éventail probabiliste du patrimoine (P5 → P95)
                                </span>
                                <span className="text-tiny text-texte-doux">
                                    Médiane, quartiles et bandes extrêmes sur tout l&apos;horizon
                                </span>
                            </div>

                            {fanSvg && !isPrivacyMode && (
                                <svg
                                    viewBox={`0 0 ${fanSvg.width} ${fanSvg.height}`}
                                    preserveAspectRatio="none"
                                    aria-hidden="true"
                                    className="w-full h-24 sm:h-28 rounded-lg bg-fond/70 border border-bordure/60"
                                >
                                    {fanSvg.zeroY !== null && (
                                        <line
                                            x1={0}
                                            x2={fanSvg.width}
                                            y1={fanSvg.zeroY}
                                            y2={fanSvg.zeroY}
                                            stroke="var(--bordure-champ)"
                                            strokeWidth="1"
                                            strokeDasharray="3 3"
                                        />
                                    )}
                                    <polygon points={fanSvg.outerPoly} fill="var(--repere)" fillOpacity="0.10" />
                                    <polygon points={fanSvg.midPoly} fill="var(--accent)" fillOpacity="0.16" />
                                    <polygon points={fanSvg.iqrPoly} fill="var(--accent)" fillOpacity="0.26" />
                                    <polyline
                                        points={fanSvg.p90Line}
                                        fill="none"
                                        stroke="var(--succes-texte)"
                                        strokeWidth="1.25"
                                        strokeDasharray="4 3"
                                    />
                                    <polyline
                                        points={fanSvg.p10Line}
                                        fill="none"
                                        stroke="var(--erreur-texte)"
                                        strokeWidth="1.25"
                                        strokeDasharray="4 3"
                                    />
                                    <polyline
                                        points={fanSvg.p50Line}
                                        fill="none"
                                        stroke="var(--accent)"
                                        strokeWidth="2.2"
                                    />
                                </svg>
                            )}

                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                <div className="rounded-lg border border-bordure bg-fond px-2.5 py-2 space-y-0.5 min-w-0">
                                    <div className="text-tiny text-texte-doux">P5 (stress)</div>
                                    <div className="text-meta font-mono font-semibold text-erreur-texte tabular-nums truncate">
                                        <PrivateAmount>{formatCAD(lastBand.p5)}</PrivateAmount>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-bordure bg-fond px-2.5 py-2 space-y-0.5 min-w-0">
                                    <div className="text-tiny text-texte-doux">P10 (prudent)</div>
                                    <div className="text-meta font-mono font-semibold text-alerte-texte tabular-nums truncate">
                                        <PrivateAmount>{formatCAD(lastBand.p10)}</PrivateAmount>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-accent/40 bg-surface px-2.5 py-2 space-y-0.5 min-w-0 col-span-2 sm:col-span-1">
                                    <div className="text-tiny font-semibold text-texte">P50 (médiane)</div>
                                    <div className="text-meta font-mono font-bold text-texte tabular-nums truncate">
                                        <PrivateAmount>{formatCAD(lastBand.p50)}</PrivateAmount>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-bordure bg-fond px-2.5 py-2 space-y-0.5 min-w-0">
                                    <div className="text-tiny text-texte-doux">P90 (favorable)</div>
                                    <div className="text-meta font-mono font-semibold text-succes-texte tabular-nums truncate">
                                        <PrivateAmount>{formatCAD(lastBand.p90)}</PrivateAmount>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-bordure bg-fond px-2.5 py-2 space-y-0.5 min-w-0">
                                    <div className="text-tiny text-texte-doux">P95 (porteur)</div>
                                    <div className="text-meta font-mono font-semibold text-succes-texte tabular-nums truncate">
                                        <PrivateAmount>{formatCAD(lastBand.p95)}</PrivateAmount>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="rounded-xl border border-bordure bg-surface-douce/50 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-tiny text-texte-doux">
                        <span>Aucun calcul enregistré</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono font-semibold text-texte tabular-nums">
                            <PrivateAmount>{'—'}</PrivateAmount>
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-tiny text-texte-doux">
                        <span>Dernier résultat</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono font-semibold text-texte tabular-nums">
                            <PrivateAmount>{'—'}</PrivateAmount>
                        </span>
                    </div>
                </div>
            )}
        </section>
    );
};

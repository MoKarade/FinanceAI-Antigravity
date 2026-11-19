// hooks/useDeepForecast.ts
// Hook React d'orchestration Futur 4.0 :
//   - Fournit instantanément `quickPreviewReport` (aperçu léger synchrone sans 100k trajectoires).
//   - Restaure au montage (ou changement de scope) le rapport appliqué et chiffré en IndexedDB
//     (`appliedReport`), isolé strictement entre dossier réel ('real') et personas de test ('test:<id>').
//   - Exécute le calcul profond à la demande explicite (`launchDeepForecast`) dans `pendingReport`
//     (statut `'staged'`) SANS écraser `appliedReport` ni IndexedDB avant confirmation utilisateur.
//   - Applique et mémorise explicitement via `applyPendingReport()`, ou rejette via `discardPendingReport()`.
//   - Annule proprement via `AbortController` (`cancelDeepForecast()`), y compris en plein vol lors
//     d'un changement de mode test ou de persona.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useFinanceStore } from '../store/useFinanceStore';
import type { Asset, BudgetCategory, Debt, RealEstateGoal, Transaction } from '../types';
import type { ProjectionResult, SimulationParams } from '../services/projection/types';
import type {
    DeepForecastProgress,
    DeepForecastReport,
    DeepScenarioId,
} from '../services/projection/deepForecastTypes';
import { computeQuickFourScenarios } from '../services/projection/deepScenarioEngine';
import { analyzeRealPastDossier } from '../services/projection/realPastAndNewsAnalyzer';
import {
    DEEP_FORECAST_CANCELLED,
    computeDeepForecastInputsSig,
    runDeepForecastAsync,
} from '../services/projection/runDeepForecastAsync';
import {
    clearAppliedDeepForecast,
    loadAppliedDeepForecast,
    saveAppliedDeepForecast,
    type DeepForecastStorageScope,
} from '../services/deepForecastStore';
import { messageDeRefus } from '../services/projection/verifierEntreesMoteur';
import { logError } from '../services/errorLogger';

export type DeepForecastStatus =
    | 'idle'
    | 'restoring'
    | 'running'
    | 'staged'
    | 'error'
    | 'cancelled';

export interface UseDeepForecastOptions {
    trajectoriesOverride?: number;
    skipNetwork?: boolean;
    maxWorkers?: number;
}

export interface UseDeepForecastReturn {
    activeReport: DeepForecastReport;
    appliedReport: DeepForecastReport | null;
    pendingReport: DeepForecastReport | null;
    quickPreviewReport: DeepForecastReport;
    selectedScenario: DeepScenarioId;
    setSelectedScenario: (scenario: DeepScenarioId) => void;
    status: DeepForecastStatus;
    isApplying: boolean;
    progress: DeepForecastProgress | null;
    error: string | null;
    unreadableStorage: boolean;
    isMemorized: boolean;
    isOutdated: boolean;
    hasPendingToApply: boolean;
    currentInputsSig: string;
    refusMessage: string | null;
    launchDeepForecast: () => Promise<void>;
    cancelDeepForecast: () => void;
    applyPendingReport: () => Promise<boolean>;
    discardPendingReport: () => void;
    clearAppliedReport: () => Promise<void>;
}

const EMPTY_ARRAY: never[] = [];
const DEFAULT_TRAJECTORIES_TOTAL = 100_000;

const UNREADABLE_ERROR_MESSAGE =
    'Donnée illisible — la sauvegarde locale chiffrée du rapport Futur 4.0 est corrompue ou inaccessible. Relancez une analyse.';

const SAVE_FAILED_ERROR_MESSAGE =
    'Sauvegarde locale impossible (espace ou stockage restreint) — le rapport reste en prévisualisation pour cette session.';

function resolveScopeKey(isTestMode: boolean, personaId: string | null): string {
    if (!isTestMode) return 'real';
    return `test:${personaId || 'default'}`;
}

function buildScope(isTestMode: boolean, personaId: string | null): DeepForecastStorageScope {
    return {
        isTestMode,
        personaId: isTestMode ? personaId : null,
    };
}

// File d'attente FIFO par scope pour sérialiser lectures, écritures et effacements IndexedDB
// et éliminer toute course lors des bascules rapides mode réel <-> persona de test.
function createSlotSerializer() {
    let queue: Promise<void> = Promise.resolve();
    let pendingCount = 0;

    return function enqueue<T>(op: () => Promise<T>): Promise<T> {
        const isIdle = pendingCount === 0;
        pendingCount += 1;
        let run: Promise<T>;
        if (isIdle) {
            try {
                run = Promise.resolve(op());
            } catch (err) {
                run = Promise.reject(err);
            }
        } else {
            run = queue.then(op, op);
        }
        queue = run.then(
            () => {
                pendingCount -= 1;
            },
            () => {
                pendingCount -= 1;
            },
        );
        return run;
    };
}

const _scopeSerializers = new Map<string, ReturnType<typeof createSlotSerializer>>();

function enqueueScopeOp<T>(scopeKey: string, op: () => Promise<T>): Promise<T> {
    let serializer = _scopeSerializers.get(scopeKey);
    if (!serializer) {
        serializer = createSlotSerializer();
        _scopeSerializers.set(scopeKey, serializer);
    }
    return serializer(op);
}

export function useDeepForecast(
    params: SimulationParams,
    baseProjection?: ProjectionResult | null,
    options?: UseDeepForecastOptions,
): UseDeepForecastReturn {
    const {
        isTestMode,
        activeTestPersonaId,
        transactions,
        assets,
        fxRates,
        budgetItems,
        debts,
        realEstateGoals,
        config,
        valoriaRiskProfile,
        geminiApiKey,
        storeLastProjection,
    } = useFinanceStore(
        useShallow((s) => ({
            isTestMode: s.isTestMode,
            activeTestPersonaId: s.activeTestPersonaId,
            transactions: s.transactions ?? EMPTY_ARRAY,
            assets: s.assets ?? EMPTY_ARRAY,
            fxRates: s.fxRates,
            budgetItems: s.budgetItems ?? EMPTY_ARRAY,
            debts: s.debts ?? EMPTY_ARRAY,
            realEstateGoals: s.realEstateGoals ?? EMPTY_ARRAY,
            config: s.config,
            valoriaRiskProfile: s.valoriaRiskProfile,
            geminiApiKey: s.apiKeys?.gemini ?? '',
            storeLastProjection: s.lastProjection,
        })),
    );

    const resolvedBaseProjection =
        baseProjection !== undefined ? baseProjection : storeLastProjection;

    const trajectoriesOverride = options?.trajectoriesOverride;
    const skipNetwork = options?.skipNetwork;
    const maxWorkers = options?.maxWorkers;

    const scopePersonaId = isTestMode ? activeTestPersonaId : null;
    const scopeKey = resolveScopeKey(isTestMode, scopePersonaId);

    const [appliedReport, setAppliedReport] = useState<DeepForecastReport | null>(null);
    const [pendingReport, setPendingReport] = useState<DeepForecastReport | null>(null);
    const [selectedScenario, setSelectedScenario] = useState<DeepScenarioId>('real_trajectory');
    const [status, setStatus] = useState<DeepForecastStatus>('restoring');
    const [isApplying, setIsApplying] = useState<boolean>(false);
    const [progress, setProgress] = useState<DeepForecastProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [unreadableStorage, setUnreadableStorage] = useState<boolean>(false);

    const activeControllerRef = useRef<AbortController | null>(null);
    const launchTokenRef = useRef<number>(0);
    const mutationTokenRef = useRef<number>(0);
    const scopeTokenRef = useRef<number>(0);
    const isApplyingRef = useRef<boolean>(false);
    const unreadableOnDiskRef = useRef<boolean>(false);
    const prevScopeKeyRef = useRef<string>(scopeKey);

    const cleanFxRates = useMemo<Record<string, number>>(() => {
        const out: Record<string, number> = {};
        if (fxRates) {
            for (const [k, v] of Object.entries(fxRates)) {
                if (k !== 'lastFetched' && typeof v === 'number' && Number.isFinite(v)) {
                    out[k] = v;
                }
            }
        }
        return out;
    }, [fxRates]);

    const currentInputsSig = useMemo(
        () =>
            computeDeepForecastInputsSig({
                params,
                transactions: transactions as Transaction[],
                assets: assets as Asset[],
                valoriaRiskProfile,
            }),
        [params, transactions, assets, valoriaRiskProfile],
    );

    const quickPastDiagnostic = useMemo(
        () =>
            analyzeRealPastDossier({
                transactions: transactions as Transaction[],
                assets: assets as Asset[],
                fxRates: cleanFxRates,
                debts: (debts as Debt[] | undefined) ?? params.debts,
                budgetItems: budgetItems as BudgetCategory[],
                realEstateGoals: (realEstateGoals as RealEstateGoal[] | undefined) ?? params.realEstateGoals,
                config: config ?? params.config,
                projection: params.projection,
                retirementGoal: params.retirementGoal,
            }),
        [
            transactions,
            assets,
            cleanFxRates,
            debts,
            budgetItems,
            realEstateGoals,
            config,
            params.debts,
            params.realEstateGoals,
            params.config,
            params.projection,
            params.retirementGoal,
        ],
    );

    const quickPreviewReport = useMemo<DeepForecastReport>(
        () =>
            computeQuickFourScenarios({
                params,
                baseProjection: resolvedBaseProjection,
                pastDiagnostic: quickPastDiagnostic,
                inputsSig: currentInputsSig,
            }),
        [params, resolvedBaseProjection, quickPastDiagnostic, currentInputsSig],
    );

    const refusMessage = useMemo(() => {
        if (!params.entreesRefusees || params.entreesRefusees.length === 0) return null;
        return messageDeRefus(params.entreesRefusees);
    }, [params.entreesRefusees]);

    // Nettoyage garanti au démontage du composant : avorte tout calcul en vol.
    useEffect(() => {
        return () => {
            scopeTokenRef.current += 1;
            launchTokenRef.current += 1;
            if (activeControllerRef.current) {
                activeControllerRef.current.abort();
                activeControllerRef.current = null;
            }
        };
    }, []);

    // Restauration au montage et isolation stricte lors d'un changement de mode test / persona.
    useEffect(() => {
        const scopeChanged = prevScopeKeyRef.current !== scopeKey;
        if (scopeChanged) {
            prevScopeKeyRef.current = scopeKey;
            scopeTokenRef.current += 1;
            launchTokenRef.current += 1;
            mutationTokenRef.current += 1;
            if (activeControllerRef.current) {
                activeControllerRef.current.abort();
                activeControllerRef.current = null;
            }
            isApplyingRef.current = false;
            unreadableOnDiskRef.current = false;
            setPendingReport(null);
            setAppliedReport(null);
            setIsApplying(false);
            setProgress(null);
            setError(null);
            setUnreadableStorage(false);
        }

        let effectCancelled = false;
        const restoreScopeToken = scopeTokenRef.current;
        const restoreMutationToken = mutationTokenRef.current;
        const targetScope = buildScope(isTestMode, scopePersonaId);

        setStatus('restoring');

        void enqueueScopeOp(scopeKey, () =>
            effectCancelled
                ? Promise.resolve({ status: 'empty' } as const)
                : Promise.resolve(loadAppliedDeepForecast(targetScope)).catch(
                      () => ({ status: 'empty' }) as const,
                  ),
        ).then((loaded) => {
            if (effectCancelled) return;
            if (scopeTokenRef.current !== restoreScopeToken) return;
            if (mutationTokenRef.current !== restoreMutationToken) return;

            const live = useFinanceStore.getState();
            const liveScopeKey = resolveScopeKey(live.isTestMode, live.activeTestPersonaId);
            if (liveScopeKey !== scopeKey) return;

            if (loaded.status === 'ok') {
                unreadableOnDiskRef.current = false;
                setAppliedReport(loaded.report);
                setUnreadableStorage(false);
                setError((prev) => (prev === UNREADABLE_ERROR_MESSAGE ? null : prev));
                setStatus((curr) => (curr === 'restoring' ? 'idle' : curr));
            } else if (loaded.status === 'empty') {
                unreadableOnDiskRef.current = false;
                setAppliedReport(null);
                setUnreadableStorage(false);
                setError((prev) => (prev === UNREADABLE_ERROR_MESSAGE ? null : prev));
                setStatus((curr) => (curr === 'restoring' ? 'idle' : curr));
            } else {
                unreadableOnDiskRef.current = true;
                setAppliedReport(null);
                setUnreadableStorage(true);
                setError((prev) => prev ?? UNREADABLE_ERROR_MESSAGE);
                setStatus((curr) => (curr === 'restoring' ? 'error' : curr));
            }
        });

        return () => {
            effectCancelled = true;
        };
    }, [scopeKey, isTestMode, scopePersonaId]);

    const launchDeepForecast = useCallback(async () => {
        if (activeControllerRef.current !== null) {
            return;
        }

        if (refusMessage) {
            setError(refusMessage);
            setStatus('error');
            return;
        }

        const controller = new AbortController();
        activeControllerRef.current = controller;
        const launchToken = ++launchTokenRef.current;
        const launchScopeToken = scopeTokenRef.current;
        const launchScopeKey = scopeKey;
        const apiKey = geminiApiKey.trim() || null;

        setPendingReport(null);
        setError(null);
        setProgress({
            phase: 'past_audit',
            phaseIndex: 1,
            phaseTotal: 4,
            phaseLabel: 'Audit du passé réel',
            percent: 0,
            trajectoriesDone: 0,
            trajectoriesTotal: trajectoriesOverride ?? DEFAULT_TRAJECTORIES_TOTAL,
            etaSeconds: null,
        });
        setStatus('running');

        try {
            const computed = await runDeepForecastAsync(
                {
                    params,
                    baseProjection: resolvedBaseProjection,
                    transactions: transactions as Transaction[],
                    assets: assets as Asset[],
                    fxRates: cleanFxRates,
                    budgetItems: budgetItems as BudgetCategory[],
                    debts: debts as Debt[],
                    realEstateGoals: realEstateGoals as RealEstateGoal[],
                    config,
                    valoriaRiskProfile,
                    apiKey,
                    inputsSig: currentInputsSig,
                },
                {
                    signal: controller.signal,
                    onProgress: (p: DeepForecastProgress) => {
                        if (
                            launchTokenRef.current !== launchToken
                            || scopeTokenRef.current !== launchScopeToken
                            || controller.signal.aborted
                        ) {
                            return;
                        }
                        const live = useFinanceStore.getState();
                        if (resolveScopeKey(live.isTestMode, live.activeTestPersonaId) !== launchScopeKey) {
                            return;
                        }
                        setProgress(p);
                    },
                    ...(trajectoriesOverride !== undefined ? { trajectoriesOverride } : {}),
                    ...(skipNetwork !== undefined ? { skipNetwork } : {}),
                    ...(maxWorkers !== undefined ? { maxWorkers } : {}),
                },
            );

            if (
                launchTokenRef.current !== launchToken
                || scopeTokenRef.current !== launchScopeToken
                || controller.signal.aborted
            ) {
                return;
            }

            const live = useFinanceStore.getState();
            if (resolveScopeKey(live.isTestMode, live.activeTestPersonaId) !== launchScopeKey) {
                return;
            }

            if (activeControllerRef.current === controller) {
                activeControllerRef.current = null;
            }

            // Stockage uniquement en prévisualisation (`staged`) : ne jamais écraser
            // `appliedReport` ni IndexedDB avant le clic explicite sur `applyPendingReport()`.
            setPendingReport(computed);
            setProgress(null);
            setError(null);
            setStatus('staged');
        } catch (err) {
            if (
                launchTokenRef.current !== launchToken
                || scopeTokenRef.current !== launchScopeToken
            ) {
                return;
            }

            const live = useFinanceStore.getState();
            if (resolveScopeKey(live.isTestMode, live.activeTestPersonaId) !== launchScopeKey) {
                return;
            }

            const isCancelled =
                controller.signal.aborted
                || (err instanceof Error && err.message === DEEP_FORECAST_CANCELLED);

            if (isCancelled) {
                if (unreadableOnDiskRef.current) {
                    setUnreadableStorage(true);
                }
                setProgress(null);
                setError(null);
                setStatus('cancelled');
                return;
            }

            const rawMessage =
                err instanceof Error && err.message
                    ? err.message
                    : 'Échec de l’analyse profonde Futur 4.0.';
            logError({
                source: 'projection',
                severity: 'error',
                message: `Erreur Futur 4.0 : ${rawMessage}`,
                error: err instanceof Error ? err : new Error(String(err)),
            });
            if (unreadableOnDiskRef.current) {
                setUnreadableStorage(true);
            }
            setProgress(null);
            setError(rawMessage);
            setStatus('error');
        } finally {
            if (activeControllerRef.current === controller) {
                activeControllerRef.current = null;
            }
        }
    }, [
        assets,
        budgetItems,
        cleanFxRates,
        config,
        currentInputsSig,
        debts,
        geminiApiKey,
        maxWorkers,
        params,
        realEstateGoals,
        refusMessage,
        resolvedBaseProjection,
        scopeKey,
        skipNetwork,
        trajectoriesOverride,
        transactions,
        valoriaRiskProfile,
    ]);

    const cancelDeepForecast = useCallback(() => {
        launchTokenRef.current += 1;
        if (activeControllerRef.current) {
            activeControllerRef.current.abort();
            activeControllerRef.current = null;
        }
        if (unreadableOnDiskRef.current) {
            setUnreadableStorage(true);
        }
        setProgress(null);
        setError(null);
        setStatus('cancelled');
    }, []);

    const applyPendingReport = useCallback(async (): Promise<boolean> => {
        if (!pendingReport || isApplyingRef.current) {
            return false;
        }

        const reportToApply = pendingReport;
        const targetScope = buildScope(isTestMode, scopePersonaId);
        const targetScopeKey = scopeKey;
        const applyScopeToken = scopeTokenRef.current;

        isApplyingRef.current = true;
        mutationTokenRef.current += 1;
        setIsApplying(true);
        setError(null);

        try {
            const savedOk = await enqueueScopeOp(targetScopeKey, () =>
                saveAppliedDeepForecast(reportToApply, targetScope),
            );

            if (scopeTokenRef.current !== applyScopeToken) {
                return false;
            }
            const live = useFinanceStore.getState();
            if (resolveScopeKey(live.isTestMode, live.activeTestPersonaId) !== targetScopeKey) {
                return false;
            }

            if (savedOk) {
                unreadableOnDiskRef.current = false;
                setUnreadableStorage(false);
                setAppliedReport(reportToApply);
                setPendingReport(null);
                setError(null);
                setStatus('idle');
                return true;
            }

            setError(SAVE_FAILED_ERROR_MESSAGE);
            setStatus('error');
            return false;
        } finally {
            if (scopeTokenRef.current === applyScopeToken) {
                isApplyingRef.current = false;
                setIsApplying(false);
            }
        }
    }, [isTestMode, pendingReport, scopeKey, scopePersonaId]);

    const discardPendingReport = useCallback(() => {
        setPendingReport(null);
        setError(null);
        setStatus((curr) => (curr === 'running' || curr === 'restoring' ? curr : 'idle'));
    }, []);

    const clearAppliedReport = useCallback(async () => {
        const targetScope = buildScope(isTestMode, scopePersonaId);
        const targetScopeKey = scopeKey;
        const clearScopeToken = scopeTokenRef.current;

        mutationTokenRef.current += 1;
        setAppliedReport(null);
        unreadableOnDiskRef.current = false;
        setUnreadableStorage(false);
        setError(null);
        setStatus((curr) => (curr === 'running' || curr === 'staged' ? curr : 'idle'));

        await enqueueScopeOp(targetScopeKey, () => clearAppliedDeepForecast(targetScope));
        if (scopeTokenRef.current !== clearScopeToken) {
            return;
        }
    }, [isTestMode, scopeKey, scopePersonaId]);

    const activeReport = useMemo<DeepForecastReport>(
        () => pendingReport ?? appliedReport ?? quickPreviewReport,
        [pendingReport, appliedReport, quickPreviewReport],
    );

    const isMemorized = appliedReport !== null;
    const isOutdated = Boolean(appliedReport && appliedReport.inputsSig !== currentInputsSig);
    const hasPendingToApply = pendingReport !== null;

    return {
        activeReport,
        appliedReport,
        pendingReport,
        quickPreviewReport,
        selectedScenario,
        setSelectedScenario,
        status,
        isApplying,
        progress,
        error,
        unreadableStorage,
        isMemorized,
        isOutdated,
        hasPendingToApply,
        currentInputsSig,
        refusMessage,
        launchDeepForecast,
        cancelDeepForecast,
        applyPendingReport,
        discardPendingReport,
        clearAppliedReport,
    };
}

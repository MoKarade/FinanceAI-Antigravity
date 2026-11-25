import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFinanceStore } from '../store/useFinanceStore';
import type { GrandCalculStatus } from '../store/types';
import {
    GRAND_CALCUL_ITERATIONS_DEFAULT,
    clampGrandCalculIterations,
} from '../services/projection';
import type {
    GrandCalculConfig,
    GrandCalculResult,
    SimulationParams,
} from '../services/projection/types';
import {
    GRAND_CALCUL_CANCELLED,
    computeGrandCalculParamsSig,
    runGrandCalculAsync,
    type GrandCalculProgress,
} from '../services/projection/runAsync';
import {
    clearGrandCalculResult,
    loadGrandCalculResult,
    saveGrandCalculResult,
} from '../services/grandCalculStore';
import { messageDeRefus } from '../services/projection/verifierEntreesMoteur';
import { logError } from '../services/errorLogger';

const UNREADABLE_ERROR_MESSAGE =
    'Donnée illisible — la sauvegarde locale du Grand Calcul est corrompue ou inaccessible. Relancez un calcul.';

// Contrôleur actif et dernier contexte de configuration au niveau module pour survivre
// à la navigation entre onglets/tiroirs.
let _activeController: AbortController | null = null;
let _activeLaunchToken = 0;
let _activeLaunchConfig: GrandCalculConfig | null = null;
let _lastKnownConfig: GrandCalculConfig | null = null;

// Suivi de la persistance IDB en vol (chiffrement AES-GCM + commit) :
// empêche la réactivation de « Relancer » / « Effacer » avant le commit effectif en IDB.
const REAL_OWNER_KEY = 'real';
const _savingCounts = new Map<string, number>();
const _savingListeners = new Set<() => void>();

function isOwnerSaving(): boolean {
    return (_savingCounts.get(REAL_OWNER_KEY) ?? 0) > 0;
}

function notifySavingListeners(): void {
    for (const listener of _savingListeners) {
        listener();
    }
}

function beginOwnerSave(key: string): void {
    _savingCounts.set(key, (_savingCounts.get(key) ?? 0) + 1);
    notifySavingListeners();
}

function endOwnerSave(key: string): void {
    const next = (_savingCounts.get(key) ?? 1) - 1;
    if (next <= 0) {
        _savingCounts.delete(key);
    } else {
        _savingCounts.set(key, next);
    }
    notifySavingListeners();
}

// File d'attente FIFO côté hook pour sérialiser toutes les opérations (écriture, effacement ET lecture)
// sur le slot `'test'` et sur le slot `'current'`, y compris lorsque `loadGrandCalculResult` contourne `_writeChain`.
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

const enqueueRealSlotOp = createSlotSerializer();

function configFromResult(result: GrandCalculResult): GrandCalculConfig {
    return {
        iterations: clampGrandCalculIterations(result.iterationsRun),
        enableMacroRegimes: result.regimesEnabled,
        includeHistoricalCrises: result.historicalCrisesEnabled,
    };
}

function sameConfig(a: GrandCalculConfig, b: GrandCalculConfig): boolean {
    return (
        a.iterations === b.iterations &&
        a.enableMacroRegimes === b.enableMacroRegimes &&
        a.includeHistoricalCrises === b.includeHistoricalCrises &&
        a.seed === b.seed
    );
}

function defaultGrandCalculConfig(): GrandCalculConfig {
    return {
        iterations: GRAND_CALCUL_ITERATIONS_DEFAULT,
        enableMacroRegimes: true,
        includeHistoricalCrises: true,
    };
}

export interface UseGrandCalculReturn {
    result: GrandCalculResult | null;
    status: GrandCalculStatus;
    progress: GrandCalculProgress | null;
    error: string | null;
    unreadableStorage: boolean;
    config: GrandCalculConfig;
    updateConfig: (patch: Partial<GrandCalculConfig>) => void;
    currentParamsSig: string;
    isStale: boolean;
    launch: (overrideConfig?: Partial<GrandCalculConfig>) => Promise<void>;
    cancel: () => void;
    clear: () => Promise<void>;
    isRunning: boolean;
    isRestoring: boolean;
    isSaving: boolean;
    refusMessage: string | null;
}

export function useGrandCalcul(params: SimulationParams): UseGrandCalculReturn {
    const grandCalculResult = useFinanceStore((s) => s.grandCalculResult);
    const grandCalculStatus = useFinanceStore((s) => s.grandCalculStatus);
    const grandCalculProgress = useFinanceStore((s) => s.grandCalculProgress);
    const grandCalculError = useFinanceStore((s) => s.grandCalculError);

    const setGrandCalculResult = useFinanceStore((s) => s.setGrandCalculResult);
    const setGrandCalculStatus = useFinanceStore((s) => s.setGrandCalculStatus);
    const setGrandCalculProgress = useFinanceStore((s) => s.setGrandCalculProgress);
    const setGrandCalculError = useFinanceStore((s) => s.setGrandCalculError);
    const resetGrandCalcul = useFinanceStore((s) => s.resetGrandCalcul);

    const [config, setConfig] = useState<GrandCalculConfig>(() => {
        const snap = useFinanceStore.getState();
        if (_activeController !== null && _activeLaunchConfig !== null) {
            return { ..._activeLaunchConfig };
        }
        if (_lastKnownConfig !== null) {
            return { ..._lastKnownConfig };
        }
        if (snap.grandCalculResult !== null) {
            return configFromResult(snap.grandCalculResult);
        }
        return defaultGrandCalculConfig();
    });
    const [unreadableStorage, setUnreadableStorage] = useState<boolean>(false);
    const [savingVersion, setSavingVersion] = useState(0);

    useEffect(() => {
        const onSaveChange = () => setSavingVersion((v) => v + 1);
        _savingListeners.add(onSaveChange);
        return () => {
            _savingListeners.delete(onSaveChange);
        };
    }, []);

    const isSaving = useMemo(() => {
        void savingVersion;
        return isOwnerSaving();
    }, [savingVersion]);

    const userEditedConfigRef = useRef<boolean>(false);
    const unreadableOnDiskRef = useRef<boolean>(false);

    const updateConfig = useCallback((patch: Partial<GrandCalculConfig>) => {
        userEditedConfigRef.current = true;
        setConfig((prev) => {
            const next: GrandCalculConfig = {
                ...prev,
                ...patch,
                iterations:
                    patch.iterations !== undefined
                        ? clampGrandCalculIterations(patch.iterations)
                        : prev.iterations,
            };
            _lastKnownConfig = next;
            return next;
        });
    }, []);

    const currentParamsSig = useMemo(
        () => computeGrandCalculParamsSig(params, config),
        [params, config],
    );

    const isStale = grandCalculResult !== null && grandCalculResult.paramsSig !== currentParamsSig;

    const refusMessage = useMemo(() => {
        if (!params.entreesRefusees || params.entreesRefusees.length === 0) return null;
        return messageDeRefus(params.entreesRefusees);
    }, [params.entreesRefusees]);

    useEffect(() => {
        // Ne jamais écraser un calcul actif lors d'un retour sur Futur,
        // mais avorter immédiatement un worker orphelin s'il n'est plus en cours.
        if (_activeController !== null) {
            if (useFinanceStore.getState().grandCalculStatus === 'running') {
                if (!userEditedConfigRef.current && _activeLaunchConfig) {
                    const activeCfg = _activeLaunchConfig;
                    setConfig((prevCfg) => (sameConfig(prevCfg, activeCfg) ? prevCfg : { ...activeCfg }));
                }
                return;
            }
            _activeLaunchToken += 1;
            _activeController.abort();
            _activeController = null;
            _activeLaunchConfig = null;
            _lastKnownConfig = null;
            userEditedConfigRef.current = false;
            resetGrandCalcul();
            setConfig(defaultGrandCalculConfig());
        }

        const stateSnapshot = useFinanceStore.getState();
        if (stateSnapshot.grandCalculResult !== null) {
            if (!userEditedConfigRef.current) {
                const synced = _lastKnownConfig ?? configFromResult(stateSnapshot.grandCalculResult);
                setConfig((prevCfg) => (sameConfig(prevCfg, synced) ? prevCfg : { ...synced }));
            }
            return;
        }

        let effectCancelled = false;
        const restoreToken = _activeLaunchToken;
        setGrandCalculStatus('restoring');

        void enqueueRealSlotOp(() =>
            effectCancelled
                ? Promise.resolve({ status: 'empty' } as const)
                : Promise.resolve(loadGrandCalculResult({ isTestMode: false })).catch(
                      () => ({ status: 'empty' }) as const,
                  ),
        ).then((loaded) => {
            if (effectCancelled) return;
            if (restoreToken !== _activeLaunchToken) return;
            const live = useFinanceStore.getState();
            if (
                _activeController !== null ||
                live.grandCalculStatus === 'running' ||
                live.grandCalculResult !== null
            ) {
                return;
            }

            if (loaded.status === 'ok') {
                unreadableOnDiskRef.current = false;
                setGrandCalculResult(loaded.result);
                setGrandCalculError(null);
                setUnreadableStorage(false);
                setGrandCalculStatus('ready');
                if (!userEditedConfigRef.current) {
                    setConfig(configFromResult(loaded.result));
                }
            } else if (loaded.status === 'empty') {
                unreadableOnDiskRef.current = false;
                setGrandCalculError(null);
                setUnreadableStorage(false);
                setGrandCalculStatus('idle');
            } else {
                _lastKnownConfig = null;
                unreadableOnDiskRef.current = true;
                setGrandCalculResult(null);
                setUnreadableStorage(true);
                setGrandCalculError(UNREADABLE_ERROR_MESSAGE);
                setGrandCalculStatus('error');
            }
        });

        return () => {
            effectCancelled = true;
        };
    }, [
        resetGrandCalcul,
        setGrandCalculError,
        setGrandCalculResult,
        setGrandCalculStatus,
    ]);

    const launch = useCallback(
        async (overrideConfig?: Partial<GrandCalculConfig>) => {
            const liveState = useFinanceStore.getState();
            if (_activeController !== null || liveState.grandCalculStatus === 'running') {
                return;
            }

            if (refusMessage) {
                setGrandCalculError(refusMessage);
                setGrandCalculStatus('error');
                return;
            }

            const merged: GrandCalculConfig = {
                iterations: clampGrandCalculIterations(
                    overrideConfig?.iterations ?? config.iterations,
                ),
                enableMacroRegimes: Boolean(
                    overrideConfig?.enableMacroRegimes ?? config.enableMacroRegimes,
                ),
                includeHistoricalCrises: Boolean(
                    overrideConfig?.includeHistoricalCrises ?? config.includeHistoricalCrises,
                ),
                ...(config.seed !== undefined ? { seed: config.seed } : {}),
                ...(overrideConfig?.seed !== undefined ? { seed: overrideConfig.seed } : {}),
            };

            const sig = computeGrandCalculParamsSig(params, merged);
            const controller = new AbortController();
            _activeController = controller;
            const token = ++_activeLaunchToken;

            _activeLaunchConfig = merged;
            _lastKnownConfig = merged;
            setConfig((prevCfg) => (sameConfig(prevCfg, merged) ? prevCfg : merged));

            setUnreadableStorage(false);
            setGrandCalculError(null);
            setGrandCalculProgress({
                done: 0,
                total: merged.iterations,
                pct: 0,
                simPerSec: null,
                etaMs: null,
            });
            setGrandCalculStatus('running');

            try {
                const computed = await runGrandCalculAsync(params, merged, {
                    paramsSig: sig,
                    signal: controller.signal,
                    onProgress: (p) => {
                        if (token !== _activeLaunchToken || controller.signal.aborted) {
                            return;
                        }
                        useFinanceStore.getState().setGrandCalculProgress(p);
                    },
                });

                if (token !== _activeLaunchToken || controller.signal.aborted) {
                    return;
                }

                const current = useFinanceStore.getState();
                current.setGrandCalculResult(computed);
                current.setGrandCalculProgress(null);
                current.setGrandCalculError(null);
                current.setGrandCalculStatus('ready');

                if (_activeController === controller) {
                    _activeController = null;
                    _activeLaunchConfig = null;
                }

                beginOwnerSave(REAL_OWNER_KEY);
                try {
                    const savedOk = await enqueueRealSlotOp(() =>
                        saveGrandCalculResult(computed, { isTestMode: false }),
                    );
                    if (savedOk) {
                        unreadableOnDiskRef.current = false;
                    } else {
                        logError({
                            source: 'storage',
                            severity: 'warning',
                            message: 'Échec de sauvegarde locale du Grand Calcul (IndexedDB).',
                        });
                        if (token === _activeLaunchToken) {
                            if (unreadableOnDiskRef.current) {
                                setUnreadableStorage(true);
                            }
                            current.setGrandCalculError(
                                'Sauvegarde locale impossible (espace ou stockage restreint) — le résultat reste affiché pour cette session.',
                            );
                            current.setGrandCalculStatus('error');
                        }
                    }
                } finally {
                    endOwnerSave(REAL_OWNER_KEY);
                }
            } catch (err) {
                if (token !== _activeLaunchToken) {
                    return;
                }
                const current = useFinanceStore.getState();
                const isCancelled =
                    controller.signal.aborted ||
                    (err instanceof Error && err.message === GRAND_CALCUL_CANCELLED);

                if (isCancelled) {
                    if (unreadableOnDiskRef.current) {
                        setUnreadableStorage(true);
                    }
                    current.setGrandCalculProgress(null);
                    current.setGrandCalculError(null);
                    current.setGrandCalculStatus('cancelled');
                    return;
                }

                const rawMessage =
                    err instanceof Error && err.message
                        ? err.message
                        : 'Échec du Grand Calcul.';
                const message = /erreur|impossible|échec|interrompu/i.test(rawMessage)
                    ? rawMessage
                    : `Erreur lors du Grand Calcul : ${rawMessage}`;
                logError({
                    source: 'projection',
                    severity: 'error',
                    message: `Erreur Grand Calcul : ${message}`,
                    error: err instanceof Error ? err : new Error(String(err)),
                });
                if (unreadableOnDiskRef.current) {
                    setUnreadableStorage(true);
                }
                current.setGrandCalculProgress(null);
                current.setGrandCalculError(message);
                current.setGrandCalculStatus('error');
            } finally {
                if (_activeController === controller) {
                    _activeController = null;
                    _activeLaunchConfig = null;
                }
            }
        },
        [
            config,
            params,
            refusMessage,
            setGrandCalculError,
            setGrandCalculProgress,
            setGrandCalculStatus,
        ],
    );

    const cancel = useCallback(() => {
        _activeLaunchToken += 1;
        if (_activeController) {
            _activeController.abort();
            _activeController = null;
        }
        _activeLaunchConfig = null;
        if (unreadableOnDiskRef.current) {
            setUnreadableStorage(true);
        }
        setGrandCalculProgress(null);
        setGrandCalculError(null);
        setGrandCalculStatus('cancelled');
    }, [setGrandCalculError, setGrandCalculProgress, setGrandCalculStatus]);

    const clear = useCallback(async () => {
        _activeLaunchToken += 1;
        if (_activeController) {
            _activeController.abort();
            _activeController = null;
        }
        _activeLaunchConfig = null;
        _lastKnownConfig = null;
        userEditedConfigRef.current = false;
        unreadableOnDiskRef.current = false;
        resetGrandCalcul();
        setUnreadableStorage(false);
        await enqueueRealSlotOp(() =>
            Promise.resolve(clearGrandCalculResult({ isTestMode: false })).catch(() => undefined),
        );
    }, [resetGrandCalcul]);

    return {
        result: grandCalculResult,
        status: grandCalculStatus,
        progress: grandCalculProgress,
        error: grandCalculError,
        unreadableStorage,
        config,
        updateConfig,
        currentParamsSig,
        isStale,
        launch,
        cancel,
        clear,
        isRunning: grandCalculStatus === 'running',
        isRestoring: grandCalculStatus === 'restoring',
        isSaving,
        refusMessage,
    };
}

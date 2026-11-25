/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFinanceStore } from '../../../store/useFinanceStore';
import { useGrandCalcul } from '../../../hooks/useGrandCalcul';
import { computeGrandCalculParamsSig, GRAND_CALCUL_CANCELLED } from '../../../services/projection/runAsync';
import * as runAsyncMod from '../../../services/projection/runAsync';
import * as grandCalculStoreMod from '../../../services/grandCalculStore';
import type { GrandCalculConfig, GrandCalculResult, SimulationParams } from '../../../services/projection/types';

function makeParams(targetAge = 65): SimulationParams {
    return {
        projection: {
            years: 30,
            returnRate: 6,
            inflationRate: 2,
            savingsMode: 'manual',
            manualContribution: 1000,
            usePortfolioRate: false,
        },
        calculatedStartingCash: 25_000,
        liveCSVBalances: {
            CELI: 50_000,
            CELIAPP: 0,
            REER: 100_000,
            NON_ENREG: 10_000,
            CRYPTO: 0,
            REEE: 0,
        },
        realEstateGoals: [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal: {
            targetAge,
            targetMonthlyIncome: 4_000,
            governmentPension: 1_200,
        },
        config: {
            users: [
                { name: 'Alex', age: 35, grossSalary: 7_000, netSalary: 5_000, color: '#10b981' },
                { name: '', age: 35, grossSalary: 0, netSalary: 0, color: '#3b82f6' },
            ],
            splitMode: '50/50',
        },
        baseGrossAnnual: 84_000,
        baseNetAnnual: 60_000,
        currentRentExpense: 1_500,
        baseMonthlyExpenses: 3_000,
        startYear: 2026,
        startMonth: 0,
    };
}

function makeResult(params: SimulationParams, config: GrandCalculConfig): GrandCalculResult {
    return {
        version: 1,
        paramsSig: computeGrandCalculParamsSig(params, config),
        createdAt: '2026-11-17T00:00:00Z',
        durationMs: 1200,
        iterationsRun: config.iterations,
        regimesEnabled: config.enableMacroRegimes,
        historicalCrisesEnabled: config.includeHistoricalCrises,
        survivalRatePct: 92.4,
        cvar95: 185_000,
        monthlyBands: [
            { monthIndex: 0, year: 2026, age: 35, p5: 150_000, p10: 160_000, p25: 175_000, p50: 185_000, p75: 195_000, p90: 210_000, p95: 220_000 },
        ],
        fiAge: { reachedPct: 88, p5Age: 52, p50Age: 58, p95Age: 66, horizonAge: 90 },
        goalProbabilities: [],
        guaranteedPurchasingPower: {
            p95SecurityMonthlyNetReal: 3_200,
            p90SecurityMonthlyNetReal: 3_500,
            p50SecurityMonthlyNetReal: 4_400,
            retirementMonthsEvaluated: 300,
        },
        estateTax: {
            deterministicTotal: 80_000,
            deterministicFed: 35_000,
            deterministicQc: 45_000,
            mcTotalP5: 40_000,
            mcTotalP50: 82_000,
            mcTotalP95: 150_000,
            mcFedP50: 36_000,
            mcQcP50: 46_000,
            mcRealTotalP50: 55_000,
            taxableBreakdown: { rrspRrif: 200_000, capitalGainsTaxable: 30_000, rentalRecapture: 0 },
            projectedDeathAge: 90,
        },
    };
}

const initialStore = useFinanceStore.getState();

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

function installSerializedIdbMock() {
    const idbSlots = new Map<'current' | 'test', GrandCalculResult>();
    let writeChain: Promise<void> = Promise.resolve();
    const saveBarriers: Array<() => Promise<boolean>> = [];
    const clearBarriers: Array<() => Promise<void>> = [];
    const pendingCleanupResolvers: Array<() => void> = [];

    const enqueueWrite = <T,>(op: () => Promise<T>): Promise<T> => {
        const run = writeChain.then(op, op);
        writeChain = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    };

    const loadSpy = vi
        .spyOn(grandCalculStoreMod, 'loadGrandCalculResult')
        .mockImplementation(async (opts) => {
            // Fidèle à services/grandCalculStore.ts : la lecture ne passe pas par _writeChain
            await Promise.resolve();
            const slot = opts?.isTestMode ? 'test' : 'current';
            const found = idbSlots.get(slot);
            return found ? { status: 'ok', result: found } : { status: 'empty' };
        });

    const saveSpy = vi
        .spyOn(grandCalculStoreMod, 'saveGrandCalculResult')
        .mockImplementation((res, opts) => {
            const slot = opts?.isTestMode ? 'test' : 'current';
            const barrier = saveBarriers.shift();
            return enqueueWrite(async () => {
                const ok = barrier ? await barrier() : true;
                if (ok) {
                    idbSlots.set(slot, res);
                }
                return ok;
            });
        });

    const clearSpy = vi
        .spyOn(grandCalculStoreMod, 'clearGrandCalculResult')
        .mockImplementation((opts) => {
            const slot = opts?.isTestMode ? 'test' : 'current';
            const barrier = clearBarriers.shift();
            return enqueueWrite(async () => {
                if (barrier) {
                    await barrier();
                }
                idbSlots.delete(slot);
            });
        });

    return {
        idbSlots,
        loadSpy,
        saveSpy,
        clearSpy,
        deferNextSave(): (ok: boolean) => void {
            const d = createDeferred<boolean>();
            pendingCleanupResolvers.push(() => d.resolve(false));
            saveBarriers.push(() => d.promise);
            return d.resolve;
        },
        deferNextClear(): () => void {
            const d = createDeferred<void>();
            pendingCleanupResolvers.push(() => d.resolve(undefined));
            clearBarriers.push(() => d.promise);
            return () => d.resolve(undefined);
        },
        async drainWrites(): Promise<void> {
            await writeChain;
        },
        async cleanup(): Promise<void> {
            while (pendingCleanupResolvers.length > 0) {
                pendingCleanupResolvers.pop()?.();
            }
            await writeChain;
        },
    };
}

describe('useGrandCalcul', () => {
    beforeEach(() => {
        localStorage.clear();
        useFinanceStore.setState(initialStore, true);
        vi.spyOn(grandCalculStoreMod, 'loadGrandCalculResult').mockResolvedValue({ status: 'empty' });
        vi.spyOn(grandCalculStoreMod, 'saveGrandCalculResult').mockResolvedValue(true);
        vi.spyOn(grandCalculStoreMod, 'clearGrandCalculResult').mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('ne lance jamais le Grand Calcul automatiquement au montage ni lors de changements de paramètres', async () => {
        const runSpy = vi.spyOn(runAsyncMod, 'runGrandCalculAsync');
        const params = makeParams(65);

        const { result, rerender } = renderHook(({ p }) => useGrandCalcul(p), {
            initialProps: { p: params },
        });

        await waitFor(() => expect(result.current.isRestoring).toBe(false));
        rerender({ p: makeParams(67) });

        expect(runSpy).not.toHaveBeenCalled();
        expect(result.current.status).toBe('idle');
    });

    it('restaure un résultat valide depuis IndexedDB et synchronise la configuration sans faux isStale', async () => {
        const params = makeParams(65);
        const savedConfig: GrandCalculConfig = {
            iterations: 100_000,
            enableMacroRegimes: false,
            includeHistoricalCrises: true,
        };
        const saved = makeResult(params, savedConfig);
        const loadSpy = vi.spyOn(grandCalculStoreMod, 'loadGrandCalculResult').mockResolvedValue({
            status: 'ok',
            result: saved,
        });

        const { result } = renderHook(() => useGrandCalcul(params));

        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(loadSpy).toHaveBeenCalledWith({ isTestMode: false });
        expect(result.current.result).toEqual(saved);
        expect(result.current.config.iterations).toBe(100_000);
        expect(result.current.config.enableMacroRegimes).toBe(false);
        expect(result.current.isStale).toBe(false);
        expect(result.current.unreadableStorage).toBe(false);
    });

    it('signale unreadableStorage et une erreur claire si la sauvegarde IDB est illisible', async () => {
        vi.spyOn(grandCalculStoreMod, 'loadGrandCalculResult').mockResolvedValue({ status: 'unreadable' });

        const { result } = renderHook(() => useGrandCalcul(makeParams()));

        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.unreadableStorage).toBe(true);
        expect(result.current.result).toBeNull();
        expect(result.current.error).toMatch(/Donnée illisible/i);
    });

    it('exécute launch() manuellement, diffuse la progression, persiste en IDB et détecte isStale sur modification', async () => {
        const params = makeParams(65);
        const computed = makeResult(params, {
            iterations: 50_000,
            enableMacroRegimes: true,
            includeHistoricalCrises: true,
        });
        const saveSpy = vi.spyOn(grandCalculStoreMod, 'saveGrandCalculResult').mockResolvedValue(true);
        vi.spyOn(runAsyncMod, 'runGrandCalculAsync').mockImplementation(async (_p, _c, opts) => {
            opts.onProgress?.({ done: 25_000, total: 50_000, pct: 50, simPerSec: 12_500, etaMs: 2_000 });
            return computed;
        });

        const { result, rerender } = renderHook(({ p }) => useGrandCalcul(p), {
            initialProps: { p: params },
        });
        await waitFor(() => expect(result.current.isRestoring).toBe(false));

        await act(async () => {
            await result.current.launch();
        });

        expect(result.current.status).toBe('ready');
        expect(result.current.result).toEqual(computed);
        expect(result.current.isStale).toBe(false);
        expect(saveSpy).toHaveBeenCalledWith(computed, { isTestMode: false });

        rerender({ p: makeParams(62) });
        expect(result.current.isStale).toBe(true);
    });

    it('annule proprement via AbortSignal en conservant le résultat précédent', async () => {
        const params = makeParams(65);
        const prior = makeResult(params, {
            iterations: 50_000,
            enableMacroRegimes: true,
            includeHistoricalCrises: true,
        });
        useFinanceStore.setState({ grandCalculResult: prior, grandCalculStatus: 'ready' });

        vi.spyOn(runAsyncMod, 'runGrandCalculAsync').mockImplementation(
            (_p, _c, opts) =>
                new Promise((_, reject) => {
                    opts.signal?.addEventListener('abort', () => {
                        reject(new Error(GRAND_CALCUL_CANCELLED));
                    });
                }),
        );

        const { result } = renderHook(() => useGrandCalcul(params));

        act(() => {
            void result.current.launch();
        });
        expect(result.current.isRunning).toBe(true);

        act(() => {
            result.current.cancel();
        });

        await waitFor(() => expect(result.current.status).toBe('cancelled'));
        expect(result.current.isRunning).toBe(false);
        expect(result.current.result).toEqual(prior);
    });

    it('efface les résultats via clear() et nettoie IDB + store', async () => {
        const params = makeParams(65);
        const prior = makeResult(params, {
            iterations: 50_000,
            enableMacroRegimes: true,
            includeHistoricalCrises: true,
        });
        const clearSpy = vi.spyOn(grandCalculStoreMod, 'clearGrandCalculResult').mockResolvedValue(undefined);
        useFinanceStore.setState({
            grandCalculResult: prior,
            grandCalculStatus: 'ready',
        });

        const { result } = renderHook(() => useGrandCalcul(params));

        await act(async () => {
            await result.current.clear();
        });

        expect(result.current.result).toBeNull();
        expect(result.current.status).toBe('idle');
        expect(clearSpy).toHaveBeenCalledWith({ isTestMode: false });
    });

    it('préserve la configuration non par défaut après démontage/remontage (calcul terminé ou en cours) sans faux isStale', async () => {
        const params = makeParams(65);
        const nonDefault: GrandCalculConfig = {
            iterations: 100_000,
            enableMacroRegimes: false,
            includeHistoricalCrises: false,
        };
        const computed = makeResult(params, nonDefault);

        // Partie 1 : calcul terminé puis démontage/remontage
        vi.spyOn(runAsyncMod, 'runGrandCalculAsync').mockResolvedValueOnce(computed);
        const h1 = renderHook(() => useGrandCalcul(params));
        await waitFor(() => expect(h1.result.current.isRestoring).toBe(false));

        act(() => {
            h1.result.current.updateConfig(nonDefault);
        });
        await act(async () => {
            await h1.result.current.launch();
        });
        expect(h1.result.current.isStale).toBe(false);
        h1.unmount();

        const h2 = renderHook(() => useGrandCalcul(params));
        expect(h2.result.current.config).toEqual(nonDefault);
        expect(h2.result.current.isStale).toBe(false);
        await act(async () => {
            await h2.result.current.clear();
        });
        h2.unmount();

        // Partie 2 : démontage/remontage en cours d'exécution
        let resolveWorker!: (r: GrandCalculResult) => void;
        vi.spyOn(runAsyncMod, 'runGrandCalculAsync').mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveWorker = resolve;
                }),
        );

        const h3 = renderHook(() => useGrandCalcul(params));
        await waitFor(() => expect(h3.result.current.isRestoring).toBe(false));
        act(() => {
            h3.result.current.updateConfig(nonDefault);
        });
        act(() => {
            void h3.result.current.launch();
        });
        expect(h3.result.current.isRunning).toBe(true);
        h3.unmount();

        const h4 = renderHook(() => useGrandCalcul(params));
        expect(h4.result.current.config).toEqual(nonDefault);
        expect(h4.result.current.isRunning).toBe(true);

        await act(async () => {
            resolveWorker(computed);
        });
        await waitFor(() => expect(h4.result.current.status).toBe('ready'));
        expect(h4.result.current.config).toEqual(nonDefault);
        expect(h4.result.current.isStale).toBe(false);

        await act(async () => {
            await h4.result.current.clear();
        });
    });

    it('clearGrandCalculResult différé + remontage immédiat : loadGrandCalculResult attend la fin du clear', async () => {
        const idb = installSerializedIdbMock();
        try {
            const params = makeParams(65);
            const cfg: GrandCalculConfig = {
                iterations: 50_000,
                enableMacroRegimes: true,
                includeHistoricalCrises: true,
            };
            const realResult: GrandCalculResult = { ...makeResult(params, cfg), survivalRatePct: 91.5 };

            vi.spyOn(runAsyncMod, 'runGrandCalculAsync').mockResolvedValueOnce(realResult);

            const hReal1 = renderHook(() => useGrandCalcul(params));
            await waitFor(() => expect(hReal1.result.current.isRestoring).toBe(false));
            await act(async () => {
                await hReal1.result.current.launch();
                await idb.drainWrites();
            });
            expect(idb.idbSlots.get('current')).toEqual(realResult);

            const resolveRealClear = idb.deferNextClear();
            let clearPromise!: Promise<void>;
            act(() => {
                clearPromise = hReal1.result.current.clear();
            });
            hReal1.unmount();

            const loadCallsBefore = idb.loadSpy.mock.calls.length;
            const hReal2 = renderHook(() => useGrandCalcul(params));
            expect(hReal2.result.current.isRestoring).toBe(true);
            // La lecture réelle ne doit pas être exécutée tant que le clear précédent est en cours
            expect(idb.loadSpy.mock.calls.length).toBe(loadCallsBefore);

            await act(async () => {
                resolveRealClear();
                await clearPromise;
                await idb.drainWrites();
            });
            await waitFor(() => expect(hReal2.result.current.status).toBe('idle'));
            expect(hReal2.result.current.result).toBeNull();
            expect(idb.idbSlots.get('current')).toBeUndefined();
            hReal2.unmount();
        } finally {
            await idb.cleanup();
        }
    });

    it('Course restauration vs launch() rapide : un loadGrandCalculResult tardif n’écrase pas le résultat plus récent', async () => {
        const params = makeParams(65);
        const cfg: GrandCalculConfig = {
            iterations: 50_000,
            enableMacroRegimes: true,
            includeHistoricalCrises: true,
        };
        const staleLoaded: GrandCalculResult = { ...makeResult(params, cfg), survivalRatePct: 55.0 };
        const freshComputed: GrandCalculResult = { ...makeResult(params, cfg), survivalRatePct: 96.8 };

        const deferredLoad = createDeferred<grandCalculStoreMod.LoadGrandCalculResult>();
        try {
            vi.spyOn(grandCalculStoreMod, 'loadGrandCalculResult').mockImplementationOnce(
                () => deferredLoad.promise,
            );
            vi.spyOn(runAsyncMod, 'runGrandCalculAsync').mockResolvedValueOnce(freshComputed);

            const { result } = renderHook(() => useGrandCalcul(params));
            expect(result.current.isRestoring).toBe(true);

            // Lancement rapide dont le worker termine avant que loadGrandCalculResult ne résolve
            let launchPromise!: Promise<void>;
            act(() => {
                launchPromise = result.current.launch();
            });
            await waitFor(() => expect(result.current.status).toBe('ready'));
            expect(result.current.result).toEqual(freshComputed);

            // La restauration initiale résout tardivement avec l'ancien résultat
            await act(async () => {
                deferredLoad.resolve({ status: 'ok', result: staleLoaded });
                await launchPromise;
            });

            expect(result.current.status).toBe('ready');
            expect(result.current.result).toEqual(freshComputed);
        } finally {
            deferredLoad.resolve({ status: 'empty' });
        }
    });

    it('isSaving par slot propriétaire : vrai pendant saveGrandCalculResult, faux après commit', async () => {
        const idb = installSerializedIdbMock();
        try {
            const params = makeParams(65);
            const cfg: GrandCalculConfig = {
                iterations: 50_000,
                enableMacroRegimes: true,
                includeHistoricalCrises: true,
            };
            const computedA = makeResult(params, cfg);

            const resolveSaveA = idb.deferNextSave();
            vi.spyOn(runAsyncMod, 'runGrandCalculAsync').mockResolvedValueOnce(computedA);

            const hA = renderHook(() => useGrandCalcul(params));
            await waitFor(() => expect(hA.result.current.isRestoring).toBe(false));
            expect(hA.result.current.isSaving).toBe(false);

            let launchA!: Promise<void>;
            act(() => {
                launchA = hA.result.current.launch();
            });
            await waitFor(() => expect(hA.result.current.status).toBe('ready'));
            expect(hA.result.current.isSaving).toBe(true);

            await act(async () => {
                resolveSaveA(true);
                await launchA;
                await idb.drainWrites();
            });
            expect(hA.result.current.isSaving).toBe(false);
            hA.unmount();

            const hA2 = renderHook(() => useGrandCalcul(params));
            await waitFor(() => expect(hA2.result.current.isRestoring).toBe(false));
            expect(hA2.result.current.isSaving).toBe(false);
        } finally {
            await idb.cleanup();
        }
    });

    it('bloque launch() si refusMessage est défini, gère l’échec Worker en préservant le résultat antérieur et journalise', async () => {
        const params = makeParams(65);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: true };
        const prior = makeResult(params, cfg);

        // 1) refusMessage bloque launch() sans invoquer le worker
        const badParams: SimulationParams = {
            ...params,
            entreesRefusees: [{ role: 'cause', chemin: 'config.users[0].netSalary', libelle: 'le salaire net', valeur: Number.NaN }],
        };
        const runSpy = vi.spyOn(runAsyncMod, 'runGrandCalculAsync');
        const hRefus = renderHook(() => useGrandCalcul(badParams));
        await waitFor(() => expect(hRefus.result.current.isRestoring).toBe(false));
        expect(hRefus.result.current.refusMessage).toBeTruthy();

        await act(async () => {
            await hRefus.result.current.launch();
        });
        expect(runSpy).not.toHaveBeenCalled();
        expect(hRefus.result.current.status).toBe('error');
        expect(hRefus.result.current.error).toBe(hRefus.result.current.refusMessage);
        hRefus.unmount();

        // 2) Échec worker (status: 'error', résultat antérieur préservé)
        useFinanceStore.setState({ grandCalculResult: prior, grandCalculStatus: 'ready' });
        runSpy.mockRejectedValueOnce(new Error('Worker crash test'));
        const hErr = renderHook(() => useGrandCalcul(params));
        await act(async () => {
            await hErr.result.current.launch();
        });
        expect(hErr.result.current.status).toBe('error');
        expect(hErr.result.current.error).toContain('Worker crash test');
        expect(hErr.result.current.result).toEqual(prior);
    });

    it('gère l’échec saveGrandCalculResult en mode réel, préserve unreadableStorage après cancel() et passe isStale si params changent en vol', async () => {
        const params = makeParams(65);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: true };
        const computed = makeResult(params, cfg);

        // 1) Sauvegarde IDB illisible -> launch() puis cancel() -> unreadableStorage reste true -> relance complète le nettoie
        vi.spyOn(grandCalculStoreMod, 'loadGrandCalculResult').mockResolvedValueOnce({ status: 'unreadable' });
        vi.spyOn(runAsyncMod, 'runGrandCalculAsync')
            .mockImplementationOnce(
                (_p, _c, opts) =>
                    new Promise((_, reject) => {
                        opts.signal?.addEventListener('abort', () => reject(new Error(GRAND_CALCUL_CANCELLED)));
                    }),
            )
            .mockResolvedValueOnce(computed);

        const hUnreadable = renderHook(({ p }) => useGrandCalcul(p), { initialProps: { p: params } });
        await waitFor(() => expect(hUnreadable.result.current.unreadableStorage).toBe(true));

        let pCancelled!: Promise<void>;
        act(() => {
            pCancelled = hUnreadable.result.current.launch();
        });
        act(() => {
            hUnreadable.result.current.cancel();
        });
        await act(async () => {
            await pCancelled;
        });
        expect(hUnreadable.result.current.status).toBe('cancelled');
        expect(hUnreadable.result.current.unreadableStorage).toBe(true);

        // Relance complète qui réussit et persiste -> unreadableStorage devient false
        vi.spyOn(grandCalculStoreMod, 'saveGrandCalculResult').mockResolvedValueOnce(true);
        await act(async () => {
            await hUnreadable.result.current.launch();
        });
        expect(hUnreadable.result.current.status).toBe('ready');
        expect(hUnreadable.result.current.unreadableStorage).toBe(false);

        // 2) Échec saveGrandCalculResult (false) en mode réel -> alerte honnête sans perdre le résultat en mémoire
        vi.spyOn(runAsyncMod, 'runGrandCalculAsync').mockResolvedValueOnce(computed);
        vi.spyOn(grandCalculStoreMod, 'saveGrandCalculResult').mockResolvedValueOnce(false);
        await act(async () => {
            await hUnreadable.result.current.launch();
        });
        expect(hUnreadable.result.current.status).toBe('error');
        expect(hUnreadable.result.current.error).toMatch(/Sauvegarde locale impossible/i);
        expect(hUnreadable.result.current.result).toEqual(computed);
        await act(async () => {
            await hUnreadable.result.current.clear();
        });
        hUnreadable.unmount();

        // 3) cancel() rapide -> launch() immédiat + modification de params pendant isRunning -> isStale === true
        let resolveSecond!: (r: GrandCalculResult) => void;
        vi.spyOn(runAsyncMod, 'runGrandCalculAsync')
            .mockImplementationOnce(
                (_p, _c, opts) =>
                    new Promise((_, reject) => {
                        opts.signal?.addEventListener('abort', () => reject(new Error(GRAND_CALCUL_CANCELLED)));
                    }),
            )
            .mockImplementationOnce(
                () =>
                    new Promise<GrandCalculResult>((resolve) => {
                        resolveSecond = resolve;
                    }),
            );
        vi.spyOn(grandCalculStoreMod, 'saveGrandCalculResult').mockResolvedValue(true);

        const hRace = renderHook(({ p }) => useGrandCalcul(p), { initialProps: { p: params } });
        await waitFor(() => expect(hRace.result.current.isRestoring).toBe(false));

        let pFirst!: Promise<void>;
        let pSecond!: Promise<void>;
        act(() => {
            pFirst = hRace.result.current.launch();
        });
        act(() => {
            hRace.result.current.cancel();
            pSecond = hRace.result.current.launch();
        });
        expect(hRace.result.current.isRunning).toBe(true);

        // Édition des paramètres pendant que le 2e calcul est en vol
        hRace.rerender({ p: makeParams(60) });
        await act(async () => {
            resolveSecond(computed);
            await Promise.all([pFirst, pSecond]);
        });
        expect(hRace.result.current.status).toBe('ready');
        expect(hRace.result.current.isStale).toBe(true);
    });
});

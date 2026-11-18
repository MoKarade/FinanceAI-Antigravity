import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SimulationParams } from '../../../services/projection';
import type {
    GrandCalculConfig,
    GrandCalculShardResult,
} from '../../../services/projection/types';
import type { BudgetConfig, ProjectionConfig, RetirementGoal } from '../../../types';
import {
    GRAND_CALCUL_CANCELLED,
    computeGrandCalculParamsSig,
    runGrandCalculAsync,
    shardIterationRanges,
    type GrandCalculProgress,
} from '../../../services/projection/runAsync';

const runGrandCalculShardImpl = vi.hoisted(() => ({
    fn: null as ((...args: unknown[]) => GrandCalculShardResult) | null,
}));

vi.mock('../../../services/projection', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../services/projection')>();
    return {
        ...actual,
        runGrandCalculShard: (
            params: SimulationParams,
            config: GrandCalculConfig,
            startIter: number,
            count: number,
            onProgress?: (done: number, total: number) => void,
        ) => {
            if (runGrandCalculShardImpl.fn) {
                return runGrandCalculShardImpl.fn(params, config, startIter, count, onProgress);
            }
            return actual.runGrandCalculShard(params, config, startIter, count, onProgress);
        },
    };
});

function makeParams(years = 5): SimulationParams {
    const projection: ProjectionConfig = {
        years,
        returnRate: 6.5,
        inflationRate: 2.0,
        savingsMode: 'manual',
        manualContribution: 1000,
        usePortfolioRate: false,
        returnRates: { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 },
        emergencyFundMonths: 3,
        salaryGrowth: 2.0,
        propertyGrowthRate: 3.0,
    };
    const config: BudgetConfig = {
        users: [
            {
                name: 'ProfilTest',
                grossSalary: 7000,
                netSalary: 4800,
                color: '#10b981',
                age: 42,
                birthYear: 1984,
                canadaArrivalYear: 1984,
                hasOwnedPropertyLast4Years: true,
                celiContributed: 0,
                rrspContributed: 0,
            },
        ],
        splitMode: '50/50',
    } as unknown as BudgetConfig;
    const retirementGoal: RetirementGoal = {
        targetAge: 65,
        targetMonthlyIncome: 4000,
        governmentPension: 1400,
        lifeExpectancy: 90,
    };
    return {
        projection,
        calculatedStartingCash: 20_000,
        liveCSVBalances: { CELI: 60_000, CELIAPP: 0, REER: 120_000, NON_ENREG: 30_000, CRYPTO: 0, REEE: 0 },
        realEstateGoals: [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal,
        config,
        baseGrossAnnual: 84_000,
        baseNetAnnual: 57_600,
        currentRentExpense: 1600,
        baseMonthlyExpenses: 3200,
        startYear: 2026,
        startMonth: 0,
        financialGoals: [],
    };
}

function makeSyntheticShard(nMonths: number, count: number, baseNW = 100_000): GrandCalculShardResult {
    const monthCount = nMonths + 1;
    const counts = new Uint16Array(monthCount);
    const means = new Float64Array(monthCount);
    const weights = new Uint32Array(monthCount);
    const exactFlags = new Uint8Array(monthCount);
    for (let m = 0; m < monthCount; m++) {
        counts[m] = 1;
        means[m] = baseNW + m * 250;
        weights[m] = count;
        exactFlags[m] = 1;
    }
    const fill = (val: number) => {
        const arr = new Float32Array(count);
        arr.fill(val);
        return arr;
    };
    return {
        iterationsDone: count,
        ruinedCount: 0,
        monthlyHistogramsOrSamples: {
            nMonths,
            counts,
            means,
            weights,
            exactFlags,
        },
        fiReachedAges: fill(58),
        goalResults: {},
        sustainableMonthlyNetReal: fill(4200),
        estateTotals: fill(18_000),
        estateFeds: fill(8_000),
        estateQcs: fill(10_000),
        estateRealTotals: fill(15_000),
        finalNetWorths: fill(baseNW + nMonths * 250),
        deathAges: fill(90),
        fireTargetValid: true,
        horizonAge: 42 + Math.round(nMonths / 12),
        retirementMonthsTotal: count * 12,
    };
}

describe('shardIterationRanges', () => {
    it('découpe équitablement avec reste sur les premiers shards et couverture contiguë', () => {
        expect(shardIterationRanges(10, 3)).toEqual([
            { startIter: 0, count: 4 },
            { startIter: 4, count: 3 },
            { startIter: 7, count: 3 },
        ]);
        expect(shardIterationRanges(50_000, 4)).toEqual([
            { startIter: 0, count: 12_500 },
            { startIter: 12_500, count: 12_500 },
            { startIter: 25_000, count: 12_500 },
            { startIter: 37_500, count: 12_500 },
        ]);
    });

    it('omet les shards vides si n > totalCount et retourne [] si totalCount <= 0', () => {
        expect(shardIterationRanges(2, 5)).toEqual([
            { startIter: 0, count: 1 },
            { startIter: 1, count: 1 },
        ]);
        expect(shardIterationRanges(0, 4)).toEqual([]);
        expect(shardIterationRanges(-10, 4)).toEqual([]);
        expect(shardIterationRanges(Number.NaN, 4)).toEqual([]);
    });
});

describe('computeGrandCalculParamsSig', () => {
    const baseCfg: GrandCalculConfig = {
        iterations: 50_000,
        enableMacroRegimes: true,
        includeHistoricalCrises: false,
    };

    it('est déterministe et insensible à l’ordre des clés ou aux propriétés undefined', () => {
        const p1 = makeParams();
        const p2 = makeParams();
        p2.projection = {
            propertyGrowthRate: 3.0,
            salaryGrowth: 2.0,
            emergencyFundMonths: 3,
            returnRates: { cash: 3, crypto: 10, nonReg: 6.5, reer: 6.5, celi: 7 },
            usePortfolioRate: false,
            manualContribution: 1000,
            savingsMode: 'manual',
            inflationRate: 2.0,
            returnRate: 6.5,
            years: 5,
        };
        const sigA = computeGrandCalculParamsSig(p1, { ...baseCfg, seed: undefined });
        const sigB = computeGrandCalculParamsSig(p2, baseCfg);
        expect(sigA).toMatch(/^gc1:[0-9a-z]+:[0-9a-z]+:[0-9a-z]+$/);
        expect(sigA).toBe(sigB);
    });

    it('normalise -0 → 0 et distingue NaN / null / Infinity / -Infinity', () => {
        const pZero = makeParams();
        pZero.calculatedStartingCash = 0;
        const pNegZero = makeParams();
        pNegZero.calculatedStartingCash = -0;
        expect(computeGrandCalculParamsSig(pZero, baseCfg)).toBe(computeGrandCalculParamsSig(pNegZero, baseCfg));

        const pNaN = makeParams();
        pNaN.calculatedStartingCash = Number.NaN;
        const pInf = makeParams();
        pInf.calculatedStartingCash = Number.POSITIVE_INFINITY;
        const pNegInf = makeParams();
        pNegInf.calculatedStartingCash = Number.NEGATIVE_INFINITY;
        const pNull = makeParams();
        (pNull as unknown as Record<string, unknown>).calculatedStartingCash = null;

        const sigs = new Set([
            computeGrandCalculParamsSig(pZero, baseCfg),
            computeGrandCalculParamsSig(pNaN, baseCfg),
            computeGrandCalculParamsSig(pInf, baseCfg),
            computeGrandCalculParamsSig(pNegInf, baseCfg),
            computeGrandCalculParamsSig(pNull, baseCfg),
        ]);
        expect(sigs.size).toBe(5);
    });

    it('préserve les références partagées non circulaires et tolère les cycles vrais sans lever', () => {
        const sharedObj = { rate: 0.05, label: 'shared' };
        const pShared = makeParams() as unknown as Record<string, unknown>;
        pShared.extraA = sharedObj;
        pShared.extraB = sharedObj;

        const pDup = makeParams() as unknown as Record<string, unknown>;
        pDup.extraA = { rate: 0.05, label: 'shared' };
        pDup.extraB = { rate: 0.05, label: 'shared' };

        expect(computeGrandCalculParamsSig(pShared as unknown as SimulationParams, baseCfg))
            .toBe(computeGrandCalculParamsSig(pDup as unknown as SimulationParams, baseCfg));

        const circular: Record<string, unknown> = { label: 'loop' };
        circular.self = circular;
        const pCycle = makeParams() as unknown as Record<string, unknown>;
        pCycle.cycle = circular;
        const sigCycle = computeGrandCalculParamsSig(pCycle as unknown as SimulationParams, baseCfg);
        expect(sigCycle).toMatch(/^gc1:/);
        expect(sigCycle).not.toBe('gc1:invalid');
    });

    it('ignore params.entreesRefusees et réagit aux changements de config', () => {
        const p1 = makeParams();
        const p2 = makeParams();
        p2.entreesRefusees = [{ role: 'cause', chemin: 'config.users[0].netSalary', libelle: 'le salaire net', valeur: Number.NaN }];
        expect(computeGrandCalculParamsSig(p1, baseCfg)).toBe(computeGrandCalculParamsSig(p2, baseCfg));

        const sigBase = computeGrandCalculParamsSig(p1, baseCfg);
        expect(computeGrandCalculParamsSig(p1, { ...baseCfg, iterations: 100_000 })).not.toBe(sigBase);
        expect(computeGrandCalculParamsSig(p1, { ...baseCfg, enableMacroRegimes: false })).not.toBe(sigBase);
        expect(computeGrandCalculParamsSig(p1, { ...baseCfg, includeHistoricalCrises: true })).not.toBe(sigBase);
        expect(computeGrandCalculParamsSig(p1, { ...baseCfg, seed: 42 })).not.toBe(sigBase);
    });

    it('distingue Date vs Invalid Date, TypedArray/DataView, Set, Map, BigInt et borne iterations NaN/hors-plage', () => {
        const pDate = makeParams() as unknown as Record<string, unknown>;
        pDate.d = new Date('2026-06-15T00:00:00.000Z');
        const pInvalidDate = makeParams() as unknown as Record<string, unknown>;
        pInvalidDate.d = new Date('invalid');
        const pUint8 = makeParams() as unknown as Record<string, unknown>;
        pUint8.buf = new Uint8Array([1, 2, 3]);
        const pDataView = makeParams() as unknown as Record<string, unknown>;
        pDataView.buf = new DataView(new Uint8Array([1, 2, 4]).buffer);
        const pSet = makeParams() as unknown as Record<string, unknown>;
        pSet.tags = new Set(['a', 'b']);
        const pMap = makeParams() as unknown as Record<string, unknown>;
        pMap.kv = new Map([['k', 1n]]);

        const sigs = new Set([
            computeGrandCalculParamsSig(pDate as unknown as SimulationParams, baseCfg),
            computeGrandCalculParamsSig(pInvalidDate as unknown as SimulationParams, baseCfg),
            computeGrandCalculParamsSig(pUint8 as unknown as SimulationParams, baseCfg),
            computeGrandCalculParamsSig(pDataView as unknown as SimulationParams, baseCfg),
            computeGrandCalculParamsSig(pSet as unknown as SimulationParams, baseCfg),
            computeGrandCalculParamsSig(pMap as unknown as SimulationParams, baseCfg),
        ]);
        expect(sigs.size).toBe(6);

        // iterations NaN / < 50_000 se replient tous sur 50_000
        const base50k = computeGrandCalculParamsSig(makeParams(), { ...baseCfg, iterations: 50_000 });
        expect(computeGrandCalculParamsSig(makeParams(), { ...baseCfg, iterations: Number.NaN })).toBe(base50k);
        expect(computeGrandCalculParamsSig(makeParams(), { ...baseCfg, iterations: 100 })).toBe(base50k);
        const base100k = computeGrandCalculParamsSig(makeParams(), { ...baseCfg, iterations: 100_000 });
        expect(computeGrandCalculParamsSig(makeParams(), { ...baseCfg, iterations: 999_999 })).toBe(base100k);
    });
});

describe('runGrandCalculAsync — pool multi-workers, fallback JS et annulation', () => {
    beforeEach(() => {
        runGrandCalculShardImpl.fn = null;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        runGrandCalculShardImpl.fn = null;
    });

    it('rejette avant de spawner des workers si le signal est déjà annulé ou entreesRefusees présent', async () => {
        const workerCtor = vi.fn();
        vi.stubGlobal('Worker', workerCtor);

        const controller = new AbortController();
        controller.abort();
        const params = makeParams();
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };

        expect(GRAND_CALCUL_CANCELLED).toBe('__GRAND_CALCUL_CANCELLED__');
        await expect(
            runGrandCalculAsync(params, cfg, { paramsSig: 'gc1:preabort', signal: controller.signal }),
        ).rejects.toThrow('__GRAND_CALCUL_CANCELLED__');
        expect(workerCtor).not.toHaveBeenCalled();

        const badParams = makeParams();
        badParams.entreesRefusees = [{ role: 'cause', chemin: 'config.users[0].netSalary', libelle: 'le salaire net', valeur: Number.NaN }];
        await expect(
            runGrandCalculAsync(badParams, cfg, { paramsSig: 'gc1:refused' }),
        ).rejects.toThrow();
        expect(workerCtor).not.toHaveBeenCalled();
    });

    it('distribue les shards sur le pool de workers, agrège la progression et câble deterministicEstate', async () => {
        interface PostedMsg {
            __requestId: number;
            mode: string;
            grandCalculConfig: GrandCalculConfig;
            startIter: number;
            count: number;
        }
        const spawned: Array<{
            posted: PostedMsg[];
            terminated: boolean;
            listeners: Map<string, Array<(e: unknown) => void>>;
            emit: (type: string, e: unknown) => void;
        }> = [];

        class MockWorker {
            posted: PostedMsg[] = [];
            terminated = false;
            listeners = new Map<string, Array<(e: unknown) => void>>();
            addEventListener(type: string, cb: (e: unknown) => void) {
                const list = this.listeners.get(type) ?? [];
                list.push(cb);
                this.listeners.set(type, list);
            }
            emit(type: string, e: unknown) {
                for (const cb of this.listeners.get(type) ?? []) cb(e);
            }
            postMessage(msg: PostedMsg) {
                this.posted.push(msg);
                spawned.push(this);
                queueMicrotask(() => {
                    if (this.terminated) return;
                    const half = Math.floor(msg.count / 2);
                    this.emit('message', {
                        data: { __requestId: msg.__requestId, __progress: { done: half, total: msg.count } },
                    });
                    this.emit('message', {
                        data: { __requestId: msg.__requestId, result: makeSyntheticShard(60, msg.count) },
                    });
                });
            }
            terminate() {
                this.terminated = true;
            }
        }

        vi.stubGlobal('Worker', MockWorker);
        vi.stubGlobal('navigator', { hardwareConcurrency: 4 });

        const params = makeParams(5);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: true };
        const sig = computeGrandCalculParamsSig(params, cfg);
        const updates: GrandCalculProgress[] = [];

        const result = await runGrandCalculAsync(params, cfg, {
            paramsSig: sig,
            onProgress: (p) => updates.push(p),
        });

        expect(spawned).toHaveLength(4);
        const ranges = spawned.map((w) => ({
            mode: w.posted[0].mode,
            startIter: w.posted[0].startIter,
            count: w.posted[0].count,
        }));
        expect(ranges).toEqual([
            { mode: 'grandCalculShard', startIter: 0, count: 12_500 },
            { mode: 'grandCalculShard', startIter: 12_500, count: 12_500 },
            { mode: 'grandCalculShard', startIter: 25_000, count: 12_500 },
            { mode: 'grandCalculShard', startIter: 37_500, count: 12_500 },
        ]);
        expect(spawned.every((w) => w.terminated)).toBe(true);

        expect(updates.length).toBeGreaterThanOrEqual(4);
        for (let i = 1; i < updates.length; i++) {
            expect(updates[i].done).toBeGreaterThanOrEqual(updates[i - 1].done);
        }
        const last = updates[updates.length - 1];
        expect(last.done).toBe(50_000);
        expect(last.total).toBe(50_000);
        expect(last.pct).toBe(100);
        expect(last.etaMs).toBe(0);

        expect(result.version).toBe(1);
        expect(result.paramsSig).toBe(sig);
        expect(result.iterationsRun).toBe(50_000);
        expect(result.regimesEnabled).toBe(true);
        expect(result.historicalCrisesEnabled).toBe(true);
        expect(result.monthlyBands).toHaveLength(61);
        // deterministicEstate câblé via computeGrandCalculDeterministicBaseline
        expect(result.estateTax.projectedDeathAge).not.toBeNull();
        expect(result.estateTax.deterministicTotal).not.toBeNull();
    });

    it('réarme le watchdog sur __progress et désarme un worker déjà terminé sans faux timeout', async () => {
        vi.useFakeTimers();

        const workers: Array<{
            reqId: number;
            count: number;
            terminated: boolean;
            emit: (type: string, e: unknown) => void;
        }> = [];

        class FakeTimerWorker {
            reqId = -1;
            count = 0;
            terminated = false;
            listeners = new Map<string, Array<(e: unknown) => void>>();
            addEventListener(type: string, cb: (e: unknown) => void) {
                const list = this.listeners.get(type) ?? [];
                list.push(cb);
                this.listeners.set(type, list);
            }
            emit(type: string, e: unknown) {
                for (const cb of this.listeners.get(type) ?? []) cb(e);
            }
            postMessage(msg: { __requestId: number; count: number }) {
                this.reqId = msg.__requestId;
                this.count = msg.count;
                workers.push(this);
            }
            terminate() {
                this.terminated = true;
            }
        }

        vi.stubGlobal('Worker', FakeTimerWorker);

        const params = makeParams(5);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };

        // 1) Worker 0 termine vite; Worker 1 envoie des heartbeats à 10min et 20min (au-delà de 15min au total).
        const pSuccess = runGrandCalculAsync(params, cfg, { paramsSig: 'gc1:watchdog-ok', maxWorkers: 2 });
        await vi.advanceTimersByTimeAsync(100);
        expect(workers).toHaveLength(2);

        // Worker 0 termine à t=100ms
        workers[0].emit('message', {
            data: { __requestId: 0, result: makeSyntheticShard(60, workers[0].count) },
        });
        // t = 10 min : Worker 1 envoie un heartbeat (__progress)
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        workers[1].emit('message', {
            data: { __requestId: 1, __progress: { done: 5000, total: workers[1].count } },
        });
        // t = 20 min (> 15 min pour Worker 0 s'il n'avait pas été désarmé, mais seulement 10 min depuis heartbeat Worker 1)
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        workers[1].emit('message', {
            data: { __requestId: 1, result: makeSyntheticShard(60, workers[1].count) },
        });

        const res = await pSuccess;
        expect(res.iterationsRun).toBe(50_000);

        // 2) Un worker muet pendant >= 15 min déclenche le watchdog et termine tous les workers.
        workers.length = 0;
        const pTimeout = runGrandCalculAsync(params, cfg, { paramsSig: 'gc1:watchdog-fail', maxWorkers: 2 });
        const caughtTimeout = pTimeout.catch((e: Error) => e);
        await vi.advanceTimersByTimeAsync(15 * 60_000 + 50);
        const err = await caughtTimeout;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('sans progrès');
        expect(workers.every((w) => w.terminated)).toBe(true);
    });

    it('termine tous les workers sur AbortSignal en vol, erreur worker (__error/error/messageerror) ou échec constructeur', async () => {
        const instances: Array<{
            terminated: boolean;
            listeners: Map<string, Array<(e: unknown) => void>>;
            emit: (type: string, e: unknown) => void;
        }> = [];

        class ControllableWorker {
            terminated = false;
            listeners = new Map<string, Array<(e: unknown) => void>>();
            constructor() {
                instances.push(this);
            }
            addEventListener(type: string, cb: (e: unknown) => void) {
                const list = this.listeners.get(type) ?? [];
                list.push(cb);
                this.listeners.set(type, list);
            }
            emit(type: string, e: unknown) {
                for (const cb of this.listeners.get(type) ?? []) cb(e);
            }
            postMessage() { /* contrôlé par les tests */ }
            terminate() {
                this.terminated = true;
            }
        }

        vi.stubGlobal('Worker', ControllableWorker);
        const params = makeParams(5);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };

        // A) Abort en vol
        const controller = new AbortController();
        const pAbort = runGrandCalculAsync(params, cfg, {
            paramsSig: 'gc1:abort-mid',
            signal: controller.signal,
            maxWorkers: 2,
        });
        await vi.waitFor(() => expect(instances).toHaveLength(2));
        controller.abort();
        await expect(pAbort).rejects.toThrow('__GRAND_CALCUL_CANCELLED__');
        expect(instances.every((w) => w.terminated)).toBe(true);

        // B) __error avec préservation de stack
        instances.length = 0;
        const pWorkerErr = runGrandCalculAsync(params, cfg, { paramsSig: 'gc1:err', maxWorkers: 2 });
        await vi.waitFor(() => expect(instances).toHaveLength(2));
        instances[0].emit('message', {
            data: { __requestId: 0, __error: 'boom', __errorStack: 'Error: boom\n    at grandCalcul.ts:99:1' },
        });
        await expect(pWorkerErr).rejects.toMatchObject({
            message: 'Worker 0: boom',
            stack: expect.stringContaining('grandCalcul.ts:99:1'),
        });
        expect(instances.every((w) => w.terminated)).toBe(true);

        // C) messageerror
        instances.length = 0;
        const pMsgErr = runGrandCalculAsync(params, cfg, { paramsSig: 'gc1:msgerr', maxWorkers: 2 });
        await vi.waitFor(() => expect(instances).toHaveLength(2));
        instances[1].emit('messageerror', {});
        await expect(pMsgErr).rejects.toThrow('Worker 1 messageerror');
        expect(instances.every((w) => w.terminated)).toBe(true);

        // D) Échec constructeur au 2e worker → termine le 1er déjà créé
        instances.length = 0;
        let calls = 0;
        class FlakyCtorWorker extends ControllableWorker {
            constructor() {
                super();
                calls++;
                if (calls === 2) throw new Error('CSP blocked');
            }
        }
        vi.stubGlobal('Worker', FlakyCtorWorker);
        await expect(
            runGrandCalculAsync(params, cfg, { paramsSig: 'gc1:ctor-fail', maxWorkers: 2 }),
        ).rejects.toThrow('Pool worker Grand Calcul indisponible');
        expect(instances[0].terminated).toBe(true);
    });

    it('nettoie workers, watchdogs et listener AbortSignal si postMessage lève synchroniquement sur le 3e worker', async () => {
        vi.useFakeTimers();

        const spawned: Array<{ terminated: boolean }> = [];
        let postCalls = 0;

        class PostThrowWorker {
            terminated = false;
            listeners = new Map<string, Array<(e: unknown) => void>>();
            constructor() {
                spawned.push(this);
            }
            addEventListener(type: string, cb: (e: unknown) => void) {
                const list = this.listeners.get(type) ?? [];
                list.push(cb);
                this.listeners.set(type, list);
            }
            postMessage() {
                postCalls++;
                if (postCalls === 3) {
                    throw new DOMException('DataCloneError: could not clone params', 'DataCloneError');
                }
            }
            terminate() {
                this.terminated = true;
            }
        }

        vi.stubGlobal('Worker', PostThrowWorker);

        const controller = new AbortController();
        const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
        const params = makeParams(5);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };

        const promise = runGrandCalculAsync(params, cfg, {
            paramsSig: 'gc1:postmessage-throw',
            signal: controller.signal,
            maxWorkers: 4,
        });
        const caught = promise.catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(0);
        const err = await caught;

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('DataCloneError');
        expect(spawned).toHaveLength(3);
        expect(spawned.every((w) => w.terminated)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('borne maxWorkers: Infinity à hardwareConcurrency et nettoie tout si onProgress lève dans le listener', async () => {
        vi.useFakeTimers();

        const spawned: Array<{
            reqId: number;
            count: number;
            terminated: boolean;
            emit: (type: string, e: unknown) => void;
        }> = [];

        class ProgressTestWorker {
            reqId = -1;
            count = 0;
            terminated = false;
            listeners = new Map<string, Array<(e: unknown) => void>>();
            constructor() {
                spawned.push(this);
            }
            addEventListener(type: string, cb: (e: unknown) => void) {
                const list = this.listeners.get(type) ?? [];
                list.push(cb);
                this.listeners.set(type, list);
            }
            emit(type: string, e: unknown) {
                for (const cb of this.listeners.get(type) ?? []) cb(e);
            }
            postMessage(msg: { __requestId: number; count: number }) {
                this.reqId = msg.__requestId;
                this.count = msg.count;
                queueMicrotask(() => {
                    if (this.terminated) return;
                    this.emit('message', {
                        data: { __requestId: msg.__requestId, result: makeSyntheticShard(60, msg.count) },
                    });
                });
            }
            terminate() {
                this.terminated = true;
            }
        }

        vi.stubGlobal('Worker', ProgressTestWorker);
        vi.stubGlobal('navigator', { hardwareConcurrency: 3 });

        const params = makeParams(5);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };

        // 1) maxWorkers: Infinity → borné proprement à hardwareConcurrency (3)
        const res = await runGrandCalculAsync(params, cfg, {
            paramsSig: 'gc1:maxworkers-inf',
            maxWorkers: Number.POSITIVE_INFINITY,
        });
        expect(spawned).toHaveLength(3);
        expect(res.iterationsRun).toBe(50_000);
        expect(spawned.every((w) => w.terminated)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);

        // 2) onProgress qui lève sur __progress → rejette proprement, termine tous les workers, 0 timer résiduel
        spawned.length = 0;
        class SilentWorker extends ProgressTestWorker {
            override postMessage(msg: { __requestId: number; count: number }) {
                this.reqId = msg.__requestId;
                this.count = msg.count;
            }
        }
        vi.stubGlobal('Worker', SilentWorker);

        const controller = new AbortController();
        const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
        const pFail = runGrandCalculAsync(params, cfg, {
            paramsSig: 'gc1:onprogress-throw',
            signal: controller.signal,
            maxWorkers: 2,
            onProgress: () => {
                throw new Error('onProgress boom');
            },
        });
        const caught = pFail.catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(0);
        expect(spawned).toHaveLength(2);

        spawned[0].emit('message', {
            data: { __requestId: 0, __progress: { done: 100, total: spawned[0].count } },
        });
        const err = await caught;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe('onProgress boom');
        expect(spawned.every((w) => w.terminated)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('bascule en fallback JS pur chunké quand Worker est undefined et supporte AbortSignal entre chunks', async () => {
        vi.stubGlobal('Worker', undefined);
        const calls: Array<{ startIter: number; count: number }> = [];
        const controller = new AbortController();

        runGrandCalculShardImpl.fn = (
            _params: unknown,
            _cfg: unknown,
            startIter: unknown,
            count: unknown,
            onProgress: unknown,
        ) => {
            const s = startIter as number;
            const c = count as number;
            calls.push({ startIter: s, count: c });
            (onProgress as ((d: number, t: number) => void) | undefined)?.(c, c);
            return makeSyntheticShard(60, c);
        };

        const params = makeParams(5);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };
        const progressEvents: GrandCalculProgress[] = [];

        const res = await runGrandCalculAsync(params, cfg, {
            paramsSig: 'gc1:fallback-ok',
            onProgress: (p) => progressEvents.push(p),
        });

        expect(calls.length).toBeGreaterThan(1);
        const totalCovered = calls.reduce((sum, ch) => sum + ch.count, 0);
        expect(totalCovered).toBe(50_000);
        expect(res.iterationsRun).toBe(50_000);
        expect(res.estateTax.deterministicTotal).not.toBeNull();
        expect(progressEvents[progressEvents.length - 1].pct).toBe(100);

        // Abort entre deux chunks
        calls.length = 0;
        runGrandCalculShardImpl.fn = (
            _params: unknown,
            _cfg: unknown,
            startIter: unknown,
            count: unknown,
            onProgress: unknown,
        ) => {
            const s = startIter as number;
            const c = count as number;
            calls.push({ startIter: s, count: c });
            (onProgress as ((d: number, t: number) => void) | undefined)?.(c, c);
            if (calls.length === 2) controller.abort();
            return makeSyntheticShard(60, c);
        };

        await expect(
            runGrandCalculAsync(params, cfg, { paramsSig: 'gc1:fallback-abort', signal: controller.signal }),
        ).rejects.toThrow('__GRAND_CALCUL_CANCELLED__');
        expect(calls).toHaveLength(2);
    });

    it('ne fuit aucun timer watchdog lorsque onProgress appelle synchroniquement controller.abort()', async () => {
        vi.useFakeTimers();

        const spawned: Array<{
            terminated: boolean;
            listeners: Map<string, Array<(e: unknown) => void>>;
            emit: (type: string, e: unknown) => void;
        }> = [];

        class SyncAbortProbeWorker {
            terminated = false;
            listeners = new Map<string, Array<(e: unknown) => void>>();
            constructor() {
                spawned.push(this);
            }
            addEventListener(type: string, cb: (e: unknown) => void) {
                const list = this.listeners.get(type) ?? [];
                list.push(cb);
                this.listeners.set(type, list);
            }
            emit(type: string, e: unknown) {
                for (const cb of this.listeners.get(type) ?? []) cb(e);
            }
            postMessage(msg: { __requestId: number; count: number }) {
                queueMicrotask(() => {
                    if (this.terminated) return;
                    this.emit('message', {
                        data: { __requestId: msg.__requestId, __progress: { done: 100, total: msg.count } },
                    });
                });
            }
            terminate() {
                this.terminated = true;
            }
        }

        vi.stubGlobal('Worker', SyncAbortProbeWorker);
        const controller = new AbortController();
        const params = makeParams(5);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };

        const promise = runGrandCalculAsync(params, cfg, {
            paramsSig: 'gc1:sync-abort-on-progress',
            signal: controller.signal,
            maxWorkers: 2,
            onProgress: () => {
                controller.abort();
            },
        });
        const caught = promise.catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(0);
        const err = await caught;

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe('__GRAND_CALCUL_CANCELLED__');
        expect(spawned).toHaveLength(2);
        expect(spawned.every((w) => w.terminated)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('nettoie tout si onProgress lève sur complétion finale ou si mergeGrandCalculShards lève dans tryResolve', async () => {
        vi.useFakeTimers();

        const spawned: Array<{
            terminated: boolean;
            listeners: Map<string, Array<(e: unknown) => void>>;
            emit: (type: string, e: unknown) => void;
        }> = [];

        class FinalStageWorker {
            terminated = false;
            listeners = new Map<string, Array<(e: unknown) => void>>();
            constructor() {
                spawned.push(this);
            }
            addEventListener(type: string, cb: (e: unknown) => void) {
                const list = this.listeners.get(type) ?? [];
                list.push(cb);
                this.listeners.set(type, list);
            }
            emit(type: string, e: unknown) {
                for (const cb of this.listeners.get(type) ?? []) cb(e);
            }
            postMessage(msg: { __requestId: number; count: number }) {
                queueMicrotask(() => {
                    if (this.terminated) return;
                    this.emit('message', {
                        data: { __requestId: msg.__requestId, result: makeSyntheticShard(60, msg.count) },
                    });
                });
            }
            terminate() {
                this.terminated = true;
            }
        }

        vi.stubGlobal('Worker', FinalStageWorker);
        const params = makeParams(5);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };

        // 1) onProgress lève sur le message final d'un shard
        const pFinalThrow = runGrandCalculAsync(params, cfg, {
            paramsSig: 'gc1:final-onprogress-throw',
            maxWorkers: 2,
            onProgress: () => {
                throw new Error('final progress boom');
            },
        });
        const caughtFinal = pFinalThrow.catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(0);
        expect(((await caughtFinal) as Error).message).toBe('final progress boom');
        expect(spawned.every((w) => w.terminated)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);

        // 2) mergeGrandCalculShards lève dans tryResolve (shard résultat malformé)
        spawned.length = 0;
        class BrokenShardWorker extends FinalStageWorker {
            override postMessage(msg: { __requestId: number }) {
                queueMicrotask(() => {
                    if (this.terminated) return;
                    this.emit('message', {
                        data: { __requestId: msg.__requestId, result: { iterationsDone: 1 } },
                    });
                });
            }
        }
        vi.stubGlobal('Worker', BrokenShardWorker);
        const pMergeThrow = runGrandCalculAsync(params, cfg, {
            paramsSig: 'gc1:merge-throw',
            maxWorkers: 2,
        });
        const caughtMerge = pMergeThrow.catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(0);
        expect(await caughtMerge).toBeInstanceOf(Error);
        expect(spawned.every((w) => w.terminated)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('borne maxWorkers <= 0 ou NaN à 1 et gère projection.years = 0', async () => {
        const spawned: Array<{ terminated: boolean }> = [];
        class MinimalWorker {
            terminated = false;
            listeners = new Map<string, Array<(e: unknown) => void>>();
            constructor() {
                spawned.push(this);
            }
            addEventListener(type: string, cb: (e: unknown) => void) {
                const list = this.listeners.get(type) ?? [];
                list.push(cb);
                this.listeners.set(type, list);
            }
            postMessage(msg: { __requestId: number; count: number }) {
                queueMicrotask(() => {
                    for (const cb of this.listeners.get('message') ?? []) {
                        cb({ data: { __requestId: msg.__requestId, result: makeSyntheticShard(0, msg.count) } });
                    }
                });
            }
            terminate() {
                this.terminated = true;
            }
        }
        vi.stubGlobal('Worker', MinimalWorker);
        const params = makeParams(0);
        const cfg: GrandCalculConfig = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };

        const r1 = await runGrandCalculAsync(params, cfg, { paramsSig: 'gc1:mw-zero', maxWorkers: 0 });
        expect(spawned).toHaveLength(1);
        expect(r1.monthlyBands).toHaveLength(1);

        spawned.length = 0;
        vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
        const r2 = await runGrandCalculAsync(params, cfg, { paramsSig: 'gc1:mw-nan', maxWorkers: Number.NaN });
        expect(spawned).toHaveLength(2);
        expect(r2.iterationsRun).toBe(50_000);
    });
});

describe('projection.worker — mode grandCalculShard et Transferables zero-copy', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('poste __progress et transfère les ArrayBuffers uniques des TypedArrays sans doublon', async () => {
        const postedMessages: Array<{ msg: unknown; transfer?: Transferable[] }> = [];
        const fakeSelf: {
            postMessage: (msg: unknown, transfer?: Transferable[]) => void;
            onmessage: ((e: MessageEvent) => void) | null;
        } = {
            postMessage: (msg, transfer) => postedMessages.push({ msg, transfer }),
            onmessage: null,
        };
        vi.stubGlobal('self', fakeSelf);
        vi.resetModules();
        await import('../../../services/projection.worker');

        expect(typeof fakeSelf.onmessage).toBe('function');
        const params = makeParams(1);
        fakeSelf.onmessage?.({
            data: {
                __requestId: 7,
                mode: 'grandCalculShard',
                params,
                grandCalculConfig: { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: false, seed: 12 },
                startIter: 0,
                count: 30,
            },
        } as MessageEvent);

        const progressMsgs = postedMessages.filter(
            (p) => typeof (p.msg as Record<string, unknown>).__progress === 'object',
        );
        expect(progressMsgs.length).toBeGreaterThanOrEqual(2);
        expect((progressMsgs[0].msg as { __requestId: number }).__requestId).toBe(7);

        const finalEntry = postedMessages[postedMessages.length - 1];
        const finalMsg = finalEntry.msg as { __requestId: number; result: GrandCalculShardResult };
        expect(finalMsg.__requestId).toBe(7);
        expect(finalMsg.result.iterationsDone).toBe(30);
        expect(Array.isArray(finalEntry.transfer)).toBe(true);
        const buffers = finalEntry.transfer as ArrayBuffer[];
        expect(buffers.length).toBeGreaterThanOrEqual(10);
        // Aucun ArrayBuffer dupliqué (sinon DataCloneError en vrai navigateur)
        expect(new Set(buffers).size).toBe(buffers.length);
    });
});

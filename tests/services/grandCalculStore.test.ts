import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { GrandCalculResult } from '../../services/projection/types';
import type { SimulationParams } from '../../services/projection';
import type { BudgetConfig, ProjectionConfig, RetirementGoal } from '../../types';

// Garde mockErrorLoggerComplet : inclure logError ET logErrorThrottled.
vi.mock('../../services/errorLogger', () => ({
    logError: vi.fn(),
    logErrorThrottled: vi.fn(), onLogEntry: vi.fn(() => () => {}), __resetErrorThrottle: vi.fn(),
}));

beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
        (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
    }
});

interface FakeStoreState {
    keyPath: string | null;
    records: Map<string, unknown>;
}

const fakeDatabases = new Map<string, Map<string, FakeStoreState>>();
let failNextOpen = false;
let failNextRead = false;
let failNextWrite = false;
let abortNextWrite = false;
let throwOnNextPut = false;

function installFakeIndexedDB(): void {
    const fake = {
        open(name: string) {
            const req: Record<string, unknown> = { result: undefined, error: null };
            queueMicrotask(() => {
                if (failNextOpen) {
                    failNextOpen = false;
                    req.error = new Error('IDB open failed');
                    if (typeof req.onerror === 'function') (req.onerror as () => void)();
                    return;
                }
                let stores = fakeDatabases.get(name);
                const isNew = !stores;
                if (!stores) {
                    stores = new Map();
                    fakeDatabases.set(name, stores);
                }
                const db = makeDb(stores);
                if (isNew && typeof req.onupgradeneeded === 'function') {
                    req.result = db;
                    (req.onupgradeneeded as (ev: { target: unknown }) => void)({ target: req });
                }
                req.result = db;
                if (typeof req.onsuccess === 'function') (req.onsuccess as () => void)();
            });
            return req;
        },
    };
    vi.stubGlobal('indexedDB', fake as unknown as IDBFactory);
}

function makeDb(stores: Map<string, FakeStoreState>): IDBDatabase {
    return {
        objectStoreNames: {
            contains: (storeName: string) => stores.has(storeName),
        } as unknown as DOMStringList,
        createObjectStore: (storeName: string, opts?: { keyPath?: string }) => {
            stores.set(storeName, { keyPath: opts?.keyPath ?? null, records: new Map() });
            return {} as IDBObjectStore;
        },
        close: () => {},
        transaction: (storeName: string) => {
            let state = stores.get(storeName);
            if (!state) {
                state = { keyPath: null, records: new Map() };
                stores.set(storeName, state);
            }
            const storeState = state;
            const tx: Record<string, unknown> = { error: null };
            tx.objectStore = () => ({
                get: (key: string) => {
                    const r: Record<string, unknown> = { result: undefined, error: null };
                    queueMicrotask(() => {
                        if (failNextRead) {
                            failNextRead = false;
                            r.error = new Error('IDB read failed');
                            if (typeof r.onerror === 'function') (r.onerror as () => void)();
                            return;
                        }
                        r.result = storeState.records.get(key);
                        if (typeof r.onsuccess === 'function') (r.onsuccess as () => void)();
                    });
                    return r;
                },
                put: (value: unknown, explicitKey?: string) => {
                    if (throwOnNextPut) {
                        throwOnNextPut = false;
                        throw new DOMException('Quota exceeded synchronously', 'QuotaExceededError');
                    }
                    const r: Record<string, unknown> = { result: undefined, error: null };
                    queueMicrotask(() => {
                        if (abortNextWrite) {
                            abortNextWrite = false;
                            const err = new DOMException('QuotaExceededError', 'QuotaExceededError');
                            tx.error = err;
                            r.error = err;
                            if (typeof tx.onabort === 'function') (tx.onabort as () => void)();
                            return;
                        }
                        if (failNextWrite) {
                            failNextWrite = false;
                            const err = new Error('IDB write failed');
                            tx.error = err;
                            r.error = err;
                            if (typeof tx.onerror === 'function') (tx.onerror as () => void)();
                            return;
                        }
                        const key = storeState.keyPath
                            ? String((value as Record<string, unknown>)[storeState.keyPath])
                            : String(explicitKey);
                        storeState.records.set(key, value);
                        if (typeof tx.oncomplete === 'function') (tx.oncomplete as () => void)();
                        if (typeof r.onsuccess === 'function') (r.onsuccess as () => void)();
                    });
                    return r;
                },
                delete: (key: string) => {
                    const r: Record<string, unknown> = { result: undefined, error: null };
                    queueMicrotask(() => {
                        storeState.records.delete(key);
                        if (typeof tx.oncomplete === 'function') (tx.oncomplete as () => void)();
                        if (typeof r.onsuccess === 'function') (r.onsuccess as () => void)();
                    });
                    return r;
                },
            });
            return tx as unknown as IDBTransaction;
        },
    } as unknown as IDBDatabase;
}

function makeSampleResult(overrides: Partial<GrandCalculResult> = {}): GrandCalculResult {
    return {
        version: 1,
        paramsSig: 'gc1:sample:sig:10',
        createdAt: '2026-11-17T04:00:00.000Z',
        durationMs: 1234,
        iterationsRun: 50_000,
        regimesEnabled: true,
        historicalCrisesEnabled: false,
        survivalRatePct: 94.5,
        cvar95: 42_000,
        monthlyBands: [
            {
                monthIndex: 0,
                year: 2026,
                age: 42,
                p5: 100_000,
                p10: 105_000,
                p25: 110_000,
                p50: 120_000,
                p75: 130_000,
                p90: 140_000,
                p95: 150_000,
            },
        ],
        fiAge: {
            reachedPct: 88.2,
            p5Age: 52,
            p50Age: 59,
            p95Age: null,
            horizonAge: 85,
        },
        goalProbabilities: [
            {
                goalId: 'goal-1',
                name: 'Objectif fictif',
                deadline: '2035-06',
                targetAmount: 80_000,
                probabilityPct: 82.4,
                medianShortfall: 12_500,
                status: 'evaluated',
            },
        ],
        guaranteedPurchasingPower: {
            p95SecurityMonthlyNetReal: 3200,
            p90SecurityMonthlyNetReal: 3600,
            p50SecurityMonthlyNetReal: 4900,
            retirementMonthsEvaluated: 300,
        },
        estateTax: {
            deterministicTotal: 45_000,
            deterministicFed: 20_000,
            deterministicQc: 25_000,
            mcTotalP5: 15_000,
            mcTotalP50: 48_000,
            mcTotalP95: 95_000,
            mcFedP50: 21_000,
            mcQcP50: 27_000,
            mcRealTotalP50: 31_000,
            taxableBreakdown: {
                rrspRrif: 30_000,
                capitalGainsTaxable: 15_000,
                rentalRecapture: 0,
            },
            projectedDeathAge: 88,
        },
        ...overrides,
    };
}

function makeSampleParams(): SimulationParams {
    const projection: ProjectionConfig = {
        years: 10,
        returnRate: 6,
        inflationRate: 2,
        savingsMode: 'manual',
        manualContribution: 800,
        usePortfolioRate: false,
        returnRates: { celi: 6.5, reer: 6, nonReg: 6, crypto: 9, cash: 2.5 },
        emergencyFundMonths: 3,
        salaryGrowth: 2,
        propertyGrowthRate: 3,
    };
    return {
        projection,
        calculatedStartingCash: 15_000,
        liveCSVBalances: { CELI: 50_000, CELIAPP: 0, REER: 90_000, NON_ENREG: 20_000, CRYPTO: 0, REEE: 0 },
        realEstateGoals: [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal: { targetAge: 65, targetMonthlyIncome: 3800, governmentPension: 1300, lifeExpectancy: 90 } as RetirementGoal,
        config: { users: [{ name: 'ProfilTest', age: 40 }], splitMode: '50/50' } as unknown as BudgetConfig,
        baseGrossAnnual: 78_000,
        baseNetAnnual: 54_000,
        currentRentExpense: 1500,
        baseMonthlyExpenses: 3000,
        startYear: 2026,
        startMonth: 0,
    };
}

describe('services/grandCalculStore — persistance chiffrée IndexedDB', () => {
    beforeEach(() => {
        fakeDatabases.clear();
        failNextOpen = false;
        failNextRead = false;
        failNextWrite = false;
        abortNextWrite = false;
        throwOnNextPut = false;
        vi.clearAllMocks();
        vi.resetModules();
        installFakeIndexedDB();
        if (!globalThis.crypto?.subtle) {
            (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
        }
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('chiffre en AES-256-GCM puis déchiffre exactement (round-trip) sans fuite en clair', async () => {
        const { saveGrandCalculResult, loadGrandCalculResult } = await import('../../services/grandCalculStore');
        const sample = makeSampleResult();

        const ok = await saveGrandCalculResult(sample);
        expect(ok).toBe(true);

        const rawRecord = fakeDatabases.get('financeai-grand-calcul')?.get('results')?.records.get('current') as {
            id: string;
            payload: string;
            encrypted: boolean;
        };
        expect(rawRecord).toBeDefined();
        expect(rawRecord.id).toBe('current');
        expect(rawRecord.encrypted).toBe(true);
        expect(rawRecord.payload).not.toContain('gc1:sample:sig:10');
        expect(rawRecord.payload).not.toContain('Objectif fictif');

        const loaded = await loadGrandCalculResult();
        expect(loaded).toEqual({ status: 'ok', result: sample });
    });

    it('retourne empty quand la base est vide puis après clearGrandCalculResult', async () => {
        const { saveGrandCalculResult, loadGrandCalculResult, clearGrandCalculResult } = await import('../../services/grandCalculStore');
        expect(await loadGrandCalculResult()).toEqual({ status: 'empty' });

        await saveGrandCalculResult(makeSampleResult());
        expect((await loadGrandCalculResult()).status).toBe('ok');

        await clearGrandCalculResult();
        expect(await loadGrandCalculResult()).toEqual({ status: 'empty' });
    });

    it('retourne unreadable si le ciphertext est altéré ou si la clé de device a disparu', async () => {
        const { saveGrandCalculResult, loadGrandCalculResult } = await import('../../services/grandCalculStore');
        await saveGrandCalculResult(makeSampleResult());

        const store = fakeDatabases.get('financeai-grand-calcul')?.get('results')?.records;
        const original = store?.get('current') as { id: string; payload: string; encrypted: boolean; timestamp: number };

        // 1) Altération du blob chiffré
        store?.set('current', { ...original, payload: 'AAAA' + original.payload.slice(4) });
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });

        // 2) Restauration du blob intact mais suppression de la clé device dans financeai-secure
        store?.set('current', original);
        fakeDatabases.get('financeai-secure')?.get('crypto-keys')?.records.clear();
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });
    });

    it('retourne unreadable sur JSON corrompu, mauvaise version, structure manquante ou valeur non finie', async () => {
        const { loadGrandCalculResult } = await import('../../services/grandCalculStore');
        // Force la création du store
        await loadGrandCalculResult();
        const records = fakeDatabases.get('financeai-grand-calcul')?.get('results')?.records;

        records?.set('current', { id: 'current', payload: '{not-json', encrypted: false, timestamp: 1 });
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });

        records?.set('current', {
            id: 'current',
            payload: JSON.stringify({ ...makeSampleResult(), version: 2 }),
            encrypted: false,
            timestamp: 1,
        });
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });

        const missingSub = makeSampleResult() as unknown as Record<string, unknown>;
        delete missingSub.estateTax;
        records?.set('current', {
            id: 'current',
            payload: JSON.stringify(missingSub),
            encrypted: false,
            timestamp: 1,
        });
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });

        records?.set('current', {
            id: 'current',
            payload: JSON.stringify({ ...makeSampleResult(), durationMs: -5 }),
            encrypted: false,
            timestamp: 1,
        });
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });
    });

    it('bascule en clair avec avertissement unique par session quand WebCrypto est indisponible', async () => {
        vi.stubGlobal('crypto', undefined);
        const { saveGrandCalculResult, loadGrandCalculResult } = await import('../../services/grandCalculStore');
        const { logError } = await import('../../services/errorLogger');

        const sample = makeSampleResult();
        expect(await saveGrandCalculResult(sample)).toBe(true);
        expect(await saveGrandCalculResult(sample)).toBe(true);

        const rawRecord = fakeDatabases.get('financeai-grand-calcul')?.get('results')?.records.get('current') as {
            encrypted: boolean;
        };
        expect(rawRecord.encrypted).toBe(false);
        expect(await loadGrandCalculResult()).toEqual({ status: 'ok', result: sample });
        // Avertissement journalisé une seule fois malgré 2 écritures en clair
        expect(logError).toHaveBeenCalledTimes(1);
    });

    it('ne lève jamais en cas d’indisponibilité ou d’erreur IndexedDB et journalise proprement', async () => {
        const { saveGrandCalculResult, loadGrandCalculResult, clearGrandCalculResult } = await import('../../services/grandCalculStore');
        const { logError } = await import('../../services/errorLogger');

        // Pré-initialise la clé de device pour que failNextWrite cible bien le store 'results'
        await saveGrandCalculResult(makeSampleResult());
        vi.mocked(logError).mockClear();

        // Erreur d'écriture
        failNextWrite = true;
        expect(await saveGrandCalculResult(makeSampleResult())).toBe(false);
        expect(logError).toHaveBeenCalled();

        // Erreur de lecture -> empty silencieux côté retour + log
        failNextRead = true;
        expect(await loadGrandCalculResult()).toEqual({ status: 'empty' });

        // Erreur d'ouverture
        failNextOpen = true;
        await expect(clearGrandCalculResult()).resolves.toBeUndefined();

        // IndexedDB complètement absent
        vi.stubGlobal('indexedDB', undefined);
        expect(await saveGrandCalculResult(makeSampleResult())).toBe(false);
        expect(await loadGrandCalculResult()).toEqual({ status: 'empty' });
        await expect(clearGrandCalculResult()).resolves.toBeUndefined();
    });

    it('isole strictement le mode test ({ isTestMode: true }) du mode réel', async () => {
        const { saveGrandCalculResult, loadGrandCalculResult, clearGrandCalculResult } = await import('../../services/grandCalculStore');
        const realSample = makeSampleResult({ paramsSig: 'gc1:real' });
        const testSample = makeSampleResult({ paramsSig: 'gc1:test', iterationsRun: 75_000 });

        await saveGrandCalculResult(realSample);
        await saveGrandCalculResult(testSample, { isTestMode: true });

        expect(await loadGrandCalculResult()).toEqual({ status: 'ok', result: realSample });
        expect(await loadGrandCalculResult({ isTestMode: true })).toEqual({ status: 'ok', result: testSample });

        await clearGrandCalculResult({ isTestMode: true });
        expect(await loadGrandCalculResult({ isTestMode: true })).toEqual({ status: 'empty' });
        expect(await loadGrandCalculResult()).toEqual({ status: 'ok', result: realSample });
    });

    it('sérialise les appels concurrents saveGrandCalculResult et clearGrandCalculResult dans l’ordre', async () => {
        const { saveGrandCalculResult, loadGrandCalculResult, clearGrandCalculResult } = await import('../../services/grandCalculStore');
        const s1 = makeSampleResult({ paramsSig: 'gc1:seq1' });
        const s2 = makeSampleResult({ paramsSig: 'gc1:seq2' });

        // save -> clear en rafale doit se terminer vide
        await Promise.all([saveGrandCalculResult(s1), clearGrandCalculResult()]);
        expect(await loadGrandCalculResult()).toEqual({ status: 'empty' });

        // clear -> save en rafale doit conserver s2
        await Promise.all([clearGrandCalculResult(), saveGrandCalculResult(s2)]);
        expect(await loadGrandCalculResult()).toEqual({ status: 'ok', result: s2 });
    });

    it('réexporte computeGrandCalculParamsSig avec signature stable et exclusion de entreesRefusees', async () => {
        const { computeGrandCalculParamsSig } = await import('../../services/grandCalculStore');
        const p1 = makeSampleParams();
        const p2 = makeSampleParams();
        p2.entreesRefusees = [{ role: 'cause', chemin: 'config.users[0].netSalary', libelle: 'le salaire net', valeur: Number.NaN }];
        const cfg = { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: false };

        expect(computeGrandCalculParamsSig(p1, cfg)).toBe(computeGrandCalculParamsSig(p2, cfg));
        expect(computeGrandCalculParamsSig(p1, cfg)).not.toBe(
            computeGrandCalculParamsSig(p1, { ...cfg, includeHistoricalCrises: true }),
        );
    });

    it('gère QuotaExceededError (tx.onabort et throw synchrone sur put) et récupère la file _writeChain', async () => {
        const { saveGrandCalculResult, loadGrandCalculResult } = await import('../../services/grandCalculStore');
        // Pré-initialise la clé device
        expect(await saveGrandCalculResult(makeSampleResult({ paramsSig: 'gc1:init' }))).toBe(true);

        // 1) tx.onabort (QuotaExceededError) + écriture suivante concurrente dans _writeChain
        abortNextWrite = true;
        const sAborted = makeSampleResult({ paramsSig: 'gc1:aborted' });
        const sFollowUp = makeSampleResult({ paramsSig: 'gc1:followup' });
        const [okAbort, okFollow] = await Promise.all([
            saveGrandCalculResult(sAborted),
            saveGrandCalculResult(sFollowUp),
        ]);
        expect([okAbort, okFollow]).toEqual([false, true]);
        expect(await loadGrandCalculResult()).toEqual({ status: 'ok', result: sFollowUp });

        // 2) put() synchrone lève QuotaExceededError
        throwOnNextPut = true;
        expect(await saveGrandCalculResult(makeSampleResult({ paramsSig: 'gc1:sync-throw' }))).toBe(false);
        expect(await loadGrandCalculResult()).toEqual({ status: 'ok', result: sFollowUp });
    });

    it('retourne unreadable sur forme de record IDB invalide, absence de WebCrypto au chargement, mauvaise clé AES-GCM ou NaN sérialisé en null', async () => {
        const { saveGrandCalculResult, loadGrandCalculResult } = await import('../../services/grandCalculStore');
        const { encryptJson } = await import('../../services/secureKeyStore');

        await saveGrandCalculResult(makeSampleResult());
        const records = fakeDatabases.get('financeai-grand-calcul')?.get('results')?.records;

        // 1) Blob chiffré lu alors que WebCrypto est indisponible (tryGetKey() === null)
        const origCrypto = globalThis.crypto;
        vi.stubGlobal('crypto', undefined);
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });
        vi.stubGlobal('crypto', origCrypto);

        // 2) Forme d'enregistrement IDB invalide (payload non-string ou encrypted non-boolean)
        records?.set('current', { id: 'current', payload: 123, encrypted: 'yes', timestamp: 1 });
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });

        // 3) Blob chiffré avec une mauvaise clé AES-GCM
        const wrongKey = await webcrypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
        );
        const wrongCipher = await encryptJson(wrongKey as unknown as CryptoKey, makeSampleResult());
        records?.set('current', { id: 'current', payload: wrongCipher, encrypted: true, timestamp: 1 });
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });

        // 4) NaN dans monthlyBands sérialisé en null par JSON.stringify -> rejeté par isValidGrandCalculResult
        const nanBandSample = makeSampleResult();
        nanBandSample.monthlyBands[0].p50 = Number.NaN;
        records?.set('current', {
            id: 'current',
            payload: JSON.stringify(nanBandSample),
            encrypted: false,
            timestamp: 1,
        });
        expect(await loadGrandCalculResult()).toEqual({ status: 'unreadable' });
    });
});

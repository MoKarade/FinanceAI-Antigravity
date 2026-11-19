import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
    DEEP_SCENARIO_IDS,
    type DeepForecastReport,
    type DeepScenarioId,
    type DeepScenarioOutput,
} from '../../services/projection/deepForecastTypes';

// Garde mockErrorLoggerComplet : inclure logError ET logErrorThrottled.
vi.mock('../../services/errorLogger', () => ({
    logError: vi.fn(),
    logErrorThrottled: vi.fn(),
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
let failNextDelete = false;

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
                        if (failNextDelete) {
                            failNextDelete = false;
                            const err = new Error('IDB delete failed');
                            tx.error = err;
                            r.error = err;
                            if (typeof tx.onerror === 'function') (tx.onerror as () => void)();
                            return;
                        }
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

function makeScenarioOutput(id: DeepScenarioId): DeepScenarioOutput {
    return {
        id,
        label: `Scénario ${id}`,
        shortDescription: 'Description fictive',
        assumptionsSummaryFr: 'Hypothèse de test neutre',
        points: [
            {
                monthIndex: 0,
                year: 2026,
                age: 40,
                netWorth: 120_000,
                p10: 105_000,
                p50: 120_000,
                p90: 135_000,
                mcRange: [105_000, 135_000],
            },
        ],
        milestones: {
            fiAge: 58,
            fiProbabilityPct: 86.5,
            sustainableMonthlyNetRetirementCad: 4_200,
            sustainableMonthlyNetP90Cad: 3_400,
            goalsSummary: [
                {
                    id: 'goal-fictif',
                    name: 'Objectif fictif',
                    targetDate: '2035-06',
                    probabilityPct: 84,
                    status: 'on_track',
                },
            ],
            finalNetWorthP50: 950_000,
            estateNetWorthP50: 880_000,
            estateTaxP50: 70_000,
            ruinProbabilityPct: 2.1,
        },
        turningPoints: [
            {
                id: 'tp-1',
                monthIndex: 60,
                year: 2031,
                age: 45,
                title: 'Jalon fictif',
                summaryFr: 'Point tournant neutre de test.',
                proofDetailsFr: ['Détail vérifiable'],
                impactCad: 15_000,
                kind: 'milestone',
            },
        ],
        appliedOptimizationsFr: ['Optimisation fiscale simulée'],
    };
}

function makeSampleReport(overrides: Partial<DeepForecastReport> = {}): DeepForecastReport {
    const scenarios = Object.fromEntries(
        DEEP_SCENARIO_IDS.map((id) => [id, makeScenarioOutput(id)]),
    ) as Record<DeepScenarioId, DeepScenarioOutput>;

    return {
        version: 1,
        inputsSig: 'df1:sample:sig:1',
        createdAt: '2026-11-18T12:00:00.000Z',
        durationMs: 1450,
        trajectoriesRun: 100_000,
        isDeepRun: true,
        pastDiagnostic: {
            transactionsAnalyzed: 24,
            monthsCovered: 12,
            firstTransactionDate: '2025-11-01',
            lastTransactionDate: '2026-10-31',
            observedMonthlyIncomeCad: 5_200,
            observedMonthlyExpensesCad: 3_600,
            budgetedMonthlyExpensesCad: 3_500,
            monthlySpendingGapCad: 100,
            observedSavingsRatePct: 30.7,
            lifestyleCreepAnnualPct: 1.5,
            fixedExpensesSharePct: 62,
            discretionarySharePct: 38,
            peakSpendingMonthLabel: 'Décembre',
            lowSpendingMonthLabel: 'Février',
            weightedMerPct: 0.22,
            estimatedAnnualFeeAndTaxDragCad: 410,
            expenseVolatilityPct: 8.4,
            findingsFr: ['Constat fictif vérifiable'],
        },
        newsBundle: {
            collectedAtIso: '2026-11-18T12:00:00.000Z',
            liveArticlesUsed: 3,
            offlineFallbackUsed: false,
            portfolioSentimentScore: 0.15,
            portfolioSentimentLabel: 'Neutre constructif',
            annualizedReturnAdjustmentPct: 0.1,
            volatilityMultiplier: 1.0,
            macroHeadlineFr: 'Contexte macroéconomique neutre',
            keySignals: [
                {
                    id: 'sig-1',
                    title: 'Signal macro test',
                    category: 'Taux',
                    impactLabel: 'Modéré',
                    plainFrench: 'Impact neutre de test.',
                    direction: 'neutre',
                    isLive: false,
                },
            ],
            aiSynthesisFr: null,
            usedGemini: false,
        },
        valoriaSummary: {
            consensus100: 74,
            consensusTitle: 'Équilibré',
            evaluatedAssetsCount: 4,
            regimeName: 'Expansion modérée',
            shortTermRatePct: 5.8,
            longTermRatePct: 6.4,
        },
        scenarios,
        concreteActions: [
            {
                id: 'act-1',
                title: 'Action fictive',
                plainFrenchWhy: 'Raison neutre de test.',
                gainCad: 12_000,
                freedomMonthsGained: 4,
                targetTab: 'investments',
                appliesAiScenario: true,
            },
        ],
        ...overrides,
    };
}

describe('services/deepForecastStore — persistance chiffrée IndexedDB Futur 4.0', () => {
    beforeEach(() => {
        fakeDatabases.clear();
        failNextOpen = false;
        failNextRead = false;
        failNextWrite = false;
        abortNextWrite = false;
        throwOnNextPut = false;
        failNextDelete = false;
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

    it('chiffre en AES-256-GCM dans financeai-deep-forecast/applied_reports puis déchiffre sans fuite en clair ni usage de localStorage', async () => {
        const lsGetSpy = vi.fn();
        const lsSetSpy = vi.fn();
        vi.stubGlobal('localStorage', {
            getItem: lsGetSpy,
            setItem: lsSetSpy,
            removeItem: vi.fn(),
        } as unknown as Storage);

        const { saveAppliedDeepForecast, loadAppliedDeepForecast } = await import('../../services/deepForecastStore');
        const sample = makeSampleReport();

        const ok = await saveAppliedDeepForecast(sample);
        expect(ok).toBe(true);

        const rawRecord = fakeDatabases.get('financeai-deep-forecast')?.get('applied_reports')?.records.get('real') as {
            id: string;
            payload: string;
            encrypted: boolean;
        };
        expect(rawRecord).toBeDefined();
        expect(rawRecord.id).toBe('real');
        expect(rawRecord.encrypted).toBe(true);
        expect(rawRecord.payload).not.toContain('df1:sample:sig:1');
        expect(rawRecord.payload).not.toContain('Objectif fictif');

        const loaded = await loadAppliedDeepForecast();
        expect(loaded).toEqual({ status: 'ok', report: sample });
        expect(lsGetSpy).not.toHaveBeenCalled();
        expect(lsSetSpy).not.toHaveBeenCalled();
    });

    it('retourne empty quand la base est vide puis après clearAppliedDeepForecast', async () => {
        const {
            saveAppliedDeepForecast,
            loadAppliedDeepForecast,
            clearAppliedDeepForecast,
        } = await import('../../services/deepForecastStore');

        expect(await loadAppliedDeepForecast()).toEqual({ status: 'empty' });

        await saveAppliedDeepForecast(makeSampleReport());
        expect((await loadAppliedDeepForecast()).status).toBe('ok');

        expect(await clearAppliedDeepForecast()).toBe(true);
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'empty' });
    });

    it('isole strictement real, test:default et chaque test:personaId', async () => {
        const {
            saveAppliedDeepForecast,
            loadAppliedDeepForecast,
            clearAppliedDeepForecast,
        } = await import('../../services/deepForecastStore');

        const realReport = makeSampleReport({ inputsSig: 'df1:real' });
        const testDefault = makeSampleReport({ inputsSig: 'df1:test-default' });
        const personaA = makeSampleReport({ inputsSig: 'df1:persona-a', trajectoriesRun: 120_000 });
        const personaB = makeSampleReport({ inputsSig: 'df1:persona-b', trajectoriesRun: 80_000 });

        await saveAppliedDeepForecast(realReport, { isTestMode: false });
        await saveAppliedDeepForecast(testDefault, { isTestMode: true, personaId: null });
        await saveAppliedDeepForecast(personaA, { isTestMode: true, personaId: 'couple-confort' });
        await saveAppliedDeepForecast(personaB, { isTestMode: true, personaId: 'lea-fauchee' });

        const records = fakeDatabases.get('financeai-deep-forecast')?.get('applied_reports')?.records;
        expect(Array.from(records?.keys() ?? []).sort()).toEqual([
            'real',
            'test:couple-confort',
            'test:default',
            'test:lea-fauchee',
        ]);

        expect(await loadAppliedDeepForecast()).toEqual({ status: 'ok', report: realReport });
        expect(await loadAppliedDeepForecast({ isTestMode: true })).toEqual({ status: 'ok', report: testDefault });
        expect(await loadAppliedDeepForecast({ isTestMode: true, personaId: 'couple-confort' })).toEqual({
            status: 'ok',
            report: personaA,
        });
        expect(await loadAppliedDeepForecast({ isTestMode: true, personaId: 'lea-fauchee' })).toEqual({
            status: 'ok',
            report: personaB,
        });

        expect(await clearAppliedDeepForecast({ isTestMode: true, personaId: 'couple-confort' })).toBe(true);
        expect(await loadAppliedDeepForecast({ isTestMode: true, personaId: 'couple-confort' })).toEqual({
            status: 'empty',
        });
        expect(await loadAppliedDeepForecast({ isTestMode: true, personaId: 'lea-fauchee' })).toEqual({
            status: 'ok',
            report: personaB,
        });
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'ok', report: realReport });
    });

    it('retourne unreadable si le blob chiffré est altéré, si la clé device disparaît, si WebCrypto manque ou si la clé diffère', async () => {
        const { saveAppliedDeepForecast, loadAppliedDeepForecast } = await import('../../services/deepForecastStore');
        const { encryptJson } = await import('../../services/secureKeyStore');

        await saveAppliedDeepForecast(makeSampleReport());
        const records = fakeDatabases.get('financeai-deep-forecast')?.get('applied_reports')?.records;
        const original = records?.get('real') as { id: string; payload: string; encrypted: boolean; timestamp: number };

        // 1) Altération du ciphertext
        records?.set('real', { ...original, payload: 'AAAA' + original.payload.slice(4) });
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'unreadable' });

        // 2) Clé de device supprimée de financeai-secure
        records?.set('real', original);
        fakeDatabases.get('financeai-secure')?.get('crypto-keys')?.records.clear();
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'unreadable' });

        // 3) Blob chiffré lu avec WebCrypto absent
        const origCrypto = globalThis.crypto;
        vi.stubGlobal('crypto', undefined);
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'unreadable' });
        vi.stubGlobal('crypto', origCrypto);

        // 4) Mauvaise clé AES-GCM
        const wrongKey = await webcrypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
        );
        const wrongCipher = await encryptJson(wrongKey as unknown as CryptoKey, makeSampleReport());
        records?.set('real', { id: 'real', payload: wrongCipher, encrypted: true, timestamp: 1 });
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'unreadable' });
    });

    it('valide strictement le schéma isValidDeepForecastReport et rejette toute corruption en unreadable', async () => {
        const { isValidDeepForecastReport, loadAppliedDeepForecast } = await import('../../services/deepForecastStore');
        const valid = makeSampleReport();
        expect(isValidDeepForecastReport(valid)).toBe(true);
        expect(isValidDeepForecastReport(makeSampleReport({ valoriaSummary: null }))).toBe(true);

        // Force création du store
        await loadAppliedDeepForecast();
        const records = fakeDatabases.get('financeai-deep-forecast')?.get('applied_reports')?.records;

        const putUnencrypted = (payload: string) => {
            records?.set('real', { id: 'real', payload, encrypted: false, timestamp: 1 });
        };

        // JSON invalide
        putUnencrypted('{bad-json');
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'unreadable' });

        // Forme record invalide
        records?.set('real', { id: 'real', payload: 42, encrypted: 'true', timestamp: 1 });
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'unreadable' });

        // Mauvaise version / inputsSig vide / createdAt vide / trajectoriesRun négatif / isDeepRun non booléen
        const badTopLevels: unknown[] = [
            { ...valid, version: 2 },
            { ...valid, inputsSig: '' },
            { ...valid, createdAt: '' },
            { ...valid, trajectoriesRun: -1 },
            { ...valid, isDeepRun: 'yes' },
        ];
        for (const candidate of badTopLevels) {
            expect(isValidDeepForecastReport(candidate)).toBe(false);
            putUnencrypted(JSON.stringify(candidate));
            expect(await loadAppliedDeepForecast()).toEqual({ status: 'unreadable' });
        }

        // Scénario manquant (3 scénarios au lieu de 4)
        const missingScenario = makeSampleReport();
        delete (missingScenario.scenarios as Record<string, unknown>).prudent_stress;
        expect(isValidDeepForecastReport(missingScenario)).toBe(false);
        putUnencrypted(JSON.stringify(missingScenario));
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'unreadable' });

        // NaN dans points[0].p50 sérialisé en null par JSON.stringify
        const nanPoint = makeSampleReport();
        nanPoint.scenarios.real_trajectory.points[0].p50 = Number.NaN;
        expect(isValidDeepForecastReport(nanPoint)).toBe(false);
        putUnencrypted(JSON.stringify(nanPoint));
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'unreadable' });

        // pastDiagnostic invalide & newsBundle invalide & concreteActions non-tableau
        const badPast = makeSampleReport();
        badPast.pastDiagnostic.transactionsAnalyzed = -3;
        expect(isValidDeepForecastReport(badPast)).toBe(false);

        const badNews = makeSampleReport();
        badNews.newsBundle.keySignals[0].direction = 'inconnu' as never;
        expect(isValidDeepForecastReport(badNews)).toBe(false);

        const badActions = makeSampleReport() as unknown as Record<string, unknown>;
        badActions.concreteActions = 'pas-un-tableau';
        expect(isValidDeepForecastReport(badActions)).toBe(false);
    });

    it('bascule en clair avec avertissement unique par session si WebCrypto est indisponible', async () => {
        vi.stubGlobal('crypto', undefined);
        const { saveAppliedDeepForecast, loadAppliedDeepForecast } = await import('../../services/deepForecastStore');
        const { logError } = await import('../../services/errorLogger');

        const sample = makeSampleReport();
        expect(await saveAppliedDeepForecast(sample)).toBe(true);
        expect(await saveAppliedDeepForecast(sample)).toBe(true);

        const rawRecord = fakeDatabases.get('financeai-deep-forecast')?.get('applied_reports')?.records.get('real') as {
            encrypted: boolean;
        };
        expect(rawRecord.encrypted).toBe(false);
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'ok', report: sample });
        expect(logError).toHaveBeenCalledTimes(1);
    });

    it('ne lève jamais en cas d’erreur ou d’absence IndexedDB et récupère _writeChain après échec', async () => {
        const {
            saveAppliedDeepForecast,
            loadAppliedDeepForecast,
            clearAppliedDeepForecast,
        } = await import('../../services/deepForecastStore');
        const { logError } = await import('../../services/errorLogger');

        expect(await saveAppliedDeepForecast(makeSampleReport({ inputsSig: 'df1:init' }))).toBe(true);
        vi.mocked(logError).mockClear();

        // tx.onabort (QuotaExceededError) + suivi dans _writeChain
        abortNextWrite = true;
        const sAborted = makeSampleReport({ inputsSig: 'df1:aborted' });
        const sFollowUp = makeSampleReport({ inputsSig: 'df1:followup' });
        const [okAbort, okFollow] = await Promise.all([
            saveAppliedDeepForecast(sAborted),
            saveAppliedDeepForecast(sFollowUp),
        ]);
        expect([okAbort, okFollow]).toEqual([false, true]);
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'ok', report: sFollowUp });

        // Throw synchrone sur put()
        throwOnNextPut = true;
        expect(await saveAppliedDeepForecast(makeSampleReport({ inputsSig: 'df1:sync-throw' }))).toBe(false);
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'ok', report: sFollowUp });

        // Erreur écriture / lecture / suppression / ouverture
        failNextWrite = true;
        expect(await saveAppliedDeepForecast(makeSampleReport())).toBe(false);

        failNextRead = true;
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'empty' });

        failNextDelete = true;
        expect(await clearAppliedDeepForecast()).toBe(false);

        failNextOpen = true;
        expect(await clearAppliedDeepForecast()).toBe(false);
        expect(logError).toHaveBeenCalled();

        // IndexedDB absent
        vi.stubGlobal('indexedDB', undefined);
        expect(await saveAppliedDeepForecast(makeSampleReport())).toBe(false);
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'empty' });
        expect(await clearAppliedDeepForecast()).toBe(false);
    });

    it('sérialise les opérations concurrentes saveAppliedDeepForecast et clearAppliedDeepForecast', async () => {
        const {
            saveAppliedDeepForecast,
            loadAppliedDeepForecast,
            clearAppliedDeepForecast,
        } = await import('../../services/deepForecastStore');

        const s1 = makeSampleReport({ inputsSig: 'df1:seq1' });
        const s2 = makeSampleReport({ inputsSig: 'df1:seq2' });

        await Promise.all([saveAppliedDeepForecast(s1), clearAppliedDeepForecast()]);
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'empty' });

        await Promise.all([clearAppliedDeepForecast(), saveAppliedDeepForecast(s2)]);
        expect(await loadAppliedDeepForecast()).toEqual({ status: 'ok', report: s2 });
    });
});

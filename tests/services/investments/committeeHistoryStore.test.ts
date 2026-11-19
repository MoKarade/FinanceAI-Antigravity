import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
    committeeScopeKey,
    loadCommitteeHistory,
    saveCommitteeAnalysis,
    deleteCommitteeAnalysis,
    clearCommitteeHistory,
    MAX_COMMITTEE_HISTORY,
} from '../../../services/investments/committeeHistoryStore';
import type { CommitteeAnalysisReport } from '../../../services/investments/multiAgentCommitteeTypes';

vi.mock('../../../services/errorLogger', () => ({
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

function makeDb(stores: Map<string, FakeStoreState>): IDBDatabase {
    return {
        objectStoreNames: { contains: (n: string) => stores.has(n) } as unknown as DOMStringList,
        createObjectStore: (n: string, opts?: { keyPath?: string }) => {
            stores.set(n, { keyPath: opts?.keyPath ?? null, records: new Map() });
            return {} as IDBObjectStore;
        },
        close: () => {},
        transaction: (n: string) => {
            let st = stores.get(n);
            if (!st) {
                st = { keyPath: null, records: new Map() };
                stores.set(n, st);
            }
            const storeState = st;
            const tx: Record<string, unknown> = { error: null };
            tx.objectStore = () => ({
                get: (key: string) => {
                    const r: Record<string, unknown> = { result: undefined, error: null };
                    queueMicrotask(() => {
                        r.result = storeState.records.get(key);
                        if (typeof r.onsuccess === 'function') (r.onsuccess as () => void)();
                    });
                    return r;
                },
                put: (val: Record<string, unknown>, key?: string) => {
                    const k = key ?? (storeState.keyPath ? String(val[storeState.keyPath]) : 'default');
                    storeState.records.set(k, val);
                    queueMicrotask(() => {
                        if (typeof tx.oncomplete === 'function') (tx.oncomplete as () => void)();
                    });
                },
                delete: (key: string) => {
                    storeState.records.delete(key);
                    queueMicrotask(() => {
                        if (typeof tx.oncomplete === 'function') (tx.oncomplete as () => void)();
                    });
                },
            });
            return tx as unknown as IDBTransaction;
        },
    } as unknown as IDBDatabase;
}

function installFakeIndexedDB(): void {
    const fake = {
        open(name: string) {
            const req: Record<string, unknown> = { result: undefined, error: null };
            queueMicrotask(() => {
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

const makeReport = (id: string, subject = 'Anthropic'): CommitteeAnalysisReport => ({
    id,
    createdAt: '2026-11-19T10:00:00.000Z',
    question: `Acheter ${subject} ?`,
    subject,
    entityStatus: 'private_unlisted',
    resolvedTicker: null,
    liveQuote: null,
    verdict: 'EXPOSITION_INDIRECTE',
    verdictLabel: 'Non coté — Exposition indirecte',
    conviction: 72,
    executiveSummary: `Synthèse confidentielle pour ${subject}`,
    consensus: ['Forte demande entreprise'],
    disagreements: ['Valorisation privée vs publique'],
    actionPlan: ['Évaluer AMZN/GOOGL'],
    indirectProxies: [],
    invalidationConditions: ['Dépôt S-1'],
    recommendedWrapper: 'REER',
    agents: [],
    sources: [],
    source: 'gemini_web',
    fallbackNotice: null,
    durationMs: 1200,
    modelUsed: 'gemini-2.5-flash',
});

describe('committeeHistoryStore — IndexedDB chiffré & isolation de portée', () => {
    beforeEach(() => {
        fakeDatabases.clear();
        installFakeIndexedDB();
        const memLs: Record<string, string> = {};
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => memLs[k] ?? null,
            setItem: (k: string, v: string) => { memLs[k] = v; },
            removeItem: (k: string) => { delete memLs[k]; },
            clear: () => { Object.keys(memLs).forEach((k) => delete memLs[k]); },
            key: (i: number) => Object.keys(memLs)[i] ?? null,
            get length() { return Object.keys(memLs).length; },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('calcule des clés de portée strictement distinctes', () => {
        expect(committeeScopeKey({ isTestMode: false })).toBe('real');
        expect(committeeScopeKey({ isTestMode: true, personaId: 'jeune' })).toBe('test:jeune');
    });

    it('chiffre au repos dans IndexedDB, n’écrit rien en localStorage et isole real vs test', async () => {
        const lsSetSpy = vi.spyOn(localStorage, 'setItem');
        await saveCommitteeAnalysis({ isTestMode: false }, makeReport('r1', 'Anthropic'));
        await saveCommitteeAnalysis({ isTestMode: true, personaId: 'jeune' }, makeReport('t1', 'MSFT'));

        expect(lsSetSpy).not.toHaveBeenCalled();

        const rawRecord = fakeDatabases
            .get('financeai-committee-history')
            ?.get('analyses')
            ?.records.get('real') as { encrypted: boolean; payload: string } | undefined;
        expect(rawRecord?.encrypted).toBe(true);
        expect(rawRecord?.payload).not.toContain('Anthropic');

        const realList = await loadCommitteeHistory({ isTestMode: false });
        const testList = await loadCommitteeHistory({ isTestMode: true, personaId: 'jeune' });
        expect(realList.map((r) => r.id)).toEqual(['r1']);
        expect(testList.map((r) => r.id)).toEqual(['t1']);

        await deleteCommitteeAnalysis({ isTestMode: false }, 'r1');
        expect(await loadCommitteeHistory({ isTestMode: false })).toEqual([]);
        expect((await loadCommitteeHistory({ isTestMode: true, personaId: 'jeune' })).map((r) => r.id)).toEqual(['t1']);

        await clearCommitteeHistory({ isTestMode: true, personaId: 'jeune' });
        expect(await loadCommitteeHistory({ isTestMode: true, personaId: 'jeune' })).toEqual([]);
    });

    it('plafonne la liste à MAX_COMMITTEE_HISTORY (20)', async () => {
        for (let i = 0; i < 24; i++) {
            await saveCommitteeAnalysis({ isTestMode: false }, makeReport(`r-${i}`, `Titre-${i}`));
        }
        const loaded = await loadCommitteeHistory({ isTestMode: false });
        expect(loaded).toHaveLength(MAX_COMMITTEE_HISTORY);
        expect(loaded[0]?.id).toBe('r-23');
    });

    it('reste résilient si IndexedDB est absent', async () => {
        vi.stubGlobal('indexedDB', undefined);
        expect(await loadCommitteeHistory({ isTestMode: false })).toEqual([]);
        const list = await saveCommitteeAnalysis({ isTestMode: false }, makeReport('r1'));
        expect(list.map((r) => r.id)).toEqual(['r1']);
    });
});

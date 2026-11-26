/**
 * @vitest-environment jsdom
 */
// Stockage des transactions par mois (`workspaces/{uid}/transactionMonths/{AAAA-MM}`) :
// aller-retour sans perte, écriture partielle, migration de l'ancien format et protection
// d'un historique Cloud plus riche. Firestore est remplacé par une fausse version en mémoire :
// aucun appel réseau, rien n'est écrit dans le vrai Firestore. Données entièrement fictives.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User as FirebaseUser } from 'firebase/auth';

const fake = vi.hoisted(() => {
    const docs = new Map<string, Record<string, unknown>>();
    const commits: Array<{ sets: string[]; updates: string[]; deletes: string[] }> = [];
    const listeners = new Map<string, Array<(snap: unknown) => void>>();
    const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    const snapOf = (path: string) => {
        const id = path.split('/').pop() ?? '';
        const data = docs.get(path);
        return { id, exists: () => data !== undefined, data: () => (data ? clone(data) : undefined) };
    };
    const notify = (path: string) => {
        for (const cb of listeners.get(path) ?? []) cb(snapOf(path));
    };
    return { docs, commits, listeners, clone, snapOf, notify };
});

vi.mock('firebase/firestore', () => {
    const ref = (_db: unknown, ...segments: string[]) => ({ path: segments.join('/'), id: segments[segments.length - 1] });
    return {
        doc: ref,
        collection: ref,
        query: (c: unknown) => c,
        serverTimestamp: () => ({ seconds: Math.floor(Date.now() / 1000) }),
        getDoc: async (r: { path: string }) => fake.snapOf(r.path),
        getDocs: async (c: { path: string }) => {
            const prefix = `${c.path}/`;
            const matching = [...fake.docs.keys()].filter(
                (p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'),
            );
            return { docs: matching.map((p) => fake.snapOf(p)) };
        },
        setDoc: async (r: { path: string }, data: Record<string, unknown>) => {
            fake.docs.set(r.path, fake.clone(data));
            fake.notify(r.path);
        },
        updateDoc: async (r: { path: string }, data: Record<string, unknown>) => {
            const existing = fake.docs.get(r.path);
            if (!existing) throw new Error('document absent');
            fake.docs.set(r.path, { ...existing, ...fake.clone(data) });
            fake.notify(r.path);
        },
        deleteDoc: async (r: { path: string }) => {
            fake.docs.delete(r.path);
        },
        onSnapshot: (r: { path: string }, next: (snap: unknown) => void) => {
            const list = fake.listeners.get(r.path) ?? [];
            list.push(next);
            fake.listeners.set(r.path, list);
            queueMicrotask(() => next(fake.snapOf(r.path)));
            return () => {
                fake.listeners.set(r.path, (fake.listeners.get(r.path) ?? []).filter((cb) => cb !== next));
            };
        },
        writeBatch: () => {
            const ops: Array<() => void> = [];
            const log = { sets: [] as string[], updates: [] as string[], deletes: [] as string[] };
            const touched = new Set<string>();
            return {
                set(r: { path: string }, data: Record<string, unknown>) {
                    log.sets.push(r.path);
                    touched.add(r.path);
                    ops.push(() => fake.docs.set(r.path, fake.clone(data)));
                },
                update(r: { path: string }, data: Record<string, unknown>) {
                    log.updates.push(r.path);
                    touched.add(r.path);
                    ops.push(() => {
                        const existing = fake.docs.get(r.path);
                        if (!existing) throw new Error('document absent');
                        fake.docs.set(r.path, { ...existing, ...fake.clone(data) });
                    });
                },
                delete(r: { path: string }) {
                    log.deletes.push(r.path);
                    touched.add(r.path);
                    ops.push(() => fake.docs.delete(r.path));
                },
                async commit() {
                    for (const op of ops) op();
                    fake.commits.push(log);
                    for (const p of touched) fake.notify(p);
                },
            };
        },
    };
});

vi.mock('../../services/firebase/firebaseClient', () => ({
    app: {},
    db: {},
    auth: { currentUser: null },
    googleProvider: {},
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete', LIST: 'list', GET: 'get', WRITE: 'write' },
    handleFirestoreError: (error: unknown) => {
        throw error instanceof Error ? error : new Error(String(error));
    },
    testFirestoreConnection: async () => true,
}));

type WorkspaceSync = typeof import('../../services/firebase/workspaceSync');
type TransactionMonths = typeof import('../../services/firebase/transactionMonths');
type Store = typeof import('../../store/useFinanceStore')['useFinanceStore'];

const UID = 'utilisateur_fictif_01';
const user = { uid: UID } as FirebaseUser;
const MAIN_PATH = `workspaces/${UID}`;
const MONTHS_PREFIX = `workspaces/${UID}/transactionMonths/`;

let sync: WorkspaceSync;
let months: TransactionMonths;
let store: Store;

/** Transactions fictives, plus récentes d'abord, réparties sur `monthCount` mois. */
function buildTransactions(total: number, monthCount: number) {
    const list = Array.from({ length: total }, (_, i) => {
        const monthIndex = i % monthCount; // 0 = mois le plus ancien
        const year = 2024 + Math.floor(monthIndex / 12);
        const month = (monthIndex % 12) + 1;
        const day = (i % 28) + 1;
        return {
            id: i + 1,
            date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            payee: `Commerce fictif ${i % 97}`,
            amount: -((i % 50) + 1),
            category: 'Épicerie',
            status: 'processed' as const,
        };
    });
    return months.sortTransactionsNewestFirst(list);
}

function setLocalState(transactions: unknown[]) {
    const config = store.getState().config;
    store.setState({
        config: { ...config, users: [{ ...(config.users?.[0] ?? {}), name: 'Camille' }, ...(config.users ?? []).slice(1)] },
        transactions: transactions as never,
    } as never);
}

function monthDocPaths(): string[] {
    return [...fake.docs.keys()].filter((p) => p.startsWith(MONTHS_PREFIX)).sort();
}

function cloudTransactionCount(): number {
    return monthDocPaths().reduce((sum, p) => sum + Number(fake.docs.get(p)?.count ?? 0), 0);
}

function mainStatePayload(): Record<string, unknown> {
    return fake.docs.get(MAIN_PATH)?.statePayload as Record<string, unknown>;
}

beforeEach(async () => {
    fake.docs.clear();
    fake.commits.length = 0;
    fake.listeners.clear();
    localStorage.clear();
    vi.resetModules();
    sync = await import('../../services/firebase/workspaceSync');
    months = await import('../../services/firebase/transactionMonths');
    store = (await import('../../store/useFinanceStore')).useFinanceStore;
});

describe('transactionMonths — fonctions pures', () => {
    it('range par mois, garde les dates illisibles dans le document principal et ne réécrit que les mois modifiés', () => {
        const txs = [
            { id: 1, date: '2026-02-10', amount: -1 },
            { id: 2, date: 'date inconnue', amount: -2 },
            { id: 3, date: '2026-01-05', amount: -3 },
        ];
        const partition = months.partitionTransactionsByMonth(txs);
        expect(partition.months.map((m) => m.month)).toEqual(['2026-02', '2026-01']);
        expect(partition.leftovers).toEqual([txs[1]]);

        const remote = new Map([
            ['2026-02', partition.months[0].fingerprint],
            ['2026-01', 'empreinte_perimee'],
            ['2025-12', 'mois_vide'],
        ]);
        const plan = months.planTransactionMonthWrites(partition, remote);
        expect(plan.upserts.map((m) => m.month)).toEqual(['2026-01']);
        expect(plan.deletes).toEqual(['2025-12']);
    });

    it('fusionne sans doublon : le document principal l’emporte sur un même id', () => {
        const merged = months.mergeTransactionSources(
            [{ id: 7, date: '2026-03-01', amount: -70 }],
            [
                { month: '2026-03', count: 2, fingerprint: 'x', revisionId: 'r', transactions: [
                    { id: 7, date: '2026-03-01', amount: -1 },
                    { id: 8, date: '2026-03-02', amount: -8 },
                ] },
            ],
        );
        expect(merged).toEqual([
            { id: 8, date: '2026-03-02', amount: -8 },
            { id: 7, date: '2026-03-01', amount: -70 },
        ]);
    });

    it('lève une erreur sur un mois corrompu plutôt que de l’ignorer', () => {
        expect(() => months.parseTransactionMonthDoc('2026-01', { jsonChunks: ['[{"id":1'] })).toThrow(/corrompu/);
    });
});

describe('workspaceSync — transactions par mois dans Cloud Firestore', () => {
    it('5 000 transactions sur 30 mois : aller-retour sans aucune perte', async () => {
        const original = buildTransactions(5000, 30);
        setLocalState(original);

        await sync.pushWorkspaceToFirestore(user);

        expect(monthDocPaths()).toHaveLength(30);
        expect(cloudTransactionCount()).toBe(5000);
        for (const path of monthDocPaths()) {
            const doc = fake.docs.get(path) as Record<string, unknown>;
            expect(Object.keys(doc).sort()).toEqual(['count', 'jsonChunks', 'month', 'ownerId', 'revisionId', 'updatedAt']);
            expect(doc.ownerId).toBe(UID);
            expect(path.endsWith(String(doc.month))).toBe(true);
            expect(doc.count as number).toBeLessThanOrEqual(5000);
            expect((doc.jsonChunks as string[]).length).toBeGreaterThanOrEqual(1);
            expect((doc.jsonChunks as string[]).length).toBeLessThanOrEqual(20);
            expect(String(doc.revisionId)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
        }
        const statePayload = mainStatePayload();
        expect(statePayload.transactionsSharded).toBe(true);
        expect(Object.keys(statePayload).length).toBeLessThanOrEqual(30);
        expect(statePayload).not.toHaveProperty('apiKeys');
        expect(sync.unpackWorkspacePayloadFromFirestore(statePayload)?.transactions).toEqual([]);

        // Un autre appareil (modules neufs, store vide) restaure l'historique complet.
        vi.resetModules();
        sync = await import('../../services/firebase/workspaceSync');
        store = (await import('../../store/useFinanceStore')).useFinanceStore;
        store.setState({ transactions: [] } as never);

        const result = await sync.pullWorkspaceFromFirestoreNow(user);
        expect(result.restored).toBe(true);
        expect(result.transactionsCount).toBe(5000);
        expect(store.getState().transactions).toEqual(original);
    });

    it('écriture partielle : une modification ne réécrit qu’un seul mois ; un mois vidé est supprimé', async () => {
        const original = buildTransactions(600, 12);
        setLocalState(original);
        await sync.pushWorkspaceToFirestore(user);
        expect(monthDocPaths()).toHaveLength(12);
        fake.commits.length = 0;

        const target = original[0] as { id: number; date: string };
        const edited = original.map((tx) => (tx.id === target.id ? { ...tx, payee: 'Commerce fictif modifié' } : tx));
        setLocalState(edited);
        await sync.pushWorkspaceToFirestore(user);

        expect(fake.commits).toHaveLength(1);
        expect(fake.commits[0].sets).toEqual([`${MONTHS_PREFIX}${target.date.slice(0, 7)}`]);
        expect(fake.commits[0].updates).toEqual([MAIN_PATH]);
        expect(fake.commits[0].deletes).toEqual([]);

        fake.commits.length = 0;
        const emptiedMonth = target.date.slice(0, 7);
        setLocalState(edited.filter((tx) => !tx.date.startsWith(emptiedMonth)));
        await sync.pushWorkspaceToFirestore(user);
        expect(fake.commits[0].sets).toEqual([]);
        expect(fake.commits[0].deletes).toEqual([`${MONTHS_PREFIX}${emptiedMonth}`]);
        expect(monthDocPaths()).toHaveLength(11);
    });

    it('ancien format (transactions dans le document principal) : lu tel quel puis migré à la prochaine écriture', async () => {
        const legacy = buildTransactions(80, 4);
        const legacyPayload = sync.extractSanitizedWorkspacePayload({
            ...store.getState(),
            config: { ...store.getState().config, users: [{ ...store.getState().config.users[0], name: 'Camille' }] },
            transactions: legacy,
        } as never);
        fake.docs.set(MAIN_PATH, {
            ownerId: UID,
            schemaVersion: 1,
            revisionId: 'rev_ancien_format',
            statePayload: { _packedFormat: 'json_v1', jsonChunks: [JSON.stringify(legacyPayload)] },
            createdAt: { seconds: 1 },
            updatedAt: { seconds: 2 },
        });

        const pulled = await sync.pullWorkspaceFromFirestoreNow(user);
        expect(pulled.restored).toBe(true);
        expect(store.getState().transactions).toEqual(legacy);
        expect(monthDocPaths()).toHaveLength(0);

        await sync.pushWorkspaceToFirestore(user);
        expect(monthDocPaths()).toHaveLength(4);
        expect(cloudTransactionCount()).toBe(80);
        expect(mainStatePayload().transactionsSharded).toBe(true);
        expect(sync.unpackWorkspacePayloadFromFirestore(mainStatePayload())?.transactions).toEqual([]);

        vi.resetModules();
        sync = await import('../../services/firebase/workspaceSync');
        store = (await import('../../store/useFinanceStore')).useFinanceStore;
        store.setState({ transactions: [] } as never);
        await sync.pullWorkspaceFromFirestoreNow(user);
        expect(store.getState().transactions).toEqual(legacy);
    });

    it('un appareil local plus pauvre n’écrase jamais l’historique Cloud plus riche', async () => {
        const rich = buildTransactions(1800, 18);
        setLocalState(rich);
        await sync.pushWorkspaceToFirestore(user);
        const cloudBefore = new Map(monthDocPaths().map((p) => [p, JSON.stringify(fake.docs.get(p))]));
        const revisionBefore = fake.docs.get(MAIN_PATH)?.revisionId;

        // Nouvel appareil qui ne connaît que les 100 opérations les plus récentes.
        vi.resetModules();
        sync = await import('../../services/firebase/workspaceSync');
        store = (await import('../../store/useFinanceStore')).useFinanceStore;
        setLocalState(rich.slice(0, 100));
        fake.commits.length = 0;

        await sync.pushWorkspaceToFirestore(user);

        expect(fake.commits).toHaveLength(0);
        expect(fake.docs.get(MAIN_PATH)?.revisionId).toBe(revisionBefore);
        expect(new Map(monthDocPaths().map((p) => [p, JSON.stringify(fake.docs.get(p))]))).toEqual(cloudBefore);
        // Le local récupère l'historique complet du Cloud.
        expect(store.getState().transactions).toHaveLength(1800);
    });

    it('écouteur temps réel : un nouveau revisionId recharge les mois et applique l’historique complet', async () => {
        const remote = buildTransactions(300, 6);
        setLocalState(remote);
        await sync.pushWorkspaceToFirestore(user);

        vi.resetModules();
        sync = await import('../../services/firebase/workspaceSync');
        store = (await import('../../store/useFinanceStore')).useFinanceStore;
        store.setState({ transactions: [] } as never);

        const stop = sync.startWorkspaceRealtimeSync(user);
        await vi.waitFor(() => {
            expect(store.getState().transactions).toHaveLength(300);
        });
        expect(store.getState().transactions).toEqual(remote);
        expect(sync.getFirebaseSyncStatus().initialSyncSettled).toBe(true);
        stop();
    });

    it('voie rapide même révision : passe initialSyncSettled à true sans réécraser le store local et charge les empreintes en fond', async () => {
        const original = buildTransactions(24, 3);
        setLocalState(original);
        await sync.pushWorkspaceToFirestore(user);
        expect(sync.getFirebaseSyncStatus().initialSyncSettled).toBe(false);

        const setAppStateSpy = vi.spyOn(store.getState(), 'setAppState');
        fake.commits.length = 0;

        const stop = sync.startWorkspaceRealtimeSync(user);
        await vi.waitFor(() => {
            expect(sync.getFirebaseSyncStatus().initialSyncSettled).toBe(true);
        });
        expect(setAppStateSpy).not.toHaveBeenCalled();
        expect(store.getState().transactions).toEqual(original);
        expect(sync.hasFirestoreSyncedThisSession()).toBe(true);
        stop();
    });

    it('conflit hors ligne : crée une sauvegarde locale, émet conflictAlert et restaure les saisies locales sur demande', async () => {
        const baseTx = buildTransactions(8, 2);
        setLocalState(baseTx);
        await sync.pushWorkspaceToFirestore(user);

        // Appareil B pousse une révision plus récente pendant qu'appareil A est hors ligne.
        vi.resetModules();
        const syncB = await import('../../services/firebase/workspaceSync');
        const storeB = (await import('../../store/useFinanceStore')).useFinanceStore;
        const remoteTx = buildTransactions(12, 3);
        const cfgB = storeB.getState().config;
        storeB.setState({
            config: {
                ...cfgB,
                users: [{ ...(cfgB.users?.[0] ?? {}), name: 'Camille B' }, ...(cfgB.users ?? []).slice(1)],
            },
            transactions: remoteTx as never,
            lastUpdate: Date.now() + 10_000,
        } as never);
        await syncB.pushWorkspaceToFirestore(user);
        const mainDoc = fake.docs.get(MAIN_PATH) as Record<string, unknown>;
        mainDoc.updatedAt = { seconds: Math.floor((Date.now() + 20_000) / 1000) };

        // Appareil A avait des saisies locales plus anciennes que le serveur mais non synchronisées.
        vi.resetModules();
        sync = await import('../../services/firebase/workspaceSync');
        store = (await import('../../store/useFinanceStore')).useFinanceStore;
        const localOfflineTx = buildTransactions(15, 2);
        localStorage.setItem(`financeai:last_synced_revision:v1:${UID}`, 'rev_ancienne_appareil_a');
        localStorage.setItem(`financeai:dirty_since_sync:v1:${UID}`, String(Date.now() - 5_000));
        setLocalState(localOfflineTx);

        const stop = sync.startWorkspaceRealtimeSync(user);
        await vi.waitFor(() => {
            expect(sync.getFirebaseSyncStatus().conflictAlert?.backupSaved).toBe(true);
        });
        expect(store.getState().transactions).toHaveLength(12);

        const restored = await sync.resolveSyncConflict('restore_local_backup');
        expect(restored).toBe(true);
        expect(sync.getFirebaseSyncStatus().conflictAlert).toBeNull();
        expect(store.getState().transactions).toHaveLength(15);
        stop();
    });

    it('rejette un instantané Cloud dont les types sont corrompus via verifierTypesRestaures', async () => {
        const localTx = buildTransactions(10, 2);
        setLocalState(localTx);
        await sync.pushWorkspaceToFirestore(user);

        // Corrompt netSalary (attendu nombre, reçu string non autorisée) dans le Cloud
        const corruptedDoc = fake.docs.get(MAIN_PATH) as { statePayload: { jsonChunks: string[] } };
        const unpacked = JSON.parse(corruptedDoc.statePayload.jsonChunks.join('')) as Record<string, unknown>;
        (unpacked.config as { users: Array<Record<string, unknown>> }).users[0].netSalary = 'INVALIDE_TEXTE';
        corruptedDoc.statePayload.jsonChunks = [JSON.stringify(unpacked)];

        vi.resetModules();
        sync = await import('../../services/firebase/workspaceSync');
        store = (await import('../../store/useFinanceStore')).useFinanceStore;
        setLocalState(localTx);

        const pulled = await sync.pullWorkspaceFromFirestoreNow(user);
        expect(pulled.restored).toBe(false);
        expect(sync.getFirebaseSyncStatus().state).toBe('error');
        expect(store.getState().transactions).toHaveLength(10);
    });
});

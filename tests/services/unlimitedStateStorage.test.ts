/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    unlimitedStateStorage,
    getLatestPersistedStateJson,
    readFullStateFromIdb,
    isLocalMirrorCompacted,
    isLocalMirrorBalanceTruncated,
    markIdbBootHydrationComplete,
    LOCAL_MIRROR_SOFT_LIMIT_CHARS,
    PROTECTED_DOSSIER_IDB_KEY,
    OVERFLOW_FLAG_KEY,
    PARTIAL_MIRROR_FLAG_KEY,
    _resetUnlimitedStateStorageForTests,
} from '../../services/unlimitedStateStorage';
import { QUOTA_EXCEEDED_EVENT } from '../../services/quotaStorage';
import { verifierTypesRestaures } from '../../services/verifierTypesRestaures';
import { STORAGE_KEYS } from '../../utils/storageKeys';

const waitForIdbFlush = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    _resetUnlimitedStateStorageForTests();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('unlimitedStateStorage — stockage IndexedDB illimité sans QuotaExceededError', () => {
    it('comportement nominal sous le seuil : écriture synchrone identique dans localStorage + IndexedDB', async () => {
        const payload = JSON.stringify({
            version: 7,
            state: { transactions: [{ id: 1, date: '2026-11-01', payee: 'Épicerie', amount: -55.2, category: 'Alimentation', status: 'processed' }] },
        });
        unlimitedStateStorage.setItem(STORAGE_KEYS.persistStore, payload);
        expect(unlimitedStateStorage.getItem(STORAGE_KEYS.persistStore)).toBe(payload);
        expect(localStorage.getItem(STORAGE_KEYS.persistStore)).toBe(payload);
        expect(isLocalMirrorCompacted()).toBe(false);

        await waitForIdbFlush();
        const fromIdb = await readFullStateFromIdb(STORAGE_KEYS.persistStore);
        expect(fromIdb).toBe(payload);
    });

    it('débordement avec 5 000 transactions : aucune exception, aucun QUOTA_EXCEEDED_EVENT, 100 % des transactions préservées en IDB et purge de l’ancien doublon localStorage', async () => {
        localStorage.setItem(PROTECTED_DOSSIER_IDB_KEY, '{"old":true}');

        const txList = Array.from({ length: 5000 }, (_, i) => ({
            id: i + 1,
            date: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
            payee: `COMMERCE_${i}_TRANSACTIONS_LONG_LIBELLE_SYNTHETIQUE_VALIDE_POUR_TEST_STOCKAGE_${'X'.repeat(240)}`,
            amount: -((i % 150) + 1.25),
            category: 'Alimentation',
            status: 'processed',
            accountName: 'Visa Test',
        }));

        const priceHistory = Array.from({ length: 1200 }, (_, i) => ({
            date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
            price: 100 + i * 0.1,
        }));

        const bigEnvelope = JSON.stringify({
            version: 7,
            state: {
                transactions: txList,
                assets: [{ id: 'a1', symbol: 'XEQT.TO', name: 'XEQT', quantity: 100, buyPrice: 30, currentPrice: 34, currency: 'CAD', priceHistory }],
                fintableBrokerHistory: [{ at: 1, totalCad: 1000 }],
                realDataSnapshot: { transactions: txList.slice(0, 500) },
            },
        });
        expect(bigEnvelope.length).toBeGreaterThan(LOCAL_MIRROR_SOFT_LIMIT_CHARS);

        const quotaListener = vi.fn();
        window.addEventListener(QUOTA_EXCEEDED_EVENT, quotaListener);

        expect(() => unlimitedStateStorage.setItem(STORAGE_KEYS.persistStore, bigEnvelope)).not.toThrow();
        expect(quotaListener).not.toHaveBeenCalled();
        window.removeEventListener(QUOTA_EXCEEDED_EVENT, quotaListener);

        // L'ancien doublon localStorage a bien été purgé
        expect(localStorage.getItem(PROTECTED_DOSSIER_IDB_KEY)).toBeNull();
        expect(isLocalMirrorCompacted()).toBe(true);
        expect(isLocalMirrorBalanceTruncated()).toBe(true);
        expect(localStorage.getItem(OVERFLOW_FLAG_KEY)).toBe('1');
        expect(localStorage.getItem(PARTIAL_MIRROR_FLAG_KEY)).toBe('1');

        // Lecture synchrone complète (5 000 transactions intactes)
        const syncFull = JSON.parse(getLatestPersistedStateJson(STORAGE_KEYS.persistStore) as string);
        expect(syncFull.state.transactions).toHaveLength(5000);

        // Miroir localStorage allégé et valide pour verifierTypesRestaures
        const lsMirrorRaw = localStorage.getItem(STORAGE_KEYS.persistStore);
        expect(lsMirrorRaw).toBeTruthy();
        expect((lsMirrorRaw as string).length).toBeLessThan(bigEnvelope.length);
        const lsMirror = JSON.parse(lsMirrorRaw as string);
        expect(verifierTypesRestaures(lsMirror.state)).toEqual([]);

        // Vérification de la persistance complète asynchrone dans IndexedDB
        await waitForIdbFlush();
        _resetUnlimitedStateStorageForTests();
        const idbRaw = await readFullStateFromIdb(STORAGE_KEYS.persistStore);
        expect(idbRaw).toBeTruthy();
        const idbParsed = JSON.parse(idbRaw as string);
        expect(idbParsed.state.transactions).toHaveLength(5000);
        expect(idbParsed.state.assets[0].priceHistory).toHaveLength(1200);
    });

    it('intercepte QuotaExceededError de localStorage (même sous saturation totale) sans relancer ni bloquer l’application', async () => {
        const sample = JSON.stringify({
            version: 7,
            state: { transactions: [{ id: 77, date: '2026-11-10', payee: 'Achat Carte', amount: -42.5, category: 'Loisirs', status: 'processed' }] },
        });
        const quotaErr = new DOMException('QuotaExceededError', 'QuotaExceededError');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw quotaErr;
        });

        const quotaListener = vi.fn();
        window.addEventListener(QUOTA_EXCEEDED_EVENT, quotaListener);

        expect(() => unlimitedStateStorage.setItem(STORAGE_KEYS.persistStore, sample)).not.toThrow();
        expect(quotaListener).not.toHaveBeenCalled();
        window.removeEventListener(QUOTA_EXCEEDED_EVENT, quotaListener);

        expect(unlimitedStateStorage.getItem(STORAGE_KEYS.persistStore)).toBe(sample);
        await waitForIdbFlush();
        _resetUnlimitedStateStorageForTests();
        vi.restoreAllMocks();
        const recovered = await readFullStateFromIdb(STORAGE_KEYS.persistStore);
        expect(recovered).toBe(sample);
    });

    it('quota dépassé sur financeai-storage mais métadonnée autorisée : active isLocalMirrorBalanceTruncated()', async () => {
        const sample = JSON.stringify({
            version: 7,
            state: { transactions: [{ id: 88, date: '2026-11-12', payee: 'Achat Test', amount: -25, category: 'Alimentation', status: 'processed' }] },
        });
        const quotaErr = new DOMException('QuotaExceededError', 'QuotaExceededError');
        const origSetItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
            if (k === STORAGE_KEYS.persistStore) {
                throw quotaErr;
            }
            return origSetItem.call(this, k, v);
        });

        unlimitedStateStorage.setItem(STORAGE_KEYS.persistStore, sample);
        expect(isLocalMirrorCompacted()).toBe(true);
        expect(isLocalMirrorBalanceTruncated()).toBe(true);
        expect(localStorage.getItem(PARTIAL_MIRROR_FLAG_KEY)).toBe('1');

        await waitForIdbFlush();
        _resetUnlimitedStateStorageForTests();
        vi.restoreAllMocks();
        const recovered = await readFullStateFromIdb(STORAGE_KEYS.persistStore);
        expect(recovered).toBe(sample);
    });

    it('compaction avec gros documents + historiques + 2 000 transactions normales : conserve 100 % des transactions dans localStorage (soldes intacts)', async () => {
        const normalTxs = Array.from({ length: 2000 }, (_, i) => ({
            id: i + 1,
            date: '2026-08-15',
            payee: `Commerce_${i}`,
            amount: -12.5,
            category: 'Alimentation',
            status: 'processed',
        }));
        const hugeDocs = Array.from({ length: 12 }, (_, i) => ({
            id: `doc-${i}`,
            name: `releve-${i}.pdf`,
            content: 'A'.repeat(160_000),
        }));
        const priceHistory = Array.from({ length: 1500 }, (_, i) => ({
            date: `2024-02-${String((i % 28) + 1).padStart(2, '0')}`,
            price: 50 + i * 0.05,
        }));
        const bigEnvelope = JSON.stringify({
            version: 7,
            state: {
                transactions: normalTxs,
                documents: hugeDocs,
                assets: [{ symbol: 'XEQT.TO', name: 'XEQT', quantity: 100, buyPrice: 30, currentPrice: 34, currency: 'CAD', priceHistory }],
            },
        });
        expect(bigEnvelope.length).toBeGreaterThan(LOCAL_MIRROR_SOFT_LIMIT_CHARS);

        unlimitedStateStorage.setItem(STORAGE_KEYS.persistStore, bigEnvelope);

        expect(isLocalMirrorCompacted()).toBe(true);
        expect(isLocalMirrorBalanceTruncated()).toBe(false);
        expect(localStorage.getItem(PARTIAL_MIRROR_FLAG_KEY)).toBeNull();

        const lsMirror = JSON.parse(localStorage.getItem(STORAGE_KEYS.persistStore) as string);
        expect(lsMirror.state.transactions).toHaveLength(2000);
        expect(lsMirror.state.documents).toEqual([]);
        expect(lsMirror.state.assets[0].priceHistory).toEqual([]);

        await waitForIdbFlush();
        _resetUnlimitedStateStorageForTests();
        const idbFull = JSON.parse((await readFullStateFromIdb(STORAGE_KEYS.persistStore)) as string);
        expect(idbFull.state.transactions).toHaveLength(2000);
        expect(idbFull.state.documents).toHaveLength(12);
    });

    it('garde anti-écrasement au boot : bloque un setItem prématuré avant markIdbBootHydrationComplete', async () => {
        const txList = Array.from({ length: 5000 }, (_, i) => ({
            id: i + 1,
            date: '2026-09-01',
            payee: `COMMERCE_GUARD_${i}_${'Y'.repeat(240)}`,
            amount: -10,
            category: 'Alimentation',
            status: 'processed',
        }));
        const fullEnvelope = JSON.stringify({
            version: 7,
            state: { transactions: txList },
        });
        unlimitedStateStorage.setItem(STORAGE_KEYS.persistStore, fullEnvelope);
        await waitForIdbFlush();

        // Simule un redémarrage avant que l'async IDB n'ait restauré le cache mémoire
        _resetUnlimitedStateStorageForTests();
        const mirrorRead = unlimitedStateStorage.getItem(STORAGE_KEYS.persistStore);
        expect(mirrorRead).toBeTruthy();

        // Une écriture prématurée avec le miroir tronqué ne doit PAS écraser IndexedDB
        const truncatedEnvelope = JSON.stringify({
            version: 7,
            state: { transactions: txList.slice(-250) },
        });
        unlimitedStateStorage.setItem(STORAGE_KEYS.persistStore, truncatedEnvelope);
        await waitForIdbFlush();

        const stillFull = JSON.parse((await readFullStateFromIdb(STORAGE_KEYS.persistStore)) as string);
        expect(stillFull.state.transactions).toHaveLength(5000);

        // Une fois l'hydratation boot terminée, une écriture légitime est autorisée
        markIdbBootHydrationComplete();
        const updatedEnvelope = JSON.stringify({
            version: 7,
            state: { transactions: [...txList, { id: 99999, date: '2026-10-01', payee: 'Nouveau', amount: -5, category: 'Alimentation', status: 'processed' }] },
        });
        unlimitedStateStorage.setItem(STORAGE_KEYS.persistStore, updatedEnvelope);
        await waitForIdbFlush();
        _resetUnlimitedStateStorageForTests();
        const afterComplete = JSON.parse((await readFullStateFromIdb(STORAGE_KEYS.persistStore)) as string);
        expect(afterComplete.state.transactions).toHaveLength(5001);
    });
});

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
    LOCAL_MIRROR_SOFT_LIMIT_CHARS,
    PROTECTED_DOSSIER_IDB_KEY,
    OVERFLOW_FLAG_KEY,
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
        expect(localStorage.getItem(OVERFLOW_FLAG_KEY)).toBe('1');

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
});

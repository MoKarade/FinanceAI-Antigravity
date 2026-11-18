// services/unlimitedStateStorage.ts
//
// Stockage persistant ILLIMITÉ (IndexedDB + cache mémoire synchrone + miroir compact localStorage).
//
// Problème résolu : `localStorage` est plafonné à ~5 Mo par origine ; un historique riche de
// transactions, cours boursiers (`priceHistory`) et grand livre courtier (`brokerLedger`) déclenchait
// `QuotaExceededError`, bloquait la sauvegarde locale et affichait « Stockage plein ».
//
// Architecture :
//  1. Source synchrone mémoire (`_inMemoryStates`) + écriture complète sans troncature dans
//     IndexedDB (`financeai-unlimited-state`, capacité pratique > 50 Mo–Go selon le disque).
//  2. Miroir synchrone dans `localStorage` pour que Zustand puisse réhydrater immédiatement au boot
//     avant l'async : si le JSON dépasse `LOCAL_MIRROR_SOFT_LIMIT_CHARS` ou si `localStorage` lève
//     `QuotaExceededError`, seul le miroir `localStorage` est compacté (caches/historiques d'abord,
//     sans jamais ajouter de clé étrangère à `verifierTypesRestaures`), tandis que 100 % des
//     données sont conservées en mémoire et écrites dans IndexedDB — sans jamais relancer
//     `QuotaExceededError` ni bloquer l'enregistrement des transactions.
//  3. Contraintes : ZÉRO import de `store/` (frontière `storeCouplingBoundary.test.ts`).

import { STORAGE_KEYS } from '../utils/storageKeys';
import { logError } from './errorLogger';

export const IDB_DB_NAME = 'financeai-unlimited-state';
export const IDB_STORE_NAME = 'kv';
const IDB_VERSION = 1;
export const OVERFLOW_FLAG_KEY = 'financeai:idb_overflow:v1';
export const PROTECTED_DOSSIER_IDB_KEY = 'financeai:protected_dossier:v1';
export const LOCAL_MIRROR_SOFT_LIMIT_CHARS = 1_800_000;
const MIRROR_COMPACT_TARGET_CHARS = 1_400_000;

interface CachedEntry {
    full: string;
    mirror: string | null;
    mirrorOnlyInMemory: boolean;
}

const _inMemoryStates = new Map<string, CachedEntry>();
const _idbWriteQueues = new Map<string, Promise<void>>();
let _writeSeq = 0;

function safeLocalGet(key: string): string | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeLocalSet(key: string, value: string): boolean {
    try {
        if (typeof localStorage === 'undefined') return false;
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function safeLocalRemove(key: string): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(key);
        }
    } catch {
        /* best-effort */
    }
}

function isQuotaDomException(err: unknown): boolean {
    if (err instanceof DOMException) {
        return (
            err.name === 'QuotaExceededError' ||
            err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            err.code === 22
        );
    }
    if (err && typeof err === 'object' && 'name' in err) {
        const name = String((err as { name?: unknown }).name ?? '');
        return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
    }
    return false;
}

function openUnlimitedDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }
        const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
        req.onerror = () => reject(req.error ?? new Error('Ouverture IndexedDB échouée'));
        req.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                db.createObjectStore(IDB_STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
    });
}

async function performIdbWrite(key: string, value: string): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    let db: IDBDatabase | null = null;
    try {
        db = await openUnlimitedDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db!.transaction(IDB_STORE_NAME, 'readwrite');
            tx.objectStore(IDB_STORE_NAME).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Écriture IndexedDB échouée'));
            tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB annulée'));
        });
    } catch (err) {
        logError({
            source: 'storage',
            severity: 'warning',
            message: `unlimitedStateStorage: écriture IndexedDB échouée pour « ${key} » (état conservé en mémoire)`,
            error: err instanceof Error ? err : new Error(String(err)),
        });
    } finally {
        db?.close();
    }
}

export function writeIdbEntry(key: string, value: string): Promise<void> {
    _writeSeq += 1;
    const prev = _idbWriteQueues.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => performIdbWrite(key, value));
    _idbWriteQueues.set(key, next);
    return next;
}

export async function readIdbEntry(key: string): Promise<string | null> {
    if (typeof indexedDB === 'undefined') return null;
    let db: IDBDatabase | null = null;
    try {
        db = await openUnlimitedDb();
        return await new Promise<string | null>((resolve, reject) => {
            const tx = db!.transaction(IDB_STORE_NAME, 'readonly');
            const req = tx.objectStore(IDB_STORE_NAME).get(key);
            req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
            req.onerror = () => reject(req.error ?? new Error('Lecture IndexedDB échouée'));
        });
    } catch {
        return null;
    } finally {
        db?.close();
    }
}

async function performIdbDelete(key: string): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    let db: IDBDatabase | null = null;
    try {
        db = await openUnlimitedDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db!.transaction(IDB_STORE_NAME, 'readwrite');
            tx.objectStore(IDB_STORE_NAME).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Suppression IndexedDB échouée'));
        });
    } catch {
        /* best-effort */
    } finally {
        db?.close();
    }
}

export function deleteIdbEntry(key: string): Promise<void> {
    _writeSeq += 1;
    const prev = _idbWriteQueues.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => performIdbDelete(key));
    _idbWriteQueues.set(key, next);
    return next;
}

export async function clearIdbEntries(): Promise<void> {
    _writeSeq += 1;
    if (typeof indexedDB === 'undefined') return;
    let db: IDBDatabase | null = null;
    try {
        db = await openUnlimitedDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db!.transaction(IDB_STORE_NAME, 'readwrite');
            tx.objectStore(IDB_STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Vidage IndexedDB échoué'));
        });
    } catch {
        /* best-effort */
    } finally {
        db?.close();
    }
}

/**
 * Construit un miroir allégé pour `localStorage` lorsque le JSON complet dépasse le quota.
 * Ne crée AUCUNE nouvelle clé dans `state` afin de rester 100 % compatible avec `verifierTypesRestaures`.
 * L'intégralité des données (historiques complets + 100 % des transactions) reste en mémoire et dans IndexedDB.
 */
export function buildCompactLocalMirror(rawEnvelopeJson: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawEnvelopeJson);
    } catch {
        return rawEnvelopeJson;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return rawEnvelopeJson;
    }
    const env = parsed as Record<string, unknown>;
    const rawState = env.state;
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
        return rawEnvelopeJson;
    }

    const compactState: Record<string, unknown> = { ...(rawState as Record<string, unknown>) };

    // 1. Caches & historiques volumineux reproductibles
    if ('realDataSnapshot' in compactState) {
        compactState.realDataSnapshot = null;
    }
    if (Array.isArray(compactState.fintableBrokerHistory)) {
        compactState.fintableBrokerHistory = [];
    }
    if (Array.isArray(compactState.assets)) {
        compactState.assets = compactState.assets.map((asset) => {
            if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return asset;
            const rec = { ...(asset as Record<string, unknown>) };
            if (Array.isArray(rec.priceHistory)) rec.priceHistory = [];
            if (Array.isArray(rec.history)) rec.history = [];
            return rec;
        });
    }
    if (Array.isArray(compactState.aiConversation) && compactState.aiConversation.length > 20) {
        compactState.aiConversation = compactState.aiConversation.slice(-20);
    }
    if (Array.isArray(compactState.aiConversations)) {
        compactState.aiConversations = compactState.aiConversations.map((conv) => {
            if (!conv || typeof conv !== 'object' || Array.isArray(conv)) return conv;
            const rec = { ...(conv as Record<string, unknown>) };
            if (Array.isArray(rec.messages) && rec.messages.length > 20) {
                rec.messages = rec.messages.slice(-20);
            }
            return rec;
        });
    }

    let serialized = JSON.stringify({ ...env, state: compactState });
    if (serialized.length <= MIRROR_COMPACT_TARGET_CHARS) {
        return serialized;
    }

    // 2. Si le volume de transactions dépasse encore le miroir synchrone, on garde les plus récentes dans le miroir seul
    if (Array.isArray(compactState.transactions) && compactState.transactions.length > 1500) {
        compactState.transactions = compactState.transactions.slice(-1500);
    }
    if (Array.isArray(compactState.brokerLedger) && compactState.brokerLedger.length > 1000) {
        compactState.brokerLedger = compactState.brokerLedger.slice(-1000);
    }
    if (Array.isArray(compactState.lockedProjectionCurve)) {
        compactState.lockedProjectionCurve = [];
    }
    serialized = JSON.stringify({ ...env, state: compactState });
    if (serialized.length <= MIRROR_COMPACT_TARGET_CHARS) {
        return serialized;
    }

    // 3. Dernier repli pour le miroir localStorage si très gros volume de documents/transactions
    if (Array.isArray(compactState.transactions) && compactState.transactions.length > 250) {
        compactState.transactions = compactState.transactions.slice(-250);
    }
    if (Array.isArray(compactState.brokerLedger) && compactState.brokerLedger.length > 250) {
        compactState.brokerLedger = compactState.brokerLedger.slice(-250);
    }
    if (Array.isArray(compactState.documents) && compactState.documents.length > 20) {
        compactState.documents = compactState.documents.slice(-20);
    }
    serialized = JSON.stringify({ ...env, state: compactState });
    return serialized;
}

export function isLocalMirrorCompacted(): boolean {
    return safeLocalGet(OVERFLOW_FLAG_KEY) === '1';
}

export function getLatestPersistedStateJson(key: string = STORAGE_KEYS.persistStore): string | null {
    const cached = _inMemoryStates.get(key);
    const lsValue = safeLocalGet(key);
    if (cached) {
        // Si un test ou du code externe a modifié/vidé `localStorage` directement, on suit la vérité de `localStorage`.
        if (!cached.mirrorOnlyInMemory && lsValue !== cached.mirror) {
            _inMemoryStates.delete(key);
            return lsValue;
        }
        return cached.full;
    }
    return lsValue;
}

export async function readFullStateFromIdb(key: string = STORAGE_KEYS.persistStore): Promise<string | null> {
    const seqAtStart = _writeSeq;
    await (_idbWriteQueues.get(key) ?? Promise.resolve());
    const idbValue = await readIdbEntry(key);
    if (_writeSeq !== seqAtStart) {
        return getLatestPersistedStateJson(key);
    }
    if (typeof idbValue === 'string' && idbValue.length > 0) {
        const lsValue = safeLocalGet(key);
        if (lsValue === null || isLocalMirrorCompacted() || idbValue.length >= lsValue.length) {
            _inMemoryStates.set(key, {
                full: idbValue,
                mirror: lsValue,
                mirrorOnlyInMemory: lsValue === null,
            });
        }
        return idbValue;
    }
    return null;
}

export const unlimitedStateStorage: Storage = {
    get length(): number {
        try {
            return typeof localStorage !== 'undefined' ? localStorage.length : _inMemoryStates.size;
        } catch {
            return _inMemoryStates.size;
        }
    },

    key(index: number): string | null {
        try {
            return typeof localStorage !== 'undefined' ? localStorage.key(index) : null;
        } catch {
            return null;
        }
    },

    getItem(key: string): string | null {
        return getLatestPersistedStateJson(key);
    },

    setItem(key: string, value: string): void {
        // Purge proactive de l'ancien doublon localStorage pour libérer de l'espace immédiatement.
        safeLocalRemove(PROTECTED_DOSSIER_IDB_KEY);

        // Persistance complète illimitée (asynchrone IndexedDB + synchrone mémoire).
        void writeIdbEntry(key, value);

        let lsFullSucceeded = false;
        if (value.length <= LOCAL_MIRROR_SOFT_LIMIT_CHARS && typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(key, value);
                lsFullSucceeded = true;
                safeLocalRemove(OVERFLOW_FLAG_KEY);
                _inMemoryStates.delete(key);
            } catch (err) {
                if (!isQuotaDomException(err)) {
                    throw err;
                }
            }
        }

        if (lsFullSucceeded) return;

        // Débordement au-delà du quota localStorage : on écrit un miroir compact dans localStorage
        // tout en conservant 100 % des données dans IndexedDB et en mémoire.
        const compact = buildCompactLocalMirror(value);
        let compactWritten = false;
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(key, compact);
                compactWritten = true;
                safeLocalSet(OVERFLOW_FLAG_KEY, '1');
            } catch (err) {
                if (isQuotaDomException(err)) {
                    logError({
                        source: 'storage',
                        severity: 'warning',
                        message: `unlimitedStateStorage: miroir localStorage saturé pour « ${key} » — état complet sauvegardé dans IndexedDB`,
                    });
                } else {
                    logError({
                        source: 'storage',
                        severity: 'warning',
                        message: `unlimitedStateStorage: écriture localStorage impossible pour « ${key} » — état complet sauvegardé dans IndexedDB`,
                        error: err instanceof Error ? err : new Error(String(err)),
                    });
                }
            }
        }

        _inMemoryStates.set(key, {
            full: value,
            mirror: compactWritten ? compact : null,
            mirrorOnlyInMemory: !compactWritten,
        });
    },

    removeItem(key: string): void {
        _inMemoryStates.delete(key);
        safeLocalRemove(key);
        if (key === STORAGE_KEYS.persistStore) {
            safeLocalRemove(OVERFLOW_FLAG_KEY);
        }
        void deleteIdbEntry(key);
    },

    clear(): void {
        _inMemoryStates.clear();
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.clear();
            }
        } catch {
            /* best-effort */
        }
        void clearIdbEntries();
    },
};

/** Réservé aux tests : vide le cache mémoire et la file IndexedDB en mémoire. */
export function _resetUnlimitedStateStorageForTests(): void {
    _inMemoryStates.clear();
    _idbWriteQueues.clear();
    _writeSeq = 0;
}

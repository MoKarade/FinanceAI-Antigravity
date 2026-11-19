// services/investments/committeeHistoryStore.ts
// Persistance IndexedDB chiffrée au repos (AES-256-GCM via device key) de l'historique
// des analyses multi-agents, strictement isolée entre dossier réel ('real') et mode test ('test:<id>').
// Zéro écriture dans localStorage.

import { decryptJson, encryptJson, getOrCreateDeviceKey } from '../secureKeyStore';
import { logError } from '../errorLogger';
import type { CommitteeAnalysisReport } from './multiAgentCommitteeTypes';

const DB_NAME = 'financeai-committee-history';
const STORE_NAME = 'analyses';
const DB_VERSION = 1;
export const MAX_COMMITTEE_HISTORY = 20;

export interface CommitteeStorageScope {
    isTestMode: boolean;
    personaId?: string | null;
}

interface StoredCommitteeRecord {
    scope: string;
    payload: string;
    encrypted: boolean;
    updatedAt: number;
}

export function committeeScopeKey(scope: CommitteeStorageScope): string {
    if (!scope.isTestMode) return 'real';
    return `test:${scope.personaId || 'default'}`;
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error ?? new Error('Ouverture IndexedDB échouée'));
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'scope' });
            }
        };
    });
}

async function tryGetDeviceKey(): Promise<CryptoKey | null> {
    try {
        return await getOrCreateDeviceKey();
    } catch {
        return null;
    }
}

function isValidReportShape(item: unknown): item is CommitteeAnalysisReport {
    if (!item || typeof item !== 'object') return false;
    const obj = item as Partial<CommitteeAnalysisReport>;
    return (
        typeof obj.id === 'string' &&
        obj.id.length > 0 &&
        typeof obj.createdAt === 'string' &&
        typeof obj.question === 'string' &&
        typeof obj.subject === 'string' &&
        typeof obj.verdict === 'string' &&
        typeof obj.executiveSummary === 'string' &&
        Array.isArray(obj.agents)
    );
}

let writeChain: Promise<unknown> = Promise.resolve();

function serializeWrite<T>(task: () => Promise<T>): Promise<T> {
    const next = writeChain.then(task, task);
    writeChain = next.then(
        () => undefined,
        () => undefined,
    );
    return next;
}

async function readScopeList(scopeKey: string): Promise<CommitteeAnalysisReport[]> {
    if (typeof indexedDB === 'undefined') return [];
    let db: IDBDatabase | null = null;
    try {
        db = await openDB();
        const record = await new Promise<StoredCommitteeRecord | undefined>((resolve, reject) => {
            const tx = db!.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(scopeKey);
            req.onsuccess = () => resolve(req.result as StoredCommitteeRecord | undefined);
            req.onerror = () => reject(req.error ?? new Error('Lecture IndexedDB échouée'));
        });
        if (!record || typeof record.payload !== 'string') return [];

        let parsed: unknown;
        if (record.encrypted) {
            const key = await tryGetDeviceKey();
            if (!key) return [];
            parsed = await decryptJson<unknown>(key, record.payload);
        } else {
            parsed = JSON.parse(record.payload) as unknown;
        }
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isValidReportShape).slice(0, MAX_COMMITTEE_HISTORY);
    } catch (e) {
        logError({
            source: 'storage',
            severity: 'warning',
            message: `Lecture de l'historique comité (${scopeKey}) impossible.`,
            error: e instanceof Error ? e : new Error(String(e)),
        });
        return [];
    } finally {
        db?.close();
    }
}

async function writeScopeList(scopeKey: string, list: CommitteeAnalysisReport[]): Promise<boolean> {
    if (typeof indexedDB === 'undefined') return false;
    const bounded = list.slice(0, MAX_COMMITTEE_HISTORY);
    let db: IDBDatabase | null = null;
    try {
        const key = await tryGetDeviceKey();
        const payload = key ? await encryptJson(key, bounded) : JSON.stringify(bounded);
        const rec: StoredCommitteeRecord = {
            scope: scopeKey,
            payload,
            encrypted: Boolean(key),
            updatedAt: Date.now(),
        };
        db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db!.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(rec);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Écriture IndexedDB échouée'));
            tx.onabort = () => reject(tx.error ?? new Error('Écriture IndexedDB annulée'));
        });
        return true;
    } catch (e) {
        logError({
            source: 'storage',
            severity: 'warning',
            message: `Sauvegarde de l'historique comité (${scopeKey}) échouée.`,
            error: e instanceof Error ? e : new Error(String(e)),
        });
        return false;
    } finally {
        db?.close();
    }
}

export async function loadCommitteeHistory(
    scope: CommitteeStorageScope,
): Promise<CommitteeAnalysisReport[]> {
    return readScopeList(committeeScopeKey(scope));
}

export async function saveCommitteeAnalysis(
    scope: CommitteeStorageScope,
    report: CommitteeAnalysisReport,
): Promise<CommitteeAnalysisReport[]> {
    const key = committeeScopeKey(scope);
    return serializeWrite(async () => {
        const existing = await readScopeList(key);
        const next = [report, ...existing.filter((r) => r.id !== report.id)].slice(
            0,
            MAX_COMMITTEE_HISTORY,
        );
        await writeScopeList(key, next);
        return next;
    });
}

export async function deleteCommitteeAnalysis(
    scope: CommitteeStorageScope,
    id: string,
): Promise<CommitteeAnalysisReport[]> {
    const key = committeeScopeKey(scope);
    return serializeWrite(async () => {
        const existing = await readScopeList(key);
        const next = existing.filter((r) => r.id !== id);
        await writeScopeList(key, next);
        return next;
    });
}

export async function clearCommitteeHistory(scope: CommitteeStorageScope): Promise<void> {
    const key = committeeScopeKey(scope);
    await serializeWrite(async () => {
        if (typeof indexedDB === 'undefined') return;
        let db: IDBDatabase | null = null;
        try {
            db = await openDB();
            await new Promise<void>((resolve, reject) => {
                const tx = db!.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error('Suppression IndexedDB échouée'));
            });
        } catch (e) {
            logError({
                source: 'storage',
                severity: 'warning',
                message: `Effacement historique comité (${key}) échoué.`,
                error: e instanceof Error ? e : new Error(String(e)),
            });
        } finally {
            db?.close();
        }
    });
}

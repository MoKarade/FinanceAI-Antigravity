// services/grandCalculStore.ts
// Persistance IndexedDB (chiffrée AES-256-GCM au repos) du dernier « Grand Calcul ».
//
// Base dédiée (`financeai-grand-calcul`) et zéro import vers `store/` :
//   - Évite tout gonflement de `localStorage` et toute collision avec `financeai-storage` (v7).
//   - Isole les données réelles du mode test via l'option `{ isTestMode }` (`'current'` vs `'test'`).
//   - Toutes les opérations sont best-effort et ne lèvent jamais d'exception non attrapée.

import type { GrandCalculResult, GoalProbabilityResult } from './projection/types';
import { getOrCreateDeviceKey, encryptJson, decryptJson } from './secureKeyStore';
import { logError } from './errorLogger';

export { computeGrandCalculParamsSig } from './projection/runAsync';

const DB_NAME = 'financeai-grand-calcul';
const STORE_NAME = 'results';
const DB_VERSION = 1;
const REAL_RECORD_ID = 'current';
const TEST_RECORD_ID = 'test';

const VALID_GOAL_STATUSES: ReadonlySet<GoalProbabilityResult['status']> = new Set([
    'evaluated',
    'already_completed',
    'beyond_horizon',
    'invalid_deadline',
]);

// Avertit au maximum une fois par session en cas de repli en clair (WebCrypto indisponible).
let _cleartextWarned = false;

// File d'attente séquentielle pour garantir l'ordre des écritures et effacements concurrents.
let _writeChain: Promise<void> = Promise.resolve();

export type LoadGrandCalculResult =
    | { status: 'ok'; result: GrandCalculResult }
    | { status: 'empty' }
    | { status: 'unreadable' };

export interface GrandCalculStorageOptions {
    isTestMode?: boolean;
}

interface GrandCalculRecord {
    id: string;
    payload: string;
    encrypted: boolean;
    timestamp: number;
}

function resolveRecordId(opts?: GrandCalculStorageOptions): string {
    return opts?.isTestMode ? TEST_RECORD_ID : REAL_RECORD_ID;
}

function enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
    const run = _writeChain.then(op, op);
    _writeChain = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
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
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

async function tryGetKey(): Promise<CryptoKey | null> {
    try {
        return await getOrCreateDeviceKey();
    } catch (e) {
        if (!_cleartextWarned) {
            _cleartextWarned = true;
            logError({
                source: 'storage',
                severity: 'warning',
                message: 'Crypto/IndexedDB indisponible : le Grand Calcul est stocké EN CLAIR.',
                error: e instanceof Error ? e : new Error(String(e)),
            });
        }
        return null;
    }
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function isFiniteNum(val: unknown): val is number {
    return typeof val === 'number' && Number.isFinite(val);
}

function isNonNegFinite(val: unknown): val is number {
    return isFiniteNum(val) && val >= 0;
}

function isNullableFinite(val: unknown): val is number | null {
    return val === null || isFiniteNum(val);
}

function isValidGrandCalculResult(raw: unknown): raw is GrandCalculResult {
    if (!isPlainRecord(raw)) return false;
    if (raw.version !== 1) return false;
    if (typeof raw.paramsSig !== 'string' || raw.paramsSig.length === 0) return false;
    if (typeof raw.createdAt !== 'string' || raw.createdAt.length === 0) return false;
    if (!isNonNegFinite(raw.durationMs) || !isNonNegFinite(raw.iterationsRun)) return false;
    if (typeof raw.regimesEnabled !== 'boolean' || typeof raw.historicalCrisesEnabled !== 'boolean') return false;
    if (!isNullableFinite(raw.survivalRatePct) || !isNullableFinite(raw.cvar95)) return false;

    if (!Array.isArray(raw.monthlyBands)) return false;
    for (const band of raw.monthlyBands) {
        if (!isPlainRecord(band)) return false;
        if (
            !isFiniteNum(band.monthIndex)
            || !isFiniteNum(band.year)
            || !isFiniteNum(band.age)
            || !isFiniteNum(band.p5)
            || !isFiniteNum(band.p10)
            || !isFiniteNum(band.p25)
            || !isFiniteNum(band.p50)
            || !isFiniteNum(band.p75)
            || !isFiniteNum(band.p90)
            || !isFiniteNum(band.p95)
        ) {
            return false;
        }
    }

    if (!isPlainRecord(raw.fiAge)) return false;
    if (
        !isFiniteNum(raw.fiAge.horizonAge)
        || !isNullableFinite(raw.fiAge.reachedPct)
        || !isNullableFinite(raw.fiAge.p5Age)
        || !isNullableFinite(raw.fiAge.p50Age)
        || !isNullableFinite(raw.fiAge.p95Age)
    ) {
        return false;
    }

    if (!Array.isArray(raw.goalProbabilities)) return false;
    for (const goal of raw.goalProbabilities) {
        if (!isPlainRecord(goal)) return false;
        if (
            typeof goal.goalId !== 'string'
            || typeof goal.name !== 'string'
            || typeof goal.deadline !== 'string'
            || !isFiniteNum(goal.targetAmount)
            || !isNullableFinite(goal.probabilityPct)
            || !isNullableFinite(goal.medianShortfall)
            || typeof goal.status !== 'string'
            || !VALID_GOAL_STATUSES.has(goal.status as GoalProbabilityResult['status'])
        ) {
            return false;
        }
    }

    if (!isPlainRecord(raw.guaranteedPurchasingPower)) return false;
    if (
        !isNonNegFinite(raw.guaranteedPurchasingPower.retirementMonthsEvaluated)
        || !isNullableFinite(raw.guaranteedPurchasingPower.p95SecurityMonthlyNetReal)
        || !isNullableFinite(raw.guaranteedPurchasingPower.p90SecurityMonthlyNetReal)
        || !isNullableFinite(raw.guaranteedPurchasingPower.p50SecurityMonthlyNetReal)
    ) {
        return false;
    }

    if (!isPlainRecord(raw.estateTax)) return false;
    if (
        !isNullableFinite(raw.estateTax.deterministicTotal)
        || !isNullableFinite(raw.estateTax.deterministicFed)
        || !isNullableFinite(raw.estateTax.deterministicQc)
        || !isNullableFinite(raw.estateTax.mcTotalP5)
        || !isNullableFinite(raw.estateTax.mcTotalP50)
        || !isNullableFinite(raw.estateTax.mcTotalP95)
        || !isNullableFinite(raw.estateTax.mcFedP50)
        || !isNullableFinite(raw.estateTax.mcQcP50)
        || !isNullableFinite(raw.estateTax.mcRealTotalP50)
        || !isNullableFinite(raw.estateTax.projectedDeathAge)
    ) {
        return false;
    }

    if (!isPlainRecord(raw.estateTax.taxableBreakdown)) return false;
    if (
        !isNullableFinite(raw.estateTax.taxableBreakdown.rrspRrif)
        || !isNullableFinite(raw.estateTax.taxableBreakdown.capitalGainsTaxable)
        || !isNullableFinite(raw.estateTax.taxableBreakdown.rentalRecapture)
    ) {
        return false;
    }

    return true;
}

/**
 * Persiste le résultat du Grand Calcul dans IndexedDB (chiffré AES-256-GCM si WebCrypto est disponible,
 * sinon repli en clair journalisé une fois). Best-effort : ne lève jamais.
 */
export function saveGrandCalculResult(
    result: GrandCalculResult,
    opts?: GrandCalculStorageOptions,
): Promise<boolean> {
    const id = resolveRecordId(opts);
    return enqueueWrite(async () => {
        try {
            const key = await tryGetKey();
            const payload = key ? await encryptJson(key, result) : JSON.stringify(result);
            const rec: GrandCalculRecord = {
                id,
                payload,
                encrypted: Boolean(key),
                timestamp: Date.now(),
            };
            const db = await openDB();
            try {
                await new Promise<void>((resolve, reject) => {
                    const tx = db.transaction(STORE_NAME, 'readwrite');
                    tx.objectStore(STORE_NAME).put(rec);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error ?? new Error('Transaction écriture IndexedDB échouée'));
                    tx.onabort = () => reject(tx.error ?? new Error('Transaction écriture IndexedDB annulée'));
                });
            } finally {
                db.close();
            }
            return true;
        } catch (e) {
            logError({
                source: 'storage',
                severity: 'warning',
                message: `Échec de persistance du Grand Calcul « ${id} » (IndexedDB).`,
                error: e instanceof Error ? e : new Error(String(e)),
            });
            return false;
        }
    });
}

/**
 * Restaure le dernier résultat du Grand Calcul depuis IndexedDB avec statut discriminé :
 *  - `'ok'`         : résultat valide restauré (clair ou déchiffré).
 *  - `'empty'`      : aucun enregistrement ou erreur d'accès IndexedDB.
 *  - `'unreadable'` : enregistrement présent mais clé absente, blob altéré, JSON invalide ou schéma corrompu.
 */
export async function loadGrandCalculResult(
    opts?: GrandCalculStorageOptions,
): Promise<LoadGrandCalculResult> {
    const id = resolveRecordId(opts);
    let rec: unknown;
    try {
        const db = await openDB();
        try {
            rec = await new Promise<unknown>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).get(id);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error ?? new Error('Lecture IndexedDB échouée'));
            });
        } finally {
            db.close();
        }
    } catch (e) {
        logError({
            source: 'storage',
            severity: 'warning',
            message: `Échec d'accès au Grand Calcul « ${id} » (IndexedDB).`,
            error: e instanceof Error ? e : new Error(String(e)),
        });
        return { status: 'empty' };
    }

    if (rec === undefined || rec === null) {
        return { status: 'empty' };
    }

    if (
        !isPlainRecord(rec)
        || typeof rec.payload !== 'string'
        || typeof rec.encrypted !== 'boolean'
    ) {
        logError({
            source: 'storage',
            severity: 'warning',
            message: `Enregistrement Grand Calcul « ${id} » invalide dans IndexedDB.`,
        });
        return { status: 'unreadable' };
    }

    try {
        let parsed: unknown;
        if (!rec.encrypted) {
            parsed = JSON.parse(rec.payload);
        } else {
            const key = await tryGetKey();
            if (!key) {
                logError({
                    source: 'storage',
                    severity: 'warning',
                    message: `Grand Calcul « ${id} » chiffré mais clé de device absente : indéchiffrable.`,
                });
                return { status: 'unreadable' };
            }
            parsed = await decryptJson<unknown>(key, rec.payload);
        }

        if (!isValidGrandCalculResult(parsed)) {
            logError({
                source: 'storage',
                severity: 'warning',
                message: `Schéma Grand Calcul « ${id} » incompatible ou corrompu.`,
            });
            return { status: 'unreadable' };
        }
        return { status: 'ok', result: parsed };
    } catch (e) {
        logError({
            source: 'storage',
            severity: 'warning',
            message: `Grand Calcul « ${id} » présent mais indéchiffrable (blob altéré ou JSON invalide).`,
            error: e instanceof Error ? e : new Error(String(e)),
        });
        return { status: 'unreadable' };
    }
}

/**
 * Efface l'enregistrement du Grand Calcul dans IndexedDB. Best-effort : ne lève jamais.
 */
export function clearGrandCalculResult(opts?: GrandCalculStorageOptions): Promise<void> {
    const id = resolveRecordId(opts);
    return enqueueWrite(async () => {
        try {
            const db = await openDB();
            try {
                await new Promise<void>((resolve, reject) => {
                    const tx = db.transaction(STORE_NAME, 'readwrite');
                    tx.objectStore(STORE_NAME).delete(id);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error ?? new Error('Effacement IndexedDB échoué'));
                    tx.onabort = () => reject(tx.error ?? new Error('Effacement IndexedDB annulé'));
                });
            } finally {
                db.close();
            }
        } catch (e) {
            logError({
                source: 'storage',
                severity: 'warning',
                message: `Échec d'effacement du Grand Calcul « ${id} » (IndexedDB).`,
                error: e instanceof Error ? e : new Error(String(e)),
            });
        }
    });
}

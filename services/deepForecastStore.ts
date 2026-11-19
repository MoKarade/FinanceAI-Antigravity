// services/deepForecastStore.ts
// Persistance IndexedDB (chiffrée AES-256-GCM au repos) du rapport Futur 4.0 appliqué et mémorisé.
//
// Base dédiée (`financeai-deep-forecast`, store `applied_reports`, version 1) et zéro import vers `store/` :
//   - Aucune écriture dans `localStorage` et aucune collision avec `financeai-storage` (v7).
//   - Isolation stricte des clés par mode et persona (`'real'` vs `'test:' + (personaId || 'default')`).
//   - Toutes les opérations sont best-effort et ne lèvent jamais d'exception non attrapée.

import {
    DEEP_SCENARIO_IDS,
    type DeepConcreteAction,
    type DeepForecastReport,
    type DeepGoalMilestoneSummary,
    type DeepScenarioMilestones,
    type DeepScenarioOutput,
    type DeepScenarioPoint,
    type DeepTurningPoint,
    type DeepTurningPointKind,
    type DeepValoriaSummary,
    type MacroAndNewsSignalBundle,
    type MacroNewsSignalItem,
    type RealPastDiagnostic,
} from './projection/deepForecastTypes';
import { getOrCreateDeviceKey, encryptJson, decryptJson } from './secureKeyStore';
import { logError } from './errorLogger';

const DB_NAME = 'financeai-deep-forecast';
const STORE_NAME = 'applied_reports';
const DB_VERSION = 1;

const VALID_SIGNAL_DIRECTIONS: ReadonlySet<MacroNewsSignalItem['direction']> = new Set([
    'positif',
    'neutre',
    'risque',
]);

const VALID_GOAL_STATUSES: ReadonlySet<DeepGoalMilestoneSummary['status']> = new Set([
    'on_track',
    'at_risk',
    'achieved',
    'insufficient_data',
]);

const VALID_TURNING_POINT_KINDS: ReadonlySet<DeepTurningPointKind> = new Set([
    'past',
    'macro',
    'fiscal',
    'milestone',
    'risk',
    'optimization',
]);

// Avertit au maximum une fois par session en cas de repli en clair (WebCrypto indisponible).
let _cleartextWarned = false;

// File d'attente séquentielle pour garantir l'ordre des écritures et effacements concurrents.
let _writeChain: Promise<void> = Promise.resolve();

export interface DeepForecastStorageScope {
    isTestMode?: boolean;
    personaId?: string | null;
}

export type LoadDeepForecastResult =
    | { status: 'ok'; report: DeepForecastReport }
    | { status: 'empty' }
    | { status: 'unreadable' };

interface DeepForecastRecord {
    id: string;
    payload: string;
    encrypted: boolean;
    timestamp: number;
}

function resolveRecordId(scope?: DeepForecastStorageScope): string {
    if (!scope?.isTestMode) {
        return 'real';
    }
    return `test:${scope.personaId || 'default'}`;
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
                message: 'Crypto/IndexedDB indisponible : le rapport Futur 4.0 est stocké EN CLAIR.',
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

function isNullableString(val: unknown): val is string | null {
    return val === null || typeof val === 'string';
}

function isStringArray(val: unknown): val is string[] {
    return Array.isArray(val) && val.every((item) => typeof item === 'string');
}

function isValidPastDiagnostic(raw: unknown): raw is RealPastDiagnostic {
    if (!isPlainRecord(raw)) return false;
    return (
        isNonNegFinite(raw.transactionsAnalyzed)
        && isNonNegFinite(raw.monthsCovered)
        && isNullableString(raw.firstTransactionDate)
        && isNullableString(raw.lastTransactionDate)
        && isNullableFinite(raw.observedMonthlyIncomeCad)
        && isNullableFinite(raw.observedMonthlyExpensesCad)
        && isNullableFinite(raw.budgetedMonthlyExpensesCad)
        && isNullableFinite(raw.monthlySpendingGapCad)
        && isNullableFinite(raw.observedSavingsRatePct)
        && isNullableFinite(raw.lifestyleCreepAnnualPct)
        && isNullableFinite(raw.fixedExpensesSharePct)
        && isNullableFinite(raw.discretionarySharePct)
        && isNullableString(raw.peakSpendingMonthLabel)
        && isNullableString(raw.lowSpendingMonthLabel)
        && isNullableFinite(raw.weightedMerPct)
        && isNullableFinite(raw.estimatedAnnualFeeAndTaxDragCad)
        && isNullableFinite(raw.expenseVolatilityPct)
        && isStringArray(raw.findingsFr)
    );
}

function isValidNewsSignalItem(raw: unknown): raw is MacroNewsSignalItem {
    if (!isPlainRecord(raw)) return false;
    return (
        typeof raw.id === 'string'
        && typeof raw.title === 'string'
        && typeof raw.category === 'string'
        && typeof raw.impactLabel === 'string'
        && typeof raw.plainFrench === 'string'
        && typeof raw.direction === 'string'
        && VALID_SIGNAL_DIRECTIONS.has(raw.direction as MacroNewsSignalItem['direction'])
        && typeof raw.isLive === 'boolean'
    );
}

function isValidNewsBundle(raw: unknown): raw is MacroAndNewsSignalBundle {
    if (!isPlainRecord(raw)) return false;
    return (
        typeof raw.collectedAtIso === 'string'
        && raw.collectedAtIso.trim().length > 0
        && isNonNegFinite(raw.liveArticlesUsed)
        && typeof raw.offlineFallbackUsed === 'boolean'
        && isNullableFinite(raw.portfolioSentimentScore)
        && typeof raw.portfolioSentimentLabel === 'string'
        && isFiniteNum(raw.annualizedReturnAdjustmentPct)
        && isFiniteNum(raw.volatilityMultiplier)
        && typeof raw.macroHeadlineFr === 'string'
        && Array.isArray(raw.keySignals)
        && raw.keySignals.every(isValidNewsSignalItem)
        && isNullableString(raw.aiSynthesisFr)
        && typeof raw.usedGemini === 'boolean'
    );
}

function isValidValoriaSummary(raw: unknown): raw is DeepValoriaSummary | null {
    if (raw === null) return true;
    if (!isPlainRecord(raw)) return false;
    return (
        isNullableFinite(raw.consensus100)
        && typeof raw.consensusTitle === 'string'
        && isNonNegFinite(raw.evaluatedAssetsCount)
        && typeof raw.regimeName === 'string'
        && isNullableFinite(raw.shortTermRatePct)
        && isNullableFinite(raw.longTermRatePct)
    );
}

function isValidScenarioPoint(raw: unknown): raw is DeepScenarioPoint {
    if (!isPlainRecord(raw)) return false;
    const validMcRange =
        raw.mcRange === null
        || (Array.isArray(raw.mcRange)
            && raw.mcRange.length === 2
            && isFiniteNum(raw.mcRange[0])
            && isFiniteNum(raw.mcRange[1]));
    return (
        isFiniteNum(raw.monthIndex)
        && isFiniteNum(raw.year)
        && isFiniteNum(raw.age)
        && isFiniteNum(raw.netWorth)
        && isFiniteNum(raw.p10)
        && isFiniteNum(raw.p50)
        && isFiniteNum(raw.p90)
        && validMcRange
    );
}

function isValidGoalMilestone(raw: unknown): raw is DeepGoalMilestoneSummary {
    if (!isPlainRecord(raw)) return false;
    return (
        typeof raw.id === 'string'
        && typeof raw.name === 'string'
        && typeof raw.targetDate === 'string'
        && isNullableFinite(raw.probabilityPct)
        && typeof raw.status === 'string'
        && VALID_GOAL_STATUSES.has(raw.status as DeepGoalMilestoneSummary['status'])
    );
}

function isValidScenarioMilestones(raw: unknown): raw is DeepScenarioMilestones {
    if (!isPlainRecord(raw)) return false;
    return (
        isNullableFinite(raw.fiAge)
        && isNullableFinite(raw.fiProbabilityPct)
        && isNullableFinite(raw.sustainableMonthlyNetRetirementCad)
        && isNullableFinite(raw.sustainableMonthlyNetP90Cad)
        && Array.isArray(raw.goalsSummary)
        && raw.goalsSummary.every(isValidGoalMilestone)
        && isNullableFinite(raw.finalNetWorthP50)
        && isNullableFinite(raw.estateNetWorthP50)
        && isNullableFinite(raw.estateTaxP50)
        && isNullableFinite(raw.ruinProbabilityPct)
    );
}

function isValidTurningPoint(raw: unknown): raw is DeepTurningPoint {
    if (!isPlainRecord(raw)) return false;
    return (
        typeof raw.id === 'string'
        && isFiniteNum(raw.monthIndex)
        && isFiniteNum(raw.year)
        && isFiniteNum(raw.age)
        && typeof raw.title === 'string'
        && typeof raw.summaryFr === 'string'
        && isStringArray(raw.proofDetailsFr)
        && isNullableFinite(raw.impactCad)
        && typeof raw.kind === 'string'
        && VALID_TURNING_POINT_KINDS.has(raw.kind as DeepTurningPointKind)
    );
}

function isValidScenarioOutput(
    raw: unknown,
    expectedId: DeepScenarioOutput['id'],
): raw is DeepScenarioOutput {
    if (!isPlainRecord(raw)) return false;
    return (
        raw.id === expectedId
        && typeof raw.label === 'string'
        && typeof raw.shortDescription === 'string'
        && typeof raw.assumptionsSummaryFr === 'string'
        && Array.isArray(raw.points)
        && raw.points.every(isValidScenarioPoint)
        && isValidScenarioMilestones(raw.milestones)
        && Array.isArray(raw.turningPoints)
        && raw.turningPoints.every(isValidTurningPoint)
        && isStringArray(raw.appliedOptimizationsFr)
    );
}

function isValidConcreteAction(raw: unknown): raw is DeepConcreteAction {
    if (!isPlainRecord(raw)) return false;
    return (
        typeof raw.id === 'string'
        && typeof raw.title === 'string'
        && typeof raw.plainFrenchWhy === 'string'
        && isNullableFinite(raw.gainCad)
        && isNullableFinite(raw.freedomMonthsGained)
        && (raw.targetTab === undefined || typeof raw.targetTab === 'string')
        && (raw.appliesAiScenario === undefined || typeof raw.appliesAiScenario === 'boolean')
    );
}

/**
 * Validateur structurel strict d'un `DeepForecastReport` restauré depuis IndexedDB.
 */
export function isValidDeepForecastReport(raw: unknown): raw is DeepForecastReport {
    if (!isPlainRecord(raw)) return false;
    if (raw.version !== 1) return false;
    if (typeof raw.inputsSig !== 'string' || raw.inputsSig.trim().length === 0) return false;
    if (typeof raw.createdAt !== 'string' || raw.createdAt.trim().length === 0) return false;
    if (!isNonNegFinite(raw.durationMs) || !isNonNegFinite(raw.trajectoriesRun)) return false;
    if (typeof raw.isDeepRun !== 'boolean') return false;
    if (!isValidPastDiagnostic(raw.pastDiagnostic)) return false;
    if (!isValidNewsBundle(raw.newsBundle)) return false;
    if (!isValidValoriaSummary(raw.valoriaSummary)) return false;

    if (!isPlainRecord(raw.scenarios)) return false;
    for (const scenarioId of DEEP_SCENARIO_IDS) {
        if (!isValidScenarioOutput(raw.scenarios[scenarioId], scenarioId)) {
            return false;
        }
    }

    if (!Array.isArray(raw.concreteActions) || !raw.concreteActions.every(isValidConcreteAction)) {
        return false;
    }

    return true;
}

/**
 * Restaure le dernier rapport Futur 4.0 appliqué depuis IndexedDB avec statut discriminé :
 *  - `'ok'`         : rapport valide restauré (clair ou déchiffré).
 *  - `'empty'`      : aucun enregistrement pour ce scope ou erreur d'accès IndexedDB.
 *  - `'unreadable'` : enregistrement présent mais clé absente, blob altéré, JSON invalide ou schéma corrompu.
 */
export async function loadAppliedDeepForecast(
    scope?: DeepForecastStorageScope,
): Promise<LoadDeepForecastResult> {
    const id = resolveRecordId(scope);
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
            message: `Échec d'accès au rapport Futur 4.0 « ${id} » (IndexedDB).`,
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
            message: `Enregistrement Futur 4.0 « ${id} » invalide dans IndexedDB.`,
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
                    message: `Rapport Futur 4.0 « ${id} » chiffré mais clé de device absente : indéchiffrable.`,
                });
                return { status: 'unreadable' };
            }
            parsed = await decryptJson<unknown>(key, rec.payload);
        }

        if (!isValidDeepForecastReport(parsed)) {
            logError({
                source: 'storage',
                severity: 'warning',
                message: `Schéma du rapport Futur 4.0 « ${id} » incompatible ou corrompu.`,
            });
            return { status: 'unreadable' };
        }
        return { status: 'ok', report: parsed };
    } catch (e) {
        logError({
            source: 'storage',
            severity: 'warning',
            message: `Rapport Futur 4.0 « ${id} » présent mais indéchiffrable (blob altéré ou JSON invalide).`,
            error: e instanceof Error ? e : new Error(String(e)),
        });
        return { status: 'unreadable' };
    }
}

/**
 * Chiffre et persiste le rapport Futur 4.0 explicitement appliqué dans IndexedDB
 * (AES-256-GCM si WebCrypto est disponible, sinon repli en clair journalisé une fois).
 */
export function saveAppliedDeepForecast(
    report: DeepForecastReport,
    scope?: DeepForecastStorageScope,
): Promise<boolean> {
    const id = resolveRecordId(scope);
    return enqueueWrite(async () => {
        try {
            const key = await tryGetKey();
            const payload = key ? await encryptJson(key, report) : JSON.stringify(report);
            const rec: DeepForecastRecord = {
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
                message: `Échec de persistance du rapport Futur 4.0 « ${id} » (IndexedDB).`,
                error: e instanceof Error ? e : new Error(String(e)),
            });
            return false;
        }
    });
}

/**
 * Efface l'enregistrement du rapport Futur 4.0 dans IndexedDB pour le scope donné.
 * Best-effort : retourne `false` en cas d'erreur sans lever d'exception.
 */
export function clearAppliedDeepForecast(scope?: DeepForecastStorageScope): Promise<boolean> {
    const id = resolveRecordId(scope);
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
            return true;
        } catch (e) {
            logError({
                source: 'storage',
                severity: 'warning',
                message: `Échec d'effacement du rapport Futur 4.0 « ${id} » (IndexedDB).`,
                error: e instanceof Error ? e : new Error(String(e)),
            });
            return false;
        }
    });
}

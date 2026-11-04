import { serverTimestamp } from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import blueprint from '../../firebase-blueprint.json';
import { auth } from './firebaseClient';
import {
    getDocument,
    createDocument,
    updateDocument,
    subscribeToDocument,
} from './firestoreService';
import { useFinanceStore } from '../../store/useFinanceStore';
import { hasMeaningfulData } from '../../utils/onboarding';
import { buildStarterState } from '../../utils/starterData';
import {
    cleanCandidateState,
    computeCandidateNetWorth,
    computeDossierRichness,
    isStarterTemplateState,
    recoverUser230kData,
    saveProtectedDossierSnapshot,
} from '../dataRecovery';
import { listBackups, readStoredPayload } from '../backupAuto';
import {
    commitWorkspaceWithTransactionMonths,
    fingerprintsOfRemoteMonths,
    loadTransactionMonths,
    mergeTransactionSources,
    partitionTransactionsByMonth,
    planTransactionMonthWrites,
    type RemoteTransactionMonth,
} from './transactionMonths';
import { getOrCreateDeviceKey } from '../secureKeyStore';
import type { AppState } from '../../types';

/** Contraintes de validation extraites directement de firebase-blueprint.json */
const USER_PROFILE_PROPS = blueprint.entities.UserProfile.properties;
const WORKSPACE_PROPS = blueprint.entities.FinancialWorkspace.properties;

const MAX_UID_LENGTH = USER_PROFILE_PROPS.uid.maxLength ?? 128;
export const MAX_DISPLAY_NAME_LENGTH = USER_PROFILE_PROPS.displayName.maxLength ?? 120;
export const MAX_EMAIL_LENGTH = USER_PROFILE_PROPS.email.maxLength ?? 254;
const MAX_PHOTO_URL_LENGTH = USER_PROFILE_PROPS.photoURL.maxLength ?? 500;
const MAX_REVISION_ID_LENGTH = WORKSPACE_PROPS.revisionId.maxLength ?? 64;
export const SAFE_ID_REGEX = new RegExp(WORKSPACE_PROPS.ownerId.pattern ?? '^[a-zA-Z0-9_\\-]+$');

export const PERSISTED_WORKSPACE_KEYS = [
    'config',
    'initialBalances',
    'transactions',
    'budgetItems',
    'assets',
    'investmentAccounts',
    'investmentTransactions',
    'realEstateGoals',
    'retirementGoal',
    'childGoal',
    'childGoals',
    'travelGoals',
    'lifeEvents',
    'debts',
    'financialGoals',
    'projection',
    'categorizationRules',
    'subscriptions',
    'dismissedSubscriptions',
    'healthWeights',
    'setupOptOut',
    'fxRates',
    'fxRatesEstimated',
    'fxRatesSource',
    'fxLastAttemptAt',
    'fxLastAttemptCause',
    'fxObservationDate',
    'lastUpdate',
    'aiConversation',
    'aiConversations',
    'activeAiConversationId',
    'aiChatModel',
    'aiChatCostUsdTotal',
    'insurancePolicies',
    'rentalProperties',
    'privateBusinesses',
    'weddingGoal',
    'vehicleReplacements',
    'majorRenovations',
    'charitableGoals',
    'documents',
    'categoryReview',
    'fintableSync',
    'fintableSyncReport',
    'fintableBrokerBalances',
    'fintableBrokerHistory',
    'fintableRoles',
    'brokerLedger',
    'instruments',
    'brokerAccountRegimes',
    'projectionRunMC',
    'isProjectionLocked',
    'revealedProjectionSig',
    'lockedProjectionCurve',
    'monthlyHistory',
    'annualSnapshots',
    'dismissedNudges',
    'coupleSplitMode',
] as const;

export interface FirebaseWorkspaceSyncStatus {
    state: 'idle' | 'connecting' | 'synced' | 'syncing' | 'error';
    lastSyncedAt: number | null;
    errorMessage: string | null;
}

let currentSyncStatus: FirebaseWorkspaceSyncStatus = {
    state: 'idle',
    lastSyncedAt: null,
    errorMessage: null,
};

const statusListeners = new Set<(status: FirebaseWorkspaceSyncStatus) => void>();

function notifySyncStatus(partial: Partial<FirebaseWorkspaceSyncStatus>) {
    currentSyncStatus = { ...currentSyncStatus, ...partial };
    for (const listener of statusListeners) {
        listener(currentSyncStatus);
    }
}

export function getFirebaseSyncStatus(): FirebaseWorkspaceSyncStatus {
    return currentSyncStatus;
}

export function subscribeFirebaseSyncStatus(
    listener: (status: FirebaseWorkspaceSyncStatus) => void,
): () => void {
    statusListeners.add(listener);
    listener(currentSyncStatus);
    return () => {
        statusListeners.delete(listener);
    };
}

/**
 * Nettoie récursivement une valeur pour qu'elle soit compatible avec les Maps et Lists natives de Firestore
 * (aucun `undefined`, aucune fonction, aucun `NaN` ou `Infinity` remplacé par `null` selon No-fake-data, et exclusion stricte de `apiKeys`).
 */
export function sanitizeForFirestore(value: unknown, depth = 0): unknown {
    if (depth > 12) return null;
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (Array.isArray(value)) {
        return value
            .filter((item) => item !== undefined && typeof item !== 'function')
            .map((item) => sanitizeForFirestore(item, depth + 1));
    }
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (k === 'apiKeys' || v === undefined || typeof v === 'function') continue;
            out[k] = sanitizeForFirestore(v, depth + 1);
        }
        return out;
    }
    return null;
}

/**
 * Extrait et assainit le dossier patrimonial complet depuis le store Zustand,
 * en garantissant qu'aucune clé API locale (`apiKeys`) ni propriété fictive de test n'est incluse.
 */
export function extractSanitizedWorkspacePayload(state: AppState): Record<string, unknown> {
    const cleaned = cleanCandidateState(state);
    const cleanedRecord = cleaned as unknown as Record<string, unknown>;
    const stateRecord = state as unknown as Record<string, unknown>;
    const payload: Record<string, unknown> = {};
    for (const key of PERSISTED_WORKSPACE_KEYS) {
        const rawVal = cleanedRecord[key] ?? stateRecord[key];
        if (rawVal !== undefined) {
            payload[key] = sanitizeForFirestore(rawVal);
        }
    }
    delete payload.apiKeys;
    return payload;
}

const FIRESTORE_MAX_SAFE_UTF8_BYTES = 750_000;
const FIRESTORE_CHUNK_CHAR_SIZE = 200_000;

function measureUtf8Bytes(str: string): number {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(str).byteLength;
    }
    return str.length * 2;
}

function buildCompactFirestoreClone(
    statePayload: Record<string, unknown>,
    maxAssetHistoryPoints: number,
    maxTransactionsCount: number | null,
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...statePayload };
    delete out.apiKeys;

    if (Array.isArray(out.assets)) {
        out.assets = out.assets.map((asset) => {
            if (!asset || typeof asset !== 'object') return asset;
            const rec = { ...(asset as Record<string, unknown>) };
            if (Array.isArray(rec.history) && rec.history.length > maxAssetHistoryPoints) {
                rec.history =
                    maxAssetHistoryPoints > 0 ? rec.history.slice(-maxAssetHistoryPoints) : [];
            }
            if (Array.isArray(rec.priceHistory) && rec.priceHistory.length > maxAssetHistoryPoints) {
                rec.priceHistory =
                    maxAssetHistoryPoints > 0 ? rec.priceHistory.slice(-maxAssetHistoryPoints) : [];
            }
            return rec;
        });
    }

    // Les `transactions` ne sont JAMAIS coupées : elles vivent par mois dans la sous-collection
    // `transactionMonths` (voir `transactionMonths.ts`). Seul le dernier recours sur les
    // `investmentTransactions` subsiste, inchangé.
    if (maxTransactionsCount !== null) {
        if (
            Array.isArray(out.investmentTransactions) &&
            out.investmentTransactions.length > maxTransactionsCount
        ) {
            out.investmentTransactions = out.investmentTransactions.slice(0, maxTransactionsCount);
        }
    }

    return out;
}

/**
 * Empaquette `statePayload` dans une Map Firestore compacte (`_packedFormat: 'json_v1'`)
 * afin d'éviter l'inflation protobuf des tableaux d'objets imbriqués et de garantir
 * que la taille du document `/workspaces/{uid}` reste toujours sous la limite de 1 Mo (1 048 576 octets).
 */
export function packWorkspacePayloadForFirestore(
    statePayload: Record<string, unknown>,
    options: { transactionsSharded?: boolean } = {},
): Record<string, unknown> {
    let compact = buildCompactFirestoreClone(statePayload, 600, null);
    let serialized = JSON.stringify(compact);

    if (measureUtf8Bytes(serialized) > FIRESTORE_MAX_SAFE_UTF8_BYTES) {
        compact = buildCompactFirestoreClone(statePayload, 180, null);
        serialized = JSON.stringify(compact);
    }

    if (measureUtf8Bytes(serialized) > FIRESTORE_MAX_SAFE_UTF8_BYTES) {
        compact = buildCompactFirestoreClone(statePayload, 0, null);
        serialized = JSON.stringify(compact);
    }

    const txCaps = [1500, 1000, 500, 250, 100];
    for (const cap of txCaps) {
        if (measureUtf8Bytes(serialized) <= FIRESTORE_MAX_SAFE_UTF8_BYTES) break;
        compact = buildCompactFirestoreClone(statePayload, 0, cap);
        serialized = JSON.stringify(compact);
    }

    const jsonChunks: string[] = [];
    for (let i = 0; i < serialized.length; i += FIRESTORE_CHUNK_CHAR_SIZE) {
        jsonChunks.push(serialized.slice(i, i + FIRESTORE_CHUNK_CHAR_SIZE));
    }

    const packed: Record<string, unknown> = {
        _packedFormat: 'json_v1',
        jsonChunks,
    };
    if (options.transactionsSharded) {
        packed[TRANSACTIONS_SHARDED_MARKER] = true;
    }
    return packed;
}

/** Marqueur posé dans `statePayload` : les transactions vivent dans `transactionMonths`. */
export const TRANSACTIONS_SHARDED_MARKER = 'transactionsSharded';

/** Vrai si le `statePayload` brut déclare des transactions rangées par mois. */
export function isTransactionsShardedPayload(rawPayload: unknown): boolean {
    return (
        !!rawPayload &&
        typeof rawPayload === 'object' &&
        (rawPayload as Record<string, unknown>)[TRANSACTIONS_SHARDED_MARKER] === true
    );
}

/**
 * Dépaquette `statePayload` lu depuis Firestore (compatible avec le format compacté `json_v1`
 * ainsi qu'avec les anciens documents stockés en Map native).
 */
export function unpackWorkspacePayloadFromFirestore(
    rawPayload: unknown,
): Partial<AppState> | null {
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
        return null;
    }
    const record = rawPayload as Record<string, unknown>;
    if (record._packedFormat === 'json_v1' && Array.isArray(record.jsonChunks)) {
        try {
            const joined = record.jsonChunks
                .filter((chunk): chunk is string => typeof chunk === 'string')
                .join('');
            if (!joined) return null;
            const parsed = JSON.parse(joined) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return null;
            }
            const out = { ...(parsed as Record<string, unknown>) };
            delete out.apiKeys;
            return out as Partial<AppState>;
        } catch {
            return null;
        }
    }
    const copy = { ...record };
    delete copy.apiKeys;
    return copy as Partial<AppState>;
}

export function makeSafeRevisionId(): string {
    const raw = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, MAX_REVISION_ID_LENGTH);
    return SAFE_ID_REGEX.test(cleaned) ? cleaned : `rev_${Date.now()}`;
}

/**
 * Extrait l'horodatage en millisecondes d'un document Firestore (`/workspaces/{uid}`)
 * à partir de `updatedAt` (Timestamp Firestore, epoch ms ou chaîne ISO) ou de `statePayload.lastUpdate`.
 */
export function extractRemoteTimestampMs(
    data: Record<string, unknown>,
    remotePayload?: Partial<AppState> | null,
): number | null {
    const rawUpdated = data.updatedAt;
    if (rawUpdated && typeof rawUpdated === 'object') {
        const maybeToMillis = (rawUpdated as { toMillis?: () => unknown }).toMillis;
        if (typeof maybeToMillis === 'function') {
            const ms = maybeToMillis.call(rawUpdated);
            if (typeof ms === 'number' && Number.isFinite(ms)) return ms;
        }
        const seconds = (rawUpdated as { seconds?: unknown }).seconds;
        if (typeof seconds === 'number' && Number.isFinite(seconds)) {
            return seconds * 1000;
        }
    }
    if (typeof rawUpdated === 'number' && Number.isFinite(rawUpdated)) {
        return rawUpdated;
    }
    if (typeof rawUpdated === 'string') {
        const parsed = Date.parse(rawUpdated);
        if (Number.isFinite(parsed)) return parsed;
    }
    if (
        remotePayload &&
        typeof remotePayload.lastUpdate === 'number' &&
        Number.isFinite(remotePayload.lastUpdate)
    ) {
        return remotePayload.lastUpdate;
    }
    return null;
}

interface RemoteWorkspaceSnapshot {
    /** Le document principal `workspaces/{uid}` existe. */
    exists: boolean;
    data: Record<string, unknown> | null;
    /** Dossier Cloud complet : document principal + toutes les transactions des mois, fusionnées. */
    payload: Partial<AppState> | null;
    months: RemoteTransactionMonth[];
    /** Faux si la sous-collection n'a pas pu être lue (ancien document seulement). */
    monthsKnown: boolean;
}

/**
 * Fusionne le `statePayload` du document principal avec les mois de `transactionMonths`.
 * Un ancien document qui contient encore `transactions` (sans marqueur) est lu tel quel ;
 * les mois éventuels s'y ajoutent sans doublon d'`id`.
 */
export function buildMergedRemotePayload(
    rawStatePayload: unknown,
    months: readonly RemoteTransactionMonth[],
): Partial<AppState> | null {
    const mainPayload = unpackWorkspacePayloadFromFirestore(rawStatePayload);
    if (!mainPayload && months.length === 0) return null;
    const base = (mainPayload ?? {}) as Partial<AppState>;
    if (months.length === 0) return base;
    const merged = mergeTransactionSources(base.transactions as unknown[] | undefined, months);
    return { ...base, transactions: merged as AppState['transactions'] };
}

/**
 * Lit le dossier Cloud complet : document principal + sous-collection des mois.
 * Si les mois sont illisibles alors que le document les déclare (`transactionsSharded`),
 * l'erreur remonte : un dossier partiel ne doit jamais passer pour le dossier Cloud.
 */
async function loadRemoteWorkspace(uid: string, user: FirebaseUser): Promise<RemoteWorkspaceSnapshot> {
    const authOpts = { expectedUid: uid, authenticatedUser: user };
    const snap = await getDocument('workspaces', uid, authOpts);
    const data = snap.exists && snap.data ? (snap.data as Record<string, unknown>) : null;
    let months: RemoteTransactionMonth[] = [];
    let monthsKnown = true;
    try {
        months = await loadTransactionMonths(uid, user);
    } catch (error) {
        // Ancien document (transactions encore dans le document principal) : on le lit tel quel,
        // mais l'état des mois reste inconnu et aucune écriture ne partira sans eux.
        if (data && !isTransactionsShardedPayload(data.statePayload)) {
            monthsKnown = false;
        } else {
            throw error;
        }
    }
    return {
        exists: !!data,
        data,
        payload: data ? buildMergedRemotePayload(data.statePayload, months) : null,
        months,
        monthsKnown,
    };
}

/**
 * Télécharge et applique immédiatement le dossier patrimonial stocké dans Cloud Firestore (`/workspaces/{uid}`)
 * s'il contient des données réelles hors gabarit de départ.
 */
export async function pullWorkspaceFromFirestoreNow(user: FirebaseUser): Promise<{
    restored: boolean;
    netWorth: number;
    assetsCount: number;
    transactionsCount: number;
}> {
    const uid = (user.uid || '').slice(0, MAX_UID_LENGTH);
    if (!SAFE_ID_REGEX.test(uid)) {
        return { restored: false, netWorth: 0, assetsCount: 0, transactionsCount: 0 };
    }
    try {
        const remote = await loadRemoteWorkspace(uid, user);
        rememberRemoteMonths(uid, remote);
        if (!remote.exists || !remote.data) {
            return { restored: false, netWorth: 0, assetsCount: 0, transactionsCount: 0 };
        }
        activeWorkspaceDocExists = true;
        const data = remote.data;
        const remotePayload = remote.payload;
        if (
            !remotePayload ||
            !hasMeaningfulData(remotePayload) ||
            isStarterTemplateState(remotePayload)
        ) {
            return { restored: false, netWorth: 0, assetsCount: 0, transactionsCount: 0 };
        }
        const sanitizedRemote = cleanCandidateState(remotePayload);
        const remoteUpdatedAtMs = extractRemoteTimestampMs(data, remotePayload);
        applyingRemoteSnapshot = true;
        try {
            if (typeof data.revisionId === 'string') {
                lastKnownRevisionId = data.revisionId;
                saveLastSyncedRevisionId(uid, data.revisionId);
            }
            clearDirtySinceLastSync(uid);
            firestoreSessionSynced = true;
            useFinanceStore.getState().setAppState({
                ...sanitizedRemote,
                lastUpdate: remoteUpdatedAtMs ?? Date.now(),
            });
            useFinanceStore.setState({
                isTestMode: false,
                activeTestPersonaId: null,
                realDataSnapshot: null,
            });
            lastSerializedPayload = JSON.stringify(
                extractSanitizedWorkspacePayload(useFinanceStore.getState()),
            );
            saveProtectedDossierSnapshot({
                ...sanitizedRemote,
                lastUpdate: remoteUpdatedAtMs ?? Date.now(),
            });
        } finally {
            applyingRemoteSnapshot = false;
        }
        notifySyncStatus({
            state: 'synced',
            lastSyncedAt: Date.now(),
            errorMessage: null,
        });
        return {
            restored: true,
            netWorth: computeCandidateNetWorth(sanitizedRemote),
            assetsCount: (sanitizedRemote.assets ?? []).length,
            transactionsCount: (sanitizedRemote.transactions ?? []).length,
        };
    } catch {
        return { restored: false, netWorth: 0, assetsCount: 0, transactionsCount: 0 };
    }
}

/**
 * Recherche dans Cloud Firestore (`/workspaces/{uid}`), le bouclier local, les sauvegardes auto IndexedDB
 * et Google Drive un vrai dossier personnalisé (hors gabarit Alex), en privilégiant toujours le dossier le plus riche.
 */
export async function recoverOrEnsureInitialWorkspace(
    forceEvenIfNotEmpty = false,
): Promise<'kept' | 'restored-snapshot' | 'restored-idb' | 'restored-starter'> {
    // 0. Priorité absolue à Cloud Firestore si l'utilisateur est connecté : PC et mobile partagent exactement le même dossier
    if (auth.currentUser) {
        const firestoreRestored = await pullWorkspaceFromFirestoreNow(auth.currentUser);
        if (firestoreRestored.restored) {
            return 'restored-snapshot';
        }
    }

    const current = useFinanceStore.getState();
    const currentIsStarter = isStarterTemplateState(current);

    if (!forceEvenIfNotEmpty && hasMeaningfulData(current) && !currentIsStarter) {
        await recoverUser230kData(false);
        return 'kept';
    }

    if (
        current.realDataSnapshot &&
        hasMeaningfulData(current.realDataSnapshot) &&
        !isStarterTemplateState(current.realDataSnapshot)
    ) {
        const cleaned = cleanCandidateState(current.realDataSnapshot);
        useFinanceStore.getState().setAppState({
            ...cleaned,
            lastUpdate: typeof cleaned.lastUpdate === 'number' ? cleaned.lastUpdate : 0,
        });
        return 'restored-snapshot';
    }

    try {
        const backups = await listBackups();
        if (backups.length > 0) {
            let deviceKey: CryptoKey | null = null;
            try {
                deviceKey = await getOrCreateDeviceKey();
            } catch {
                deviceKey = null;
            }
            // Du plus récent au plus ancien, en privilégiant les vrais dossiers personnalisés (hors gabarit Alex)
            const ordered = [...backups].sort((a, b) => b.timestamp - a.timestamp);
            for (const entry of ordered) {
                if (entry.testMode) continue;
                try {
                    const plaintext = await readStoredPayload(entry, deviceKey);
                    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
                    const candidate = (
                        parsed && typeof parsed.state === 'object' && parsed.state !== null
                            ? parsed.state
                            : parsed
                    ) as Partial<AppState>;
                    if (
                        candidate &&
                        hasMeaningfulData(candidate) &&
                        !isStarterTemplateState(candidate)
                    ) {
                        const cleaned = cleanCandidateState(candidate);
                        useFinanceStore.getState().setAppState({
                            ...cleaned,
                            lastUpdate: entry.timestamp || 0,
                        });
                        if (auth.currentUser) {
                            void pushWorkspaceToFirestore(auth.currentUser).catch(() => {});
                        }
                        return 'restored-idb';
                    }
                } catch {
                    // Continuer vers l'instantané suivant
                }
            }
        }
    } catch {
        // IndexedDB indisponible
    }

    const recovered = await recoverUser230kData(forceEvenIfNotEmpty);
    const afterRecovery = useFinanceStore.getState();
    if (recovered.restored && !isStarterTemplateState(afterRecovery)) {
        if (auth.currentUser) {
            void pushWorkspaceToFirestore(auth.currentUser).catch(() => {});
        }
        return 'restored-idb';
    }

    if (forceEvenIfNotEmpty && !hasMeaningfulData(afterRecovery)) {
        const starter = buildStarterState();
        useFinanceStore.getState().setAppState(starter);
        return 'restored-starter';
    }
    return 'kept';
}

/**
 * Crée ou met à jour le document `/users/{uid}` de l'utilisateur authentifié
 * en respectant strictement le schéma `UserProfile` de `firebase-blueprint.json`.
 */
export async function upsertUserProfile(user: FirebaseUser): Promise<void> {
    const uid = (user.uid || '').slice(0, MAX_UID_LENGTH);
    if (!SAFE_ID_REGEX.test(uid)) return;

    const email = (user.email || 'utilisateur@example.com').slice(0, MAX_EMAIL_LENGTH);
    const displayName = (user.displayName || '').slice(0, MAX_DISPLAY_NAME_LENGTH);
    const photoURL = (user.photoURL || '').slice(0, MAX_PHOTO_URL_LENGTH);
    const authOpts = { expectedUid: uid, authenticatedUser: user };

    const existing = await getDocument('users', uid, authOpts);

    if (!existing.exists) {
        await createDocument(
            'users',
            uid,
            {
                uid,
                displayName,
                email,
                photoURL,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            },
            authOpts,
        );
    } else {
        await updateDocument(
            'users',
            uid,
            {
                displayName,
                email,
                photoURL,
                updatedAt: serverTimestamp(),
            },
            authOpts,
        );
    }
}

let activeWorkspaceDocExists = false;
let lastKnownRevisionId = '';
let lastSerializedPayload = '';
let applyingRemoteSnapshot = false;
let firestoreSessionSynced = false;
let activeSessionHandledInitial = false;
/**
 * Empreintes Cloud des mois de `transactionMonths` (par uid). `null` = inconnues : la prochaine
 * écriture relit la sous-collection avant de décider quels mois réécrire ou supprimer.
 */
let remoteMonthsState: { uid: string; fingerprints: Map<string, string> } | null = null;

/** Indique si la session courante a déjà été synchronisée avec Cloud Firestore. */
export function hasFirestoreSyncedThisSession(): boolean {
    return firestoreSessionSynced;
}

/** Taille maximale acceptée pour le document principal (limite Firestore : 1 048 576 octets). */
const FIRESTORE_MAIN_DOC_MAX_UTF8_BYTES = 1_000_000;
const LAST_SYNCED_REV_PREFIX = 'financeai:last_synced_revision:v1:';
const DIRTY_SINCE_SYNC_PREFIX = 'financeai:dirty_since_sync:v1:';

function saveLastSyncedRevisionId(uid: string, revisionId: string): void {
    if (!revisionId || typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(`${LAST_SYNCED_REV_PREFIX}${uid}`, revisionId);
    } catch {
        // Ignorer si quota atteint
    }
}

function loadLastSyncedRevisionId(uid: string): string {
    if (typeof localStorage === 'undefined') return '';
    try {
        return localStorage.getItem(`${LAST_SYNCED_REV_PREFIX}${uid}`) ?? '';
    } catch {
        return '';
    }
}

function markDirtySinceLastSync(uid: string, timestampMs = Date.now()): void {
    if (!uid || typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(`${DIRTY_SINCE_SYNC_PREFIX}${uid}`, String(timestampMs));
    } catch {
        // Ignorer
    }
}

function clearDirtySinceLastSync(uid: string): void {
    if (!uid || typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem(`${DIRTY_SINCE_SYNC_PREFIX}${uid}`);
    } catch {
        // Ignorer
    }
}

function loadDirtySinceLastSync(uid: string): number {
    if (!uid || typeof localStorage === 'undefined') return 0;
    try {
        const raw = localStorage.getItem(`${DIRTY_SINCE_SYNC_PREFIX}${uid}`);
        if (!raw) return 0;
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
        return 0;
    }
}

function rememberRemoteMonths(uid: string, remote: { months: RemoteTransactionMonth[]; monthsKnown: boolean }): void {
    remoteMonthsState = remote.monthsKnown
        ? { uid, fingerprints: fingerprintsOfRemoteMonths(remote.months) }
        : null;
}

/**
 * Pousse immédiatement l'état courant du dossier patrimonial vers `/workspaces/{uid}` (Cloud Firestore),
 * en ignorant le mode test et le gabarit Alex.
 * Les transactions partent par mois dans `workspaces/{uid}/transactionMonths/{AAAA-MM}` : seuls les
 * mois modifiés sont réécrits, un mois devenu vide est supprimé, et rien n'est jamais coupé.
 */
export async function pushWorkspaceToFirestore(user: FirebaseUser): Promise<void> {
    const uid = (user.uid || '').slice(0, MAX_UID_LENGTH);
    if (!SAFE_ID_REGEX.test(uid)) return;
    const currentState = useFinanceStore.getState();
    if (currentState.isTestMode || isStarterTemplateState(currentState)) return;

    const statePayload = extractSanitizedWorkspacePayload(currentState);
    const localTransactions = Array.isArray(statePayload.transactions) ? statePayload.transactions : [];
    const partition = partitionTransactionsByMonth(localTransactions);
    const firestoreStatePayload = packWorkspacePayloadForFirestore(
        { ...statePayload, transactions: partition.leftovers },
        { transactionsSharded: true },
    );
    const revisionId = makeSafeRevisionId();

    lastKnownRevisionId = revisionId;
    lastSerializedPayload = JSON.stringify(statePayload);
    notifySyncStatus({ state: 'syncing', errorMessage: null });

    if (measureUtf8Bytes(JSON.stringify(firestoreStatePayload)) > FIRESTORE_MAIN_DOC_MAX_UTF8_BYTES) {
        notifySyncStatus({ state: 'error', errorMessage: 'Dossier Cloud trop volumineux : écriture annulée' });
        throw new Error('Document principal Firestore trop volumineux : écriture annulée, aucune donnée coupée.');
    }

    if (!activeWorkspaceDocExists || !remoteMonthsState || remoteMonthsState.uid !== uid) {
        try {
            const remote = await loadRemoteWorkspace(uid, user);
            activeWorkspaceDocExists = remote.exists;
            rememberRemoteMonths(uid, remote);
            // Au tout premier démarrage (avant qu'un snapshot initial ait été traité sur cet appareil),
            // on n'écrase jamais un historique Cloud plus riche par un état local plus pauvre.
            const remoteCandidate: Partial<AppState> | null =
                remote.payload ??
                (remote.months.length > 0
                    ? { transactions: mergeTransactionSources([], remote.months) as AppState['transactions'] }
                    : null);
            if (
                !activeSessionHandledInitial &&
                remoteCandidate &&
                computeDossierRichness(remoteCandidate) > computeDossierRichness(currentState)
            ) {
                if (remote.exists) {
                    await pullWorkspaceFromFirestoreNow(user);
                } else {
                    notifySyncStatus({
                        state: 'error',
                        errorMessage: 'Historique Cloud plus riche que le local : écriture annulée',
                    });
                }
                return;
            }
        } catch (error) {
            notifySyncStatus({ state: 'error', errorMessage: 'Erreur de lecture Firestore' });
            throw error;
        }
    }

    if (!remoteMonthsState) {
        notifySyncStatus({ state: 'error', errorMessage: 'Mois de transactions Cloud illisibles : écriture annulée' });
        throw new Error('Sous-collection transactionMonths illisible : écriture annulée pour ne rien perdre.');
    }

    const plan = planTransactionMonthWrites(partition, remoteMonthsState.fingerprints);
    const creating = !activeWorkspaceDocExists;
    try {
        await commitWorkspaceWithTransactionMonths({
            uid,
            user,
            revisionId,
            plan,
            main: creating
                ? {
                      mode: 'create',
                      data: {
                          ownerId: uid,
                          schemaVersion: 1,
                          revisionId,
                          statePayload: firestoreStatePayload,
                          createdAt: serverTimestamp(),
                          updatedAt: serverTimestamp(),
                      },
                  }
                : {
                      mode: 'update',
                      data: {
                          schemaVersion: 1,
                          revisionId,
                          statePayload: firestoreStatePayload,
                          updatedAt: serverTimestamp(),
                      },
                  },
        });
        activeWorkspaceDocExists = true;
        firestoreSessionSynced = true;
        remoteMonthsState = { uid, fingerprints: plan.nextFingerprints };
        saveLastSyncedRevisionId(uid, revisionId);
        clearDirtySinceLastSync(uid);
        notifySyncStatus({ state: 'synced', lastSyncedAt: Date.now(), errorMessage: null });
    } catch (error) {
        remoteMonthsState = null;
        notifySyncStatus({
            state: 'error',
            errorMessage: creating ? 'Échec de création du dossier Cloud' : 'Échec de mise à jour Firestore',
        });
        throw error;
    }
}

/**
 * Démarre la synchronisation bidirectionnelle en temps réel entre le store Zustand
 * et Cloud Firestore (`/workspaces/{uid}`).
 */
export function startWorkspaceRealtimeSync(user: FirebaseUser): () => void {
    const uid = (user.uid || '').slice(0, MAX_UID_LENGTH);
    if (!SAFE_ID_REGEX.test(uid)) {
        return () => {};
    }

    activeWorkspaceDocExists = false;
    activeSessionHandledInitial = false;
    remoteMonthsState = null;
    lastKnownRevisionId = loadLastSyncedRevisionId(uid);
    let initialSnapshotHandled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconcileInFlight = false;
    let snapshotSequence = 0;

    notifySyncStatus({ state: 'connecting', errorMessage: null });

    /** Décision d'application d'un dossier Cloud complet (document principal + mois fusionnés). */
    const handleRemoteWorkspace = (
        data: Record<string, unknown>,
        remotePayload: Partial<AppState> | null,
    ): void => {
        const remoteRevision = typeof data.revisionId === 'string' ? data.revisionId : '';
        const remoteHasData = remotePayload ? hasMeaningfulData(remotePayload) : false;
        const remoteIsStarter = remotePayload
            ? isStarterTemplateState(remotePayload)
            : false;

        const currentLocalState = useFinanceStore.getState();
        const localHasMeaningfulData =
            hasMeaningfulData(currentLocalState) &&
            !isStarterTemplateState(currentLocalState);
        const remoteRichness = computeDossierRichness(remotePayload);
        const localRichness = computeDossierRichness(currentLocalState);
        const isRemoteRicherThanLocal = remoteRichness > localRichness;
        const localLastUpdate =
            typeof currentLocalState.lastUpdate === 'number' &&
            Number.isFinite(currentLocalState.lastUpdate)
                ? currentLocalState.lastUpdate
                : 0;
        const remoteUpdatedAtMs = extractRemoteTimestampMs(data, remotePayload);
        const lastSyncedOnThisDevice = loadLastSyncedRevisionId(uid);
        const dirtySinceMs = loadDirtySinceLastSync(uid);
        const remoteChangedByOtherDevice =
            remoteRevision !== '' && remoteRevision !== lastSyncedOnThisDevice;

        // Un état local ne l'emporte sur le Cloud que si :
        // 1) L'utilisateur a explicitement modifié cet appareil depuis la dernière sync (`dirtySinceMs > 0`)
        //    ET cette modification est plus récente que l'horodatage Cloud (`remoteUpdatedAtMs < dirtySinceMs`) ;
        // 2) OU c'est la toute première connexion de cet appareil (`lastSyncedOnThisDevice === ''`)
        //    et le dossier local est strictement plus riche que le Cloud (ex. > 1 500 transactions sur PC) ;
        // 3) OU `remoteRevision === lastKnownRevisionId` et l'horodatage local explicite est plus récent.
        const isLocalExplicitlyNewer =
            localHasMeaningfulData &&
            ((dirtySinceMs > 0 && (remoteUpdatedAtMs === null || remoteUpdatedAtMs < dirtySinceMs)) ||
                (lastSyncedOnThisDevice === '' && localRichness > remoteRichness) ||
                (!isRemoteRicherThanLocal &&
                    !remoteChangedByOtherDevice &&
                    localRichness >= remoteRichness &&
                    remoteUpdatedAtMs !== null &&
                    localLastUpdate > 0 &&
                    remoteUpdatedAtMs < localLastUpdate));

        if (
            remotePayload &&
            remoteHasData &&
            !remoteIsStarter &&
            (remoteRevision !== lastKnownRevisionId || !initialSnapshotHandled || isRemoteRicherThanLocal) &&
            !isLocalExplicitlyNewer
        ) {
            applyingRemoteSnapshot = true;
            try {
                const sanitizedRemote = cleanCandidateState(remotePayload);
                lastKnownRevisionId = remoteRevision;
                saveLastSyncedRevisionId(uid, remoteRevision);
                clearDirtySinceLastSync(uid);
                firestoreSessionSynced = true;
                useFinanceStore.getState().setAppState({
                    ...sanitizedRemote,
                    lastUpdate: remoteUpdatedAtMs ?? Date.now(),
                });
                useFinanceStore.setState({
                    isTestMode: false,
                    activeTestPersonaId: null,
                    realDataSnapshot: null,
                });
                lastSerializedPayload = JSON.stringify(
                    extractSanitizedWorkspacePayload(useFinanceStore.getState()),
                );
                saveProtectedDossierSnapshot({
                    ...sanitizedRemote,
                    lastUpdate: remoteUpdatedAtMs ?? Date.now(),
                });
            } finally {
                applyingRemoteSnapshot = false;
            }
            initialSnapshotHandled = true;
            activeSessionHandledInitial = true;
            notifySyncStatus({
                state: 'synced',
                lastSyncedAt: Date.now(),
                errorMessage: null,
            });
        } else if (isLocalExplicitlyNewer) {
            initialSnapshotHandled = true;
            activeSessionHandledInitial = true;
            firestoreSessionSynced = true;
            void pushWorkspaceToFirestore(user).catch(() => {});
        } else if (!remoteHasData || remoteIsStarter) {
            initialSnapshotHandled = true;
            activeSessionHandledInitial = true;
            void (async () => {
                await recoverOrEnsureInitialWorkspace(false);
                if (!isStarterTemplateState(useFinanceStore.getState()) && hasMeaningfulData(useFinanceStore.getState())) {
                    await pushWorkspaceToFirestore(user).catch(() => {});
                } else {
                    notifySyncStatus({
                        state: 'synced',
                        lastSyncedAt: Date.now(),
                        errorMessage: null,
                    });
                }
            })();
        } else {
            initialSnapshotHandled = true;
            activeSessionHandledInitial = true;
            firestoreSessionSynced = true;
            notifySyncStatus({
                state: 'synced',
                lastSyncedAt: Date.now(),
                errorMessage: null,
            });
        }
    };

    const reconcileNow = async (): Promise<void> => {
        if (reconcileInFlight || applyingRemoteSnapshot) return;
        reconcileInFlight = true;
        try {
            const remote = await loadRemoteWorkspace(uid, user);
            rememberRemoteMonths(uid, remote);
            if (remote.exists && remote.data) {
                activeWorkspaceDocExists = true;
                handleRemoteWorkspace(remote.data, remote.payload);
            } else if (!initialSnapshotHandled) {
                initialSnapshotHandled = true;
                activeSessionHandledInitial = true;
                activeWorkspaceDocExists = false;
                await recoverOrEnsureInitialWorkspace(false);
                if (!isStarterTemplateState(useFinanceStore.getState()) && hasMeaningfulData(useFinanceStore.getState())) {
                    await pushWorkspaceToFirestore(user).catch(() => {});
                } else {
                    notifySyncStatus({
                        state: 'synced',
                        lastSyncedAt: Date.now(),
                        errorMessage: null,
                    });
                }
            }
        } catch {
            // Ignorer une erreur réseau transitoire lors de la réconciliation périodique
        } finally {
            reconcileInFlight = false;
        }
    };

    const unsubscribeSnapshot = subscribeToDocument<Record<string, unknown>>(
        'workspaces',
        uid,
        (snapshot) => {
            const sequence = ++snapshotSequence;
            if (snapshot.exists && snapshot.data) {
                activeWorkspaceDocExists = true;
                const data = snapshot.data;
                const remoteRevision = typeof data.revisionId === 'string' ? data.revisionId : '';
                // Écho de notre propre écriture : les mois viennent d'être écrits par ce client.
                if (initialSnapshotHandled && remoteRevision !== '' && remoteRevision === lastKnownRevisionId) {
                    notifySyncStatus({ state: 'synced', lastSyncedAt: Date.now(), errorMessage: null });
                    return;
                }
                // Nouveau `revisionId` : on recharge les mois de `transactionMonths` avant de décider.
                void (async () => {
                    let months: RemoteTransactionMonth[] = [];
                    let monthsKnown = true;
                    try {
                        months = await loadTransactionMonths(uid, user);
                    } catch {
                        if (isTransactionsShardedPayload(data.statePayload)) {
                            if (sequence === snapshotSequence) {
                                notifySyncStatus({
                                    state: 'error',
                                    errorMessage: 'Lecture des mois de transactions Cloud impossible',
                                });
                            }
                            return;
                        }
                        monthsKnown = false;
                    }
                    if (sequence !== snapshotSequence) return;
                    rememberRemoteMonths(uid, { months, monthsKnown });
                    handleRemoteWorkspace(data, buildMergedRemotePayload(data.statePayload, months));
                })();
            } else if (!initialSnapshotHandled) {
                initialSnapshotHandled = true;
                activeSessionHandledInitial = true;
                activeWorkspaceDocExists = false;
                void (async () => {
                    await recoverOrEnsureInitialWorkspace(false);
                    if (!isStarterTemplateState(useFinanceStore.getState()) && hasMeaningfulData(useFinanceStore.getState())) {
                        await pushWorkspaceToFirestore(user).catch(() => {});
                    } else {
                        notifySyncStatus({
                            state: 'synced',
                            lastSyncedAt: Date.now(),
                            errorMessage: null,
                        });
                    }
                })();
            }
        },
        () => {
            notifySyncStatus({
                state: 'error',
                errorMessage: 'Connexion temps réel Firestore interrompue',
            });
        },
        { expectedUid: uid, authenticatedUser: user },
    );

    const unsubscribeStore = useFinanceStore.subscribe((state) => {
        if (!initialSnapshotHandled || applyingRemoteSnapshot) return;
        if (state.isTestMode || isStarterTemplateState(state)) return;
        if (!hasMeaningfulData(state)) return;
        const nextPayload = extractSanitizedWorkspacePayload(state);
        const serialized = JSON.stringify(nextPayload);
        if (serialized === lastSerializedPayload) return;

        lastSerializedPayload = serialized;
        markDirtySinceLastSync(uid, Date.now());
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void pushWorkspaceToFirestore(user).catch(() => {});
        }, 300);
    });

    // Réconciliation automatique multi-appareils (PC ↔ Téléphone ↔ Tablette) au réveil de l'écran,
    // retour sur l'onglet, reconnexion réseau et battement de cœur périodique (mobile WebSocket suspendu)
    const handleVisibilityOrFocus = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
                void pushWorkspaceToFirestore(user).catch(() => {});
            }
            return;
        }
        void reconcileNow();
    };

    const isTestEnv = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
    if (!isTestEnv && typeof window !== 'undefined' && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibilityOrFocus);
        window.addEventListener('focus', handleVisibilityOrFocus);
        window.addEventListener('pageshow', handleVisibilityOrFocus);
        window.addEventListener('online', handleVisibilityOrFocus);
        heartbeatTimer = setInterval(() => {
            if (document.visibilityState === 'visible') {
                void reconcileNow();
            }
        }, 15_000);
    }

    return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (!isTestEnv && typeof window !== 'undefined' && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
            window.removeEventListener('focus', handleVisibilityOrFocus);
            window.removeEventListener('pageshow', handleVisibilityOrFocus);
            window.removeEventListener('online', handleVisibilityOrFocus);
        }
        unsubscribeSnapshot();
        unsubscribeStore();
        notifySyncStatus({ state: 'idle', errorMessage: null });
    };
}

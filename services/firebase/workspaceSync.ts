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
    isStarterTemplateState,
    recoverUser230kData,
} from '../dataRecovery';
import { listBackups, readStoredPayload } from '../backupAuto';
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

    if (maxTransactionsCount !== null) {
        if (Array.isArray(out.transactions) && out.transactions.length > maxTransactionsCount) {
            out.transactions = out.transactions.slice(0, maxTransactionsCount);
        }
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
): Record<string, unknown> {
    let compact = buildCompactFirestoreClone(statePayload, 30, null);
    let serialized = JSON.stringify(compact);

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

    return {
        _packedFormat: 'json_v1',
        jsonChunks,
    };
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

/**
 * Recherche dans le bouclier local, les sauvegardes auto IndexedDB et Google Drive un vrai dossier
 * personnalisé (hors gabarit Alex), et ne se replie sur `buildStarterState()` que sur demande explicite.
 */
export async function recoverOrEnsureInitialWorkspace(
    forceEvenIfNotEmpty = false,
): Promise<'kept' | 'restored-snapshot' | 'restored-idb' | 'restored-starter'> {
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
            lastUpdate: Date.now(),
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
                            lastUpdate: Date.now(),
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

/**
 * Pousse immédiatement l'état courant du dossier patrimonial vers `/workspaces/{uid}` (Cloud Firestore),
 * en ignorant le mode test et le gabarit Alex.
 */
export async function pushWorkspaceToFirestore(user: FirebaseUser): Promise<void> {
    const uid = (user.uid || '').slice(0, MAX_UID_LENGTH);
    if (!SAFE_ID_REGEX.test(uid)) return;
    const currentState = useFinanceStore.getState();
    if (currentState.isTestMode || isStarterTemplateState(currentState)) return;

    const statePayload = extractSanitizedWorkspacePayload(currentState);
    const firestoreStatePayload = packWorkspacePayloadForFirestore(statePayload);
    const revisionId = makeSafeRevisionId();
    const authOpts = { expectedUid: uid, authenticatedUser: user };

    lastKnownRevisionId = revisionId;
    lastSerializedPayload = JSON.stringify(statePayload);
    notifySyncStatus({ state: 'syncing', errorMessage: null });

    if (!activeWorkspaceDocExists) {
        try {
            const snap = await getDocument('workspaces', uid, authOpts);
            activeWorkspaceDocExists = snap.exists;
        } catch (error) {
            notifySyncStatus({ state: 'error', errorMessage: 'Erreur de lecture Firestore' });
            throw error;
        }
    }

    if (!activeWorkspaceDocExists) {
        try {
            await createDocument(
                'workspaces',
                uid,
                {
                    ownerId: uid,
                    schemaVersion: 1,
                    revisionId,
                    statePayload: firestoreStatePayload,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                },
                authOpts,
            );
            activeWorkspaceDocExists = true;
            notifySyncStatus({ state: 'synced', lastSyncedAt: Date.now(), errorMessage: null });
        } catch (error) {
            notifySyncStatus({ state: 'error', errorMessage: 'Échec de création du dossier Cloud' });
            throw error;
        }
    } else {
        try {
            await updateDocument(
                'workspaces',
                uid,
                {
                    schemaVersion: 1,
                    revisionId,
                    statePayload: firestoreStatePayload,
                    updatedAt: serverTimestamp(),
                },
                authOpts,
            );
            notifySyncStatus({ state: 'synced', lastSyncedAt: Date.now(), errorMessage: null });
        } catch (error) {
            notifySyncStatus({ state: 'error', errorMessage: 'Échec de mise à jour Firestore' });
            throw error;
        }
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
    let initialSnapshotHandled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    notifySyncStatus({ state: 'connecting', errorMessage: null });

    const unsubscribeSnapshot = subscribeToDocument<Record<string, unknown>>(
        'workspaces',
        uid,
        (snapshot) => {
            if (snapshot.exists && snapshot.data) {
                activeWorkspaceDocExists = true;
                const data = snapshot.data;
                const remoteRevision = typeof data.revisionId === 'string' ? data.revisionId : '';
                const remotePayload = unpackWorkspacePayloadFromFirestore(data.statePayload);
                const remoteHasData = remotePayload ? hasMeaningfulData(remotePayload) : false;
                const remoteIsStarter = remotePayload
                    ? isStarterTemplateState(remotePayload)
                    : false;

                const currentLocalState = useFinanceStore.getState();
                const localHasMeaningfulData =
                    hasMeaningfulData(currentLocalState) &&
                    !isStarterTemplateState(currentLocalState);
                const localLastUpdate =
                    typeof currentLocalState.lastUpdate === 'number' &&
                    Number.isFinite(currentLocalState.lastUpdate)
                        ? currentLocalState.lastUpdate
                        : 0;
                const remoteUpdatedAtMs = extractRemoteTimestampMs(data, remotePayload);
                const isRemoteOlderThanLocal =
                    localHasMeaningfulData &&
                    remoteUpdatedAtMs !== null &&
                    localLastUpdate > 0 &&
                    remoteUpdatedAtMs < localLastUpdate;

                if (
                    remotePayload &&
                    remoteHasData &&
                    !remoteIsStarter &&
                    remoteRevision !== lastKnownRevisionId &&
                    !isRemoteOlderThanLocal
                ) {
                    applyingRemoteSnapshot = true;
                    try {
                        const sanitizedRemote = cleanCandidateState(remotePayload);
                        lastKnownRevisionId = remoteRevision;
                        lastSerializedPayload = JSON.stringify(sanitizedRemote);
                        useFinanceStore.getState().setAppState({
                            ...sanitizedRemote,
                            lastUpdate: remoteUpdatedAtMs ?? Date.now(),
                        });
                    } finally {
                        applyingRemoteSnapshot = false;
                    }
                    initialSnapshotHandled = true;
                    notifySyncStatus({
                        state: 'synced',
                        lastSyncedAt: Date.now(),
                        errorMessage: null,
                    });
                } else if (isRemoteOlderThanLocal) {
                    initialSnapshotHandled = true;
                    void pushWorkspaceToFirestore(user).catch(() => {});
                } else if (!remoteHasData || remoteIsStarter) {
                    initialSnapshotHandled = true;
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
                    notifySyncStatus({
                        state: 'synced',
                        lastSyncedAt: Date.now(),
                        errorMessage: null,
                    });
                }
            } else if (!initialSnapshotHandled) {
                initialSnapshotHandled = true;
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
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            void pushWorkspaceToFirestore(user).catch(() => {});
        }, 700);
    });

    return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        unsubscribeSnapshot();
        unsubscribeStore();
        notifySyncStatus({ state: 'idle', errorMessage: null });
    };
}
